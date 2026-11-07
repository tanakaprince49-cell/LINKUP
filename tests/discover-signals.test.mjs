// Feature #4 (profile strength) and #5 (anonymous demand) on Discover, plus the
// campaign-manager entry point it shares the page with.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { profileStrength, PROFILE_STRENGTH_FIELDS } from '../shared/profile-strength.js';
import { demandSignal } from '../shared/demand-signal.js';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const FACTS_FULL = {
  profilePic: 'https://cdn.example/tanaka.png',
  occupation: 'Product Engineer',
  city: 'Harare',
  country: 'Zimbabwe',
  skills: ['React Native', 'Postgres', 'Product'],
  lookingFor: ['Technical Co-Founder', 'Design'],
  goals: 'Ship the co-founder matching engine to 1,000 builders and watch which pairs actually start companies together.',
  projects: [{ title: 'LINKUP', link: 'https://linkupbuild.com' }],
};

test('profile strength weights the edits that change a match, and names only the next one', () => {
  const full = profileStrength(FACTS_FULL);
  assert.equal(full.percent, 100);
  assert.equal(full.label, 'Sharp');
  assert.equal(full.next, null);

  const empty = profileStrength({});
  assert.equal(empty.percent, 0);
  assert.equal(empty.next.key, 'project', 'the highest-leverage gap comes first');
  assert.equal(empty.missing.length, PROFILE_STRENGTH_FIELDS.length);

  // Two skills read as a guess, three as a person: the threshold is deliberate.
  const twoSkills = profileStrength({ ...FACTS_FULL, skills: ['React Native', 'Postgres'] });
  assert.ok(twoSkills.missing.some((field) => field.key === 'skills'));
  assert.equal(profileStrength({ ...FACTS_FULL, skills: ['a', '', null] }).missing.some((f) => f.key === 'skills'), true);

  // A project without a link is not a project: the matcher needs something to read.
  const noLink = profileStrength({ ...FACTS_FULL, projects: [{ title: 'LINKUP' }] });
  assert.equal(noLink.percent, 80);
  assert.equal(noLink.next.key, 'project');

  // Every ask explains itself — no unexplained homework.
  for (const field of PROFILE_STRENGTH_FIELDS) {
    assert.ok(field.why.length > 40, field.key + ' must say why it matters');
    assert.ok(field.cta.length > 3, field.key + ' needs a verb');
    assert.ok(field.weight > 0);
  }
  assert.equal(PROFILE_STRENGTH_FIELDS.reduce((sum, field) => sum + field.weight, 0), 100);
  for (const value of [null, undefined]) assert.equal(profileStrength(value).percent, 0);
});

test('demand counts people who need what you do — and refuses to invent a number from a tiny pool', () => {
  const me = {
    uid: 'tanaka',
    occupation: 'Product Engineer',
    country: 'Zimbabwe',
    skills: ['React Native', 'Product Management'],
    industries: ['Fintech'],
  };
  const people = [
    { uid: 'a', lookingFor: ['React Native dev'], country: 'Zimbabwe', industries: ['Fintech'] },
    { uid: 'b', projects: [{ lookingFor: ['product management'] }], country: 'Kenya', industries: ['Fintech'] },
    { uid: 'c', lookingFor: ['Growth'], country: 'Zimbabwe' },
    { uid: 'd', lookingFor: ['react'], country: 'Zimbabwe' },
  ];

  const signal = demandSignal(me, people);
  assert.equal(signal.searching, 3, 'only the three who need his capabilities');
  assert.equal(signal.matchedOnPaper, 3);
  assert.equal(signal.topNeed, 'React Native');
  assert.equal(signal.poolSize, 4);

  // Aggregate only: nothing that identifies a person can leak out of this.
  assert.deepEqual(Object.keys(signal).sort(), ['matchedOnPaper', 'poolSize', 'searching', 'topNeed']);
  assert.doesNotMatch(JSON.stringify(signal), /"uid"|@/);

  // A lonely "1" reads as failure, not demand.
  assert.equal(demandSignal(me, people.slice(0, 2)), null);
  assert.equal(demandSignal(me, [{ uid: 'c', lookingFor: ['Growth'] }, people[2], people[2]].map((p, i) => ({ ...p, uid: 'x' + i }))).searching, 0);
  assert.equal(demandSignal(null, people), null);
  assert.equal(demandSignal({ uid: 'me' }, people), null, 'no capabilities means nothing to count against');
  assert.equal(demandSignal(me, []), null);
  // The viewer is never counted as their own demand.
  assert.equal(demandSignal(me, [{ ...people[0], uid: 'tanaka', lookingFor: ['React Native'] }, ...people])?.searching, 3);
});

test('both sections are wired into Discover, below this week’s introduction', () => {
  const dashboard = read('mobile/src/screens/DiscoveryDashboardScreen.tsx');
  const strength = read('mobile/src/components/ProfileStrengthCard.tsx');
  const demand = read('mobile/src/components/DemandStrip.tsx');

  // Placement: after the weekly card / empty state, inside the page scroll.
  const weekly = dashboard.indexOf('<WeeklyCofounderCard match={weeklyMatch} />');
  const strengthAt = dashboard.indexOf('<ProfileStrengthCard');
  const demandAt = dashboard.indexOf('<DemandStrip');
  assert.ok(weekly > 0 && strengthAt > weekly, 'profile strength comes after the introduction');
  assert.ok(strengthAt < demandAt, 'strength above demand');
  assert.ok(demandAt < dashboard.indexOf('</ScrollView>'));

  // #4 — one number, one next edit, one tap to fix it.
  assert.match(strength, /export default function ProfileStrengthCard/);
  assert.match(strength, /testID="profile-strength"/);
  assert.match(strength, /testID="profile-strength-percent"/);
  assert.match(strength, /testID="profile-strength-next"/);
  assert.match(strength, /onFix\(next\.key\)/);
  assert.match(strength, /if \(!next\) return null;/);

  // #5 — counts only, and the promise is restated so it cannot be misread.
  assert.match(demand, /export default function DemandStrip/);
  assert.match(demand, /testID="demand-strip"/);
  assert.match(demand, /Counts only\. One introduction a week stays the rule\./);
  assert.match(demand, /onOpenLinky/);
  assert.doesNotMatch(demand, /profilePic|displayName|uid=/);
});

test('the campaign manager URL signs a visitor in and then opens the manager, never the landing page', () => {
  const app = read('mobile/App.tsx');
  assert.match(app, /const CAMPAIGN_MANAGER_PATHS = \['\/campaigns', '\/campaign-manager'\];/);
  assert.match(app, /const isCampaignManagerPath = /);
  // Signed out: ask for a sign-in instead of bouncing to the pitch.
  assert.match(app, /if \(isCampaignManagerPath\(\)\) \{[\s\S]{0,200}navigate\('EmailAuth'\)/);
  // Signed in: land on the manager even when the router never parsed the path.
  assert.match(app, /campaignIntentRef/);
  assert.match(app, /history\?\.replaceState\?\.\(null, '', webAppPath\('\/campaign-manager'\)\)/);
  assert.match(app, /getCurrentRoute\(\)\?\.name !== 'Campaigns'/);
  // The marketing redirect still points at the manager.
  for (const file of ['vercel.json', 'mobile/vercel.json']) {
    const cfg = JSON.parse(read(file));
    const redirect = cfg.redirects.find((entry) => entry.source === '/campaigns');
    assert.equal(redirect.destination, '/app/campaign-manager');
  }
});
