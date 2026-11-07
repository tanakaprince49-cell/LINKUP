import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chooseWeeklySpotlight, randomWeeklySpotlightAt, weeklySpotlightWindow } from '../shared/weekly-spotlight.js';
import { runWeeklyFounderSpotlight } from '../api/_weeklyFounderSpotlight.js';

const monday = Date.parse('2026-11-02T08:00:00.000Z');

function memoryDb() {
  const docs = new Map();
  const ref = (collection, id) => ({
    collection,
    id,
    key: `${collection}/${id}`,
    async get() {
      const value = docs.get(this.key);
      return { exists: value !== undefined, data: () => value };
    },
    async set(value, options = {}) {
      const previous = docs.get(this.key) || {};
      docs.set(this.key, options.merge ? { ...previous, ...value } : value);
    },
  });
  return {
    docs,
    collection: name => ({ doc: id => ref(name, id) }),
    async runTransaction(callback) {
      return callback({
        get: document => document.get(),
        set: (document, value, options) => document.set(value, options),
      });
    },
  };
}

test('weekly spotlight windows are Monday-to-Monday UTC and draw times vary within the active week', () => {
  const window = weeklySpotlightWindow(monday);
  assert.equal(window.key, '2026-11-02');
  assert.equal(window.start, Date.parse('2026-11-02T00:00:00.000Z'));
  assert.equal(window.end, Date.parse('2026-11-09T00:00:00.000Z'));
  const early = randomWeeklySpotlightAt({ ...window, now: monday, random: () => 0 });
  const later = randomWeeklySpotlightAt({ ...window, now: monday, random: () => 0.75 });
  assert.equal(early, monday + 60_000);
  assert.ok(later > early && later < window.end);
  assert.equal(randomWeeklySpotlightAt({ ...window, now: window.end + 1, random: () => 0.5 }), window.end + 1);
});

test('weekly selection requires sustained real build days and ranks points, days, helpfulness, then uid', () => {
  const winner = chooseWeeklySpotlight([
    { uid: 'one-day', points: 500, buildDays: 1, helpful: 99 },
    { uid: 'charlie', points: 40, buildDays: 3, helpful: 1 },
    { uid: 'bob', points: 40, buildDays: 3, helpful: 2 },
    { uid: 'alice', points: 40, buildDays: 3, helpful: 2 },
  ]);
  assert.equal(winner.uid, 'alice');
  assert.equal(chooseWeeklySpotlight([{ uid: 'only-one-day', points: 10, buildDays: 1 }]), null);
});

test('hourly job persists a random draw, awards and notifies only once with personalized share copy', async () => {
  const db = memoryDb();
  let boardCalls = 0, notifications = 0, message;
  const deps = {
    random: () => 0,
    loadBoard: async (_db, options) => {
      boardCalls += 1;
      assert.equal(options.period, 'week');
      assert.equal(options.includeAll, true);
      return {
        complete: true,
        participants: 3,
        scanned: 3,
        candidateRows: [
          { uid: 'single-day', name: 'One Day', points: 90, buildDays: 1, helpful: 9 },
          { uid: 'winner', name: 'Ari Founder', points: 35, buildDays: 3, helpful: 1 },
          { uid: 'other', name: 'Other Founder', points: 20, buildDays: 2, helpful: 0 },
        ],
      };
    },
    notify: async (_db, input) => {
      notifications += 1;
      message = input;
      return { notified: true };
    },
  };
  const first = await runWeeklyFounderSpotlight(db, monday, deps);
  assert.equal(first.status, 'scheduled');
  assert.equal(first.pending, true);
  assert.equal(boardCalls, 0);
  const scheduled = db.docs.get('weeklyFounderSpotlights/2026-11-02');
  assert.equal(scheduled.drawAt, monday + 60_000);

  const second = await runWeeklyFounderSpotlight(db, monday + 60_001, deps);
  assert.equal(second.status, 'awarded');
  assert.equal(second.uid, 'winner');
  assert.equal(boardCalls, 1);
  assert.equal(notifications, 1);
  assert.equal(message.notificationType, 'founder_spotlight');
  assert.match(message.title, /Ari Founder/);
  assert.match(message.body, /3 build days/);
  assert.match(message.body, /private update text stays private/i);
  assert.equal(message.email.minUserGapMs, 0);
  assert.match(message.url, /founder-spotlight\/winner\/2026-11-02$/);
  assert.equal(db.docs.get('weeklyFounderSpotlights/2026-11-02').status, 'awarded');

  const third = await runWeeklyFounderSpotlight(db, monday + 120_000, { ...deps, random: () => 0.9 });
  assert.equal(third.status, 'awarded');
  assert.equal(boardCalls, 1);
  assert.equal(notifications, 1);
});

test('partial eligible pools and weeks without a serious builder fail closed instead of minting a false winner', async () => {
  for (const [board, expectedReason] of [
    [{ complete: false, participants: 5000, scanned: 5000, candidateRows: [{ uid: 'a', points: 90, buildDays: 7 }] }, 'eligible-pool-over-safety-cap'],
    [{ complete: true, participants: 1, scanned: 1, candidateRows: [{ uid: 'a', points: 10, buildDays: 1 }] }, 'minimum-activity-not-met'],
  ]) {
    const db = memoryDb();
    let notifyCount = 0;
    await runWeeklyFounderSpotlight(db, monday, { random: () => 0 });
    const key = '2026-11-02';
    await db.collection('weeklyFounderSpotlights').doc(key).set({ drawAt: monday - 1, status: 'scheduled' }, { merge: true });
    const result = await runWeeklyFounderSpotlight(db, monday + 1, {
      loadBoard: async () => board,
      notify: async () => { notifyCount += 1; return { notified: true }; },
    });
    assert.equal(result.status, 'no-winner');
    assert.equal(result.reason, expectedReason);
    assert.equal(notifyCount, 0);
  }
});

test('hourly authenticated cron runs the weekly selector independently of the reminder cursor', () => {
  const source = fs.readFileSync(new URL('../api/linky.js', import.meta.url), 'utf8');
  assert.match(source, /import\s*\{[^}]*runWeeklyFounderSpotlight[^}]*\}\s*from/);
  assert.match(source, /runWeeklyFounderSpotlight\(getDb\(\)\)\.catch\(\(\)\s*=>\s*null\)/);
  assert.match(source, /weeklyFounderSpotlight[,]?[^}]*\}\);/);
});
