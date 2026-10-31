import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LINKY_REENGAGEMENT,
  LINKY_COMEBACK_SCRIPTS,
  linkyComebackCandidate,
  nextLinkyHeadlineIndex,
} from '../shared/linky-reengagement.js';
import { nextRetention, RETENTION } from '../shared/retention.js';
import {
  activityTimestamp,
  lastActivityAt,
  planRetention,
  retentionFacts,
} from '../api/_retention.js';
import { DEFAULT_PREFS, sanitizePrefs } from '../api/_builderCore.js';

const DAY = 86_400_000;
const at = Date.parse('2026-10-24T18:00:00Z');
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const state = (over = {}) => {
  const { prefs: preferenceOverrides = {}, ...rest } = over;
  return {
    prefs: {
      inApp: true,
      push: true,
      retention: true,
      welcomeBack: true,
      timezone: 'UTC',
      quietStart: 23,
      quietEnd: 0,
      ...preferenceOverrides,
    },
    retention: { day: '', sent: [] },
    lastDeliveryAt: 0,
    ...rest,
  };
};
const facts = (over = {}) => ({
  localDay: '2026-10-24',
  localHour: 18,
  daysSinceActive: 4,
  ...over,
});

test('Linky has eight distinct, short comeback headlines with honest invitation copy', () => {
  assert.equal(LINKY_COMEBACK_SCRIPTS.length, 8);
  assert.equal(new Set(LINKY_COMEBACK_SCRIPTS.map(script => script.key)).size, 8);
  assert.equal(new Set(LINKY_COMEBACK_SCRIPTS.map(script => script.title)).size, 8);
  for (const script of LINKY_COMEBACK_SCRIPTS) {
    assert.ok(script.title.length <= 50, script.title);
    assert.ok(script.body.length <= 130, script.key);
    assert.doesNotMatch(`${script.title} ${script.body}`, /new match|new message|someone (?:viewed|liked)|you missed [1-9]|trending now/i);
  }
  const invitation = linkyComebackCandidate({ state: state(), facts: facts(), now: at });
  assert.equal(invitation.title, 'Your next move is calling.');
  assert.match(invitation.body, /^4 days since your last visit\./);
  assert.ok(invitation.body.length <= 180);
  assert.equal(invitation.pushTitle, 'Linky · Your next move is calling.');
  assert.equal(invitation.url, '/builder?section=Today');
  assert.deepEqual(invitation.used, ['daysSinceActive']);
});

test('welcome-back invitations fail closed without real inactivity and respect their own opt-in and cooldown', () => {
  assert.equal(LINKY_REENGAGEMENT.afterDays, 3);
  assert.equal(RETENTION.comebackCooldownMs, 3 * DAY);
  for (const daysSinceActive of [undefined, null, 0, 1, 2, 2.5, '4']) {
    assert.equal(linkyComebackCandidate({ state: state(), facts: facts({ daysSinceActive }), now: at }), null, String(daysSinceActive));
  }
  assert.ok(linkyComebackCandidate({ state: state(), facts: facts({ daysSinceActive: 3 }), now: at }));
  assert.equal(linkyComebackCandidate({ state: state({ prefs: { welcomeBack: false } }), facts: facts(), now: at }), null);
  assert.equal(linkyComebackCandidate({ state: state({ lastComebackAt: at - 3 * DAY + 1 }), facts: facts(), now: at }), null);
  assert.ok(linkyComebackCandidate({ state: state({ lastComebackAt: at - 3 * DAY }), facts: facts(), now: at }));
});

test('headline selection rotates through every script and wraps without a repeated headline', () => {
  const seen = [];
  for (let index = 0; index < LINKY_COMEBACK_SCRIPTS.length; index++) {
    const invitation = linkyComebackCandidate({ state: state({ comebackSequence: index }), facts: facts(), now: at });
    assert.equal(invitation.headlineIndex, index);
    assert.equal(invitation.headlineKey, LINKY_COMEBACK_SCRIPTS[index].key);
    seen.push(invitation.title);
  }
  assert.equal(new Set(seen).size, LINKY_COMEBACK_SCRIPTS.length);
  assert.equal(nextLinkyHeadlineIndex(7), 0);
  assert.equal(nextLinkyHeadlineIndex(8), 1);
  assert.equal(nextLinkyHeadlineIndex(-4), 1);
  assert.equal(nextLinkyHeadlineIndex('nonsense'), 1);
});

test('the shared scheduler applies channel, quiet-hour, spacing, daily dedupe and global opt-out guards', () => {
  const first = nextRetention({ state: state(), facts: facts(), now: at });
  assert.equal(first.category, 'comeback');
  assert.equal(first.slot, 'evening');
  assert.equal(first.section, 'Today');
  assert.match(first.content, /^Your next move is calling\. — 4 days since your last visit\./);
  assert.equal(nextRetention({ state: state({ prefs: { retention: false } }), facts: facts(), now: at }), null);
  assert.equal(nextRetention({ state: state({ prefs: { welcomeBack: false } }), facts: facts(), now: at }), null);
  assert.equal(nextRetention({ state: state({ prefs: { inApp: false, push: false } }), facts: facts(), now: at }), null);
  assert.equal(nextRetention({ state: state({ prefs: { quietStart: 17, quietEnd: 20 } }), facts: facts(), now: at }), null);
  assert.equal(nextRetention({ state: state({ lastDeliveryAt: at - 1000 }), facts: facts(), now: at }), null);
  assert.equal(nextRetention({ state: state({ retention: { day: '2026-10-24', sent: [{ category: 'comeback', at }] } }), facts: facts(), now: at }), null);
  assert.equal(nextRetention({ state: state(), facts: facts({ localHour: 13 }), now: at }), null, 'comeback copy belongs to the evening/night windows');
});

test('server facts use the latest real user, presence or workspace activity timestamp', () => {
  assert.equal(activityTimestamp({ toMillis: () => 1234 }), 1234);
  assert.equal(activityTimestamp({ seconds: 2, nanoseconds: 500000000 }), 2500);
  assert.equal(activityTimestamp(new Date(3456)), 3456);
  assert.equal(activityTimestamp('1970-01-01T00:00:04.000Z'), 4000);
  assert.equal(activityTimestamp('not a timestamp'), 0);
  assert.equal(lastActivityAt({
    user: { lastActiveAt: at - 5 * DAY },
    presence: { lastActiveAt: at - 2 * DAY },
    state: { lastVisitAt: at - 4 * DAY },
  }), at - 2 * DAY);

  const base = {
    uid: 'alice',
    now: at,
    state: state({ lastVisitAt: at - 5 * DAY }),
    user: { lastActiveAt: new Date(at - 4 * DAY) },
    contributions: {},
  };
  assert.equal(retentionFacts({ ...base, presence: { lastActiveAt: new Date(at - 2 * DAY) } }).daysSinceActive, 2);
  assert.equal(retentionFacts({ ...base, presence: {} }).daysSinceActive, 4);
  assert.equal(retentionFacts({ uid: 'alice', now: at, state: state(), user: {}, presence: {}, contributions: {} }).daysSinceActive, null);

  const active = planRetention({ ...base, presence: { lastActiveAt: new Date(at - 2 * DAY) } });
  assert.equal(active.message, null, 'a missing build post is not evidence that an active member went away');
  const inactive = planRetention({ ...base, presence: {} });
  assert.equal(inactive.message.category, 'comeback');
  assert.match(inactive.message.body, /4 days since your last visit/);
});

test('the preference, settings control, push adapter and browser copy are wired end to end', () => {
  assert.equal(DEFAULT_PREFS.welcomeBack, true);
  assert.equal(sanitizePrefs({ welcomeBack: false }).welcomeBack, false);
  assert.equal(sanitizePrefs({ welcomeBack: true }).welcomeBack, true);
  assert.throws(() => sanitizePrefs({ welcomeBack: 'yes' }));
  const ui = read('mobile/src/screens/BuilderWorkspaceScreen.tsx');
  assert.match(ui, /Linky welcome-back invitations/);
  assert.match(ui, /rotate eight headlines/);
  const service = read('api/_builder.js');
  assert.match(service, /collection\('presence'\)/);
  assert.match(service, /delivery\.pushTitle/);
  assert.match(service, /s\.lastComebackAt=now\(\)/);
  assert.match(service, /s\.comebackSequence=nextLinkyHeadlineIndex/);
  const runtime = read('api/_builderRuntime.js');
  assert.match(runtime, /campaign,category/);
  assert.match(runtime, /sendExpoPush/);
  assert.match(read('api/_expoPush.js'), /priority:'high'/);
  assert.match(read('mobile/src/lib/notifications.ts'), /data\?\.campaign === 'linky_reengagement'/);
});
