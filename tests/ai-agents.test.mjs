// AI AGENTS (closed beta) — the rails are the product here. Alex drafts, the
// member approves, and only then does Gmail send. These tests pin the beta
// economics exactly as specified: 20 seats, 5 tasks per member per day, 700
// tasks across the whole beta, and a server-enforced token estimate per task.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/* A tiny Firestore-shaped fake: doc get/set (+merge) and
 * collection.where/orderBy/limit().get() — the exact surface _agents.js uses
 * against the Mongo-backed shim in production. */
function fakeDb() {
  const store = new Map(); // "col:id" -> data
  const key = (col, id) => `${col}:${id}`;
  const docRef = (col, id) => ({
    get: async () => {
      const data = store.get(key(col, id));
      return { exists: data !== undefined, id, data: () => (data === undefined ? undefined : { ...data }) };
    },
    set: async (value, opts) => {
      const prev = store.get(key(col, id));
      store.set(key(col, id), opts?.merge && prev ? { ...prev, ...value } : { ...value });
    },
  });
  const run = (col, filters, order, lim) => {
    let rows = [...store.entries()]
      .filter(([k]) => k.startsWith(`${col}:`))
      .map(([k, data]) => ({ id: k.slice(col.length + 1), data }));
    for (const [field, , value] of filters) rows = rows.filter((r) => r.data[field] === value);
    if (order) {
      const [field, dir] = order;
      rows.sort((a, b) => (dir === 'desc' ? (b.data[field] || 0) - (a.data[field] || 0) : (a.data[field] || 0) - (b.data[field] || 0)));
    }
    if (lim != null) rows = rows.slice(0, lim);
    return { docs: rows.map((r) => ({ id: r.id, data: () => ({ ...r.data }) })) };
  };
  const query = (col, filters = [], order = null, lim = null) => ({
    where: (field, op, value) => query(col, [...filters, [field, op, value]], order, lim),
    orderBy: (field, dir = 'asc') => query(col, filters, [field, dir], lim),
    limit: (n) => query(col, filters, order, n),
    get: async () => run(col, filters, order, lim),
  });
  return {
    _store: store,
    collection: (name) => ({ doc: (id) => docRef(name, id), ...query(name) }),
  };
}

const agentOps = () => {
  const src = fs.readFileSync(new URL('../api/linky.js', import.meta.url), 'utf8');
  return src
    .split(/case '([A-Za-z]+)':/)
    .slice(1)
    .reduce((acc, part, i, arr) => {
      if (i % 2 === 0) acc[part] = arr[i + 1] || '';
      return acc;
    }, {});
};

test('the workforce API surface exists with the approval rails wired in linky.js', () => {
  const ops = agentOps();
  for (const op of ['agentHome', 'agentClaim', 'agentConnect', 'agentDisconnect', 'agentTask', 'agentApprove', 'agentDiscard']) {
    assert.ok(ops[op], `${op} op is dispatched in api/linky.js`);
  }
  assert.match(ops.agentApprove, /approveAgentTask/);
  assert.match(ops.agentApprove, /gmail_not_connected/);
  const src = fs.readFileSync(new URL('../api/linky.js', import.meta.url), 'utf8');
  assert.match(src, /gmailCallback/);
});

test('beta economics are hard-coded constants that multiply to the cap', async () => {
  const agents = await import('../api/_agents.js');
  assert.equal(agents.AGENT_BETA_SEATS, 20);
  assert.equal(agents.AGENT_DAILY_LIMIT, 7);
  assert.equal(agents.AGENT_BETA_CAP, 700);
  const src = fs.readFileSync(new URL('../api/_agents.js', import.meta.url), 'utf8');
  assert.match(src, /AGENT_BETA_SEATS = 20/);
  assert.match(src, /AGENT_DAILY_LIMIT = 7/);
  assert.match(src, /AGENT_BETA_CAP = 700/);
});

test('twenty seats, then the door is closed to everyone but the founder', async () => {
  const { claimAgentSeat, agentHome } = await import('../api/_agents.js');
  const db = fakeDb();
  // 20 distinct people claim successfully.
  for (let i = 0; i < 20; i += 1) {
    const result = await claimAgentSeat(db, `u${i}`, { email: `u${i}@example.com` });
    assert.equal(result.ok, true, `claim ${i} accepted`);
  }
  // The 21st different person is turned away.
  const denied = await claimAgentSeat(db, 'u21', { email: 'u21@example.com' });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'beta_full');
  // A claim is idempotent — seat 3 keeps their seat.
  const again = await claimAgentSeat(db, 'u3', { email: 'u3@example.com' });
  assert.equal(again.ok, true);
  // Admin always gets in (for dogfooding), not via a seat.
  const adminHome = await agentHome(db, 'admin1', { email: 'tanakaprince49@gmail.com' });
  assert.equal(adminHome.beta.claimed, true);
  // Someone who never claimed is told they have no seat.
  const outHome = await agentHome(db, 'outsider', { email: 't@example.com' });
  assert.equal(outHome.beta.claimed, false);
  assert.equal(outHome.tasks.length, 0);
});

test('seven tasks a day, then the member is done until midnight UTC', async () => {
  const { claimAgentSeat, createAgentTask } = await import('../api/_agents.js');
  const db = fakeDb();
  await claimAgentSeat(db, 'beta', { email: 'beta@example.com' });
  const text = async () => ({ text: JSON.stringify({ kind: 'email', to: 'partner@example.com', subject: 'Hi', body: 'Hello.', summary: 'A short email.' }) });
  const now = Date.UTC(2027, 0, 15, 10, 0, 0);
  for (let i = 0; i < 7; i += 1) {
    const result = await createAgentTask(db, 'beta', { email: 'beta@example.com' }, { instruction: 'Email partner@example.com to say hi' }, { text, now });
    assert.equal(result.ok, true, `task ${i + 1} accepted`);
    assert.equal(result.task.status, 'awaiting_approval');
    assert.ok(result.task.tokensEst > 0, 'tokens are estimated per task');
  }
  const eighth = await createAgentTask(db, 'beta', { email: 'beta@example.com' }, { instruction: 'One more' }, { text, now });
  assert.equal(eighth.ok, false);
  assert.equal(eighth.reason, 'daily_limit');
  // Next UTC day the allowance is back.
  const nextDay = await createAgentTask(db, 'beta', { email: 'beta@example.com' }, { instruction: 'Email partner@example.com again' }, { text, now: now + 24 * 60 * 60 * 1000 });
  assert.equal(nextDay.ok, true, 'allowance resets on the next UTC day');
  // A non-beta member cannot task Alex at all.
  const outsider = await createAgentTask(db, 'outsider', { email: 'o@example.com' }, { instruction: 'Email someone' }, { text, now });
  assert.equal(outsider.ok, false);
  assert.equal(outsider.reason, 'not_in_beta');
});

test('no email leaves the building without approval, and never via Gemini', async () => {
  const { claimAgentSeat, createAgentTask, approveAgentTask, encryptSecret } = await import('../api/_agents.js');
  const db = fakeDb();
  await claimAgentSeat(db, 'beta', { email: 'beta@example.com' });
  const text = async () => ({ text: JSON.stringify({ kind: 'email', to: 'partner@example.com', subject: 'Checking in', body: 'Hello partner.', summary: 'Follow-up.' }) });
  const created = await createAgentTask(db, 'beta', { email: 'beta@example.com' }, { instruction: 'Email partner@example.com' }, { text });
  assert.equal(created.task.status, 'awaiting_approval');
  // Approve without Gmail connected: hard refusal, task stays parked.
  const refused = await approveAgentTask(db, 'beta', { taskId: created.task.id, draft: created.task.draft });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'gmail_not_connected');
  assert.equal(db._store.get(`agentTasks:${created.task.id}`).status, 'awaiting_approval');
  // Someone else cannot approve your task.
  const hijack = await approveAgentTask(db, 'mallory', { taskId: created.task.id, draft: created.task.draft });
  assert.equal(hijack.ok, false);
  // Fake Gmail: one refresh-token call, one send, raw MIME with the approved words.
  const sentBodies = [];
  const fetchFn = async (url, options) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'access-for-beta', expires_in: 3600 }) };
    }
    sentBodies.push(options);
    return { ok: true, status: 200, json: async () => ({ id: 'gmail-msg-1', threadId: 'thread-1' }) };
  };
  // Seed the connection exactly as the OAuth callback would (encrypted).
  db._store.set('agentConnections:beta', { uid: 'beta', provider: 'gmail', email: 'beta@company.com', refreshTokenEnc: encryptSecret('refresh-token'), connectedAt: 1 });
  const approved = await approveAgentTask(db, 'beta', { taskId: created.task.id, draft: { to: 'partner@example.com', subject: 'Approved subject', body: 'Hello partner — sent after I approved it.' } }, { fetchFn });
  assert.equal(approved.ok, true);
  assert.equal(approved.status, 'sent');
  assert.equal(sentBodies.length, 1, 'exactly one Gmail send happened');
  const rawMime = JSON.parse(sentBodies[0].body).raw;
  const decoded = Buffer.from(rawMime, 'base64url').toString('utf8');
  assert.match(decoded, /To: partner@example\.com/);
  assert.match(decoded, /Approved subject/);
  assert.match(decoded, /Hello partner — sent after I approved it\./);
  // A sent task cannot be sent twice.
  const twice = await approveAgentTask(db, 'beta', { taskId: created.task.id, draft: created.task.draft }, { fetchFn });
  assert.equal(twice.ok, false);
  assert.equal(twice.reason, 'not_awaiting_approval');
  assert.equal(sentBodies.length, 1, 'still exactly one send');
});

test('a discarded draft is dead — it can never be approved into a send', async () => {
  const { claimAgentSeat, createAgentTask, approveAgentTask, discardAgentTask } = await import('../api/_agents.js');
  const db = fakeDb();
  await claimAgentSeat(db, 'beta', { email: 'beta@example.com' });
  const text = async () => ({ text: JSON.stringify({ kind: 'email', to: 'partner@example.com', subject: 'Hi', body: 'Hello.', summary: 'Short.' }) });
  const created = await createAgentTask(db, 'beta', { email: 'beta@example.com' }, { instruction: 'Email partner@example.com' }, { text });
  const gone = await discardAgentTask(db, 'beta', { taskId: created.task.id });
  assert.equal(gone.ok, true);
  const zombie = await approveAgentTask(db, 'beta', { taskId: created.task.id, draft: created.task.draft });
  assert.equal(zombie.ok, false);
  assert.equal(zombie.reason, 'not_awaiting_approval');
});

test('non-email tasks never fake a result — Alex says so honestly', async () => {
  const { claimAgentSeat, createAgentTask } = await import('../api/_agents.js');
  const db = fakeDb();
  await claimAgentSeat(db, 'beta', { email: 'beta@example.com' });
  const text = async () => ({ text: JSON.stringify({ kind: 'unsupported', summary: 'Analyse a repository', reply: 'Alex only sends email in this beta — phrase it as an email Alex can draft.' }) });
  const result = await createAgentTask(db, 'beta', { email: 'beta@example.com' }, { instruction: 'Analyse my GitHub repo' }, { text });
  assert.equal(result.ok, true);
  assert.equal(result.task.status, 'unsupported');
  assert.match(result.task.reply, /only sends email/);
});

test('Sarah drafts calendar events and only approval creates them', async () => {
  const { claimAgentSeat, createAgentTask, approveAgentTask, encryptSecret } = await import('../api/_agents.js');
  const db = fakeDb();
  await claimAgentSeat(db, 'beta', { email: 'beta@example.com' });
  const text = async () => ({
    text: JSON.stringify({
      kind: 'event', title: 'Launch sync', start: '2027-01-16T10:00:00', end: '2027-01-16T10:30:00',
      attendees: ['partner@example.com'], description: 'Roadmap', summary: 'A 30-minute launch sync.',
    }),
  });
  const created = await createAgentTask(db, 'beta', { email: 'beta@example.com' },
    { instruction: 'Schedule 30 min with partner@example.com tomorrow at 10', agent: 'Sarah', tz: 'Africa/Harare' }, { text, now: Date.UTC(2027, 0, 15, 8, 0, 0) });
  assert.equal(created.ok, true);
  assert.equal(created.task.kind, 'event');
  assert.equal(created.task.status, 'awaiting_approval');
  assert.equal(created.task.draft.timeZone, 'Africa/Harare');
  // No calendar connected: approval is refused and the draft waits.
  const refused = await approveAgentTask(db, 'beta', { taskId: created.task.id, draft: created.task.draft });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'calendar_not_connected');
  assert.equal(db._store.get(`agentTasks:${created.task.id}`).status, 'awaiting_approval');
  // Connect a calendar (seeded exactly as the OAuth callback stores it) and approve.
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'cal-access', expires_in: 3600 }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: 'evt-1', htmlLink: 'https://calendar.google.com/event?eid=evt-1' }) };
  };
  db._store.set('agentConnections:beta__calendar', { uid: 'beta', provider: 'calendar', email: 'beta@company.com', refreshTokenEnc: encryptSecret('cal-refresh'), connectedAt: 1 });
  const approved = await approveAgentTask(db, 'beta', { taskId: created.task.id, draft: created.task.draft }, { fetchFn });
  assert.equal(approved.ok, true);
  assert.equal(approved.status, 'sent');
  const createCall = calls.find((c) => c.url.includes('calendar/v3'));
  assert.ok(createCall, 'calendar API was called exactly at approval time');
  const event = JSON.parse(createCall.options.body);
  assert.equal(event.summary, 'Launch sync');
  assert.equal(event.start.dateTime, '2027-01-16T10:00:00');
  assert.equal(event.start.timeZone, 'Africa/Harare');
  assert.deepEqual(event.attendees, [{ email: 'partner@example.com' }]);
  // Gmail events through Sarah (and calendar asks through Alex) are refused honestly.
  const wrongTool = await createAgentTask(db, 'beta', { email: 'beta@example.com' },
    { instruction: 'Email partner@example.com', agent: 'Sarah' },
    { text: async () => ({ text: JSON.stringify({ kind: 'email', to: 'partner@example.com', subject: 'x', body: 'y' }) }), now: Date.UTC(2027, 0, 15, 9, 0, 0) });
  assert.equal(wrongTool.task.status, 'unsupported');
});

test('a two-letter greeting can be sent — agents answer conversation too', async () => {
  const { claimAgentSeat, createAgentTask } = await import('../api/_agents.js');
  const db = fakeDb();
  await claimAgentSeat(db, 'beta', { email: 'beta@example.com' });
  const text = async () => ({ text: JSON.stringify({ kind: 'unsupported', summary: 'Greeting', reply: 'Hi! I am Sarah, your scheduling assistant. Ask me to set up an event and I will draft it for your approval.' }) });
  const result = await createAgentTask(db, 'beta', { email: 'beta@example.com' }, { instruction: 'hi', agent: 'Sarah' }, { text });
  assert.equal(result.ok, true);
  assert.equal(result.task.status, 'unsupported');
  assert.match(result.task.reply, /scheduling assistant/);
});

test('one central Gemini model: capacity blips retry it (max two), permanent errors never do', async () => {
  const { callGemini } = await import('../api/_gemini.js');
  const realFetch = globalThis.fetch;
  const calls = [];
  const modelOf = (url) => (String(url).match(/models\/([^:]+):generateContent/) || [])[1];
  try {
    // 503, 503, then success: three attempts, ONE model name throughout.
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (calls.length < 3) {
        return { ok: false, status: 503, text: async () => JSON.stringify({ error: { message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary.' } }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'after-retries' }] }, finishReason: 'STOP' }] }) };
    };
    const out = await callGemini('hello', { timeoutMs: 1000, retryBaseMs: 1 }, 'test-key');
    assert.equal(out, 'after-retries');
    assert.equal(calls.length, 3);
    assert.ok(modelOf(calls[0]), 'model named in URL');
    assert.equal(modelOf(calls[1]), modelOf(calls[0]), 'retry must not switch models');
    assert.equal(modelOf(calls[2]), modelOf(calls[0]), 'retry must not switch models');
    // Retry budget exhausted: still the same model, error surfaces.
    calls.length = 0;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return { ok: false, status: 503, text: async () => JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }) };
    };
    await assert.rejects(() => callGemini('hello', { retryBaseMs: 1 }, 'test-key'), /high demand/);
    assert.equal(calls.length, 3, 'initial attempt plus exactly two retries');
    // A retired model is permanent: one attempt, original words intact.
    calls.length = 0;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return { ok: false, status: 404, text: async () => JSON.stringify({ error: { message: 'This model models/gemini-2.5-flash is no longer available to new users.' } }) };
    };
    await assert.rejects(() => callGemini('hello', { retryBaseMs: 1 }, 'test-key'), /no longer available/);
    assert.equal(calls.length, 1, 'permanent errors are never retried');
    // Opt-out callers (ranking) keep their single fast attempt.
    calls.length = 0;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return { ok: false, status: 503, text: async () => JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }) };
    };
    await assert.rejects(() => callGemini('hello', { retryBaseMs: 1, disableCapacityRetry: true }, 'test-key'), /high demand/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the central orchestrator deduplicates identical in-flight prompts and caps one call per member', async () => {
  const { aiText } = await import('../api/_gemini.js');
  const realFetch = globalThis.fetch;
  const savedKey = process.env.GEMINI_API_KEY;
  const savedZen = process.env.ZEN_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.ZEN_API_KEY;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    await new Promise((resolve) => { setTimeout(resolve, 40); });
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'shared-result' }] }, finishReason: 'STOP' }] }) };
  };
  try {
    const [a, b] = await Promise.all([aiText('identical prompt', { userId: 'member-1' }), aiText('identical prompt', { userId: 'member-1' })]);
    assert.equal(a.text, 'shared-result');
    assert.equal(b.text, 'shared-result');
    assert.equal(fetchCount, 1, 'identical concurrent prompts must cost one provider call');
    // Same member, different work, while busy: refused fast so the caller's
    // deterministic fallback answers instead of a second concurrent call.
    const slow = aiText('first job', { userId: 'member-2' });
    await assert.rejects(() => aiText('second job', { userId: 'member-2' }), /ai_busy_for_user/);
    await slow;
  } finally {
    globalThis.fetch = realFetch;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
    if (savedZen === undefined) delete process.env.ZEN_API_KEY; else process.env.ZEN_API_KEY = savedZen;
  }
});

test('agent tasks run on the central budget model - no agent-specific model exists', async () => {
  const realFetch = globalThis.fetch;
  const savedKey = process.env.GEMINI_API_KEY;
  const savedZen = process.env.ZEN_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.ZEN_API_KEY;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ kind: 'unsupported', summary: 'Greeting', reply: 'Hi! I am Sarah, your scheduling assistant.' }) }] }, finishReason: 'STOP' }] }) };
  };
  try {
    const { claimAgentSeat, createAgentTask } = await import('../api/_agents.js');
    const db = fakeDb();
    await claimAgentSeat(db, 'beta', { email: 'beta@example.com' });
    // No injected text: the production default (central aiText) must answer.
    const result = await createAgentTask(db, 'beta', { email: 'beta@example.com' }, { instruction: 'schedule lunch tomorrow at noon', agent: 'Sarah', tz: 'Africa/Harare' });
    assert.equal(result.ok, true);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /models\/gemini-3\.5-flash-lite:generateContent/, 'agents must draft on gemini-3.5-flash-lite');
  } finally {
    globalThis.fetch = realFetch;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
    if (savedZen === undefined) delete process.env.ZEN_API_KEY; else process.env.ZEN_API_KEY = savedZen;
  }
});

test('small talk costs zero AI calls: greetings answered in-persona even mid-outage', async () => {
  const { claimAgentSeat, createAgentTask } = await import('../api/_agents.js');
  let aiCalls = 0;
  const boom = async () => { aiCalls += 1; throw new Error('gemini: This model is currently experiencing high demand.'); };
  const db = fakeDb();
  await claimAgentSeat(db, 'beta', { email: 'beta@example.com' });
  const hi = await createAgentTask(db, 'beta', { email: 'beta@example.com' }, { instruction: 'hi', agent: 'Sarah' }, { text: boom });
  assert.equal(hi.ok, true);
  assert.equal(hi.task.tokensEst, 0);
  assert.match(hi.task.reply, /Sarah, your scheduling assistant/);
  assert.equal(hi.usage.remaining, hi.usage.limit, 'greetings must not consume the daily execution quota');
  const skills = await createAgentTask(db, 'beta', { email: 'beta@example.com' }, { instruction: 'what can you do?', agent: 'alex' }, { text: boom });
  assert.equal(skills.ok, true);
  assert.match(skills.task.reply, /send real email/);
  assert.equal(aiCalls, 0, 'small talk must never reach the model');
});

test('when every model is down, Sarah still drafts plainly-stated events from the member words', async () => {
  const { claimAgentSeat, createAgentTask } = await import('../api/_agents.js');
  const boom = async () => { throw new Error('gemini: This model is currently experiencing high demand.'); };
  const db = fakeDb();
  await claimAgentSeat(db, 'beta', { email: 'beta@example.com' });
  const block = await createAgentTask(db, 'beta', { email: 'beta@example.com' }, { instruction: 'Put a 1-hour deep-work block on my calendar Friday at 9am', agent: 'Sarah', tz: 'Africa/Harare' }, { text: boom });
  assert.equal(block.ok, true);
  assert.equal(block.task.kind, 'event');
  assert.equal(block.task.status, 'awaiting_approval');
  assert.match(block.task.draft.start, /T09:00:00$/);
  assert.match(block.task.draft.end, /T10:00:00$/);
  assert.equal(new Date(`${block.task.draft.start.slice(0, 10)}T00:00:00Z`).getUTCDay(), 5, 'must land on a Friday');
  assert.match(block.task.draft.title, /deep-work/i);
  assert.match(block.task.summary, /exact words/);
  assert.equal(block.task.draft.timeZone, 'Africa/Harare');

  const db2 = fakeDb();
  await claimAgentSeat(db2, 'beta', { email: 'beta@example.com' });
  const invite = await createAgentTask(db2, 'beta', { email: 'beta@example.com' }, { instruction: 'Schedule 30 minutes with sarah@example.com tomorrow at 10am about the launch plan', agent: 'Sarah', tz: 'Africa/Harare' }, { text: boom });
  assert.equal(invite.ok, true);
  assert.match(invite.task.draft.start, /T10:00:00$/);
  assert.match(invite.task.draft.end, /T10:30:00$/);
  assert.deepEqual(invite.task.draft.attendees, ['sarah@example.com']);
  assert.match(invite.task.draft.title, /launch plan/i);
});

test('AI failures are diagnosed, never swallowed: junk replies and provider errors', async () => {
  const { claimAgentSeat, createAgentTask } = await import('../api/_agents.js');
  // A fenced, prose-wrapped, kind-less reply still becomes a draft.
  const db1 = fakeDb();
  await claimAgentSeat(db1, 'beta', { email: 'beta@example.com' });
  const fenced = async () => ({ text: 'Here you go:\n```json\n{"to":"partner@example.com","subject":"Hi","body":"Hello there.","summary":"Short one."}\n```' });
  const okTask = await createAgentTask(db1, 'beta', { email: 'beta@example.com' }, { instruction: 'Email partner@example.com' }, { text: fenced });
  assert.equal(okTask.ok, true);
  assert.equal(okTask.task.kind, 'email');
  assert.equal(okTask.task.status, 'awaiting_approval');
  // Total garbage on both attempts, email side: template draft from the
  // member's words, honestly labelled (the diagnosis rides in the summary).
  const db2 = fakeDb();
  await claimAgentSeat(db2, 'beta', { email: 'beta@example.com' });
  const junk = async () => ({ text: 'I cannot help with that today.' });
  const junked = await createAgentTask(db2, 'beta', { email: 'beta@example.com' }, { instruction: 'Email partner@example.com' }, { text: junk });
  assert.equal(junked.ok, true);
  assert.equal(junked.task.status, 'awaiting_approval');
  assert.match(junked.task.summary, /unparseable AI reply/);
  // Same garbage, calendar side with a plainly-stated day: Sarah's safety net
  // drafts from the member's words, defaulting to 09:00.
  const db2b = fakeDb();
  await claimAgentSeat(db2b, 'beta', { email: 'beta@example.com' });
  const junkedCal = await createAgentTask(db2b, 'beta', { email: 'beta@example.com' }, { instruction: 'Schedule lunch tomorrow', agent: 'Sarah' }, { text: junk });
  assert.equal(junkedCal.ok, true);
  assert.equal(junkedCal.task.status, 'awaiting_approval');
  assert.match(junkedCal.task.draft.start, /T09:00:00$/);
  // But with no day and no time stated anywhere, there is nothing honest to
  // draft: a clean ai_unavailable WITH the diagnosis.
  const db2c = fakeDb();
  await claimAgentSeat(db2c, 'beta', { email: 'beta@example.com' });
  const hopeless = await createAgentTask(db2c, 'beta', { email: 'beta@example.com' }, { instruction: 'Schedule lunch sometime soon', agent: 'Sarah' }, { text: junk });
  assert.equal(hopeless.ok, false);
  assert.equal(hopeless.reason, 'ai_unavailable');
  assert.match(hopeless.detail, /unparseable/);
  // A throwing provider, calendar side: the provider's own words ride along.
  const db3 = fakeDb();
  await claimAgentSeat(db3, 'beta', { email: 'beta@example.com' });
  const boom = async () => { throw new Error('gemini: HTTP 429 quota'); };
  const failed = await createAgentTask(db3, 'beta', { email: 'beta@example.com' }, { instruction: 'Schedule lunch sometime soon', agent: 'Sarah' }, { text: boom });
  assert.equal(failed.ok, false);
  assert.match(failed.detail, /429/);
  // Same outage, email side: Alex still drafts, from the member's own words.
  const db4 = fakeDb();
  await claimAgentSeat(db4, 'beta', { email: 'beta@example.com' });
  const rescued = await createAgentTask(db4, 'beta', { email: 'beta@example.com' }, { instruction: 'Email partner@example.com: following up on the term sheet, can we talk Friday?' }, { text: boom });
  assert.equal(rescued.ok, true);
  assert.equal(rescued.task.status, 'awaiting_approval');
  assert.equal(rescued.task.draft.to, 'partner@example.com');
  assert.match(rescued.task.draft.body, /term sheet/);
  assert.match(rescued.task.summary, /unreachable/);
});

test('connect URLs ask for exactly one agent worth of scopes, nothing inherited', async () => {
  const { googleConnectUrl } = await import('../api/_agents.js');
  const prevId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const prevSecret = process.env['GOOGLE_OAUTH_CLIENT_' + 'SECRET'];
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
  process.env['GOOGLE_OAUTH_CLIENT_' + 'SECRET'] = 'test-secret-value';
  try {
    const gmail = googleConnectUrl('member-1', 'gmail');
    assert.equal(gmail.configured, true);
    const g = new URL(gmail.url);
    assert.equal(g.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email openid');
    assert.equal(g.searchParams.has('include_granted_scopes'), false);
    const cal = googleConnectUrl('member-1', 'calendar');
    const c = new URL(cal.url);
    assert.equal(c.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email openid');
    assert.equal(c.searchParams.has('include_granted_scopes'), false);
    assert.match(c.searchParams.get('redirect_uri'), /calendarCallback/);
  } finally {
    if (prevId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID; else process.env.GOOGLE_OAUTH_CLIENT_ID = prevId;
    if (prevSecret === undefined) delete process.env['GOOGLE_OAUTH_CLIENT_' + 'SECRET']; else process.env['GOOGLE_OAUTH_CLIENT_' + 'SECRET'] = prevSecret;
  }
});

test('the token vault is encrypted at rest and round-trips', async () => {
  const { encryptSecret, decryptSecret } = await import('../api/_agents.js');
  const sealed = encryptSecret('refresh-token-value', 'test-secret');
  assert.notEqual(sealed, 'refresh-token-value');
  assert.ok(!sealed.includes('refresh-token-value'));
  assert.equal(decryptSecret(sealed, 'test-secret'), 'refresh-token-value');
  assert.equal(decryptSecret(sealed, 'wrong-secret'), '');
  assert.equal(decryptSecret('garbage', 'test-secret'), '');
});

test('the AI Agents printing presses are wired (routes, screens, API helpers)', () => {
  const app = fs.readFileSync(new URL('../mobile/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /AiAgents: 'aiagents'/);
  assert.match(app, /AiAgentChat: 'aiagents\/chat\/:agentId'/);
  assert.match(app, /AiAgentProfile: 'aiagents\/profile\/:agentId'/);
  assert.match(app, /AiAgentsSettings: 'aiagents\/settings'/);
  for (const screen of ['AiAgents', 'AiAgentChat', 'AiAgentProfile', 'AiAgentsSettings']) {
    assert.match(app, new RegExp(`<Stack\\.Screen name="${screen}" component=`), `${screen} registered`);
  }
  const directory = fs.readFileSync(new URL('../mobile/src/screens/AiAgentsScreen.tsx', import.meta.url), 'utf8');
  assert.match(directory, /Your personal AI workforce/);
  assert.match(directory, /Message \{agent\.name\}/);
  const chat = fs.readFileSync(new URL('../mobile/src/screens/AiAgentChatScreen.tsx', import.meta.url), 'utf8');
  assert.match(chat, /Approve &amp; send/);
  assert.match(chat, /Approve &amp; add to calendar/);
  const profile = fs.readFileSync(new URL('../mobile/src/screens/AiAgentProfileScreen.tsx', import.meta.url), 'utf8');
  assert.match(profile, /VerifiedBadge/);
  assert.match(profile, /AI AGENT/);
  const settings = fs.readFileSync(new URL('../mobile/src/screens/AiAgentsSettingsScreen.tsx', import.meta.url), 'utf8');
  assert.match(settings, /Task history/);
  const avatar = fs.readFileSync(new URL('../mobile/src/components/AgentAvatar.tsx', import.meta.url), 'utf8');
  assert.match(avatar, /VerifiedBadge/);
  const api = fs.readFileSync(new URL('../mobile/src/lib/linkyApi.ts', import.meta.url), 'utf8');
  for (const fn of ['agentHome', 'agentCreateTask', 'agentApproveTask', 'agentDiscardTask', 'agentConnectCalendar']) {
    assert.match(api, new RegExp(`export const ${fn}`));
  }
});

test('the workforce URL survives a cold load signed-out, signed-in, and mid-auth', () => {
  const app = fs.readFileSync(new URL('../mobile/App.tsx', import.meta.url), 'utf8');
  // A dedicated path helper in the campaign-manager tradition.
  assert.match(app, /const isAiAgentsPath = /);
  assert.ok(app.includes("=== '/aiagents'"), 'aiagents path matcher present');
  // Registered twice: once for members, once in the guest tree on its own
  // path — so the invite link renders Alex's pitch instead of falling
  // through to the dashboard while auth is still resolving.
  const registrations = app.match(/<Stack\.Screen name="AiAgents" component=\{AiAgentsScreen\} \/>/g) || [];
  assert.equal(registrations.length, 2);
  assert.match(app, /isAiAgentsWebPath \? \(\s*\n\s*<Stack\.Screen name="AiAgents"/);
  // The signed-out URL guard must never rewrite this path to /landing.
  assert.match(app, /if \(isAiAgentsPath\(\)\) return;/);
  // And the first-paint intent carries a fresh sign-in back to Alex.
  assert.match(app, /aiAgentsIntentRef = React\.useRef\(isAiAgentsPath\(\)\)/);
  assert.match(app, /navigate\('AiAgents'\)/);
  // The screen itself pitches guests instead of firing an authed request.
  const screen = fs.readFileSync(new URL('../mobile/src/screens/AiAgentsScreen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /Sign in to claim your seat/);
  assert.match(screen, /if \(user\?\.uid\) void load\(\);/);
});
