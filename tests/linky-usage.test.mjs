import * as workbench from '../api/_linkyWorkbench.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';
import * as usage from '../api/_linkyUsage.js';
import * as quality from '../api/_linkyQuality.js';
import * as companion from '../api/_linkyCompanion.js';
import {publicEligible} from '../api/_publicSeo.js';
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const DELETE = '__DELETE_FIELD__';
class Database {
  rows = new Map(); queue = Promise.resolve(); failStateWrites = false; failLedger = false;
  snapshot(path) { return { exists: this.rows.has(path), data: () => structuredClone(this.rows.get(path)), get: (field) => this.rows.get(path)?.[field] }; }
  write(path, value, merge) {
    if (this.failStateWrites && path.startsWith('linkyState/')) throw Error('state unavailable');
    const next = merge ? { ...this.rows.get(path), ...value } : { ...value };
    for (const key of Object.keys(next)) if (next[key] === DELETE) delete next[key];
    this.rows.set(path, structuredClone(next));
  }
  collection(name) {
    const db = this;
    const q = { where: () => q, limit: () => q, orderBy: () => q, get: async () => ({ docs: [], size: 0 }), doc(id) {
      const path = `${name}/${id}`;
      return { path, get: async () => db.snapshot(path), set: async (value, options) => db.write(path, value, options?.merge), delete: async () => db.rows.delete(path) };
    } };
    return q;
  }
  runTransaction(work) {
    const result = this.queue.then(async () => {
      if (this.failLedger) throw Error('ledger unavailable');
      const writes = [];
      const value = await work({ get: async (ref) => this.snapshot(ref.path), set: (ref, data, options) => writes.push([ref.path, data, options?.merge]) });
      writes.forEach((args) => this.write(...args)); return value;
    });
    this.queue = result.catch(() => undefined); return result;
  }
  batch() {
    const db = this, writes = [];
    return { set: (ref, data, options) => writes.push(() => db.write(ref.path, data, options?.merge)), delete: (ref) => writes.push(() => db.rows.delete(ref.path)), commit: async () => writes.forEach((fn) => fn()) };
  }
}
function core(database) {
  const module = { exports: {} }; let aiCalls = 0;
  const mocks = {
    './_linkyWorkbench.js':workbench,'node:crypto': crypto, './_linkyUsage.js': usage, './_linkyQuality.js': quality, './_linkyCompanion.js': companion, './_publicSeo.js': {publicEligible},
    './_firebaseAdmin.js': { getDb: () => database, getAdmin: () => ({ firestore: { FieldValue: { delete: () => DELETE, serverTimestamp: () => Date.now() } } }) },
    './_gemini.js': { aiReady: () => false, geminiText: () => { aiCalls++; throw Error('unexpected AI call'); } },
    './_serpapi.js': {}, './_proof.js': {},
  };
  const code = ts.transpileModule(read('api/_linky.js'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => { assert.ok(name in mocks, name); return mocks[name]; }, console, process: { env: {} }, Date, Set, Map, URL, Buffer, setTimeout, clearTimeout });
  return { ...module.exports, aiCalls: () => aiCalls };
}
const october = Date.parse('2026-10-16T12:00:00Z');
const DAY = 86_400_000;
// Free members get 5 messages per UTC day, full stop: there is no monthly
// bucket anymore. Adding `days` moves to the next UTC day.
const dayAt = (day) => october + day * DAY;
async function spendFree(db, uid, count, { plus = false } = {}) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(await usage.reserveMessage(db, uid, { now: dayAt(Math.floor(i / 5)), plus }));
  return out;
}
const member = { uid: 'member', displayName: 'Member', occupation: 'Founder', skills: ['React'], onboarded: true };

test('free allowance is exactly 5 per UTC day, resetting at midnight UTC', () => {
  const quota = usage.messageQuota({}, { now: october });
  assert.equal(quota.limit, 5);
  assert.equal(quota.period, 'day');
  assert.equal(quota.periodKey, '2026-10-16');
  assert.equal(quota.dailyLimit, 5);
  assert.equal(usage.nextResetAt(false, Date.parse('2026-12-31T23:59:59Z')), '2027-01-01T00:00:00.000Z');
  assert.equal(usage.nextResetAt(false, Date.parse('2028-02-29T12:00:00Z')), '2028-03-01T00:00:00.000Z');
  assert.equal(usage.dayKey(Date.parse('2026-11-01T01:00:00+02:00')), '2026-10-31');
});

test('fifth reservation signals immediate paywall and sixth cannot spend or invoke an answer', async () => {
  const db = new Database(); let quota;
  const spent = await spendFree(db, 'member', 5);
  quota = spent.at(-1);
  assert.equal(quota.remaining, 0); assert.equal(quota.upgradeRequired, true);
  await assert.rejects(usage.reserveMessage(db, 'member', { now: october }), (e) => e.code === 'ask_limit' && e.messageQuota.used === 5 && /5 free Linky messages for today/.test(e.message));
  assert.equal(db.rows.get('linkyUsage/member').daily.count, 5);
});

test('simultaneous requests share a single transactional daily allowance', async () => {
  const db = new Database();
  // Thirty concurrent sends in one UTC day: exactly five succeed.
  const results = await Promise.allSettled(Array.from({ length: 30 }, () => usage.reserveMessage(db, 'member', { now: october })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 25);
  // The next UTC day starts fresh with its own five.
  for (let i = 0; i < 5; i++) await usage.reserveMessage(db, 'member', { now: dayAt(1) });
  assert.equal(db.rows.get('linkyUsage/member').daily.count, 5);
  assert.equal(db.rows.get('linkyUsage/member').daily.key, '2026-10-17');
});

test('midnight UTC replenishes free messages, with separate member ledgers', async () => {
  const db = new Database();
  await spendFree(db, 'a', 5);
  await assert.rejects(usage.reserveMessage(db, 'a', { now: october }));
  assert.equal((await usage.reserveMessage(db, 'b', { now: october })).remaining, 4);
  assert.equal((await usage.reserveMessage(db, 'a', { now: dayAt(1) })).remaining, 4);
});

test('PLUS is unlimited beyond old caps, ignores legacy counters, and bypasses the shared rejection', async () => {
  const previous = { ...process.env };
  try {
    process.env.LINKY_PLUS_DAILY = '1';
    process.env.LINKY_GLOBAL_DAILY_MESSAGES = '2';
    const db = new Database();
    const options = { plus: true, now: october, legacyState: { asks: { day: '2026-10-16', count: 24 } } };
    const quota = await usage.reserveMessage(db, 'member', options);
    assert.equal(quota.unlimited, true); assert.equal(quota.limit, null);
    assert.equal(quota.remaining, null); assert.equal(quota.used, 1);
    assert.equal(quota.dailyLimit, null); assert.equal(quota.dailyRemaining, null);
    assert.equal(quota.exhausted, false); assert.equal(quota.upgradeRequired, false);
    // Forty concurrent sends go beyond the retired 25/day allowance and the
    // shared ceiling of two. None may be rejected or invent a finite remainder.
    const more = await Promise.all(Array.from({ length: 40 }, () => usage.reserveMessage(db, 'member', options)));
    assert.ok(more.every((item) => item.unlimited && item.remaining === null && !item.exhausted));
    const final = await usage.readMessageQuota(db, 'member', options);
    assert.equal(final.used, 41); assert.equal(final.remaining, null);
    assert.equal(db.rows.get('linkyUsage/_global').day.count, 41);
    // The same shared counter still protects free-plan provider capacity.
    await assert.rejects(usage.reserveMessage(db, 'free-member', { now: october }), (error) => error.code === 'capacity');
    const tomorrow = await usage.reserveMessage(db, 'member', { plus: true, now: october + DAY });
    assert.equal(tomorrow.used, 1); assert.equal(tomorrow.remaining, null);
  } finally {
    process.env = previous;
  }
});

test('upgrade/downgrade does not erase exhausted free daily use', async () => {
  const db = new Database();
  await spendFree(db, 'member', 5);
  const plus = await usage.reserveMessage(db, 'member', { plus: true, now: october });
  assert.equal(plus.unlimited, true); assert.equal(plus.remaining, null); assert.equal(plus.used, 6);
  await assert.rejects(usage.reserveMessage(db, 'member', { plus: false, now: october }));
});

test('failed message reservation is refundable only within its original day', async () => {
  const db = new Database();
  const quota = await usage.reserveMessage(db, 'member', { now: october });
  await usage.refundMessage(db, 'member', quota);
  assert.equal((await usage.readMessageQuota(db, 'member', { now: october })).used, 0);
  const old = await usage.reserveMessage(db, 'member', { now: october });
  await usage.reserveMessage(db, 'member', { now: dayAt(1) });
  await usage.refundMessage(db, 'member', old);
  assert.equal(db.rows.get('linkyUsage/member').daily.count, 1);
  assert.equal(db.rows.get('linkyUsage/member').daily.key, '2026-10-17');
});

test('real ask wrapper counts greetings from every channel, stops at the daily five, and blocks before AI', async () => {
  const db = new Database(); const api = core(db);
  // Every channel draws from the same ledger, and the fifth message of the day
  // is the allowance. `ask()` uses the real clock, so this stays in one day.
  for (let i = 0; i < 5; i++) {
    const out = await api.ask('member', 'hello', { userDoc: member, source: ['app', 'telegram', 'whatsapp'][i % 3] });
    assert.equal(out.asksLeft, 4 - i);
    assert.equal(out.upgradeRequired, i === 4);
  }
  assert.equal(db.rows.get('linkyUsage/member').daily.count, 5);
  db.rows.set('linkyState/member', { pendingLoop: { at: Date.now(), introId: 'intro' } });
  await assert.rejects(api.ask('member', 'we met', { userDoc: member }), (e) => e.code === 'ask_limit');
  assert.equal(api.aiCalls(), 0);
});

test('real PLUS ask wrapper is unlimited, publishes honest aliases, and refunds failures', async () => {
  const db = new Database(); const api = core(db);
  const plusMember = { ...member, isPro: true, plan: 'plus' };
  for (let i = 0; i < 30; i++) {
    const out = await api.ask('member', 'hello', { userDoc: plusMember, source: ['app', 'telegram', 'whatsapp'][i % 3] });
    assert.equal(out.asksLeft, null); assert.equal(out.messageQuota.unlimited, true);
    assert.equal(out.messageQuota.used, i + 1); assert.equal(out.upgradeRequired, false);
  }
  assert.equal(db.rows.get('linkyUsage/member').daily.count, 30);
  const home = await api.home('member', { userDoc: plusMember });
  assert.equal(home.plus, true); assert.equal(home.messageQuota.unlimited, true);
  assert.equal(home.messageQuota.limit, null); assert.equal(home.messageQuota.remaining, null);
  assert.equal(home.limits.asksPerDay, null); assert.equal(home.limits.asksUsedToday, 30);
  assert.equal(home.limits.asksPeriod, 'day'); assert.equal(home.limits.asksPerMonth, null);
  db.failStateWrites = true;
  await assert.rejects(api.ask('member', 'hello', { userDoc: plusMember }), /state unavailable/);
  assert.equal(db.rows.get('linkyUsage/member').daily.count, 30);
  assert.equal(db.rows.get('linkyUsage/_global').day.count, 30);
});

test('clear chat and forget cannot reset the allowance ledger', async () => {
  const db = new Database(); const api = core(db);
  for (let i = 0; i < 5; i++) await api.ask('member', 'hello', { userDoc: member });
  await api.clearChat('member'); await api.forget('member');
  assert.equal(db.rows.get('linkyUsage/member').daily.count, 5);
  assert.ok(!db.rows.has('linkyState/member'));
  await assert.rejects(api.ask('member', 'hello', { userDoc: member }), (e) => e.code === 'ask_limit');
});

test('real wrapper fails closed on ledger failure and refunds failed processing', async () => {
  const db = new Database(); const api = core(db);
  db.failLedger = true;
  await assert.rejects(api.ask('member', 'hello', { userDoc: member }), /ledger unavailable/);
  assert.ok(!db.rows.has('linkyState/member'));
  db.failLedger = false; db.failStateWrites = true;
  await assert.rejects(api.ask('member', 'hello', { userDoc: member }), /state unavailable/);
  assert.equal(db.rows.get('linkyUsage/member').daily.count, 0);
});

test('home publishes the daily allowance and retired monthly aliases without reading user-editable counters', async () => {
  const db = new Database(); const api = core(db);
  await usage.reserveMessage(db, 'member', { now: Date.now() });
  const home = await api.home('member', { userDoc: member });
  assert.equal(home.messageQuota.period, 'day'); assert.equal(home.messageQuota.used, 1);
  assert.equal(home.messageQuota.dailyLimit, 5); assert.equal(home.messageQuota.dailyRemaining, 4);
  assert.equal(home.limits.asksPerDay, 5); assert.equal(home.limits.asksUsedToday, 1);
  assert.equal(home.limits.asksPeriod, 'day');
  assert.equal(home.limits.asksPerMonth, null); assert.equal(home.limits.asksUsedThisMonth, null);
});

test('client opens the free paywall from exhaustion and renders PLUS as unlimited', () => {
  const source = read('mobile/src/screens/LinkyHomeScreen.tsx');
  assert.match(source, /quota\?\.upgradeRequired/); assert.match(source, /setPaywall\(FREE_LINKY_LIMIT_MESSAGE\)/);
  assert.match(source, /Unlimited messages · PLUS/); assert.doesNotMatch(source, /messages left today · PLUS/);
  // Daily-only header plus a locked composer once today's five are used up.
  assert.match(source, /free messages today/); assert.match(source, /composerLocked/);
  assert.match(source, /Today's free messages are used up/);
  assert.doesNotMatch(source, /left this month/);
  assert.ok(source.indexOf('if (atMessageLimit &&') < source.indexOf('const out = await linkyAsk(msg)'));
  assert.match(read('firestore.rules'), /match \/linkyUsage\/\{userId\}\s*\{\s*allow read, write: if false;/);
});

test('client compatibility fallback understands nullable unlimited PLUS aliases', () => {
  const module = { exports: {} };
  const code = ts.transpileModule(read('mobile/src/lib/linkyQuota.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports });
  const home = { plus: true, limits: { asksPerDay: null, asksUsedToday: 42, asksPeriod: 'day', asksResetAt: '' } };
  const quota = module.exports.quotaFromHome(home);
  assert.equal(quota.unlimited, true); assert.equal(quota.limit, null);
  assert.equal(quota.remaining, null); assert.equal(quota.exhausted, false);
  assert.equal(quota.used, 42); assert.equal(quota.resetAt, '');
  const updated = module.exports.homeWithQuota(home, { ...quota, used: 43 });
  assert.equal(updated.limits.asksPerDay, null); assert.equal(updated.limits.asksUsedToday, 43);
  // The legacy fallback derives a day-shaped quota: the monthly bucket is gone.
  const free = module.exports.quotaFromHome({ plus: false, limits: { asksPerDay: 5, asksUsedToday: 2, asksResetAt: '' } });
  assert.equal(free.period, 'day'); assert.equal(free.remaining, 3);
  assert.equal(free.exhausted, false); assert.equal(free.upgradeRequired, false);
  const spent = module.exports.quotaFromHome({ plus: false, limits: { asksPerDay: 5, asksUsedToday: 5, asksResetAt: '' } });
  assert.equal(spent.exhausted, true); assert.equal(spent.upgradeRequired, true);
});

test('authenticated app API returns structured 402 quota data without losing the upgrade signal', async () => {
  const db = new Database(); const api = core(db);
  db.rows.set('users/member', member);
  // `ask()` bills against the real current UTC day, so exhaust today directly.
  for (let i = 0; i < 5; i++) await usage.reserveMessage(db, 'member', { now: Date.now() });
  const module = { exports: {} };
  const mocks = {
    './_builderRuntime.js': {}, 'node:crypto': crypto, './_linky.js': api, './_proof.js': {},
    './_firebaseAdmin.js': { getDb: () => db, verifyRequestUser: async () => ({ uid: 'member' }) },
    './_gemini.js': { handleOptions: () => false, readJsonBody: (req) => req.body, setCors: () => {}, sendError: (res, code, message) => res.status(code).json({ error: message }) },
  };
  const code = ts.transpileModule(read('api/linky.js'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => { assert.ok(name in mocks, name); return mocks[name]; }, process: { env: {} }, console, Date, Buffer, Set, Map });
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await module.exports.default({ method: 'POST', query: {}, body: { action: 'ask', message: 'hello' }, headers: {} }, response);
  assert.equal(response.code, 402); assert.equal(response.body.code, 'ask_limit');
  assert.equal(response.body.messageQuota.period, 'day'); assert.equal(response.body.upgradeRequired, true);
});


test('retired monthly ledgers are ignored: every UTC day starts fresh',async()=>{
 const db=new Database();db.rows.set('linkyUsage/member',{month:{key:'2026-10',count:15}});
 const quota=await usage.readMessageQuota(db,'member',{now:october});
 assert.equal(quota.limit,5);assert.equal(quota.used,0);assert.equal(quota.remaining,5);
 assert.equal((await usage.reserveMessage(db,'member',{now:october})).remaining,4);
});

test('a shared daily ceiling protects the provider quota without spending anyone\'s allowance', async () => {
  const previous = { ...process.env };
  try {
    process.env.LINKY_GLOBAL_DAILY_MESSAGES = '2';
    const db = new Database();
    await usage.reserveMessage(db, 'a', { now: Date.parse('2026-10-24T08:00:00Z') });
    await usage.reserveMessage(db, 'b', { now: Date.parse('2026-10-24T09:00:00Z') });
    await assert.rejects(
      usage.reserveMessage(db, 'c', { now: Date.parse('2026-10-24T10:00:00Z') }),
      error => error.code === 'capacity'
    );
    const untouched = await usage.readMessageQuota(db, 'c', { plus: false, now: Date.parse('2026-10-24T10:00:00Z') });
    assert.equal(untouched.remaining, 5);
    // A failed delivery gives the shared slot back.
    const reservation = await usage.reserveMessage(db, 'd', { now: Date.parse('2026-10-25T00:00:00Z') });
    assert.equal(reservation.remaining, 4);
    await usage.refundMessage(db, 'd', reservation);
    const after = await usage.readMessageQuota(db, 'd', { plus: false, now: Date.parse('2026-10-25T00:00:00Z') });
    assert.equal(after.remaining, 5);
  } finally {
    process.env = previous;
  }
});

test('LINKY_FREE_DAILY resizes the daily allowance without a code change', async () => {
  const previous = { ...process.env };
  try {
    process.env.LINKY_FREE_DAILY = '2';
    const db = new Database(), now = Date.parse('2026-10-24T08:00:00Z');
    await usage.reserveMessage(db, 'member', { now });
    await usage.reserveMessage(db, 'member', { now });
    await assert.rejects(usage.reserveMessage(db, 'member', { now }), error => error.code === 'ask_limit');
    const quota = await usage.readMessageQuota(db, 'member', { plus: false, now });
    assert.equal(quota.limit, 2);
    assert.equal(quota.remaining, 0);
    assert.equal(quota.upgradeRequired, true);
    assert.equal(quota.dailyLimit, 2);
    // Tomorrow starts with a fresh daily allowance.
    const tomorrow = await usage.readMessageQuota(db, 'member', { plus: false, now: now + 86400000 });
    assert.equal(tomorrow.used, 0);
    assert.equal(tomorrow.remaining, 2);
  } finally {
    process.env = previous;
  }
});

test('budget arithmetic matches the documented plan', async () => {
  const { budgetConfig, sustainableMessages, fairShare } = await import('../shared/linky-budget.js');
  const config = budgetConfig({ LINKY_MODEL_RPD: '500', LINKY_CALLS_PER_MESSAGE: '2.1' });
  const messages = sustainableMessages(config);
  assert.equal(messages, 190);
  assert.equal(fairShare({ messagesPerDay: messages, members: 500 }), 1);
  const paid = budgetConfig({ LINKY_MODEL_RPD: '100000' });
  assert.ok(sustainableMessages(paid) > 30_000);
  assert.equal(budgetConfig({ LINKY_GLOBAL_DAILY_MESSAGES: '0' }).globalDailyMessages, 0);
});
