// The weekly introduction has to explain itself properly: why this person, what
// each founder actually brings, and what happens in the first twenty minutes.
// These tests pin the deep dossier, its grounding, and its "never blank, never
// invented" fallbacks — plus the crowned portrait that introduces it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildEngineDossier,
  dossierForViewer,
  generateAiCofounderNarrative,
  getOrAssignWeeklyCofounder,
} from '../api/_weeklyCofounder.js';
import { cofounderWeekWindow } from '../shared/linkup-match.js';

const root = process.cwd();

const A = {
  uid: 'tariro',
  displayName: 'Tariro Moyo',
  occupation: 'AI & Backend Engineer',
  city: 'Harare',
  country: 'Zimbabwe',
  skills: ['TypeScript', 'Python', 'Postgres', 'Payments'],
  industries: ['Fintech'],
  lookingFor: ['Growth & GTM Co-Founder'],
  goals: 'Launch self-serve onboarding for African SMEs.',
  startupStage: 'MVP',
  projects: [{ title: 'PayPulse', description: 'Instant merchant settlement', lookingFor: ['Growth'] }],
};
const B = {
  uid: 'kuda',
  displayName: 'Kuda Chipo',
  occupation: 'Growth & GTM Lead',
  city: 'Harare',
  country: 'Zimbabwe',
  skills: ['Growth', 'Sales', 'Distribution'],
  industries: ['Fintech'],
  lookingFor: ['Technical Co-Founder', 'Backend Engineer'],
  goals: 'Partner with a backend engineer to scale merchant payments.',
  startupStage: 'MVP',
  projects: [],
};

const pair = {
  uidA: A.uid,
  uidB: B.uid,
  profileA: A,
  profileB: B,
  aOffers: ['AI & Backend Engineering', 'Payments rails'],
  bOffers: ['Growth & GTM', 'B2B distribution'],
  sharedDomains: ['Fintech', 'SME payments'],
  cardForA: { why: { shared: 'You both work on SME payment rails.', complement: 'Kuda sells what you build.' } },
  cardForB: { why: { shared: 'You both work on SME payment rails.', complement: 'Tariro builds what you sell.' } },
  firstSprintTask: 'Sketch the self-serve signup flow and name three merchants to test it with.',
  band: { id: 'strong', min: 0.7, label: 'Strong fit', line: 'Both of you are looking for this' },
};

const deepJson = JSON.stringify({
  headline: 'Builder of rails × seller of rails',
  whyChosenForA:
    'You built settlement rails for African merchants; Kuda has spent years putting fintech products in front of those same merchants. The algorithm paired you because the gap in your profile — distribution — is the exact thing Kuda has already done twice. You get a commercial co-founder who does not need to be taught the market. The friction is real: you will disagree about how fast to sell before the product is ready. This week matters because you are both pre-revenue and both said "all in".',
  whyChosenForB:
    'You can sell payments to merchants all day; you cannot build the rails you are selling. Tariro can. The pair was triggered by your stated need for a backend engineer and their stated need for growth. The risk is that you outrun the build. This week matters because self-serve onboarding is the unlock you both described.',
  whatABrings: [
    { skill: 'Payments rails', unlocks: 'lets you promise instant settlement without hiring an engineering team' },
    { skill: 'Postgres & backend', unlocks: 'turns your merchant wishlist into a working pilot in weeks' },
    { skill: 'AI invoicing', unlocks: 'gives you a second product to sell to the same merchants' },
  ],
  whatBBrings: [
    { skill: 'B2B distribution', unlocks: 'puts the product in front of fifty merchants before you finish the beta' },
    { skill: 'Sales motion', unlocks: 'tells you which feature to build next, from live deals' },
    { skill: 'Partnerships', unlocks: 'opens the aggregators you cannot reach alone' },
  ],
  sharedGround: ['Fintech', 'SME payments', 'Harare', 'Pre-revenue, all in'],
  firstSprint: 'Draft the self-serve signup screen together and pick three merchants to test it with.',
});

test('the engine dossier is complete, grounded and never blank when the model is unavailable', async () => {
  const dossier = buildEngineDossier(pair);
  assert.equal(dossier.source, 'engine');
  assert.ok(dossier.headline.length > 3);
  assert.match(dossier.whyChosenForA, /SME payment rails/);
  assert.match(dossier.whyChosenForB, /SME payment rails/);
  assert.equal(dossier.whatABrings.length, 3);
  assert.equal(dossier.whatBBrings.length, 3);
  for (const entry of [...dossier.whatABrings, ...dossier.whatBBrings]) {
    assert.ok(entry.skill.length > 2, 'every contribution names a capability');
    assert.ok(entry.unlocks.length > 10, 'every contribution says what it unlocks for the other founder');
  }
  assert.ok(dossier.sharedGround.includes('Fintech'));
  assert.ok(dossier.firstSprint.length > 20);
  // No invented metrics, no horoscope language.
  assert.doesNotMatch(JSON.stringify(dossier), /soulmate|vibes|%|guaranteed/i);

  const narrative = await generateAiCofounderNarrative(pair, { aiText: null });
  assert.equal(narrative.source, 'engine');
  assert.ok(narrative.aiDossier.whyChosenForA.length > 40);
  assert.ok(narrative.aiWhyForA.length > 40);
});

test('the AI dossier is used when it is grounded, and its prose is long enough to be a real reason', async () => {
  const prompts = [];
  const narrative = await generateAiCofounderNarrative(pair, {
    aiText: async (prompt, options) => {
      prompts.push({ prompt, options });
      return deepJson;
    },
  });
  assert.equal(narrative.source, 'ai+engine');
  assert.equal(narrative.aiDossier.headline, 'Builder of rails × seller of rails');
  // Six sentences, not two lines.
  assert.ok(narrative.aiDossier.whyChosenForA.split(/\.\s/).length >= 4);
  assert.match(narrative.aiDossier.whyChosenForA, /Kuda/);
  assert.match(narrative.aiDossier.whyChosenForB, /Tariro/);
  assert.equal(narrative.aiDossier.whatABrings.length, 3);
  assert.equal(narrative.aiDossier.whatABrings[0].skill, 'Payments rails');
  assert.match(narrative.aiDossier.whatABrings[0].unlocks, /instant settlement/);
  assert.deepEqual(narrative.aiDossier.sharedGround.slice(0, 2), ['Fintech', 'SME payments']);
  assert.ok(narrative.aiDossier.firstSprint.length > 20);
  assert.equal(narrative.aiFirstSprint, narrative.aiDossier.firstSprint);

  const [{ prompt, options }] = prompts;
  // The prompt has to demand depth and grounding, not a caption.
  assert.match(prompt, /4 to 6 sentences/);
  assert.match(prompt, /Never invent employers, degrees, funding/);
  assert.match(prompt, /honest risk/);
  assert.match(prompt, /why this week/);
  assert.match(prompt, /whatABrings/);
  assert.match(prompt, /sharedGround/);
  // The facts the model is allowed to use are in the prompt; scores are not.
  assert.match(prompt, /Tariro Moyo/);
  assert.match(prompt, /Kuda Chipo/);
  assert.match(prompt, /SME payments/);
  assert.equal(options.responseMimeType, 'application/json');
  assert.ok(options.maxOutputTokens >= 1000, 'a six-sentence dossier needs room');
});

test('a broken or empty model answer falls back to the engine dossier instead of a half-written card', async () => {
  for (const answer of ['not json at all', '{"headline":"x"}', '']) {
    const narrative = await generateAiCofounderNarrative(pair, { aiText: async () => answer });
    assert.ok(narrative.aiDossier, 'a dossier always exists');
    assert.ok(narrative.aiDossier.whyChosenForA.length > 40);
    assert.equal(narrative.aiDossier.whatABrings.length, 3);
  }
  const thrown = await generateAiCofounderNarrative(pair, {
    aiText: async () => {
      throw new Error('model down');
    },
  });
  assert.equal(thrown.source, 'engine');
  assert.ok(thrown.aiDossier.firstSprint.length > 10);
});

test('each founder reads their own side of the dossier, and the viewer never sees the score', () => {
  const stored = {
    aiDossier: {
      headline: 'Builder of rails × seller of rails',
      whyChosenForA: 'You get distribution.',
      whyChosenForB: 'You get rails.',
      whatABrings: [{ skill: 'Payments rails', unlocks: 'ship settlement' }],
      whatBBrings: [{ skill: 'B2B distribution', unlocks: 'fifty merchants' }],
      sharedGround: ['Fintech'],
      firstSprint: 'Draft the signup screen.',
      source: 'ai+engine',
    },
    aOffers: ['Payments rails'],
    bOffers: ['B2B distribution'],
  };
  const asA = dossierForViewer(stored, true, '');
  const asB = dossierForViewer(stored, false, '');

  assert.equal(asA.whyChosen, 'You get distribution.');
  assert.equal(asB.whyChosen, 'You get rails.');
  // What the partner brings you is the mirror of what you bring them.
  assert.equal(asA.partnerBrings[0].skill, 'B2B distribution');
  assert.equal(asA.youBring[0].skill, 'Payments rails');
  assert.equal(asB.partnerBrings[0].skill, 'Payments rails');
  assert.equal(asB.youBring[0].skill, 'B2B distribution');
  assert.equal(asA.firstSprint, 'Draft the signup screen.');
  assert.doesNotMatch(JSON.stringify(asA), /"score"|"\d{2}%"/);
});

test('a pair locked before the dossier existed still renders a full read, and the deep version is written back', async () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const window = cofounderWeekWindow(now);
  const store = new Map();
  const ref = (col, id) => ({
    id,
    async get() {
      const value = store.get(`${col}/${id}`);
      return { id, exists: value !== undefined, data: () => (value === undefined ? undefined : structuredClone(value)) };
    },
    async set(data, opts = {}) {
      const key = `${col}/${id}`;
      store.set(key, opts?.merge && store.has(key) ? { ...store.get(key), ...structuredClone(data) } : structuredClone(data));
    },
  });
  const db = { collection: (col) => ({ doc: (id) => ref(col, id) }) };

  // A pair committed by an older build: thin copy, no dossier, emails already sent.
  const pairDocId = `${window.key}_abe01`;
  store.set(`weeklyCofounderMatches/${pairDocId}`, {
    pairId: 'abe01',
    pairDocId,
    weekKey: window.key,
    uidA: A.uid,
    uidB: B.uid,
    profileA: A,
    profileB: B,
    aOffers: pair.aOffers,
    bOffers: pair.bOffers,
    sharedDomains: pair.sharedDomains,
    cardForA: pair.cardForA,
    cardForB: pair.cardForB,
    aiHeadline: 'Payments × Growth',
    aiWhyForA: 'Kuda complements you.',
    aiWhyForB: 'Tariro complements you.',
    emailsSent: { [A.uid]: true, [B.uid]: true },
    interests: {},
  });
  store.set(`weeklyCofounderAssignments/${window.key}_${A.uid}`, { partnerUid: B.uid, pairId: 'abe01', pairDocId });
  store.set(`users/${A.uid}`, A);
  store.set(`users/${B.uid}`, B);

  const result = await getOrAssignWeeklyCofounder(db, A.uid, {
    now,
    aiText: async () => deepJson,
  });
  assert.ok(result.match, 'the existing pair is returned');
  const dossier = result.match.dossier;
  assert.ok(dossier, 'a pair with no stored dossier still gets one');
  assert.ok(dossier.whyChosen.length > 40);
  assert.equal(dossier.whyChosen, result.match.dossier.whyChosen);
  assert.equal(dossier.partnerBrings[0].skill, 'B2B distribution', 'A reads what B brings to A');
  assert.equal(dossier.youBring[0].skill, 'Payments rails');

  // The deep read is written back so the second member and later visits get it
  // without paying for another model call.
  const written = store.get(`weeklyCofounderMatches/${pairDocId}`);
  assert.ok(written.aiDossier, 'the AI dossier is persisted');
  assert.equal(written.aiDossier.source, 'ai+engine');
  assert.ok(Number(written.aiDossierAttemptAt) > 0);
});

test('the chosen person wears a crown above the portrait, and the full read replaces the two-line summary', () => {
  const dashboard = fs.readFileSync(path.join(root, 'mobile', 'src', 'screens', 'DiscoveryDashboardScreen.tsx'), 'utf8');
  const crown = fs.readFileSync(path.join(root, 'mobile', 'src', 'components', 'ChosenCrown.tsx'), 'utf8');

  // The crown is drawn, silent, and sits above the picture.
  assert.match(crown, /testID = 'chosen-crown'/);
  assert.match(crown, /accessibilityRole="image"/);
  assert.doesNotMatch(crown, /Animated|sound|Audio/);
  const portrait = fs.readFileSync(path.join(root, 'mobile', 'src', 'components', 'WeeklyPortrait.tsx'), 'utf8');
  assert.match(dashboard, /import WeeklyPortrait from '\.\.\/components\/WeeklyPortrait';/);
  // The crown renders above the framed portrait inside the real component.
  assert.ok(
    portrait.indexOf('<ChosenCrown size={46} />') < portrait.indexOf('styles.image'),
    'the crown is declared above the portrait image',
  );
  assert.match(portrait, /crownStage: \{ marginBottom: -9/);
  assert.match(portrait, /1 OF 1/);
  assert.match(portrait, /borderColor: GOLD/);
  assert.match(portrait, /testID="weekly-portrait"/);

  // The deep read is rendered in full — no numberOfLines truncating the reason.
  const dossierCard = fs.readFileSync(path.join(root, 'mobile', 'src', 'components', 'WeeklyDossier.tsx'), 'utf8');
  assert.match(dashboard, /import WeeklyDossier from '\.\.\/components\/WeeklyDossier';/);
  assert.match(dashboard, /<WeeklyDossier/);
  assert.match(dossierCard, /testID=\{testID\}/);
  assert.match(dossierCard, /testID=\{`\$\{testID\}-why`\}/);
  assert.doesNotMatch(dossierCard, /-why`\}[\s\S]{0,160}numberOfLines/);
  assert.match(dossierCard, /DISCOVERY_VOICE\.dossier\.partnerBrings\(partnerFirst\)/);
  assert.match(dossierCard, /DISCOVERY_VOICE\.dossier\.youBring\(partnerFirst\)/);
  assert.match(dossierCard, /DISCOVERY_VOICE\.dossier\.sharedGround/);
  assert.match(dossierCard, /DISCOVERY_VOICE\.dossier\.sprint\(firstSprint\)/);
  // The screen hands the card the dossier the server wrote.
  assert.match(dashboard, /\(match as any\)\.dossier/);
  assert.match(dashboard, /partnerBrings=\{partnerBrings\}/);
  assert.match(dashboard, /youBring=\{youBring\}/);
  assert.match(dashboard, /whyChosen=\{deepWhy\}/);
});
