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

  const iconComponent = read('mobile/src/components/LinkyCatTabIcon.tsx');
  assert.match(iconComponent, /require\('\.\.\/\.\.\/assets\/logo-cat\.png'\)/);
  assert.match(iconComponent, /focused/);
  // Focused, the cat is outlined in LINKUP gold.
  assert.match(iconComponent, /#FBE618/);
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

test('the cold-open can be skipped, and never blocks the app', () => {
  const screen = read('mobile/src/components/LinkupLaunchScreen.tsx');
  assert.match(screen, /onPress=\{\(\) => finish\(true\)\}/);
  assert.match(screen, /Tap to skip/);
  assert.match(screen, /accessibilityLabel="Skip the LINKUP opening animation"/);
  assert.match(screen, /accessibilityRole="button"/);
  // Reduced motion gets a short calm fade with no loops and no sway.
  assert.match(screen, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(screen, /const hold = reduceMotion \? 820 : 2600;/);
  assert.match(screen, /if \(!reduceMotion\) \{/);
  // Once per session: a remount (theme change, fast refresh) never replays it.
  assert.match(screen, /let shownThisSession = false;/);
  assert.match(screen, /useState\(\(\) => shownThisSession\)/);
  // It is mounted above the app inside its own error boundary, so a launch
  // animation bug can never take the app down with it.
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
