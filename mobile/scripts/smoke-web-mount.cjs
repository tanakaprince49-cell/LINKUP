// Optional real-browser smoke test. Requires a web export and Playwright with
// Chromium installed. All external browser requests are blocked, and API calls
// hit a local echo stub: this never signs in, writes Firebase, or charges money.
// This models the landing proxy; it does not prove a production Vercel deploy.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const mobile = path.resolve(__dirname, '..');
const dist = path.join(mobile, 'dist');
const config = JSON.parse(fs.readFileSync(path.join(mobile, '..', 'vercel.json'), 'utf8'));
const MARKETING_HTML = '<!doctype html><html><head><title>Marketing isolation fixture</title></head><body>MARKETING_PAGE_UNCHANGED<script src="/assets/marketing.js"></script></body></html>';
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };

function fileAt(url) {
  const p = path.resolve(dist, '.' + url.split('?')[0]);
  return p.startsWith(dist + path.sep) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
}
function destination(url) {
  if (fileAt(url) || url.startsWith('/api/')) return url;
  for (const rule of config.rewrites) {
    const match = url.match(new RegExp('^' + rule.source.replace(':path*', '(.*)') + '$'));
    if (match) return rule.destination.replace(':path*', match[1] || '').replace('$1', match[1] || '');
  }
  return url;
}
const upstream = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://test');
  const target = destination(decodeURI(url.pathname));
  if (target.startsWith('/api/')) {
    const parts = [];
    for await (const part of req) parts.push(part);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ testStub: true, path: target, query: url.search, method: req.method, body: Buffer.concat(parts).toString() }));
    return;
  }
  const file = fileAt(target);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});
let upstreamPort;
const landing = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://test');
  if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
    const upstreamPath = (url.pathname.slice(4) || '/') + url.search;
    const proxy = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: upstreamPath, method: req.method, headers: req.headers }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    proxy.on('error', () => { res.writeHead(502); res.end('Test proxy failed'); });
    req.pipe(proxy);
  } else if (url.pathname === '/assets/marketing.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end('window.MARKETING_SCRIPT_LOADED = true;');
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end(MARKETING_HTML);
  }
});
const listen = (server) => new Promise((resolve) => server.listen(0, '0.0.0.0', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });

(async () => {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'Run npm run build:web first');
  let browser;
  try {
    upstreamPort = await listen(upstream);
    const landingPort = await listen(landing);
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    for (const [name, origin, base, width] of [
      ['original-root', `http://127.0.0.1:${upstreamPort}`, '', 1150],
      ['landing-prefix-proxy', `http://127.0.0.1:${landingPort}`, '/app', 1150],
      ['mobile-prefix-proxy', `http://127.0.0.1:${landingPort}`, '/app', 390],
    ]) {
      const context = await browser.newContext({ viewport: { width, height: 850 } });
      // No provider calls, sign-ins, production data or analytics in this test.
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        // Fulfill the app's connectivity probe locally so blocking external
        // providers does not intentionally replace the UI with its offline screen.
        if (['clients3.google.com', 'www.gstatic.com'].includes(url.hostname) && url.pathname === '/generate_204') {
          return route.fulfill({ status: 204 });
        }
        return route.abort();
      });
      const page = await context.newPage();
      const errors = [];
      const escapedRequests = [];
      let watchApp = false;
      page.on('pageerror', (error) => { errors.push(error.message); console.error(`[${name}] browser error:`, error.message); });
      page.on('request', (req) => {
        const u = new URL(req.url());
        if (watchApp && base && u.origin === origin && !u.pathname.startsWith('/app/')) escapedRequests.push(u.pathname);
      });
      if (base) {
        await page.goto(origin + '/');
        assert.ok((await page.textContent('body')).includes('MARKETING_PAGE_UNCHANGED'));
        await page.evaluate(async () => {
          const cache = await caches.open('marketing-sentinel');
          await cache.put('/marketing-test-entry', new Response('KEEP_ME'));
        });
      }
      watchApp = true;
      await page.goto(origin + base + '/landing', { waitUntil: 'domcontentloaded' });
      await page.getByText('Continue with email', { exact: true }).waitFor({ timeout: 20000 }).catch(async (error) => {
        console.error(`[${name}] URL:`, page.url());
        console.error(`[${name}] body:`, (await page.textContent('body')).slice(0, 1400));
        throw error;
      });
      assert.equal(await page.evaluate(() => window.__LINKUP_BASE_PATH__), base);
      assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'index,follow');
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), 'https://www.linkupbuild.com/app/landing');
      assert.ok((await page.title()).includes('Cofounder Matching'));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow');
      const emailButton = await page.getByText('Continue with email', { exact: true }).boundingBox();
      assert.ok(emailButton && emailButton.x >= 0 && emailButton.x + emailButton.width <= width, 'CTA clipped horizontally');
      if (base) {
        const output = path.join(mobile, '..', 'docs', 'qa');
        fs.mkdirSync(output, { recursive: true });
        await page.screenshot({ path: path.join(output, `professional-landing-${width}.png`), fullPage: true });
      }
      await page.getByText('Continue with email', { exact: true }).click();
      await page.waitForURL(origin + base + '/login', { timeout: 10000 });
      await page.getByPlaceholder('you@example.com').waitFor();
      assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex,follow');
      assert.equal(await page.locator('link[rel="canonical"]').count(), 0);
      assert.equal(await page.locator('#linkup-app-schema').count(), 0);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByPlaceholder('you@example.com').waitFor({ timeout: 20000 }).catch(async (error) => {
        console.error(`[${name}] reload URL:`, page.url());
        console.error(`[${name}] reload body:`, (await page.textContent('body')).slice(0, 1400));
        throw error;
      });
      await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).some((r) => r.active), undefined, { timeout: 15000 });
      const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope));
      assert.deepEqual(scopes, [origin + base + '/']);
      const manifest = await page.evaluate(async () => {
        const url = document.querySelector('link[rel="manifest"]').href;
        const data = await (await fetch(url)).json();
        return { url, scope: new URL(data.scope, url).href, start: new URL(data.start_url, url).href };
      });
      assert.equal(manifest.scope, origin + base + '/');
      assert.equal(manifest.start, origin + base + '/');
      // Check Chromium's processed manifest, not a hand-rolled URL assumption:
      // relative id values resolve against the origin, unlike start_url/scope.
      const cdp = await context.newCDPSession(page);
      const parsedManifest = (await cdp.send('Page.getAppManifest')).manifest;
      assert.equal(parsedManifest.id, origin + base + '/');
      assert.equal(parsedManifest.startUrl, origin + base + '/');
      assert.equal(parsedManifest.scope, origin + base + '/');
      await cdp.detach();
      const echo = await page.evaluate(async (base) => (await fetch(base + '/api/linky?mount-test=1', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ check: 'transport-only' }),
      })).json(), base);
      assert.equal(echo.testStub, true);
      assert.equal(echo.path, '/api/linky');
      assert.equal(echo.query, '?mount-test=1');
      assert.equal(echo.method, 'POST');
      assert.deepEqual(JSON.parse(echo.body), { check: 'transport-only' });
      if (base) {
        assert.ok((await page.evaluate(() => caches.keys())).includes('marketing-sentinel'));
        // A new navigation to the marketing root must not be controlled by
        // LINKUP's worker or return its offline app shell.
        const marketing = await context.newPage();
        await marketing.goto(origin + '/', { waitUntil: 'load' });
        assert.ok((await marketing.textContent('body')).includes('MARKETING_PAGE_UNCHANGED'));
        assert.equal(await marketing.evaluate(() => window.MARKETING_SCRIPT_LOADED), true);
        assert.equal(await marketing.evaluate(() => navigator.serviceWorker.controller?.scriptURL || null), null);
        assert.equal(await marketing.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/'))), false);
        await marketing.close();
      }
      const legal = await context.newPage();
      await legal.goto(origin + base + '/privacy-policy', { waitUntil: 'load' });
      const legalLinks = await legal.locator('a').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
      assert.ok(legalLinks.includes('https://www.linkupbuild.com/app/child-safety-standards'), 'legal-page cross-link must point to the canonical app safety page');
      await legal.close();
      // The public CTA may use bare /app, not only /app/landing.
      const entry = await context.newPage();
      entry.on('pageerror', (error) => errors.push(error.message));
      await entry.goto(origin + (base || '/'), { waitUntil: 'domcontentloaded' });
      await entry.getByText('Continue with email', { exact: true }).waitFor({ timeout: 20000 });
      if (base) assert.ok(new URL(entry.url()).pathname.startsWith('/app/'));
      await entry.close();
      assert.deepEqual(escapedRequests, [], 'app requests escaped the /app namespace');
      assert.deepEqual(errors, [], 'browser runtime errors');
      console.log(`PASS ${name}: app load, email navigation, refresh, manifest, scoped worker, API transport${base ? ', marketing-page/cache isolation' : ''}`);
      await context.close();
    }
    console.log('Browser smoke passed. Real sign-in, payments and production deployment still require verification.');
  } finally {
    await browser?.close();
    await close(landing);
    await close(upstream);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
