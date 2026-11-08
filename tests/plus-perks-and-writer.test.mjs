// THE PAYWALL'S HONESTY, PINNED.
//
// The paywall now lists every paid feature there is, one line each, free number
// beside PLUS number. That only works if every claim is real, so these tests do
// three jobs: prove the list is complete and unchanging, prove each perk still
// points at a gate that exists in code, and prove Linky — the newest perk — is
// PLUS-gated on the server, writes from the member's own facts, and saves only
// the words the member approved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PLUS_PERKS, PLUS_PERK_COUNT, plusPerkById, plusPerksNotShown, paywallCopy } from '../shared/plus-perks.js';
import { BUDGET_DEFAULTS } from '../shared/linky-budget.js';
import {
  buildProfileWriterPrompt,
  profileWriterFacts,
  sanitizeProfileDraft,
  writeMyProfile,
} from '../api/_profileWriter.js';

const read = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

/* ------------------------- the list itself ------------------------- */

test('the paywall lists all ten paid features, each with a free number and a PLUS number', () => {
  assert.equal(PLUS_PERK_COUNT, 10);
  assert.equal(new Set(PLUS_PERKS.map((perk) => perk.id)).size, 10, 'a perk id is repeated');

  const ids = PLUS_PERKS.map((perk) => perk.id);
  for (const required of ['linky', 'meets', 'writer', 'warmIntro', 'viewers', 'recommendations', 'posts', 'turbo', 'noads', 'badge']) {
    assert.ok(ids.includes(required), `the paywall is missing ${required}`);
  }

  for (const perk of PLUS_PERKS) {
    for (const key of ['title', 'free', 'plus', 'line']) {
      assert.ok(String(perk[key] || '').length > 3, `${perk.id} has no ${key}`);
    }
    // Specificity, not adjectives: the free column must carry a number or a
    // concrete unit, because "limited" persuades nobody.
    assert.match(perk.free, /\d|no |all of it|the number only|standard|hidden|sponsored/i, `${perk.id} free column is vague`);
    assert.ok(!/revolutionary|game-chang|world-class|unlimited saved|themes/i.test(`${perk.title} ${perk.line}`), `${perk.id} sells an adjective or a retired claim`);
  }
});

test('every perk points at a gate that still exists in code', () => {
  // If a gate is deleted, its perk has to go with it — that is the rule that
  // stopped the paywall advertising "unlimited saved profiles" and "PLUS themes".
  const gates = {
    linky: ['shared/linky-budget.js', 'freePerDay'],
    meets: ['api/_linky.js', 'meetsPerDay'],
    writer: ['api/_profileWriter.js', 'PLUS only'],
    warmIntro: ['mobile/src/lib/paywall.ts', 'warmIntrosPerMonth'],
    viewers: ['mobile/src/screens/ViewersScreen.tsx', 'hasLinkupPro'],
    recommendations: ['mobile/src/screens/RecommendedMatchesScreen.tsx', 'FREE_LIMITS.weeklyRecommendations'],
    posts: ['mobile/src/screens/CreatePostScreen.tsx', 'WEEKLY_POST_LIMITS'],
    turbo: ['mobile/src/screens/RecommendedMatchesScreen.tsx', 'turboConnect ? 8 : 0'],
    noads: ['mobile/src/lib/campaigns.ts', 'isSponsoredHiddenForViewer'],
    badge: ['mobile/src/lib/paywall.ts', "verificationProgram: 'LINKUP PLUS'"],
  };
  for (const perk of PLUS_PERKS) {
    const [file, marker] = gates[perk.id];
    assert.ok(read(file).includes(marker), `${perk.id}: ${file} no longer contains "${marker}"`);
  }
});

test('the retired claims are gone from every surface', () => {
  const surfaces = [
    'mobile/src/components/PaywallModal.tsx',
    'shared/plus-perks.js',
    'mobile/src/lib/plusInviteSchedule.ts',
    'api/_emailNotify.js',
  ];
  for (const file of surfaces) {
    // Comments are allowed to explain what was removed; the copy is not.
    const copy = read(file)
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    assert.ok(!/unlimited saved profiles/i.test(copy), `${file} still sells unlimited saved profiles`);
    assert.ok(!/PLUS (app )?themes/i.test(copy), `${file} still sells PLUS themes`);
  }
});

test('the "and N more" number is derived, never hand-counted', () => {
  assert.equal(plusPerksNotShown(['viewers']), 9);
  assert.equal(plusPerksNotShown(PLUS_PERKS.map((perk) => perk.id)), 0);
  const schedule = read('mobile/src/lib/plusInviteSchedule.ts');
  assert.match(schedule, /export const INVITE_MORE_COUNT = Math\.max\(0, PLUS_PERKS\.length - 1\)/);
  assert.match(schedule, /INVITE_FEATURES: InviteFeature\[\] = PLUS_PERKS\.map/);
  assert.ok(!/INVITE_FEATURES\.length - 1/.test(schedule), 'the invite still counts its own list');
});

test('the paywall speaks to one member, by name and by project', () => {
  const copy = paywallCopy({
    displayName: 'Tariro Moyo',
    buildingName: 'LINKUP',
    missingSeat: 'Technical cofounder',
  });
  assert.match(copy.headline, /Tariro/);
  assert.match(copy.subline, /LINKUP/);
  assert.match(copy.subline, /technical cofounder/i);
  // The loss is stated in numbers, not adjectives.
  assert.match(copy.subline, /4 Linky messages/);
  assert.match(copy.subline, /3 recommendations/);
  assert.equal(copy.personalised, true);

  const bare = paywallCopy({});
  assert.equal(bare.headline, 'This is everything LINKUP can do');
  assert.equal(bare.personalised, false);
});

/* ------------------------- four messages a day ------------------------- */

test('Linky stops at four messages a day, then the paywall', () => {
  assert.equal(BUDGET_DEFAULTS.freePerDay, 4);
  assert.equal(BUDGET_DEFAULTS.freeDaily, 4);
  assert.equal(BUDGET_DEFAULTS.plusPerDay, null);
  assert.equal(BUDGET_DEFAULTS.plusUnlimited, true);

  // The app surfaces the limit with the paywall already wired to it.
  const screen = read('mobile/src/screens/LinkyHomeScreen.tsx');
  assert.match(screen, /setPaywall\(err\.message\)/);
  assert.match(screen, /<PaywallModal/);
});

/* --------------------- Linky already knows the member --------------------- */

test('Linky is told what the member is building, and forbidden to ask again', async () => {
  const linky = read('api/_linky.js');
  assert.match(linky, /export const LINKY_KNOWS_PROFILE =/);
  assert.match(linky, /NEVER ask what they are building/);
  // The chat prompt carries the rule and the richer dossier.
  assert.match(linky, /LINKY_KNOWS_PROFILE,\n/);
  assert.match(linky, /building: text\(me\?\.building, 60\)/);
  assert.match(linky, /seat: text\(me\?\.seat, 60\)/);

  const facts = (await import('../api/_linky.js')).profileFacts;
  if (!facts) return; // module needs firebase-admin creds in some environments
  const built = facts({
    uid: 'u1',
    displayName: 'Tariro Moyo',
    buildingName: 'LINKUP',
    buildingOneLiner: 'a place where founders find the person who fills the empty seat',
    missingSeat: 'Technical cofounder',
    startupStage: 'MVP',
    lookingFor: ['Technical Cofounder'],
    skills: ['TypeScript'],
  });
  assert.equal(built.building, 'LINKUP');
  assert.match(built.buildingOneLiner, /empty seat/);
  assert.equal(built.seat, 'Technical cofounder');
  assert.equal(built.stage, 'MVP');
});

/* ------------------------ Linky writes the profile ------------------------ */

const MEMBER = {
  uid: 'u1',
  displayName: 'Tariro Moyo',
  occupation: 'Product engineer',
  buildingName: 'LINKUP',
  buildingOneLiner: 'a place where founders find the person who fills the empty seat',
  missingSeat: 'Technical cofounder',
  startupStage: 'MVP',
  city: 'Harare',
  country: 'Zimbabwe',
  skills: ['TypeScript', 'Postgres'],
  lookingFor: ['Technical Cofounder'],
};

test('the writer prompt is built from the member\'s own facts and says "invent nothing"', () => {
  const prompt = buildProfileWriterPrompt(MEMBER);
  assert.match(prompt, /invent nothing/i);
  assert.match(prompt, /LINKUP/);
  assert.match(prompt, /Technical cofounder/);
  assert.match(prompt, /Return STRICT JSON/);

  const facts = profileWriterFacts(MEMBER);
  assert.equal(facts.building, 'LINKUP');
  assert.equal(facts.seat, 'Technical cofounder');

  // A member with nothing on file produces no prompt worth sending.
  const empty = profileWriterFacts({});
  assert.equal(empty.building, '');
  assert.equal(empty.bio, '');
});

test('a draft that invents or says nothing is rejected, never saved over good data', () => {
  const empty = sanitizeProfileDraft({ headline: '', bio: '' }, MEMBER);
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'empty_draft');

  const ok = sanitizeProfileDraft({
    headline: 'Building LINKUP — the place where founders find the person who fills the empty seat',
    bio: 'I build settlement rails for African merchants and I am now building LINKUP, a network where founders meet the person who fills the empty seat. I need a technical cofounder who has shipped payments.',
    // A banned adjective is stripped, not saved.
    skills: ['Postgres', 'revolutionary growth'],
    lookingFor: ['Technical cofounder'],
  }, MEMBER);
  assert.equal(ok.ok, true);
  assert.ok(!/revolutionary/i.test(ok.draft.skills.join(' ')), 'a marketing adjective survived');
  assert.ok(ok.draft.headline.length <= 90);
  assert.ok(ok.draft.bio.length <= 600);

  // A rewrite can never wipe the skills the member typed themselves.
  const noSkills = sanitizeProfileDraft({ headline: 'Building LINKUP for founders who need a technical partner', bio: 'Short but real.' }, MEMBER);
  assert.deepEqual(noSkills.draft.skills, MEMBER.skills);
});

test('saving writes four profile fields and nothing else', async () => {
  const writes = [];
  const db = {
    collection: () => ({
      doc: () => ({
        set: async (data, options) => { writes.push({ data, options }); },
      }),
    }),
  };

  const result = await writeMyProfile({
    uid: 'u1',
    profile: MEMBER,
    save: true,
    db,
    now: 1700000000000,
    text: async () => ({
      text: JSON.stringify({
        headline: 'Building LINKUP, where founders find the person who fills the empty seat',
        bio: 'I build settlement rails for African merchants. Now I am building LINKUP so founders can meet the person who fills their empty seat, and I need a technical cofounder who has shipped payments.',
        skills: ['TypeScript', 'Postgres'],
        lookingFor: ['Technical cofounder'],
      }),
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0].data).sort(), ['bio', 'headline', 'lookingFor', 'profileWrittenByLinkyAt', 'skills']);
  assert.equal(writes[0].options.merge, true, 'a rewrite must merge, never replace the member document');
  assert.ok(!('plan' in writes[0].data) && !('isPro' in writes[0].data), 'the writer touched entitlement fields');
});

test('an approved draft is saved as approved, without a second model call', async () => {
  const writes = [];
  const db = { collection: () => ({ doc: () => ({ set: async (data) => writes.push(data) }) }) };
  let calls = 0;

  const result = await writeMyProfile({
    uid: 'u1',
    profile: MEMBER,
    save: true,
    db,
    approved: {
      headline: 'Founder building LINKUP for people who need a technical partner',
      bio: 'I ship payment rails, and now I am building LINKUP so founders meet the person who fills the empty seat. I am looking for a technical cofounder to build it with me.',
      skills: ['TypeScript'],
      lookingFor: ['Technical cofounder'],
    },
    text: async () => { calls += 1; return { text: '{}' }; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved, true);
  assert.equal(calls, 0, 'saving an approved draft must not spend another model call');
  assert.equal(writes[0].headline, 'Founder building LINKUP for people who need a technical partner');
  assert.match(writes[0].bio, /payment rails/);
});

test('the server refuses to write for a member with nothing on file, and for a non-PLUS caller', () => {
  const linky = read('api/linky.js');
  // PLUS gate on the server, not in the button.
  assert.match(linky, /case 'writeProfile': \{/);
  assert.match(linky, /if \(!\(await isPlusUser\(uid, me\)\)\) \{\s*\n\s*sendError\(res, 402/);
  assert.match(linky, /Linky writes your profile on LINKUP PLUS/);

  const writer = read('api/_profileWriter.js');
  assert.match(writer, /reason: 'nothing_to_write_from'/);

  // And the app opens the paywall on a 402 rather than showing an error toast.
  const component = read('mobile/src/components/LinkyWritesProfile.tsx');
  assert.match(component, /status === 402\) onUpgrade\(\)/);
  assert.match(component, /what is saved is exactly\s+\*\s+the words on screen/);
});

test('the member approves the words before anything is saved', () => {
  const component = read('mobile/src/components/LinkyWritesProfile.tsx');
  // Draft first, save second, and the save sends the draft back.
  assert.match(component, /writeMyProfileWithLinky\(\{ save: false \}\)/);
  assert.match(component, /writeMyProfileWithLinky\(\{ save: true, draft \}\)/);
  assert.match(component, /Read it before it goes live/);
  assert.match(component, /Save this to my profile/);
  assert.match(component, /Discard/);
});

test('the writer is mounted in the profile editor and behind PLUS', () => {
  const screen = read('mobile/src/screens/ProfileScreen.tsx');
  assert.match(screen, /import LinkyWritesProfile from '\.\.\/components\/LinkyWritesProfile'/);
  assert.match(screen, /<LinkyWritesProfile/);
  assert.match(screen, /isPlus=\{hasLinkupPro\(myProfile\)\}/);
  assert.match(screen, /onUpgrade=\{\(\) => openPaywall\('Linky writes your profile'\)\}/);
});

/* ------------------------ the ask on the home page ------------------------ */

test('the home page opens with one gold button that leads to the paywall', () => {
  const screen = read('mobile/src/screens/DiscoveryDashboardScreen.tsx');
  assert.match(screen, /testID="home-upgrade-cta"/);
  assert.match(screen, /UPGRADE TO LINKUP PLUS/);
  assert.match(screen, /things you are not getting yet · from \$19\.99\/mo/);
  assert.match(screen, /onPress=\{\(\) => setUpgradeOpen\(true\)\}/);
  assert.match(screen, /visible=\{upgradeOpen\}/);
  // Never shown to somebody who already pays.
  assert.match(screen, /\{!isPlusMember \? \(/);
  // It sits above the greeting, not buried under the weekly match.
  const cta = screen.indexOf('home-upgrade-cta');
  const hero = screen.indexOf('<HomeHero');
  assert.ok(cta > 0 && hero > cta, 'the upgrade bar must render before the hero copy');
});
