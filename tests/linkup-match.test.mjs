import test from 'node:test';
import assert from 'node:assert/strict';

import * as M from '../shared/linkup-match.js';

const DAY = 86400000;
const NOW = Date.parse('2026-11-06T09:00:00.000Z');

const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

/** A fintech founder looking for a technical cofounder, in Harare. */
const founder = {
  uid: 'founder',
  displayName: 'Tariro Moyo',
  occupation: 'founder',
  bio: 'Building cross-border payments for Zimbabwean SMEs. Obsessed with KYC friction.',
  skills: ['product', 'figma', 'sales', 'fintech', 'payments'],
  industries: ['fintech', 'payments'],
  lookingFor: ['developer', 'cofounder'],
  goals: 'Get SMEs paid across borders without the KYC wall',
  commitmentLevel: 'fulltime',
  workStyle: 'Fast-paced',
  startupStage: 'MVP',
  ambition: 'unicorn',
  city: 'harare',
  country: 'zimbabwe',
  timezone: 'UTC+2',
  lastActiveAt: iso(1),
  createdAt: iso(240),
  streakCount: 14,
  shipCount: 3,
  reputationMetrics: { responseRate: 88, reliability: 90 },
  onboarded: true,
  isVisible: true,
};

/** The technical complement: same niche, different craft, same city. */
const engineer = {
  uid: 'engineer',
  displayName: 'Farai Ncube',
  occupation: 'software engineer',
  bio: 'Wiring KYC for cross-border payments. Rust and Node.',
  skills: ['react native', 'node.js', 'payments', 'fintech'],
  industries: ['fintech'],
  lookingFor: ['cofounder'],
  goals: 'Make cross-border payments work in Harare',
  commitmentLevel: 'fulltime',
  workStyle: 'Fast-paced',
  ambition: 'unicorn',
  city: 'harare',
  country: 'zimbabwe',
  timezone: 'UTC+2',
  lastActiveAt: iso(2),
  streakCount: 30,
  shipCount: 5,
  reputationMetrics: { responseRate: 92, reliability: 85 },
  onboarded: true,
  isVisible: true,
};

/** Same craft as the founder — the "mirror twins" trap. */
const twin = {
  uid: 'twin',
  displayName: 'Kuda Banda',
  occupation: 'founder',
  bio: 'Fintech founder. Payments for SMEs, KYC is the wall.',
  skills: ['product', 'figma', 'sales', 'fintech', 'payments'],
  industries: ['fintech', 'payments'],
  lookingFor: ['cofounder'],
  goals: 'Get SMEs paid across borders. KYC is the wall.',
  commitmentLevel: 'fulltime',
  workStyle: 'Fast-paced',
  ambition: 'unicorn',
  city: 'harare',
  country: 'zimbabwe',
  timezone: 'UTC+2',
  lastActiveAt: iso(3),
  streakCount: 10,
  shipCount: 2,
  onboarded: true,
  isVisible: true,
};

/** Different field entirely, part-time. */
const designer = {
  uid: 'designer',
  displayName: 'Nyasha Dube',
  occupation: 'designer',
  bio: 'Brand systems for climatetech. Figma, motion.',
  skills: ['figma', 'branding', 'design systems'],
  industries: ['climatetech', 'solar'],
  lookingFor: ['freelance'],
  goals: 'Design solar dashboards for rural clinics',
  commitmentLevel: 'sideproject',
  workStyle: 'Calm',
  ambition: 'lifestyle',
  city: 'bulawayo',
  country: 'zimbabwe',
  timezone: 'UTC+2',
  lastActiveAt: iso(45),
  streakCount: 2,
  shipCount: 1,
  onboarded: true,
  isVisible: true,
};

const ctx = () => ({ now: NOW, corpus: M.buildCorpus([founder, engineer, twin, designer]) });

/* ---------------------------------------------------------------- *
 * Part I — fairness plumbing
 * ---------------------------------------------------------------- */

test('harmonic mean punishes one-sided pairs the way the design asks', () => {
  // Design §3 L3: "a 95/30 pair scores 45, not 62".
  assert.equal(M.harmonic(0.95, 0.3), 0.456);
  assert.equal(M.harmonic(0.8, 0.8), 0.8);
  assert.equal(M.harmonic(0.9, 0.2), 0.327);
  assert.equal(M.harmonic(0, 0.9), 0);
});

test('saturating counts stop a 60-skill profile farming the top of the list', () => {
  assert.ok(M.saturate(10) > 0.7 && M.saturate(10) < 0.8);
  const small = M.saturate(5);
  const huge = M.saturate(60);
  assert.ok(huge > small);
  assert.ok(huge < 1, 'saturating curve never reaches 1');
});

test('bands are the only thing a member sees, and they are ordered', () => {
  assert.equal(M.bandOf(0.8).label, 'Strong fit');
  assert.equal(M.bandOf(0.5).label, 'Good fit');
  assert.equal(M.bandOf(0.3).label, 'Worth a look');
  assert.equal(M.bandOf(0.1).label, 'Not a fit yet');
  // No band label may carry a percentage.
  for (const band of M.BANDS) assert.ok(!band.label.includes('%'));
});

test('rarity: a shared rare noun beats a shared generic one', () => {
  // A realistic pool: half of it says "AI", almost none of it says "KYC".
  const crowd = Array.from({ length: 40 }, (_, index) => ({
    uid: `crowd-${index}`,
    displayName: `Builder ${index}`,
    occupation: 'developer',
    goals: 'AI tools for African businesses',
    bio: 'Building AI products.',
    skills: ['ai', 'python'],
    industries: ['ai'],
    lookingFor: ['cofounder'],
  }));
  const corpus = M.buildCorpus([founder, engineer, twin, designer, ...crowd]);
  const genericA = { ...founder, goals: 'AI for everyone', bio: 'AI products.', skills: ['ai'], industries: ['ai'] };
  const genericB = { ...engineer, goals: 'AI for everyone', bio: 'AI products.', skills: ['ai'], industries: ['ai'] };

  const rare = M.voltageScore(M.deriveFacets(founder), M.deriveFacets(engineer), corpus);
  const generic = M.voltageScore(M.deriveFacets(genericA), M.deriveFacets(genericB), corpus);
  assert.ok(rare > 0, 'same-niche pair has voltage');
  assert.ok(
    generic < rare,
    `generic overlap (${generic}) must not beat rare overlap (${rare})`
  );
});

test('a sparse profile is not treated as a perfect match', () => {
  const bare = { uid: 'bare', displayName: 'New Member', skills: [''], industries: [], lookingFor: [] };
  const score = M.scorePair(founder, bare, ctx());
  assert.ok(score.fit <= 0.5, `sparse fit should stay low, got ${score.fit}`);
});


test('facet recency uses the supplied clock and unknown activity is not a negative', () => {
  const created = Date.parse('2026-01-01T00:00:00.000Z');
  const profile = { uid: 'clock', createdAt: created, city: '', country: '', timezone: '' };
  const early = M.deriveFacets(profile, { now: created + 10 * DAY });
  const late = M.deriveFacets(profile, { now: created + 20 * DAY });
  assert.equal(early.execution.createdAtDays, 10);
  assert.equal(late.execution.createdAtDays, 20);
  const unknown = M.deriveFacets({ uid: 'unknown' }, { now: NOW });
  const other = M.deriveFacets({ uid: 'other' }, { now: NOW });
  const features = M.featureFamilies(unknown, other);
  assert.equal(features.families.execution, null);
  assert.equal(features.families.geo, null);
  assert.equal(features.families.freshness, null);
});

test('recall is bounded and deterministic with a reserved exploration slice', () => {
  const candidates = Array.from({ length: 340 }, (_, index) => ({
    uid: `recall-${index}`,
    occupation: index % 2 ? 'developer' : 'designer',
    skills: index % 2 ? ['node', 'typescript'] : ['figma', 'branding'],
    industries: ['fintech'],
    lookingFor: ['cofounder'],
  }));
  const options = { limit: 80, now: NOW };
  const first = M.selectRecallCandidates(founder, candidates, options);
  const second = M.selectRecallCandidates(founder, candidates, options);
  assert.equal(first.length, 80);
  assert.deepEqual(first.map((row) => row.uid), second.map((row) => row.uid));
  assert.equal(new Set(first.map((row) => row.uid)).size, 80);
});

test('eligibility is one predicate and it rejects self, hidden and blocked people', () => {
  assert.equal(M.eligibility(founder, engineer).eligible, true);
  assert.equal(M.eligibility(founder, { ...founder }).reason, 'self');
  assert.equal(M.eligibility(founder, { ...engineer, isVisible: false }).reason, 'not_visible');
  assert.equal(M.eligibility(founder, { ...engineer, isStealthMode: true }).reason, 'stealth');
  assert.equal(M.eligibility(founder, { ...engineer, isBot: true }).reason, 'bot');
  const blocked = M.eligibility({ ...founder, blocked: ['engineer'] }, engineer);
  assert.equal(blocked.eligible, false);
});

test('someone contacted in the last 30 days is demoted, not deleted', () => {
  const gate = M.eligibility(founder, engineer, { now: NOW, contactedAt: NOW - 5 * DAY });
  assert.equal(gate.eligible, true);
  assert.equal(gate.demote, true);
});

/* ---------------------------------------------------------------- *
 * Scoring behaviour
 * ---------------------------------------------------------------- */

test('a complementary pair beats a mirror twin', () => {
  const context = ctx();
  const complement = M.scorePair(founder, engineer, context);
  const mirror = M.scorePair(founder, twin, context);
  assert.ok(
    complement.fit > mirror.fit,
    `complement fit ${complement.fit} should beat twin fit ${mirror.fit}`
  );
  // A twin can spark (same language) but is far less likely to *make* anything:
  // that is what the artifact head is for, and it is why mirror pairs get their
  // own slot instead of the top one.
  assert.ok(complement.artifact > mirror.artifact, 'complement out-produces a twin');
  assert.ok(complement.utility > mirror.utility);
});

test('a different field does not get the top slot by accident', () => {
  const context = ctx();
  const far = M.scorePair(founder, designer, context);
  const near = M.scorePair(founder, engineer, context);
  assert.ok(far.utility < near.utility);
  assert.equal(far.band.id === 'strong', false);
});

test('the same inputs always produce the same score (no dice, no model)', () => {
  const a = M.scorePair(founder, engineer, ctx());
  const b = M.scorePair(founder, engineer, ctx());
  assert.equal(a.utility, b.utility);
  assert.deepEqual(a.axes, b.axes);
});

test('scores are published as a band and a probability, never as a percentage string', () => {
  const score = M.scorePair(founder, engineer, ctx());
  assert.ok(score.display >= 0 && score.display <= 1);
  assert.ok(typeof score.band.label === 'string');
  assert.ok(!JSON.stringify(score.band).includes('%'));
});

test('red lines veto a pair outright', () => {
  const a = M.deriveFacets({ ...founder, redLines: ['surveillance'] });
  const b = M.deriveFacets({ ...engineer, redLines: ['surveillance'] });
  const chem = M.chemistryPair(a, b, { corpus: M.buildCorpus([founder, engineer]) });
  assert.equal(chem.veto, 'red_lines');
  assert.equal(chem.chem, 0);
});

test('the work-style card moves a pair, but only a little', () => {
  const base = M.scorePair(founder, engineer, ctx());
  const withCards = M.scorePair(
    { ...founder, workStyleCard: { feedbackStyle: 'direct', repair: 'curious', roleFlex: 0.2 } },
    { ...engineer, workStyleCard: { feedbackStyle: 'direct', repair: 'test', roleFlex: 0.3 } },
    ctx()
  );
  // The cap the design promises: chemistry, never fate.
  assert.ok(Math.abs(withCards.utility - base.utility) <= 0.25);
});

/* ---------------------------------------------------------------- *
 * Chemistry
 * ---------------------------------------------------------------- */

test('two generals with no soldier are named and penalised', () => {
  const visionary = M.deriveFacets({ ...founder });
  const connector = M.deriveFacets({
    uid: 'connector',
    displayName: 'Tendai',
    occupation: 'growth marketer',
    skills: ['growth', 'community', 'seo'],
    industries: ['fintech'],
    commitmentLevel: 'parttime',
    goals: 'Distribution for African fintech',
  });
  const chem = M.chemistryPair(visionary, connector, { corpus: M.buildCorpus([founder]) });
  assert.ok(chem.killers.some((killer) => killer.id === 'two_generals'));
  assert.ok(chem.killers.every((killer) => killer.repair.length > 0), 'every killer offers a repair');
});

test('rhythm: full-time × weekends is a mismatch even with perfect skills', () => {
  const fulltime = M.deriveFacets({ ...founder, commitmentLevel: 'fulltime' });
  const weekends = M.deriveFacets({ ...founder, uid: 'w', commitmentLevel: 'sideproject' });
  assert.equal(M.rhythmScore(fulltime, fulltime) > M.rhythmScore(fulltime, weekends), true);
});

test('effort symmetry reads 0.9/0.2 as the correct emotional 0.33-ish', () => {
  const vitals = { initiativeShareA: 0.9, initiativeShareB: 0.1, vitality: 0.6 };
  const value = M.effortSymmetry(vitals);
  assert.ok(value !== null && value < 0.5, `expected an asymmetric read, got ${value}`);
});

/* ---------------------------------------------------------------- *
 * Copy
 * ---------------------------------------------------------------- */

test('no generated line contains a banned token', () => {
  for (const candidate of [engineer, twin, designer]) {
    const score = M.scorePair(founder, candidate, ctx());
    const card = M.composeCard(score);
    for (const line of [card.headline, card.opener, card.tiny_task, card.why.shared, card.why.complement]) {
      const check = M.assertCopyClean(line);
      assert.ok(check.clean, `banned token "${check.token}" in: ${line}`);
    }
  }
});

test('every card carries two reasons and one thing to do', () => {
  const card = M.composeCard(M.scorePair(founder, engineer, ctx()));
  assert.ok(card.why.shared.length > 0);
  assert.ok(card.why.complement.length > 0);
  assert.ok(card.tiny_task.length > 0 && card.tiny_task.length <= 120);
  assert.ok(card.opener.length > 0 && card.opener.length <= 240);
  assert.ok(card.cites.length >= 1, 'a reason that cites nothing is worse than no reason');
  assert.equal(card.agenda.length, 3);
});

test('every citation points at a real ledger atom', () => {
  const score = M.scorePair(founder, engineer, ctx());
  const ids = new Set(score.ledger.map((atom) => atom.id));
  for (const cite of M.composeCard(score).cites) assert.ok(ids.has(cite), `unknown cite ${cite}`);
});

/* ---------------------------------------------------------------- *
 * Portfolio and allocation
 * ---------------------------------------------------------------- */

test('the portfolio never hands out three of the same person', () => {
  const context = ctx();
  const scored = [engineer, twin, designer].map((candidate) => M.scorePair(founder, candidate, context));
  const portfolio = M.composePortfolio(scored, { k: 3, poolSize: 40 });
  const uids = portfolio.map((entry) => entry.uid);
  assert.equal(new Set(uids).size, uids.length);
  const slots = portfolio.map((entry) => entry.slot);
  assert.equal(new Set(slots).size, slots.length, 'two cards must not share a reason type');
});

test('a small pool degrades to honest cards instead of padding a wildcard', () => {
  const context = ctx();
  const scored = [engineer, twin].map((candidate) => M.scorePair(founder, candidate, context));
  const portfolio = M.composePortfolio(scored, { k: 3, poolSize: 12 });
  assert.ok(portfolio.length <= 2);
  assert.equal(portfolio.some((entry) => entry.slot === 'wildcard'), false);
});

test('stable allocation stops the same people being handed to everybody', () => {
  const edges = [];
  for (const viewer of ['v1', 'v2', 'v3', 'v4']) {
    edges.push({ viewer, candidate: 'popular', score: 0.9 });
    edges.push({ viewer, candidate: `${viewer}-only`, score: 0.5 });
  }
  const allocated = M.stableAllocation(edges, { capacity: 2 });
  const popularCount = allocated.filter((edge) => edge.candidate === 'popular').length;
  assert.ok(popularCount <= 2, `popular member appeared ${popularCount} times, capacity is 2`);
  // Everybody still gets something.
  assert.equal(new Set(allocated.map((edge) => edge.viewer)).size, 4);
});

test('allocation is deterministic, so "refreshed" means rotated, not random', () => {
  const edges = [
    { viewer: 'a', candidate: 'x', score: 0.9 },
    { viewer: 'a', candidate: 'y', score: 0.4 },
    { viewer: 'b', candidate: 'x', score: 0.8 },
  ];
  assert.deepEqual(M.stableAllocation(edges, { capacity: 1 }), M.stableAllocation(edges, { capacity: 1 }));
});

/* ---------------------------------------------------------------- *
 * The courtship state machine
 * ---------------------------------------------------------------- */

test('a parked pair closes gracefully after 72 quiet hours, and never shames', () => {
  const action = M.nextPairAction({ state: 'sparked', lastMessageAt: NOW - 80 * 3600000 }, NOW);
  assert.equal(action.action, 'graceful_close');
  assert.equal(action.state, 'parked');
  assert.ok(!/you haven.t replied|ignored/i.test(action.copy));
});

test('one nudge per state, ever', () => {
  const pair = { state: 'greeted', greetedAt: NOW - 48 * 3600000, nudged: ['greeted'] };
  assert.notEqual(M.nextPairAction(pair, NOW).action, 'nudge_silent_side');
});

test('the next best action is always a verb with copy', () => {
  for (const state of M.PAIR_STATES) {
    const action = M.nextPairAction({ state, greetedAt: NOW, lastMessageAt: NOW, metAt: NOW, artefactAt: NOW }, NOW);
    assert.equal(typeof action.action, 'string');
    assert.ok(action.action.length > 0);
  }
});

test('every ending is graceful and none blames the other person', () => {
  for (const state of ['complete', 'parked', 'closed_well']) {
    const ending = M.endingFor({ state });
    assert.ok(ending);
    assert.ok(!/rejected|failed|your fault/i.test(ending.copy), ending.copy);
  }
});

/* ---------------------------------------------------------------- *
 * Vitals — metadata only
 * ---------------------------------------------------------------- */

test('vitals read turn balance, rhythm and momentum from metadata alone', () => {
  const messages = [
    { from: 'a', at: NOW - 6 * DAY, length: 40, hasQuestion: true },
    { from: 'b', at: NOW - 6 * DAY + 60_000, length: 30, hasQuestion: false },
    { from: 'a', at: NOW - 5 * DAY, length: 60, hasQuestion: true },
    { from: 'b', at: NOW - 4 * DAY, length: 90, hasQuestion: true },
    { from: 'a', at: NOW - 3 * DAY, length: 120, hasQuestion: false },
    { from: 'b', at: NOW - 2 * DAY, length: 140, hasQuestion: true },
  ];
  const vitals = M.computeVitals(messages, NOW);
  assert.equal(vitals.turnBalance, 1);
  assert.ok(vitals.questionDensity > 0);
  assert.ok(vitals.vitality > 0.4);
  assert.equal(M.vitalityState(vitals).id, 'in_motion');
});

test('an empty thread is "warming up", not a verdict', () => {
  assert.equal(M.vitalityState(M.computeVitals([], NOW)).label, 'Warming up');
});

test('vitals carry no message text field at all', () => {
  const vitals = M.computeVitals([{ from: 'a', at: NOW, length: 4 }, { from: 'b', at: NOW, length: 5 }], NOW);
  for (const key of Object.keys(vitals)) {
    assert.ok(!/text|body|content|message/i.test(key), `vitals leaked a text field: ${key}`);
  }
});

/* ---------------------------------------------------------------- *
 * Work style card
 * ---------------------------------------------------------------- */

test('the work style card is eight questions with a no-pressure framing', () => {
  assert.equal(M.WORK_STYLE_QUESTIONS.length, 8);
  for (const question of M.WORK_STYLE_QUESTIONS) {
    assert.ok(question.options.length >= 4);
  }
  assert.ok(/never your visibility/i.test(M.WORK_STYLE_CARD_INTRO));
});

test('the card can never move a member more than three positions', () => {
  assert.equal(M.applyWorkStyleShift(10, 99), 13);
  assert.equal(M.applyWorkStyleShift(10, -99), 7);
});

/* ---------------------------------------------------------------- *
 * rankPool — the end-to-end call the app makes
 * ---------------------------------------------------------------- */

test('rankPool filters the ineligible, orders by utility, and returns a portfolio-ready list', () => {
  const hidden = { ...engineer, uid: 'hidden', isVisible: false };
  const out = M.rankPool(founder, [engineer, twin, designer, hidden, founder], { now: NOW, limit: 10 });
  assert.equal(out.poolSize, 3);
  assert.deepEqual(out.scored.map((s) => s.uid), ['engineer', 'twin', 'designer']);
  assert.equal(out.ranked.length, 3);
  assert.equal(out.modelVersion, M.MODEL_VERSION);
});

test('rankPool is stable in the order it returns', () => {
  const first = M.rankPool(founder, [engineer, twin, designer], { now: NOW });
  const second = M.rankPool(founder, [designer, twin, engineer], { now: NOW });
  assert.deepEqual(first.scored.map((s) => s.uid), second.scored.map((s) => s.uid));
});

test('a member who already ignored four cards sinks', () => {
  const context = ctx();
  const base = M.scorePair(founder, engineer, context);
  const ignored = M.scorePair(founder, engineer, { ...context, impressionsIgnored: 4 });
  assert.ok(ignored.fit < base.fit);
});

/* ---------------------------------------------------------------- *
 * L4 — what the model is allowed to do
 * ---------------------------------------------------------------- */


test('explicit not-relevant feedback demotes a candidate without changing eligibility', () => {
  const base = M.scorePair(founder, engineer, ctx());
  const feedback = M.scorePair(founder, engineer, { ...ctx(), feedback: { status: 'not_relevant' } });
  assert.ok(feedback.utility < base.utility);
  assert.equal(feedback.gated, base.gated);
});

test('a model may shuffle a tie but cannot promote a weak card', () => {
  const rows = [
    { uid: 'strong', display: 82 },
    { uid: 'mid', display: 60 },
    { uid: 'weak', display: 20 },
  ];
  // Even if the model asks for the weak card first, the band stops it.
  const reordered = M.applyBandedOrder(rows, ['weak', 'mid', 'strong'], 6);
  assert.equal(reordered[0].uid, 'strong');
  assert.equal(reordered[2].uid, 'weak');
});

test('a model may reorder two cards that are genuinely tied', () => {
  const rows = [
    { uid: 'a', display: 61, band: { id: 'good' } },
    { uid: 'b', display: 60, band: { id: 'good' } },
  ];
  assert.equal(M.applyBandedOrder(rows, ['b', 'a'], 6)[0].uid, 'b');
});

test('model reorder is blocked across bands and beyond one position', () => {
  const rows = [
    { uid: 'a', display: 62, band: { id: 'good' } },
    { uid: 'b', display: 61, band: { id: 'good' } },
    { uid: 'c', display: 60, band: { id: 'worth_a_look' } },
  ];
  const moved = M.applyBandedOrder(rows, ['c', 'b', 'a'], 6);
  assert.equal(moved[0].uid, 'b');
  assert.equal(moved[2].uid, 'c');
});

test('a reason that cites nothing is dropped, and so is a banned one', () => {
  const atoms = [{ value: 'payments' }, { value: 'react native' }];
  assert.equal(M.citesLedger('She spent four months on payments in Harare.', atoms), true);
  assert.equal(M.citesLedger('You two are a 92% match!', atoms), false);
  assert.equal(M.citesLedger('You are both perfect for each other', atoms), false);
  assert.equal(M.citesLedger('Great fit', atoms), false);
});

test('invented, missing, or duplicate people invalidate the model permutation', () => {
  const rows = [
    { uid: 'real', ledger: [{ value: 'payments' }] },
    { uid: 'other', ledger: [{ value: 'design' }] },
  ];
  const invented = M.parseModelAnswer(
    '{"order":["ghost","real"],"reasons":{"real":"Works on payments in Harare"}}', rows
  );
  assert.equal(invented, null);
  const incomplete = M.parseModelAnswer('{"order":["real"],"reasons":{}}', rows);
  assert.equal(incomplete, null);
  const valid = M.parseModelAnswer(
    '{"order":["other","real"],"reasons":{"real":"Works on payments in Harare"}}', rows
  );
  assert.deepEqual(valid.order, ['other', 'real']);
  assert.deepEqual(Object.keys(valid.reasons), ['real']);
});

test('malformed model output is a no-op, never a crash', () => {
  assert.equal(M.parseModelAnswer('not json at all', [{ uid: 'a', ledger: [] }]), null);
  assert.deepEqual(M.applyBandedOrder([], []), []);
});


test('strengths come from declared skills only — occupation and status labels never count', () => {
  // The "brings: Student" bug: a Student occupation with no skills brings nothing.
  assert.deepEqual(M.profileStrengths({ occupation: 'Student', skills: [] }), []);
  assert.deepEqual(M.profileStrengths({ skills: ['Student', 'Founder', 'Hiring'] }), []);
  const strengths = M.profileStrengths({ occupation: 'Student', skills: ['React Native', 'Node.js', 'Fintech'] });
  assert.ok(strengths.includes('react native'));
  assert.ok(!strengths.includes('student'));
  // Facets carry the same strengths, and offers never fall back to occupation.
  const facets = M.deriveFacets({ uid: 'x1', occupation: 'Student', skills: [] });
  assert.deepEqual(facets.strengths, []);
  assert.deepEqual(facets.offers, []);
});

test('weekly co-founder gate keeps out thin and hiring-only profiles', () => {
  const jhoLike = { uid: 'j1', occupation: 'Student', skills: [], lookingFor: ['Hiring'], networkingIntent: 'Hiring', onboarded: true, isVisible: true };
  assert.equal(M.weeklyCofounderGate(jhoLike).reason, 'no_declared_strengths');
  const hiringOnly = { uid: 'j2', skills: ['React'], lookingFor: ['Hiring'], goals: 'Hiring engineers' };
  assert.equal(M.weeklyCofounderGate(hiringOnly).reason, 'hiring_only_intent');
  const seeker = { uid: 'j3', skills: ['React'], lookingFor: ['Technical Co-Founder'] };
  assert.equal(M.weeklyCofounderGate(seeker).eligible, true);
});

test('weekly pairing rejects a skills-less legacy profile even when everything else lines up', () => {
  const thin = {
    uid: 'thin', displayName: 'Thin Profile', occupation: 'Student', skills: [],
    lookingFor: ['Hiring'], goals: 'Hiring', bio: '', city: 'harare', country: 'zimbabwe',
    onboarded: true, isVisible: true, lastActiveAt: iso(1), createdAt: iso(200),
  };
  const result = M.scoreMutualCofounderPair(founder, thin, ctx());
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'no_declared_strengths');
});

test('weekly pairing requires complementary crafts, not the same stack twice', () => {
  const clone = { ...engineer, uid: 'engineer-2', displayName: 'Second Engineer' };
  const same = M.scoreMutualCofounderPair(engineer, clone, ctx());
  assert.equal(same.eligible, false);
  assert.equal(same.reason, 'overlapping_skillset');

  const pair = M.scoreMutualCofounderPair(founder, engineer, ctx());
  assert.equal(pair.eligible, true, JSON.stringify(pair));
  const allOffers = [...pair.aOffers, ...pair.bOffers].join(' ').toLowerCase();
  assert.doesNotMatch(allOffers, /student|software engineer|founder/, 'offers must be strengths, never occupations');
});
