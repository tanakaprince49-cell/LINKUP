import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BUDGET_DEFAULTS } from '../shared/linky-budget.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const app = read('mobile/App.tsx');
const tabIcon = read('mobile/src/components/LinkyCatTabIcon.tsx');
const glyph = read('mobile/src/components/LinkyCatIcon.tsx');
const pill = read('mobile/src/components/LinkyQuotaPill.tsx');
const chat = read('mobile/src/screens/LinkyHomeScreen.tsx');
const thinking = read('mobile/src/components/WeeklyMatchThinking.tsx');
const dashboard = read('mobile/src/screens/DiscoveryDashboardScreen.tsx');

// ── 1. THE CAT ────────────────────────────────────────────────────────────────

test('the Linky navigation icon is the cat line mark, not a photo', () => {
  // The founder's sketch: a cat inside a rounded frame. Here the frame is the
  // gold tile and the cat is one ink line, so it holds at 22px.
  assert.match(app, /<LinkyCatTabIcon focused=\{focused\} size=\{22\} \/>/);
  assert.doesNotMatch(tabIcon, /logo-cat\.png|require\(/, 'no raster in the tab icon');
  assert.match(tabIcon, /import LinkyCatIcon from '\.\/LinkyCatIcon'/);

  // Frame: gold rounded tile, ink ring only when focused.
  assert.match(tabIcon, /backgroundColor: '#FBE618'/);
  assert.match(tabIcon, /borderColor: focused \? '#0A0B0D' : 'transparent'/);

  // Glyph: vector, 24-unit grid, round caps so the line has no cut corners.
  assert.match(glyph, /viewBox="0 0 24 24"/);
  assert.match(glyph, /strokeLinecap="round"/);
  assert.match(glyph, /strokeLinejoin="round"/);
  // Two ears, one back line.
  assert.match(glyph, /<Path d="M7 19\.8C6\.2 16\.4 6\.5 12\.6 7\.8 10\.4L8\.6 5L11\.4 8\.4L12\.6 8\.4L15\.4 5L16\.2 10\.4/);
  // The tail is its own path with a real gap, so it never reads as a lump.
  assert.match(glyph, /<Path d="M17\.9 18\.2C20 17 20\.5 14\.2 19\.1 13/);
  // Eyes are filled dots (survive the scale-down), not strokes.
  assert.match(glyph, /<Circle cx="10\.5" cy="11\.6" r="0\.62" fill=\{color\} stroke="none" \/>/);
  assert.match(glyph, /<Circle cx="13\.5" cy="11\.6" r="0\.62" fill=\{color\} stroke="none" \/>/);
  // No mascot face, no sparkles, no raster.
  assert.doesNotMatch(glyph, /Sparkles|Image|require\(/);
});

test('the cat is reusable and stays legible at every size it is asked for', () => {
  // One glyph, three surfaces: the tab, the allowance pill, and anything else
  // that needs the mark. Sized by prop, never by a hardcoded pixel.
  assert.match(glyph, /size = 24/);
  assert.match(glyph, /weight = 1\.7/);
  assert.match(glyph, /width=\{size\}/);
  assert.match(glyph, /height=\{size\}/);
  // Detail drops out below 20px instead of turning into mud.
  assert.match(tabIcon, /eyes=\{size >= 20\}/);
  assert.match(pill, /<LinkyCatIcon size=\{15\}/);
});

// ── 2. THE ALLOWANCE ─────────────────────────────────────────────────────────

test('the free allowance is 4 messages a day, and the chat says how many are left', () => {
  assert.equal(BUDGET_DEFAULTS.freePerDay, 4);
  assert.equal(BUDGET_DEFAULTS.freeDaily, 4);

  // It sits above the composer, in the same glance line as the text field.
  const composer = chat.indexOf('styles.composer,');
  const pillUse = chat.indexOf('<LinkyQuotaPill');
  assert.ok(pillUse > 0, 'the chat renders the allowance pill');
  assert.ok(pillUse < composer, 'the pill sits above the composer, not below it');

  // The live number comes from the server, never from a constant in the app.
  assert.match(pill, /quota\.limit/);
  assert.match(pill, /quota\.remaining/);
  assert.match(pill, /\{remaining\} of \{limit\} free message/);
  assert.match(pill, /left today/);
  // A meter, so the number can be read without reading.
  assert.match(pill, /testID=\{`\$\{testID\}-meter`\}/);
  assert.match(pill, /index < used/);
});

test('the fifth message is a paywall, and the empty meter is the door to it', () => {
  // The pill becomes the upgrade itself once the day is spent — no dead meter.
  assert.match(pill, /if \(exhausted\) \{/);
  assert.match(pill, /Free messages used up · Upgrade to LINKUP PLUS/);
  assert.match(pill, /onPress=\{onUpgrade\}/);
  assert.match(pill, /accessibilityRole="button"/);

  // Tapping it opens the real paywall, with the member's own number in the words.
  assert.match(chat, /onUpgrade=\{/);
  assert.match(chat, /setPaywall\(/);
  assert.match(chat, /free messages used up\. LINKUP PLUS keeps Linky searching all day/);

  // And a fifth message sent anyway still lands on 402 → paywall.
  assert.match(chat, /err\.status === 402/);
  assert.match(chat, /setPaywall\(err\.message\)/);

  // PLUS members see no counter and no upgrade.
  assert.match(pill, /if \(quota\.unlimited\) \{/);
  assert.match(pill, /PLUS · unlimited messages and searches/);
  // The unlimited branch returns before the meter, so a PLUS member is never
  // shown a countdown to something they cannot run out of.
  const unlimitedAt = pill.indexOf('if (quota.unlimited) {');
  const exhaustedAt = pill.indexOf('if (exhausted) {');
  assert.ok(unlimitedAt > 0 && unlimitedAt < exhaustedAt);
});

// ── 3. THE FACE ──────────────────────────────────────────────────────────────

test('when the co-founder is revealed, their profile picture is what lands', () => {
  // The face is not painted until the member taps — then it arrives first and
  // alone, before a single claim is made about them.
  assert.match(thinking, /partner\?: \{ name\?: string; profilePic\?: string \}/);
  assert.match(thinking, /const \[revealed, setRevealed\] = useState\(false\)/);
  assert.match(thinking, /testID="weekly-reveal-face"/);
  assert.match(thinking, /safeProfileImageUri\(partner\?\.profilePic\)/);
  assert.match(thinking, /ikAvatar\(/);
  assert.match(thinking, /<AppImage/);
  // It blooms out of the tap: 0.82 -> 1 while the ring closes.
  assert.match(thinking, /outputRange: \[0\.82, 1\]/);
  assert.match(thinking, /const FACE_HOLD_MS = 760/);
  // And the dashboard hands it the real partner, picture and all.
  assert.match(dashboard, /partner=\{\{/);
  assert.match(dashboard, /profilePic: \(weeklyMatch\.partner as any\)\?\.profilePic/);
});

test('the weekly card itself still shows the face, before any text about them', () => {
  // WeeklyPortrait puts the photo first: frame, halo, 1 OF 1 flag.
  const portrait = read('mobile/src/components/WeeklyPortrait.tsx');
  assert.match(portrait, /testID="weekly-portrait-frame"/);
  assert.match(portrait, /profilePic/);
  assert.match(dashboard, /profilePic=\{item\.profilePic\}/);
  // The revealed face and the card face are the same person, same field.
  assert.match(thinking, /profilePic/);
  assert.match(dashboard, /weeklyMatch\.partner as any\)\?\.profilePic/);
});
