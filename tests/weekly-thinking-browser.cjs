// Browser proof for the weekly wait: the 3D cat thinks for ~4 seconds, the four
// beats land in order, and a tap always gets out. Real component, real clock,
// no network.
//
//   LAUNCH_BROWSER_TOOLS=<prefix>/node_modules node tests/weekly-thinking-browser.cjs
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
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'linkup-weekly-wait-'));
const shots = process.env.LAUNCH_SHOTS;

const PROFILE = {
  uid: 'u1',
  displayName: 'Prince Tana',
  buildingName: 'Linkup',
  buildingOneLiner: 'the app that finds your co-founder while you sleep',
  missingSeat: 'Engineering',
  lookingFor: ['Cofounder'],
};

const source = `import React from 'react';
import { createRoot } from 'react-dom/client';
import Thinking from '${mobile}/src/components/WeeklyMatchThinking.tsx';
window.thinkingDone = 0;
const App = () => {
  const [open, setOpen] = React.useState(true);
  return (
    <div>
      <div id="weekly-card" style={{position:'absolute',inset:0,background:'#111',color:'#fff',fontSize:'28px'}}>THIS WEEK'S PERSON</div>
      <Thinking profile={PROFILE} visible={open} onDone={() => { window.thinkingDone += 1; setOpen(false); }} />
    </div>
  );
};
const PROFILE = ${JSON.stringify(PROFILE)};
createRoot(document.getElementById('root')).render(<App />);`;

const probe = () => {
  const root = document.querySelector('[data-testid="weekly-thinking"]');
  const cat = document.querySelector('[data-testid="weekly-thinking-cat"]');
  const read = (i) => {
    const el = document.querySelector(`[data-testid="weekly-thinking-line-${i}"]`);
    return el ? { text: el.textContent, opacity: Number(getComputedStyle(el).opacity) } : null;
  };
  return {
    present: !!root,
    cat: !!cat && cat.getBoundingClientRect().width > 100,
    line0: read(0), line1: read(1), line2: read(2), line3: read(3),
    status: (document.querySelector('[data-testid="weekly-thinking-status"]') || {}).textContent || '',
    done: window.thinkingDone,
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
    await page.waitForSelector('[data-testid="weekly-thinking"]', { timeout: 5000 });

    // 1. The cat is thinking before anything else is said.
    const first = await page.evaluate(probe);
    assert.equal(first.present, true, 'the wait must mount');
    assert.equal(first.cat, true, 'the 3D brand cat must be on screen');
    assert.equal(first.done, 0);

    // 2. Four beats, in order, on a real clock inside the page.
    await page.evaluate(() => {
      window.__trace = [];
      const started = performance.now();
      const tick = () => {
        const read = (i) => {
          const el = document.querySelector(`[data-testid="weekly-thinking-line-${i}"]`);
          return el ? { text: el.textContent, opacity: Number(getComputedStyle(el).opacity) } : null;
        };
        window.__trace.push({
          t: Math.round(performance.now() - started),
          present: !!document.querySelector('[data-testid="weekly-thinking"]'),
          line0: read(0), line1: read(1), line2: read(2), line3: read(3),
        });
        if (performance.now() - started < 6000) setTimeout(tick, 50);
      };
      tick();
    });

    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(shots, 'wait-1-thinking.png') });
      await page.waitForTimeout(1600);
      await page.screenshot({ path: path.join(shots, 'wait-2-weighing.png') });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(shots, 'wait-3-deciding.png') });
    }

    await page.waitForFunction(() => (window.__trace || []).some((s) => !s.present), { timeout: 9000 }).catch(() => {});
    await page.waitForTimeout(400);

    const trace = await page.evaluate(() => window.__trace.slice());
    const firstOpaque = (key) => trace.find((s) => s[key] && s[key].opacity > 0.5 && s[key].text);
    const beats = [firstOpaque('line0'), firstOpaque('line1'), firstOpaque('line2'), firstOpaque('line3')];

    assert.ok(beats.every(Boolean), 'all four beats must appear');
    assert.equal(beats[0].line0.text, 'The cat is thinking.');
    assert.match(beats[1].line1.text, /could build Linkup/);
    assert.match(beats[2].line2.text, /Engineering seat/);
    assert.match(beats[3].line3.text, /One person\. Chosen for you\. About to appear\./);
    for (let i = 1; i < beats.length; i += 1) {
      assert.ok(beats[i].t > beats[i - 1].t, `beat ${i} must land after beat ${i - 1}`);
    }

    // 3. It lasts about four seconds: still up past 3.5s, gone before ~5s.
    const seen = trace.filter((s) => s.present);
    assert.ok(seen[seen.length - 1].t >= 3600, `must hold for ~4s, last seen ${seen[seen.length - 1].t}ms`);
    const gone = trace.find((s) => !s.present);
    assert.ok(gone && gone.t <= 5200, `must clear shortly after 4s, gone at ${gone && gone.t}ms`);

    const after = await page.evaluate(probe);
    assert.equal(after.present, false, 'the wait must clear itself');
    assert.equal(after.done, 1, 'onDone fires exactly once — the card is revealed, once');
    assert.equal((await page.textContent('#weekly-card')).trim(), "THIS WEEK'S PERSON");

    // 4. A tap skips it, immediately.
    const page2 = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await page2.goto(url);
    await page2.waitForSelector('[data-testid="weekly-thinking"]', { timeout: 5000 });
    await page2.mouse.click(210, 450);
    await page2.waitForTimeout(600);
    assert.equal(await page2.$('[data-testid="weekly-thinking"]'), null, 'a tap must skip the wait');
    assert.equal(await page2.evaluate(() => window.thinkingDone), 1);

    assert.equal(errors.length, 0, `page errors: ${errors.join(' | ')}`);
    console.log(
      `weekly-thinking-browser: OK — beats at ${beats.map((b) => b.t).join('/')}ms, held ${seen[seen.length - 1].t}ms, gone by ${gone.t}ms, skippable`,
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
