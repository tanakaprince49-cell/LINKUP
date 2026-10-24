const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const admin = require('firebase-admin');

const DAY = 86_400_000;
const START = Date.parse('2026-10-23T18:00:00Z');
let env;
let app;
let db;
let createBuilderService;
let clock;
let pushes;

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Linky re-engagement tests MUST run against the Firestore Emulator.');
  env = await initializeTestEnvironment({ projectId: 'demo-linkup', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
  app = admin.initializeApp({ projectId: 'demo-linkup' }, 'linky-reengagement-tests');
  db = app.firestore();
  ({ createBuilderService } = await import('../../api/_builder.js'));
});

after(async () => {
  await env?.cleanup();
  await app?.delete();
});

async function seed({ welcomeBack = true } = {}) {
  await env.clearFirestore();
  clock = START;
  pushes = [];
  await db.collection('users').doc('alice').set({ displayName: 'Alice', onboarded: true, isVisible: true });
  const service = createBuilderService({
    db,
    now: () => clock,
    push: async (uid, message) => {
      pushes.push({ uid, ...message });
      return { sent: 1 };
    },
  });
  await service.handle('alice', 'prefs', {
    inApp: true,
    push: true,
    retention: true,
    welcomeBack,
    timezone: 'UTC',
    quietStart: 22,
    quietEnd: 6,
  });
  return service;
}

async function makeInactive(days = 4) {
  const lastActiveAt = admin.firestore.Timestamp.fromMillis(clock - days * DAY);
  await Promise.all([
    db.collection('users').doc('alice').update({ lastActiveAt }),
    db.collection('presence').doc('alice').set({ isOnline: false, lastActiveAt }),
    db.collection('builderStates').doc('alice').update({ lastVisitAt: clock - days * DAY }),
  ]);
}

const comebackNotifications = async () => (await db.collection('notifications').where('category', '==', 'comeback').get()).docs;

test('Linky sends one catchy native push, deduplicates concurrent workers and rotates after the cooldown', async () => {
  const service = await seed();
  await makeInactive(4);

  const concurrent = await Promise.all([service.runReminderPage(), service.runReminderPage()]);
  assert.equal(concurrent.reduce((sum, result) => sum + result.delivered, 0), 1);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].uid, 'alice');
  assert.equal(pushes[0].title, 'Linky · Your next move is calling.');
  assert.match(pushes[0].body, /^4 days since your last visit\./);
  assert.equal(pushes[0].url, '/builder?section=Today');
  assert.equal(pushes[0].campaign, 'linky_reengagement');
  assert.equal(pushes[0].category, 'comeback');

  let docs = await comebackNotifications();
  assert.equal(docs.length, 1);
  const notification = docs[0].data();
  assert.equal(notification.fromName, 'Linky');
  assert.equal(notification.type, 'builder');
  assert.equal(notification.campaign, 'linky_reengagement');
  assert.equal(notification.headlineKey, 'next-move');
  assert.equal(notification.title, 'Your next move is calling.');
  assert.match(notification.body, /^4 days since your last visit\./);
  assert.equal(notification.content, `${notification.title} — ${notification.body}`);
  assert.equal(notification.url, '/builder?section=Today');
  assert.equal(notification.serverPushManaged, true);
  assert.equal(notification.pushRequested, true);
  assert.equal(notification.pushStatus, 'provider_accepted');

  let state = (await db.collection('builderStates').doc('alice').get()).data();
  assert.equal(state.lastComebackAt, clock);
  assert.equal(state.comebackSequence, 1);

  await service.runReminderPage();
  assert.equal(pushes.length, 1, 'a replay cannot send the same invitation again');

  clock += 3 * DAY;
  await service.runReminderPage();
  assert.equal(pushes.length, 2, 'the next invitation is eligible exactly after three days');
  assert.equal(pushes[1].title, 'Linky · Ready for your comeback arc?');
  assert.match(pushes[1].body, /^7 days since your last visit\./);
  assert.notEqual(pushes[1].title, pushes[0].title);
  docs = await comebackNotifications();
  assert.equal(docs.length, 2);
  state = (await db.collection('builderStates').doc('alice').get()).data();
  assert.equal(state.comebackSequence, 2);
});

test('recent presence and the dedicated welcome-back opt-out both suppress delivery', async () => {
  const optedOut = await seed({ welcomeBack: false });
  await makeInactive(8);
  assert.equal((await optedOut.runReminderPage()).delivered, 0);
  assert.equal(pushes.length, 0);
  assert.equal((await comebackNotifications()).length, 0);

  const service = await seed({ welcomeBack: true });
  await makeInactive(8);
  await db.collection('presence').doc('alice').update({ isOnline: true, lastActiveAt: admin.firestore.Timestamp.fromMillis(clock - 2 * DAY) });
  assert.equal((await service.runReminderPage()).delivered, 0, 'recent app activity wins over older user/workspace timestamps');
  assert.equal(pushes.length, 0);

  await db.collection('presence').doc('alice').update({ isOnline: false, lastActiveAt: admin.firestore.Timestamp.fromMillis(clock - 4 * DAY) });
  assert.equal((await service.runReminderPage()).delivered, 1);
  assert.equal(pushes.length, 1);
});
