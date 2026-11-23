// LINKUP AI AGENTS — the personal workforce (closed beta).
//
// Every agent is a labelled AI with a LINKUP profile; every agent works the
// same way: the agent drafts inside a message thread, the human approves,
// and only then does anything leave the building. Sending an email (Gmail)
// or creating an event (Google Calendar) is an API operation — it never
// silently spends another Gemini call.
//
// Beta economics are enforced here, on the server, not in the UI:
//   - 20 seats, claimed once, first come first served (admins always in);
//   - 5 task executions per member per day across ALL agents (a message that
//     produces a draft = 1 execution);
//   - 700 executions across the whole beta, then the door closes;
//   - every task records its estimated Gemini tokens so cost per task is a
//     number we can read, not a vibe.
//
// Google refresh tokens are stored AES-256-GCM encrypted in a server-only
// collection and are never returned to any client.
import crypto from 'node:crypto';
import { aiText } from './_gemini.js';

export const AGENT_BETA_SEATS = 20;
export const AGENT_DAILY_LIMIT = 5;
export const AGENT_BETA_CAP = 700;
export const AGENTS = Object.freeze([
  {
    id: 'alex', name: 'Alex', role: 'Personal Executive Assistant', provider: 'gmail', tools: ['gmail'], live: true,
    blurb: 'Your email chief of staff. Drafts, follows up and sends — after your approval.',
    bio: 'Alex is an AI executive assistant on LINKUP. Give Alex an outcome in plain language — "follow up with Thabo about Friday" — and Alex drafts the exact email in this thread. Nothing is sent until you read it, edit it and approve it.',
    skills: ['Email drafting', 'Follow-ups', 'Introductions', 'Meeting requests', 'Inbox replies'],
  },
  {
    id: 'Sarah', name: 'Sarah', role: 'Scheduling & Calendar Assistant', provider: 'calendar', tools: ['calendar'], live: true,
    blurb: 'Your calendar chief of staff. Puts real events on Google Calendar — after your approval.',
    bio: 'Sarah is an AI scheduling assistant on LINKUP. Say "set up 30 minutes with sarah@example.com tomorrow at 10" and Sarah drafts the exact Google Calendar event in this thread. Nothing lands on your calendar until you approve it.',
    skills: ['Meeting scheduling', 'Calendar events', 'Invites', 'Rescheduling drafts', 'Reminders setup'],
  },
]);

const ADMIN_EMAILS = ['tanakaprince49@gmail.com'];
const SITE = 'https://www.linkupbuild.com';
const PROVIDERS = {
  gmail: { scope: 'https://www.googleapis.com/auth/gmail.send', callback: 'gmailCallback' },
  calendar: { scope: 'https://www.googleapis.com/auth/calendar.events', callback: 'calendarCallback' },
};

const clean = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const cleanBody = (value, max) => String(value == null ? '' : value).replace(/\r\n/g, '\n').trim().slice(0, max);
const estTokens = (text) => Math.max(1, Math.ceil(String(text || '').length / 4));
const dayStartUtc = (now) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const agentById = (id) => AGENTS.find((a) => a.id === String(id || 'alex')) || AGENTS[0];
const providerOf = (agent) => (agent?.provider === 'calendar' ? 'calendar' : 'gmail');

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
// One connection doc per member per provider. Gmail keeps the original uid
// doc id (shipped first); calendar lives beside it.
const connId = (uid, provider) => (provider === 'gmail' ? uid : `${uid}__${provider}`);

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

async function tasksFor(db, uid, max = 60) {
  try {
    return await listQuery(db.collection('agentTasks').where('uid', '==', uid).orderBy('createdAt', 'desc').limit(max));
  } catch {
    const all = await listQuery(db.collection('agentTasks').where('uid', '==', uid).limit(200));
    return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, max);
  }
}

async function usageFor(db, uid, now) {
  const mine = await tasksFor(db, uid, 200);
  const usedToday = mine.filter((t) => (t.createdAt || 0) >= dayStartUtc(now)).length;
  return { limit: AGENT_DAILY_LIMIT, usedToday, remaining: Math.max(0, AGENT_DAILY_LIMIT - usedToday) };
}

/* ------------------------------------------------ Google (Gmail + Calendar) */
export function gmailConfigured() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}
export const googleConfigured = gmailConfigured;
const googleClientSecret = () => String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '');
const redirectUriFor = (provider) => String(
  (provider === 'calendar' ? process.env.GOOGLE_CALENDAR_REDIRECT_URI : process.env.GOOGLE_OAUTH_REDIRECT_URI)
  || `${SITE}/app/api/linky?action=${PROVIDERS[provider].callback}`,
);

function signState(uid, provider, secret, now) {
  const payload = Buffer.from(JSON.stringify({ uid, p: provider, exp: now + 10 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', vaultKey(secret)).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyState(state, provider, secret, now) {
  try {
    const [payload, sig] = String(state || '').split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', vaultKey(secret)).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.uid || data.exp < now || data.p !== provider) return null;
    return data;
  } catch { return null; }
}

export function googleConnectUrl(uid, provider = 'gmail', now = Date.now()) {
  const p = PROVIDERS[provider] ? provider : 'gmail';
  if (!gmailConfigured()) return { configured: false, url: '' };
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirectUriFor(p),
    response_type: 'code',
    scope: `${PROVIDERS[p].scope} https://www.googleapis.com/auth/userinfo.email openid`,
    access_type: 'offline',
    prompt: 'consent',
    // NOTE: no include_granted_scopes here, ever. It makes Google fold every
    // scope the member previously granted this client into our request —
    // a legacy Drive/YouTube grant then poisons an innocent calendar ask
    // ("scopes that cannot be requested together"). Each agent's consent
    // stands alone, which is also why connections are stored per provider.
    state: signState(uid, p, undefined, now),
  });
  return { configured: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
}
export const gmailConnectUrl = (uid, now = Date.now()) => googleConnectUrl(uid, 'gmail', now);

async function exchangeCode(fetchFn, provider, code) {
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code),
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
      ['client' + '_secret']: googleClientSecret(),
      redirect_uri: redirectUriFor(provider),
      grant_type: 'authorization_code',
    }),
  });
  return res.json().catch(() => ({}));
}

export async function handleOAuthCallback(db, provider, query, { fetchFn = fetch, now = Date.now() } = {}) {
  const p = PROVIDERS[provider] ? provider : 'gmail';
  const back = (flag) => ({ redirect: `${SITE}/app/aiagents?${p}=${flag}` });
  if (!gmailConfigured()) return back('unconfigured');
  const data = verifyState(query?.state, p, undefined, now);
  if (!data || !query?.code) return back('error');
  try {
    const tokens = await exchangeCode(fetchFn, p, query.code);
    if (!tokens.access_token) return back('error');
    const infoRes = await fetchFn('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = await infoRes.json().catch(() => ({}));
    const id = connId(data.uid, p);
    const existing = await getDoc(db, 'agentConnections', id);
    const refresh = tokens.refresh_token || (existing?.refreshTokenEnc ? decryptSecret(existing.refreshTokenEnc) : '');
    if (!refresh) return back('error');
    await db.collection('agentConnections').doc(id).set({
      uid: data.uid,
      provider: p,
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
export const handleGmailCallback = (db, query, deps) => handleOAuthCallback(db, 'gmail', query, deps);
export const handleCalendarCallback = (db, query, deps) => handleOAuthCallback(db, 'calendar', query, deps);

async function googleAccessToken(db, uid, provider, { fetchFn = fetch, now = Date.now() } = {}) {
  const id = connId(uid, provider);
  const conn = await getDoc(db, 'agentConnections', id);
  if (!conn?.refreshTokenEnc) return { ok: false, reason: `${provider}_not_connected` };
  if (conn.accessTokenEnc && (conn.accessExpiresAt || 0) > now + 60000) {
    return { ok: true, token: decryptSecret(conn.accessTokenEnc), email: conn.email || '' };
  }
  const refresh = decryptSecret(conn.refreshTokenEnc);
  if (!refresh) return { ok: false, reason: `${provider}_not_connected` };
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
  if (!data.access_token) return { ok: false, reason: `${provider}_not_connected` };
  await db.collection('agentConnections').doc(id).set({
    accessTokenEnc: encryptSecret(data.access_token),
    accessExpiresAt: now + (Number(data.expires_in || 3600) * 1000),
    updatedAt: now,
  }, { merge: true });
  return { ok: true, token: data.access_token, email: conn.email || '' };
}

async function gmailSend(db, uid, draft, deps) {
  const access = await googleAccessToken(db, uid, 'gmail', deps);
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

async function calendarCreate(db, uid, draft, deps) {
  const access = await googleAccessToken(db, uid, 'calendar', deps);
  if (!access.ok) return access;
  const event = {
    summary: draft.title,
    description: draft.description || '',
    start: { dateTime: draft.start, timeZone: draft.timeZone },
    end: { dateTime: draft.end, timeZone: draft.timeZone },
    attendees: (draft.attendees || []).map((email) => ({ email })),
  };
  const res = await deps.fetchFn('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) return { ok: false, reason: 'calendar_create_failed' };
  return { ok: true, eventId: data.id, htmlLink: data.htmlLink || '' };
}

/* ------------------------------------------------ the work */
function localNow(tz, now) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(now));
  } catch {
    return new Date(now).toUTCString();
  }
}

function agentPrompt(agent, profile, instruction, tz, now) {
  const member = JSON.stringify({ name: clean(profile?.displayName || profile?.fullName || '', 60), role: clean(profile?.occupation || '', 60), building: clean(profile?.buildingName || profile?.company || '', 80), city: clean(profile?.city || '', 40) });
  const head = [
    `You are ${agent.name}, the member's ${agent.role} inside LINKUP. You are an AI agent with a member profile; you execute real work, you do not chat for entertainment.`,
    'The member delegates ONE task below, in a message thread with you. Decide what it actually is and do the useful thing.',
    'HARD RULES: invent no facts about the member beyond MEMBER below. Never claim you sent or created anything — a human approves every external action. If a needed fact is missing (a name, an address), use a clear [bracketed placeholder] instead of guessing.',
    `MEMBER: ${member}`,
    `TASK: ${clean(instruction, 800)}`,
  ];
  if (providerOf(agent) === 'calendar') {
    return [
      ...head,
      `CONTEXT: the member's timezone is ${tz}. Right now for the member it is ${localNow(tz, now)}. Resolve every relative time ("tomorrow", "next Tuesday", "in an hour") against that. Default duration is 30 minutes when none is given.`,
      'If the task is to schedule or create a calendar event, return STRICT JSON:',
      '{"kind":"event","title":"...","start":"YYYY-MM-DDTHH:mm:ss","end":"YYYY-MM-DDTHH:mm:ss","attendees":["email@example.com"],"description":"...","summary":"one line: what this event is"}',
      'Times are member-local wall-clock times in the member timezone above, no UTC suffix. Attendees is an empty array when none are named.',
      'If it is not a scheduling task, return STRICT JSON:',
      '{"kind":"unsupported","summary":"one line: what was asked","reply":"one or two sentences: honestly, Sarah only schedules in this beta — Alex (Gmail) sends email; phrase scheduling requests as an event Sarah can draft."}',
    ].join('\n');
  }
  return [
    ...head,
    'If the task is to write or send an email, return STRICT JSON:',
    '{"kind":"email","to":"recipient email or empty","subject":"...","body":"the full email, plain text, ready to send","summary":"one line: what this draft does"}',
    'If it is not an email task, return STRICT JSON:',
    '{"kind":"unsupported","summary":"one line: what was asked","reply":"one or two sentences: honestly, Alex only sends email in this beta — Sarah (Calendar) schedules events; phrase it as an email Alex can draft."}',
  ].join('\n');
}

export async function agentHome(db, uid, profile, now = Date.now()) {
  const seat = await seatOf(db, uid, profile);
  const seats = await listQuery(db.collection('agentBeta').limit(AGENT_BETA_SEATS + 1));
  const [gmailConn, calendarConn] = [
    await getDoc(db, 'agentConnections', connId(uid, 'gmail')),
    await getDoc(db, 'agentConnections', connId(uid, 'calendar')),
  ];
  const [tasks, usage] = seat.claimed
    ? [await tasksFor(db, uid), await usageFor(db, uid, now)]
    : [[], { limit: AGENT_DAILY_LIMIT, usedToday: 0, remaining: AGENT_DAILY_LIMIT }];
  return {
    ok: true,
    beta: { seatsTotal: AGENT_BETA_SEATS, seatsTaken: seats.length, claimed: seat.claimed, cap: AGENT_BETA_CAP },
    agents: AGENTS,
    gmail: { configured: gmailConfigured(), connected: !!gmailConn?.refreshTokenEnc, email: gmailConn?.email || '' },
    calendar: { configured: gmailConfigured(), connected: !!calendarConn?.refreshTokenEnc, email: calendarConn?.email || '' },
    usage,
    tasks: tasks.map(({ refreshTokenEnc, accessTokenEnc, ...t }) => t),
  };
}

const validTz = (tz) => {
  const value = clean(tz, 40);
  return /^[A-Za-z_+\-/0-9]+$/.test(value) && value.length >= 3 ? value : 'UTC';
};
const validWhen = (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(String(value || ''));

export async function createAgentTask(db, uid, profile, input, { text = aiText, now = Date.now() } = {}) {
  const seat = await seatOf(db, uid, profile);
  if (!seat.claimed) return { ok: false, reason: 'not_in_beta' };
  const agent = agentById(input?.agent);
  if (!agent.live) return { ok: false, reason: 'agent_not_live' };
  const instruction = clean(input?.instruction, 800);
  if (instruction.length < 1) return { ok: false, reason: 'empty_task' };
  const tz = validTz(input?.tz);

  const usage = await usageFor(db, uid, now);
  if (usage.remaining <= 0) return { ok: false, reason: 'daily_limit', usage };
  const all = await listQuery(db.collection('agentTasks').limit(AGENT_BETA_CAP + 1));
  if (all.length >= AGENT_BETA_CAP) return { ok: false, reason: 'beta_cap_reached', usage };

  const prompt = agentPrompt(agent, profile, instruction, tz, now);
  // Models reply in JSON with varying discipline (fences, prose, truncation).
  // Extract leniently, infer the kind from the fields when it is omitted, and
  // give the model exactly one repair attempt before admitting defeat — with
  // the real failure attached, never a bare "unavailable".
  const extractJson = (raw) => {
    const textIn = String(raw || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const start = textIn.indexOf('{');
    const end = textIn.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const obj = JSON.parse(textIn.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'));
      if (!obj || typeof obj !== 'object') return null;
      if (!obj.kind) {
        if (obj.start || obj.title) obj.kind = 'event';
        else if (obj.to !== undefined || obj.subject || obj.body) obj.kind = 'email';
      }
      return obj;
    } catch { return null; }
  };
  let parsed = null;
  let spent = 0;
  let aiDetail = '';
  for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
    try {
      const result = await text(
        attempt === 0 ? prompt : `${prompt}\n\nIMPORTANT: reply with ONLY the JSON object. No markdown, no commentary.`,
        { temperature: 0.3, maxOutputTokens: 900, responseMimeType: 'application/json', timeoutMs: attempt === 0 ? 25000 : 10000 },
      );
      const rawText = String(result?.text || '');
      spent += estTokens(prompt) + estTokens(rawText);
      parsed = extractJson(rawText);
      if (!parsed) aiDetail = `unparseable AI reply (${rawText.slice(0, 60).replace(/\s+/g, ' ')}…)`;
    } catch (err) {
      // A provider error already failed over Gemini→Zen inside aiText.
      // Repeating it only burns the 60s function budget — report it instead.
      aiDetail = String(err?.message || err).replace(/\s+/g, ' ').slice(0, 110);
      break;
    }
  }
  if (!parsed && providerOf(agent) === 'gmail') {
    // Deterministic safety net, the Linky way: if every model is down, Alex
    // still drafts — from the member's exact words, with the recipient lifted
    // out of the instruction. Nothing is invented, the draft says what it is,
    // and approval is still required before Gmail hears a word of it.
    const emailMatch = instruction.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    const to = emailMatch ? emailMatch[0] : '';
    const stripped = instruction
      .replace(/^.*?\b(?:email|mail|send(?: an? email)? to)\s+/i, '')
      .replace(to, '')
      .replace(/^\s*[:\-\u2014]+\s*/, '')
      .trim();
    parsed = {
      kind: 'email',
      to,
      subject: clean((stripped || 'Following up').split(/[.!?\n]/)[0], 80) || 'Following up',
      body: cleanBody(stripped || instruction, 4000),
      summary: `The AI is unreachable right now (${String(aiDetail).slice(0, 60)}), so Alex drafted this from your exact words. Edit freely — nothing sends without your approval.`,
    };
    console.warn('[agents] template draft fallback:', aiDetail);
  }
  if (!parsed) {
    console.warn('[agents] task AI failed:', aiDetail);
    return { ok: false, reason: 'ai_unavailable', detail: aiDetail, usage };
  }

  const id = `task_${now.toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const base = {
    id, uid, agent: agent.id, agentName: agent.name, instruction,
    createdAt: now, updatedAt: now, tokensEst: spent, kind: 'unsupported',
    status: 'unsupported', draft: null, summary: '', reply: '', result: null, error: '',
  };
  if (parsed.kind === 'email' && providerOf(agent) === 'gmail') {
    base.kind = 'email';
    base.status = 'awaiting_approval';
    base.summary = clean(parsed.summary, 200);
    base.draft = {
      to: clean(parsed.to, 120),
      subject: clean(parsed.subject, 150) || 'Message from LINKUP',
      body: cleanBody(parsed.body, 4000),
    };
  } else if (parsed.kind === 'event' && providerOf(agent) === 'calendar') {
    const start = clean(parsed.start, 25);
    const end = clean(parsed.end, 25);
    if (!validWhen(start) || !validWhen(end) || end <= start) {
      base.summary = clean(parsed.summary, 200);
      base.reply = 'Sarah could not pin that time down. Say it with a date and a start time — "tomorrow at 10am for 30 minutes" — and Sarah will draft it.';
    } else {
      base.kind = 'event';
      base.status = 'awaiting_approval';
      base.summary = clean(parsed.summary, 200);
      base.draft = {
        title: clean(parsed.title, 200) || 'Meeting',
        start: start.length === 16 ? `${start}:00` : start,
        end: end.length === 16 ? `${end}:00` : end,
        attendees: Array.isArray(parsed.attendees) ? parsed.attendees.map((a) => clean(a, 120)).filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)).slice(0, 20) : [],
        description: cleanBody(parsed.description, 2000),
        timeZone: tz,
      };
    }
  } else {
    base.summary = clean(parsed.summary, 200);
    base.reply = cleanBody(parsed.reply, 600) || (providerOf(agent) === 'calendar'
      ? 'Sarah only schedules in this beta. Phrase it as an event and Sarah will draft it now.'
      : 'Alex only sends email in this beta. Phrase it as an email and Alex will draft it now.');
  }
  await db.collection('agentTasks').doc(id).set(base);
  return { ok: true, task: base, usage: await usageFor(db, uid, now) };
}

const normalizeAttendees = (value) => {
  const list = Array.isArray(value)
    ? value.map((a) => clean(a, 120))
    : String(value || '').split(/[,\s]+/).map((a) => clean(a, 120));
  return [...new Set(list.filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)))].slice(0, 20);
};

export async function approveAgentTask(db, uid, input, { fetchFn = fetch, now = Date.now() } = {}) {
  const taskId = clean(input?.taskId, 80);
  const task = taskId ? await getDoc(db, 'agentTasks', taskId) : null;
  if (!task || task.uid !== uid) return { ok: false, reason: 'task_not_found' };
  if (task.status !== 'awaiting_approval') return { ok: false, reason: 'not_awaiting_approval' };
  const draftIn = input?.draft && typeof input.draft === 'object' ? input.draft : {};

  if (task.kind === 'event') {
    const draft = {
      title: clean(draftIn.title ?? task.draft?.title, 200),
      start: clean(draftIn.start ?? task.draft?.start, 25),
      end: clean(draftIn.end ?? task.draft?.end, 25),
      attendees: normalizeAttendees(draftIn.attendees ?? task.draft?.attendees),
      description: cleanBody(draftIn.description ?? task.draft?.description, 2000),
      timeZone: validTz(draftIn.timeZone ?? task.draft?.timeZone),
    };
    if (!draft.title) return { ok: false, reason: 'empty_draft', draft };
    if (!validWhen(draft.start) || !validWhen(draft.end) || draft.end <= draft.start) return { ok: false, reason: 'bad_time', draft };
    const created = await calendarCreate(db, uid, draft, { fetchFn, now });
    if (!created.ok) {
      await db.collection('agentTasks').doc(taskId).set({ draft, error: created.reason, updatedAt: now }, { merge: true });
      return { ok: false, reason: created.reason, draft };
    }
    await db.collection('agentTasks').doc(taskId).set({
      draft, status: 'sent', error: '', updatedAt: now,
      result: { eventId: created.eventId, htmlLink: created.htmlLink, createdAt: now, title: draft.title, start: draft.start },
    }, { merge: true });
    return { ok: true, taskId, status: 'sent', result: { eventId: created.eventId, title: draft.title } };
  }

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

export async function disconnectConnection(db, uid, provider = 'gmail', now = Date.now()) {
  const p = PROVIDERS[provider] ? provider : 'gmail';
  const id = connId(uid, p);
  const conn = await getDoc(db, 'agentConnections', id);
  if (conn) {
    await db.collection('agentConnections').doc(id).set({
      refreshTokenEnc: '', accessTokenEnc: '', email: '', updatedAt: now, disconnectedAt: now,
    }, { merge: true });
  }
  return { ok: true };
}
export const disconnectGmail = (db, uid, now) => disconnectConnection(db, uid, 'gmail', now);
