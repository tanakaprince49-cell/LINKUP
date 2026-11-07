import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

const voice = read('mobile/src/lib/brandVoice.ts');
const onboarding = read('mobile/src/screens/OnboardingScreen.tsx');
const discovery = read('mobile/src/screens/DiscoveryDashboardScreen.tsx');
const linky = read('mobile/src/screens/LinkyHomeScreen.tsx');
const landing = read('mobile/src/screens/LandingScreen.tsx');
const intro = read('mobile/src/components/LinkyCatIntro.tsx');
const types = read('mobile/src/types.ts');

test('one voice module, and every human-facing surface speaks through it', () => {
  for (const [name, source, marker] of [
    ['landing', landing, /LANDING_VOICE/],
    ['onboarding', onboarding, /ONBOARDING_VOICE/],
    ['discover', discovery, /DISCOVERY_VOICE/],
    ['linky', linky, /LINKY_VOICE/],
    ['linky intro', intro, /LINKY_VOICE\.introLines/],
  ]) {
    assert.match(source, marker, `${name} must read the shared voice`);
  }
  // The voice is pure: no React Native in it, so the same words can be emailed.
  assert.doesNotMatch(voice, /from 'react-native'|from 'react'/);
});

test('the copy makes one person, one chair and one shot the whole story', () => {
  // The stakes are on the first screen a stranger ever sees.
  assert.match(voice, /You are one person away from the version of this that works\./);
  assert.match(voice, /Someone else is already looking for you\./);
  assert.match(voice, /without them is a week lost/i);
  // Second person, no third-person corporate distance.
  assert.doesNotMatch(voice, /\bthe user\b|\busers will\b|\bbuilders can\b/i);
  // Never invent urgency we cannot back up: no countdowns or fake scarcity.
  assert.doesNotMatch(voice, /only \d+ spots|expires in|hurry|act now|limited time/i);
});

test('the personalised lines cannot be sent to the wrong person', () => {
  // Every generative string takes the derived facts — a name, a build, a seat.
  assert.match(voice, /opener: \(facts: BuildFacts, when = new Date\(\)\)/);
  assert.match(voice, /stakes: \(facts: BuildFacts\)/);
  assert.match(voice, /greeting: \(facts: BuildFacts\)/);
  assert.match(voice, /placeholder: \(facts: BuildFacts\)/);
  assert.match(voice, /introLines: \(facts: BuildFacts\)/);
  assert.match(voice, /chips: \(facts: BuildFacts\)/);
  // The first-name helper is title-cased and never invents a name.
  assert.match(voice, /export function firstNameOf/);
  assert.match(voice, /if \(!raw\) return '';/);
  // The build comes from onboarding first, then from whatever the profile has.
  for (const field of ['buildingName', 'buildingOneLiner', 'projects', 'startupIdeas', 'missingSeat', 'lookingFor']) {
    assert.ok(voice.includes(field), `buildFacts must read ${field}`);
  }
});

test('onboarding now asks the things the algorithm actually needs, and keeps them', () => {
  // The build.
  assert.match(onboarding, /key: 'build'/);
  assert.match(onboarding, /value=\{buildName\}/);
  assert.match(onboarding, /value=\{buildOneLiner\}/);
  assert.match(onboarding, /setBuildTraction/);
  // The empty chair.
  assert.match(onboarding, /key: 'seat'/);
  assert.match(onboarding, /value=\{missingSeat\}/);
  assert.match(onboarding, /value=\{seatWhy\}/);
  assert.match(onboarding, /const missingSeatChoices: Choice\[\] = \[/);
  // The stakes and the clock.
  assert.match(onboarding, /key: 'stakes'/);
  assert.match(onboarding, /setStakes/);
  assert.match(onboarding, /setUrgency/);
  // How they want to be built with.
  assert.match(onboarding, /key: 'fit'/);
  for (const setter of ['setWorkPace', 'setConflictStyle', 'setDecisionStyle', 'setRiskAppetite', 'setEquityView', 'setWeeklyHours', 'setRelocateView']) {
    assert.ok(onboarding.includes(setter), setter);
  }
  // The read-back before they walk in.
  assert.match(onboarding, /key: 'mirror'/);
  assert.match(onboarding, /THE EMPTY CHAIR/);
  assert.match(onboarding, /This is the brief that gets emailed to the one person the algorithm pairs you with\./);

  // The role question bank — skills, role answers, industries, personality —
  // used to be defined but never rendered. It is now in the flow.
  assert.match(onboarding, /const roleSteps = useMemo/);
  assert.match(onboarding, /\.\.\.roleSteps,/);

  // Every answer is written to the profile, and mirrored into the signal list
  // AI and the matching algorithm read.
  for (const field of ['buildingName', 'buildingOneLiner', 'buildingTraction', 'missingSeat', 'seatWhy', 'stakes', 'urgency', 'workPace', 'conflictStyle', 'decisionStyle', 'riskAppetite', 'equityView', 'weeklyHours', 'relocateView', 'matchingSignals']) {
    assert.ok(onboarding.includes(`${field}:`) || onboarding.includes(`${field},`), `onboarding must persist ${field}`);
  }
  assert.match(onboarding, /remoteOnly: relocateView === 'remote'/);
  assert.match(onboarding, /willingToRelocate: relocateView === 'relocate' \|\| relocateView === 'together'/);
  // The build becomes a real project row so discovery and Linky can show it.
  assert.match(onboarding, /id: 'onboarding-build'/);
  assert.match(onboarding, /status:\s*\n?\s*buildTraction === 'revenue'/);
  // Draft autosave includes the new answers, so a half-finished brief survives.
  for (const field of ['buildName', 'missingSeat', 'stakes', 'workPace', 'relocateView']) {
    assert.ok(onboarding.includes(`${field},`) || onboarding.includes(`${field}:`), `draft must save ${field}`);
  }
  // And the profile type knows about all of it.
  for (const field of ['buildingName', 'buildingOneLiner', 'buildingTraction', 'missingSeat', 'seatWhy', 'stakes', 'urgency', 'workPace', 'conflictStyle', 'decisionStyle', 'riskAppetite', 'equityView', 'weeklyHours', 'relocateView', 'matchingSignals']) {
    assert.match(types, new RegExp(`\\b${field}\\?:`), `UserProfile must type ${field}`);
  }
});

test('the discover page is written for exactly one member', () => {
  assert.match(discovery, /const facts = useMemo\(\(\) => buildFacts\(me as any\), \[me\]\)/);
  assert.match(discovery, /\{DISCOVERY_VOICE\.opener\(facts\)\}/);
  assert.match(discovery, /\{DISCOVERY_VOICE\.stakes\(facts\)\}/);
  // The promise the product keeps: the weekly person sits under the headline.
  assert.match(discovery, /\{DISCOVERY_VOICE\.headline\}/);
  assert.match(voice, /headline: 'Grow your professional network\.'/);
  // The card speaks about this pair, not about "profiles".
  assert.match(discovery, /DISCOVERY_VOICE\.cardLabel\(partnerFirst\)/);
  assert.match(discovery, /DISCOVERY_VOICE\.interestCta\(partnerFirst\)/);
  assert.match(discovery, /DISCOVERY_VOICE\.emailed\(partnerFirst\)/);
  assert.match(discovery, /DISCOVERY_VOICE\.emptyTitle/);
  assert.match(discovery, /DISCOVERY_VOICE\.emptyBody/);
  assert.doesNotMatch(discovery, /No professionals to display/);
  assert.doesNotMatch(discovery, /No relevant profiles are available in this view yet/);
});

test('Linky opens with the cat, says your name, and promises three minutes', () => {
  assert.match(linky, /import LinkyCatIntro from '\.\.\/components\/LinkyCatIntro'/);
  assert.match(linky, /<LinkyCatIntro profile=\{profile as any\} visible=\{introOpen\} onDone=\{\(\) => setIntroOpen\(false\)\} \/>/);
  assert.match(linky, /useState\(true\)/, 'the opening runs when the page is opened');

  // The three beats, in order: the name, then the build, then the promise.
  assert.match(voice, /lines\.push\(facts\.hasName \? `Hi \$\{facts\.firstName\}\.` : 'Hi\. You made it\.'\)/);
  assert.match(voice, /I know about \$\{facts\.projectName\}\./);
  assert.match(voice, /Give me three minutes\. I will find the teammates who finish this\./);

  // The cat is the real brand cat, hinged in 3D, and the sequence is timed.
  assert.match(intro, /const CAT = require\('\.\.\/\.\.\/assets\/launch-cat\.png'\)/);
  assert.match(intro, /perspective: 1000/);
  assert.match(intro, /rotateY: entrance\.interpolate/);
  assert.match(intro, /const LINE_AT = \[700, 1750, 2800\] as const;/);
  assert.match(intro, /testID="linky-cat-intro"/);
  assert.match(intro, /testID=\{`linky-cat-intro-line-\$\{index\}`\}/);
  // Silent, like the cold open: no audio anywhere in the sequence.
  assert.doesNotMatch(intro, /expo-audio|Audio\.|playAsync|Sound\./);
  // It cannot be clipped by the page beneath it.
  assert.match(intro, /<Modal visible transparent animationType="none"/);
  assert.match(intro, /root: \{ flex: 1, backgroundColor: '#FBE618' \}/);
  // Tap skips, and reduced motion still gets the whole message.
  assert.match(intro, /onPress=\{finish\}/);
  assert.match(intro, /prefers-reduced-motion: reduce/);
});

test('Linky already knows the build before the member types anything', () => {
  assert.match(linky, /const facts = useMemo\(\(\) => buildFacts\(profile as any\), \[profile\]\)/);
  assert.match(linky, /text: LINKY_VOICE\.greeting\(facts\)/);
  assert.match(linky, /placeholder=\{LINKY_VOICE\.placeholder\(facts\)\}/);
  assert.match(linky, /LINKY_VOICE\.chips\(facts\)/);
  assert.match(linky, /LINKY_VOICE\.disclaimer/);
  assert.match(linky, /LINKY_VOICE\.working/);
  // The one-tap hunt carries the brief, so Linky never asks twice.
  assert.match(linky, /idea: lastIdea \|\| facts\.oneLiner/);
  assert.match(linky, /the \$\{facts\.seat\} seat/);
  // The greeting is generated from the profile, not from a fixed string.
  assert.doesNotMatch(linky, /Tell me what you are building and which seat is still empty/);
});

test('the landing page asks for a tap with a life on the line, honestly', () => {
  assert.match(landing, /LANDING_VOICE\.headline/);
  assert.match(landing, /LANDING_VOICE\.sub/);
  assert.match(landing, /LANDING_VOICE\.proof\.map/);
  assert.match(landing, /LANDING_VOICE\.primaryCta/);
  assert.match(landing, /LANDING_VOICE\.secondaryCta/);
  assert.match(voice, /primaryCta: 'Find the person I have been missing'/);
  // Truthful proof points only.
  assert.match(voice, /Real profiles, not promises\./);
  assert.doesNotMatch(voice, /guaranteed|100% match|instantly rich/i);
});

/* ------------------------------------------------------------------ *
 * The voice module is pure TypeScript with no imports, so the tests can
 * run it for real and check what a member would actually read.
 * ------------------------------------------------------------------ */
const loadVoice = () => {
  const js = ts.transpileModule(voice, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports;
};
const V = loadVoice();

const PRINCE = {
  displayName: 'prince tana',
  buildingName: 'Linkup',
  buildingOneLiner: 'the app that finds your co-founder while you sleep',
  missingSeat: 'Engineering',
  lookingFor: ['Cofounder'],
  city: 'Harare',
};

test('buildFacts reads the brief the member actually gave', () => {
  const facts = V.buildFacts(PRINCE);
  assert.equal(facts.firstName, 'Prince');
  assert.equal(facts.hasName, true);
  assert.equal(facts.projectName, 'Linkup');
  assert.equal(facts.seat, 'Engineering');
  assert.equal(facts.knownBuild, true);
  assert.equal(facts.city, 'Harare');

  // Falls back to the project row, then the startup idea, then the bio.
  assert.equal(V.projectNameOf({ projects: [{ title: 'FarmLink' }] }), 'FarmLink');
  assert.equal(V.projectNameOf({ startupIdeas: [{ title: 'Northstar' }] }), 'Northstar');
  assert.equal(V.oneLinerOf({ bio: 'I build things for farmers. Second sentence.' }), 'I build things for farmers.');
  // The empty chair is translated into a human, never a bare tag.
  assert.equal(V.seatOf({ lookingFor: ['Cofounder'] }), 'co-founder');
  assert.equal(V.seatOf({ lookingFor: ['Designer'] }), 'designer');
  assert.equal(V.seatOf({}), 'the person who finishes this');
  // With nothing at all, nothing is invented.
  const blank = V.buildFacts(null);
  assert.equal(blank.hasName, false);
  assert.equal(blank.projectName, '');
  assert.doesNotMatch(blank.seat, /undefined|null/);
});

test('the Linky opening says the name, then the build, then the promise', () => {
  const lines = V.LINKY_VOICE.introLines(V.buildFacts(PRINCE));
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'Hi Prince.');
  assert.match(lines[1], /Linkup/);
  assert.match(lines[1], /Engineering/);
  assert.match(lines[2], /three minutes/);

  // With nothing known, it still opens like a person and never leaks a hole.
  const blank = V.LINKY_VOICE.introLines(V.buildFacts(null));
  assert.equal(blank[0], 'Hi. You made it.');
  assert.equal(blank.length, 3);
  for (const line of blank) assert.doesNotMatch(line, /undefined|null|\$\{/);
});

test('Linky opens the thread already holding the brief', () => {
  const facts = V.buildFacts(PRINCE);
  const greeting = V.LINKY_VOICE.greeting(facts);
  assert.match(greeting, /^It is me — Linky\. You are building Linkup/);
  assert.match(greeting, /the app that finds your co-founder while you sleep/);
  assert.match(greeting, /the seat that is still empty is Engineering/);
  assert.doesNotMatch(greeting, /undefined|null/);

  // It asks a new member for the missing facts — and only those.
  const unknown = V.LINKY_VOICE.greeting(V.buildFacts(null));
  assert.match(unknown, /Tell me what you are making and who is missing/);
  assert.doesNotMatch(unknown, /undefined|null/);

  const chips = V.LINKY_VOICE.chips(facts);
  assert.equal(chips[0], 'Find my Engineering');
  assert.ok(chips.some((chip) => chip.includes('Linkup')));
  assert.match(V.LINKY_VOICE.placeholder(facts), /Linkup/);
});

test('the discover opener and stakes name the member and their chair', () => {
  const facts = V.buildFacts(PRINCE);
  const opener = V.DISCOVERY_VOICE.opener(facts, new Date('2026-11-07T18:00:00Z'));
  assert.match(opener, /Prince/);
  assert.match(opener, /This week the algorithm chose exactly one person for you — and chose you for them\./);

  const stakes = V.DISCOVERY_VOICE.stakes(facts);
  assert.match(stakes, /Linkup still has one empty chair: Engineering\./);
  assert.match(V.DISCOVERY_VOICE.stakes(V.buildFacts(null)), /One person, chosen for you, who is choosing you back\./);

  assert.match(V.DISCOVERY_VOICE.interestCta('Tendai'), /introduce me to Tendai/);
  assert.match(V.DISCOVERY_VOICE.emailed('Tendai'), /both inboxes/);
  assert.equal(V.DISCOVERY_VOICE.headline, 'Grow your professional network.');
});
