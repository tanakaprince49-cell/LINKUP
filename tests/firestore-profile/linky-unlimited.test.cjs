const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const admin = require('firebase-admin');

let env;
let app;
let db;
let usage;

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Linky unlimited tests MUST run against the Firestore Emulator.');
  env = await initializeTestEnvironment({ projectId: 'demo-linkup', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
  app = admin.initializeApp({ projectId: 'demo-linkup' }, 'linky-unlimited-tests');
  db = app.firestore();
  usage = await import('../../api/_linkyUsage.js');
});

after(async () => {
  await env?.cleanup();
  await app?.delete();
});

test('real Firestore transactions keep PLUS unlimited while the free shared guard still fails closed', async () => {
  await env.clearFirestore();
  const previous = { ...process.env };
  process.env.LINKY_PLUS_DAILY = '1';
  process.env.LINKY_GLOBAL_DAILY_MESSAGES = '2';
  try {
    const now = Date.parse('2026-10-24T08:00:00Z');
    await db.collection('linkyUsage').doc('plus').set({
      day: { key: '2026-10-24', count: 24 },
      daily: { key: '2026-10-24', count: 24 },
    });
    // Forty real concurrent transactions exceed both configured caps. Firestore
    // retries must serialize accounting without recreating an allowance.
    const reservations = await Promise.all(Array.from({ length: 40 }, () => usage.reserveMessage(db, 'plus', { plus: true, now })));
    assert.ok(reservations.every((quota) => quota.unlimited && quota.limit === null && quota.remaining === null && !quota.exhausted));
    const quota = await usage.readMessageQuota(db, 'plus', { plus: true, now });
    assert.equal(quota.used, 64);
    assert.equal(quota.dailyUsed, 64);
    assert.equal(quota.remaining, null);
    assert.equal(quota.dailyRemaining, null);
    const global = await db.collection('linkyUsage').doc('_global').get();
    assert.equal(global.data().day.count, 40);
    await assert.rejects(
      usage.reserveMessage(db, 'free', { plus: false, now }),
      (error) => error.code === 'capacity' && error.messageQuota.used === 0,
    );
    const free = await usage.readMessageQuota(db, 'free', { plus: false, now });
    assert.equal(free.used, 0);
    assert.equal(free.remaining, 15);
  } finally {
    process.env = previous;
  }
});

test('real Firestore PLUS refunds reverse member, daily and shared accounting without creating a cap', async () => {
  await env.clearFirestore();
  const previous = { ...process.env };
  process.env.LINKY_GLOBAL_DAILY_MESSAGES = '10';
  try {
    // refundMessage deliberately uses the real current UTC day for daily/shared
    // buckets, so this integration case reserves against the same real day.
    const now = Date.now();
    const reservation = await usage.reserveMessage(db, 'plus', { plus: true, now });
    assert.equal(reservation.unlimited, true);
    assert.equal(reservation.remaining, null);
    await usage.refundMessage(db, 'plus', reservation);
    const quota = await usage.readMessageQuota(db, 'plus', { plus: true, now });
    assert.equal(quota.used, 0);
    assert.equal(quota.dailyUsed, 0);
    assert.equal(quota.remaining, null);
    assert.equal(quota.exhausted, false);
    const global = await db.collection('linkyUsage').doc('_global').get();
    assert.equal(global.data().day.count, 0);
  } finally {
    process.env = previous;
  }
});
