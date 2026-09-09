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
import { aiReady, aiStatus, aiText, geminiText, getGeminiKey, localRank, compactProfile } from './_gemini.js';
import { findLeads, outreachDraft } from './_serpapi.js';

export const LIMITS = {
  // Two real searches a day on the free plan, and they are the SAME budget on
  // every surface: an ask typed in the app and an ask typed at the Telegram bot
  // both burn one of the two, so nobody farms extra searches by switching channel.
  // Looking someone up by name, chit-chat, drafting and the limit reply are free.
  free: { asksPerDay: 2, meetsPerDay: 2 },
  plus: { asksPerDay: 60, meetsPerDay: 100000 },
  inboundPerWeek: 5,
  introDays: 7,
  snoozeDays: 14,
  skipDays: 14,
  shortlist: 8,
  cardsPerAsk: 5,
  // A "nobody fits" answer ages faster on purpose: a new member joining this
  // afternoon should show up when the same name is asked tonight.
  askCacheHours: 12,
  noneCacheHours: 3,
  threadTurns: 24,
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

const STOP = new Set('me for up in a an the with and or to of is i my by on at who someone who can that this need want looking find help build some any people person good great experienced strong senior junior based from about into been are was be it its as please hi hey hello linky you your get give show connect introduce intro know anyone anybody there here have has do does would could should like want wants needs a bit more still just actually really maybe perhaps probably tell say says saying send sending message messages msg dm text texting ping pings write contact contacts reach touch talk speak ask asking ask me please urgently asap today tomorrow week right now only other others else few good match matches fit fits fitment list lists listme on linkup linkup profile profiles profile picture number whatsapp email mail address details info information about him her them he she they their his hers same sure ok thanks'.split(' '));
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
  return {
    notes: text(f.notes, 800), skills: list(f.skills, 20, 40), lookingFor: list(f.lookingFor, 10, 80),
    // What the member does NOT want Linky to know. It hides the fact from
    // matching and from the "why" - it does not touch their LINKUP profile.
    hidden: {
      skills: list(f.hidden?.skills, 40, 40),
      industries: list(f.hidden?.industries, 40, 40),
      lookingFor: list(f.hidden?.lookingFor, 40, 80),
      notes: !!f.hidden?.notes, bio: !!f.hidden?.bio, company: !!f.hidden?.company, city: !!f.hidden?.city,
    },
    updatedAt: toMillis(f.updatedAt) || null,
  };
}

// Subtracting a hidden fact is by word, not by position, so "FinTech" hides
// "fintech" everywhere it appears - including inside the free-text bio, which
// is where an "I do not want anyone to know I do insurance" actually matters.
// "beekeeping" on their profile and "Beekeeper" in their headline are the same
// fact to a human, so both sides are reduced to a stem before they are compared.
// Short words must match exactly or a hidden "AI" would eat "domain".
const stemOf = (w) => String(w || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/(ings?|ers?|ees?|ies|es|s)$/, '');
const hiddenHit = (value, hide) => (hide || []).some((h) => {
  const a = stemOf(value);
  const b = stemOf(h);
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a));
});
const minusHidden = (arr, hide) => (arr || []).filter((x) => !hiddenHit(x, hide));
// a withheld fact can still be sitting inside a sentence (a headline, a bio).
// Words carrying it are removed from what Linky reads, so hiding "beekeeping"
// actually hides "Beekeeper" too - and the profile a human sees is untouched.
const scrubHidden = (s, hide = []) => {
  const raw = String(s || '');
  if (!raw || !(hide || []).length) return raw;
  return raw
    .split(/(\s+)/)
    .map((piece) => (/^\s+$/.test(piece) ? piece : (hiddenHit(piece.replace(/[^a-z0-9']/gi, ''), hide) ? '' : piece)))
    .join('')
    .replace(/\s*,\s*(?=,|\s|$)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,;\s]+|[,;\s]+$/g, '')
    .trim();
};

// Profile facts + told facts, merged the way the matcher sees them.
function mergedFacts(p, state) {
  const base = profileFacts(p);
  if (!base) return null;
  const told = toldFacts(state);
  const hid = told.hidden;
  return {
    ...base,
    skills: minusHidden(uniq([...base.skills, ...told.skills]).slice(0, 24), hid.skills),
    industries: minusHidden(base.industries, hid.industries),
    lookingFor: minusHidden(uniq([...base.lookingFor, ...told.lookingFor]).slice(0, 12), hid.lookingFor),
    role: scrubHidden(base.role, [...hid.skills, ...hid.industries]),
    company: hid.company ? '' : scrubHidden(base.company, hid.skills),
    city: hid.city ? '' : base.city,
    bio: [hid.bio ? '' : base.bio, hid.notes ? '' : told.notes].filter(Boolean).map((x) => scrubHidden(x, hid.skills)).filter(Boolean).join(' ').slice(0, 1200),
    notes: hid.notes ? '' : told.notes,
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

// Telegram refuses anything over 4096 characters, and the old code "solved" that
// with slice(0, 4000) - which is how a member ended up with half a message or no
// message at all, links cut in the middle of a URL. Split on the paragraph
// boundary instead; a chunk only gets hard-cut if a single paragraph is huge.
const TG_LIMIT = 3800;
export function splitTelegram(message, max = TG_LIMIT) {
  const t = String(message || '').replace(/\r/g, '');
  if (!t.trim()) return [];
  if (t.length <= max) return [t];
  const out = [];
  let cur = '';
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (const para of t.split(/\n{2,}/)) {
    const next = cur ? `${cur}\n\n${para}` : para;
    if (next.length <= max) { cur = next; continue; }
    flush();
    if (para.length > max) out.push(...chunkLeadsSafe(para, max));
    else cur = para;
  }
  flush();
  return out.filter(Boolean);
}
// a lead list must never be cut between "https://" and the handle: keep every
// http(s) URL whole by refusing to split inside one
function chunkLeadsSafe(para, max) {
  const out = [];
  let rest = para;
  while (rest.length > max) {
    let at = -1;
    const nl = rest.lastIndexOf('\n', max);
    const sp = rest.lastIndexOf(' ', max);
    at = nl > max * 0.5 ? nl : sp > max * 0.5 ? sp : max;
    const urlAt = rest.lastIndexOf('http', at);
    if (urlAt > 0) {
      const end = rest.indexOf(' ', urlAt);
      if (end === -1 || end > at) at = urlAt;   // the url would be cut: stop before it
    }
    if (at <= 0) at = max;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).replace(/^\s+/, '');
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

// Telegram validates reply_markup before it looks at the chat, and a single bad
// button makes it reject the WHOLE message - which is how a member ends up with
// "typing..." and nothing else. So a keyboard is repaired here rather than sent
// and lost: url buttons without a real absolute url become tappable callbacks,
// callback_data is held to Telegram's 64-byte ceiling, and any row left empty
// after that is dropped.
const TG_CB_MAX = 64;
const absUrl = (v) => {
  const u = String(v || '').trim();
  if (!/^https?:\/\//i.test(u)) return '';
  return u.length <= 500 ? u : '';
};
const cbSafe = (v) => {
  const s = String(v || '');
  if (Buffer.byteLength(s, 'utf8') <= TG_CB_MAX) return s;
  const cut = s.slice(0, TG_CB_MAX - 8);
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return `${cut}:h${hash.toString(36).slice(0, 6)}`;
};

export function sanitizeTelegramMarkup(markup) {
  if (!markup || typeof markup !== 'object') return undefined;
  if (Array.isArray(markup.keyboard)) {
    const rows = markup.keyboard
      .map((row) => (Array.isArray(row) ? row : [row])
        .map((b) => ({ text: String(b?.text || '').slice(0, 100) }))
        .filter((b) => b.text))
      .filter((row) => row.length);
    return rows.length ? { keyboard: rows.slice(0, 6), resize_keyboard: false, one_time_keyboard: true } : undefined;
  }
  const rows = (Array.isArray(markup.inline_keyboard) ? markup.inline_keyboard : [])
    .map((row) => (Array.isArray(row) ? row : [row])
      .map((b) => {
        const label = String(b?.text || '').slice(0, 60) || 'Open';
        const url = absUrl(b?.url);
        if (b?.url !== undefined && b?.url !== null && !url) {
          // a lead whose link never resolved: turn the dead button into a search
          // that does open something, instead of a 400 that eats the whole reply
          const q = String(b?.fallbackQuery || label).slice(0, 90);
          return { text: label, url: `https://www.google.com/search?q=${encodeURIComponent(`linkedin ${q}`)}` };
        }
        if (url) return { text: label, url };
        if (b?.callback_data) return { text: label, callback_data: cbSafe(b.callback_data) };
        if (b?.switch_inline_query !== undefined) return { text: label, switch_inline_query: String(b.switch_inline_query || '').slice(0, 256) };
        return null;
      })
      .filter(Boolean))
    .filter((row) => row.length)
    .slice(0, 12);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

export async function sendTelegram(chatId, message, markup) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token || !chatId) return false;
  const chunks = splitTelegram(message);
  if (!chunks.length) return false;
  const clean = sanitizeTelegramMarkup(markup);
  const post = async (body) => {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(9000),
    }).catch((err) => ({ __err: String(err?.message || err) }));
    if (resp?.__err) return { ok: false, description: resp.__err, network: true };
    if (resp?.ok) return { ok: true };
    const data = await (resp && typeof resp.json === 'function' ? resp.json().catch(() => null) : null);
    return { ok: false, status: resp?.status, description: String(data?.description || 'send failed'), retryAfter: Number(data?.parameters?.retry_after || 0) };
  };
  let ok = true;
  for (let i = 0; i < chunks.length; i += 1) {
    const isLast = i === chunks.length - 1;
    const base = { chat_id: chatId, text: chunks[i], disable_web_page_preview: true };
    let res = await post({ ...base, ...(isLast && clean ? { reply_markup: clean } : {}) });
    if (!res.ok && !res.network && res.retryAfter > 0 && res.retryAfter <= 6) {
      // 429: Telegram asked for a pause, and one is cheaper than losing the message
      await new Promise((r) => setTimeout(r, (res.retryAfter + 1) * 1000));
      res = await post({ ...base, ...(isLast && clean ? { reply_markup: clean } : {}) });
    }
    if (!res.ok && isLast && clean) {
      // a keyboard Telegram still refuses must never take the words with it
      console.warn('[linky] telegram markup refused, resending plain', res.status || '', res.description.slice(0, 120));
      res = await post(base);
    }
    if (!res.ok) {
      ok = false;
      console.warn('[linky] telegram sendMessage failed', res.status || '', res.description.slice(0, 140));
    }
    if (!isLast) await new Promise((r) => setTimeout(r, 110));
  }
  return ok;
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
const OFFER_RX = /\b(pay|paid|paying|budget|\$|usd|salary|rate|hire|hiring|freelance|contract)\b/;

// "message fred" / "who is fred" / "is Fred Moyo on linkup" / bare "fred" are
// requests for a HUMAN, not a skill search. The phrase is guessed here and
// only honoured if it actually matches a member's name (see findByName).
const OBJECT_RX = /\b(?:message|dm|text|ping|write(?:\s+to)?|contact|reach\s+out\s+to|get\s+in\s+touch\s+with|send\s+(?:a\s+|me\s+)?(?:a\s+)?(?:message|note|text|email)\s+to|introduc(?:e|ing)\s+me\s+to|introduce\s+|connect\s+me\s+(?:to|with)|introduce|talk\s+to|speak\s+to|chat\s+with|want\s+to\s+meet|need\s+to\s+meet|i\s+want\s+|find\s+me|find|look(?:ing)?\s+for|search(?:\s+for)?|show\s+me|who\s+is|whos|do\s+you\s+know|is|are)\s+([a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,2})/i;
const NAMEY = /\b(?:[A-Z][a-z]{1,14}|[A-Z][a-z]+['’][A-Z][a-z]+)(?:\s+[A-Z][a-z]+){0,2}\b/;

const stripNameNoise = (s) => String(s || '')
  .replace(/\b(?:on\s+)?(?:the\s+)?(?:network|linkup|here|platform|app|member|guy|girl|person|people|one|guys)\b/gi, ' ')
  .replace(/[?.!,;:]+$/g, '')
  .trim();

// The phrases worth trying as a person's name, best guess first.
function namePhrases(message) {
  const raw = String(message || '').trim();
  if (!raw) return [];
  const out = [];
  const obj = raw.match(OBJECT_RX);
  if (obj) out.push(stripNameNoise(obj[1]));
  const cap = raw.replace(/^\W+/, '').match(NAMEY);
  if (cap) out.push(stripNameNoise(cap[0]));
  out.push(stripNameNoise(raw.replace(/^(?:hi|hey|hello|please|linky)[\s,.!-]+/i, '')));
  const words = out.map((s) => s.split(/\s+/).filter((w) => w.length > 1)).filter((w) => w.length && w.length <= 3);
  const NOT_A_NAME = new Set(['linky', 'linkup', 'link up', 'bot', 'ai', 'admin', 'support', 'team', 'everyone', 'somebody', 'someone', 'people', 'founder', 'developer', 'designer', 'engineer', 'investor', 'partner', 'this', 'that', 'here', 'them', 'they', 'your', 'myself']);
  return uniq(words.map((w) => w.join(' ')).filter((s) => s.length >= 2 && s.length <= 40))
    .filter((s) => !/^\d+$/.test(s))
    .filter((s) => !NOT_A_NAME.has(s.toLowerCase()))
    .slice(0, 3);
}

// "write me a first message", "what do I say to him"
const DRAFT_RX = /\b(?:write|draft|compose|give me|prepare|what should i say|what do i say|first message|opening line|opener|say hi for me|message him|message her)\b/i;
// "who else", "anyone else", "more options" -> second lap over the last ask.
const ELSE_RX = /\b(?:who else|anyone else|anybody else|any other|other people|more people|more options|others\??|else\??|next|keep going|try again|look again|again)\b/i;
// bare affirmatives / negatives with no new information
// "no one else in mind, just want to chat" has nouns in it, so the matcher ran
// on it and told a human nobody fits. Sentences like that are not a search, and
// a role word anywhere in the message is what tells the two apart.
const CHIT_RX = /\b(?:just (?:want|wanna|looking|here|checking|saying|asking)?\s*(?:to\s*)?(?:chat|talk|talk a bit|bounce ideas|vent|browse|say hi|say hello|check in)|want(?:s|ing)? (?:to|a) chat|up for a chat|fancy a chat|no (?:one|body) (?:else )?in mind|nobody in mind|nothing specific in mind|nothing in particular|how are you|how'?s it going|how are u|you ok\?|you good\?|what'?s up|hey there|who are you|what are you|are you (?:a |an )?(?:real|human|ai|bot)|you real\?|talk to me|keep me company|bored|what can you do|help me with what you do|are you (?:there|awake)|hi|hey|hello|yo|hiya|howdy|good (?:morning|afternoon|evening)|thanks?(?: you)?(?: linky)?|ty|cheers|no worries|all good|nice (?:to meet|meeting) you|how do you do|sup|what are you up to|are you (?:busy|bored|alone|single)|just checking in|say hi|saying hi|kicking it|hang out|can (?:we|i) (?:talk|chat)|are you (?:around|about|free)|got a (?:minute|moment|sec|second)|wyd|what are you doing|no agenda|nothing on my (?:mind|head)|i.?m (?:bored|stuck)|feeling lonely|nice to (?:meet|talk to) you|good to (?:meet|talk) you|that was a great intro|great intro|the intro was (?:great|good|nice)|that intro (?:was|went) (?:great|well|good)|you.?re a legend|you are a legend|bless you|much appreciated)\b/i;
const ROLEISH_RX = /\b(?:devel?op(?:er|ing|ment)|programmer|engineer|designer|architect|marketer|marketer|lawyer|analyst|accountant|bookkeep\w*|audit\w*|actuar\w*|quant|recruiter|consultant|copywriter|writer|editor|photographer|videographer|founder|co-?founder|ceo|cto|coo|cmo|cfo|product manager|project manager|data scien\w*|data engine\w*|machine learning|ai engineer|devops|backend|frontend|full[- ]?stack|flutter|react|node(?:\.js)?|python|django|laravel|wordpress|shopify|mobile app|web app|ui|ux|fintech|insurance|logistics|procurement|supply chain|tax|legal|paralegal|nurse|doctor|clinician|teacher|lecturer|professor|researcher|scientist|builder|maker|hacker|investor|angel|vc|mentor|advisor|adviser|sales|growth|marketing|operations|farmer|agronom\w*|mining|energy|solar|log\w*|construction|quantity survey\w*)\b/i;

// A member thinking out loud is not a work order. "who could be my co founder"
// wants a thought and a question, not five cards arriving unprompted.
const REFLECT_RX = /\b(?:who\s+(?:could|might|would|should|'?d)\b|who\s+do\s+you\s+think|what\s+do\s+you\s+think|should\s+i\s+(?:find|look|hire|bring|recruit|get|ask|try|pay|take|give)|any\s+ideas|anyone\s+come\s+to\s+mind|(?:i'?m|i\s+am)\s+(?:also\s+)?thinking\s+(?:about|of)|(?:i\s+was\s+|just\s+)wondering|do\s+you\s+think\s+i\s+(?:need|should|have|could)|is\s+it\s+worth|what\s+would\s+it\s+take|how\s+do\s+i\s+(?:know|spot|tell|judge)|who\s+else\s+might|maybe\s+i\s+need|perhaps\s+i\s+need)\b/i;
// ...unless the same message is plainly an instruction, in which case search now.
const ORDER_RX = /^\s*(?:\/\w*\s+)?(?:please\s+)?(?:find|search|look\s*ing\s+for|look\s+for|get\s+me|need|want|introduce|connect|match\s+me|show\s+me|send\s+(?:me\s+)?(?:some|a|a\s+few)|who\s+do\s+you\s+have|who'?s\s+on\s+linkup|who\s+can|anyone\s+who|anybody\s+who|do\s+you\s+know\s+(?:a|an|any))\b/i;
const AFFIRM_RX = /^(?:y|yes|yeah|yep|yup|sure|ok|okay|kk|go\s+ahead|go\s+for\s+it|go\s+on|do\s+it|do\s+them|let'?s\s+go|why\s+not|find\s+them|look\s+for\s+them|yes\s+please|sure\s+why\s+not|yes\s*,\s*go\s+look)\b/i;
const DENY_RX = /^(?:no|nope|nah|not\s+now|not\s+yet|not\s+right\s+now|just\s+(?:asking|wondering|talking|curious|thinking)|thinking\s+out\s+loud|maybe\s+later|never\s+mind|leave\s+it|no\s+thanks|not\s+bothered)\b/i;

const BARE_RX = /^(yes|yeah|yep|no|nope|nah|ok|okay|k|sure|cool|nice|great|thanks|thank you|ty|hm+hmm*|huh|\?+\s*|!\s*)[.!?\s]*$/i;

// Words that carry no search intent whatsoever: greetings, laughs, filler, banter,
// and the Shona/Ndebele small talk our members actually type. Strip every one of
// these out of a message and, if nothing is left, the member is TALKING - they are
// not ordering a search. This is the check "yoo" needs, because no list of
// greetings will ever be complete; emptiness after stripping is.
const SMALL_PARTS = [
  'y[oa]+h*|hey+|hai+|hi+|heya|hay|hello+\\w*|he?lo|halo|hiya|ya|yah|yw|sup|so',
  'wassup|wa\\w*?s\\s*up|whats?|what.s|wyd|how.s|how|are|r|is|s|it|its|been|long|time|goes|going|doin\\w*|do|did',
  'ah+|oh+\\w*|eish|aita|ag|awk|ouch|hmm+h*|uh+h*|mm+k*|hehe\\w*|(?:ha){2,}h*|lo+l+|lma+o|rofl',
  'kk+|k|ok+ay?|okie|kay|coolt?\\w*|cool|nice|sweet|sharp|standard|sorted|sure|fine|well|good|great',
  'mhoro|mwadi|hatina|kuzei|kudakara|ndatofara|bros?\\w*|bruv|bruh|chief|boss|leader|makoti|baba|sisi|dhambi',
  'baby|dear|love|mate|guys?|g|my|mine|me|we|us|our|you|your|yours|u|ur|they|them|their|theirs',
  'no|nope|nah|not|nothing|nada|zip|much|just|only|still|even|though|really|serious\\w*|literally|kinda|sorta',
  'wanna|gonna|gotta|tryna|need|needs|wanted|want|like|likes|feel|feeling|mood|vibes?\\w*|vibing|chill\\w*',
  'hanging|hang|kickin\\w*|sittin\\w*|chilling|relax\\w*|unwind\\w*|bored|board|sleep\\w*|tired|energy',
  'morning|afternoon|evening|night|day|today|tomorrow|tonight|now|asap|pls|please|here|there|around|about',
  'alive|awake|asleep|busy|free|single|alone|same|alright|later|l8r|thanks|thank|ty|cheers|appreciate\\w*',
  'welcome|np|was|were|be|been|being|have|has|had|would|could|should|might|must|will|shall|can|cant',
  'say|saying|says|said|talk|talking|chat|chats|chatting|catch|catching|meet|meeting|connect|checking|check',
  'browse|browsing|look|looking|see|seeing|watch|watching|go|going|coming|send|sending|give|giving|take|taking',
  'make|making|whatever|anything|everything|something|any|some|this|that|these|those|and|or|but|if|then',
  'too|also|very|quite|rather|of|to|for|with|at|in|on|up|down|out|off|by|from|as|because|why|when|where',
  'who|whom|whose|which|yes\\w*|im|i|m',
].join('|');
// the alternatives are only safe inside word boundaries: without them "moyo"
// loses "yo" and a member's name stops being a name
const SMALL_RX = new RegExp('\\b(?:' + SMALL_PARTS + ')\\b', 'gi');
// A command word in front is never banter, however short: "meet 1" and "cards" are
// instructions with almost no content, and they must not read as small talk.
const CMDISH_RX = /^\s*(?:\/\w*\s+)?(?:meet|unskip|skip|approve|decline|send|edit|cards|more|why|draft|intro|forget|memory|facts|limits|profile|help|start|connect|link|unlink|campaigns?|audit|mute|unmute|status)\b/i;
// Small talk that DOES want the pitch: "what can you do", "who are you".
const HELPISH_RX = /\b(?:what\s+(?:can|do|are|should)\s+you|how\s+do\s+you\s+work|who\s+are\s+you|what\s+is\s+(?:this|linky|it)|what\s+can\s+linky|help\b|explain\b|what\s+do\s+you\s+do)\b/i;
// the residue of a message once every small-talk word is stripped out
const substance = (words) => String(words || '').replace(SMALL_RX, ' ').replace(/[^a-z0-9+#.\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2);

export function parseAsk(message) {
  const need = text(message, 300);
  const all = need.toLowerCase();
  let offer = '';
  if (OFFER_RX.test(all)) offer = 'paid';
  else if (/\b(equity|co-?founder|cofounder|shares|stake|partner)\b/.test(all)) offer = 'equity';
  else if (/\b(advis\w*|mentor\w*|guidance|coach\w*)\b/.test(all)) offer = 'advisory';
  else if (/\b(coffee|chat|casual|meet up|catch up|20 minutes|call)\b/.test(all)) offer = 'coffee';
  let location = '';
  const loc = all.match(/\b(?:in|from|based in|around|near)\s+([a-z][a-z\s]{2,30})\b/);
  if (loc) location = text(loc[1].split(/\s+(?:and|or|who|that|with|for|to|on|at|doing|building)\b/)[0], 60);
  const remote = !/\b(in person|in-person|local only|must be in|physically)\b/.test(all);
  const raw = tokens(need).filter((t) => !location || !location.toLowerCase().split(/\s+/).includes(t));
  const kws = uniq(raw.flatMap(stemVariants));
  // Role words ("developer", "designer", "founder") are never a name query,
  // even when typed with a capital - "Find me a Developer" is a search.
  const names = namePhrases(need).filter((p) => !p.split(/\s+/).some((w) => CONCEPT_BY_ALIAS.has(w.toLowerCase())));
  return {
    need, offer, location, remote, tokens: kws, expanded: expandTerms(raw), norm: raw.slice().sort().join(' '),
    // same rule for the name lookup itself, so "cards" is not a phantom person
    nameQuery: names.find((nm) => substance(nm).length) || '',
    nameAttempts: names.filter((nm) => substance(nm).length),
    // Two asks with the same keywords but different people are different asks,
    // so the name is part of the identity of the ask (cache key included).
    norm: [raw.slice().sort().join(' '), names[0] ? `@${names[0].toLowerCase().replace(/\s+/g, '')}` : ''].filter(Boolean).join(' ').trim(),
    reflective: REFLECT_RX.test(all) && !ORDER_RX.test(all),
    command: ORDER_RX.test(all),
    wantsDraft: DRAFT_RX.test(all) && !/[a-z]{4,}\s+(developer|designer|engineer|marketer|lawyer|analyst)/i.test(all),
    wantsElse: ELSE_RX.test(all),
    bare: BARE_RX.test(need.trim()),
    // Chit-chat outranks "there are nouns here", but a single role word pulls it
    // back to a real ask: "just want to chat about a flutter developer" is a search.
    // "is this small talk" must be decided by whether there is anything to search
    // for, not by whether a name-shaped substring exists - namePhrases() calls
    // "you a real person" a name, and that is how a chat turned into "nobody fits".
    // "is this small talk" has to be decided by whether there is anything to
    // search for - not by whether a name-shaped substring exists. namePhrases()
    // happily calls "you a real person" a name, and that is how a chat turned
    // into "nobody fits you". Each veto below is a real search signal.
    // Nothing but greeting/filler/banter left after stripping SMALL_RX: the member
    // is talking. Searching for that is how "yoo" became "Nobody here fits yoo".
    smallTalk: (() => {
      if (CMDISH_RX.test(all) || ORDER_RX.test(all) || DRAFT_RX.test(all) || ELSE_RX.test(all)) return false;
      // a "name" made of nothing but small-talk words is not a name: namePhrases()
      // happily hands back "yoo" and "you there", and that is what turned a greeting
      // into a directory search of 56 profiles
      if (ROLEISH_RX.test(all) || REFLECT_RX.test(all)) return false;
      if (names.some((nm) => substance(nm).length)) return false;
      if (location && location.split(/\s+/).length <= 2) return false;
      if (offer && offer !== 'coffee') return false;
      return substance(all).length === 0;
    })(),
    // "what can you do" / "who are you": a chat turn that wants the pitch.
    askedWhatYouDo: HELPISH_RX.test(all),
    chitChat: (() => {
      if (!CHIT_RX.test(all)) return false;
      if (ROLEISH_RX.test(all)) return false;                              // a role, a skill, a trade
      // "coffee" is what OFFER_RX calls any message containing the word chat,
      // so it cannot veto a chat on its own - the other vetoes still apply
      if (offer && offer !== 'coffee') return false;                          // paid / equity / advisory
      if (location && location.split(/\s+/).length <= 2) return false;     // a place they could mean
      if (names.some((p) => p.split(/\s+/).length >= 2 && /[A-Z][a-z]{2,}/.test(need))) return false;
      return true;
    })(),
  };
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
    role: scrubHidden(text(p.occupation, 100), [...told.hidden.skills, ...told.hidden.industries]),
    country: text(p.country, 80),
    skills: minusHidden(uniq([...list(p.skills, 12), ...told.skills]).slice(0, 20), told.hidden.skills),
    industries: minusHidden(list(p.industries, 8), told.hidden.industries),
    lookingFor: minusHidden(uniq([...list(p.lookingFor, 6), ...told.lookingFor]).slice(0, 10), told.hidden.lookingFor),
    company: told.hidden.company ? '' : scrubHidden(text(p.company, 120), told.hidden.skills),
    city: told.hidden.city ? '' : text(p.city, 80),
    bio: [told.hidden.bio ? '' : text(p.bio, 240), told.hidden.notes ? '' : told.notes].filter(Boolean).map((x) => scrubHidden(x, told.hidden.skills)).filter(Boolean).join(' ').slice(0, 700),
    remoteOnly: !!p.remoteOnly,
  };
}

// ---------------------------------------------------------------- person lookup
// "fred", "message Luke Tembani", "is Ania on here" are requests for a HUMAN.
// The keyword matcher cannot answer those (a first name is not a skill), and
// answering them with "nobody fits" is exactly what made Linky feel dead.
// So names get their own pass - over every visible member, not only the ones
// currently open to an intro, because "is Fred here?" is a question about
// existence: we can explain a closed door instead of denying the room.
const nameKey = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
const nameTokens = (s) => nameKey(s).split(' ').filter((w) => w.length > 1);

// "fred" is a substring of "freda ncube" but it is not that person's name, so
// containment has to be measured in whole tokens, never in characters.
const tokensInclude = (hay, needle) => {
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) if (hay[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
};

export function scoreNameMatch(query, targetName) {
  const q = nameTokens(query);
  const t = nameTokens(targetName);
  if (!q.length || !t.length) return 0;
  const qFull = q.join(' ');
  const tFull = t.join(' ');
  if (qFull === tFull) return 100;
  if (tokensInclude(t, q)) return 92;
  if (q.length >= 2 && tokensInclude(q, t) && t.length >= 2) return 88;
  let score = 0;
  for (const w of q) {
    let best = 0;
    for (let i = 0; i < t.length; i += 1) {
      const n = t[i];
      let v = 0;
      if (n === w) v = 40;
      else if (w.length >= 3 && (n.startsWith(w) || w.startsWith(n))) v = 32;
      else if (w.length >= 4 && n.includes(w)) v = 24;
      else if (n.length >= 4 && w.includes(n)) v = 20;
      // one typo at the tail: "fredddie" -> "fred"
      else if (w.length >= 5 && n.length >= 4 && n.startsWith(w.slice(0, Math.max(3, w.length - 2)))) v = 16;
      if (v && i === 0) v += 8;
      if (v && t.length > 1 && i === t.length - 1) v += 4;
      best = Math.max(best, v);
    }
    if (!best) return 0; // every word of the name has to land
    score += best;
  }
  return score;
}

// Why an intro to this member is not possible right now ('' means it is).
function introBlocker({ meUid, p, st, myState, ctx, prev, offer, now = Date.now() }) {
  if ((myState.muted || {})[p.uid]) return 'you asked me not to suggest them again';
  if (prev && prev.status === 'declined') return 'you two already said no to each other';
  if (st.muted && st.muted[meUid]) return 'they have Linky switched off for new intros';
  if (prev && prev.status === 'skip' && now - toMillis(prev.updatedAt || prev.createdAt) < LIMITS.skipDays * DAY_MS) {
    const who = firstName(String(p.fullName || p.displayName || '').trim()) || 'them';
    return `you skipped them recently, so I left them alone - say "unskip ${who}" and they are back`;
  }
  if (offer && Array.isArray(st.openTo) && st.openTo.length && !st.openTo.includes(offer)) {
    const label = (o) => (o === 'paid' ? 'paid work' : o);
    return `they are open to ${st.openTo.map(label).join(' / ')} right now, not ${label(offer)}`;
  }
  const cap = Number.isFinite(Number(st.inboundCap)) ? Number(st.inboundCap) : LIMITS.inboundPerWeek;
  if (cap <= 0) return 'they have intro requests switched off';
  if (st.inbound && st.inbound.week === ctx.week && Number(st.inbound.count || 0) >= cap) return `they have used all ${cap} intro requests for this week`;
  return '';
}

// Best name matches over every candidate. Returns null when nothing clears
// the bar. `others` = near-ties worth showing so "fred" can ask "which Fred?".
export function findByName(q, ctx, { meUid, exclude = [], myState = {}, existingCards = [] } = {}) {
  const attempts = uniq((q.nameAttempts && q.nameAttempts.length ? q.nameAttempts : (q.nameQuery ? [q.nameQuery] : []))
    .map((s) => String(s || '').trim())
    // keep the meaningful words of the name, drop the connective tissue
    .map((s) => s.split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w.toLowerCase())).join(' ').trim())
    .filter((s) => s.length >= 2));
  if (!attempts.length) return null;
  const skip = new Set([meUid, ...exclude]);
  const latestByTarget = new Map();
  existingCards.forEach((c) => latestByTarget.set(c.targetUid, c));
  const now = Date.now();
  const scored = [];
  for (const p of ctx.candidates) {
    if (skip.has(p.uid)) continue;
    const st = ctx.states[p.uid] || {};
    const facts = candidateFacts(p, st);
    let best = 0;
    let phrase = '';
    for (const a of attempts) {
      const s = scoreNameMatch(a, facts.name);
      if (s > best) { best = s; phrase = a; }
    }
    if (best < 40) continue;
    const blocked = introBlocker({ meUid, p, st, myState, ctx, prev: latestByTarget.get(p.uid), offer: q.offer, now });
    scored.push({ uid: p.uid, facts, score: best, phrase, st, blocked });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || (b.facts.skills.length - a.facts.skills.length));
  const top = scored[0];
  // "fred" must not stall because a "Freda" exists: that is a clear winner with
  // a weaker runner-up. A real tie is when two people score the same, in which
  // case guessing is worse than asking. 4 points is inside the noise of the
  // name scoring (first-name bonus vs surname bonus).
  const tie = scored.length > 1 && top.score - scored[1].score <= 4;
  return {
    match: top, tie,
    others: tie ? scored.slice(1, 4) : scored.slice(1).filter((x) => x.score >= top.score - 12).slice(0, 1),
    all: scored.slice(0, 4),
    attempts,
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
  if (!aiReady()) return null;
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

// The opener is the first line a stranger reads, so it carries the actual
// evidence instead of adjectives: who is asking, why THIS person, one small ask.
const templateOpener = (c, need) => {
  const bit = [c.role ? `${/^[aeiou]/i.test(c.role) ? 'an' : 'a'} ${c.role}` : '', c.company ? `at ${c.company}` : '', c.city ? `in ${c.city}` : '']
    .filter(Boolean).join(' ');
  const hook = c.skills?.length ? `I am looking for ${need}, and your ${c.skills[0]} is what made me stop on your profile.` : `I am looking for ${need}, and Linky says you are the closest thing to it here.`;
  return `Hi ${firstName(c.name)} - ${bit ? `you are ${bit} ` : ''}and ${hook} Worth 15 minutes this week? If the timing is bad, no worries at all.`;
};

// The only Gemini call in the ask flow. Compact on purpose.
async function geminiRerank(q, requester, shortlist) {
  if (!getGeminiKey()) return null;
  const prompt = [
    'You are Linky, the connector for LINKUP (builders, founders and operators, Harare-first).',
    'Sound like a warm, sharp, well-connected friend who is good at intros: plain human sentences, no corporate filler, no emojis, never invent a fact.',
    `A member asked: "${q.need}"${q.offer ? ` (offer: ${q.offer})` : ''}${q.location ? ` (location: ${q.location}${q.remote ? ', remote fine' : ', in person'})` : ''}.`,
    'Pick which candidates are genuinely worth an introduction for that ask. Cite-or-skip: every "why" must quote a concrete fact from that candidate\'s record (a skill, role, company, city or bio detail). No evidence = leave them out. Never invent facts. Return an empty list rather than guess.',
    'Return STRICT JSON only: {"picks":[{"uid":"...","score":0-100,"why":"one plain sentence, under 26 words, citing the evidence","opener":"the first line the member sends, under 30 words: says who they are looking for, names ONE true thing about this person from the profile, and asks one small question that is easy to answer yes to"}]}',
    'An opener must never flatter ("your impressive work"), never sell ("exciting opportunity"), never say "I hope this finds you well". Specific beats charming: "saw you shipped EcoCash in 9 weeks - can I ask how you handled the agent float?" is the bar.',
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

// Who on LINKUP fits this ask, right now. Returns ranked picks (with cited
// "why"), the nearest people when nobody fits, and how many members were checked.
export async function findPeople(uid, q, ctx, { user, state, existingCards = [], exclude = [] } = {}) {
  const owner = user || (await loadUser(uid));
  const myState = state || ctx.states[uid] || {};
  const me = mergedFacts(owner, myState) || { uid, name: 'Member', skills: [], industries: [], lookingFor: [], bio: '', notes: '' };
  const muted = myState.muted || {};
  const now = Date.now();
  const latestByTarget = new Map();
  existingCards.forEach((c) => latestByTarget.set(c.targetUid, c));
  const excludeSet = exclude instanceof Set ? exclude : new Set(exclude || []);
  const eligible = [];
  for (const p of ctx.candidates) {
    if (p.uid === uid || muted[p.uid] || excludeSet.has(p.uid)) continue;
    const st = ctx.states[p.uid] || {};
    if (introBlocker({ meUid: uid, p, st, myState, ctx, prev: latestByTarget.get(p.uid), offer: q.offer, now })) continue;
    eligible.push(candidateFacts(p, st));
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
  const loc = askLocKnown ? askLoc : String(me.city || '').toLowerCase();
  const compat = new Map(localRank(compactProfile({ uid: me.uid, role: me.role, skills: me.skills, industries: me.industries, goals: me.lookingFor }), eligible.map((c) => compactProfile({ ...c, occupation: c.role })), eligible.length).map((r) => [r.uid, r.score]));
  return eligible
    .map((c) => ({ c, s: (loc && c.city && loc.includes(c.city.toLowerCase()) ? 3 : 0) + ((compat.get(c.uid) || 40) - 40) / 10 + (c.pic ? 0.25 : 0) + (c.role ? 0.25 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(({ c }) => ({ uid: c.uid, name: c.name, pic: c.pic, role: c.role, city: [c.city, c.country].filter(Boolean).join(', ') }));
}

// ---------------------------------------------------------------- ask (the whole flow, one request)
const COACH = 'Tell me who you need and I will go and look - a role, a skill, a city, or even just a name. "A Flutter developer in Harare for a paid fintech MVP", "a co-founder with sales experience, equity", "someone who has raised from local angels", "Fred Moyo".';

const personLine = (n) => `${n.name}${n.role || n.city ? ` (${[n.role, n.city].filter(Boolean).join(', ')})` : ''}`;

// Quick-reply chips. The wording engine may return better ones for a specific
// answer; these are the floor, and they are what the app/bot show when Gemini
// is unavailable. Bots get commands, the app gets sentences it can send back.
const COACH_CHIPS = ['A Flutter developer in Harare for a paid fintech MVP', 'A co-founder with sales experience, equity', 'Someone who has raised from local angels'];
const BOT_CHIPS = ['a flutter developer in harare', 'a fintech lawyer in harare', 'help'];
const FOUND_CHIPS = { app: ['meet 1', 'who else do you have', 'write me a first message'], bot: ['meet 1', 'cards', 'more'] };
const NONE_CHIPS = { app: ['Where to look outside LINKUP', 'Try a role instead', 'What Linky knows about me'], bot: ['MORE', 'cards', 'prefs'] };

// Every reply is a turn in a thread, so the app can show an actual
// conversation instead of a single answer that replaces the last one.
function threadOf(state) {
  return (Array.isArray(state?.chat) ? state.chat : []).filter((t) => t && t.text);
}

async function appendThread(uid, state, turns) {
  const next = [...threadOf(state), ...turns].slice(-LIMITS.threadTurns);
  await patchState(uid, { chat: next });
  return next;
}

// ---------------------------------------------------------------- how Linky talks
// Linky's personality is written by Gemini, at answer time, on every channel:
// the app, Telegram and WhatsApp all call ask(), so one prompt shapes all
// three. What the matcher decides (who fits, what is on their profile) stays
// deterministic and cited; Gemini only ever decides the WORDS, from a dossier
// of proven facts, and is told to add nothing.
//
// Cost control, since this runs inside an ask:
//   - one call per answer, at most ~220 output tokens, no tools, no history;
//   - the wording is cached in linkyCache/v_* per (kind, ask, channel) and
//     shared across members, so the 40th person asking for "a flutter
//     developer in Harare" costs zero tokens;
//   - the member's own name is prepended locally, never by the model, which is
//     what makes a shared cache line still read like it was written for you;
//   - no key, an error, or junk JSON -> plainReply() below answers instead.
//     A member never sees a failure, they see a shorter, blunter Linky.
const VOICE_KINDS = {
  chat: 'This is a person talking to you, not a search. React to what they actually said first - answer it, tease it, agree with it, disagree - and that is enough. Do not open with a pitch, do not say "tell me what you need", and do not list example searches unless they asked what you can do. If they said they are not looking for anybody, drop it entirely and just be good company. Match their length: two words from them is one line from you. A joke, an opinion or one emoji is allowed here. Never mention profiles you did not search, never say "nobody fits", never sign off like support.',
  help: 'They asked what you are or what you can do. Explain it the way you would to a friend in a WhatsApp thread: what you are for, one line; what you can actually do, two or three short lines; then hand them one specific thing to try. No bullet points, no "features", no corporate name for the app.',
  found: 'The matcher found people. Be pleased for them the way a friend is pleased, not the way a press release is. Mention how many in passing, point at why they are worth a look, and let the cards do the bragging.',
  close: 'Nobody matched their words exactly, but adjacent people are worth a look. Say it cheerfully and never as an apology - "close enough to be useful" is a normal answer, not a failure.',
  none: 'The matcher found nobody. Be straight and a little dry, zero ceremony: nobody here, and you are not going to invent somebody. One apology maximum, then the next move - and make the next move sound easy, not like a form.',
  person: 'They asked for a human by name and you found them. Hand the name over quickly, like a friend who already knew where they were. No ceremony, and never "I am happy to inform you".',
  ambiguous: 'More than one member could be who they mean. Ask which one in one short line that contains both names. Admitting the doubt is charming here; guessing is not.',
  draft: 'Write the message they should send. It must sound like a person wrote it two minutes ago: specific, warm, easy to answer, no flattery padding, no "I hope this finds you well".',
  check: 'They are thinking out loud, not ordering a search. Respond to the actual thought first - one honest observation, a small challenge if the thought deserves one, no flattery - then ask, in one line, whether you should look for people. Do NOT list anybody, do not pretend you searched, and do not sound like a menu. Two sentences then the question.',
  limit: 'They are out of searches for today. Say it lightly, never with corporate regret, and be useful about it: what is still free (looking someone up by name) and what tomorrow brings. Do not lecture about pricing.',
};

// Kinds that must be written fresh every time: caching a greeting for fourteen days
// is exactly how a personality turns into a answering machine.
const NO_CACHE_KINDS = new Set(['chat', 'check', 'help', 'ambiguous']);

// A day of AI trouble, counted where a human can actually read it. When a member
// says "Linky has no personality", the honest answer is usually this doc: the model
// never answered, so a hard-coded sentence went out instead.
async function noteAiFault(kind, err) {
  try {
    const st = aiStatus();
    const ref = db().collection('linkyOutreach').doc(`ai_err_${dayKey(Date.now())}`);
    const snap = await ref.get().catch(() => null);
    const prev = snap && snap.exists ? snap.data() : {};
    await ref.set({
      kind: 'ai-wording',
      at: Date.now(),
      count: Number(prev.count || 0) + 1,
      lastKind: text(kind, 24),
      lastError: text(err && err.message ? err.message : err, 300),
      providers: { gemini: st.gemini.configured, geminiFrom: st.gemini.from, model: st.gemini.model, zen: st.zen.configured, zenFrom: st.zen.from },
    });
  } catch { /* a diagnostic write must never be what broke the reply */ }
}

/** How many times the model failed to answer today (Firestore console, or ?action=diag). */
export async function lastAiFault() {
  const day = dayKey(Date.now());
  try {
    const snap = await db().collection('linkyOutreach').doc(`ai_err_${day}`).get();
    if (!snap || !snap.exists) return { day, count: 0 };
    const d = snap.data();
    return { day, count: Number(d.count || 0), lastKind: d.lastKind || '', lastError: d.lastError || '', at: toMillis(d.at) || 0, providers: d.providers || null };
  } catch {
    return { day, count: -1, error: 'unreadable' };
  }
}

async function geminiWording(kind, dossier, { source = 'app', seed = '' } = {}) {
  if (!aiReady()) return null;
  // A greeting kept for a fortnight is how a personality turns into an answering
  // machine, so chit-chat, follow-up questions and tie-breakers are written fresh.
  if (NO_CACHE_KINDS.has(kind)) return wordingOnce(kind, dossier, source, seed, null);
  const ref = db().collection('linkyCache').doc(cacheKey('v', `${kind}|${source}|${seed}`));
  try {
    const snap = await ref.get().catch(() => null);
    if (snap && snap.exists && Date.now() - toMillis(snap.data().createdAt) < 14 * DAY_MS) {
      return { reply: text(snap.data().reply, 600), suggest: list(snap.data().suggest, 3, 40) };
    }
  } catch { /* cache miss is just a miss */ }
  return wordingOnce(kind, dossier, source, seed, ref);
}

async function wordingOnce(kind, dossier, source, seed, ref) {
  const channelNote = source === 'app'
    ? 'It appears in a chat bubble inside the LINKUP app, next to tappable chips.'
    : `It is a ${source === 'telegram' ? 'Telegram' : 'WhatsApp'} message: plain text, under 260 characters, no links in the reply.`;
  const prompt = [
    'You are Linky, the connector at LINKUP - a network of founders, builders and operators, Harare first.',
    'Your voice: charismatic, warm, quick, funny in an easy way - the chatbot everybody wishes their app had. You are the well-connected friend everyone texts when they need somebody, and you enjoy it. Contractions, short sentences, rhythm that changes. Light teasing is fine when it is kind. Never stiff, never a customer-service script, never breathless, never three exclamation marks, never fake enthusiasm about something that is not exciting.',
    'At most ONE emoji, and only in chit-chat or a greeting. Never in an answer that lists people, never as decoration.',
    'Style is presentation, never substance: you may not soften, pad, hedge or invent a fact to sound nicer. If the honest answer is "nobody", that is the answer they get - said like a human.',
    VOICE_KINDS[kind] || VOICE_KINDS.chat,
    channelNote,
    'Write 1-3 short sentences of plain text. Start with a capital letter. No markdown, no asterisks, no bullet symbols, no hashtags, and no emoji unless this is chit-chat (then one at most). Banned corporate filler: "leverage", "I hope this finds you well", "unfortunately", "I am sorry to inform you", "great question", "absolutely!", "feel free to", "rest assured", "at your convenience", "please do not hesitate Do not greet with the member\'s name and do not use any name that is not in the dossier.',
    'Only use facts from the dossier. Never add a person, skill, city, company or number that is not there. Never say a message was sent, an intro was made or a reply arrived - Linky asks, people answer.',
    'Return STRICT JSON only: {"reply":"the message","suggest":["up to 3 things they might tap next, each under 34 characters, in THEIR voice, e.g. who else do you have"]}',
    `Dossier: ${JSON.stringify(dossier).slice(0, 2400)}`,
  ].join('\n');
  try {
    // aiText, not geminiText: OpenCode Zen carries the same voice when Gemini is
    // down, out of quota or missing a key - which is the difference between a
    // person and a form.
    const { text: raw, provider } = await aiText(prompt, { temperature: kind === 'chat' || kind === 'help' ? 1 : 0.85, maxOutputTokens: 280, responseMimeType: 'application/json' });
    const parsed = JSON.parse(String(raw).slice(String(raw).indexOf('{'), String(raw).lastIndexOf('}') + 1));
    const reply = text(parsed && parsed.reply, 600);
    if (!reply || reply.length < 12) throw new Error('model returned nothing usable');
    const out = { reply, suggest: list(parsed.suggest, 3, 40), provider };
    if (ref) await ref.set({ kind, source, seed, reply: out.reply, suggest: out.suggest, provider, createdAt: Date.now() }).catch(() => {});
    return out;
  } catch (err) {
    console.warn('[linky] wording call failed, using plain reply', err && err.message ? err.message : err);
    await noteAiFault(kind, err).catch(() => {});
    return null;
  }
}

// The safety net: no key, or Gemini down/over quota. Deliberately short and
// factual - it cites what the matcher proved and adds nothing.
// The safety net: no key, or Gemini down / over quota / bad JSON. Deliberately
// short and factual, and it reads the same dossier keys the model gets, so the
// two paths can never drift apart in what they are allowed to claim.
const cap1 = (s) => { const t = String(s || '').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };
// A bot bubble has no Meet button next to it, so the fallback has to say how
// to act. The app gets the button, so it gets no instruction.
const ctaFor = (d) => (d.channel && d.channel !== 'app' ? ' Reply "meet 1" (or 2, 3) and I will ask them.' : '');
function plainReply(kind, d = {}) {
  const matches = Array.isArray(d.matches) ? d.matches : [];
  const count = matches.length || Number(d.count || 0);
  const nearest = Array.isArray(d.closest_instead) ? d.closest_instead : (Array.isArray(d.nearest) ? d.nearest : []);
  const who = nearest.length ? ` Closest here: ${nearest.map(personLine).join(', ')}.` : '';
  switch (kind) {
    case 'found': return `${count} ${count === 1 ? 'person fits' : 'people fit'} "${d.need}". I picked them for a reason and it is on each card - the profile line, not my opinion.${d.remote_only_note ? ` ${cap1(d.remote_only_note)}.` : ''}${ctaFor(d)}`;
    case 'close': return `Nobody lists "${d.need}" word for word, but ${count} ${count === 1 ? 'person is' : 'people are'} close (${d.matched_on || 'related skills'}). The card says exactly what I matched.${ctaFor(d)}`;
    case 'none': {
      const scanned = Number(d.members_checked || 0) > 0 ? `all ${d.members_checked} visible profiles` : 'every visible profile';
      return `Nobody here fits "${d.need}" - I read ${scanned} and I am not going to invent somebody to fill the gap.${who}${d.outside_hint ? ` ${cap1(d.outside_hint)}.` : ''}`;
    }
    case 'person': {
      const f = d.found || d.person || {};
      const label = [f.role, f.city].filter(Boolean).join(', ');
      if (d.already_connected) return `You and ${f.name} are already connected - your chat is in Messages.`;
      if (d.cannot_introduce_because) return `${f.name}${label ? ` (${label})` : ''} is on LINKUP. ${cap1(d.cannot_introduce_because)}, so I did not push a request. Their profile is one tap away.`;
      return `${f.name}${label ? ` (${label})` : ''} is on LINKUP - I found them by name.${d.channel && d.channel !== 'app' ? ' Reply meet 1 and I will ask them for you.' : ' Hit Meet and I will ask them for you.'}`;
    }
    case 'ambiguous': return `I have ${(d.people || []).length} members who could be who you mean: ${(d.people || []).map((x) => x.name).join(', ')}. Which one?`;
    case 'check': return `That is worth chewing on${d.need ? `: ${text(d.need, 90)}` : ''}. My honest take is you will decide better once you know who is actually around. Should I search for them? I will name the ones who fit and say plainly if there are none.`;
    case 'chat': {
      const lines = [
        'I am here - no search, no agenda. What is going on with you?',
        'Fair enough. I am a well-connected friend with too much free time. How is it going?',
        'Noted - nothing to find, nobody to impress. How is the work treating you?',
        'haha. Say the word when you want names, until then I am good company.',
      ];
      const first = text(d.name, 24);
      // the streak is in the rotation so two fallback lines in a row differ
      const pick = lines[(hash32(String(d.seed || '')) + Number(d.streak || 0)) % lines.length];
      return first ? `${first} - ${pick}` : pick;
    }
    case 'help': return 'I am Linky - the connector here. Tell me who you need and I read every member profile and bring you the ones that fit: a Flutter developer in Harare, a co-founder who can sell, someone who has raised from local angels. When nobody fits I say so, and I can go and look outside LINKUP too.';
    case 'limit': return `That is today's ${d.asks_limit_today || d.limit} asks used up. It resets at ${d.resets || 'midnight'}, and PLUS gets ${d.plus_asks_per_day || d.plusLimit || LIMITS.plus.asksPerDay} a day. Looking someone up by name is free either way.`;
    case 'draft': return d.ready_message || 'Tell me who the message is for and I will write it - then you send it yourself, from your own account.';
    default: return 'So what do you need? A role, a skill, a city, or just a name - I will go and look through the network right now and tell you exactly who fits.';
  }
}

const pickGreeting = (seed = '', first = '') => [`Hey ${first}`, `${first}`, `Hi ${first}`][hash32(String(seed)) % 3];
function hash32(s) { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h | 0); }

// One call site for every Linky sentence: model first, safety net second, and
// the member's own name prepended locally so cached wording stays personal.
async function linkySay(kind, dossier, { name = '', source = 'app', seed = '', fallback } = {}) {
  const said = await geminiWording(kind, { situation: kind, ...dossier }, { source, seed });
  const body = said ? said.reply : (fallback || plainReply(kind, dossier));
  const suggest = said && said.suggest.length ? said.suggest : (dossier.suggest || []);
  const first = firstName(name);
  // a member's name belongs on an answer about people, not on every "yoo"
  const greet = kind === 'found' || kind === 'close' || kind === 'person' || kind === 'draft';
  const alreadyGreeted = /^(hey|hi|hello|good (morning|afternoon|evening)|afternoon|morning|evening|yo)\b/i.test(body);
  const reply = greet && first && first !== 'there' && !alreadyGreeted && !body.toLowerCase().includes(first.toLowerCase())
    ? `${pickGreeting(seed, first)}. ${body}`
    : body;
  return { reply: text(reply, 700), suggest: list(suggest, 3, 40), usedAi: !!said };
}


// Where to look when LINKUP does not have the person. Two layers:
//   1. the outreach agent (api/_serpapi.js) - real public profiles from the
//      open web, pre-filtered locally and batch-scored in as few Gemini calls
//      as the profile count needs, budgeted against the SerpApi plan;
//   2. advice - one small Gemini call, cached per ask for 7 days across
//      members, with a static fallback when there is no key.
// Only for asks the member actually made (bounded by the ask budget), and a
// cache hit costs neither a SerpApi search nor a token.
// Models wrap JSON in prose or a fence often enough that a parse has to survive
// it. Returns null rather than throwing - every caller has a written fallback.
function readJson(raw) {
  const t = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

// A lead is identified by its profile URL when there is one, else by the name in
// lower case - enough to remember "you already wrote to this person" and "you told
// me you are not interested in them" without inventing a member record for a
// stranger.
export const leadKey = (l) => {
  const url = String(l?.url || '');
  const m = url.match(/linkedin\.com\/in\/([^\/?#]+)/i);
  if (m) return `in:${m[1].toLowerCase()}`;
  if (url) { try { return `u:${new URL(url).pathname.toLowerCase()}`; } catch { /* fall through */ } }
  return `n:${String(l?.name || '').toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')}`;
};
const leadHit = (key, set) => !!key && set.has(key);

// The member's own outreach history, which is what makes this a graph and not a
// search box: who they wrote to, who turned them down, who is never to be shown again.
export function outreachTrail(state) {
  const t = Array.isArray(state?.outreach) ? state.outreach : [];
  const muted = new Set(Object.keys(state?.outreachMuted || {}));
  const sent = new Set();
  const declined = new Set();
  t.forEach((e) => {
    if (!e?.key) return;
    if (e.status === 'sent') sent.add(e.key);
    if (e.status === 'declined' || e.status === 'not_interested') declined.add(e.key);
  });
  return { entries: t, muted, sent, declined, pending: state?.pendingLead || null, pendingMeet: state?.pendingMeet || null };
}

// "find a 5 star tutor" is an instruction to Linky, not the name of a person.
// Repeating the whole ask back at someone is what makes a reply read like a
// search log, so the ask gets reduced to the thing they are after.
const NEED_NOISE = /^(?:hey\s+|hi\s+|please\s+|so\s+|look\s+)?(?:can you |could you |would you |will you |do you know )?(?:i\s+(?:really\s+|badly\s+)?(?:need to find|need|want to find|want|am looking for|am searching for|would like)|we\s+(?:are|'re)\s+looking for|find(?: me)?|looking for|look for|search for|need(?:s)? to find|need|want|help me find|introduce me to|connect me to|connect me with|get me|set me up with|any)\s+(?:a|an|some|the|my|one)?\s+/i;
export function polishNeed(need) {
  let t = String(need || '').replace(/\s+/g, ' ').trim().replace(/[.?!;,:]+$/g, '');
  for (let i = 0; i < 3; i += 1) {
    const prev = t;
    t = t.replace(NEED_NOISE, '').replace(/^(?:me|for|to)\s+/i, '').trim();
    if (t === prev) break;
  }
  t = t.replace(/\b(\d+)\s*star\b/gi, '$1-star')
    .replace(/\s+(?:right now|asap|today|tomorrow|urgently|now)$/i, '')
    .replace(/[.?!;:]+$/g, '');
  return text(t || need, 80);
}

// Place names come out of the parser lowercase ("oslo"), which is how a reply
// starts to read like a log file. Display gets them capitalised; the search query
// keeps what it had, so the 7-day result cache still hits and no credit is spent.
export function showPlace(v) {
  return text(String(v || '')
    .replace(/\b[a-z]{2,}\b/g, (w, i, str) => (i && /[^\s,]/.test(str[i - 1]) ? w : w[0].toUpperCase() + w.slice(1)))
    .replace(/\b(Usa|Uk|Eu|Us|Za|Nz|Zimb)\b/g, (m) => m.toUpperCase()), 60);
}

// Linky never announces the box he is inside, and the model sometimes starts a
// sentence with the label the client already printed above it.
const tidyIntroLine = (v) => text(String(v || '')
  .replace(/^\s*(?:outside\s+(?:of\s+)?link(?:up)?)\s*[\-:,.]?\s*/i, '')
  .replace(/\s*\boutreach line\b[\s:\-].*$/i, ''), 320);

// Where to look when a search came back empty. Same three routes a person would
// try themselves, in the order that actually gets an answer.
function fallbackRoutes(need, place) {
  const terms = String(need || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((t) => t.length > 3 && !['with', 'that', 'this', 'from', 'have', 'into', 'your', 'they', 'them', 'want', 'need', 'looking', 'somebody', 'someone', 'please'].includes(t))
    .slice(0, 3).join(' ') || need;
  const city = String(place || '').split(',')[0].trim() || 'your city';
  return [
    `LinkedIn - search "${text(terms, 80)}" with "${city}", then message the two people who posted something this month. Recent noise beats a tidy profile.`,
    `The association, institute or university department that covers it in ${city}. Ask one person who runs it - they know exactly who is doing the work.`,
    `The trade's WhatsApp or Telegram group: ask for one referral, not a list. One warm name is worth twenty cold ones.`,
  ];
}

// One renderer for every surface that only has text (WhatsApp, Telegram, a plain
// bubble). Structure in, readable lines out - no semicolon run-on, no double list.
function renderPointers({ intro = '', routes = [], leads = [] } = {}) {
  const head = text(intro, 300);
  if (leads.length) return head;
  const lines = (routes || []).filter(Boolean).slice(0, 3).map((r, i) => `${i + 1}) ${text(r, 200)}`);
  return [head, ...lines].filter(Boolean).join('\n');
}

export async function pointers(uid, need, { userDoc, allowSearch = true } = {}) {
  const user = userDoc || (await loadUser(uid));
  const q = parseAsk(need);
  if (!q.tokens.length) throw new Error('Ask me who you need first.');
  const state = await loadState(uid);
  const known = [state.lastAsk, ...(Array.isArray(state.recentAsks) ? state.recentAsks : []), ...(Array.isArray(state.askHistory) ? state.askHistory : [])]
    .filter(Boolean).some((a) => (a.norm ? a.norm === q.norm : parseAsk(a.need || '').norm === q.norm));
  if (!known) throw new Error('Ask me that first, then I can point you outside LINKUP.');
  // p2: the shape changed (intro + routes + leads instead of one long sentence),
  // so an answer written by the old code is not read at all. The search itself is
  // still served from _serpapi's 7-day result cache, so this costs no credit.
  const ref = db().collection('linkyCache').doc(cacheKey('p2', q.norm));
  const snap = await ref.get().catch(() => null);
  const me = profileFacts(user) || {};
  const place = q.location || [me.city, me.country].filter(Boolean).join(', ') || 'Zimbabwe';
  // display-only forms of the place (the search query keeps the raw string, so the
  // 7-day result cache still hits and no credit is spent re-running a warm search)
  const placeShow = showPlace(place) || 'Zimbabwe';
  const city = showPlace(String(place || '').split(',')[0].trim()) || 'Zimbabwe';
  const state2 = state;
  const trail0 = outreachTrail(state2);
  if (snap?.exists && snap.data().intro && Array.isArray(snap.data().leads)
    && Date.now() - toMillis(snap.data().createdAt) < 7 * DAY_MS) {
    const d = snap.data();
    // re-filtered on the way out, so a lead the member already wrote to (or told
    // Linky to never show again) does not come back from the cache
    const cached = (Array.isArray(d.leads) ? d.leads : [])
      .filter((l) => !leadHit(leadKey(l), trail0.muted) && !leadHit(leadKey(l), trail0.sent))
      .map((l) => ({ ...l, key: leadKey(l) }));
    let intro = tidyIntroLine(d.intro) || text(cached.length ? `A LinkedIn search I ran earlier for "${polishNeed(q.need)}" - these ${cached.length} are still the ones I would message:` : '', 300);
    let routes = list(d.routes, 3, 200);
    const skipped = Math.max(0, (Array.isArray(d.leads) ? d.leads.length : 0) - cached.length);
    // a cached answer the member has since muted people out of must not be left
    // claiming there was somebody to message, with nothing under it
    const total = Array.isArray(d.leads) ? d.leads.length : 0;
    if (!cached.length && skipped) {
      intro = `Nobody on LINKUP does "${polishNeed(q.need)}" yet, and all ${total} from that LinkedIn search are already in your outreach history - so here is where I would look myself:`;
      routes = fallbackRoutes(q.need, city || placeShow);
    } else {
      // the saved intro describes the search as it ran; once some leads have been
      // used up it over-promises, so restate the count that is actually on screen
      if (skipped && cached.length) {
        intro = `Nobody on LINKUP does "${polishNeed(q.need)}" yet. That LinkedIn search turned up ${total}: ${cached.length} ${cached.length === 1 ? 'is' : 'are'} new to you, ${skipped} ${skipped === 1 ? 'is' : 'are'} already in your outreach history, so they will not be shown twice:`;
      }
      if (!cached.length && !routes.length) routes = fallbackRoutes(q.need, place);
    }
    return {
      intro, routes, leads: cached, skipped,
      text: renderPointers({ intro, routes, leads: cached }),
      cached: true, searches: 0, found: cached.length, oneSearch: false, profileFilter: d.profileFilter || '',
    };
  }
  const plus = await isPlusUser(uid, user);

  // 1. Real leads, budget-guarded. Never throws: advice is still useful alone.
  let outreach = { leads: [], searches: 0, note: '' };
  if (allowSearch) {
    try { outreach = await findLeads(q.need, { place, plus, uid, askedBy: me.name }); } catch (err) {
      console.warn('[linky] outreach failed', err?.message || err);
      outreach = { leads: [], searches: 0, note: 'search-unavailable' };
    }
  }

  // 2. Who he found, and - only when he found nobody - where else to look.
  // The list of people is NOT baked into this prose any more. The app renders
  // rows and the bot renders buttons; every surface that used to print the same
  // five names twice, once in a paragraph and once as links, stopped doing it.
  const fresh = (outreach.leads || []).filter((l) => l && !leadHit(leadKey(l), trail0.muted) && !leadHit(leadKey(l), trail0.sent));
  const skipped = (outreach.leads || []).length - fresh.length;
  // the key travels with the lead: it is what a "not interested" or "sent" refers
  // back to on any surface, and what makes the same person stick next time
  const leads = fresh.slice(0, plus ? 8 : 5).map((l) => ({ ...l, key: leadKey(l) }));

  const needShort = polishNeed(q.need);
  let intro = '';
  let routes = [];
  if (aiReady()) {
    try {
      const brief = leads.length
        ? [
            `You are Linky, the connector for LINKUP. A member in ${city} wanted "${needShort}", LINKUP has nobody for it yet, so you ran one public LinkedIn search and found ${leads.length}.`,
            `Say ONE short thing before the list, in your own voice: what you did, and the one honest limit (public profiles, no contact details, you have not messaged anybody). Warm, dry, a flicker of humour, like a friend who actually did the favours. Max 32 words. Plain sentences, no markdown, no emoji, no "Great news!", no exclamation marks, never invent a fact. Do not start with "Outside LINKUP" - the app already printed that label.`,
            'Return STRICT JSON only: {"intro":"..."}',
          ].join('\n')
        : [
            `You are Linky, the connector for LINKUP. A member in ${city} wanted "${needShort}" and nobody on LINKUP fits.`,
            'One short honest line (max 18 words), then two or three concrete ways to find that person in ' + city + ' this week: a named kind of institution, a professional body, a community, the exact search phrase. Realistic, slightly funny, zero corporate filler. No markdown, no emoji.',
            'Return STRICT JSON only: {"intro":"...","routes":["...","..."]} - each route under 26 words, plain sentences, no numbering.',
          ].join('\n');
      const raw = await geminiText(brief, { temperature: 0.6, maxOutputTokens: leads.length ? 140 : 320, responseMimeType: 'application/json' });
      const parsed = readJson(raw);
      intro = tidyIntroLine(parsed?.intro);
      if (!leads.length) routes = list(parsed?.routes, 3, 200).map(tidyIntroLine).filter(Boolean);
    } catch (err) {
      console.warn('[linky] pointers gemini failed', err?.message || err);
    }
  }
  if (!intro) {
    // never claim a search that did not happen - on the free plan that is exactly
    // what it looks like when a member is told nothing and no reason
    const searched = (outreach.searches || 0) > 0;
    if (leads.length) {
      intro = `Nobody on LINKUP does "${needShort}" yet - that one lives outside our walls. ${outreach.cached ? 'The LinkedIn search I ran earlier turned up' : 'I ran one LinkedIn search and pulled'} ${leads.length} ${leads.length === 1 ? 'person' : 'people'} still worth a message. Public profiles only: no emails, no phone numbers, and I have not written to anybody.`;
    } else if (!searched && outreach.note && outreach.note !== 'cached') {
      // this is the "Telegram gave me nothing" case: the search never ran, so say
      // why in the member's terms instead of leaving a silent list of routes
      const why = ({
        'member-day-cap': 'you have used your LinkedIn searches for today',
        'hour-cap': 'the shared search budget needs a breather, so try again in an hour',
        'plan-exhausted': 'this month\'s search credits are used up',
        'not-configured': 'no search key is set on this deployment',
      })[outreach.note] || (String(outreach.note).startsWith('search-error') ? 'the search came back wrong' : 'the search was not available');
      intro = `Nobody on LINKUP does "${needShort}" yet. I could not run the LinkedIn search just now - ${why}. Here is where I would look in ${city} anyway:`;
    } else {
      intro = `Nobody on LINKUP does "${needShort}" yet, and one LinkedIn search in ${city} turned up nobody I would put in front of you. Not for lack of trying - here is where I would look instead:`;
    }
  }
  if (!leads.length && !routes.length) routes = fallbackRoutes(q.need, city || placeShow);
  // remembered so "draft 2" on a bot means the second person in THIS list, and so
  // the app can re-render the same five people without spending another search
  await patchState(uid, {
    lastLeads: leads.map((l) => ({ name: l.name, title: l.title, url: l.url, why: l.why, key: leadKey(l) })).slice(0, 8),
    lastLeadsAt: Date.now(), lastLeadsNeed: q.need,
  }).catch(() => {});
  const rendered = renderPointers({ intro, routes, leads });
  await ref.set({
    need: q.need, place: text(place, 60), intro, routes: routes || [], leads,
    searches: outreach.searches || 0, profileFilter: outreach.query || '', createdAt: Date.now(),
  }).catch(() => {});
  return {
    intro, routes, leads, text: rendered, cached: false, skipped,
    searches: outreach.searches || 0, note: outreach.note || '', profileFilter: outreach.query || '',
    found: leads.length, oneSearch: (outreach.searches || 0) > 0,
    place,
  };
}

// Cards for one answer, reusing a live card for the same person instead of
// duplicating it. Shared by the matcher path and the name-lookup path.
async function persistCards(uid, existing, picks, { askId, need, now }) {
  if (!picks.length) return [];
  const latestByTarget = new Map();
  existing.forEach((c) => latestByTarget.set(c.targetUid, c));
  const resultCards = [];
  const updatedIds = new Set();
  const created = [];
  picks.forEach(({ facts, score, why, opener }, i) => {
    const prev = latestByTarget.get(facts.uid);
    if (prev && ['new', 'saved', 'meet'].includes(prev.status)) {
      const next = { ...prev, askId, need, why: prev.status === 'meet' ? prev.why : why, opener: prev.opener || opener, score, updatedAt: now };
      updatedIds.add(prev.id);
      resultCards.push(next);
      return;
    }
    const card = {
      id: `${askId.slice(0, 6)}_${facts.uid.slice(0, 8)}_${i}`,
      askId,
      need,
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

// ---------------------------------------------------------------- what he wants
// The word lists below are a safety net, not the brain. Members do not type
// "find a flutter developer": they type "yoo", "yes send]", half a sentence, or
// something in a language no regex was written for. So every message is put to
// the model first and Linky is told to answer one of three things - go look,
// ask first, or just talk. A word list can only ever guess; "does this contain a
// request for people" is a meaning question, and meaning is what the model is for.
const INTENT_MODES = new Set(['search', 'ask_first', 'chat']);
export async function intentGate(message, { offer = false, lastAsk = '', source = 'app' } = {}) {
  const said = text(message, 240);
  if (!said || !aiReady()) return null;
  const ref = db().collection('linkyCache').doc(cacheKey('i3', `${said.toLowerCase()}|offer:${offer ? 1 : 0}`));
  try {
    const snap = await ref.get();
    if (snap && snap.exists && Date.now() - toMillis(snap.data().createdAt) < 24 * 3600000) {
      // the verdict is shared and reused; the WORDS never are, or a greeting
      // starts sounding like a voicemail box
      const mode = INTENT_MODES.has(snap.data().mode) ? snap.data().mode : 'search';
      return { mode, topic: text(snap.data().topic, 90), reply: '', suggest: [], cached: true };
    }
  } catch { /* a cache miss is just a miss */ }
  const prompt = [
    'You are the intent gate for LINKUP, a network of founders and builders. Linky finds the right person for a member, and only ever after being asked.',
    `The member's message (it may be slang, garbled, or half a sentence - judge meaning, not wording): ${JSON.stringify(said)}`,
    `A search was offered to them and is still open: ${offer ? 'yes' : 'no'}. Their last real ask, if any: ${JSON.stringify(text(lastAsk, 90))}.`,
    'Decide ONE mode:',
    '  "search" - they are instructing Linky to find people or send a message: "find me a flutter dev in harare", "who do you have for tax", "send an intro to Tanaka".',
    '  "ask_first" - they are thinking out loud, wondering, or describing a problem, and it is not settled that they want names right now: "who could be my co founder", "i might need someone for tax", "should i hire a lawyer".',
    '  "chat" - everything else: greetings, laughs, feelings, thanks, banter, a stray word, or anything with no person to look for.',
    'For "search" or "ask_first" also give "topic": 3-8 words naming who or what they want, in their words, no "find me" verbs. Empty string otherwise.',
    'For "ask_first" and "chat" also write "reply" - at most 2 short sentences in the voice of Linky - warm, easy, a little funny, reacting to what they actually said. "ask_first" must end by asking whether to search for them. "chat" must NOT offer to search, must not pitch, and must not mention keys, quota, errors, or what it cannot do.',
    'Never invent a person, a number or a fact. Plain text, no markdown, no emoji more than one.',
    'Return STRICT JSON only: {"mode":"search|ask_first|chat","topic":"...","reply":"..."}',
  ].join('\n');
  try {
    const { text: raw, provider } = await aiText(prompt, { temperature: 0.2, maxOutputTokens: 260, responseMimeType: 'application/json', timeoutMs: 5000 });
    const parsed = JSON.parse(String(raw).slice(String(raw).indexOf('{'), String(raw).lastIndexOf('}') + 1)) || {};
    const mode = INTENT_MODES.has(parsed.mode) ? parsed.mode : '';
    if (!mode) return null;
    const topic = text(parsed.topic, 90);
    const reply = text(parsed.reply, 420);
    await ref.set({ mode, topic: mode === 'search' || mode === 'ask_first' ? topic : '', source, createdAt: Date.now() }).catch(() => {});
    // an error sentence from a flaky provider must never reach a member
    const clean = reply.length > 8 && !/quota|billing|api key|rate limit|I cannot|couldn\'t access|error|model|timeout/i.test(reply) ? reply : '';
    return { mode, topic, reply: mode === 'search' ? '' : clean, suggest: list(parsed.suggest, 3, 40), provider, cached: false };
  } catch (err) {
    // the gate failing is not the member's problem: the word lists take over
    await noteAiFault('intent', err).catch(() => {});
    return null;
  }
}

export async function ask(uid, message, { userDoc, source = 'app' } = {}) {
  const user = userDoc || (await loadUser(uid));
  if (!user) throw new Error('Finish your LINKUP profile first.');
  const msgTyped = text(message, 600);
  if (!msgTyped) throw new Error('Say something first.');
  const now = Date.now();
  const state = await loadState(uid);
  // If Linky asked "want me to look?" a moment ago, "yes"/"no" are answers to
  // HIM - not a new search, and not small talk to be answered with a joke.
  const pendingIntent = state.pendingIntent && now - toMillis(state.pendingIntent.at) < 40 * 60 * 1000 ? state.pendingIntent : null;
  const saidWords = msgTyped.toLowerCase().trim().replace(/^\/+\w*\s*/, '');
  // only a BARE answer counts as answering him: "please find me a bookkeeper" is
  // a new instruction, and it must not be swallowed by the question before it
  const answeringYes = !!pendingIntent && saidWords.length <= 24 && AFFIRM_RX.test(saidWords) && !DENY_RX.test(saidWords);
  const answeringNo = !!pendingIntent && saidWords.length <= 32 && DENY_RX.test(saidWords);
  // a yes runs the search he offered; anything else is what they typed
  const gate = answeringYes ? null : await intentGate(msgTyped, { offer: !!pendingIntent, lastAsk: state.lastAsk?.need || '', source });
  let msg = answeringYes ? pendingIntent.need : msgTyped;
  // When the model hears an order our lists cannot read - Shona, slang, a phrase
  // with no role word in it - search what it heard. A member's own well-formed ask
  // is never rewritten, because their words are the better query and the better caption.
  const pre = parseAsk(msg);
  const wellFormed = ROLEISH_RX.test(pre.need.toLowerCase()) || !!pre.location || !!pre.nameQuery
    || (pre.command && pre.tokens.length >= 3);
  if (!answeringYes && gate?.mode === 'search' && !wellFormed && substance(gate.topic).length >= 1) msg = text(gate.topic, 160);
  const q = parseAsk(msg);
  // Anything he asks next supersedes the question he left unanswered, so a stray
  // "ok" tomorrow cannot wake an offer he forgot about. (A yes or a no is handled
  // just below; a new musing re-stores its own further down.)
  if (pendingIntent && !(answeringYes || answeringNo)) await patchState(uid, { pendingIntent: null }).catch(() => {});
  const me = profileFacts(user) || {};
  const plus = await isPlusUser(uid, user);
  const limits = plus ? LIMITS.plus : LIMITS.free;
  const today = dayKey(now);
  const used = state.asks?.day === today ? Number(state.asks.count || 0) : 0;
  const asksLeft = (extra = 0) => Math.max(0, limits.asksPerDay - used - extra);
  const newId = () => `${now.toString(36)}${crypto.randomBytes(2).toString('hex')}`;

  // Anything the member sees is also stored as a turn, so the app can render a
  // conversation. Two turns per exchange: theirs, then Linky's.
  const sayBack = async (askId, reply, opts = {}) => {
    const thread = await appendThread(uid, state, [
      // when they only said "yes", the thread says so and shows what it was yes to
      { id: askId, role: 'user', text: opts.userText ?? (answeringYes ? `${msgTyped} - so look for "${q.need}"` : q.need), at: now },
      { id: askId, role: 'linky', text: reply, kind: opts.kind || 'answer', cardIds: opts.cardIds || [], at: now + 1 },
    ]);
    return thread;
  };

  // ---- 1a. "who else" / "anyone else": keep going on the last real ask.
  // Checked before small talk because it carries almost no words of its own.
  const wantsElseNow = q.wantsElse && !q.tokens.length ? !!(state.lastAsk && state.lastAsk.need) : false;
  // what the word lists would have decided, for the case where no model answered
  const regexMode = (q.chitChat || q.smallTalk || q.bare || !q.tokens.length) && !wantsElseNow ? 'chat'
    : q.reflective && !q.command && !wantsElseNow ? 'ask_first' : 'search';
  // The model's read wins - except on the two things a word list can see for
  // certain: a "yes" to the question he just asked, and "who else", which is a
  // request to keep searching and must never be talked out of.
  const mode = answeringYes || wantsElseNow ? 'search' : (gate?.mode || regexMode);

  // ---- 1a-ii. a direct answer to the question Linky asked.
  if (pendingIntent && (answeringYes || answeringNo)) {
    await patchState(uid, { pendingIntent: null }).catch(() => {});
    if (answeringNo) {
      const id = newId();
      const { reply: chat, usedAi } = await linkySay('chat', {
        they_said: `no, do not search - I was thinking out loud about ${text(pendingIntent.need, 90)}`,
        tone: 'They declined the search. Take it lightly, like a friend who is not selling anything. One line, no follow-up pitch.',
        member_you: { name: me.name, role: me.role, city: me.city },
      }, { name: me.name, source, seed: `decline:${id}`, fallback: `Noted - no search. The thought is still worth having, and I am here if you want the names.` });
      const thread = await appendThread(uid, state, [
        { id, role: 'user', text: msgTyped, at: now },
        { id, role: 'linky', text: chat, kind: 'chat', at: now + 1 },
      ]);
      return { id, need: text(pendingIntent.need, 120), reply: chat, kind: 'chat', cardIds: [], cards: [], nearest: [], none: true, checked: 0, expansion: 'none', usedAi, free: true, cached: false, createdAt: now, asksLeft: asksLeft(), suggest: ['who else do you have', 'help'], thread };
    }
  }

  // ---- 1b. small talk: "yoo", "hey", laughs, "no just wanna chill", "ok".
  // Free, instant, and never dressed up as a search result. The old version
  // searched for "yoo" and reported that nobody in the network matched it; the
  // member is talking to a friend, so a friend answers - and does not pitch.
  if (mode === 'chat') {
    const id = newId();
    const streak = Number(state.chitStreak || 0);
    // they get the pitch when they ask for it, or when they are new and have never
    // used him for anything. Nobody else gets a form dressed up as a greeting.
    const wantsPitch = !!q.askedWhatYouDo || (!state.lastAsk && streak === 0);
    const sayKind = q.askedWhatYouDo ? 'help' : 'chat';
    const recent = threadOf(state).slice(-6).map((t) => ({ who: t.role === 'user' ? 'they' : 'linky', said: text(t.text, 140) }));
    // if the intent call already wrote a line, do not spend a second one
    const gateSaid = sayKind === 'chat' && gate?.reply
      ? { reply: text(gate.reply, 420), suggest: gate.suggest || [], usedAi: true }
      : null;
    const { reply: chat, suggest: chatSuggest, usedAi } = gateSaid || await linkySay(sayKind, {
      they_said: q.need,
      tone: wantsPitch
        ? 'They are open to what you are for. Be warm and a little funny, then say plainly what you do here and hand them one thing to try.'
        : 'They are not looking for anybody right now. React to what they actually said, ask after them, tease gently if it fits. No pitch, no examples, no "tell me what you need".',
      recent_turns: recent,
      they_asked_what_linky_does: !!q.askedWhatYouDo,
      stop_offering_searches: streak >= 1,
      last_real_ask: state.lastAsk && state.lastAsk.need && now - toMillis(state.lastAsk.createdAt) < 3 * DAY_MS ? text(state.lastAsk.need, 120) : '',
      asks_left_today: asksLeft(),
      member_you: { name: me.name, role: me.role, city: me.city },
      network_size: 'a few dozen visible members',
      what_linky_can_do: wantsPitch ? 'find members by role, skill, city or name; explain the match; ask someone for an intro on your behalf; search the open web when nobody fits' : '',
    }, { name: me.name, source, seed: `${q.need.toLowerCase()}:${streak}`, fallback: wantsPitch ? COACH : plainReply('chat', { seed: q.need, streak }) });
    await patchState(uid, { chitStreak: streak + 1 }).catch(() => {});
    const thread = await sayBack(id, chat, { kind: 'chat' });
    const chillSuggest = source === 'app'
      ? ['who could be a good co founder for me', 'what Linky knows about me', 'what can you do']
      : ['what can you do', 'help'];
    return { id, need: q.need, reply: chat, kind: 'chat', intent: gate ? `ai:${mode}` : `words:${mode}`, askingWhat: q.askedWhatYouDo ? 'help' : '', cardIds: [], cards: [], nearest: [], none: true, checked: 0, expansion: 'none', usedAi, free: true, cached: false, createdAt: now, asksLeft: asksLeft(), suggest: chatSuggest.length ? chatSuggest : (wantsPitch ? (source === 'app' ? COACH_CHIPS : BOT_CHIPS) : chillSuggest), thread };
  }

  // ---- 1c. "unskip fred": a skip is a cool-off, not a verdict, so the only
  // honest version of "I left them alone" is letting people take it back. Free,
  // like every other lookup that is not a search.
  const un = msg.match(/^(?:unskip|un-skip|bring back|restore|unsnooze)\s+(.{2,60})$/i);
  if (un) {
    const id = newId();
    const target = un[1].trim();
    const cards = await loadCards(uid);
    const hitIds = cards.filter((c) => c.status === 'skip' && scoreNameMatch(target, c.targetName || '') >= 40).map((c) => c.id);
    let reply;
    if (!hitIds.length) {
      reply = `Nothing to undo for "${q.need.replace(/^(?:unskip|un-skip|bring back|restore|unsnooze)\s+/i, '')}" - I have no skipped card by that name. A skip ages out on its own after ${LIMITS.skipDays} days.`;
    } else {
      const next = cards.map((c) => (hitIds.includes(c.id) ? { ...c, status: 'new', updatedAt: now } : c));
      await db().collection('introSuggestions').doc(uid).set({ cards: next, updatedAt: nowTs(), newSince: now }, { merge: true });
      const names = uniq(cards.filter((c) => hitIds.includes(c.id)).map((c) => c.targetName)).join(', ');
      reply = `${names} ${hitIds.length === 1 ? 'is' : 'are'} back in your results, no cool-off left. Ask for ${hitIds.length === 1 ? 'them' : 'them'} whenever.`;
    }
    const thread = await sayBack(id, reply, { kind: 'chat' });
    return { id, need: target, reply, kind: 'chat', cardIds: hitIds, cards: [], nearest: [], none: !hitIds.length, checked: 0, expansion: 'none', usedAi: false, free: true, cached: false, createdAt: now, asksLeft: asksLeft(), suggest: ['find them again', 'what else do you have'], thread };
  }

  // ---- 2. "write me a first message": Linky drafts, the member sends.
  if (q.wantsDraft) {
    const cards = orderedCards(await loadCards(uid), state);
    const id = newId();
    const top = cards[0];
    const draft = top
      ? `For ${top.targetName}: "${top.opener || `Hi ${firstName(top.targetName)} - Linky pointed me to you. Open to a quick chat?`}" Send it as it is or make it yours. Hit Meet if you would rather I ask for you.`
      : '';
    const { reply, suggest } = await linkySay('draft', {
      asked: q.need,
      draft_for: top ? { name: top.targetName, role: top.targetRole, city: top.targetCity } : null,
      ready_message: draft,
      rule: 'Linky drafts, the member sends it from their own account. Say that plainly.',
    }, { name: me.name, source, seed: `draft:${top ? top.id : 'none'}`, fallback: draft });
    const thread = await sayBack(id, reply, { kind: 'draft', cardIds: top ? [top.id] : [] });
    return { id, need: q.need, reply, kind: 'draft', cardIds: top ? [top.id] : [], cards: top ? [top] : [], nearest: [], none: !top, checked: 0, expansion: 'none', usedAi: false, free: true, cached: false, createdAt: now, asksLeft: asksLeft(), suggest: suggest.length ? suggest : (source === 'app' ? ['meet 1', 'who else do you have', 'what Linky knows about me'] : ['meet 1', 'cards', 'help']), thread };
  }

  // ---- 3. same ask again (any of the last few): same answer, free. A
  // "nobody fits" answer goes stale faster, because new members join.
  const recent = [state.lastAsk, ...(Array.isArray(state.recentAsks) ? state.recentAsks : [])].filter(Boolean);
  const hit = recent.find((a) => a.norm === q.norm && !q.wantsElse && now - toMillis(a.createdAt) < (a.none ? LIMITS.noneCacheHours : LIMITS.askCacheHours) * 3600000);
  if (hit) {
    const cards = (await loadCards(uid)).filter((c) => (hit.cardIds || []).includes(c.id));
    const ordered = (hit.cardIds || []).map((id) => cards.find((c) => c.id === id)).filter(Boolean);
    if (hit !== state.lastAsk) await patchState(uid, { lastAsk: hit });
    const thread = await sayBack(hit.id, hit.reply, { kind: hit.none ? 'none' : 'found', cardIds: hit.cardIds || [] });
    return { ...publicAsk(hit), cards: ordered, cached: true, asksLeft: asksLeft(), free: true, suggest: (hit.none ? NONE_CHIPS : FOUND_CHIPS)[source === 'app' ? 'app' : 'bot'], thread };
  }

  const seed = q.norm || q.need;
  const existing = await loadCards(uid);
  const ctx = await buildMatchContext();

  // ---- 4. a name before anything else: "fred", "message Luke Tembani".
  // Names are searched over every visible member (not only the ones open to
  // an intro), they cost no budget, and an unavailable person is explained
  // rather than reported as "nobody". It runs BEFORE the budget check on
  // purpose: "is Fred here?" is reading a directory, not a favour, so it never
  // costs an ask - not even when the day's ten are already gone.
  const nameHit = q.nameQuery ? findByName(q, ctx, { meUid: uid, myState: state, existingCards: existing }) : null;
  if (nameHit?.match) {
    const { facts, blocked } = nameHit.match;
    const id = newId();
    if (nameHit.tie) {
      const who = [nameHit.match, ...nameHit.others].map((m) => m.facts);
      const { reply } = await linkySay('ambiguous', { people: who.map((f) => ({ name: f.name, role: f.role, city: [f.city, f.country].filter(Boolean).join(', ') })) }, { name: me.name, source, seed: `amb:${q.nameQuery}`, fallback: plainReply('ambiguous', { people: who.map((f) => f.name) }) });
      const nearest = who.map((f) => ({ uid: f.uid, name: f.name, pic: f.pic, role: f.role, city: [f.city, f.country].filter(Boolean).join(', ') }));
      const thread = await sayBack(id, reply, { kind: 'ambiguous', cardIds: [] });
      return { id, need: q.need, reply, kind: 'ambiguous', cardIds: [], cards: [], nearest, none: true, checked: ctx.candidates.length, expansion: 'none', usedAi: false, free: true, cached: false, createdAt: now, asksLeft: asksLeft(), suggest: ['that one', 'search outside LINKUP', 'no, a role'], thread };
    }
    const matchId = [uid, facts.uid].sort().join('_');
    const already = await db().collection('matches').doc(matchId).get().catch(() => null);
    const connected = !!(already && already.exists);
    const person = { name: facts.name, role: facts.role, city: [facts.city, facts.country].filter(Boolean).join(', ') };
    let cards = [];
    let cardIds = [];
    if (!blocked && !connected) {
      const why = `${facts.name} is on LINKUP - you asked for them by name, so here they are (${[facts.role, facts.city].filter(Boolean).join(', ') || 'profile on file'}). I checked nothing beyond that.`;
      const need = 'a chat, no agenda';
      const who = me.name || 'A member';
      const opener = `Hi ${firstName(facts.name)} - ${firstName(who)} asked me to connect you two. ${me.role ? `They are a ${me.role}${me.city ? ` in ${me.city}` : ''}.` : ''} Nothing heavy, just 15 minutes if you are open to it.`;
      cards = await persistCards(uid, existing, [{ facts, score: 96, why, opener: text(opener, 240) }], { askId: id, need, now });
      cardIds = cards.map((c) => c.id);
    }
    // "send intro to X" wants the next step, not just a name handed over. The
    // wording is cached, so the instruction is appended deterministically rather
    // than trusted to a sentence written for somebody else last week.
    const wantsSend = /\b(?:send|introduce|intro|message|reach out|write to|ask them|get a chat|connect)\b/i.test(msgTyped);
    const howTo = !cards.length ? '' : source === 'app'
      ? ' Tap Meet on the card and I will ask them for you - you approve the words first.'
      : ' Reply meet 1 and I will ask them for you - you approve the words first.';
    const { reply: saidPerson } = await linkySay('person', {
      asked_for: nameHit.match.phrase, found: { ...person, skills: facts.skills.slice(0, 6) },
      already_connected: connected, cannot_introduce_because: blocked || '', channel: source,
      they_want_to_send: wantsSend && !!cards.length,
      what_happens_next: blocked ? 'the member can open the profile and message directly; Linky will not push an intro request'
        : connected ? 'they can keep talking in Messages'
        : cards.length ? 'a card is ready and Linky asks permission before anything is sent' : '',
    }, { name: me.name, source, seed: `person:${facts.uid}:${uid}:${!!blocked}:${connected}:${wantsSend && !!cards.length ? 'send' : 'find'}`, fallback: plainReply('person', { person }) });
    const reply = wantsSend && cards.length && !/meet/i.test(saidPerson) ? `${saidPerson.replace(/[.\s]*$/, '.')}${howTo}` : saidPerson;
    const thread = await sayBack(id, reply, { kind: 'person', cardIds });
    const foundNearest = [{ uid: facts.uid, name: person.name, pic: facts.pic, role: person.role, city: person.city }];
    const record = { id, need: q.need, norm: q.norm, offer: q.offer, location: q.location, remote: q.remote, reply, cardIds, none: !cards.length, nearest: blocked || connected ? foundNearest : [], checked: ctx.candidates.length, usedAi: false, expansion: 'none', source, kind: 'person', createdAt: now };
    await patchState(uid, { lastAsk: record, chitStreak: 0, recentAsks: [state.lastAsk, ...(Array.isArray(state.recentAsks) ? state.recentAsks : [])].filter((a) => a && a.norm !== q.norm && now - toMillis(a.createdAt) < LIMITS.askCacheHours * 3600000).slice(0, 5) });
    const history = (Array.isArray(state.askHistory) ? state.askHistory : []).slice(-19);
    history.push({ id, need: q.need, cards: cards.length, none: !cards.length, source, createdAt: now });
    await patchState(uid, { askHistory: history });
    return { ...publicAsk(record), cards, cached: false, usedAi: false, kind: 'person', matchId: connected ? matchId : '', blocked: blocked || '', free: true, asksLeft: asksLeft(), suggest: cards.length ? ['meet 1', 'who else do you have', 'write me a first message'] : ['search outside LINKUP', 'try a role instead'], thread };
  }

  // ---- 4b. thinking out loud: answer the thought, ask before searching.
  // Free, and it does not become the member's "last ask" - the question is what
  // hangs in the air, not an answer they never asked for.
  // ...but a "yes" to that question is the go-ahead, not another musing: the
  // stored need is reflective by construction, so it must skip this branch.
  if (mode === 'ask_first') {
    const id = newId();
    // the thought is remembered as the thing to search, in the model's words if
    // it had any - a half-typed message still becomes a usable question
    await patchState(uid, { pendingIntent: { need: text(gate?.topic && substance(gate.topic).length ? gate.topic : q.need, 160), at: now, id } }).catch(() => {});
    const saidCheck = gate?.reply
      ? { reply: text(gate.reply, 420), suggest: gate.suggest || [], usedAi: true }
      : await linkySay('check', {
      they_said: q.need,
      thought: q.need,
      member_you: { name: me.name, role: me.role, company: me.company, city: me.city, skills: list(me.skills, 6, 40) },
      offers: me.lookingFor || '',
      tone: 'One honest thought about what they are weighing, then one line asking whether to look for people. No names, no numbers, no list.',
    }, { name: me.name, source, seed: `check:${q.norm}`, fallback: '' });
    const { reply: asked0, suggest: askSuggest, usedAi } = saidCheck;
    // he always ends with the question, whatever the model decided to be poetic about
    const ask2 = /\?/.test(asked0) ? asked0 : `${asked0.replace(/\.+$/, '')} Should I search for them?`;
    const thread = await appendThread(uid, state, [
      { id, role: 'user', text: q.need, at: now },
      { id, role: 'linky', text: ask2, kind: 'check', at: now + 1 },
    ]);
    return {
      id, need: q.need, reply: ask2, kind: 'check', cardIds: [], cards: [], nearest: [], none: false,
      checked: 0, expansion: 'none', usedAi, free: true, cached: false, createdAt: now,
      asksLeft: asksLeft(), suggest: askSuggest.length ? askSuggest : ['yes, go look', 'no, just thinking'],
      askingFirst: true, intent: gate ? `ai:${mode}` : `words:${mode}`, thread,
    };
  }

  // ---- 5. daily budget (only real searches cost anything)
  if (used >= limits.asksPerDay) {
    const { reply: limitReply } = await linkySay('limit', {
      asks_used_today: used, asks_limit_today: limits.asksPerDay, plan: plus ? 'PLUS' : 'free',
      plus_asks_per_day: LIMITS.plus.asksPerDay, resets: 'midnight',
      note: 'searching by a member name never counts against the budget; PLUS is 19.99 USD a month',
    }, { name: me.name, source, seed: `limit:${plus ? 'plus' : 'free'}`, fallback: plainReply('limit', { limit: limits.asksPerDay, plusLimit: LIMITS.plus.asksPerDay }) });
    const err = new Error(limitReply);
    err.code = 'ask_limit';
    throw err;
  }

  // ---- 6. "who else" / "anyone else": second lap over the same need, minus
  // everybody already on a card, so the conversation can keep going.
  let searchQ = q;
  const exclude = new Set();
  if (wantsElseNow) searchQ = { ...parseAsk(state.lastAsk.need), wantsElse: false, nameQuery: '', nameAttempts: [] };
  if (q.wantsElse && state.lastAsk?.need || wantsElseNow) {
    searchQ = { ...parseAsk(state.lastAsk.need), wantsElse: false, nameQuery: '', nameAttempts: [] };
    const cards = await loadCards(uid);
    [...(state.lastAsk.cardIds || []), ...(state.lastAsk.excludedCardIds || [])].forEach((cid) => {
      const c = cards.find((x) => x.id === cid);
      if (c) exclude.add(c.targetUid);
    });
    searchQ.excludedCardIds = [...exclude];
  }
  const { picks, nearest, checked, usedAi, expansion = 'none', relatedTo = '' } = await findPeople(uid, searchQ, ctx, { user, state, existingCards: existing, exclude });

  const askId = newId();
  const resultCards = await persistCards(uid, existing, picks, { askId, need: searchQ.need, now });

  const kind = picks.length ? (expansion === 'none' ? 'found' : 'close') : 'none';
  const triedName = q.nameAttempts?.[0] || '';
  const followUp = kind === 'none' && triedName
    ? `Was ${triedName} a person or a role? If it is a person, give me the surname as well; if it is a role, say it the way you would describe the work.`
    : '';
  const loc = String(q.location || '').toLowerCase();
  const inLoc = !loc || picks.some((p) => `${p.facts.city} ${p.facts.country}`.toLowerCase().includes(loc));
  const { reply, suggest: saidSuggest } = await linkySay(kind, {
    need: searchQ.need,
    offer: searchQ.offer || 'not stated',
    location: searchQ.location || 'not stated',
    remote_ok: searchQ.remote,
    members_checked: checked,
    matches: picks.map((p) => ({ name: p.facts.name, role: p.facts.role, company: p.facts.company, city: [p.facts.city, p.facts.country].filter(Boolean).join(', '), reason: p.why })),
    closest_instead: nearest,
    matched_on: expansion === 'none' ? 'their own words' : `related skills (close to "${relatedTo || searchQ.need}")`,
    nobody_found_because: kind === 'none' ? 'no profile here mentions that need, its synonyms, or a related skill' : '',
    which_person_were_you_after: kind === 'none' ? followUp : '',
    remote_only_note: kind !== 'none' && q.location && !inLoc ? `nobody in ${q.location}, so these are people who would work remotely` : '',
    asks_left_today: asksLeft(1),
    channel: source,
    outside_hint: kind === 'none' ? (source === 'app' ? 'there is a button to search outside LINKUP' : 'they can reply MORE to search outside LINKUP') : '',
    suggest: (kind === 'none' ? NONE_CHIPS : FOUND_CHIPS)[source === 'app' ? 'app' : 'bot'],
  }, { name: me.name, source, seed: q.wantsElse ? `${searchQ.norm}:else:${[...exclude].join(',')}` : searchQ.norm });
  const record = {
    id: askId, need: searchQ.need, norm: searchQ.norm, offer: searchQ.offer, location: searchQ.location, remote: searchQ.remote,
    reply, kind, cardIds: resultCards.map((c) => c.id), excludedCardIds: [...exclude], none: !picks.length, nearest, checked, usedAi, expansion, source, createdAt: now,
  };
  const history = (Array.isArray(state.askHistory) ? state.askHistory : []).slice(-19);
  history.push({ id: askId, need: searchQ.need, cards: picks.length, none: !picks.length, source, createdAt: now });
  const recentAsks = [state.lastAsk, ...(Array.isArray(state.recentAsks) ? state.recentAsks : [])]
    .filter((a) => a && a.norm !== searchQ.norm && now - toMillis(a.createdAt) < LIMITS.askCacheHours * 3600000).slice(0, 5);
  const thread = await sayBack(askId, reply, { kind, cardIds: record.cardIds });
  // a searched ask is also the moment the small talk stops: the next greeting
  // starts from zero, so the pitch is not permanently muted
  await patchState(uid, { lastAsk: record, chitStreak: 0, recentAsks, askHistory: history, asks: { day: today, count: used + 1 } });
  return { ...publicAsk(record), cards: resultCards, cached: false, usedAi, kind, asksLeft: asksLeft(1), suggest: saidSuggest, thread };
}

const publicAsk = (a) => (a ? {
  id: a.id || '',
  need: a.need || '',
  reply: a.reply || '',
  kind: a.kind || (a.none ? 'none' : 'found'),
  cardIds: Array.isArray(a.cardIds) ? a.cardIds : [],
  none: !!a.none,
  nearest: Array.isArray(a.nearest) ? a.nearest : [],
  checked: Number(a.checked || 0),
  expansion: a.expansion || 'none',
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

// The intro is the only message LINKUP sends on somebody's behalf, so it is the
// one place where "would I answer this?" is the entire job. Two texts come out of
// one call: what the target reads, and the line the asker opens with afterwards.
// Both have a hand-written backup, because a missing AI is not a reason to send
// a member nothing at all.
export async function introPitch({ requester = {}, target = {}, need = '', why = '', place = '', seed = '' } = {}) {
  const tName = firstName(target.name || '') || 'there';
  const aName = text(requester.name, 60) || 'A LINKUP member';
  const roleBit = target.role ? `${/^[aeiou]/i.test(target.role) ? 'an' : 'a'} ${target.role}` : '';
  const pitch = [`Hi ${tName} - ${aName} asked me to make the introduction, and I said yes before I checked if you were busy.`,
    need ? `They are looking for ${text(need, 160)}${place ? ` around ${text(place, 40)}` : ''}.` : '',
    why ? `You came up because ${text(why, 200).replace(/\.$/, '')}.` : `You came up because ${aName} reads your profile and pointed at it.`,
    `Fifteen minutes on a call this week, if you are open to it. If the timing is wrong, say so - I will not ask twice and nobody takes it badly.`,
  ].filter(Boolean).join(' ');
  const opener = `Hi ${tName} - ${aName} here. Linky pointed me at you${need ? ` after I said I needed ${text(need, 120)}` : ''}${roleBit ? `, and your work as ${roleBit} is exactly why` : ''}. Worth 15 minutes this week?`;
  if (!aiReady()) return { pitch, opener, usedAi: false };
  const ref = db().collection('linkyCache').doc(cacheKey('i', seed || `${aName}|${tName}|${need}`));
  const snap = await ref.get().catch(() => null);
  if (snap && snap.exists && Date.now() - toMillis(snap.data().createdAt) < 30 * DAY_MS) {
    const d = snap.data();
    if (text(d.pitch, 900) && text(d.opener, 600)) return { pitch: text(d.pitch, 900), opener: text(d.opener, 600), usedAi: true, cached: true };
  }
  const prompt = [
    "You are Linky, LINKUP's connector. You are writing the message that decides whether a busy, good person says yes to a stranger.",
    'Two texts, STRICT JSON only: {"pitch":"...","opener":"..."}',
    `pitch: what ${tName} reads, from Linky, on behalf of ${aName}. Max 70 words. It must say who is asking and that they asked for THIS person; name the one real reason from the dossier (a fact, never an adjective); make the ask tiny and concrete (15 minutes, this week); and offer a no that costs them nothing. Confident, warm, a flicker of humour. No flattery padding, no hype, no "game-changer", no "I hope this finds you well", no exclamation marks, no emoji.`,
    `opener: the first line ${aName} sends once ${tName} says yes. Max 45 words, first person, sounds like a human typing on a phone in one go: one true thing about ${tName}, what ${aName} is building or needs, one easy question to answer. Never "per my last email", never pitch-deck language, never "synergy", "revolutionise" or "passionate".`,
    'Never invent a fact that is not in the dossier. Never promise money, equity, a job or a time. If the dossier has no reason, say what the asker is building instead of flattering anybody.',
    `Dossier: ${JSON.stringify({ asker: { name: aName, role: text(requester.role, 80), company: text(requester.company, 80), city: text(requester.city, 40) }, target: { name: target.name, role: text(target.role, 80), company: text(target.company, 80), city: text(target.city, 40), skills: list(target.skills, 6, 40) }, need: text(need, 200), why: text(why, 240), place: text(place, 60) })}`.slice(0, 2600),
  ].join('\n');
  try {
    const { text: raw } = await aiText(prompt, { temperature: 0.75, maxOutputTokens: 420, responseMimeType: 'application/json' });
    const parsed = JSON.parse(String(raw).slice(String(raw).indexOf('{'), String(raw).lastIndexOf('}') + 1));
    const pOut = text(parsed.pitch, 700);
    const oOut = text(parsed.opener, 480);
    if (pOut.length < 60 || oOut.length < 30) return { pitch, opener, usedAi: false };
    await ref.set({ pitch: pOut, opener: oOut, at: Date.now(), createdAt: Date.now() }, { merge: true }).catch(() => {});
    return { pitch: pOut, opener: oOut, usedAi: true };
  } catch (err) {
    console.warn('[linky] intro pitch failed, using the written one', err?.message || err);
    return { pitch, opener, usedAi: false };
  }
}

// ---------------------------------------------------------------- permissioned outreach
// Nothing leaves LINKUP on its own, in either direction. For a member, Linky
// writes the intro, the asker reads it, edits it if they want, and only then does
// it go to the other person. For somebody outside LINKUP, Linky writes the
// message, the member approves it and sends it themselves - the intent is recorded
// either way, which is what turns a search box into a graph.
async function pushTrail(uid, entry) {
  const state = await loadState(uid);
  const outreach = [...(Array.isArray(state.outreach) ? state.outreach : []), { at: Date.now(), ...entry }].slice(-40);
  await patchState(uid, { outreach, outreachAt: Date.now() });
  return outreach;
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
  const matchId = [uid, target].sort().join('_');
  if (await db().collection('matches').doc(matchId).get().then((x) => x.exists).catch(() => false)) {
    await setCardStatus(uid, cardId, 'meet');
    return { matchId, opener: card.opener || '' };
  }
  const introId = `${uid}_${target}`;
  const existingIntro = await db().collection('intros').doc(introId).get();
  if (existingIntro.exists && existingIntro.data().status === 'pending') {
    await setCardStatus(uid, cardId, 'meet');
    return { introId, pending: true, awaitingThem: true };
  }
  const targetState = await loadState(target);
  if (targetState.muted && targetState.muted[uid]) throw new Error('They are not taking intros right now.');
  const week = weekKey();
  const inboundCount = targetState.inbound?.week === week ? Number(targetState.inbound.count || 0) : 0;
  const cap = Number.isFinite(Number(targetState.inboundCap)) ? Number(targetState.inboundCap) : LIMITS.inboundPerWeek;
  if (inboundCount >= cap) throw new Error('They have hit their weekly intro cap. Ask me again next week.');

  const pitchPack = await introPitch({
    requester: { ...me },
    target: { name: card.targetName, role: card.targetRole, company: card.targetCompany, city: card.targetCity, skills: card.targetSkills },
    need: card.need, why: card.why, place: me.city, seed: `intro:${introId}:${card.askId || ''}`,
  });
  const draft = {
    cardId, targetUid: target, targetName: card.targetName, need: card.need, why: card.why,
    pitch: pitchPack.pitch, opener: pitchPack.opener || card.opener || '', usedAi: !!pitchPack.usedAi,
    introId, at: Date.now(),
  };
  // The draft is the whole ask. Until this member says send, the other person
  // has no idea any of this happened - that is the point.
  await patchState(uid, { pendingMeet: draft });
  await db().collection('introDrafts').doc(`${uid}_${cardId}`).set({ ...draft, uid, status: 'awaiting_you' }).catch(() => {});
  return {
    draft: true, needsApproval: true, draftId: `${uid}_${cardId}`, ...draft,
    target: { uid: target, name: card.targetName, role: card.targetRole, city: card.targetCity },
    meetsLeft: plus ? null : Math.max(0, limit - used),
    note: 'Read it. Edit it if it is not how you talk. It goes to them only when you say send.',
  };
}

export async function approveMeet(uid, { cardId = '', text: mine = '', userDoc } = {}) {
  const state = await loadState(uid);
  const pending = state.pendingMeet || null;
  const id = cardId || pending?.cardId;
  if (!id) throw new Error('Nothing is waiting to go. Ask me for somebody first.');
  const mineText = String(mine || '').trim();
  if (mineText.length && mineText.length < 24) throw new Error('That is a bit short to send as an intro. A sentence or two, then I will pass it on.');
  const draft = pending && pending.cardId === id
    ? pending
    : await db().collection('introDrafts').doc(`${uid}_${id}`).get().then((x) => (x.exists ? x.data() : null)).catch(() => null);
  const out = await sendMeet(uid, id, {
    userDoc,
    draft: mineText.length ? { ...draft, pitch: mineText } : draft,
    overrideText: mineText,
  });
  // the name the app and the bot echo back - the card may already have moved on,
  // so take it from whichever of the two still has it
  const cards = await loadCards(uid).catch(() => []);
  const card = (cards || []).find((c) => c.id === id) || {};
  const targetName = pending?.targetName || draft?.targetName || card.targetName || '';
  const targetUid = pending?.targetUid || draft?.targetUid || card.targetUid || '';
  const need = pending?.need || draft?.need || card.need || '';
  await patchState(uid, { pendingMeet: null });
  await db().collection('introDrafts').doc(`${uid}_${id}`).set({ status: 'approved', approvedAt: Date.now(), approvedText: text(mineText || draft?.pitch || '', 900) }, { merge: true }).catch(() => {});
  await pushTrail(uid, { kind: 'intro', targetUid, name: targetName, need, edited: !!mineText, status: 'asked', introId: out.introId || '' });
  return { ...out, sent: true, edited: !!mineText, targetName, targetUid, need };
}

export async function cancelMeet(uid, { cardId = '' } = {}) {
  const state = await loadState(uid);
  const pending = state.pendingMeet;
  const id = cardId || pending?.cardId;
  if (!id) return { ok: true, cancelled: false };
  await patchState(uid, { pendingMeet: null });
  await setCardStatus(uid, id, 'saved').catch(() => {});
  await db().collection('introDrafts').doc(`${uid}_${id}`).set({ status: 'cancelled', cancelledAt: Date.now() }, { merge: true }).catch(() => {});
  await pushTrail(uid, { kind: 'intro', targetUid: pending?.targetUid || '', name: pending?.targetName || '', status: 'cancelled', need: pending?.need || '' });
  // the card is the member's own list - put it back the way it was, saved, so a
  // "not now" costs them nothing but the person they liked
  return { ok: true, cancelled: true, targetName: pending?.targetName || '' };
}

/**
 * Linky writes the message for somebody LINKUP does not have. It is a draft, by
 * law and by design: we cannot post to LinkedIn for a member and would not.
 */
export async function draftLead(uid, { key = '', lead = null, index = 0, need = '', userDoc, source = 'app' } = {}) {
  const user = userDoc || (await loadUser(uid));
  if (!user) throw new Error('Finish your LINKUP profile first.');
  const state = await loadState(uid);
  // the app may send a number instead of the whole object, referring to the list
  // Linky last showed - which is also what makes "draft 2" mean the same thing here
  const picked = lead || (index > 0 ? (Array.isArray(state.lastLeads) ? state.lastLeads : [])[index - 1] : null) ||
    (Array.isArray(state.lastLeads) && state.lastLeads.length === 1 ? state.lastLeads[0] : null);
  const me = profileFacts(user) || {};
  const q = parseAsk(need || state.lastAsk?.need || 'somebody useful');
  const place = [me.city, me.country].filter(Boolean).join(', ') || 'Zimbabwe';
  const who = { name: text(picked?.name, 60), title: text(picked?.title, 110), url: text(picked?.url, 400) };
  if (!who.name) throw new Error('Who should I write to? Tap their name and I will draft it.');
  const k = text(key, 80) || text(picked?.key, 80) || leadKey(who);
  const fallback = outreachDraft(who, { need: q.need, name: me.name, place });
  let body = fallback;
  let usedAi = false;
  if (aiReady()) {
    try {
      const raw = await geminiText([
        `Write the first message ${me.name || 'a LINKUP member'} sends to ${who.name}${who.title ? `, ${who.title}` : ''} on LinkedIn.`,
        `They found ${who.name} from a public search for "${q.need}". ${me.role ? `${me.name} is ${me.role}${me.company ? ` at ${me.company}` : ''}.` : ''} Place: ${place}.`,
        'It must read like a person typed it on a phone: 45-70 words, first line says who is writing and why THIS person, one concrete thing from their own profile, one small easy ask (15 minutes, a question, an opinion), and an easy no. No "I hope this finds you well", no "I would love to pick your brain", no flattery padding, no hype, no exclamation marks, no emoji, no signature block. Do not invent facts about them.',
        'Return STRICT JSON only: {"message":"..."}',
      ].join('\n'), { temperature: 0.55, maxOutputTokens: 320, responseMimeType: 'application/json' });
      const got = text(readJson(raw)?.message, 900);
      if (got.length > 40) { body = got; usedAi = true; }
    } catch (err) {
      console.warn('[linky] lead draft failed, using the written one', err?.message || err);
    }
  }
  const pendingLead = { key: k, lead: who, need: q.need, text: body, usedAi, place, at: Date.now() };
  await patchState(uid, { pendingLead });
  await pushTrail(uid, { kind: 'lead', key: k, name: who.name, need: q.need, status: 'drafted' });
  return {
    ok: true, key: k, lead: who, text: body, usedAi, url: who.url, source,
    howTo: 'Nothing is sent for you and nothing can be: open their profile and paste this. Tell me "sent" when it is out, or "not interested" if you never want to see them again.',
  };
}

/** "cancel" on a bot: the draft is dropped, nobody is muted, nothing was sent. */
export async function dropLeadDraft(uid) {
  await patchState(uid, { pendingLead: null });
  return { ok: true };
}

/** Approval is a record, not a send - and the record is what the graph is made of. */
export async function approveLead(uid, { key = '', text: mine = '' } = {}) {
  const state = await loadState(uid);
  const pending = state.pendingLead;
  if (!pending?.key) throw new Error('Let me write it first, then you can approve it.');
  const body = text(mine || pending.text, 900);
  if (body.length < 24) throw new Error('That looks too short to send. One or two sentences, then I will hand it over.');
  const intentId = `${uid}_${pending.key.replace(/[^a-z0-9]/gi, '_').slice(0, 48)}_${Date.now().toString(36)}`;
  const record = {
    uid, key: pending.key, kind: 'linkedin_lead', lead: pending.lead, need: pending.need,
    text: body, edited: !!String(mine || '').trim() && text(mine, 900) !== pending.text,
    status: 'approved_for_self_send', createdAt: nowTs(), updatedAt: Date.now(),
    expiresAt: (() => { try { return getAdmin().firestore.Timestamp.fromMillis(Date.now() + 60 * DAY_MS); } catch { return null; } })(),
  };
  await db().collection('outreachIntents').doc(intentId).set(record).catch((err) => console.warn('[linky] intent write failed', err?.code, err?.message || err));
  await patchState(uid, { pendingLead: null });
  await pushTrail(uid, { kind: 'lead', key: pending.key, name: pending.lead?.name, need: pending.need, status: 'approved', intentId, edited: record.edited });
  return {
    ok: true, intentId, text: body, url: pending.lead?.url || '', edited: record.edited,
    lead: pending.lead, note: 'Copy it, open their profile, send it from your own account. Come back and tell me "sent" or "not interested".',
  };
}

/** sent / not_interested. "not interested" is a mute: they never come up again. */
export async function markLead(uid, { key = '', status = 'sent', intentId = '' } = {}) {
  const state = await loadState(uid);
  const k = text(key, 80) || state.pendingLead?.key || '';
  if (!k) throw new Error('Which one?');
  const kind = status === 'not_interested' || status === 'declined' ? 'not_interested' : 'sent';
  if (kind === 'not_interested') {
    const muted = { ...(state.outreachMuted || {}), [k]: 1 };
    await patchState(uid, { outreachMuted: Object.keys(muted).length > 400 ? muted : muted, pendingLead: null });
  } else {
    await patchState(uid, { pendingLead: null });
  }
  // keep the name on the trail too, so "you wrote to these" is readable and the
  // graph knows who this person was, not only their key
  const prior = (outreachTrail(state).entries || []).find((e) => e && e.key === k);
  const entry = {
    kind: 'lead', key: k, status: kind === 'sent' ? 'sent' : 'declined',
    name: prior?.name || state.pendingLead?.lead?.name || '',
    need: prior?.need || state.pendingLead?.need || '',
  };
  await pushTrail(uid, entry);
  if (intentId) {
    await db().collection('outreachIntents').doc(String(intentId).slice(0, 90))
      .set({ status: kind === 'sent' ? 'sent_by_member' : 'not_interested', markedAt: Date.now() }, { merge: true }).catch(() => {});
  } else {
    const found = await db().collection('outreachIntents').where('uid', '==', uid).where('key', '==', k)
      .limit(1).get().catch(() => null);
    const doc = found?.docs?.[0];
    if (doc) await doc.ref.set({ status: kind === 'sent' ? 'sent_by_member' : 'not_interested', markedAt: Date.now() }, { merge: true }).catch(() => {});
  }
  return {
    ok: true, status: kind, muted: kind === 'not_interested',
    note: kind === 'sent'
      ? 'Logged. If they reply, bring them into LINKUP and I will keep the thread in one place.'
      : 'Gone. I will not put them in front of you again.',
  };
}

async function sendMeet(uid, cardId, { userDoc, draft = null, overrideText = '' } = {}) {
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
  // what the member approved is what the target reads: no second draft, no
  // second model call, nothing "improved" on the way out
  const pitchPack = overrideText || draft?.pitch
    ? { pitch: text(overrideText || draft.pitch, 900), opener: text(draft?.opener || '', 600), usedAi: !!draft?.usedAi && !overrideText }
    : await introPitch({
        requester: { ...me },
        target: { name: card.targetName, role: card.targetRole, company: card.targetCompany, city: card.targetCity, skills: card.targetSkills },
        need: card.need, why: card.why, place: me.city, seed: `intro:${introId}:${card.askId || ''}`,
      });
  const intro = {
    requesterId: uid,
    targetId: target,
    askId: card.askId || '',
    need: card.need,
    why: card.why,
    pitch: pitchPack.pitch,
    opener: pitchPack.opener || card.opener || '',
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
  const content = pitchPack.pitch;
  await notifyUser(target, {
    type: 'intro_request',
    content,
    from: me,
    requestId: introId,
    pushTitle: 'Linky has an intro for you',
    channelText: `${pitchPack.pitch}\n\nReply ACCEPT, DECLINE or LATER - all three are fine answers.`,
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

// A member answered "which one?" with a number (or tapped one of the chips
// Linky showed). Turn that person into a normal card so Meet/Skip/Save all
// behave exactly like any other answer, and remember it on the ask.
export async function pickPerson(uid, targetUid) {
  const ctx = await buildMatchContext();
  const candidate = ctx.candidates.find((x) => x.uid === targetUid);
  if (!candidate) throw new Error('They are not on LINKUP any more.');
  const facts = candidateFacts(candidate, ctx.states[targetUid] || {});
  const existing = await loadCards(uid);
  const now = Date.now();
  const mine = await loadState(uid);
  const blocked = introBlocker({ meUid: uid, p: candidate, st: ctx.states[targetUid] || {}, myState: mine, ctx, prev: existing.find((c) => c.targetUid === targetUid), offer: '', now });
  if (blocked) throw new Error(blocked);
  const card = {
    id: `p_${now.toString(36)}_${String(targetUid).slice(0, 8)}`,
    askId: (mine.lastAsk && mine.lastAsk.id) || '',
    need: `an intro to ${facts.name}`,
    targetUid: facts.uid, targetName: facts.name, targetPic: facts.pic, targetRole: facts.role,
    targetCompany: facts.company, targetCity: [facts.city, facts.country].filter(Boolean).join(', '),
    targetSkills: facts.skills.slice(0, 5),
    why: `${facts.name} is the one you picked${[facts.role, facts.city].filter(Boolean).length ? ` (${[facts.role, facts.city].filter(Boolean).join(', ')})` : ''}. I have not checked fit beyond that - you know what you want.`,
    opener: `Hi ${firstName(facts.name)} - Linky introduced us. Worth 15 minutes this week?`,
    score: 92, status: 'new', createdAt: now, updatedAt: now,
  };
  const keep = existing.filter((c) => now - toMillis(c.createdAt) < 30 * DAY_MS).slice(-59);
  await db().collection('introSuggestions').doc(uid).set({ cards: [...keep, card], updatedAt: nowTs(), newSince: now }, { merge: true });
  if (mine.lastAsk) {
    const record = { ...mine.lastAsk, cardIds: [...new Set([...(mine.lastAsk.cardIds || []), card.id])], kind: 'person', reply: mine.lastAsk.reply };
    await patchState(uid, { lastAsk: record });
  }
  return card;
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
    thread: threadOf(state).slice(-LIMITS.threadTurns),
    facts: toldFacts(state),
    // the outreach the member already approved or declined - so the app can show
    // "you wrote to these 3" and reopen a draft after a reload instead of losing it
    outreach: outreachTrail(state).entries.slice(-12).reverse(),
    pending: {
      meet: state.pendingMeet && now - toMillis(state.pendingMeet.at) < 3 * DAY_MS ? state.pendingMeet : null,
      lead: state.pendingLead && now - toMillis(state.pendingLead.at) < 3 * DAY_MS ? state.pendingLead : null,
    },
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
    // a save from the notes form must not silently un-hide everything: when the
    // caller sent no hidden block, keep what they already had
    hidden: normaliseHidden(input && input.hidden !== undefined ? input.hidden : (await loadState(uid)).facts?.hidden),
    updatedAt: Date.now(),
  };
  await patchState(uid, { facts, lastAsk: FieldValue().delete(), recentAsks: FieldValue().delete() });
  return { ok: true, facts: { ...facts } };
}

const HIDDEN_LISTS = ['skills', 'industries', 'lookingFor'];
const HIDDEN_FLAGS = ['notes', 'bio', 'company', 'city'];
function normaliseHidden(h) {
  const src = h || {};
  const out = {};
  for (const k of HIDDEN_LISTS) out[k] = list(src[k], 40, k === 'lookingFor' ? 80 : 40);
  for (const k of HIDDEN_FLAGS) out[k] = !!src[k];
  return out;
}

// One tap on a fact in the audit page. This hides it from LINKY - their LINKUP
// profile keeps it, Linky simply stops matching on it and quoting it. Deleting a
// fact nobody else can see is the whole point of letting people audit him.
export async function hideFact(uid, { kind = 'skills', value = '', hide = true } = {}) {
  const state = await loadState(uid);
  const cur = normaliseHidden((state.facts || {}).hidden);
  const next = { ...cur };
  if (HIDDEN_LISTS.includes(kind)) {
    const v = text(value, 80);
    const rest = (cur[kind] || []).filter((x) => x.toLowerCase() !== v.toLowerCase());
    if (hide && v) rest.push(v);
    next[kind] = rest;
  } else if (HIDDEN_FLAGS.includes(kind)) {
    if (hide) next[kind] = true;
    else delete next[kind];
  } else {
    throw new Error('What should I hide? A skill, an industry, a looking-for, your notes, your bio, your company or your city.');
  }
  const facts = { ...((state.facts || {})), hidden: normaliseHidden(next), updatedAt: Date.now() };
  // and their cached answers go with it: an ask from this morning that was
  // answered using the now-hidden fact must not be served again
  await patchState(uid, { facts, lastAsk: FieldValue().delete(), recentAsks: FieldValue().delete() });
  return { ok: true, hidden: facts.hidden, told: toldFacts({ facts }) };
}

// "and forget that I ever asked" - one memory out, not the whole ledger.
export async function removeAsk(uid, askId) {
  const state = await loadState(uid);
  const id = String(askId || '').trim();
  if (!id) throw new Error('Which one should I forget?');
  const before = (Array.isArray(state.askHistory) ? state.askHistory : []);
  const kept = before.filter((a) => String(a && a.id) !== id);
  const recent = (Array.isArray(state.recentAsks) ? state.recentAsks : []).filter((a) => String(a && a.id) !== id);
  const patch = { askHistory: kept.slice(-20), recentAsks: recent };
  if (state.lastAsk && String(state.lastAsk.id) === id) patch.lastAsk = FieldValue().delete();
  const thread = threadOf(state).filter((t) => String(t && t.id) !== id);
  if (thread.length !== threadOf(state).length) patch.chat = thread;
  await patchState(uid, patch);
  return { ok: true, forgotten: before.length - kept.length, turns: thread.length };
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
    hidden: toldFacts(state).hidden,
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
