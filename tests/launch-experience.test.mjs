import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const bytes = (file) => fs.readFileSync(new URL('../' + file, import.meta.url));

test('the Linky tab wears the cat instead of a line icon', () => {
  const app = read('mobile/App.tsx');
  // The tab icon is chosen before the lucide map, and Linky is the only tab
  // that short-circuits to a component.
  const icon = app.indexOf('tabBarIcon: ({ focused }) => {');
  const cat = app.indexOf("if (route.name === 'LinkyHome')", icon);
  const lucideMap = app.indexOf("const iconMap: Record<string, { active: string; inactive: string }>", icon);
  assert.ok(icon > 0 && cat > icon && lucideMap > cat, 'the cat branch must run before the lucide map');
  assert.match(app, /<LinkyCatTabIcon focused=\{focused\} size=\{22\} \/>/);
  assert.match(app, /import LinkyCatTabIcon from '\.\/src\/components\/LinkyCatTabIcon'/);

  // The tab wears the founder's sketch: a cat drawn as one ink line inside the
  // gold rounded tile. The 3D photo was unreadable at 22px, so it is a glyph now
  // — the character still lives in the chat, the opening and the weekly reveal.
  const iconComponent = read('mobile/src/components/LinkyCatTabIcon.tsx');
  const glyph = read('mobile/src/components/LinkyCatIcon.tsx');
  assert.doesNotMatch(iconComponent, /logo-cat\.png/, 'the tab is a line icon, not a photo');
  assert.match(iconComponent, /import LinkyCatIcon from '\.\/LinkyCatIcon'/);
  assert.match(iconComponent, /<LinkyCatIcon/);
  assert.match(iconComponent, /focused/);
  // No gold tile: the cat is a plain grey outline like the other tabs, ink
  // when focused.
  assert.doesNotMatch(iconComponent, /#FBE618/, 'no yellow tile behind the tab cat');
  assert.match(iconComponent, /'#9CA3AF'/);
  // The glyph is vector: one silhouette path, one tail path, eyes that survive
  // being scaled to a tab.
  assert.match(glyph, /viewBox="0 0 24 24"/);
  assert.match(glyph, /<Path d="M7 19\.8C6\.2 16\.4/);
  assert.match(glyph, /<Path d="M17\.9 18\.2C20 17/);
  assert.match(glyph, /<Circle cx="10\.5" cy="11\.6" r="0\.62"/);
  assert.match(glyph, /eyes/);
  // The character (the 3D cat) is still the chat's face.
  assert.match(read('mobile/src/screens/LinkyHomeScreen.tsx'), /logo-cat\.png/);
  // The tab label itself stays "Linky".
  assert.match(app, /LinkyHome: 'Linky'/);
});

test('the opening wears the real LINKUP logo cat, not an invented mascot', () => {
  const screen = read('mobile/src/components/LinkupLaunchScreen.tsx');
  // The artwork is the generated 3D render of the brand mark: black cat, yellow
  // eyes, plugging the cable into the socket.
  assert.match(screen, /const CAT = require\('\.\.\/\.\.\/assets\/launch-cat\.png'\)/);
  assert.match(screen, /<Image[\s\S]{0,200}source=\{CAT\}/);
  // The hand-drawn stand-in mascot and the rotating "L" coin are both gone.
  assert.equal(fs.existsSync(new URL('../mobile/src/components/LinkyCatAlive.tsx', import.meta.url)), false);
  assert.doesNotMatch(screen, /LinkyCatAlive/);
  assert.doesNotMatch(screen, /faceBack|backfaceVisibility|faceBackText/);
  assert.doesNotMatch(screen, /spinDeg/);

  // It still moves like it is alive: hover, breathe, a 3D lean, and a spark
  // where the plug bites.
  assert.match(screen, /const float = useRef\(new Animated\.Value\(0\)\)/);
  assert.match(screen, /hoverY/);
  assert.match(screen, /hoverScale/);
  assert.match(screen, /rotateY: reduceMotion \? '0deg' : swayDeg/);
  assert.match(screen, /const beat = useRef\(new Animated\.Value\(0\)\)/);
  assert.match(screen, /setTimeout\(\(\) => \{\s*Animated\.sequence/);
  assert.match(screen, /spark/);

  // Real 3D stage stays: perspective, tilted orbiting rings, wordmark hinge.
  assert.ok((screen.match(/perspective:/g) || []).length >= 2);
  assert.match(screen, /rotateX: `\$\{64 \+ ring \* 5\}deg`/);
  assert.match(screen, /outputRange: \['74deg', '0deg'\]/);
  assert.match(screen, /useNativeDriver: true/);
  assert.match(screen, /LINKUP/);
});

test('the opening sits on the brand yellow, ink on top, exactly like the logo plate', () => {
  const screen = read('mobile/src/components/LinkupLaunchScreen.tsx');
  // The stage background is the logo yellow — the same value as the native
  // splash background, so cold start has no colour step into the app.
  assert.match(screen, /backgroundColor: '#FBE618',\s*\},/);
  const app = JSON.parse(read('mobile/app.json')).expo;
  const splash = app.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
  assert.equal(splash[1].backgroundColor, '#FBE618', 'launch screen must match the native splash colour');
  // Ink on yellow: every foreground mark is black, and the only light is the
  // white lift behind the cat.
  assert.match(screen, /letter: \{\s*color: '#0A0B0D',/);
  assert.match(screen, /trackFill: \{[^}]*backgroundColor: '#0A0B0D'/);
  assert.match(screen, /glow: \{[\s\S]{0,220}backgroundColor: 'rgba\(255,255,255,0\.72\)'/);
  // No leftover gold-on-black styling from the dark version.
  assert.doesNotMatch(screen, /backgroundColor: '#07080A'/);
  assert.doesNotMatch(screen, /color: '#F7F7F2'/);
});

test('the opening is actually VISIBLE for 3 seconds on web and native', () => {
  const screen = read('mobile/src/components/LinkupLaunchScreen.tsx');

  // 1. Three full seconds, defined once.
  assert.match(screen, /const HOLD_MS = 3000;/);
  assert.match(screen, /const hold = reduceMotion \? HOLD_REDUCED_MS : HOLD_MS;/);
  assert.match(screen, /holdMs: HOLD_MS/);

  // 2. It paints on a top-level surface, so no ancestor can clip it and no app
  //    content can be painted over it on either platform.
  assert.match(screen, /<Modal\s+visible=\{!gone\}\s+transparent\s+animationType="none"/);
  assert.match(screen, /onRequestClose=\{\(\) => finish\(true\)\}/);
  assert.match(screen, /root: \{\s*flex: 1,/);

  // 3. The clock only starts once the overlay has painted (onLayout), and that
  //    same frame dismisses the OS splash — otherwise the native splash sits on
  //    top of the animation and the member never sees it.
  assert.match(screen, /onLayout=\{onReady\}/);
  assert.match(screen, /void SplashScreen\.hideAsync\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(screen, /import \* as SplashScreen from 'expo-splash-screen'/);
  assert.match(screen, /if \(!armed \|\| gone\) return undefined;/);
  assert.match(screen, /const timer = setTimeout\(\(\) => finish\(\), hold\);/);

  // 4. A discarded mount can never eat the showing: the session flag is only
  //    written by a completed opening.
  assert.match(screen, /let shownThisSession = false;/);
  assert.match(screen, /finished\.current = true;\s*\/\/[\s\S]{0,220}shownThisSession = true;/);
  assert.doesNotMatch(screen, /shownThisSession = true;\s*let cancelled/);

  // 5. Skip, reduced motion and the mount point.
  assert.match(screen, /onPress=\{\(\) => finish\(true\)\}/);
  assert.match(screen, /Tap to skip/);
  assert.match(screen, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(screen, /const HOLD_REDUCED_MS = 1200;/);
  const app = read('mobile/App.tsx');
  assert.match(app, /<ErrorBoundary screenName="Launch Screen">\s*<LinkupLaunchScreen \/>/);
});

test('the opening is silent: no audio module, no bundled chime', () => {
  const screen = read('mobile/src/components/LinkupLaunchScreen.tsx');
  assert.doesNotMatch(screen, /launchSound|playLaunchSound|stopLaunchSound/);
  assert.doesNotMatch(screen, /expo-audio|expo-av/);
  assert.equal(fs.existsSync(new URL('../mobile/src/lib/launchSound.ts', import.meta.url)), false);
  assert.equal(fs.existsSync(new URL('../mobile/assets/sounds', import.meta.url)), false);
  assert.equal(fs.existsSync(new URL('../mobile/public/sounds', import.meta.url)), false);
  const pkg = JSON.parse(read('mobile/package.json'));
  assert.equal(pkg.dependencies['expo-audio'], undefined);
  assert.equal(pkg.dependencies['expo-av'], undefined);
  assert.match(screen, /silent: true/);
  // The launch still has a visual beat where the plug bites.
  assert.match(screen, /const BEAT_AT = 900;/);
});

test('the launch cat artwork is a real transparent PNG of the brand mark', () => {
  const png = bytes('mobile/assets/launch-cat.png');
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.ok(png.length > 40_000 && png.length < 900_000, 'one crisp mascot, still small enough for a cold start');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.ok(width >= 512 && width <= 1400, `width ${width}`);
  assert.ok(height >= 300 && height <= 1000, `height ${height}`);
  assert.equal(png[25], 6, 'RGBA, so the cat sits on the dark stage with no yellow box');
});
