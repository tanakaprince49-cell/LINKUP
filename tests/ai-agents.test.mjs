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
  assert.equal(agents.AGENT_DAILY_LIMIT, 5);
  assert.equal(agents.AGENT_BETA_CAP, 700);
  // 20 seats x 5 tasks/day x 7 days = the whole beta budget. No coincidence.
  assert.equal(agents.AGENT_BETA_SEATS * agents.AGENT_DAILY_LIMIT * 7, agents.AGENT_BETA_CAP);
  const src = fs.readFileSync(new URL('../api/_agents.js', import.meta.url), 'utf8');
  assert.match(src, /AGENT_BETA_SEATS = 20/);
  assert.match(src, /AGENT_DAILY_LIMIT = 5/);
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

test('five tasks a day, then the member is done until midnight UTC', async () => {
  const { claimAgentSeat, createAgentTask } = await import('../api/_agents.js');
  const db = fakeDb();
  await claimAgentSeat(db, 'beta', { email: 'beta@example.com' });
  const text = async () => ({ text: JSON.stringify({ kind: 'email', to: 'partner@example.com', subject: 'Hi', body: 'Hello.', summary: 'A short email.' }) });
  const now = Date.UTC(2027, 0, 15, 10, 0, 0);
  for (let i = 0; i < 5; i += 1) {
    const result = await createAgentTask(db, 'beta', { email: 'beta@example.com' }, { instruction: 'Email partner@example.com to say hi' }, { text, now });
    assert.equal(result.ok, true, `task ${i + 1} accepted`);
    assert.equal(result.task.status, 'awaiting_approval');
    assert.ok(result.task.tokensEst > 0, 'tokens are estimated per task');
  }
  const sixth = await createAgentTask(db, 'beta', { email: 'beta@example.com' }, { instruction: 'One more' }, { text, now });
  assert.equal(sixth.ok, false);
  assert.equal(sixth.reason, 'daily_limit');
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

test('the token vault is encrypted at rest and round-trips', async () => {
  const { encryptSecret, decryptSecret } = await import('../api/_agents.js');
  const sealed = encryptSecret('refresh-token-value', 'test-secret');
  assert.notEqual(sealed, 'refresh-token-value');
  assert.ok(!sealed.includes('refresh-token-value'));
  assert.equal(decryptSecret(sealed, 'test-secret'), 'refresh-token-value');
  assert.equal(decryptSecret(sealed, 'wrong-secret'), '');
  assert.equal(decryptSecret('garbage', 'test-secret'), '');
});

test('the AI Agents printing presses are wired (route, screen, API helpers)', () => {
  const app = fs.readFileSync(new URL('../mobile/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /AiAgents: 'aiagents'/);
  assert.match(app, /<Stack\.Screen name="AiAgents" component=\{AiAgentsScreen\} \/>/);
  const screen = fs.readFileSync(new URL('../mobile/src/screens/AiAgentsScreen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /Alex · Personal Executive Assistant/);
  assert.match(screen, /Approve &amp; send/);
  assert.match(screen, /Your personal AI workforce/);
  assert.match(screen, /Sarah · Email &amp; Communications Assistant/);
  assert.match(screen, /Marcus · Developer &amp; GitHub Assistant/);
  const api = fs.readFileSync(new URL('../mobile/src/lib/linkyApi.ts', import.meta.url), 'utf8');
  for (const fn of ['agentHome', 'agentCreateTask', 'agentApproveTask', 'agentDiscardTask']) {
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
