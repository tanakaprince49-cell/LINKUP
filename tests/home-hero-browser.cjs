// The home hero, rendered for real: greeting by name, the A-PLAYERS report,
// the bold promise, and the hand-off to this week's person.
//
//   LAUNCH_BROWSER_TOOLS=<prefix>/node_modules node tests/home-hero-browser.cjs
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
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'linkup-home-hero-'));
const shots = process.env.LAUNCH_SHOTS;

const source = `import React from 'react';
import { createRoot } from 'react-dom/client';
import Hero from '${mobile}/src/components/HomeHero.tsx';
const PROFILE = { uid: 'u1', displayName: 'Tanaka Moyo', buildingName: 'Linkup', missingSeat: 'Engineering' };
createRoot(document.getElementById('root')).render(
  <div style={{ padding: 16 }}>
    <div style={{ background: '#fff', borderRadius: 20, padding: 18, marginBottom: 16 }}>
      <Hero profile={PROFILE} hasMatch isDark={false} />
    </div>
    <div style={{ background: '#12151E', borderRadius: 20, padding: 18 }}>
      <Hero profile={PROFILE} hasMatch={false} isDark />
    </div>
  </div>
);`;

const probe = () => {
  const text = (id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return el ? el.textContent : null;
  };
  const promiseEl = document.querySelector('[data-testid="home-hero-promise"]');
  return {
    hero: !!document.querySelector('[data-testid="home-hero"]'),
    greeting: text('home-hero-greeting'),
    lead: text('home-hero-lead'),
    body: text('home-hero-body'),
    promise: text('home-hero-promise'),
    promiseWeight: promiseEl ? getComputedStyle(promiseEl).fontWeight : '',
    cta: text('home-hero-cta'),
    heroCount: document.querySelectorAll('[data-testid="home-hero"]').length,
  };
};

(async () => {
  let browser;
  let server;
  try {
    // The icon set is not what this test is about, and its barrel import does
    // not survive a bare esbuild bundle — stub the one glyph the hero uses.
    const iconStub = path.join(scratch, 'lucide-stub.js');
    fs.writeFileSync(iconStub, 'const I=()=>null;export const ArrowDown=I;export default I;');
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
        'lucide-react-native': iconStub,
      },
    });

    fs.writeFileSync(path.join(scratch, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:#F4F5F0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
      #root{width:390px}
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
    const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(url);
    await page.waitForSelector('[data-testid="home-hero"]', { timeout: 5000 });

    const hero = await page.evaluate(probe);

    // 1. The greeting is the member's own name, by the actual time of day.
    const hour = new Date().getHours();
    const expected = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    assert.equal(hero.greeting, `Good ${expected}, Tanaka.`, `greeting, got ${hero.greeting}`);

    // 2. The report, word for word.
    // U+2011 is a non-breaking hyphen, so "A-PLAYERS" can never split. It is
    // visually identical to a hyphen.
    assert.equal(hero.lead.replace(/\u2011/g, '-'), "We've been looking.\nAnd we found some A-PLAYERS");
    assert.match(hero.lead, /A\u2011PLAYERS/);
    // One visual line for the whole highlighted word.
    const lines = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="home-hero-lead"]');
      const style = getComputedStyle(el);
      return Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight));
    });
    assert.ok(lines <= 3, `the lead should be two or three lines, got ${lines}`);
    assert.equal(hero.body, 'People building ambitious things, making bold moves, and bringing serious talent to the table.');
    // 3. The promise, and it is genuinely bold.
    assert.equal(hero.promise, 'Your next introduction could be the one that changes everything.');
    assert.ok(Number(hero.promiseWeight) >= 900 || hero.promiseWeight === 'bold',
      `the promise line must be bold, got weight ${hero.promiseWeight}`);
    // 4. The hand-off, when there is somebody to meet.
    assert.equal(hero.cta, 'Ready to meet your people?');
    // The dark variant renders too, and without a match it does not promise a person.
    assert.equal(hero.heroCount, 2);
    const allCtas = await page.$$eval('[data-testid="home-hero"]', (nodes) => nodes.map((node) => !!node.querySelector('[data-testid="home-hero-cta"]')));
    assert.deepEqual(allCtas, [true, false], 'the CTA only appears when there is a match');

    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, 'home-hero.png'), fullPage: true });
    }

    assert.equal(errors.length, 0, `page errors: ${errors.join(' | ')}`);
    console.log(`home-hero-browser: OK — "${hero.greeting}", A-PLAYERS lead, bold promise (${hero.promiseWeight}), CTA only with a match`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exit(1); });
