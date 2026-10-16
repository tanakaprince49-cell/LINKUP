import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
function evaluate(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date, Set, Map, console, require: (name) => { assert.ok(name in mocks, name); return mocks[name]; } });
  return module.exports;
}
const policy = evaluate('mobile/src/lib/reviewPolicy.ts');
const DAY = 86_400_000;
const eligible = () => ({ firstSeenAt: Date.now() - 4 * DAY, activeDays: ['2026-10-13', '2026-10-14', '2026-10-16'], actions: 5, requestedAt: [] });
function service({ os = 'android', available = true, failStorage = false, failMarket = false, failReview = false } = {}) {
  const storage = new Map(), opened = []; let reviews = 0, imports = 0;
  const native = { isAvailableAsync: async () => available, requestReview: async () => { reviews++; if (failReview) throw Error('Play unavailable'); } };
  const mocks = {
    './reviewPolicy': policy,
    '@react-native-async-storage/async-storage': { getItem: async (key) => { if (failStorage) throw Error('storage unavailable'); return storage.get(key) || null; }, setItem: async (key, value) => storage.set(key, value) },
    'react-native': { Platform: { OS: os }, Linking: { openURL: async (url) => { opened.push(url); if (failMarket && url.startsWith('market:')) throw Error('Play not installed'); } } },
    'expo-store-review': new Proxy(native, { get(target, name) { if (name === 'isAvailableAsync') imports++; return target[name]; } }),
  };
  const api = evaluate('mobile/src/lib/appReview.ts', mocks);
  const key = (uid) => `linkup:app-review:v1:${uid}`;
  return { ...api, storage, opened, reviews: () => reviews, imports: () => imports, seed: (uid, state = eligible()) => storage.set(key(uid), JSON.stringify(state)), state: (uid) => JSON.parse(storage.get(key(uid))) };
}

test('review eligibility requires real app experience, not sentiment or a subscription', () => {
  const now = Date.now(); const ready = eligible();
  assert.equal(policy.eligibleForReview(ready, now), true);
  for (const patch of [{ firstSeenAt: now }, { activeDays: ['2026-10-16'] }, { actions: 4 }]) assert.equal(policy.eligibleForReview({ ...ready, ...patch }, now), false);
  assert.equal(policy.eligibleForReview({ ...ready, happy: false, plus: false }, now), true);
  assert.equal(policy.eligibleForReview({ ...ready, happy: true, plus: true }, now), true);
});

test('90-day cooldown and three-attempt rolling-year cap prevent nagging', () => {
  const now = Date.now(); const ready = eligible();
  assert.equal(policy.eligibleForReview({ ...ready, requestedAt: [now - 89 * DAY] }, now), false);
  assert.equal(policy.eligibleForReview({ ...ready, requestedAt: [now - 91 * DAY] }, now), true);
  assert.equal(policy.eligibleForReview({ ...ready, requestedAt: [now - 300 * DAY, now - 200 * DAY, now - 100 * DAY] }, now), false);
  const cleaned = policy.reviewState({ ...ready, requestedAt: [now - 366 * DAY] }, now);
  assert.equal(cleaned.requestedAt.length, 0);
});

test('visits count distinct active days, and only safe idle routes can request', () => {
  const now = Date.now(); const initial = policy.reviewState(null, now);
  const once = policy.withReviewVisit(initial, now); const twice = policy.withReviewVisit(once, now);
  assert.equal(twice.activeDays.length, 1);
  assert.equal(policy.withReviewVisit(twice, now + DAY).activeDays.length, 2);
  for (const route of ['Chat', 'LinkyHome', 'Onboarding', 'EmailAuth', 'Campaigns', 'Profile']) assert.equal(policy.SAFE_REVIEW_ROUTES.has(route), false);
});

test('automatic Android API is attempted once, with no claim that a rating was submitted', async () => {
  const app = service(); app.seed('member');
  await Promise.all([app.requestAutomaticReview('member', () => true), app.requestAutomaticReview('member', () => true)]);
  assert.equal(app.reviews(), 1); assert.equal(app.state('member').requestedAt.length, 1);
  assert.ok(!('rated' in app.state('member')));
});

test('review API is never called on web or iOS', async () => {
  for (const os of ['web', 'ios']) {
    const app = service({ os }); app.seed('member');
    await app.recordReviewVisit('member'); await app.recordReviewAction('member');
    await app.requestAutomaticReview('member', () => true); await app.openPlayReview();
    assert.equal(app.reviews(), 0); assert.equal(app.opened.length, 0); assert.equal(app.imports(), 0);
    assert.equal(app.state('member').actions, 5);
  }
});

test('unavailable Play, background navigation, and blocked billing never launch a review', async () => {
  const unavailable = service({ available: false }); unavailable.seed('member');
  await unavailable.requestAutomaticReview('member', () => true);
  assert.equal(unavailable.reviews(), 0); assert.equal(unavailable.state('member').requestedAt.length, 0);
  const app = service(); app.seed('member');
  await app.requestAutomaticReview('member', () => false);
  const release = app.blockAppReviews();
  await app.requestAutomaticReview('member', () => true);
  assert.equal(app.reviews(), 0);
  release(); release(); await app.requestAutomaticReview('member', () => true);
  assert.equal(app.reviews(), 1);
});

test('storage and native API failures never interrupt networking', async () => {
  const app = service({ failStorage: true });
  await assert.doesNotReject(app.recordReviewAction('member'));
  await assert.doesNotReject(app.requestAutomaticReview('member', () => true));
  assert.equal(app.reviews(), 0);
  const failure = service({ failReview: true }); failure.seed('member');
  await assert.doesNotReject(failure.requestAutomaticReview('member', () => true));
  await failure.requestAutomaticReview('member', () => true);
  assert.equal(failure.reviews(), 1, 'failed attempts still respect cooldown');
});

test('manual Rate button opens Google Play directly with HTTPS fallback, never the quota-limited API', async () => {
  const app = service({ failMarket: true });
  await app.openPlayReview();
  assert.equal(app.opened.length, 2);
  assert.match(app.opened[0], /^market:\/\/details\?id=com\.tana\.linkup/);
  assert.match(app.opened[1], /^https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.tana\.linkup/);
  assert.equal(app.reviews(), 0);
});

test('per-account action counters serialize updates and do not carry another member eligibility', async () => {
  const app = service();
  await Promise.all(Array.from({ length: 5 }, () => app.recordReviewAction('a')));
  assert.equal(app.state('a').actions, 5);
  await app.recordReviewVisit('b'); assert.equal(app.state('b').actions, 0);
});

test('quota UI ignores out-of-order count refunds but accepts calendar rollover and PLUS quotas', () => {
  const module = evaluate('mobile/src/lib/linkyQuota.ts');
  const quota = { period: 'month', periodKey: '2026-10', used: 10, remaining: 0, limit: 10, resetAt: '2026-11-01', exhausted: true, upgradeRequired: true };
  assert.equal(module.mergeMessageQuota(quota, { ...quota, used: 9, remaining: 1 }).used, 10);
  assert.equal(module.mergeMessageQuota(quota, { ...quota, periodKey: '2026-11', used: 1, remaining: 9 }).used, 1);
  assert.equal(module.mergeMessageQuota(quota, { ...quota, period: 'day', used: 1, remaining: 59, limit: 60 }).limit, 60);
});
