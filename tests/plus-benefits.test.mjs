// The paywall has to sell every lever PLUS actually pulls — and only those.
//
// Three surfaces say the same ten things: the paywall modal, the three-a-day
// invitation, and the block at the bottom of every email. They used to keep
// three separate lists, which is how "the PLUS themes" survived on a paywall for
// a theme picker that has no tier check. Now there is one list, and this file
// fails if any surface drifts from it — or if a claim stops matching the code
// that enforces the limit it brags about.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  PLUS_BENEFITS,
  PLUS_BENEFIT_COUNT,
  PLUS_MORE_COUNT,
  PLUS_BENEFIT_GROUPS,
  plusBenefitGroups,
} from '../shared/plus-benefits.js';

const read = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const paywall = read('mobile/src/components/PaywallModal.tsx');
const schedule = read('mobile/src/lib/plusInviteSchedule.ts');
const mailer = read('api/_emailNotify.js');
const byId = (id) => {
  const found = PLUS_BENEFITS.find((entry) => entry.id === id);
  assert.ok(found, `benefit ${id} exists`);
  return found;
};

test('ten levers, grouped so a scroll has rhythm', () => {
  assert.equal(PLUS_BENEFIT_COUNT, 10, 'PLUS has ten sellable levers today');
  assert.equal(PLUS_MORE_COUNT, 9, '"and 9 more" — one is already on screen');
  const groups = plusBenefitGroups();
  assert.equal(groups.length, 3);
  for (const group of groups) {
    assert.ok(group.label && group.label.length > 4, `group ${group.id} has a label`);
    assert.ok(group.items.length >= 2, `group ${group.id} is not a group of one`);
    for (const key of Object.keys(group.items.reduce((acc, item) => ({ ...acc, [item.group]: 1 }), {}))) {
      assert.ok(PLUS_BENEFIT_GROUPS[key], `${key} is a known group`);
    }
  }
  // No benefit may appear twice, and none may be orphaned by a missing group.
  assert.equal(new Set(PLUS_BENEFITS.map((entry) => entry.id)).size, PLUS_BENEFIT_COUNT);
  assert.equal(PLUS_BENEFITS.reduce((sum, entry) => sum + entry.group.length, 0) > 0, true);
});

test('every lever has a claim and a proof, and the proof is a number or a surface', () => {
  for (const benefit of PLUS_BENEFITS) {
    assert.ok(benefit.title.length > 12, `${benefit.id} has a real title`);
    assert.ok(benefit.proof.length > 30, `${benefit.id} has a proof, not a slogan`);
    const concrete = /\d/.test(benefit.proof) || /free|Free|lock|anywhere|everywhere|email/i.test(benefit.proof);
    assert.ok(concrete, `${benefit.id} proof cites a number or a surface: "${benefit.proof}"`);
    assert.ok(benefit.invite.feature && benefit.invite.line, `${benefit.id} has invite copy`);
    assert.ok(benefit.email.feature && benefit.email.line, `${benefit.id} has email copy`);
  }
});

test('the numbers in the copy are the numbers in the code', () => {
  // Recommendations: 3 a week on free.
  assert.match(byId('recommendations').proof, /3 recommendations a week/);
  assert.match(read('mobile/src/lib/paywall.ts'), /weeklyRecommendations: 3/);

  // Posting: 1 a week free, 10 a week PLUS.
  assert.match(byId('posts').title, /10 startups a week instead of 1/);
  assert.match(read('mobile/src/screens/CreatePostScreen.tsx'), /free: 1, plus: 10/);

  // Linky: 4 messages a UTC day.
  assert.match(byId('linky').proof, /4 a day/);
  assert.match(read('shared/linky-budget.js'), /freePerDay: 4/);

  // Meet requests: 2 a day.
  assert.match(byId('meets').proof, /2 a day/);
  assert.match(read('api/_linky.js'), /meetsPerDay: 2/);

  // Turbo Connect: +8 in the ranking.
  assert.match(byId('turbo').proof, /\+8/);
  assert.match(read('mobile/src/screens/RecommendedMatchesScreen.tsx'), /turboConnect \? 8 : 0/);

  // Warm intro: one a month.
  assert.match(byId('warmintro').proof, /One a month/);
  assert.match(read('mobile/src/lib/paywall.ts'), /warmIntrosPerMonth: 1/);

  // Viewers: the analytics surface is four tabs.
  assert.match(byId('viewers').proof, /four analytics tabs/);
  assert.equal((read('mobile/src/screens/ViewersScreen.tsx').match(/^  (views|clicks|saves|response): \{/gm) || []).length, 4);
});

test('nothing is sold that the code does not gate', () => {
  // The three lines that used to be lies: free-forever ideas, the free theme
  // picker, and saves, which no code path caps.
  const allCopy = PLUS_BENEFITS.map((entry) => `${entry.title} ${entry.proof} ${entry.invite.feature}`).join(' ').toLowerCase();
  assert.ok(!/idea deck|swipe/i.test(allCopy), 'the idea deck is free forever — it is not a PLUS perk');
  assert.ok(!/theme|palette|app colour/i.test(allCopy), 'the App colour picker has no tier check, so it is not a PLUS perk');
  assert.ok(!/saved profile|saves/i.test(allCopy), 'nothing enforces a save cap, so "unlimited saves" is not a perk');
  assert.ok(!/advanced search|saved search/i.test(allCopy), 'advanced search lives on the web and is not gated here');
  // And the old strings are gone from the surfaces themselves.
  assert.ok(!/PLUS app themes/i.test(paywall + schedule + mailer));
  assert.ok(!/Unlimited saved profiles/i.test(paywall));
});

test('the paywall renders the shared list, in groups, with the real count', () => {
  assert.match(paywall, /import \{ PLUS_BENEFIT_COUNT, PLUS_MORE_COUNT, plusBenefitGroups/, 'the modal imports the canonical list');
  assert.match(paywall, /const BENEFIT_GROUPS = plusBenefitGroups\(\)/);
  assert.match(paywall, /\{PLUS_BENEFIT_COUNT\} LEVERS/, 'the badge is the count, not a hand-typed number');
  assert.match(paywall, /\{BENEFIT_GROUPS\.map\(/, 'every group is rendered');
  assert.match(paywall, /\{benefit\.title\}/);
  assert.match(paywall, /\{benefit\.proof\}/);
  assert.ok(!/const PRO_PERKS/.test(paywall), 'no local copy of the list');
  // Every benefit must have an icon, or the list renders ten identical ticks.
  const iconMap = paywall.slice(paywall.indexOf('const BENEFIT_ICONS'), paywall.indexOf('const PRICING_PLANS'));
  for (const benefit of PLUS_BENEFITS) {
    assert.match(iconMap, new RegExp(`${benefit.id}:`), `benefit ${benefit.id} has an icon`);
  }
});

test('the invitation carries the same ten, and still says there is more', () => {
  const ids = [...schedule.matchAll(/^    id: '([a-z]+)',$/gm)].map((match) => match[1]);
  assert.deepEqual([...ids].sort(), PLUS_BENEFITS.map((entry) => entry.id).sort(), 'invite schedule and paywall agree');
  assert.match(schedule, /INVITE_FEATURES\.length - 1|moreCount/, 'the more-count is derived');
});

test('the email carries the same ten and counts nine more', async () => {
  const emailIds = [...mailer.matchAll(/id: benefit\.id/g)];
  assert.ok(emailIds.length === 1, 'the email list is built from the shared one, not retyped');
  assert.match(mailer, /const PLUS_EMAIL_FEATURES = PLUS_BENEFITS\.map/);
  const mod = await import('../api/_emailNotify.js');
  assert.equal(mod.PLUS_EMAIL_MORE_COUNT, 9, 'email says "and 9 more things"');
  const block = mod.buildPlusInviteBlock({ firstName: 'Tariro', building: 'LINKUP', featured: mod.plusFeatureForEmail('u1', '2026-11-07') });
  assert.match(block.text, /And 9 more things you don't have yet/);
  assert.match(block.text, /plus=1/, 'and every block links straight to the wall');
});
