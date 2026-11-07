import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const voice = read('mobile/src/lib/brandVoice.ts');
const waiting = read('mobile/src/components/WeeklyMatchThinking.tsx');
const discovery = read('mobile/src/screens/DiscoveryDashboardScreen.tsx');
const workspace = read('mobile/src/screens/BuilderWorkspaceScreen.tsx');
const builderLib = read('mobile/src/lib/builder.ts');
const profile = read('mobile/src/screens/ProfileScreen.tsx');
const accountExport = read('mobile/src/lib/accountExport.ts');
const dataExport = read('mobile/src/lib/dataExport.ts');

/* ------------------------- the four-second wait ------------------------- */

test('the weekly wait lasts about four seconds and says so in four beats', () => {
  assert.match(waiting, /const THINKING_MS = 4000;/);
  assert.match(waiting, /const THINKING_REDUCED_MS = 1600;/);
  assert.match(waiting, /const LINE_AT = \[0, 900, 1900, 2900\] as const;/);
  // The clock is the full 4s from the first painted frame, not from mount.
  assert.match(waiting, /timers\.push\(setTimeout\(finish, THINKING_MS\)\)/);

  const beats = voice.slice(voice.indexOf('thinkingLines:'), voice.indexOf('status: (facts: BuildFacts)'));
  assert.match(beats, /'The cat is thinking\.'/);
  assert.match(beats, /Reading every profile that could build/);
  assert.match(beats, /could actually hold the \$\{facts\.seat\} seat/);
  assert.match(beats, /One person\. Chosen for you\. About to appear\./);
  // Tension: the status escalates, then names the member at the end.
  assert.match(voice, /'scanning'/);
  assert.match(voice, /'weighing fit'/);
  assert.match(voice, /'checking they are looking for you too'/);
});

test('the wait shows the thinking 3D cat and cannot be trapped in', () => {
  // The same brand cat as the cold open — 3D, leaning, orbiting thought rings.
  assert.match(waiting, /const CAT = require\('\.\.\/\.\.\/assets\/launch-cat\.png'\)/);
  assert.match(waiting, /perspective: 1000/);
  assert.match(waiting, /rotateY: entrance\.interpolate/);
  assert.match(waiting, /rotateZ: think\.interpolate/);
  assert.match(waiting, /perspective: 900/);
  assert.match(waiting, /rotateX: `\$\{68 \+ ring \* 4\}deg`/);
  // Silent, like every other brand moment.
  assert.doesNotMatch(waiting, /expo-audio|Audio\.|playAsync|Sound\./);
  // It paints above the page, and a tap is always an exit.
  assert.match(waiting, /<Modal visible transparent animationType="none"/);
  assert.match(waiting, /root: \{ flex: 1, backgroundColor: '#FBE618' \}/);
  assert.match(waiting, /onPress=\{finish\}/);
  assert.match(waiting, /WEEKLY_REVEAL_VOICE\.skip/);
  // Reduced motion still gets the whole message, just calm and short.
  assert.match(waiting, /prefers-reduced-motion: reduce/);
  assert.match(waiting, /testID="weekly-thinking"/);
  assert.match(waiting, /testID={`weekly-thinking-line-\$\{index\}`}/);
});

test('the wait happens once a week, before the person appears, not on every visit', () => {
  assert.match(discovery, /const weeklyMatchKey = \(uid: string \| undefined, match/);
  assert.match(discovery, /return `linkup:weekly-thinking:v1:\$\{uid \|\| 'anon'\}:\$\{week\}`/);
  assert.match(discovery, /AsyncStorage\.getItem\(weeklyRevealKey\)/);
  assert.match(discovery, /if \(weeklyRevealKey\) void AsyncStorage\.setItem\(weeklyRevealKey, '1'\)/);
  // Storage failing must reveal the card, never hold the member hostage.
  assert.match(discovery, /\.catch\(\(\) => \{ if \(active\) setWeeklyReveal\('revealed'\); \}\)/);
  // It sits over the weekly card, under the sponsor strip and hero copy.
  const card = discovery.indexOf('<WeeklyCofounderCard match={weeklyMatch} />');
  const overlay = discovery.indexOf('<WeeklyMatchThinking');
  assert.ok(overlay > 0 && card > overlay, 'the wait is mounted with the weekly card');
  assert.match(discovery, /visible=\{weeklyReveal === 'thinking'\}/);
  assert.match(discovery, /onDone=\{finishWeeklyThinking\}/);
});

/* ----------------------- the workspace is Groups ------------------------ */

test('the workspace is Groups and nothing else', () => {
  assert.match(builderLib, /export const BUILDER_SECTIONS=\['Groups'\] as const;/);
  assert.match(builderLib, /export function builderSection\(_value\?:unknown\):BuilderSection\{return 'Groups';\}/);
  // The tab strip only exists when there is more than one section.
  assert.match(workspace, /\{BUILDER_SECTIONS\.length>1\?/);
  // Nothing renders the old Settings pane any more.
  assert.doesNotMatch(workspace, /section==='Settings'/);
  assert.doesNotMatch(workspace, /Your private workspace data/);
  assert.doesNotMatch(workspace, /workspace settings/i);
  assert.match(workspace, /<GroupsPanel navigation=\{navigation\} isDark=\{dark\}\/>/);
  // The habit card used to deep-link into the removed tab.
  assert.doesNotMatch(read('mobile/src/components/BuildHabitCard.tsx'), /section:'Settings'/);
});

/* ------------------- leaving, with your data if you want it ------------- */

test('deleting an account offers an OPTIONAL export first, and never blocks', () => {
  // The sheet opens before anything is destroyed.
  assert.match(profile, /const handleDeleteAccount = \(\) => \{\n    setExportNote\(''\);\n    setExportState\('idle'\);\n    setLeaveSheet\(true\);/);
  assert.match(profile, /ACCOUNT_VOICE\.exportButton/);
  assert.match(profile, /ACCOUNT_VOICE\.deleteConfirm/);
  assert.match(profile, /ACCOUNT_VOICE\.cancel/);
  // Deleting without exporting is always one tap away.
  assert.match(profile, /const confirmDeleteWithoutExport = \(\) => \{\n    setLeaveSheet\(false\);\n    performDeleteAccount\(\);/);
  // And the same export is available from the profile without deleting.
  assert.match(profile, /onPress=\{\(\) => void runDataExport\(\)\}/);
  assert.match(profile, /await exportAccountData\(\{ uid: user\.uid, email: user\.email, profile: myProfile as any \}\)/);
  // Old copy: no "this cannot be undone" wall with no way to keep your data.
  assert.doesNotMatch(profile, /Permanently delete your LINKUP account and associated profile data/);

  assert.match(voice, /exportButton: 'Download my data \(optional\)'/);
  assert.match(voice, /deleteBody:/);
  assert.match(voice, /Deleting removes your profile, your build and every thread that came with it\./);
});

test('the export file is complete, readable and pure enough to test', () => {
  assert.doesNotMatch(accountExport, /from 'react-native'|from 'firebase/);
  assert.match(accountExport, /export const EXPORT_SCHEMA = 'linkup\.account-export\.v1';/);
  assert.match(accountExport, /export function buildAccountExport/);
  for (const field of ['buildingName', 'buildingOneLiner', 'missingSeat', 'seatWhy', 'stakes', 'urgency', 'equityView', 'weeklyHours', 'matchingSignals']) {
    assert.ok(accountExport.includes(field), `the brief must travel: ${field}`);
  }
  // Platform saving is a separate concern.
  assert.match(dataExport, /export async function saveAccountExport/);
  assert.match(dataExport, /export async function exportAccountData/);
  assert.match(dataExport, /anchor\.download = fileName;/);
  assert.match(dataExport, /expo-sharing/);
});

test('the export actually contains the member, the profile and the brief', () => {
  const js = ts.transpileModule(accountExport, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  const { buildAccountExport, exportFileName, EXPORT_SCHEMA } = mod.exports;

  const payload = buildAccountExport({
    uid: 'uid-123456789',
    email: 'prince@linkupbuild.com',
    profile: {
      displayName: 'Prince Tana',
      buildingName: 'Linkup',
      buildingOneLiner: 'the app that finds your co-founder while you sleep',
      missingSeat: 'Engineering',
      stakes: 'same-place',
      urgency: 'now',
      equityView: 'sweat',
      weeklyHours: '80',
      matchingSignals: ['Linkup', 'Engineering', 'now'],
      createdAt: { seconds: 1767225600 },
    },
    private: { notes: 'private workspace' },
    now: new Date('2026-11-07T12:00:00Z'),
  });

  assert.equal(payload.schema, EXPORT_SCHEMA);
  assert.equal(payload.exportedAt, '2026-11-07T12:00:00.000Z');
  assert.equal(payload.account.uid, 'uid-123456789');
  assert.equal(payload.account.email, 'prince@linkupbuild.com');
  assert.equal(payload.account.createdAt, new Date(1767225600 * 1000).toISOString());
  assert.equal(payload.profile.displayName, 'Prince Tana');
  assert.equal(payload.private.notes, 'private workspace');
  // The brief is lifted out, complete.
  assert.equal(payload.brief.buildingName, 'Linkup');
  assert.equal(payload.brief.missingSeat, 'Engineering');
  assert.deepEqual(payload.brief.matchingSignals, ['Linkup', 'Engineering', 'now']);
  assert.match(payload.notes, /this copy stays wherever you save it/);

  // It survives JSON.stringify with no Firestore timestamp objects leaking.
  const json = JSON.stringify(payload);
  assert.doesNotMatch(json, /"seconds":/);
  assert.match(exportFileName('uid-123456789', new Date('2026-11-07T12:00:00Z')), /^linkup-data-uid-1234-2026-11-07\.json$/);

  // An empty account still exports a valid, honest file.
  const empty = buildAccountExport({ uid: 'x', profile: null, private: null });
  assert.equal(empty.profile, null);
  assert.equal(empty.brief.buildingName, undefined);
  assert.doesNotThrow(() => JSON.stringify(empty));
});
