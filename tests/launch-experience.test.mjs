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

test('the cold-open is a real 3D cat scene, not a flat spinner', () => {
  const screen = read('mobile/src/components/LinkupLaunchScreen.tsx');
  assert.match(screen, /require\('\.\.\/\.\.\/assets\/logo-cat\.png'\)/, 'the cat is the loading screen');
  // Real perspective + Y-axis rotation on the coin, and a 3D hinge on the wordmark.
  assert.ok((screen.match(/perspective:/g) || []).length >= 3);
  assert.match(screen, /rotateY: reduceMotion \? '0deg' : spinDeg/);
  assert.match(screen, /outputRange: \['74deg', '0deg'\]/, 'the wordmark hinges up out of the floor');
  assert.match(screen, /backfaceVisibility: 'hidden'/, 'two faces, front cat / back wordmark');
  assert.match(screen, /Animated\.loop/);
  assert.match(screen, /useNativeDriver: true/);
  assert.doesNotMatch(screen, /useNativeDriver: false/, 'every launch animation stays on the native driver');
  assert.match(screen, /LINKUP/);
});

test('the cold-open plays the chime, can be skipped, and never blocks the app', () => {
  const screen = read('mobile/src/components/LinkupLaunchScreen.tsx');
  assert.match(screen, /import \{ playLaunchSound, stopLaunchSound \} from '\.\.\/lib\/launchSound'/);
  assert.match(screen, /playLaunchSound\(\)/);
  assert.match(screen, /if \(skipped\) stopLaunchSound\(\)/);
  assert.match(screen, /Tap to skip/);
  assert.match(screen, /accessibilityLabel="Skip the LINKUP opening animation"/);
  assert.match(screen, /accessibilityRole="button"/);
  // Reduced motion gets a short calm fade with no loops and no spin.
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

test('the opening chime exists as a real, small, correctly formatted asset', () => {
  const asset = bytes('mobile/assets/sounds/linkup-open.wav');
  assert.ok(asset.length > 60_000, 'the chime must be a real recording, not a placeholder');
  assert.ok(asset.length < 400_000, 'launch audio stays small enough for a cold start');
  assert.equal(asset.toString('ascii', 0, 4), 'RIFF');
  assert.equal(asset.toString('ascii', 8, 12), 'WAVE');
  const format = asset.readUInt16LE(20);
  assert.equal(format, 1, 'PCM');
  const channels = asset.readUInt16LE(22);
  const sampleRate = asset.readUInt32LE(24);
  const byteRate = asset.readUInt32LE(28);
  const dataSize = asset.readUInt32LE(40);
  assert.ok([1, 2].includes(channels));
  assert.ok(sampleRate >= 22050 && sampleRate <= 48000, 'launch audio must sound clean on phones');
  const seconds = dataSize / byteRate;
  assert.ok(seconds > 1.5 && seconds < 3.2, `the chime should land with the animation, got ${seconds}s`);

  // The browser streams the same file from the public folder.
  const publicCopy = bytes('mobile/public/sounds/linkup-open.wav');
  assert.ok(publicCopy.equals(asset), 'one chime, two delivery paths');
  assert.match(read('mobile/scripts/postexport-web.js'), /copyRecursive\(publicDir, distDir\)/);
});

test('sound delivery is defensive on every platform and never breaks startup', () => {
  const sound = read('mobile/src/lib/launchSound.ts');
  // Web: one HTMLAudioElement on the mounted public path, with an autoplay retry.
  assert.match(sound, /const SOUND_PATH = '\/sounds\/linkup-open\.wav';/);
  assert.match(sound, /webAudio\.src = webAppPath\(SOUND_PATH\);/);
  assert.match(sound, /armFirstGesture/);
  assert.match(sound, /'pointerdown'/);
  // Native: a guarded require, so a binary without the module stays silent.
  assert.match(sound, /nativeModule = require\('expo-audio'\)/);
  const guard = sound.indexOf("try {\n      // Guarded on purpose");
  assert.ok(guard > 0);
  assert.match(sound, /catch \{\s*nativeModule = null;\s*\}/);
  // Last resort for anyone who cannot hear it.
  assert.match(sound, /Vibration\.vibrate/);
  assert.match(sound, /export function playLaunchSound\(\): void \{/);
  // No throw path may reach the render tree.
  assert.doesNotMatch(sound, /throw new Error/);
  const pkg = JSON.parse(read('mobile/package.json'));
  assert.match(pkg.dependencies['expo-audio'], /^~57\./);
});
