// The PLUS paywall used to be reactive: it only opened when a member hit a gate,
// and most members never hit one — which is why it "didn't appear". These tests
// pin the replacement: three invitations a day, never at a fixed time, one
// benefit each with an explicit "there is more", never for a member who pays,
// and one block per email for everybody else.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';

const read = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

/** plusInviteSchedule.ts is deliberately import-free, so it can be run as-is. */
const scheduleSource = read('mobile/src/lib/plusInviteSchedule.ts');
const compiled = ts.transpileModule(scheduleSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const S = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const at = (hour, minute = 0, day = 7) => new Date(2026, 10, day, hour, minute, 0, 0).getTime();
const uid = 'member-1';

test('three invitations per day, inside the waking window, never at a fixed time', () => {
  for (const day of [7, 8, 9, 10]) {
    const times = S.inviteSchedule(uid, at(12, 0, day));
    assert.equal(times.length, 3);
    for (const time of times) {
      const hour = new Date(time).getHours();
      assert.ok(hour >= S.INVITE_WINDOW_START_HOUR && hour < S.INVITE_WINDOW_END_HOUR, `slot outside window: ${new Date(time).toISOString()}`);
    }
    assert.deepEqual([...times].sort((a, b) => a - b), times, 'slots must be in order');
    // Not a cron: no slot may land on the top of the hour for every member every day.
    assert.ok(new Date(times[0]).getMinutes() + new Date(times[0]).getSeconds() > 0, 'first slot sits on a fixed clock time');
  }
});

test('the same member on the same day always gets the same three moments', () => {
  const first = S.inviteSchedule(uid, at(9));
  const second = S.inviteSchedule(uid, at(19, 30));
  assert.deepEqual(first, second, 'a reload or a second device must not reshuffle the day');
  const other = S.inviteSchedule('member-2', at(9));
  assert.notDeepEqual(first, other, 'two members must not be invited at the same moments');
  const tomorrow = S.inviteSchedule(uid, at(9, 0, 8));
  assert.notDeepEqual(first, tomorrow, 'every day looks the same — that is a fixed time');
});

test('who never sees an invitation', () => {
  const base = { uid, now: at(18) };
  assert.equal(S.evaluateInvite({ ...base, isPlus: true }).reason, 'plus');
  assert.equal(S.evaluateInvite({ ...base, onboarded: false }).reason, 'not-onboarded');
  assert.equal(S.evaluateInvite({ ...base, appActive: false }).reason, 'app-inactive');
  assert.equal(S.evaluateInvite({ ...base, uid: '' }).reason, 'no-uid');
  const schedule = S.inviteSchedule(uid, at(18));
  assert.equal(S.evaluateInvite({ ...base, now: at(6) }).reason, 'outside-window');
  assert.equal(S.evaluateInvite({ ...base, now: at(22, 30) }).reason, 'outside-window');
  assert.ok(schedule.length === 3);
});

test('three is the cap, and a missed slot is caught up on the next open', () => {
  const schedule = S.inviteSchedule(uid, at(18));
  const first = S.evaluateInvite({ uid, now: schedule[0] + 1000, exposures: [] });
  assert.equal(first.due, true);
  assert.equal(first.slot, 0);

  // Nothing shown yet, but it is already late afternoon: the most recent slot wins,
  // so a member who was away all day still gets the invitation when they return.
  const catchUp = S.evaluateInvite({ uid, now: schedule[2] + 60_000, exposures: [] });
  assert.equal(catchUp.due, true);
  assert.equal(catchUp.slot, 2);

  const three = [
    { slot: 0, at: schedule[0] },
    { slot: 1, at: schedule[1] },
    { slot: 2, at: schedule[2] },
  ];
  assert.equal(S.evaluateInvite({ uid, now: schedule[2] + 120_000, exposures: three }).reason, 'all-shown');
});

test('invitations never stack up back to back', () => {
  const schedule = S.inviteSchedule(uid, at(18));
  const shown = [{ slot: 0, at: schedule[0] }];
  const tooSoon = S.evaluateInvite({ uid, now: schedule[0] + 5 * 60_000, exposures: shown });
  assert.equal(tooSoon.due, false);
  assert.equal(tooSoon.reason, 'gap');
  // Gap satisfied but the second moment has not arrived yet: still no invitation.
  const stillEarly = S.evaluateInvite({ uid, now: schedule[0] + S.MIN_INVITE_GAP_MS + 1000, exposures: shown });
  assert.equal(stillEarly.due, false);
  assert.equal(stillEarly.reason, 'not-yet');
  // Once the member's second moment has passed, the next one opens.
  const second = S.evaluateInvite({ uid, now: Math.max(schedule[1], schedule[0] + S.MIN_INVITE_GAP_MS) + 1000, exposures: shown });
  assert.equal(second.due, true);
  assert.equal(second.slot, 1);
});

test('each exposure leads with a different benefit and says there is more', () => {
  const order = S.inviteFeatureOrder(uid, '2026-11-07');
  assert.equal(order.length, S.INVITE_FEATURES.length);
  assert.equal(new Set(order.map((entry) => entry.id)).size, order.length, 'feature order repeats a benefit');

  const schedule = S.inviteSchedule(uid, at(18));
  const seen = new Set();
  let exposures = [];
  for (const slot of [0, 1, 2]) {
    const decision = S.evaluateInvite({ uid, now: schedule[slot] + 1000, exposures });
    assert.equal(decision.due, true);
    assert.ok(!seen.has(decision.feature.id), `feature ${decision.feature.id} led twice in one day`);
    seen.add(decision.feature.id);
    assert.match(decision.moreLine, /more things you don't have yet/);
    exposures = [...exposures, { slot: decision.slot, at: schedule[slot] + 1000 }];
  }
});

test('the pitch is written from the member’s own brief', () => {
  const profile = {
    displayName: 'ariana mateo',
    buildingName: 'Kora',
    buildingOneLiner: 'payments for informal traders.',
    missingSeat: 'Backend engineer',
    lookingFor: ['Technical cofounder'],
  };
  const feature = S.INVITE_FEATURES[0];
  const copy = S.inviteCopy(profile, feature, S.INVITE_FEATURES.length - 1);
  assert.match(copy.headline, /^Ariana, are you ready to move beyond\?$/);
  assert.match(copy.subline, /building Kora/);
  assert.match(copy.subline, /backend engineer/i);
  assert.match(copy.subline, /This is one thing\. There is more\./);
  assert.equal(copy.personalised, true);
  assert.doesNotMatch(copy.subline, /[.]\./, 'copy must not leave doubled full stops');

  // Nobody's facts? Still no invented facts.
  const bare = S.inviteCopy({}, feature, 3);
  assert.equal(bare.headline, 'Are you ready to move beyond?');
  assert.doesNotMatch(bare.subline, /You told us/);
  assert.equal(bare.personalised, false);
});

test('email carries the same pitch, once, for free members only', async () => {
  const mailer = await import('../api/_emailNotify.js');
  const block = mailer.buildPlusInviteBlock({ firstName: 'Tana', building: 'LINKUP' });
  assert.match(block.text, /Tana, are you ready to move beyond\?/i);
  assert.match(block.text, /And \d+ more things you don't have yet/);
  assert.match(block.text, /plus=1/);
  assert.match(block.html, /LINKUP PLUS/);
  assert.ok(!/<img/i.test(block.html), 'the block must not add third-party images');

  // Stable per member per day, so a retry does not rotate the benefit mid-thread.
  assert.equal(mailer.plusFeatureForEmail('u1', '2026-11-07').id, mailer.plusFeatureForEmail('u1', '2026-11-07').id);
  assert.notEqual(
    new Set([1, 2, 3, 4, 5].map((n) => mailer.plusFeatureForEmail(`u${n}`, '2026-11-07').id)).size,
    1
  );

  const source = read('api/_emailNotify.js');
  assert.match(source, /memberHasPlus\(db, uid, userData/, 'the sender must check the entitlement');
  assert.match(source, /if \(!isPlus\) \{\s*plusInvite = buildPlusInviteBlock/, 'PLUS members must never be sold PLUS');
  // Order matters: the pitch sits below the main CTA, above the footer rule.
  const template = source.slice(source.indexOf('const htmlBody = `<!doctype html>'));
  const cta = template.indexOf('${esc(cleanCta)} &rarr;');
  const pitch = template.indexOf('plusInvite?.html');
  const footer = template.indexOf('Unsubscribe in one click');
  assert.ok(cta > 0 && pitch > cta && footer > pitch, 'the PLUS block must sit below the CTA and above the footer');
});
