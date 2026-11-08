// Referral links: /r/:code click counting + attribution, and the admin-only
// ref-admin API. Runs the real handler against a fake Firestore-shaped db.
// DATA_BACKEND=mongo is set before import so fieldIncrement/serverTimestamp
// take the adapter path (no firebase-admin credentials needed in tests).
process.env.DATA_BACKEND = 'mongo';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createPublicSeoHandler } = await import('../api/publicSeo.js');
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('client /r/:code handoff URL is origin-absolute and stays under /app/api', () => {
  // Regression: building the handoff from the current path dropped the /app
  // prefix when the app was served from /r/<code>, sending visitors to a
  // bare /api URL that serves the app shell and its "Wrong match" 404.
  const src = fs.readFileSync(new URL('../mobile/src/lib/referral.ts', import.meta.url), 'utf8');
  const match = src.match(/export function referralHandoffUrl[\s\S]*?\n}/);
  assert.ok(match, 'referralHandoffUrl helper exists');
  const ts = require('../mobile/node_modules/typescript/lib/typescript.js');
  const js = ts.transpileModule(match[0].replace('export function', 'function'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const referralHandoffUrl = new Function(`${js}; return referralHandoffUrl;`)();
  assert.equal(
    referralHandoffUrl('maya-k', 'https://www.linkupbuild.com'),
    'https://www.linkupbuild.com/app/api/publicSeo?mode=ref&code=maya-k',
  );
  assert.match(src, /window\.location\.replace\(referralHandoffUrl\(linkMatch\[1\], window\.location\.origin\)\)/);
});

const translate = (current, patch) => {
  const next = { ...(current || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && value.__fvKind === 'increment') next[key] = (Number(next[key]) || 0) + value.operand;
    else if (value && value.__fvKind === 'serverTimestamp') next[key] = Date.now();
    else if (value && value.__fvKind === 'delete') delete next[key];
    else next[key] = value;
  }
  return next;
};

function makeDb({ users = {}, links = {} } = {}) {
  const store = {
    users: new Map(Object.entries(users).map(([id, d]) => [id, { ...d }])),
    referralLinks: new Map(Object.entries(links).map(([id, d]) => [id, { ...d }])),
  };
  const docRef = (collection, id) => ({
    id,
    async get() {
      const data = store[collection].get(id);
      return { id, exists: !!data, data: () => (data ? { ...data } : undefined) };
    },
    async set(data) { store[collection].set(id, translate(null, data)); },
    async update(patch) {
      if (!store[collection].has(id)) throw new Error('not found');
      store[collection].set(id, translate(store[collection].get(id), patch));
    },
    async delete() { store[collection].delete(id); },
  });
  const collection = (name) => ({
    doc: (id) => docRef(name, id),
    async get() {
      return { docs: [...store[name].entries()].map(([id, d]) => ({ id, data: () => ({ ...d }) })) };
    },
    where(field, op, value) {
      const matches = () => [...store[name].entries()].filter(([, d]) => d[field] === value);
      return {
        count: () => ({ get: async () => ({ data: () => ({ count: matches().length }) }) }),
        get: async () => ({ docs: matches().map(([id, d]) => ({ id, data: () => ({ ...d }) })) }),
      };
    },
  });
  return { db: { collection }, store };
}

const response = () => ({
  headers: {}, code: 0, body: '',
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  status(c) { this.code = c; return this; },
  send(body) { this.body = body; return this; },
});

const TOKENS = {
  'admin-token': { uid: 'admin1', email: 'manager@example.com' },
  'founder-token': { uid: 'founder1', email: 'tanakaprince49@gmail.com' },
  'user-token': { uid: 'plain1', email: 'plain@example.com' },
};
const verifyUser = async (req) => {
  const token = String(req.headers?.authorization || '').replace('Bearer ', '');
  return TOKENS[token] || null;
};
const handlerFor = (db) => createPublicSeoHandler(() => db, null, null, Date.now, verifyUser);
const adminReq = (body, token = 'admin-token') => ({
  method: 'POST', query: { mode: 'ref-admin' }, headers: { authorization: `Bearer ${token}` }, body,
});

test('referral redirect counts the click and lands in the app with the code', async () => {
  const { db, store } = makeDb({ links: { 'maya-k': { code: 'maya-k', label: 'Maya K', clicks: 2, active: true } } });
  const res = response();
  await handlerFor(db)({ method: 'GET', query: { mode: 'ref', code: 'maya-k' }, headers: {} }, res);
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, 'https://www.linkupbuild.com/app/?ref=maya-k');
  assert.equal(store.referralLinks.get('maya-k').clicks, 3);
  assert.ok(store.referralLinks.get('maya-k').lastClickAt);
});

test('referral redirect never dead-ends: unknown or paused codes land in the app unattributed', async () => {
  const { db, store } = makeDb({ links: { 'paused-1': { code: 'paused-1', label: 'Paused', clicks: 5, active: false } } });
  const handler = handlerFor(db);
  const unknown = response();
  await handler({ method: 'GET', query: { mode: 'ref', code: 'ghost-99' }, headers: {} }, unknown);
  assert.equal(unknown.code, 302);
  assert.equal(unknown.headers.location, 'https://www.linkupbuild.com/app/');
  const paused = response();
  await handler({ method: 'GET', query: { mode: 'ref', code: 'paused-1' }, headers: {} }, paused);
  assert.equal(paused.code, 302);
  assert.equal(paused.headers.location, 'https://www.linkupbuild.com/app/');
  assert.equal(store.referralLinks.get('paused-1').clicks, 5);
});

test('ref-admin requires an admin: anonymous 401, signed-in non-admin 403', async () => {
  const { db } = makeDb({ users: { admin1: { isAdmin: true }, plain1: { isAdmin: false } } });
  const handler = handlerFor(db);
  const anon = response();
  await handler(adminReq({ action: 'list' }, ''), anon);
  assert.equal(anon.code, 401);
  const plain = response();
  await handler(adminReq({ action: 'list' }, 'user-token'), plain);
  assert.equal(plain.code, 403);
  const admin = response();
  await handler(adminReq({ action: 'list' }, 'admin-token'), admin);
  assert.equal(admin.code, 200);
  const founder = response();
  await handler(adminReq({ action: 'list' }, 'founder-token'), founder);
  assert.equal(founder.code, 200, 'founder email allowlist works without an isAdmin doc');
});

test('ref-admin creates links (auto slug + custom code), rejects duplicates, counts signups', async () => {
  const { db } = makeDb({
    users: {
      admin1: { isAdmin: true },
      s1: { referralCode: 'maya-k' }, s2: { referralCode: 'maya-k' },
      s3: { referralCode: 'tendai-m' }, s4: {},
    },
  });
  const handler = handlerFor(db);
  const created = response();
  await handler(adminReq({ action: 'create', label: 'Maya K' }), created);
  assert.equal(created.code, 201);
  const link = JSON.parse(created.body).link;
  assert.equal(link.code, 'maya-k');
  assert.equal(link.url, 'https://www.linkupbuild.com/r/maya-k');
  assert.equal(link.clicks, 0);

  const custom = response();
  await handler(adminReq({ action: 'create', label: 'Tendai M', code: 'Tendai-M' }), custom);
  assert.equal(JSON.parse(custom.body).link.code, 'tendai-m');

  const dupe = response();
  await handler(adminReq({ action: 'create', label: 'Maya Again', code: 'maya-k' }), dupe);
  assert.equal(dupe.code, 409);

  const list = response();
  await handler(adminReq({ action: 'list' }), list);
  const links = JSON.parse(list.body).links;
  assert.equal(links.find((l) => l.code === 'maya-k').signups, 2);
  assert.equal(links.find((l) => l.code === 'tendai-m').signups, 1);
});

test('ref-admin rename, pause and delete manage the link lifecycle', async () => {
  const { db, store } = makeDb({
    users: { admin1: { isAdmin: true } },
    links: { 'maya-k': { code: 'maya-k', label: 'Maya K', clicks: 4, active: true } },
  });
  const handler = handlerFor(db);
  const renamed = response();
  await handler(adminReq({ action: 'rename', code: 'maya-k', label: 'Maya K (Nairobi)' }), renamed);
  assert.equal(JSON.parse(renamed.body).link.label, 'Maya K (Nairobi)');
  assert.equal(JSON.parse(renamed.body).link.clicks, 4);

  const paused = response();
  await handler(adminReq({ action: 'setActive', code: 'maya-k', active: false }), paused);
  assert.equal(JSON.parse(paused.body).link.active, false);

  const missing = response();
  await handler(adminReq({ action: 'rename', code: 'ghost-99', label: 'Ghost' }), missing);
  assert.equal(missing.code, 404);

  const deleted = response();
  await handler(adminReq({ action: 'delete', code: 'maya-k' }), deleted);
  assert.equal(deleted.code, 200);
  assert.equal(store.referralLinks.has('maya-k'), false);
});
