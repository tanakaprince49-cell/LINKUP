// Offline browser proof for the opening screen. It mounts the REAL
// LinkupLaunchScreen next to a fake opaque "app" surface and shows, in
// Chromium, that:
//
//   1. the overlay is painted on top of the app, brand yellow, with the cat;
//   2. painting it dismisses the OS splash;
//   3. it stays up for a full three seconds and is gone shortly after;
//   4. a tap skips it immediately.
//
// No network, no auth, no backend. Install the tools in a scratch prefix and
// pass LAUNCH_BROWSER_TOOLS=<prefix>/node_modules. Set LAUNCH_SHOTS=<dir> to
// keep screenshots of the timeline.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');

const tools = process.env.LAUNCH_BROWSER_TOOLS || path.resolve('node_modules');
const { build } = require(path.join(tools, 'esbuild'));
const { chromium } = require(path.join(tools, 'playwright'));

const root = path.resolve(__dirname, '..');
const mobile = path.join(root, 'mobile');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'linkup-launch-browser-'));
const shots = process.env.LAUNCH_SHOTS;

// The fake app paints an opaque red screen. If the opening screen wins the
// centre of the viewport, it is genuinely on top — not merely present in DOM.
const source = `import React from 'react';
import { createRoot } from 'react-dom/client';
import Screen from '${mobile}/src/components/LinkupLaunchScreen.tsx';
window.splashHidden = 0;
createRoot(document.getElementById('root')).render(
  <div>
    <div id="fake-app" style={{position:'absolute',top:0,left:0,right:0,bottom:0,background:'#ff0000',color:'#fff',fontSize:'40px'}}>APP</div>
    <Screen />
  </div>
);`;

const probeBody = () => {
  const el = document.querySelector('[data-testid="linkup-launch-screen"]');
  if (!el) return { mounted: false };
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const centre = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2));
  const cat = document.querySelector('[data-testid="linkup-launch-cat"]');
  return {
    mounted: true,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    background: style.backgroundColor,
    opacity: Number(style.opacity),
    paintsOnTop: !!centre && (centre === el || el.contains(centre)),
    catVisible: !!cat && cat.getBoundingClientRect().width > 100,
    splashHidden: window.splashHidden,
  };
};

(async () => {
  let browser;
  let server;
  try {
    await build({
      stdin: { contents: source, resolveDir: mobile, loader: 'tsx' },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      outfile: path.join(scratch, 'app.js'),
      jsx: 'automatic',
      // Metro hands assets back as a module URI; mirror that for the browser.
      loader: { '.png': 'dataurl' },
      nodePaths: [path.join(mobile, 'node_modules')],
      define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
      resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.jsx', '.jsx', '.web.js', '.js', '.json'],
      alias: {
        'react-native': 'react-native-web',
        'react-native-svg': path.join(mobile, 'node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js'),
      },
      plugins: [{
        name: 'offline-adapters',
        setup(b) {
          // The OS splash is a native surface; in the browser it is a no-op we
          // record, so the test can prove the overlay dismisses it.
          b.onResolve({ filter: /^expo-splash-screen$/ }, () => ({ path: 'expo-splash-screen', namespace: 'offline' }));
          b.onLoad({ filter: /.*/, namespace: 'offline' }, () => ({
            loader: 'js',
            contents: 'export const hideAsync=async()=>{window.splashHidden+=1};export const preventAutoHideAsync=async()=>{};',
          }));
        },
      }],
    });

    fs.writeFileSync(path.join(scratch, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;height:100%;background:#101010}
      #root{position:relative;width:390px;height:844px;overflow:hidden}
    </style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);

    server = http.createServer((req, res) => {
      const file = req.url === '/' ? '/index.html' : req.url;
      const full = path.join(scratch, file);
      if (!full.startsWith(scratch) || !fs.existsSync(full)) { res.statusCode = 404; res.end('nope'); return; }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(fs.readFileSync(full));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(url);
    await page.waitForSelector('[data-testid="linkup-launch-screen"]', { timeout: 5000 });

    // 1. On screen immediately, on top, brand yellow, with the cat, splash gone.
    const first = await page.evaluate(probeBody);
    assert.equal(first.mounted, true, 'the opening screen must mount');
    assert.equal(first.background, 'rgb(251, 230, 24)', `brand yellow ground, got ${first.background}`);
    assert.ok(first.width >= 380 && first.height >= 840, `must fill the viewport, got ${first.width}x${first.height}`);
    assert.equal(first.paintsOnTop, true, 'the opening screen must paint above the app');
    assert.equal(first.catVisible, true, 'the brand cat must be rendered');
    assert.ok(first.splashHidden >= 1, 'painting the overlay must dismiss the OS splash');

    // 2. Wall-clock timeline, sampled inside the page so screenshots can't
    //    stretch it. Sample until the overlay is gone for 3 samples in a row.
    await page.evaluate(() => {
      window.__trace = [];
      const started = performance.now();
      let misses = 0;
      const tick = () => {
        const present = !!document.querySelector('[data-testid="linkup-launch-screen"]');
        window.__trace.push({ t: Math.round(performance.now() - started), present });
        misses = present ? 0 : misses + 1;
        if (misses < 3 && performance.now() - started < 8000) setTimeout(tick, 60);
      };
      tick();
    });

    const timeline = async () => page.evaluate(() => window.__trace.slice());
    const shotTimes = [{ at: 400, name: 't-0.4s' }, { at: 1500, name: 't-1.5s' }, { at: 2700, name: 't-2.7s' }];
    for (const shot of shotTimes) {
      if (!shots) continue;
      fs.mkdirSync(shots, { recursive: true });
      await page.waitForTimeout(shot.at);
      await page.screenshot({ path: path.join(shots, `${shot.name}.png`) });
    }
    await page.waitForTimeout(1600);

    const trace = await timeline();
    const seen = trace.filter((sample) => sample.present).map((sample) => sample.t);
    const firstGone = trace.find((sample) => !sample.present);
    assert.ok(seen.length > 10, `the overlay must be sampled on screen, got ${seen.length} samples`);
    assert.ok(seen[0] <= 400, `must be visible almost immediately, first seen at ${seen[0]}ms`);
    assert.ok(seen[seen.length - 1] >= 2600, `must stay up a full three seconds, last seen at ${seen[seen.length - 1]}ms`);
    assert.ok(firstGone && firstGone.t <= 3800,
      `must be gone shortly after three seconds, gone at ${firstGone && firstGone.t}ms`);

    const after = await page.evaluate(probeBody);
    assert.equal(after.mounted, false, 'the opening screen must be gone after the hold');
    assert.equal((await page.textContent('#fake-app')).trim(), 'APP', 'the app underneath must be revealed');
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 't-after.png') }); }

    // 3. A tap skips it immediately.
    const page2 = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await page2.goto(url);
    await page2.waitForSelector('[data-testid="linkup-launch-screen"]', { timeout: 5000 });
    await page2.mouse.click(210, 450);
    await page2.waitForTimeout(500);
    assert.equal(await page2.$('[data-testid="linkup-launch-screen"]'), null, 'a tap must skip the opening');

    assert.equal(errors.length, 0, `page errors across the run: ${errors.join(' | ')}`);
    console.log(`launch-browser: OK — painted on top, brand yellow, held ${seen[seen.length - 1]}ms, gone by ${firstGone.t}ms, skippable on tap`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
