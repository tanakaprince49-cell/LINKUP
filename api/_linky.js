// Linky core: ask -> immediate cited answer, double opt-in intros, audit,
// editable "what Linky knows", bot linking. Shared by api/linky.js
// (app + Telegram + WhatsApp).
//
// No intents, no waiting: every ask is answered in the same request from the
// members who are on LINKUP right now. Gemini is only called when there are
// at least two plausible candidates to rank (never for greetings, vague asks,
// zero-candidate asks, repeats of the same ask, or over-budget asks), and a
// Gemini failure degrades to the cited template path instead of an error.
//
// Every write in here happens with the Admin SDK, so the client never needs
// rules for these collections (they stay server-only):
//   introSuggestions/{uid}  Linky's cards for a member (cite-or-skip "why")
//   intros/{id}             double opt-in: requester Meet -> target Accept
//   linkyState/{uid}        budgets, mutes, prefs, facts you told Linky, last ask, channels
//   botUsers/{channel_chat} Telegram / WhatsApp chat -> uid
//   botLinks/{code}         short-lived codes that link a chat to an account
import crypto from 'node:crypto';
import { getAdmin, getDb } from './_firebaseAdmin.js';
import { geminiText, getGeminiKey, localRank, compactProfile } from './_gemini.js';

export const LIMITS = {
  free: { asksPerDay: 10, meetsPerDay: 3 },
  plus: { asksPerDay: 60, meetsPerDay: 100000 },
  inboundPerWeek: 5,
  introDays: 7,
  snoozeDays: 14,
  skipDays: 14,
  shortlist: 8,
  cardsPerAsk: 5,
  askCacheHours: 12,
};
export const OFFERS = ['paid', 'equity', 'advisory', 'coffee'];
export const CRON_UID = 'linky-cron';
export const APP_URL = 'https://linkup-muqu.vercel.app';
const LINKY_FROM = { fromId: 'linky-ai', fromName: 'Linky', fromPic: '' };
const DAY_MS = 86400000;

const db = () => getDb();
const FieldValue = () => getAdmin().firestore.FieldValue;
const nowTs = () => FieldValue().serverTimestamp();

export const dayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
export const weekKey = (ms = Date.now()) => {
  const d = new Date(ms);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-W${String(Math.ceil(((date - yearStart) / DAY_MS + 1) / 7)).padStart(2, '0')}`;
};
const toMillis = (v) => (v?.toMillis ? v.toMillis() : typeof v === 'number' ? v : v ? Date.parse(v) || 0 : 0);
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v, max, each = 60) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(/[,;\n]/) : [])
  .map((x) => text(x, each)).filter(Boolean).slice(0, max);
const hosted = (v) => { const s = text(v, 2048); return /^https?:\/\//i.test(s) && !s.startsWith('data:') ? s : ''; };
const uniq = (arr) => Array.from(new Set(arr));
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
export const isValidId = (id) => /^[a-zA-Z0-9_-]{1,128}$/.test(String(id || ''));

// Zero-token "understanding": common asks -> stems that actually appear on
// member profiles. Matching is substring-based, so a stem like "analy" catches
// analyst / analytics / analysis. Used only when the word-for-word pass finds
// nobody, and every card still cites the real profile fact it matched.
const CONCEPTS = [
  { aliases: ['math', 'maths', 'mathematics', 'mathematician', 'statistics', 'statistician', 'numbers', 'numerate', 'calculus', 'algebra'], stems: ['mathemat', 'statistic', 'data', 'analy', 'quant', 'actuar', 'financ', 'account', 'econom', 'physic', 'engineer', 'machine learning', 'tutor', 'teach', 'lectur', 'research'] },
  { aliases: ['developer', 'developers', 'dev', 'devs', 'programmer', 'programmers', 'coder', 'coders', 'engineer', 'engineers', 'software', 'coding', 'code', 'techie', 'technical', 'cto', 'tech'], stems: ['software', 'develop', 'engineer', 'program', 'coder', 'coding', 'flutter', 'react', 'node', 'python', 'javascript', 'typescript', 'android', 'ios', 'web', 'backend', 'frontend', 'full stack', 'fullstack', 'mobile', 'app', 'java', 'php', 'laravel', 'django', 'firebase', 'cto'] },
  { aliases: ['designer', 'designers', 'design', 'ux', 'ui', 'graphics', 'illustrator', 'branding'], stems: ['design', 'ui', 'ux', 'figma', 'graphic', 'brand', 'illustrat', 'creative', 'canva', 'adobe'] },
  { aliases: ['marketer', 'marketers', 'marketing', 'growth', 'seo', 'ads', 'advertising', 'promotion', 'influencer'], stems: ['market', 'growth', 'social media', 'content', 'brand', 'digital', 'seo', 'ads', 'campaign', 'communicat', 'influenc'] },
  { aliases: ['sales', 'salesperson', 'seller', 'sellers', 'bd', 'closer', 'partnerships', 'revenue'], stems: ['sales', 'business development', 'bd', 'partnership', 'account manag', 'revenue', 'commercial', 'distribut'] },
  { aliases: ['investor', 'investors', 'angel', 'angels', 'vc', 'vcs', 'funding', 'fund', 'raise', 'raised', 'capital', 'money', 'financing', 'backers'], stems: ['invest', 'angel', 'venture', 'vc', 'capital', 'fund', 'financ', 'equity', 'portfolio', 'accelerat', 'incubat'] },
  { aliases: ['lawyer', 'lawyers', 'legal', 'attorney', 'attorneys', 'compliance', 'contracts', 'regulation', 'regulatory'], stems: ['law', 'legal', 'attorney', 'complian', 'contract', 'regulat', 'intellectual property', 'paralegal'] },
  { aliases: ['accountant', 'accountants', 'accounting', 'finance', 'cfo', 'bookkeeper', 'bookkeeping', 'tax', 'audit', 'auditor', 'treasury'], stems: ['account', 'financ', 'cfo', 'bookkeep', 'tax', 'audit', 'treasur', 'chartered', 'acca'] },
  { aliases: ['doctor', 'doctors', 'medical', 'health', 'healthcare', 'healthtech', 'nurse', 'nurses', 'clinic', 'pharmacist', 'pharmacy'], stems: ['health', 'medic', 'doctor', 'clinic', 'pharma', 'nurs', 'hospital', 'patient', 'telemedic'] },
  { aliases: ['farmer', 'farmers', 'agriculture', 'agritech', 'farming', 'agro', 'agribusiness', 'crops', 'livestock', 'poultry'], stems: ['agri', 'farm', 'crop', 'livestock', 'horticult', 'food', 'poultry', 'irrigat', 'soil'] },
  { aliases: ['fintech', 'payments', 'payment', 'banking', 'bank', 'banker', 'remittance', 'remittances', 'insurance', 'insurtech', 'lending', 'loans', 'microfinance', 'ecocash', 'wallet'], stems: ['fintech', 'payment', 'ecocash', 'mobile money', 'bank', 'wallet', 'remittance', 'lending', 'loan', 'insur', 'microfinance', 'credit'] },
  { aliases: ['ai', 'ml', 'llm', 'llms', 'chatbot', 'chatbots', 'automation', 'genai'], stems: ['ai', 'artificial intelligence', 'machine learning', 'data scien', 'llm', 'nlp', 'deep learning', 'automat', 'chatbot', 'openai', 'gemini'] },
  { aliases: ['blockchain', 'crypto', 'web3', 'bitcoin', 'defi', 'nft', 'solidity', 'ethereum'], stems: ['blockchain', 'crypto', 'web3', 'bitcoin', 'defi', 'solidity', 'ethereum', 'token'] },
  { aliases: ['writer', 'writers', 'writing', 'copywriter', 'copywriting', 'journalist', 'journalism', 'content', 'editor', 'blogger', 'author'], stems: ['writ', 'content', 'copywrit', 'journalis', 'editor', 'blog', 'author', 'storytell'] },
  { aliases: ['video', 'videographer', 'photographer', 'photography', 'filmmaker', 'film', 'youtuber', 'creator', 'creators', 'editing'], stems: ['video', 'photograph', 'film', 'edit', 'content creat', 'youtube', 'cinemat', 'camera', 'podcast'] },
  { aliases: ['teacher', 'teachers', 'tutor', 'tutors', 'education', 'edtech', 'lecturer', 'professor', 'trainer', 'training', 'school', 'academic'], stems: ['educat', 'edtech', 'teach', 'tutor', 'lectur', 'school', 'train', 'curricul', 'professor', 'academ', 'universit'] },
  { aliases: ['operations', 'ops', 'coo', 'logistics', 'supply', 'procurement', 'admin', 'administrator'], stems: ['operation', 'logistic', 'supply chain', 'project manag', 'process', 'coo', 'admin', 'procure'] },
  { aliases: ['hr', 'recruiter', 'recruiters', 'recruiting', 'recruitment', 'talent', 'hiring', 'headhunter'], stems: ['hr', 'recruit', 'talent', 'people', 'human resource', 'hiring'] },
  { aliases: ['cofounder', 'co-founder', 'cofounders', 'co-founders', 'founder', 'founders', 'partner', 'partners', 'entrepreneur', 'entrepreneurs', 'startup', 'startups'], stems: ['founder', 'co-founder', 'cofounder', 'ceo', 'entrepreneur', 'startup', 'building'] },
  { aliases: ['mentor', 'mentors', 'advisor', 'advisors', 'adviser', 'advisory', 'coach', 'coaches', 'consultant', 'consultants', 'expert', 'experts', 'veteran', 'experienced'], stems: ['mentor', 'advis', 'coach', 'consult', 'experienced', 'senior', 'veteran', 'expert', 'director', 'head of', 'years'] },
  { aliases: ['ecommerce', 'e-commerce', 'retail', 'retailer', 'shop', 'store', 'marketplace', 'fmcg', 'wholesale'], stems: ['ecommerce', 'e-commerce', 'retail', 'shop', 'store', 'marketplace', 'fmcg', 'wholesale', 'merchant'] },
  { aliases: ['property', 'realtor', 'estate', 'construction', 'builder', 'architect', 'architecture', 'housing', 'proptech', 'contractor'], stems: ['real estate', 'property', 'construct', 'architect', 'housing', 'proptech', 'civil', 'quantity survey'] },
  { aliases: ['solar', 'energy', 'renewable', 'renewables', 'electricity', 'power', 'electrician', 'battery', 'batteries'], stems: ['solar', 'energy', 'renewable', 'power', 'electric', 'battery', 'grid', 'inverter'] },
  { aliases: ['transport', 'transportation', 'delivery', 'deliveries', 'courier', 'fleet', 'mobility', 'driver', 'drivers', 'trucking'], stems: ['transport', 'logistic', 'deliver', 'fleet', 'mobility', 'ride', 'courier', 'truck'] },
  { aliases: ['music', 'musician', 'musicians', 'artist', 'artists', 'producer', 'producers', 'dj', 'entertainment', 'entertainer'], stems: ['music', 'artist', 'producer', 'creative', 'entertain', 'dj', 'sound', 'studio'] },
  { aliases: ['gaming', 'game', 'games', 'gamedev', 'esports', 'unity'], stems: ['game', 'gaming', 'unity', 'unreal', 'esport'] },
  { aliases: ['security', 'cybersecurity', 'cyber', 'hacker', 'hackers', 'infosec', 'pentester'], stems: ['cyber', 'security', 'infosec', 'pentest', 'soc', 'ethical hack'] },
  { aliases: ['devops', 'cloud', 'aws', 'azure', 'infrastructure', 'sysadmin', 'kubernetes', 'docker'], stems: ['devops', 'cloud', 'aws', 'azure', 'gcp', 'infrastructure', 'kubernetes', 'docker', 'sre', 'linux', 'network'] },
  { aliases: ['data', 'analyst', 'analysts', 'analytics', 'analysis', 'researcher', 'research', 'scientist', 'insights', 'excel', 'sql', 'dashboards'], stems: ['data', 'analy', 'sql', 'statistic', 'bi', 'dashboard', 'excel', 'research', 'power bi', 'tableau'] },
  { aliases: ['hardware', 'iot', 'electronics', 'robotics', 'mechanical', 'electrical', 'embedded', 'arduino', 'drones', 'drone', '3d'], stems: ['hardware', 'iot', 'embedded', 'electronic', 'robot', 'arduino', 'pcb', 'mechan', 'drone', 'manufactur', 'engineer'] },
  { aliases: ['student', 'students', 'graduate', 'graduates', 'intern', 'interns', 'internship', 'undergrad', 'university'], stems: ['student', 'universit', 'graduate', 'intern', 'campus', 'college', 'polytech'] },
  { aliases: ['pm', 'product', 'roadmap', 'scrum', 'agile'], stems: ['product', 'product manag', 'roadmap', 'scrum', 'agile', 'project manag'] },
  { aliases: ['mobile', 'android', 'ios', 'flutter', 'app', 'apps'], stems: ['mobile', 'android', 'ios', 'flutter', 'react native', 'kotlin', 'swift', 'app'] },
  { aliases: ['web', 'website', 'websites', 'frontend', 'wordpress', 'webflow', 'landing'], stems: ['web', 'react', 'next', 'vue', 'html', 'css', 'javascript', 'wordpress', 'frontend', 'website', 'webflow'] },
  { aliases: ['backend', 'api', 'apis', 'database', 'databases', 'server', 'servers'], stems: ['backend', 'api', 'node', 'python', 'django', 'laravel', 'php', 'java', 'database', 'sql', 'firebase', 'server'] },
  { aliases: ['ngo', 'ngos', 'nonprofit', 'non-profit', 'charity', 'grant', 'grants', 'donor', 'donors', 'impact', 'development'], stems: ['ngo', 'nonprofit', 'non-profit', 'impact', 'development', 'community', 'donor', 'grant', 'social enterprise', 'humanitarian'] },
  { aliases: ['tourism', 'travel', 'hospitality', 'hotel', 'hotels', 'safari', 'tour', 'tours'], stems: ['touris', 'travel', 'hospitality', 'hotel', 'safari', 'lodge', 'airbnb'] },
  { aliases: ['fashion', 'clothing', 'apparel', 'textile', 'tailor', 'beauty', 'cosmetics', 'salon', 'hair'], stems: ['fashion', 'cloth', 'apparel', 'textile', 'tailor', 'beauty', 'cosmetic', 'salon', 'hair', 'skincare'] },
  { aliases: ['mining', 'miner', 'miners', 'minerals', 'geologist', 'geology', 'gold', 'lithium'], stems: ['mining', 'mineral', 'geolog', 'gold', 'lithium', 'metallurg'] },
  { aliases: ['government', 'policy', 'civic', 'politics', 'political', 'diplomat', 'public'], stems: ['government', 'policy', 'public sector', 'regulat', 'civic', 'politic', 'parliament', 'municipal'] },
  { aliases: ['pr', 'media', 'press', 'events', 'event', 'communications', 'comms', 'publicist', 'mc'], stems: ['pr', 'public relations', 'communicat', 'media', 'press', 'event', 'broadcast', 'radio', 'tv'] },
  { aliases: ['export', 'exporter', 'import', 'importer', 'trade', 'trader', 'trading', 'customs', 'forex'], stems: ['export', 'import', 'trade', 'logistic', 'customs', 'wholesale', 'forex', 'commodit'] },
  { aliases: ['chef', 'cook', 'food', 'restaurant', 'catering', 'baker', 'bakery'], stems: ['food', 'chef', 'restaurant', 'cater', 'bak', 'kitchen', 'culinary', 'beverage'] },
  { aliases: ['sports', 'sport', 'fitness', 'gym', 'football', 'athlete', 'athletes', 'coaching'], stems: ['sport', 'fitness', 'gym', 'football', 'athlet', 'wellness', 'coach'] },
];
const CONCEPT_BY_ALIAS = new Map();
CONCEPTS.forEach((c) => c.aliases.forEach((a) => CONCEPT_BY_ALIAS.set(a, c)));

// Light stemming so "developers" finds "developer" and "designing" finds "design".
const stemVariants = (w) => {
  const out = [w];
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) out.push(w.slice(0, -1));
  if (w.length > 6 && w.endsWith('ing')) out.push(w.slice(0, -3));
  if (w.length > 5 && w.endsWith('ed')) out.push(w.slice(0, -2));
  if (w.length > 5 && w.endsWith('ers')) out.push(w.slice(0, -1));
  return uniq(out);
};

// Related stems for the ask, each remembering which word it came from.
export function expandTerms(tokensIn) {
  const out = [];
  const seen = new Set(tokensIn);
  for (const t of tokensIn) {
    for (const v of stemVariants(t)) {
      const c = CONCEPT_BY_ALIAS.get(v);
      if (!c) continue;
      for (const stem of c.stems) {
        if (seen.has(stem)) continue;
        seen.add(stem);
        out.push({ term: stem, from: t });
      }
    }
  }
  return out;
}

const STOP = new Set('me for up in a an the with and or to of is i my by on at who someone who can that this need want looking find help build some any people person good great experienced strong senior junior based from about into been are was be it its as please hi hey hello linky you your get give show connect introduce intro know anyone anybody there here have has do does would could should like want wants needs'.split(' '));
const tokens = (s) => uniq(String(s || '').toLowerCase().replace(/[^a-z0-9+#.\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

// ---------------------------------------------------------------- users
export async function loadUser(uid) {
  if (!isValidId(uid)) return null;
  const snap = await db().collection('users').doc(uid).get();
  return snap.exists ? { uid, ...snap.data() } : null;
}

export function displayNameOf(p) {
  const direct = text(p?.displayName, 100);
  if (direct && direct !== 'Builder' && direct !== 'New Builder') return direct;
  const full = text(p?.fullName || p?.name, 100);
  if (full) return full;
  const composed = [p?.firstName, p?.lastName].map((x) => text(x, 50)).filter(Boolean).join(' ');
  return composed || text(String(p?.email || '').split('@')[0], 60) || 'Builder';
}

export function profileFacts(p) {
  if (!p) return null;
  const pic = [p.profilePicUrl, p.photoURL, p.avatarUrl, p.profilePic, ...(Array.isArray(p.photos) ? p.photos : [])]
    .map(hosted).find(Boolean) || '';
  return {
    uid: String(p.uid || ''),
    name: displayNameOf(p),
    pic,
    role: text(p.occupation, 100),
    company: text(p.company, 120),
    city: text(p.city, 80),
    country: text(p.country, 80),
    skills: list(p.skills, 12),
    industries: list(p.industries, 8),
    lookingFor: list(p.lookingFor, 6),
    goals: text(p.goals, 300),
    bio: text(p.bio, 400),
    remoteOnly: !!p.remoteOnly,
  };
}

// What the member told Linky directly (editable on "What Linky knows about you").
export function toldFacts(state) {
  const f = state?.facts || {};
  return { notes: text(f.notes, 800), skills: list(f.skills, 20, 40), lookingFor: list(f.lookingFor, 10, 80), updatedAt: toMillis(f.updatedAt) || null };
}

// Profile facts + told facts, merged the way the matcher sees them.
function mergedFacts(p, state) {
  const base = profileFacts(p);
  if (!base) return null;
  const told = toldFacts(state);
  return {
    ...base,
    skills: uniq([...base.skills, ...told.skills]).slice(0, 24),
    lookingFor: uniq([...base.lookingFor, ...told.lookingFor]).slice(0, 12),
    bio: [base.bio, told.notes].filter(Boolean).join(' ').slice(0, 1200),
    notes: told.notes,
  };
}

const plusFromUserDoc = (u) => {
  const status = String(u?.subscriptionStatus || '').toLowerCase();
  if (['inactive', 'canceled', 'cancelled', 'expired', 'free'].includes(status)) return false;
  const plan = String(u?.plan || '').toLowerCase();
  const sub = String(u?.subscriptionPlan || '').toLowerCase();
  return !!u?.isPro || ['pro', 'plus'].includes(plan) || ['pro', 'plus'].includes(sub) ||
    u?.entitlements?.pro === true || u?.entitlements?.linkupPro === true || u?.entitlements?.linkupPlus === true;
};

export async function isPlusUser(uid, userDoc) {
  if (userDoc && plusFromUserDoc(userDoc)) return true;
  const snap = await db().collection('webSubscriptions').doc(uid).get().catch(() => null);
  const endsAt = toMillis(snap?.exists ? snap.data()?.plus?.endsAt : null);
  return endsAt > Date.now();
}

export async function loadState(uid) {
  const snap = await db().collection('linkyState').doc(uid).get();
  return snap.exists ? snap.data() : {};
}
const patchState = (uid, patch) => db().collection('linkyState').doc(uid).set(patch, { merge: true });

// ---------------------------------------------------------------- delivery
async function sendExpoPush(uid, { title, body, data }) {
  try {
    const snap = await db().collection('userPrivate').doc(uid).get();
    const tokens = uniq((snap.get('pushTokens') || []).filter((t) => /^Expo(nent)?PushToken\[/.test(String(t))));
    if (!tokens.length) return;
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body: String(body).slice(0, 180), data, sound: 'default', priority: 'high' }))),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.warn('[linky] push failed', err?.message || err);
  }
}

export function telegramWebhookSecret() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return '';
  const explicit = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  return explicit || crypto.createHash('sha256').update(`linky-telegram:${token}`).digest('hex').slice(0, 48);
}

// Idempotent: Telegram returns the current webhook, we only set it when it differs.
export async function ensureTelegramWebhook(baseUrl) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return { configured: false };
  const url = `${baseUrl}/api/telegram`;
  const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
  if (info?.result?.url === url) return { configured: true, url, changed: false };
  const set = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: telegramWebhookSecret(), allowed_updates: ['message', 'callback_query'], drop_pending_updates: false }),
    signal: AbortSignal.timeout(8000),
  }).then((r) => r.json()).catch((e) => ({ ok: false, description: String(e?.message || e) }));
  return { configured: true, url, changed: true, ok: !!set?.ok, description: set?.description || '' };
}

export async function sendTelegram(chatId, message) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token || !chatId) return false;
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: String(message).slice(0, 4000), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  return !!resp?.ok;
}

export async function sendWhatsApp(waId, message) {
  const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (!token || !phoneId || !waId) return false;
  const resp = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: waId, type: 'text', text: { preview_url: false, body: String(message).slice(0, 4000) } }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  return !!resp?.ok;
}

async function deliverToChannels(uid, message, state) {
  const channels = (state || (await loadState(uid)))?.channels || {};
  const jobs = [];
  if (channels.telegram) jobs.push(sendTelegram(channels.telegram, message));
  if (channels.whatsapp) jobs.push(sendWhatsApp(channels.whatsapp, message));
  await Promise.allSettled(jobs);
}

// One in-app notification + push (+ bot channels for the types worth a ping).
export async function notifyUser(uid, { type, content, from, requestId, matchId, pushTitle, channelText, state }) {
  const doc = {
    userId: uid,
    fromId: from?.uid || LINKY_FROM.fromId,
    fromName: from?.name || LINKY_FROM.fromName,
    fromPic: from?.pic || '',
    type,
    content: String(content).slice(0, 500),
    ...(requestId ? { requestId } : {}),
    ...(matchId ? { matchId } : {}),
    isRead: false,
    timestamp: nowTs(),
  };
  const ref = await db().collection('notifications').add(doc);
  await Promise.allSettled([
    sendExpoPush(uid, {
      title: pushTitle || 'Linky',
      body: content,
      data: { notificationId: ref.id, type, url: matchId ? `/chat/${matchId}` : '/linky', matchId: matchId || '', fromId: doc.fromId },
    }),
    channelText ? deliverToChannels(uid, channelText, state) : Promise.resolve(),
  ]);
  return ref.id;
}

// ---------------------------------------------------------------- ask parsing (no AI)
export function parseAsk(message) {
  const need = text(message, 300);
  const all = need.toLowerCase();
  let offer = '';
  if (/\b(pay|paid|paying|budget|\$|usd|salary|rate|hire|hiring|freelance|contract)\b/.test(all)) offer = 'paid';
  else if (/\b(equity|co-?founder|cofounder|shares|stake|partner)\b/.test(all)) offer = 'equity';
  else if (/\b(advis\w*|mentor\w*|guidance|coach\w*)\b/.test(all)) offer = 'advisory';
  else if (/\b(coffee|chat|casual|meet up|catch up|20 minutes|call)\b/.test(all)) offer = 'coffee';
  let location = '';
  const loc = all.match(/\b(?:in|from|based in|around|near)\s+([a-z][a-z\s]{2,30})\b/);
  if (loc) location = text(loc[1].split(/\s+(?:and|or|who|that|with|for|to|on|at|doing|building)\b/)[0], 60);
  const remote = !/\b(in person|in-person|local only|must be in|physically)\b/.test(all);
  const raw = tokens(need).filter((t) => !location || !location.toLowerCase().split(/\s+/).includes(t));
  const kws = uniq(raw.flatMap(stemVariants));
  return { need, offer, location, remote, tokens: kws, expanded: expandTerms(raw), norm: raw.slice().sort().join(' ') };
}

// ---------------------------------------------------------------- matching
export async function buildMatchContext() {
  const [pubSnap, stateSnap] = await Promise.all([
    db().collection('publicProfiles').limit(600).get(),
    db().collection('linkyState').limit(2000).get(),
  ]);
  const states = {};
  stateSnap.docs.forEach((d) => { states[d.id] = d.data(); });
  const candidates = pubSnap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((p) =>
    p.uid && !p.deleted && p.isVisible !== false && p.isStealthMode !== true && p.onboarded !== false &&
    !p.uid.startsWith('demo-') && !p.uid.startsWith('bot-') && p.uid !== 'linky-ai');
  return { candidates, states, week: weekKey(), day: dayKey() };
}

function candidateFacts(p, st) {
  const told = toldFacts(st);
  return {
    uid: p.uid,
    name: displayNameOf(p),
    pic: hosted(p.profilePic),
    role: text(p.occupation, 100),
    company: text(p.company, 120),
    city: text(p.city, 80),
    country: text(p.country, 80),
    skills: uniq([...list(p.skills, 12), ...told.skills]).slice(0, 20),
    industries: list(p.industries, 8),
    lookingFor: uniq([...list(p.lookingFor, 6), ...told.lookingFor]).slice(0, 10),
    bio: [text(p.bio, 240), told.notes].filter(Boolean).join(' ').slice(0, 700),
    remoteOnly: !!p.remoteOnly,
  };
}

// Cite-or-skip guard: the "why" must name something that is actually on the
// candidate's profile (or what they told Linky), otherwise the card is dropped.
function whyIsCited(why, c) {
  const w = String(why || '').toLowerCase();
  if (w.length < 12) return false;
  const facts = [c.name, ...c.skills, ...c.industries, ...c.lookingFor, c.role, c.company, c.city, c.country]
    .flatMap((f) => tokens(f)).filter((t) => t.length >= 3);
  const bioHits = tokens(c.bio).filter((t) => t.length >= 6);
  return [...facts, ...bioHits].some((t) => w.includes(t));
}

function keywordScore(q, c, terms = q.tokens, related = false) {
  const skills = c.skills.map((s) => s.toLowerCase());
  const inds = c.industries.map((s) => s.toLowerCase());
  const role = c.role.toLowerCase();
  const company = c.company.toLowerCase();
  const name = c.name.toLowerCase();
  const bio = c.bio.toLowerCase();
  const lf = c.lookingFor.map((s) => s.toLowerCase());
  const w = related ? 0.6 : 1;
  let score = 0;
  const hits = [];
  for (const kw of terms) {
    if (!related && name.includes(kw)) { score += 5; hits.push(kw); }
    if (skills.some((s) => s.includes(kw))) { score += 4 * w; hits.push(kw); }
    if (role.includes(kw)) { score += 3 * w; hits.push(kw); }
    if (!related && company.includes(kw)) { score += 2; hits.push(kw); }
    if (inds.some((s) => s.includes(kw))) { score += 2 * w; hits.push(kw); }
    if (lf.some((s) => s.includes(kw))) { score += 1 * w; }
    if (bio.includes(kw)) { score += 1 * w; hits.push(kw); }
  }
  const loc = String(q.location || '').toLowerCase();
  if (loc) {
    if (c.city && loc.includes(c.city.toLowerCase())) score += 3;
    else if (c.country && loc.includes(c.country.toLowerCase())) score += 1;
    else if (!q.remote) score -= 4;
  }
  if (c.pic) score += 0.5;
  return { score, hits: uniq(hits) };
}

function templateWhy(c, hits, relatedTo = '') {
  const where = c.city ? ` in ${c.city}` : '';
  const role = c.role ? `${/^[aeiou]/i.test(c.role) ? 'an' : 'a'} ${c.role}` : '';
  const close = relatedTo ? ` (close to "${relatedTo}")` : '';
  const has = (s) => hits.some((h) => String(s || '').toLowerCase().includes(h));
  if (!relatedTo && hits.length && has(c.name)) return `${c.name}${role ? ` is ${role}` : ' is on LINKUP'}${where}${c.company ? ` at ${c.company}` : ''}.`;
  const skillHit = c.skills.find(has);
  if (skillHit) return `${c.name} lists ${skillHit}${close}${role ? ` and works as ${role}` : ''}${where}.`;
  if (c.role && has(c.role)) return `${c.name} is ${role}${close}${where}${c.company ? ` at ${c.company}` : ''}.`;
  if (!relatedTo && c.company && has(c.company)) return `${c.name} works at ${c.company}${role ? ` as ${role}` : ''}${where}.`;
  const indHit = c.industries.find(has);
  if (indHit) return `${c.name} works in ${indHit}${close}${role ? ` as ${role}` : ''}${where}.`;
  const bioHit = hits.find((h) => c.bio.toLowerCase().includes(h));
  if (bioHit) return `${c.name}'s profile mentions "${bioHit}"${close}${role ? ` - ${role}` : ''}${where}.`;
  return '';
}

// Gemini expansion, only when neither the exact words nor the built-in
// concepts find anyone. Cached per normalised ask for 30 days, across all
// members, so a given ask costs at most one small call ever.
const cacheKey = (prefix, norm) => `${prefix}_${crypto.createHash('sha1').update(norm).digest('hex').slice(0, 32)}`;
async function aiExpandTerms(q) {
  if (!getGeminiKey()) return null;
  const ref = db().collection('linkyCache').doc(cacheKey('x', q.norm));
  const snap = await ref.get().catch(() => null);
  if (snap?.exists && Date.now() - toMillis(snap.data().createdAt) < 30 * DAY_MS) return snap.data().terms || [];
  const prompt = [
    `A member of LINKUP (a network of builders, founders and operators) asked: "${q.need}".`,
    'List up to 12 short lowercase terms (skills, roles, tools, industries, word stems) that would appear on the profile of someone able to help with that ask. Prefer stems ("analy", "financ") so plural and verb forms match. No explanations.',
    'Return STRICT JSON only: {"terms":["...", "..."]}',
  ].join('\n');
  const raw = await geminiText(prompt, { temperature: 0.2, maxOutputTokens: 160, responseMimeType: 'application/json' });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  const terms = uniq((Array.isArray(parsed?.terms) ? parsed.terms : []).map((t) => text(t, 30).toLowerCase()).filter((t) => t.length >= 3 && !STOP.has(t))).slice(0, 12);
  await ref.set({ need: q.need, terms, createdAt: Date.now() }).catch(() => {});
  return terms;
}

const templateOpener = (c, need) => `Hi ${firstName(c.name)} - Linky pointed me to you. I am looking for ${need}. Open to a quick chat?`;

// The only Gemini call in the ask flow. Compact on purpose.
async function geminiRerank(q, requester, shortlist) {
  if (!getGeminiKey()) return null;
  const prompt = [
    'You are Linky, the connector for LINKUP (builders, founders and operators, Harare-first).',
    `A member asked: "${q.need}"${q.offer ? ` (offer: ${q.offer})` : ''}${q.location ? ` (location: ${q.location}${q.remote ? ', remote fine' : ', in person'})` : ''}.`,
    'Pick which candidates are genuinely worth an introduction for that ask. Cite-or-skip: every "why" must quote a concrete fact from that candidate\'s record (a skill, role, company, city or bio detail). No evidence = leave them out. Never invent facts. Return an empty list rather than guess.',
    'Return STRICT JSON only: {"picks":[{"uid":"...","score":0-100,"why":"one plain sentence, under 26 words, citing the evidence","opener":"one friendly sentence the member could send, under 30 words"}]}',
    `At most ${Math.min(LIMITS.cardsPerAsk, shortlist.length)} picks, best first. Omit scores under 55.`,
    `Member: ${JSON.stringify(requester)}`,
    `Candidates: ${JSON.stringify(shortlist.map((c) => ({ uid: c.uid, name: c.name, role: c.role, company: c.company, city: c.city, skills: c.skills.slice(0, 8), industries: c.industries.slice(0, 5), lookingFor: c.lookingFor.slice(0, 4), bio: c.bio.slice(0, 160) })))}`,
  ].join('\n');
  const raw = await geminiText(prompt, { temperature: 0.2, maxOutputTokens: 700, responseMimeType: 'application/json' });
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const parsed = JSON.parse(raw.slice(start, end + 1));
  return Array.isArray(parsed?.picks) ? parsed.picks : [];
}

// Why a member is left out of someone's results ('' = eligible). Shared by the
// matcher and by name lookups, so "fred" can say exactly why Fred is not shown.
function exclusionReason(p, uid, myState, ctx, latestByTarget, q, now = Date.now()) {
  if (p.uid === uid) return 'self';
  if (myState?.muted && myState.muted[p.uid]) return 'muted';
  const prev = latestByTarget.get(p.uid);
  if (prev && prev.status === 'declined') return 'declined';
  if (prev && prev.status === 'skip' && now - toMillis(prev.updatedAt || prev.createdAt) < LIMITS.skipDays * DAY_MS) return 'skipped';
  const st = ctx.states[p.uid] || {};
  if (st.muted && st.muted[uid]) return 'theyMuted';
  if (q.offer && Array.isArray(st.openTo) && st.openTo.length && !st.openTo.includes(q.offer)) return 'openTo';
  const cap = Number.isFinite(Number(st.inboundCap)) ? Number(st.inboundCap) : LIMITS.inboundPerWeek;
  if (cap <= 0) return 'closed';
  if (st.inbound?.week === ctx.week && Number(st.inbound?.count || 0) >= cap) return 'inboundCap';
  return '';
}

// Who on LINKUP fits this ask, right now. Returns ranked picks (with cited
// "why"), the nearest people when nobody fits, and how many members were checked.
export async function findPeople(uid, q, ctx, { user, state, existingCards = [] } = {}) {
  const owner = user || (await loadUser(uid));
  const myState = state || ctx.states[uid] || {};
  const me = mergedFacts(owner, myState) || { uid, name: 'Member', skills: [], industries: [], lookingFor: [], bio: '', notes: '' };
  const now = Date.now();
  const latestByTarget = new Map();
  existingCards.forEach((c) => latestByTarget.set(c.targetUid, c));
  const eligible = [];
  for (const p of ctx.candidates) {
    if (exclusionReason(p, uid, myState, ctx, latestByTarget, q, now)) continue;
    eligible.push(candidateFacts(p, ctx.states[p.uid] || {}));
  }
  const checked = ctx.candidates.filter((p) => p.uid !== uid).length;
  const scan = (terms, related) => {
    const out = [];
    for (const facts of eligible) {
      const { score, hits } = keywordScore(q, facts, terms, related);
      if (score <= 0 || !hits.length) continue;
      out.push({ facts, score, hits });
    }
    return out;
  };
  // Pass 1: the member's own words. Pass 2: built-in related concepts (zero
  // tokens). Pass 3: one small Gemini expansion, cached. Never more than one
  // Gemini call per ask: if pass 3 ran, the rerank below is skipped.
  let pool = scan(q.tokens, false);
  let expansion = 'none';
  let relatedTo = '';
  let usedAi = false;
  if (!pool.length && q.expanded.length) {
    pool = scan(q.expanded.map((e) => e.term), true);
    if (pool.length) { expansion = 'local'; relatedTo = uniq(q.expanded.map((e) => e.from)).join(' '); }
  }
  if (!pool.length && q.tokens.length) {
    try {
      const terms = await aiExpandTerms(q);
      if (Array.isArray(terms)) {
        usedAi = true;
        if (terms.length) {
          pool = scan(terms, true);
          if (pool.length) { expansion = 'ai'; relatedTo = q.tokens.filter((t) => t.length > 3).slice(0, 3).join(' ') || q.need.slice(0, 40); }
        }
      }
    } catch (err) {
      console.warn('[linky] ai expansion failed', err?.message || err);
    }
  }
  if (!pool.length) return { picks: [], nearest: nearestPeople(me, q, eligible), checked, usedAi, expansion: 'none' };

  // Blend keyword fit with profile compatibility, then shortlist.
  const compat = new Map(localRank(compactProfile({ ...owner, uid, skills: me.skills }), pool.map((x) => compactProfile({ ...x.facts, occupation: x.facts.role })), pool.length).map((r) => [r.uid, r.score]));
  pool.forEach((x) => { x.blend = x.score * 10 + ((compat.get(x.facts.uid) || 40) - 40) * 0.5; });
  pool.sort((a, b) => b.blend - a.blend);
  const shortlist = pool.slice(0, LIMITS.shortlist);
  const byUid = new Map(shortlist.map((x) => [x.facts.uid, x]));

  let picks = null;
  if (shortlist.length >= 2 && !usedAi) {
    try {
      picks = await geminiRerank(q, { role: me.role, company: me.company, city: me.city, skills: me.skills.slice(0, 8), notes: (me.notes || me.bio || '').slice(0, 160) }, shortlist.map((x) => x.facts));
      usedAi = Array.isArray(picks);
    } catch (err) {
      console.warn('[linky] gemini rerank failed, using cited template path', err?.message || err);
      picks = null;
    }
  }
  const chosen = [];
  if (Array.isArray(picks)) {
    for (const p of picks) {
      const x = byUid.get(String(p?.uid || ''));
      if (!x || chosen.some((c) => c.facts.uid === x.facts.uid)) continue;
      const score = Math.round(Number(p?.score || 0));
      const why = text(p?.why, 220);
      if (score < 55 || !whyIsCited(why, x.facts)) continue;
      chosen.push({ facts: x.facts, score, why, opener: text(p?.opener, 240) || templateOpener(x.facts, q.need) });
    }
  }
  if (!chosen.length) {
    // Template path: no key, Gemini down/over quota, one candidate, or AI cited nothing.
    for (const x of shortlist) {
      const why = templateWhy(x.facts, x.hits, relatedTo);
      if (!why || x.score < (relatedTo ? 1.5 : 3)) continue;
      chosen.push({ facts: x.facts, score: Math.max(55, Math.min(95, 50 + Math.round(x.blend))), why, opener: templateOpener(x.facts, q.need) });
    }
  }
  return { picks: chosen.slice(0, LIMITS.cardsPerAsk), nearest: [], checked, usedAi, expansion, relatedTo };
}

// When nobody fits: the 3 most adjacent people (same city as the ask or the
// member, shared skills / industries). Shown as profiles, never as intros.
function nearestPeople(me, q, eligible) {
  const askLoc = String(q.location || '').toLowerCase();
  const askLocKnown = !!askLoc && eligible.some((c) => c.city && askLoc.includes(c.city.toLowerCase()));
  // No city in the ask = nothing honest to call "nearest" (it used to be the
  // same three same-city people for every miss). Only same-city-as-the-ask.
  if (!askLocKnown) return [];
  const loc = askLoc;
  const compat = new Map(localRank(compactProfile({ uid: me.uid, role: me.role, skills: me.skills, industries: me.industries, goals: me.lookingFor }), eligible.map((c) => compactProfile({ ...c, occupation: c.role })), eligible.length).map((r) => [r.uid, r.score]));
  return eligible
    .map((c) => ({ c, s: (loc && c.city && loc.includes(c.city.toLowerCase()) ? 3 : 0) + ((compat.get(c.uid) || 40) - 40) / 10 + (c.pic ? 0.25 : 0) + (c.role ? 0.25 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(({ c }) => ({ uid: c.uid, name: c.name, pic: c.pic, role: c.role, city: [c.city, c.country].filter(Boolean).join(', ') }));
}

// ---------------------------------------------------------------- personality (zero tokens)
const rotate = (arr, seed = Math.floor(Date.now() / 900)) => arr[Math.abs(Number(seed) || 0) % arr.length];
const offerLabel = (o) => ({ paid: 'paid work', equity: 'equity', advisory: 'advisory', coffee: 'a coffee' }[o] || o);

// Greetings, thanks, "who are you", banter: answered in Linky's voice without a
// model call and without touching the ask budget. Returns '' when the message
// is a real ask.
export function smallTalk(message, name = '', { source = 'app' } = {}) {
  const m = String(message || '').toLowerCase().replace(/[^a-z0-9'?!\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!m) return '';
  const words = m.split(' ');
  if (words.length > 9) return '';
  const first = firstName(name);
  const who = first === 'there' ? '' : `, ${first}`;
  const is = (re) => re.test(m);
  if (is(/^(hi|hii+|hello|helo|hey|heyy+|yo|yoh|sup|wassup|whats up|what's up|howdy|hola|mhoro|makadii|mangwanani|masikati|manheru|good (morning|afternoon|evening|day)|greetings|morning|evening)( there| linky| bro| man| bot| guys| team)?[!?.]*$/)) {
    return rotate([
      `Hey${who}. Who do you need? Give me a role and a city and I will pull the people on LINKUP who actually fit.`,
      `Hi${who}. I am the connector around here - tell me who you need and I will find them, or tell you straight that nobody fits yet.`,
      `Yo${who}. A name, a skill or a role - say who you need and I get to work.`,
    ]);
  }
  if (is(/^(how are you|how r u|how are u|how is it going|how's it going|hows it going|how are things|you good|u good|are you (ok|okay|good|fine)|how you doing|how are you doing)\b/)) {
    return rotate([
      `Good - I have been reading profiles all day, which is my idea of fun. Who can I find for you${who}?`,
      `Never better. Someone joined LINKUP this week that someone else needs - maybe you. Who do you need?`,
    ]);
  }
  if (is(/^(thanks|thank you|thankyou|thx|tnx|ty|cheers|appreciate it|appreciated|much appreciated|ndatenda|maita basa)\b/) || (words.length <= 4 && is(/\b(thanks|thank you)\b/))) {
    return rotate([`Anytime${who}. Come back when you need the next person.`, `That is what I am here for. Next intro?`, `No stress. Say the word when you need someone else.`]);
  }
  if (is(/\b(who are you|what are you|are you (a |an )?(bot|human|ai|robot|person|real)|your name|what is linky|who is linky|what's linky)\b/)) {
    return `I am Linky - LINKUP's connector. I read every member profile, and when you ask for someone I answer with the people I can cite a real reason for. No guessing, no filler matches. Try me: "a fintech lawyer in Harare", or just a name.`;
  }
  if (is(/\b(what can you do|what do you do|how do you work|how does this work|how do i use|how to use|what is this|what can i ask|help me out|show me how)\b/) || m === 'help' || m === '?') {
    return `Three things. 1) Ask for a person by role, skill or name - "a Flutter developer in Harare", "someone who understands math", "Luke Tembani" - and I answer right away with cards I can cite. 2) ${source === 'app' ? 'Tap Meet' : 'Reply "meet 1"'} and I ask them for you (double opt-in, they can say no). 3) If nobody on LINKUP fits, ${source === 'app' ? 'tap "Search outside LINKUP"' : 'reply OUTSIDE'} and I pull real public profiles from the open web.`;
  }
  if (is(/^(ok|okay|k|kk|cool|nice|great|good|alright|aight|fine|sure|lol|lmao|haha|hahaha|wow|noted|got it|i see|makes sense|sharp|sweet|perfect|awesome)( then| thanks| linky| bro| cool)?[!.]*$/)) {
    return rotate([`Cool. Who is next?`, `Good. I am here when you need a person.`, `Noted. A role and a city, whenever you are ready.`]);
  }
  if (is(/\b(no personality|boring|useless|dumb|stupid|robotic|you suck|rubbish|trash|annoying|not helpful|bad bot)\b/)) {
    return rotate([
      `Fair hit${who}. I would rather be useful than charming - give me a real ask and I will show you which one I am.`,
      `Ouch. Taken on the chin. Now tell me who you need and let me redeem myself.`,
    ]);
  }
  if (is(/^(bye|goodbye|good night|goodnight|see you|see ya|later|cya|ttyl|gtg)\b/)) return rotate([`Later${who}. I will keep an eye on who joins.`, `Bye. Ping me the moment you need someone.`]);
  if (is(/\b(tell me a joke|a joke|joke|make me laugh|something funny)\b/)) return `A founder walks into a room of builders and asks for "someone technical". That is not a joke, that is my Tuesday. Be specific and I am very good.`;
  if (is(/^(yes|yeah|yep|yup|no|nope|nah|maybe)[!.]*$/)) return `To what${who}? Give me a name or a role and I will move.`;
  if (is(/\b(i love you|love you|marry me|you are (the best|amazing|great|awesome))\b/)) return `Careful, I fall fast. Now - who do you need?`;
  return '';
}

// "send a message to fred" / "who is luke tembani" / "@tanaka" -> ["fred"] etc.
const NAME_STOP = new Set([...STOP, 'send', 'message', 'msg', 'text', 'dm', 'ping', 'contact', 'reach', 'talk', 'speak', 'chat', 'meet', 'meeting', 'intro', 'introduce', 'introduction', 'connect', 'connection', 'link', 'find', 'look', 'search', 'show', 'open', 'profile', 'tell', 'about', 'info', 'details', 'pls', 'plz', 'want', 'wanna', 'need', 'know', 'does', 'do', 'whats', 'what', 'where', 'when', 'call', 'him', 'her', 'them', 'guy', 'lady', 'person', 'member', 'user', 'account', 'linkup', 'named', 'called', 'name', 'someone', 'somebody', 'one', 'the', 'please', 'mr', 'mrs', 'ms', 'dr']);
export function nameQueryWords(message) {
  const raw = String(message || '').toLowerCase().replace(/[^a-z0-9@'\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const all = raw.split(' ').filter(Boolean);
  if (!all.length || all.length > 8) return [];
  const words = all.map((w) => w.replace(/^@/, '')).filter((w) => w.length >= 2 && !NAME_STOP.has(w) && !/^\d+$/.test(w));
  if (!words.length || words.length > 4) return [];
  return words;
}
const nameParts = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).filter(Boolean);
const isNamed = (words, name) => words.length > 0 && words.every((w) => nameParts(name).some((pt) => pt === w || (w.length >= 4 && pt.startsWith(w))));
export function nameMatches(words, candidates, uid) {
  if (!words.length) return [];
  const phrase = words.join(' ');
  const out = [];
  for (const p of candidates) {
    if (p.uid === uid) continue;
    const name = displayNameOf(p);
    const parts = nameParts(name);
    if (!parts.length || name === 'Builder') continue;
    const full = parts.join(' ');
    const handle = String(p.username || '').toLowerCase();
    let score = 0;
    if (phrase === full) score = 10;
    else if (words.length >= 2 && full.includes(phrase)) score = 8;
    else if (isNamed(words, name)) score = 6 + words.length;
    if (handle && words.includes(handle)) score = Math.max(score, 9);
    if (score >= 6) out.push({ p, score, name });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

const personLine = (c) => `${c.name}${c.role ? ` is ${/^[aeiou]/i.test(c.role) ? 'an' : 'a'} ${c.role}` : ' is on LINKUP'}${c.company ? ` at ${c.company}` : ''}${c.city ? ` in ${c.city}` : c.country ? ` in ${c.country}` : ''}.`;
const nameOpener = (c) => `Hi ${firstName(c.name)}, Linky pointed me to you on LINKUP. Open to a quick chat this week?`;

function excludedLine(c, reason, prev, q, now) {
  const base = `${c.name} is on LINKUP${c.role ? ` (${c.role})` : ''}, but `;
  switch (reason) {
    case 'skipped': {
      const days = Math.max(1, Math.round((now - toMillis(prev?.updatedAt || prev?.createdAt)) / DAY_MS));
      return `${base}you skipped their card ${days === 1 ? 'yesterday' : `${days} days ago`}, so I keep them out of your results. Say "unskip ${firstName(c.name)}" and they are back.`;
    }
    case 'declined': return `${base}they declined your intro earlier, and I never push twice. Their profile is still open to you.`;
    case 'theyMuted': return `${base}they are not taking intros from you right now, so I will not ask them again.`;
    case 'muted': return `${base}you declined their intro request earlier, so I keep you two apart. Their profile is still there if you change your mind.`;
    case 'openTo': return `${base}they are not open to ${offerLabel(q.offer)} at the moment. Ask without the "${q.offer}" angle and I can still introduce you.`;
    case 'closed': return `${base}they have switched intros off for now.`;
    case 'inboundCap': return `${base}their intro inbox is full this week (members cap it). Ask me again next week, or open their profile now.`;
    default: return `${base}I cannot reach them for you right now.`;
  }
}

function nameReply(open, blocked, q, source, now) {
  const lines = [];
  if (open.length === 1) {
    const c = open[0].facts;
    const bits = [c.role, c.company ? `at ${c.company}` : '', c.city || c.country ? `in ${c.city || c.country}` : ''].filter(Boolean).join(' ');
    const skills = c.skills.slice(0, 3).join(', ');
    lines.push(`${firstName(c.name)}? Yes - ${c.name} is on LINKUP${bits ? `: ${bits}` : ''}${skills ? `. Skills: ${skills}` : ''}. ${source === 'app' ? 'Tap Meet and I will ask them for you, or tap the card for the full profile.' : 'Reply "meet 1" and I will ask them for you.'}`);
  } else if (open.length > 1) {
    lines.push(`${open.length} people on LINKUP answer to that - which one did you mean? ${source === 'app' ? 'The cards are below.' : 'Reply "meet 1", 2 or 3 once you know.'}`);
  }
  for (const b of blocked) lines.push(excludedLine(b.facts, b.reason, b.prev, q, now));
  return lines.join('\n');
}

// ---------------------------------------------------------------- ask (the whole flow, one request)
const COACH = 'Give me a person, a role or a skill and I will get to work - "a Flutter developer in Harare, paid", "a co-founder with sales experience", "someone who understands math", or just a name like "Luke Tembani".';

function askReply(q, picks, nearest, checked, source = 'app', expansion = 'none', relatedTo = '', seq = 0) {
  const need = q.need;
  if (picks.length) {
    const loc = q.location.toLowerCase();
    const inLoc = !loc || picks.some((p) => `${p.facts.city} ${p.facts.country}`.toLowerCase().includes(loc));
    const where = inLoc ? '' : ` None of them is in ${q.location}, so these are people who could work with you remotely.`;
    const cta = source === 'app' ? ' Tap Meet and I will ask them for you.' : ' Reply "meet 1" (or 2, 3...) and I will ask them.';
    const n = picks.length;
    const count = n === 1 ? 'one person' : `${n} people`;
    if (expansion !== 'none') {
      return `Nobody lists "${relatedTo || need}" word for word, but ${count} ${n === 1 ? 'is' : 'are'} close - each card names the real skill or role I matched.${where}${cta}`;
    }
    if (n === 1) {
      return rotate([
        `Found one person for "${need}" - the card says exactly why.${where}${cta}`,
        `One person on LINKUP fits "${need}", and I can cite why.${where}${cta}`,
        `Here is who I have for "${need}": one person, reason on the card.${where}${cta}`,
      ], seq);
    }
    return rotate([
      `Found ${count} for "${need}" - each card says exactly why.${where}${cta}`,
      `${n} people on LINKUP fit "${need}", and I can cite why for each.${where}${cta}`,
      `Here is who I have for "${need}": ${count}, reasons on the cards.${where}${cta}`,
    ], seq);
  }
  const nearCity = nearest.length ? String(nearest[0].city || q.location).split(',')[0] : '';
  const near = nearest.length ? ` In ${nearCity} I do have ${nearest.map((x) => x.name).join(', ')} - different skills, but they may know who.` : '';
  const outside = source === 'app' ? ' Tap "Search outside LINKUP" and I will pull real public profiles for this.' : ' Reply OUTSIDE and I will search the open web for real profiles.';
  return rotate([
    `Nobody on LINKUP does "${need}" yet - and I would rather say that than guess. I read all ${checked} member profiles, related skills included.${near}${outside}`,
    `Straight answer: no one on LINKUP fits "${need}" right now. ${checked} profiles checked, related skills too.${near}${outside}`,
    `"${need}" - not on LINKUP yet. I went through all ${checked} members and the skills next to that one.${near}${outside}`,
    `I came up empty for "${need}", and I do not pad results. That is after ${checked} profiles and their related skills.${near}${outside}`,
  ], seq);
}

// Where to look when LINKUP does not have the person: one small Gemini call,
// cached per ask for 7 days across members; a static answer when there is no
// key. Only for asks the member actually made (bounded by the ask budget).
export async function pointers(uid, need, { userDoc } = {}) {
  const user = userDoc || (await loadUser(uid));
  const q = parseAsk(need);
  if (!q.tokens.length) throw new Error('Ask me who you need first.');
  const state = await loadState(uid);
  const known = [state.lastAsk, ...(Array.isArray(state.recentAsks) ? state.recentAsks : []), ...(Array.isArray(state.askHistory) ? state.askHistory : [])]
    .filter(Boolean).some((a) => (a.norm ? a.norm === q.norm : parseAsk(a.need || '').norm === q.norm));
  if (!known) throw new Error('Ask me that first, then I can point you outside LINKUP.');
  const ref = db().collection('linkyCache').doc(cacheKey('p', q.norm));
  const snap = await ref.get().catch(() => null);
  if (snap?.exists && Date.now() - toMillis(snap.data().createdAt) < 7 * DAY_MS) return { text: snap.data().text, cached: true };
  const me = profileFacts(user) || {};
  const place = q.location || [me.city, me.country].filter(Boolean).join(', ') || 'Zimbabwe';
  let out = '';
  if (getGeminiKey()) {
    try {
      const prompt = [
        `You are Linky, the connector for LINKUP. A member in ${place} asked for "${q.need}" and nobody on LINKUP fits yet.`,
        'In under 90 words of plain text (no markdown, no bullet symbols), give 3 concrete places or ways to find such a person outside LINKUP that are realistic for that location (specific kinds of institutions, professional bodies, communities, platforms and the exact search phrase to use). Then one short outreach message they could send. Never name private individuals. Do not mention that you are an AI.',
      ].join('\n');
      out = text(await geminiText(prompt, { temperature: 0.4, maxOutputTokens: 260 }), 900);
    } catch (err) {
      console.warn('[linky] pointers gemini failed', err?.message || err);
    }
  }
  if (!out) {
    const terms = q.tokens.filter((t) => t.length > 3).slice(0, 3).join(' ') || q.need;
    out = `Outside LINKUP, three quick routes for "${q.need}": 1) LinkedIn - search "${terms}" together with "${place}" and filter by location, then message the two most active people. 2) The university department or professional body for that field in ${place} - they always know who is doing the work right now. 3) The WhatsApp or Telegram communities for that field - ask for one referral, not a list. Outreach line: "Hi, I am building in ${place} and looking for ${q.need}. Could we talk for 15 minutes this week?"`;
  }
  await ref.set({ need: q.need, text: out, createdAt: Date.now() }).catch(() => {});
  return { text: out, cached: false };
}

const newAskId = (now) => `${now.toString(36)}${crypto.randomBytes(2).toString('hex')}`;

// Persist cards (reuse a live card for the same person instead of duplicating it).
async function persistCards(uid, existing, picks, q, now, askId) {
  const latestByTarget = new Map();
  existing.forEach((c) => latestByTarget.set(c.targetUid, c));
  const resultCards = [];
  const updatedIds = new Set();
  const created = [];
  picks.forEach(({ facts, score, why, opener }, i) => {
    const prev = latestByTarget.get(facts.uid);
    if (prev && ['new', 'saved', 'meet'].includes(prev.status)) {
      const next = { ...prev, askId, need: q.need, why: prev.status === 'meet' ? prev.why : why, opener: prev.opener || opener, score, updatedAt: now };
      updatedIds.add(prev.id);
      resultCards.push(next);
      return;
    }
    const card = {
      id: `${askId.slice(0, 6)}_${facts.uid.slice(0, 8)}_${i}`,
      askId,
      need: q.need,
      targetUid: facts.uid,
      targetName: facts.name,
      targetPic: facts.pic,
      targetRole: facts.role,
      targetCompany: facts.company,
      targetCity: [facts.city, facts.country].filter(Boolean).join(', '),
      targetSkills: facts.skills.slice(0, 5),
      why,
      opener,
      score,
      status: 'new',
      createdAt: now,
      updatedAt: now,
    };
    created.push(card);
    resultCards.push(card);
  });
  const updatedById = new Map(resultCards.filter((c) => updatedIds.has(c.id)).map((c) => [c.id, c]));
  const keep = existing.map((c) => updatedById.get(c.id) || c).filter((c) => now - toMillis(c.createdAt) < 30 * DAY_MS).slice(-60);
  if (created.length || updatedIds.size) {
    await db().collection('introSuggestions').doc(uid).set({ cards: [...keep, ...created], updatedAt: nowTs(), newSince: now }, { merge: true });
  }
  return resultCards;
}

export async function ask(uid, message, { userDoc, source = 'app' } = {}) {
  const user = userDoc || (await loadUser(uid));
  if (!user) throw new Error('Finish your LINKUP profile first.');
  const msg = text(message, 600);
  if (!msg) throw new Error('Say something first.');
  const me = profileFacts(user) || {};
  const now = Date.now();
  const state = await loadState(uid);
  const plus = await isPlusUser(uid, user);
  const limits = plus ? LIMITS.plus : LIMITS.free;
  const today = dayKey(now);
  const used = state.asks?.day === today ? Number(state.asks.count || 0) : 0;
  const left = Math.max(0, limits.asksPerDay - used);
  const quick = (reply, kind, extra = {}) => ({ id: '', need: msg, reply, cards: [], nearest: [], none: true, checked: 0, expansion: 'none', kind, createdAt: now, cached: false, usedAi: false, asksLeft: left, ...extra });

  // 1. Small talk, thanks, "who are you": in character, zero tokens, no budget.
  const chat = smallTalk(msg, me.name, { source });
  if (chat) return quick(chat, 'chat');

  // 2. "unskip fred": bring a skipped person back into results.
  const un = msg.match(/^(?:unskip|un-skip|bring back|restore)\s+(.{2,60})$/i);
  if (un) {
    const words = nameQueryWords(un[1]);
    const cards = await loadCards(uid);
    const hitIds = cards.filter((c) => c.status === 'skip' && isNamed(words, c.targetName)).map((c) => c.id);
    if (!hitIds.length) return quick(`Nothing to unskip for "${un[1]}" - I have no skipped card with that name.`, 'chat');
    const next = cards.map((c) => (hitIds.includes(c.id) ? { ...c, status: 'new', updatedAt: now } : c));
    await db().collection('introSuggestions').doc(uid).set({ cards: next, updatedAt: nowTs() }, { merge: true });
    const names = uniq(cards.filter((c) => hitIds.includes(c.id)).map((c) => c.targetName)).join(', ');
    return quick(`Done - ${names} ${hitIds.length === 1 ? 'is' : 'are'} back in your results. Ask for them again whenever.`, 'chat');
  }

  const q = parseAsk(msg);
  let ctx = null;
  let existing = null;

  // 3. A person by name: "fred", "Luke Tembani", "send a message to fred", "who is tanaka".
  //    Free (no budget, no tokens); says exactly why someone is hidden.
  const words = nameQueryWords(msg);
  if (words.length) {
    if (isNamed(words, me.name)) return quick(`That is you, ${firstName(me.name)}. I know you already - tell me who you need and I will find them.`, 'chat');
    ctx = await buildMatchContext();
    const named = nameMatches(words, ctx.candidates, uid);
    if (named.length) {
      existing = await loadCards(uid);
      const latestByTarget = new Map();
      existing.forEach((c) => latestByTarget.set(c.targetUid, c));
      const open = [];
      const blocked = [];
      for (const n of named) {
        const reason = exclusionReason(n.p, uid, state, ctx, latestByTarget, q, now);
        const facts = candidateFacts(n.p, ctx.states[n.p.uid] || {});
        if (reason) blocked.push({ facts, reason, prev: latestByTarget.get(n.p.uid) });
        else open.push({ facts, score: 90, why: personLine(facts), opener: nameOpener(facts) });
      }
      const reply = nameReply(open, blocked, q, source, now);
      if (!open.length) {
        return quick(reply, 'name', { nearest: blocked.map(({ facts: c }) => ({ uid: c.uid, name: c.name, pic: c.pic, role: c.role, city: [c.city, c.country].filter(Boolean).join(', ') })) });
      }
      const id = newAskId(now);
      const cards = await persistCards(uid, existing, open, q, now, id);
      const record = { id, need: q.need, norm: q.norm, offer: q.offer, location: q.location, remote: q.remote, reply, cardIds: cards.map((c) => c.id), none: false, nearest: [], checked: ctx.candidates.length, usedAi: false, expansion: 'none', kind: 'name', source, createdAt: now };
      await patchState(uid, { lastAsk: record });
      return { ...publicAsk(record), cards, cached: false, usedAi: false, asksLeft: left };
    }
  }

  // 4. Nothing to search on: coach, no tokens, no budget.
  if (!q.tokens.length) return quick(COACH, 'coach');

  // 5. Same ask again within the cache window (any of the last few asks): same
  //    answer, no tokens, no budget.
  const recent = [state.lastAsk, ...(Array.isArray(state.recentAsks) ? state.recentAsks : [])].filter(Boolean);
  const hit = recent.find((a) => a.norm === q.norm && a.kind !== 'name' && now - toMillis(a.createdAt) < LIMITS.askCacheHours * 3600000);
  if (hit) {
    const cards = (await loadCards(uid)).filter((c) => (hit.cardIds || []).includes(c.id));
    const ordered = (hit.cardIds || []).map((id) => cards.find((c) => c.id === id)).filter(Boolean);
    if (hit !== state.lastAsk) await patchState(uid, { lastAsk: hit });
    return { ...publicAsk(hit), cards: ordered, cached: true, asksLeft: left };
  }
  if (used >= limits.asksPerDay) {
    const err = new Error(plus
      ? `You have used today's ${limits.asksPerDay} asks. Tomorrow resets it.`
      : `Free members get ${LIMITS.free.asksPerDay} asks a day (you have used them). PLUS gets ${LIMITS.plus.asksPerDay} a day and unlimited Meets.`);
    err.code = 'ask_limit';
    throw err;
  }

  // 6. The real search.
  existing = existing || (await loadCards(uid));
  ctx = ctx || (await buildMatchContext());
  const { picks, nearest, checked, usedAi, expansion = 'none', relatedTo = '' } = await findPeople(uid, q, ctx, { user, state, existingCards: existing });
  const id = newAskId(now);
  const cards = await persistCards(uid, existing, picks, q, now, id);
  const seq = (Array.isArray(state.askHistory) ? state.askHistory.length : 0) + used;
  const reply = askReply(q, picks, nearest, checked, source, expansion, relatedTo, seq);
  const record = {
    id, need: q.need, norm: q.norm, offer: q.offer, location: q.location, remote: q.remote,
    reply, cardIds: cards.map((c) => c.id), none: !picks.length, nearest, checked, usedAi, expansion, kind: picks.length ? 'people' : 'none', source, createdAt: now,
  };
  const history = (Array.isArray(state.askHistory) ? state.askHistory : []).slice(-19);
  history.push({ id, need: q.need, cards: picks.length, none: !picks.length, source, createdAt: now });
  const recentAsks = [state.lastAsk, ...(Array.isArray(state.recentAsks) ? state.recentAsks : [])]
    .filter((a) => a && a.norm !== q.norm && now - toMillis(a.createdAt) < LIMITS.askCacheHours * 3600000).slice(0, 5);
  await patchState(uid, { lastAsk: record, recentAsks, askHistory: history, asks: { day: today, count: used + 1 } });
  return { ...publicAsk(record), cards, cached: false, usedAi, asksLeft: Math.max(0, left - 1) };
}

const publicAsk = (a) => (a ? {
  id: a.id || '',
  need: a.need || '',
  reply: a.reply || '',
  cardIds: Array.isArray(a.cardIds) ? a.cardIds : [],
  none: !!a.none,
  nearest: Array.isArray(a.nearest) ? a.nearest : [],
  checked: Number(a.checked || 0),
  expansion: a.expansion || 'none',
  kind: a.kind || (a.cardIds && a.cardIds.length ? 'people' : 'none'),
  createdAt: toMillis(a.createdAt),
} : null);

// Cards in the order the member sees / numbers them: latest ask first, then
// the other live cards, newest first. Bots use the same order for "meet 2".
export function orderedCards(cards, state) {
  const firstIds = Array.isArray(state?.lastAsk?.cardIds) ? state.lastAsk.cardIds : [];
  const first = firstIds.map((id) => cards.find((c) => c.id === id && ['new', 'saved', 'meet'].includes(c.status))).filter(Boolean);
  const rest = cards.filter((c) => !firstIds.includes(c.id) && (c.status === 'new' || c.status === 'saved')).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  return [...first, ...rest];
}

// ---------------------------------------------------------------- cards
export async function loadCards(uid) {
  const snap = await db().collection('introSuggestions').doc(uid).get();
  const cards = snap.exists && Array.isArray(snap.data().cards) ? snap.data().cards : [];
  return cards;
}

export async function setCardStatus(uid, cardId, status) {
  const ref = db().collection('introSuggestions').doc(uid);
  const snap = await ref.get();
  const cards = snap.exists && Array.isArray(snap.data().cards) ? snap.data().cards : [];
  const card = cards.find((c) => c.id === cardId);
  if (!card) throw new Error('That card is gone.');
  const next = cards.map((c) => (c.id === cardId ? { ...c, status, updatedAt: Date.now() } : c));
  await ref.set({ cards: next, updatedAt: nowTs() }, { merge: true });
  return { ...card, status };
}

export async function meet(uid, cardId, { userDoc } = {}) {
  const user = userDoc || (await loadUser(uid));
  if (!user) throw new Error('Finish your LINKUP profile first.');
  const cards = await loadCards(uid);
  const card = cards.find((c) => c.id === cardId);
  if (!card) throw new Error('That card is gone.');
  if (card.status === 'meet') return { alreadyRequested: true, introId: card.introId || '' };
  const target = card.targetUid;
  const me = profileFacts(user);
  const plus = await isPlusUser(uid, user);
  const state = await loadState(uid);
  const today = dayKey();
  const used = state.meets?.day === today ? Number(state.meets.count || 0) : 0;
  const limit = plus ? LIMITS.plus.meetsPerDay : LIMITS.free.meetsPerDay;
  if (used >= limit) {
    const err = new Error(`You have used today's ${limit} Meet requests. PLUS members get unlimited Meets.`);
    err.code = 'meet_limit';
    throw err;
  }
  // Already connected? Skip the opt-in and go straight to the chat.
  const matchId = [uid, target].sort().join('_');
  const matchSnap = await db().collection('matches').doc(matchId).get();
  if (matchSnap.exists) {
    await setCardStatus(uid, cardId, 'meet');
    return { matchId, opener: card.opener || '' };
  }
  const introId = `${uid}_${target}`;
  const introRef = db().collection('intros').doc(introId);
  const existing = await introRef.get();
  if (existing.exists && existing.data().status === 'pending') {
    await setCardStatus(uid, cardId, 'meet');
    return { introId, pending: true };
  }
  const targetState = await loadState(target);
  if (targetState.muted && targetState.muted[uid]) {
    await setCardStatus(uid, cardId, 'skip');
    throw new Error('They are not taking intros right now.');
  }
  const week = weekKey();
  const inboundCount = targetState.inbound?.week === week ? Number(targetState.inbound.count || 0) : 0;
  const cap = Number.isFinite(Number(targetState.inboundCap)) ? Number(targetState.inboundCap) : LIMITS.inboundPerWeek;
  if (inboundCount >= cap) {
    throw new Error('They have hit their weekly intro cap. Ask me again next week.');
  }
  const intro = {
    requesterId: uid,
    targetId: target,
    askId: card.askId || '',
    need: card.need,
    why: card.why,
    opener: card.opener || '',
    requesterName: me.name,
    requesterPic: me.pic,
    requesterRole: me.role,
    requesterCity: [me.city, me.country].filter(Boolean).join(', '),
    targetName: card.targetName,
    targetPic: card.targetPic || '',
    status: 'pending',
    createdAt: nowTs(),
    respondedAt: null,
    expiresAt: getAdmin().firestore.Timestamp.fromMillis(Date.now() + LIMITS.introDays * DAY_MS),
  };
  await introRef.set(intro);
  await Promise.all([
    patchState(uid, { meets: { day: today, count: used + 1 } }),
    patchState(target, { inbound: { week, count: inboundCount + 1 } }),
  ]);
  const cardsRef = db().collection('introSuggestions').doc(uid);
  await cardsRef.set({ cards: cards.map((c) => (c.id === cardId ? { ...c, status: 'meet', introId, updatedAt: Date.now() } : c)), updatedAt: nowTs() }, { merge: true });
  const content = `${me.name} wants to meet: "${card.need}". Linky's reason: ${card.why}`;
  await notifyUser(target, {
    type: 'intro_request',
    content,
    from: me,
    requestId: introId,
    pushTitle: 'Linky has an intro for you',
    channelText: `Linky here. ${me.name}${me.role ? ` (${me.role})` : ''} wants to meet you.\nThey need: ${card.need}\nWhy you: ${card.why}\n\nReply ACCEPT, DECLINE or LATER.`,
    state: targetState,
  });
  return { introId, pending: true, meetsLeft: plus ? null : Math.max(0, limit - used - 1) };
}

async function ensureChat(a, b, aUser, bUser) {
  const matchId = [a, b].sort().join('_');
  const snapOf = (uid, u) => {
    const f = profileFacts(u) || { name: 'Builder', pic: '' };
    return { uid, displayName: f.name || 'Builder', profilePic: f.pic || '', isVerified: !!u?.isVerified, hideOnlineStatus: !!u?.hideOnlineStatus };
  };
  await db().collection('matches').doc(matchId).set({
    userIds: [a, b].sort(),
    participants: { [a]: true, [b]: true },
    participantProfiles: { [a]: snapOf(a, aUser), [b]: snapOf(b, bUser) },
    timestamp: nowTs(),
  }, { merge: true });
  return matchId;
}

export async function respond(uid, introId, decision) {
  if (!isValidId(introId)) throw new Error('Unknown intro.');
  const ref = db().collection('intros').doc(introId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Unknown intro.');
  const intro = snap.data();
  if (intro.targetId !== uid) throw new Error('This intro is not yours to answer.');
  if (intro.status !== 'pending') return { status: intro.status, matchId: intro.matchId || '' };
  const requester = intro.requesterId;
  if (decision === 'accept') {
    const [meUser, reqUser] = await Promise.all([loadUser(uid), loadUser(requester)]);
    const matchId = await ensureChat(uid, requester, meUser, reqUser);
    const me = profileFacts(meUser) || { name: 'Builder' };
    const them = profileFacts(reqUser) || { name: intro.requesterName || 'Builder' };
    // Both sides' chat gate reads connectionRequests; an approved record
    // unlocks the composer immediately, exactly like a manual approval.
    await db().collection('connectionRequests').doc(`${requester}_${uid}`).set({
      senderId: requester,
      recipientId: uid,
      senderName: them.name,
      senderPic: them.pic || '',
      status: 'approved',
      message: `Linky intro: ${intro.need}`.slice(0, 600),
      createdAt: nowTs(),
      reviewedAt: nowTs(),
      updatedAt: nowTs(),
    }, { merge: true });
    const opener = `Linky here - I introduced you two. ${them.name} is looking for: ${intro.need}. ${me.name} came up because: ${intro.why} Take it from here.`;
    const msgs = db().collection('matches').doc(matchId).collection('messages');
    await msgs.add({ senderId: 'linky-ai', content: opener, type: 'text', timestamp: nowTs() });
    await db().collection('matches').doc(matchId).set({
      lastMessage: opener.slice(0, 200),
      lastMessageTime: nowTs(),
      unreadBy: { [uid]: 1, [requester]: 1 },
    }, { merge: true });
    await ref.set({ status: 'accepted', respondedAt: nowTs(), matchId }, { merge: true });
    await notifyUser(requester, {
      type: 'intro_accepted',
      content: `${me.name} accepted Linky's intro. Say hello.`,
      from: me,
      requestId: introId,
      matchId,
      pushTitle: 'Intro accepted',
      channelText: `${me.name} accepted your intro (${intro.need}). Open LINKUP to chat: ${APP_URL}/chat/${matchId}`,
    });
    return { status: 'accepted', matchId };
  }
  if (decision === 'later') {
    await ref.set({ status: 'snoozed', respondedAt: nowTs(), snoozedUntil: getAdmin().firestore.Timestamp.fromMillis(Date.now() + LIMITS.snoozeDays * DAY_MS) }, { merge: true });
    return { status: 'snoozed' };
  }
  // Decline = mute both directions. Silent for the requester.
  await ref.set({ status: 'declined', respondedAt: nowTs() }, { merge: true });
  await patchState(uid, { muted: { [requester]: Date.now() } });
  const sugRef = db().collection('introSuggestions').doc(requester);
  const sugSnap = await sugRef.get();
  if (sugSnap.exists) {
    const cards = (sugSnap.data().cards || []).map((c) => (c.introId === introId ? { ...c, status: 'declined', updatedAt: Date.now() } : c));
    await sugRef.set({ cards, updatedAt: nowTs() }, { merge: true });
  }
  return { status: 'declined' };
}

// ---------------------------------------------------------------- home / brief / audit / facts
const publicIntro = (id, i) => ({
  id,
  requesterId: i.requesterId,
  targetId: i.targetId,
  requesterName: i.requesterName || 'Builder',
  requesterPic: i.requesterPic || '',
  requesterRole: i.requesterRole || '',
  requesterCity: i.requesterCity || '',
  targetName: i.targetName || 'Builder',
  targetPic: i.targetPic || '',
  need: i.need || '',
  why: i.why || '',
  opener: i.opener || '',
  status: i.status,
  matchId: i.matchId || '',
  createdAt: toMillis(i.createdAt),
});

export function briefText(cards, name) {
  const fresh = cards.filter((c) => c.status === 'new');
  if (!fresh.length) return '';
  const top = fresh[0];
  const head = fresh.length === 1
    ? `Linky found 1 person worth your time${name ? `, ${name}` : ''}.`
    : `Linky found ${fresh.length} people worth your time${name ? `, ${name}` : ''}.`;
  return `${head}\n${top.targetName}${top.targetRole ? ` - ${top.targetRole}` : ''}${top.targetCity ? ` (${top.targetCity})` : ''}.\nWhy: ${top.why}`;
}

export async function home(uid, { userDoc } = {}) {
  const user = userDoc || (await loadUser(uid));
  const [cards, inboundSnap, sentSnap, state, plus] = await Promise.all([
    loadCards(uid),
    db().collection('intros').where('targetId', '==', uid).where('status', '==', 'pending').get(),
    db().collection('intros').where('requesterId', '==', uid).limit(40).get(),
    loadState(uid),
    isPlusUser(uid, user),
  ]);
  const now = Date.now();
  const limits = plus ? LIMITS.plus : LIMITS.free;
  const liveCards = cards
    .filter((c) => ['new', 'saved', 'meet', 'declined'].includes(c.status) && now - toMillis(c.createdAt) < 14 * DAY_MS)
    .sort((a, b) => toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt));
  const today = dayKey(now);
  const meetsUsed = state.meets?.day === today ? Number(state.meets.count || 0) : 0;
  const asksUsed = state.asks?.day === today ? Number(state.asks.count || 0) : 0;
  return {
    name: profileFacts(user)?.name || '',
    plus,
    limits: { meetsPerDay: plus ? null : limits.meetsPerDay, meetsUsedToday: meetsUsed, asksPerDay: limits.asksPerDay, asksUsedToday: asksUsed },
    cards: liveCards,
    inbound: inboundSnap.docs.map((d) => publicIntro(d.id, d.data())).filter((i) => now - i.createdAt < LIMITS.introDays * DAY_MS),
    sent: sentSnap.docs.map((d) => publicIntro(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
    prefs: { openTo: Array.isArray(state.openTo) ? state.openTo : OFFERS, inboundCap: Number.isFinite(Number(state.inboundCap)) ? Number(state.inboundCap) : LIMITS.inboundPerWeek },
    channels: { telegram: !!state.channels?.telegram, whatsapp: !!state.channels?.whatsapp },
    lastAsk: state.lastAsk && now - toMillis(state.lastAsk.createdAt) < 14 * DAY_MS ? publicAsk(state.lastAsk) : null,
    facts: toldFacts(state),
    brief: briefText(liveCards, ''),
  };
}

export async function setPrefs(uid, { openTo, inboundCap }) {
  const patch = {};
  if (Array.isArray(openTo)) patch.openTo = openTo.filter((o) => OFFERS.includes(o));
  if (inboundCap !== undefined) patch.inboundCap = Math.max(0, Math.min(20, Math.round(Number(inboundCap) || 0)));
  await patchState(uid, patch);
  return { ok: true, ...patch };
}

// "What Linky knows about you" is editable: free-text notes plus extra skills
// and looking-for tags. They are merged into matching on both sides (when you
// ask, and when someone else's ask is checked against you) from the next request.
export async function setFacts(uid, input) {
  const facts = {
    notes: text(input?.notes, 800),
    skills: list(input?.skills, 20, 40),
    lookingFor: list(input?.lookingFor, 10, 80),
    updatedAt: Date.now(),
  };
  await patchState(uid, { facts, lastAsk: FieldValue().delete(), recentAsks: FieldValue().delete() });
  return { ok: true, facts: { ...facts } };
}

export async function audit(uid, { userDoc } = {}) {
  const user = userDoc || (await loadUser(uid));
  const [state, cards, introsOut, introsIn] = await Promise.all([
    loadState(uid),
    loadCards(uid),
    db().collection('intros').where('requesterId', '==', uid).limit(30).get(),
    db().collection('intros').where('targetId', '==', uid).limit(30).get(),
  ]);
  const facts = profileFacts(user) || {};
  const told = toldFacts(state);
  return {
    facts: {
      name: facts.name, role: facts.role, company: facts.company, city: facts.city, country: facts.country,
      skills: facts.skills, industries: facts.industries, lookingFor: facts.lookingFor, goals: facts.goals, bio: facts.bio,
    },
    told,
    signals: {
      plus: await isPlusUser(uid, user),
      asksUsedToday: state.asks?.day === dayKey() ? Number(state.asks.count || 0) : 0,
      meetsUsedToday: state.meets?.day === dayKey() ? Number(state.meets.count || 0) : 0,
      inboundThisWeek: state.inbound?.week === weekKey() ? Number(state.inbound.count || 0) : 0,
      mutedCount: Object.keys(state.muted || {}).length,
      channels: { telegram: !!state.channels?.telegram, whatsapp: !!state.channels?.whatsapp },
      openTo: Array.isArray(state.openTo) ? state.openTo : OFFERS,
      inboundCap: Number.isFinite(Number(state.inboundCap)) ? Number(state.inboundCap) : LIMITS.inboundPerWeek,
    },
    asks: (Array.isArray(state.askHistory) ? state.askHistory : []).map((a) => ({ id: a.id, need: a.need, cards: Number(a.cards || 0), none: !!a.none, source: a.source || 'app', createdAt: toMillis(a.createdAt) })).sort((a, b) => b.createdAt - a.createdAt),
    cards: cards.map((c) => ({ id: c.id, targetName: c.targetName, why: c.why, status: c.status, createdAt: toMillis(c.createdAt) })).sort((a, b) => b.createdAt - a.createdAt),
    introsSent: introsOut.docs.map((d) => publicIntro(d.id, d.data())),
    introsReceived: introsIn.docs.map((d) => publicIntro(d.id, d.data())),
    sources: ['Your LINKUP profile (users/{you})', 'What you told Linky on this page', 'Things you asked Linky (last 20)', 'Cards you met / skipped / saved', 'Intros you accepted or declined', 'Push tokens (only to deliver intro alerts)'],
    notUsed: ['Your private messages', 'Your contacts', 'Your location beyond the city on your profile', 'Anything from Telegram / WhatsApp other than the messages you send Linky'],
  };
}

export async function forget(uid) {
  const batch = db().batch();
  const out = await db().collection('intros').where('requesterId', '==', uid).where('status', '==', 'pending').get();
  out.docs.forEach((d) => batch.set(d.ref, { status: 'expired', respondedAt: nowTs() }, { merge: true }));
  batch.delete(db().collection('introSuggestions').doc(uid));
  const state = await loadState(uid);
  const channels = state.channels || {};
  for (const [channel, chatId] of Object.entries(channels)) {
    if (chatId) batch.delete(db().collection('botUsers').doc(`${channel}_${chatId}`));
  }
  batch.delete(db().collection('linkyState').doc(uid));
  await batch.commit();
  return { ok: true, expiredIntros: out.size };
}

// ---------------------------------------------------------------- bot linking
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export async function createLinkCode(uid) {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  await db().collection('botLinks').doc(code).set({ uid, createdAt: nowTs(), expiresAt: getAdmin().firestore.Timestamp.fromMillis(Date.now() + 15 * 60 * 1000) });
  return { code, expiresInMinutes: 15 };
}

export async function consumeLinkCode(code, channel, chatId, meta = {}) {
  const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 6) return null;
  const ref = db().collection('botLinks').doc(clean);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (toMillis(data.expiresAt) < Date.now()) { await ref.delete(); return null; }
  const uid = data.uid;
  await Promise.all([
    db().collection('botUsers').doc(`${channel}_${chatId}`).set({ uid, channel, chatId: String(chatId), linkedAt: nowTs(), ...meta }, { merge: true }),
    patchState(uid, { channels: { [channel]: String(chatId) } }),
    ref.delete(),
  ]);
  return uid;
}

export async function botUserFor(channel, chatId) {
  const snap = await db().collection('botUsers').doc(`${channel}_${chatId}`).get();
  return snap.exists ? snap.data() : null;
}

export async function unlinkBot(channel, chatId) {
  const bu = await botUserFor(channel, chatId);
  if (!bu) return false;
  await Promise.all([
    db().collection('botUsers').doc(`${channel}_${chatId}`).delete(),
    patchState(bu.uid, { channels: { [channel]: FieldValue().delete() } }),
  ]);
  return true;
}

// ---------------------------------------------------------------- cron (housekeeping only: nothing waits on it)
export async function runCron() {
  const now = Date.now();
  const pendingSnap = await db().collection('intros').where('status', '==', 'pending').get();
  const writes = db().batch();
  let expiredIntros = 0;
  pendingSnap.docs.forEach((d) => {
    const i = d.data();
    if (toMillis(i.expiresAt) && toMillis(i.expiresAt) < now) { writes.set(d.ref, { status: 'expired', respondedAt: nowTs() }, { merge: true }); expiredIntros += 1; }
  });
  if (expiredIntros) await writes.commit();
  const telegram = await ensureTelegramWebhook(APP_URL).catch((e) => ({ error: String(e?.message || e) }));
  return { pendingIntros: pendingSnap.size - expiredIntros, expiredIntros, telegram };
}
