// Linky core: intents, hourly intro matching, double opt-in intros, daily brief,
// audit, bot linking. Shared by api/linky.js (app + Telegram + WhatsApp).
//
// Every write in here happens with the Admin SDK, so the client never needs
// rules for these collections (they stay server-only):
//   intents/{id}            one "who I need" record, expires after 30 days
//   introSuggestions/{uid}  Linky's cards for a member (cite-or-skip "why")
//   intros/{id}             double opt-in: requester Meet -> target Accept
//   linkyState/{uid}        budgets, mutes, prefs, intake session, channels
//   botUsers/{channel_chat} Telegram / WhatsApp chat -> uid
//   botLinks/{code}         short-lived codes that link a chat to an account
import crypto from 'node:crypto';
import { getAdmin, getDb } from './_firebaseAdmin.js';
import { geminiText, getGeminiKey, localRank, compactProfile } from './_gemini.js';

export const LIMITS = {
  free: { activeIntents: 1, meetsPerDay: 3, newCardsPerDay: 3 },
  plus: { activeIntents: 3, meetsPerDay: 100000, newCardsPerDay: 5 },
  inboundPerWeek: 5,
  intentDays: 30,
  introDays: 7,
  snoozeDays: 14,
  rematchHours: 23,
  shortlist: 10,
};
export const OFFERS = ['paid', 'equity', 'advisory', 'coffee'];
export const URGENCIES = ['this_week', 'this_month', 'whenever'];
export const CRON_UID = 'linky-cron';
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
export const isValidId = (id) => /^[a-zA-Z0-9_-]{1,128}$/.test(String(id || ''));

const STOP = new Set('me for up in a an the with and or to of is i my by on at who someone who can that this need want looking find help build some any people person good great experienced strong senior junior based from about into been are was be it its as'.split(' '));
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
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, sound: 'default', priority: 'high', channelId: 'default', title, body: String(body).slice(0, 180), data }))),
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    console.warn('[linky] push skipped', err?.message || err);
  }
}

// Telegram webhook secret: explicit env, else derived from the bot token so
// no second secret has to be configured anywhere.
export function telegramWebhookSecret() {
  const explicit = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (explicit) return explicit;
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return '';
  return crypto.createHash('sha256').update(`linky-tg:${token}`).digest('hex').slice(0, 48);
}

// Idempotent: points the bot at our webhook every cron run, so adding
// TELEGRAM_BOT_TOKEN in Vercel is the only setup step.
export async function ensureTelegramWebhook(baseUrl) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return { configured: false };
  const url = `${baseUrl}/api/telegram`;
  const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
  if (info?.result?.url === url && !info?.result?.last_error_date) return { configured: true, url, unchanged: true };
  const set = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: telegramWebhookSecret(), allowed_updates: ['message', 'callback_query'], drop_pending_updates: false }),
    signal: AbortSignal.timeout(8000),
  }).then((r) => r.json()).catch((e) => ({ ok: false, description: String(e?.message || e) }));
  return { configured: true, url, set: !!set?.ok, description: set?.description || '' };
}

export async function sendTelegram(chatId, message) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token || !chatId) return false;
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

// ---------------------------------------------------------------- intents
export function normalizeIntent(input) {
  const need = text(input?.need, 240);
  if (need.length < 8) throw new Error('Describe who you need in at least a few words.');
  const offer = OFFERS.includes(String(input?.offer || '').toLowerCase()) ? String(input.offer).toLowerCase() : 'coffee';
  const urgency = URGENCIES.includes(String(input?.urgency || '')) ? String(input.urgency) : 'this_month';
  return {
    need,
    constraints: list(input?.constraints, 6, 80),
    offer,
    location: text(input?.location, 80),
    remote: input?.remote !== false,
    urgency,
  };
}

export async function activeIntentsFor(uid) {
  const snap = await db().collection('intents').where('ownerId', '==', uid).where('status', '==', 'active').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((i) => toMillis(i.expiresAt) > Date.now());
}

export async function saveIntent(uid, input, { source = 'app', userDoc } = {}) {
  const user = userDoc || (await loadUser(uid));
  if (!user) throw new Error('Finish your LINKUP profile first.');
  const intent = normalizeIntent(input);
  const plus = await isPlusUser(uid, user);
  const limits = plus ? LIMITS.plus : LIMITS.free;
  const active = await activeIntentsFor(uid);
  if (active.length >= limits.activeIntents) {
    const err = new Error(plus
      ? `You already have ${limits.activeIntents} open intents. Close one first.`
      : 'Free members run 1 open intent at a time. Close it, or go PLUS for 3.');
    err.code = 'intent_limit';
    throw err;
  }
  const ref = db().collection('intents').doc();
  const doc = {
    ...intent,
    ownerId: uid,
    status: 'active',
    source,
    matchCount: 0,
    createdAt: nowTs(),
    updatedAt: nowTs(),
    expiresAt: getAdmin().firestore.Timestamp.fromMillis(Date.now() + LIMITS.intentDays * DAY_MS),
    lastMatchedAt: null,
  };
  await ref.set(doc);
  await patchState(uid, { intake: FieldValue().delete() });
  const saved = { id: ref.id, ...doc, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + LIMITS.intentDays * DAY_MS };
  // First pass right away so the member sees cards within seconds.
  let cards = [];
  try {
    const ctx = await buildMatchContext();
    cards = await matchIntent(saved, ctx, { user, plus });
  } catch (err) {
    console.warn('[linky] immediate match failed', err?.message || err);
  }
  return { intent: publicIntent(saved), cards };
}

export async function closeIntent(uid, intentId) {
  if (!isValidId(intentId)) throw new Error('Unknown intent.');
  const ref = db().collection('intents').doc(intentId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().ownerId !== uid) throw new Error('Unknown intent.');
  await ref.set({ status: 'closed', updatedAt: nowTs() }, { merge: true });
  return { ok: true };
}

const publicIntent = (i) => ({
  id: i.id,
  need: i.need,
  constraints: i.constraints || [],
  offer: i.offer,
  location: i.location || '',
  remote: i.remote !== false,
  urgency: i.urgency,
  status: i.status,
  source: i.source || 'app',
  matchCount: Number(i.matchCount || 0),
  createdAt: toMillis(i.createdAt),
  expiresAt: toMillis(i.expiresAt),
  lastMatchedAt: toMillis(i.lastMatchedAt) || null,
});

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

function candidateFacts(p) {
  return {
    uid: p.uid,
    name: displayNameOf(p),
    pic: hosted(p.profilePic),
    role: text(p.occupation, 100),
    company: text(p.company, 120),
    city: text(p.city, 80),
    country: text(p.country, 80),
    skills: list(p.skills, 12),
    industries: list(p.industries, 8),
    lookingFor: list(p.lookingFor, 6),
    bio: text(p.bio, 240),
    remoteOnly: !!p.remoteOnly,
  };
}

// Cite-or-skip guard: the "why" must name something that is actually on the
// candidate's profile, otherwise the card is dropped.
function whyIsCited(why, c) {
  const w = String(why || '').toLowerCase();
  if (w.length < 12) return false;
  const facts = [...c.skills, ...c.industries, ...c.lookingFor, c.role, c.company, c.city, c.country]
    .flatMap((f) => tokens(f)).filter((t) => t.length >= 3);
  const bioHits = tokens(c.bio).filter((t) => t.length >= 6);
  return [...facts, ...bioHits].some((t) => w.includes(t));
}

function keywordScore(intent, c) {
  const kws = tokens(`${intent.need} ${(intent.constraints || []).join(' ')}`);
  const skills = c.skills.map((s) => s.toLowerCase());
  const inds = c.industries.map((s) => s.toLowerCase());
  const role = c.role.toLowerCase();
  const bio = c.bio.toLowerCase();
  const lf = c.lookingFor.map((s) => s.toLowerCase());
  let score = 0;
  const hits = [];
  for (const kw of kws) {
    if (skills.some((s) => s.includes(kw))) { score += 4; hits.push(kw); }
    if (role.includes(kw)) { score += 3; hits.push(kw); }
    if (inds.some((s) => s.includes(kw))) { score += 2; hits.push(kw); }
    if (lf.some((s) => s.includes(kw))) { score += 1; }
    if (bio.includes(kw)) { score += 1; hits.push(kw); }
  }
  const loc = String(intent.location || '').toLowerCase();
  if (loc) {
    if (c.city && loc.includes(c.city.toLowerCase())) score += 3;
    else if (c.country && loc.includes(c.country.toLowerCase())) score += 1;
    else if (!intent.remote) score -= 4;
  }
  if (c.pic) score += 0.5;
  return { score, hits: uniq(hits) };
}

function templateWhy(intent, c, hits) {
  const skillHit = c.skills.find((s) => hits.some((h) => s.toLowerCase().includes(h)));
  const where = c.city ? ` in ${c.city}` : '';
  if (skillHit) return `${c.name} lists ${skillHit}${c.role ? ` and works as ${c.role}` : ''}${where}.`;
  if (c.role && hits.some((h) => c.role.toLowerCase().includes(h))) return `${c.name} is a ${c.role}${where}${c.company ? ` at ${c.company}` : ''}.`;
  return '';
}

async function geminiRerank(intent, ownerFacts, shortlist) {
  if (!getGeminiKey()) return null;
  const prompt = [
    'You are Linky, the connector for LINKUP (a network of builders, founders and operators, Harare-first).',
    'Pick which candidates are genuinely worth an introduction for this intent. Cite-or-skip: every "why" must quote a concrete fact that appears in that candidate\'s profile (a skill, role, company, city or bio detail). If you cannot cite evidence, leave the candidate out. Return an empty list rather than guess. Never invent facts.',
    'Return STRICT JSON only: {"picks":[{"uid":"...","score":0-100,"why":"one plain sentence, under 26 words, citing the evidence","opener":"one friendly sentence the requester could send, under 30 words"}]}',
    `Return at most ${Math.min(5, shortlist.length)} picks, best first. Scores under 55 mean "not worth it" - omit them.`,
    `Intent: ${JSON.stringify(intent)}`,
    `Requester: ${JSON.stringify(ownerFacts)}`,
    `Candidates: ${JSON.stringify(shortlist)}`,
  ].join('\n');
  const raw = await geminiText(prompt, { temperature: 0.2, maxOutputTokens: 900, responseMimeType: 'application/json' });
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const parsed = JSON.parse(raw.slice(start, end + 1));
  return Array.isArray(parsed?.picks) ? parsed.picks : [];
}

export async function matchIntent(intent, ctx, { user, plus } = {}) {
  const uid = intent.ownerId;
  const owner = user || (await loadUser(uid));
  const ownerFacts = profileFacts(owner) || { uid, name: 'Member', skills: [], industries: [], lookingFor: [] };
  const isPlus = typeof plus === 'boolean' ? plus : await isPlusUser(uid, owner);
  const limits = isPlus ? LIMITS.plus : LIMITS.free;
  const myState = ctx.states[uid] || {};
  const sugRef = db().collection('introSuggestions').doc(uid);
  const sugSnap = await sugRef.get();
  const sug = sugSnap.exists ? sugSnap.data() : {};
  const cards = Array.isArray(sug.cards) ? sug.cards : [];
  const seen = sug.seen && typeof sug.seen === 'object' ? sug.seen : {};
  const today = ctx.day;
  const newToday = cards.filter((c) => dayKey(c.createdAt) === today).length;
  const room = Math.max(0, limits.newCardsPerDay - newToday);
  const stamp = { lastMatchedAt: nowTs(), updatedAt: nowTs() };
  if (room === 0) {
    await db().collection('intents').doc(intent.id).set(stamp, { merge: true });
    return [];
  }
  const muted = myState.muted || {};
  const pool = [];
  for (const p of ctx.candidates) {
    if (p.uid === uid) continue;
    if (muted[p.uid]) continue;
    if (seen[p.uid] && Date.now() - toMillis(seen[p.uid]) < LIMITS.intentDays * DAY_MS) continue;
    const st = ctx.states[p.uid] || {};
    if (st.muted && st.muted[uid]) continue;
    if (Array.isArray(st.openTo) && st.openTo.length && !st.openTo.includes(intent.offer)) continue;
    const cap = Number.isFinite(Number(st.inboundCap)) ? Number(st.inboundCap) : LIMITS.inboundPerWeek;
    if (cap <= 0) continue;
    if (st.inbound?.week === ctx.week && Number(st.inbound?.count || 0) >= cap) continue;
    const facts = candidateFacts(p);
    const { score, hits } = keywordScore(intent, facts);
    if (score <= 0) continue;
    pool.push({ facts, score, hits });
  }
  if (!pool.length) {
    await db().collection('intents').doc(intent.id).set(stamp, { merge: true });
    return [];
  }
  // Blend keyword fit with profile compatibility, then shortlist.
  const compat = new Map(localRank(compactProfile({ ...owner, uid }), pool.map((x) => compactProfile({ ...x.facts, occupation: x.facts.role })), pool.length).map((r) => [r.uid, r.score]));
  pool.forEach((x) => { x.blend = x.score * 10 + ((compat.get(x.facts.uid) || 40) - 40) * 0.5; });
  pool.sort((a, b) => b.blend - a.blend);
  const shortlist = pool.slice(0, LIMITS.shortlist);
  const byUid = new Map(shortlist.map((x) => [x.facts.uid, x]));

  let picks = null;
  try {
    picks = await geminiRerank(
      { need: intent.need, constraints: intent.constraints || [], offer: intent.offer, location: intent.location, remote: intent.remote, urgency: intent.urgency },
      { role: ownerFacts.role, company: ownerFacts.company, city: ownerFacts.city, skills: ownerFacts.skills, bio: ownerFacts.bio.slice(0, 200) },
      shortlist.map((x) => x.facts),
    );
  } catch (err) {
    console.warn('[linky] gemini rerank failed, using local ranking', err?.message || err);
  }
  let chosen = [];
  if (Array.isArray(picks)) {
    for (const p of picks) {
      const x = byUid.get(String(p?.uid || ''));
      if (!x) continue;
      const score = Math.round(Number(p?.score || 0));
      const why = text(p?.why, 220);
      if (score < 55 || !whyIsCited(why, x.facts)) continue;
      chosen.push({ x, score, why, opener: text(p?.opener, 240) });
    }
  } else {
    for (const x of shortlist) {
      const why = templateWhy(intent, x.facts, x.hits);
      if (!why || x.score < 4) continue;
      chosen.push({ x, score: Math.min(95, 50 + Math.round(x.blend)), why, opener: '' });
    }
  }
  chosen = chosen.slice(0, room);
  const created = Date.now();
  const newCards = chosen.map(({ x, score, why, opener }, i) => ({
    id: `${intent.id.slice(0, 6)}_${x.facts.uid.slice(0, 8)}_${created.toString(36)}${i}`,
    intentId: intent.id,
    need: intent.need,
    targetUid: x.facts.uid,
    targetName: x.facts.name,
    targetPic: x.facts.pic,
    targetRole: x.facts.role,
    targetCompany: x.facts.company,
    targetCity: [x.facts.city, x.facts.country].filter(Boolean).join(', '),
    targetSkills: x.facts.skills.slice(0, 5),
    why,
    opener,
    score,
    status: 'new',
    createdAt: created,
  }));
  if (newCards.length) {
    const nextSeen = { ...seen };
    newCards.forEach((c) => { nextSeen[c.targetUid] = created; });
    const keep = cards.filter((c) => created - toMillis(c.createdAt) < 30 * DAY_MS).slice(-40);
    await sugRef.set({ cards: [...keep, ...newCards], seen: nextSeen, updatedAt: nowTs(), newSince: created }, { merge: true });
  }
  await db().collection('intents').doc(intent.id).set({ ...stamp, matchCount: FieldValue().increment(newCards.length) }, { merge: true });
  return newCards;
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
    throw new Error('They have hit their weekly intro cap. Linky will keep the card for next week.');
  }
  const intro = {
    requesterId: uid,
    targetId: target,
    intentId: card.intentId,
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
      channelText: `${me.name} accepted your intro (${intro.need}). Open LINKUP to chat: https://linkup-muqu.vercel.app/chat/${matchId}`,
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

// ---------------------------------------------------------------- intake
const INTAKE_KEYS = ['need', 'offer', 'location', 'urgency'];

function heuristicIntake(history, message) {
  const draft = {};
  const asked = history.filter((m) => m.role === 'assistant').length;
  const userTurns = history.filter((m) => m.role === 'user').map((m) => m.content).concat(message);
  const all = userTurns.join(' ').toLowerCase();
  // The most detailed thing they said is the need (answers to follow-ups
  // are usually one word, the re-stated ask after a pushback is the fullest).
  draft.need = userTurns.slice().sort((a, b) => b.length - a.length)[0] || message;
  if (/\b(pay|paid|budget|\$|usd|salary|rate|hire)\b/.test(all)) draft.offer = 'paid';
  else if (/\bequity|co-?founder|shares|stake\b/.test(all)) draft.offer = 'equity';
  else if (/\badvis|mentor|guidance\b/.test(all)) draft.offer = 'advisory';
  else if (/\bcoffee|chat|casual|meet up\b/.test(all)) draft.offer = 'coffee';
  const loc = all.match(/\b(in|from|based in|around)\s+([a-z][a-z\s]{2,30})\b/);
  if (loc) draft.location = loc[2].trim().split(/\s+(and|or|who|that|with)\b/)[0].trim();
  draft.remote = !/\b(in person|in-person|local only|must be in)\b/.test(all);
  if (/\b(this week|asap|urgent|today|tomorrow)\b/.test(all)) draft.urgency = 'this_week';
  else if (/\b(this month|soon|few weeks)\b/.test(all)) draft.urgency = 'this_month';
  else if (/\b(whenever|no rush|eventually|someday)\b/.test(all)) draft.urgency = 'whenever';
  const missing = INTAKE_KEYS.filter((k) => !draft[k]);
  if (draft.need && draft.need.length < 20 && asked === 0) {
    return { reply: `"${draft.need}" is too vague for me to match well. Which skills or stack, for what project, and what would they actually do?`, ready: false };
  }
  if (!missing.length || asked >= 4) {
    const intent = { need: draft.need, constraints: [], offer: draft.offer || 'coffee', location: draft.location || '', remote: draft.remote !== false, urgency: draft.urgency || 'this_month' };
    return { reply: `Got it. I will look for: ${intent.need}${intent.location ? ` (${intent.location}${intent.remote ? ' or remote' : ''})` : ''}, ${intent.offer}, ${intent.urgency.replace('_', ' ')}. Save this intent?`, ready: true, intent };
  }
  const q = {
    need: 'Who exactly do you need, and for what?',
    offer: 'What is on the table for them - paid work, equity, advisory, or just a coffee?',
    location: 'Which city should they be in, or is remote fine?',
    urgency: 'How soon - this week, this month, or whenever?',
  };
  return { reply: q[missing[0]], ready: false };
}

export async function intake(uid, message, { userDoc, source = 'app' } = {}) {
  const user = userDoc || (await loadUser(uid));
  const facts = profileFacts(user) || {};
  const msg = text(message, 600);
  if (!msg) throw new Error('Say something first.');
  const state = await loadState(uid);
  const history = Array.isArray(state.intake?.history) ? state.intake.history.slice(-12) : [];
  let out = null;
  if (getGeminiKey()) {
    const prompt = [
      'You are Linky, the connector for LINKUP (builders, founders and operators, Harare-first). You are interviewing a member to turn a vague wish into a precise INTENT that other members can be matched against.',
      'Rules: ONE question per turn, at most 2 short sentences, plain text (no markdown). Push back on vague asks (e.g. "a developer" -> which stack, for which project, doing what). Never invent people. Never promise a match. Be warm but direct.',
      'Collect: need (who they need and for what, concrete, under 200 chars), constraints (up to 4 short must-haves), offer (paid|equity|advisory|coffee), location (city) and whether remote is fine, urgency (this_week|this_month|whenever).',
      'Once you have need + offer + urgency and (location or remote), STOP asking and return the intent.',
      'Return STRICT JSON only: {"reply":"what you say","ready":false} or {"reply":"one-line summary asking them to confirm","ready":true,"intent":{"need":"...","constraints":["..."],"offer":"paid","location":"Harare","remote":false,"urgency":"this_month"}}',
      `Member profile: ${JSON.stringify({ name: facts.name, role: facts.role, company: facts.company, city: facts.city, skills: facts.skills, bio: (facts.bio || '').slice(0, 200) })}`,
      `Conversation so far:\n${history.map((m) => `${m.role === 'user' ? 'Member' : 'Linky'}: ${m.content}`).join('\n') || '(none)'}`,
      `Member: ${msg}`,
    ].join('\n');
    try {
      const raw = await geminiText(prompt, { temperature: 0.3, maxOutputTokens: 500, responseMimeType: 'application/json' });
      const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      if (parsed && typeof parsed.reply === 'string') {
        out = { reply: text(parsed.reply, 600), ready: !!parsed.ready && !!parsed.intent, intent: parsed.intent || null };
        if (out.ready) {
          try { out.intent = normalizeIntent(out.intent); } catch { out.ready = false; out.intent = null; }
        }
      }
    } catch (err) {
      console.warn('[linky] intake gemini failed', err?.message || err);
    }
  }
  if (!out) out = heuristicIntake(history, msg);
  const nextHistory = [...history, { role: 'user', content: msg }, { role: 'assistant', content: out.reply }].slice(-12);
  await patchState(uid, { intake: { history: nextHistory, draft: out.intent || null, source, updatedAt: Date.now() } });
  return out;
}

export async function resetIntake(uid) {
  await patchState(uid, { intake: FieldValue().delete() });
  return { ok: true };
}

// ---------------------------------------------------------------- home / brief / audit
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
  const [intents, cards, inboundSnap, sentSnap, state, plus] = await Promise.all([
    activeIntentsFor(uid),
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
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  const used = state.meets?.day === dayKey() ? Number(state.meets.count || 0) : 0;
  return {
    name: profileFacts(user)?.name || '',
    plus,
    limits: { activeIntents: limits.activeIntents, meetsPerDay: plus ? null : limits.meetsPerDay, meetsUsedToday: used },
    intents: intents.map(publicIntent),
    cards: liveCards,
    inbound: inboundSnap.docs.map((d) => publicIntro(d.id, d.data())).filter((i) => now - i.createdAt < LIMITS.introDays * DAY_MS),
    sent: sentSnap.docs.map((d) => publicIntro(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
    prefs: { openTo: Array.isArray(state.openTo) ? state.openTo : OFFERS, inboundCap: Number.isFinite(Number(state.inboundCap)) ? Number(state.inboundCap) : LIMITS.inboundPerWeek },
    channels: { telegram: !!state.channels?.telegram, whatsapp: !!state.channels?.whatsapp },
    intake: state.intake?.history?.length ? { history: state.intake.history, draft: state.intake.draft || null } : null,
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

export async function audit(uid, { userDoc } = {}) {
  const user = userDoc || (await loadUser(uid));
  const [state, allIntentsSnap, cards, introsOut, introsIn] = await Promise.all([
    loadState(uid),
    db().collection('intents').where('ownerId', '==', uid).limit(30).get(),
    loadCards(uid),
    db().collection('intros').where('requesterId', '==', uid).limit(30).get(),
    db().collection('intros').where('targetId', '==', uid).limit(30).get(),
  ]);
  const facts = profileFacts(user) || {};
  return {
    facts: {
      name: facts.name, role: facts.role, company: facts.company, city: facts.city, country: facts.country,
      skills: facts.skills, industries: facts.industries, lookingFor: facts.lookingFor, goals: facts.goals, bio: facts.bio,
    },
    signals: {
      plus: await isPlusUser(uid, user),
      meetsUsedToday: state.meets?.day === dayKey() ? Number(state.meets.count || 0) : 0,
      inboundThisWeek: state.inbound?.week === weekKey() ? Number(state.inbound.count || 0) : 0,
      mutedCount: Object.keys(state.muted || {}).length,
      lastBriefDay: state.lastBriefDay || null,
      channels: { telegram: !!state.channels?.telegram, whatsapp: !!state.channels?.whatsapp },
      openTo: Array.isArray(state.openTo) ? state.openTo : OFFERS,
      inboundCap: Number.isFinite(Number(state.inboundCap)) ? Number(state.inboundCap) : LIMITS.inboundPerWeek,
    },
    intents: allIntentsSnap.docs.map((d) => publicIntent({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt),
    cards: cards.map((c) => ({ id: c.id, targetName: c.targetName, why: c.why, status: c.status, createdAt: toMillis(c.createdAt) })).sort((a, b) => b.createdAt - a.createdAt),
    introsSent: introsOut.docs.map((d) => publicIntro(d.id, d.data())),
    introsReceived: introsIn.docs.map((d) => publicIntro(d.id, d.data())),
    intakeTurns: Array.isArray(state.intake?.history) ? state.intake.history.length : 0,
    sources: ['Your LINKUP profile (users/{you})', 'Intents you told Linky', 'Cards you met / skipped / saved', 'Intros you accepted or declined', 'Push tokens (only to deliver the brief)'],
    notUsed: ['Your private messages', 'Your contacts', 'Your location beyond the city on your profile', 'Anything from Telegram / WhatsApp other than the messages you send Linky'],
  };
}

export async function forget(uid) {
  const batch = db().batch();
  const [intentsSnap, out] = await Promise.all([
    db().collection('intents').where('ownerId', '==', uid).get(),
    db().collection('intros').where('requesterId', '==', uid).where('status', '==', 'pending').get(),
  ]);
  intentsSnap.docs.forEach((d) => batch.set(d.ref, { status: 'closed', updatedAt: nowTs() }, { merge: true }));
  out.docs.forEach((d) => batch.set(d.ref, { status: 'expired', respondedAt: nowTs() }, { merge: true }));
  batch.delete(db().collection('introSuggestions').doc(uid));
  const state = await loadState(uid);
  const channels = state.channels || {};
  for (const [channel, chatId] of Object.entries(channels)) {
    if (chatId) batch.delete(db().collection('botUsers').doc(`${channel}_${chatId}`));
  }
  batch.delete(db().collection('linkyState').doc(uid));
  await batch.commit();
  return { ok: true, closedIntents: intentsSnap.size };
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

// ---------------------------------------------------------------- cron
export async function runCron({ batch = 3 } = {}) {
  const now = Date.now();
  const activeSnap = await db().collection('intents').where('status', '==', 'active').get();
  const active = activeSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const writes = db().batch();
  let expired = 0;
  const live = [];
  for (const i of active) {
    if (toMillis(i.expiresAt) && toMillis(i.expiresAt) < now) { writes.set(db().collection('intents').doc(i.id), { status: 'expired', updatedAt: nowTs() }, { merge: true }); expired += 1; }
    else live.push(i);
  }
  const pendingSnap = await db().collection('intros').where('status', '==', 'pending').get();
  let expiredIntros = 0;
  pendingSnap.docs.forEach((d) => {
    const i = d.data();
    if (toMillis(i.expiresAt) && toMillis(i.expiresAt) < now) { writes.set(d.ref, { status: 'expired', respondedAt: nowTs() }, { merge: true }); expiredIntros += 1; }
  });
  if (expired || expiredIntros) await writes.commit();

  const due = live
    .filter((i) => !i.lastMatchedAt || now - toMillis(i.lastMatchedAt) > LIMITS.rematchHours * 3600000)
    .sort((a, b) => toMillis(a.lastMatchedAt) - toMillis(b.lastMatchedAt))
    .slice(0, batch);
  const remaining = Math.max(0, live.filter((i) => !i.lastMatchedAt || now - toMillis(i.lastMatchedAt) > LIMITS.rematchHours * 3600000).length - due.length);
  const results = [];
  if (due.length) {
    const ctx = await buildMatchContext();
    const userCache = new Map();
    for (const intent of due) {
      try {
        if (!userCache.has(intent.ownerId)) userCache.set(intent.ownerId, await loadUser(intent.ownerId));
        const user = userCache.get(intent.ownerId);
        if (!user) { await db().collection('intents').doc(intent.id).set({ status: 'closed', updatedAt: nowTs() }, { merge: true }); continue; }
        const cards = await matchIntent(intent, ctx, { user });
        results.push({ intentId: intent.id, ownerId: intent.ownerId, cards: cards.length });
      } catch (err) {
        console.warn('[linky] match failed', intent.id, err?.message || err);
        results.push({ intentId: intent.id, error: String(err?.message || err) });
      }
    }
    // Daily brief: once per day, only for members who got something today.
    const today = dayKey();
    const owners = uniq(results.filter((r) => r.cards > 0).map((r) => r.ownerId));
    for (const uid of owners) {
      const state = ctx.states[uid] || (await loadState(uid));
      if (state.lastBriefDay === today) continue;
      const cards = (await loadCards(uid)).filter((c) => c.status === 'new' && dayKey(c.createdAt) === today);
      const name = profileFacts(userCache.get(uid))?.name?.split(' ')[0] || '';
      const brief = briefText(cards, name);
      if (!brief) continue;
      await notifyUser(uid, {
        type: 'daily_brief',
        content: brief.split('\n').slice(0, 2).join(' '),
        pushTitle: cards.length === 1 ? 'Linky found 1 person worth your time' : `Linky found ${cards.length} people worth your time`,
        channelText: `${brief}\n\nReply MEET to ask for the intro, or open the Linky tab.`,
        state,
      });
      await patchState(uid, { lastBriefDay: today });
    }
  }
  const telegram = await ensureTelegramWebhook('https://linkup-muqu.vercel.app').catch((e) => ({ error: String(e?.message || e) }));
  return { activeIntents: live.length, expiredIntents: expired, expiredIntros, processed: results, remaining, telegram };
}
