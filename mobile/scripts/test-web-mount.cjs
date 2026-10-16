// No network, Firebase credentials, or payments are used by these regressions.
// Run: node --test scripts/test-web-mount.cjs
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const mobile = path.resolve(__dirname, '..');
const repo = path.resolve(mobile, '..');
const read = (file) => fs.readFileSync(path.join(mobile, file), 'utf8');
let navigation, checkoutReturnUrls;
before(async () => {
  navigation = await import('@react-navigation/core');
  ({ checkoutReturnUrls } = await import('../../api/_webReturns.js'));
});

function evaluateTs(source, globals = {}, mocks = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { module, exports: module.exports, ...globals, require: (name) => {
    assert.ok(Object.hasOwn(mocks, name), `unexpected import: ${name}`);
    return mocks[name];
  } };
  vm.runInNewContext(js, context);
  return { exports: module.exports, context };
}
function paths(pathname = '/') {
  return evaluateTs(read('src/lib/webPaths.ts'), { location: { pathname } }).exports;
}
function linking(pathname, platform = 'web') {
  // Exercise the ACTUAL config from App.tsx without loading native UI modules.
  const source = read('App.tsx').match(/const WEB_BASE_PATH = [\s\S]*?\n};\n\n\/\/ Import custom theme settings/)[0]
    .replace(/\n\/\/ Import custom theme settings$/, '\nglobalThis.testLinking = linking;');
  return evaluateTs(source, {
    Platform: { OS: platform }, ExpoLinking: { createURL: () => 'linkup://' },
    ...paths(pathname), getPathFromState: navigation.getPathFromState, getStateFromPath: navigation.getStateFromPath,
  }).context.testLinking;
}

test('mount boundary and internal URL prefixing are exact', () => {
  const p = paths();
  for (const value of ['/app', '/app/', '/app/login']) assert.equal(p.webBasePath(value), '/app');
  for (const value of ['/', '/landing', '/application', '/apple', '/app-other', '/x/app']) assert.equal(p.webBasePath(value), '');
  assert.equal(paths('/app/login').webAppPath('/api/linky?x=1'), '/app/api/linky?x=1');
  assert.equal(paths('/app/login').webAppPath('/app/api/linky'), '/app/api/linky');
  assert.equal(paths('/app/login').webAppPath('/'), '/app/');
  assert.equal(paths('/login').webAppPath('/api/linky'), '/api/linky');
  assert.throws(() => p.webAppPath('https://example.com'), /origin-relative/);
  assert.throws(() => p.webAppPath('//example.com'), /origin-relative/);
  assert.equal(p.scopedNavigationPath('/app?x=1', '/app'), '/app/?x=1');
  assert.equal(p.webRoutePath('/app/profile/member'), '/profile/member');
  assert.equal(p.webRoutePath('/app/login'), '/login');
  assert.equal(p.webRoutePath('/app/'), '/');
  assert.equal(p.webRoutePath('/login'), '/login');
});

test('real React Navigation config parses and serializes root and /app deep links', () => {
  for (const base of ['', '/app']) {
    const l = linking(`${base}/landing`);
    for (const route of ['/landing', '/login', '/profile/member-123', '/chat/a_b', '/linky/settings', '/inbox']) {
      const state = l.getStateFromPath(base + route, l.config);
      assert.ok(state, `state for ${base + route}`);
      assert.equal(l.getPathFromState(state, l.config), base + route);
    }
    const state = l.getStateFromPath(base || '/', l.config);
    assert.equal(l.getPathFromState(state, l.config), `${base}/`);
  }
  const config = linking('/app/login').config;
  assert.equal(navigation.getStateFromPath('/login', config), undefined);
  const native = linking('/app/login', 'android');
  assert.equal(native.config.path, '');
  assert.equal(native.getPathFromState(navigation.getStateFromPath('/login', native.config), native.config), '/login');
});

test('logout route replacement stays inside the active app mount', () => {
  const source = read('src/contexts/AuthContext.tsx').match(/const replaceWebRoute = [\s\S]*?\n};/)[0];
  for (const [pathname, expected] of [['/app/login', '/app/landing'], ['/login', '/landing']]) {
    const calls = [];
    evaluateTs(source + "\nreplaceWebRoute('/landing');", {
      ...paths(pathname), Platform: { OS: 'web' }, history: { replaceState: (state, title, url) => calls.push(url) },
    });
    assert.deepEqual(calls, [expected]);
  }
});

test('shared public profiles use the canonical custom domain on every platform', () => {
  const source = read('src/lib/profileLinks.ts');
  for (const [origin, pathname, expected] of [
    ['https://www.linkupbuild.com', '/app/profile/a', 'https://www.linkupbuild.com/app'],
    ['https://linkupbuild.com', '/app/landing', 'https://linkupbuild.com/app'],
    ['https://linkup-muqu.vercel.app', '/landing', 'https://linkup-muqu.vercel.app'],
  ]) {
    const mod = evaluateTs(source, { location: { origin, pathname }, process: { env: {} } }, {
      'react-native': { Platform: { OS: 'web' } }, './webPaths': paths(pathname),
    }).exports;
    assert.equal(mod.publicProfileLink('member 1'), 'https://www.linkupbuild.com/app/p/member%201');
  }
  const native = evaluateTs(source, { process: { env: {} } }, {
    'react-native': { Platform: { OS: 'android' } }, './webPaths': paths(),
  }).exports;
  assert.equal(native.linkupWebBaseUrl(), 'https://linkup-muqu.vercel.app');
  assert.equal(native.profileIdFromLink('https://www.linkupbuild.com/app/p/member-1'), 'member-1');
  assert.equal(native.profileIdFromLink('linkup://profile/member-1'), 'member-1');
  assert.equal(native.profileIdFromLink('/profile/%ZZ'), '');
});

function mountHead(pathname) {
  const links = new Map();
  let replacement;
  const window = {
    location: { pathname, search: '?test=1', hash: '#section' },
    history: { state: { existing: true }, replaceState: (state, title, url) => { replacement = { state, url }; } },
  };
  const document = {
    querySelector: (selector) => links.get(selector.match(/rel="([^"]+)"/)[1]),
    createElement: () => ({}), head: { appendChild: (element) => links.set(element.rel, element) },
  };
  vm.runInNewContext(read('scripts/web-mount.js'), { window, document });
  return { window, links, replacement };
}

test('runtime manifest/icon URLs and relative manifest scope match each public mount', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  for (const [pathname, base] of [['/landing', ''], ['/app/landing', '/app'], ['/app', '/app']]) {
    const result = mountHead(pathname);
    assert.equal(result.window.__LINKUP_BASE_PATH__, base);
    assert.equal(result.links.get('manifest').href, `${base}/manifest.webmanifest`);
    assert.equal(result.links.get('icon').href, `${base}/favicon.ico?v=cat1`);
    const manifestUrl = `https://example.com${result.links.get('manifest').href}`;
    assert.equal(manifest.id, undefined, 'omit id so it defaults to the mounted start_url; relative ids resolve against the origin');
    for (const key of ['scope', 'start_url']) assert.equal(new URL(manifest[key], manifestUrl).pathname, `${base}/`);
    for (const icon of manifest.icons) assert.ok(new URL(icon.src, manifestUrl).pathname.startsWith(`${base}/icons/`));
    if (pathname === '/app') assert.equal(result.replacement.url, '/app/?test=1#section');
  }
});

test('exported registration snippet chooses an explicit matching scope and fails closed', async () => {
  const source = read('scripts/postexport-web.js');
  const snippet = source.slice(source.indexOf('const pwaScript = ['), source.indexOf('// DevTools deterrent:'));
  const html = vm.runInNewContext(`${snippet}\npwaScript;`);
  const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const base of ['', '/app', undefined]) {
    const calls = [];
    let callback;
    const window = { __LINKUP_BASE_PATH__: base, addEventListener: (name, fn) => { callback = fn; } };
    const navigator = { serviceWorker: { register: async (url, options) => {
      calls.push({ url, options }); return { update: async () => {} };
    } } };
    vm.runInNewContext(js, { window, navigator, console });
    callback();
    if (base === undefined) assert.equal(calls.length, 0);
    else {
      assert.equal(calls[0].url, `${base}/service-worker.js`);
      assert.equal(calls[0].options.scope, `${base}/`);
      assert.equal(calls[0].options.updateViaCache, 'none');
    }
  }
});

function worker(scopePath = '/app/', options = {}) {
  const handlers = {};
  const stores = new Map();
  const deleted = [];
  const precached = [];
  const opened = [];
  const notifications = [];
  let network = options.fetch || (async () => new Response('ok', { headers: { 'Content-Type': 'text/javascript' } }));
  const caches = {
    keys: async () => options.keys || [],
    delete: async (key) => { deleted.push(key); return true; },
    open: async (key) => {
      if (!stores.has(key)) stores.set(key, new Map());
      return {
        addAll: async (urls) => precached.push(...urls),
        put: async (request, response) => stores.get(key).set(typeof request === 'string' ? request : request.url, response),
        match: async (request) => stores.get(key).get(typeof request === 'string' ? request : request.url),
      };
    },
  };
  const self = {
    registration: { scope: `https://example.com${scopePath}`, showNotification: async (title, config) => notifications.push(config) },
    location: { origin: 'https://example.com' },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => options.clients || [], openWindow: async (url) => opened.push(url) },
  };
  vm.runInNewContext(read('public/service-worker.js'), { self, caches, URL, Response, fetch: (...args) => network(...args) });
  async function fire(name, init = {}) {
    const waits = [];
    let response;
    let intercepted = false;
    const event = { ...init, waitUntil: (promise) => waits.push(promise), respondWith: (promise) => { intercepted = true; response = promise; } };
    handlers[name](event);
    const result = await response;
    await Promise.all(waits);
    return { intercepted, response: result };
  }
  return { fire, deleted, precached, stores, opened, notifications };
}
const request = (pathname, mode = 'navigate', method = 'GET') => ({ url: `https://example.com${pathname}`, method, mode });

test('service worker precaches only its scope and deletes only its own old caches', async () => {
  const sw = worker('/app/', { keys: ['marketing-assets', 'linkup-pwa-%2F-v9', 'linkup-pwa-v8', 'linkup-pwa-%2Fapp%2F-v8', 'linkup-pwa-%2Fapp%2F-v9', 'linkup-pwa-%2Fapp%2F-v10'] });
  await sw.fire('install');
  assert.ok(sw.precached.every((url) => new URL(url).pathname.startsWith('/app/')));
  await sw.fire('activate');
  assert.deepEqual(sw.deleted, ['linkup-pwa-%2Fapp%2F-v8', 'linkup-pwa-%2Fapp%2F-v9']);
  const root = worker('/', { keys: ['marketing-assets', 'linkup-pwa-v8', 'linkup-pwa-%2Fapp%2F-v9'] });
  await root.fire('activate');
  assert.deepEqual(root.deleted, ['linkup-pwa-v8']);
});

test('service worker leaves homepage, other apps, APIs, auth and foreign origins untouched', async () => {
  const sw = worker();
  for (const pathname of ['/', '/assets/landing.js', '/application', '/app-other/', '/app/api/linky', '/app/__/auth/handler', '/app/p/alice', '/app/builders', '/app/sitemap.xml', '/app/sitemap-profiles-0.xml', '/app/robots.txt']) {
    assert.equal((await sw.fire('fetch', { request: request(pathname) })).intercepted, false, pathname);
  }
  assert.equal((await sw.fire('fetch', { request: request('/app/api/linky', 'cors', 'POST') })).intercepted, false);
  assert.equal((await sw.fire('fetch', { request: { url: 'https://foreign.example/app/', method: 'GET', mode: 'navigate' } })).intercepted, false);
  assert.equal((await sw.fire('fetch', { request: request('/app/_expo/static/js/web/test.js', 'cors') })).intercepted, true);
});

test('worker never caches HTML as JavaScript or legal HTML as the offline app', async () => {
  const sw = worker('/app/', { fetch: async () => new Response('HTML', { headers: { 'Content-Type': 'text/html' } }) });
  await sw.fire('fetch', { request: request('/app/_expo/missing.js', 'cors') });
  await sw.fire('fetch', { request: request('/app/privacy-policy') });
  assert.equal([...sw.stores.values()].reduce((sum, store) => sum + store.size, 0), 0);
  await sw.fire('fetch', { request: request('/app/landing') });
  assert.ok([...sw.stores.values()].some((store) => store.has('https://example.com/app/index.html')));
});

test('notification click only reuses an app tab and stays within its scope', async () => {
  const navigated = [];
  const sw = worker('/app/', { clients: [
    { url: 'https://example.com/', focus: () => assert.fail('must not focus marketing tab'), navigate: () => assert.fail('must not navigate marketing tab') },
    { url: 'https://example.com/app/landing', focus: async () => {}, navigate: async (url) => navigated.push(url) },
  ] });
  await sw.fire('notificationclick', { notification: { close() {}, data: { url: '/chat/member-123' } } });
  assert.deepEqual(navigated, ['https://example.com/app/chat/member-123']);
  await sw.fire('notificationclick', { notification: { close() {}, data: { url: 'https://example.com/' } } });
  assert.equal(navigated[1], 'https://example.com/app/alerts');
});

test('checkout keeps returns on the browser origin and ignores stale operator overrides', async () => {
  const source = fs.readFileSync(path.join(repo, 'api/payonifyCheckout.js'), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace('export default async function handler', 'async function handler');
  for (const [base, expected] of [['/app', '/app/'], ['', '/app/'], ['//attacker.example', '/app/']]) {
    let sent;
    const env = { PAYONIFY_PUBLISHABLE_KEY: 'test', PAYONIFY_SECRET_KEY: 'test' };
    const context = {
      process: { env }, Buffer, URL, AbortController, setTimeout, clearTimeout, console, checkoutReturnUrls,
      CURRENCY: 'USD', WEB_TERMS: { test: { tier: 'plus', months: 1, amount: 5, label: 'Test' } },
      handleOptions: () => false, setCors: () => {}, readJsonBody: async (req) => req.body,
      verifyRequestUser: async () => ({ uid: 'test-user', email: 'test@example.com' }),
      getDb: () => ({ collection: () => ({ doc: () => ({ set: async () => {} }) }) }), serverTimestamp: () => 1,
      sendError: (res, status, error) => { throw new Error(`${status}: ${error}`); },
      fetch: async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ id: 'cs_test', url: 'https://checkout.example/test' }), { status: 200 }); },
    };
    vm.runInNewContext(source + '\nglobalThis.handlerForTest = handler;', context);
    const req = { method: 'POST', headers: { origin: 'https://www.linkupbuild.com' }, body: { plan: 'test', appBasePath: base } };
    const res = { status(code) { assert.equal(code, 200); return this; }, json() {} };
    await context.handlerForTest(req, res);
    assert.equal(sent.success_url, 'https://www.linkupbuild.com' + expected);
    assert.equal(sent.cancel_url, sent.success_url);
    env.PAYONIFY_SUCCESS_URL = 'https://operator.example/approved-return';
    await context.handlerForTest(req, res);
    assert.equal(sent.success_url, 'https://www.linkupbuild.com/app/');
    env.PAYONIFY_SUCCESS_URL = 'https://www.linkupbuild.com/app/landing';
    await context.handlerForTest(req, res);
    assert.equal(sent.success_url, env.PAYONIFY_SUCCESS_URL);
  }
});

test('all exported initial scripts and lazy chunks resolve through both hosting paths', { skip: !fs.existsSync(path.join(mobile, 'dist/index.html')) }, () => {
  const config = JSON.parse(fs.readFileSync(path.join(repo, 'vercel.json'), 'utf8'));
  const dist = path.join(mobile, 'dist');
  const exists = (url) => fs.existsSync(path.join(dist, url.split('?')[0]));
  function standalone(url) {
    if (exists(url)) return true;
    for (const rule of config.rewrites) {
      const regex = new RegExp('^' + rule.source.replace(':path*', '(.*)') + '$');
      const match = url.match(regex);
      if (!match) continue;
      const destination = rule.destination.replace(':path*', match[1] || '').replace('$1', match[1] || '');
      return exists(destination) && !destination.endsWith('index.html');
    }
    return false;
  }
  const html = read('dist/index.html');
  const initial = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(initial.length >= 3);
  for (const url of initial) {
    assert.ok(url.startsWith('/app/_expo/'), url);
    assert.ok(standalone(url), `standalone alias ${url}`);
    assert.ok(exists(url.slice(4)), `landing prefix-strip ${url}`);
  }
  let chunks = 0;
  for (const file of fs.readdirSync(path.join(dist, '_expo/static/js/web'))) {
    const js = fs.readFileSync(path.join(dist, '_expo/static/js/web', file), 'utf8');
    for (const match of js.matchAll(/["'](\/app\/_expo\/[^"']+\.js)["']/g)) {
      chunks++;
      assert.ok(standalone(match[1]), match[1]);
      assert.ok(exists(match[1].slice(4)), match[1]);
    }
    assert.doesNotMatch(js, /["']\/_expo\/static\/js\/web\//, 'unprefixed lazy chunk');
  }
  assert.ok(chunks >= 20, `expected real split chunks, found ${chunks}`);
  const swHeaders = config.headers.find((rule) => rule.source === '/app/service-worker.js');
  assert.ok(swHeaders.headers.some((h) => h.key === 'Cache-Control' && h.value.includes('must-revalidate')));
});
