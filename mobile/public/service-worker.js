// This file is served at /service-worker.js on the original app origin and
// /app/service-worker.js behind the landing proxy. Derive every URL from the
// registration scope, NOT from the upstream URL or a hard-coded domain root.
const SCOPE_URL = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname.replace(/\/?$/, '/');
const CACHE_PREFIX = `linkup-pwa-${encodeURIComponent(SCOPE_PATH)}-`;
const CACHE_NAME = `${CACHE_PREFIX}v9`;
const appUrl = (path = '') => new URL(path.replace(/^\/+/, ''), SCOPE_URL).href;
const inScope = (url) => url.origin === SCOPE_URL.origin && url.pathname.startsWith(SCOPE_PATH);
const SHELL_URL = appUrl('index.html');
const CORE_ASSETS = [appUrl(), SHELL_URL, appUrl('manifest.webmanifest'), appUrl('icons/icon-192.png'), appUrl('icons/icon-512.png')];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => {
        if (key === CACHE_NAME) return false;
        // Never delete another application's caches, or a different mount's.
        // Old unscoped LINKUP caches are retired only by the root registration.
        return key.startsWith(CACHE_PREFIX) || (SCOPE_PATH === '/' && /^linkup-pwa-v\d+$/.test(key));
      }).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!inScope(url)) return;
  const relativePath = url.pathname.slice(SCOPE_PATH.length);
  // Never cache personalized API responses or Firebase authentication helpers.
  if (relativePath === 'api' || relativePath.startsWith('api/') || relativePath.startsWith('__/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const type = response.headers.get('content-type') || '';
          // Only the app entry pages may replace the offline shell. A legal
          // page or a 404 must not become the offline app for every deep link.
          if (response.ok && type.includes('text/html') && ['', 'index.html', 'landing'].includes(relativePath)) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy)).catch(() => {}));
          }
          return response;
        })
        .catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(SHELL_URL)).then((cached) =>
          cached || new Response('', { status: 503, statusText: 'Offline' })
        ))
    );
    return;
  }

  // Cache only known static app files. Do not treat every same-origin GET as
  // a public asset, and never cache a SPA fallback returned for a missing JS file.
  const staticAsset = /^(?:_expo\/|assets\/|icons\/|favicon\.ico$|manifest\.webmanifest$)/.test(relativePath);
  if (!staticAsset) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && !(response.headers.get('content-type') || '').includes('text/html')) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {}));
        }
        return response;
      })
      .catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(request)).then((cached) =>
        cached || new Response('', { status: 504, statusText: 'Offline' })
      ))
  );
});

function notificationUrl(value) {
  try {
    let raw = String(value || '/alerts');
    if (SCOPE_PATH !== '/' && raw === SCOPE_PATH.slice(0, -1)) raw = SCOPE_PATH;
    // Push payloads can contain a root-relative app route or a fully qualified
    // same-origin URL. Never focus the marketing page or an external website.
    const url = /^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('//')
      ? new URL(raw, SCOPE_URL)
      : raw.startsWith(SCOPE_PATH) && SCOPE_PATH !== '/'
        ? new URL(raw, SCOPE_URL.origin)
        : new URL(raw.replace(/^\/+/, ''), SCOPE_URL);
    return inScope(url) ? url.href : appUrl('alerts');
  } catch {
    return appUrl('alerts');
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  if (!data || typeof data !== 'object') data = {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'LINKUP', {
      body: data.body || 'You have a new LINKUP update.',
      icon: appUrl('icons/icon-192.png'),
      badge: appUrl('icons/icon-192.png'),
      data: { url: notificationUrl(data.url) },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = notificationUrl(event.notification.data?.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ('focus' in client && inScope(new URL(client.url))) {
          await client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
