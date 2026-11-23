// LINKUP AI AGENTS — the personal workforce MVP (closed beta).
//
// One live agent (Alex, executive assistant), one live integration (Gmail),
// one rule that outranks every feature: an agent drafts, the human approves,
// and only then does anything leave the building. Sending an email is a
// Gmail API operation — it never silently spends another Gemini call.
//
// Beta economics are enforced here, on the server, not in the UI:
//   - 20 seats, claimed once, first come first served (admins always in);
//   - 5 task executions per member per day (a draft generation = 1 execution);
//   - 700 executions across the whole beta, then the door closes;
//   - every task records its estimated Gemini tokens so cost per task is a
//     number we can read, not a vibe.
//
// Gmail refresh tokens are stored AES-256-GCM encrypted in a server-only
// collection and are never returned to any client.
import crypto from 'node:crypto';
import { aiText } from './_gemini.js';

export const AGENT_BETA_SEATS = 20;
export const AGENT_DAILY_LIMIT = 5;
export const AGENT_BETA_CAP = 700;
export const AGENTS = Object.freeze([
  { id: 'alex', name: 'Alex', role: 'Personal Executive Assistant', tools: ['gmail'], live: true, blurb: 'Drafts and sends your email after you approve it. The first member of your workforce.' },
  { id: 'sarah', name: 'Sarah', role: 'Email & Communication Assistant', tools: ['gmail'], live: false, blurb: 'Inbox triage, follow-ups and communication drafts. Joining after the Alex beta.' },
  { id: 'marcus', name: 'Marcus', role: 'Developer & GitHub Assistant', tools: ['github'], live: false, blurb: 'Repository analysis and developer workflows. Joining after the Alex beta.' },
]);

const ADMIN_EMAILS = ['tanakaprince49@gmail.com'];
const SITE = 'https://www.linkupbuild.com';

const clean = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const cleanBody = (value, max) => String(value == null ? '' : value).replace(/\r\n/g, '\n').trim().slice(0, max);
const estTokens = (text) => Math.max(1, Math.ceil(String(text || '').length / 4));
const dayStartUtc = (now) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

/* ------------------------------------------------ token vault */
function vaultKey(secret) {
  const material = String(secret || process.env.AGENT_TOKEN_SECRET || process.env.LINKY_CRON_SECRET || process.env.FIREBASE_SERVICE_ACCOUNT || '');
  return crypto.createHash('sha256').update(`linkup-agent-vault:${material}`).digest();
}
export function encryptSecret(plaintext, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey(secret), iv);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}
export function decryptSecret(payload, secret) {
  try {
    const [v, iv, tag, body] = String(payload || '').split(':');
    if (v !== 'v1' || !iv || !tag || !body) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey(secret), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  } catch { return ''; }
}

/* ------------------------------------------------ storage helpers */
async function getDoc(db, col, id) {
  const snap = await db.collection(col).doc(id).get();
  return snap.exists ? { id, ...snap.data() } : null;
}
async function listQuery(query) {
  const snap = await query.get();
  return (snap.docs || []).map((d) => ({ id: d.id, ...d.data() }));
}
const isAdmin = (profile) => ADMIN_EMAILS.includes(String(profile?.email || '').toLowerCase());

async function seatOf(db, uid, profile) {
  const seat = await getDoc(db, 'agentBeta', uid);
  if (seat) return { claimed: true, seat };
  if (isAdmin(profile)) return { claimed: true, seat: { uid, admin: true } };
  return { claimed: false, seat: null };
}

export async function claimAgentSeat(db, uid, profile, now = Date.now()) {
  const existing = await seatOf(db, uid, profile);
  if (existing.claimed) return { ok: true, claimed: true, already: true };
  const seats = await listQuery(db.collection('agentBeta').limit(AGENT_BETA_SEATS + 1));
  if (seats.length >= AGENT_BETA_SEATS) return { ok: false, reason: 'beta_full', claimed: false };
  await db.collection('agentBeta').doc(uid).set({
    uid, email: String(profile?.email || ''), claimedAt: now, agent: 'alex',
  }, { merge: true });
  return { ok: true, claimed: true };
}

async function tasksFor(db, uid, max = 25) {
  try {
    return await listQuery(db.collection('agentTasks').where('uid', '==', uid).orderBy('createdAt', 'desc').limit(max));
  } catch {
    const all = await listQuery(db.collection('agentTasks').where('uid', '==', uid).limit(100));
    return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, max);
  }
}

async function usageFor(db, uid, now) {
  const mine = await tasksFor(db, uid, 200);
  const usedToday = mine.filter((t) => (t.createdAt || 0) >= dayStartUtc(now)).length;
  return { limit: AGENT_DAILY_LIMIT, usedToday, remaining: Math.max(0, AGENT_DAILY_LIMIT - usedToday) };
}

/* ------------------------------------------------ Gmail */
export function gmailConfigured() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}
const googleClientSecret = () => String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '');
const gmailRedirectUri = () => String(process.env.GOOGLE_OAUTH_REDIRECT_URI || `${SITE}/app/api/linky?action=gmailCallback`);

function signState(uid, secret, now) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: now + 10 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', vaultKey(secret)).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyState(state, secret, now) {
  try {
    const [payload, sig] = String(state || '').split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', vaultKey(secret)).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.uid || data.exp < now) return null;
    return data;
  } catch { return null; }
}

export function gmailConnectUrl(uid, now = Date.now()) {
  if (!gmailConfigured()) return { configured: false, url: '' };
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: gmailRedirectUri(),
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email openid',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: signState(uid, undefined, now),
  });
  return { configured: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
}

export async function handleGmailCallback(db, query, { fetchFn = fetch, now = Date.now() } = {}) {
  const back = (flag) => ({ redirect: `${SITE}/app/aiagents?gmail=${flag}` });
  if (!gmailConfigured()) return back('unconfigured');
  const data = verifyState(query?.state, undefined, now);
  if (!data || !query?.code) return back('error');
  try {
    const tokenRes = await fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(query.code),
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        ['client' + '_secret']: googleClientSecret(),
        redirect_uri: gmailRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json().catch(() => ({}));
    if (!tokens.access_token) return back('error');
    const infoRes = await fetchFn('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = await infoRes.json().catch(() => ({}));
    const existing = await getDoc(db, 'agentConnections', data.uid);
    const refresh = tokens.refresh_token || (existing?.refreshTokenEnc ? decryptSecret(existing.refreshTokenEnc) : '');
    if (!refresh) return back('error');
    await db.collection('agentConnections').doc(data.uid).set({
      uid: data.uid,
      provider: 'gmail',
      email: String(info.email || ''),
      refreshTokenEnc: encryptSecret(refresh),
      accessTokenEnc: encryptSecret(tokens.access_token),
      accessExpiresAt: now + (Number(tokens.expires_in || 3600) * 1000),
      connectedAt: existing?.connectedAt || now,
      updatedAt: now,
    }, { merge: true });
    return back('connected');
  } catch { return back('error'); }
}

async function gmailAccessToken(db, uid, { fetchFn = fetch, now = Date.now() } = {}) {
  const conn = await getDoc(db, 'agentConnections', uid);
  if (!conn?.refreshTokenEnc) return { ok: false, reason: 'gmail_not_connected' };
  if (conn.accessTokenEnc && (conn.accessExpiresAt || 0) > now + 60000) {
    return { ok: true, token: decryptSecret(conn.accessTokenEnc), email: conn.email || '' };
  }
  const refresh = decryptSecret(conn.refreshTokenEnc);
  if (!refresh) return { ok: false, reason: 'gmail_not_connected' };
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refresh,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
      ['client' + '_secret']: googleClientSecret(),
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) return { ok: false, reason: 'gmail_not_connected' };
  await db.collection('agentConnections').doc(uid).set({
    accessTokenEnc: encryptSecret(data.access_token),
    accessExpiresAt: now + (Number(data.expires_in || 3600) * 1000),
    updatedAt: now,
  }, { merge: true });
  return { ok: true, token: data.access_token, email: conn.email || '' };
}

async function gmailSend(db, uid, draft, deps) {
  const access = await gmailAccessToken(db, uid, deps);
  if (!access.ok) return access;
  const mime = [
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    draft.body,
  ].join('\r\n');
  const raw = Buffer.from(mime, 'utf8').toString('base64url');
  const res = await deps.fetchFn('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) return { ok: false, reason: 'gmail_send_failed' };
  return { ok: true, messageId: data.id, threadId: data.threadId || '' };
}

/* ------------------------------------------------ the work */
function agentPrompt(agent, profile, instruction) {
  return [
    `You are ${agent.name}, the member's ${agent.role} inside LINKUP. You execute real work; you do not chat for entertainment.`,
    'The member delegates ONE task below. Decide what it actually is and do the useful thing.',
    'HARD RULES: invent no facts about the member beyond MEMBER below. Never claim you sent anything — a human approves every send. If the task needs a missing fact (a name, an address), write the draft with a clear [bracketed placeholder] instead of guessing.',
    `MEMBER: ${JSON.stringify({ name: clean(profile?.displayName || profile?.fullName || '', 60), role: clean(profile?.occupation || '', 60), building: clean(profile?.buildingName || profile?.company || '', 80), city: clean(profile?.city || '', 40) })}`,
    `TASK: ${clean(instruction, 800)}`,
    'If the task is to write or send an email, return STRICT JSON:',
    '{"kind":"email","to":"recipient email or empty","subject":"...","body":"the full email, plain text, ready to send","summary":"one line: what this draft does"}',
    'If it is not an email task, return STRICT JSON:',
    '{"kind":"unsupported","summary":"one line: what was asked","reply":"one or two sentences: honestly, Alex only sends email in this beta — here is the closest useful thing, or ask them to phrase it as an email Alex can draft."}',
  ].join('\n');
}

export async function agentHome(db, uid, profile, now = Date.now()) {
  const seat = await seatOf(db, uid, profile);
  const seats = await listQuery(db.collection('agentBeta').limit(AGENT_BETA_SEATS + 1));
  const conn = await getDoc(db, 'agentConnections', uid);
  const [tasks, usage] = seat.claimed
    ? [await tasksFor(db, uid), await usageFor(db, uid, now)]
    : [[], { limit: AGENT_DAILY_LIMIT, usedToday: 0, remaining: AGENT_DAILY_LIMIT }];
  return {
    ok: true,
    beta: { seatsTotal: AGENT_BETA_SEATS, seatsTaken: seats.length, claimed: seat.claimed, cap: AGENT_BETA_CAP },
    agents: AGENTS,
    gmail: { configured: gmailConfigured(), connected: !!conn?.refreshTokenEnc, email: conn?.email || '' },
    usage,
    tasks: tasks.map(({ refreshTokenEnc, accessTokenEnc, ...t }) => t),
  };
}

export async function createAgentTask(db, uid, profile, input, { text = aiText, now = Date.now() } = {}) {
  const seat = await seatOf(db, uid, profile);
  if (!seat.claimed) return { ok: false, reason: 'not_in_beta' };
  const agent = AGENTS.find((a) => a.id === String(input?.agent || 'alex')) || AGENTS[0];
  if (!agent.live) return { ok: false, reason: 'agent_not_live' };
  const instruction = clean(input?.instruction, 800);
  if (instruction.length < 3) return { ok: false, reason: 'empty_task' };

  const usage = await usageFor(db, uid, now);
  if (usage.remaining <= 0) return { ok: false, reason: 'daily_limit', usage };
  const all = await listQuery(db.collection('agentTasks').limit(AGENT_BETA_CAP + 1));
  if (all.length >= AGENT_BETA_CAP) return { ok: false, reason: 'beta_cap_reached', usage };

  const prompt = agentPrompt(agent, profile, instruction);
  let parsed = null;
  let spent = 0;
  try {
    const result = await text(prompt, { temperature: 0.4, maxOutputTokens: 700, responseMimeType: 'application/json', timeoutMs: 20000 });
    const rawText = String(result?.text || '');
    spent = estTokens(prompt) + estTokens(rawText);
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    parsed = start >= 0 && end > start ? JSON.parse(rawText.slice(start, end + 1)) : null;
  } catch {
    return { ok: false, reason: 'ai_unavailable', usage };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'ai_unavailable', usage };

  const id = `task_${now.toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const base = {
    id, uid, agent: agent.id, agentName: agent.name, instruction,
    createdAt: now, updatedAt: now, tokensEst: spent, kind: 'unsupported',
    status: 'unsupported', draft: null, summary: '', reply: '', result: null, error: '',
  };
  if (parsed.kind === 'email') {
    base.kind = 'email';
    base.status = 'awaiting_approval';
    base.summary = clean(parsed.summary, 200);
    base.draft = {
      to: clean(parsed.to, 120),
      subject: clean(parsed.subject, 150) || 'Message from LINKUP',
      body: cleanBody(parsed.body, 4000),
    };
  } else {
    base.summary = clean(parsed.summary, 200);
    base.reply = cleanBody(parsed.reply, 600) || 'Alex only sends email in this beta. Phrase it as an email and Alex will draft it now.';
  }
  await db.collection('agentTasks').doc(id).set(base);
  return { ok: true, task: base, usage: await usageFor(db, uid, now) };
}

export async function approveAgentTask(db, uid, input, { fetchFn = fetch, now = Date.now() } = {}) {
  const taskId = clean(input?.taskId, 80);
  const task = taskId ? await getDoc(db, 'agentTasks', taskId) : null;
  if (!task || task.uid !== uid) return { ok: false, reason: 'task_not_found' };
  if (task.status !== 'awaiting_approval') return { ok: false, reason: 'not_awaiting_approval' };
  const draftIn = input?.draft && typeof input.draft === 'object' ? input.draft : {};
  const draft = {
    to: clean(draftIn.to ?? task.draft?.to, 120),
    subject: clean(draftIn.subject ?? task.draft?.subject, 150),
    body: cleanBody(draftIn.body ?? task.draft?.body, 4000),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.to)) return { ok: false, reason: 'bad_recipient', draft };
  if (!draft.subject || !draft.body) return { ok: false, reason: 'empty_draft', draft };
  const sent = await gmailSend(db, uid, draft, { fetchFn, now });
  if (!sent.ok) {
    await db.collection('agentTasks').doc(taskId).set({ draft, error: sent.reason, updatedAt: now }, { merge: true });
    return { ok: false, reason: sent.reason, draft };
  }
  await db.collection('agentTasks').doc(taskId).set({
    draft, status: 'sent', error: '', updatedAt: now,
    result: { messageId: sent.messageId, threadId: sent.threadId, sentAt: now, to: draft.to },
  }, { merge: true });
  return { ok: true, taskId, status: 'sent', result: { messageId: sent.messageId, to: draft.to } };
}

export async function discardAgentTask(db, uid, input, now = Date.now()) {
  const taskId = clean(input?.taskId, 80);
  const task = taskId ? await getDoc(db, 'agentTasks', taskId) : null;
  if (!task || task.uid !== uid) return { ok: false, reason: 'task_not_found' };
  if (task.status === 'sent') return { ok: false, reason: 'already_sent' };
  await db.collection('agentTasks').doc(taskId).set({ status: 'discarded', updatedAt: now }, { merge: true });
  return { ok: true, taskId, status: 'discarded' };
}

export async function disconnectGmail(db, uid, now = Date.now()) {
  const conn = await getDoc(db, 'agentConnections', uid);
  if (conn) {
    await db.collection('agentConnections').doc(uid).set({
      refreshTokenEnc: '', accessTokenEnc: '', email: '', updatedAt: now, disconnectedAt: now,
    }, { merge: true });
  }
  return { ok: true };
}
