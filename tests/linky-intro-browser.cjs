// Browser proof for the Linky opening: the 3D cat, the member's name, the build
// it already knows, and the three-minute promise — in that order, once, and
// skippable. Runs the real component in Chromium with no network.
//
//   LAUNCH_BROWSER_TOOLS=<prefix>/node_modules node tests/linky-intro-browser.cjs
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
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'linkup-linky-intro-'));
const shots = process.env.LAUNCH_SHOTS;

const PROFILE = {
  uid: 'u1',
  displayName: 'Prince Tana',
  buildingName: 'Linkup',
  buildingOneLiner: 'the app that finds your co-founder while you sleep',
  missingSeat: 'Engineering',
  lookingFor: ['Cofounder'],
  city: 'Harare',
  country: 'Zimbabwe',
};

const source = `import React from 'react';
import { createRoot } from 'react-dom/client';
import Intro from '${mobile}/src/components/LinkyCatIntro.tsx';
window.introDone = 0;
const App = () => {
  const [open, setOpen] = React.useState(true);
  return (
    <div>
      <div id="thread" style={{position:'absolute',inset:0,background:'#111',color:'#fff',fontSize:'28px'}}>LINKY THREAD</div>
      <Intro profile={PROFILE} visible={open} onDone={() => { window.introDone += 1; setOpen(false); }} />
    </div>
  );
};
const PROFILE = ${JSON.stringify(PROFILE)};
createRoot(document.getElementById('root')).render(<App />);`;

const probe = () => {
  const root = document.querySelector('[data-testid="linky-cat-intro"]');
  const cat = document.querySelector('[data-testid="linky-cat-intro-cat"]');
  const line = (i) => document.querySelector(`[data-testid="linky-cat-intro-line-${i}"]`);
  const read = (i) => {
    const el = line(i);
    if (!el) return null;
    return { text: el.textContent, opacity: Number(getComputedStyle(el).opacity) };
  };
  return {
    present: !!root,
    cat: !!cat && cat.getBoundingClientRect().width > 100,
    line0: read(0),
    line1: read(1),
    line2: read(2),
    done: window.introDone,
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
      loader: { '.png': 'dataurl' },
      nodePaths: [path.join(mobile, 'node_modules')],
      define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
      resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.jsx', '.jsx', '.web.js', '.js', '.json'],
      alias: {
        'react-native': 'react-native-web',
        'react-native-svg': path.join(mobile, 'node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js'),
      },
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
    await page.waitForSelector('[data-testid="linky-cat-intro"]', { timeout: 5000 });

    // 1. The cat is there before anything is said.
    const first = await page.evaluate(probe);
    assert.equal(first.present, true, 'the opening must mount');
    assert.equal(first.cat, true, 'the brand cat must be rendered');
    assert.equal(first.done, 0, 'it must not be finished on arrival');

    // 2. Sample the three beats on a real clock, inside the page.
    await page.evaluate(() => {
      window.__trace = [];
      const started = performance.now();
      const tick = () => {
        const read = (i) => {
          const el = document.querySelector(`[data-testid="linky-cat-intro-line-${i}"]`);
          return el ? { text: el.textContent, opacity: Number(getComputedStyle(el).opacity) } : null;
        };
        window.__trace.push({
          t: Math.round(performance.now() - started),
          present: !!document.querySelector('[data-testid="linky-cat-intro"]'),
          line0: read(0), line1: read(1), line2: read(2),
        });
        if (performance.now() - started < 5200) setTimeout(tick, 50);
      };
      tick();
    });
    await page.waitForTimeout(5400);

    const trace = await page.evaluate(() => window.__trace.slice());
    const opaque = (sample, key) => sample[key] && sample[key].opacity > 0.5 && sample[key].text;
    const firstOpaque = (key) => trace.find((sample) => opaque(sample, key));

    const beat0 = firstOpaque('line0');
    const beat1 = firstOpaque('line1');
    const beat2 = firstOpaque('line2');
    assert.ok(beat0, 'the name must appear');
    assert.equal(beat0.line0.text, 'Hi Prince.', 'the first thing it says is their name');
    assert.ok(beat0.t < 1400, `the name must land early, got ${beat0.t}ms`);
    assert.ok(beat1 && beat1.t > beat0.t, 'the build must follow the name');
    assert.match(beat1.line1.text, /Linkup/, 'Linky must name the project it already knows');
    assert.match(beat1.line1.text, /Engineering/, 'and the chair that is empty');
    assert.ok(beat2 && beat2.t > beat1.t, 'the promise must come last');
    assert.match(beat2.line2.text, /three minutes/, 'and it must promise the three minutes');

    // 3. It clears itself off the thread, once.
    const after = await page.evaluate(probe);
    assert.equal(after.present, false, 'the opening must clear itself');
    assert.equal(after.done, 1, 'onDone must fire exactly once');
    assert.equal((await page.textContent('#thread')).trim(), 'LINKY THREAD');

    // 4. Frames, for the human eye (screenshots are taken on a separate page so
    //    they cannot stretch the clock above).
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      const shotPage = await browser.newPage({ viewport: { width: 420, height: 900 } });
      await shotPage.goto(url);
      await shotPage.waitForSelector('[data-testid="linky-cat-intro"]');
      for (const [wait, name] of [[900, 'linky-1-name'], [1100, 'linky-2-build'], [1100, 'linky-3-promise']]) {
        await shotPage.waitForTimeout(wait);
        await shotPage.screenshot({ path: path.join(shots, `${name}.png`) });
      }
      await shotPage.close();
    }

    // 5. A tap skips it immediately.
    const page2 = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await page2.goto(url);
    await page2.waitForSelector('[data-testid="linky-cat-intro"]', { timeout: 5000 });
    await page2.mouse.click(210, 450);
    await page2.waitForTimeout(500);
    assert.equal(await page2.$('[data-testid="linky-cat-intro"]'), null, 'a tap must skip the opening');
    assert.equal(await page2.evaluate(() => window.introDone), 1, 'skipping still finishes the opening once');

    assert.equal(errors.length, 0, `page errors: ${errors.join(' | ')}`);
    console.log(
      `linky-intro-browser: OK — cat at 0ms, "${beat0.line0.text}" at ${beat0.t}ms, build at ${beat1.t}ms, promise at ${beat2.t}ms, gone after, skippable`,
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
