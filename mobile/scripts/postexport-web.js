const fs = require('fs');
const path = require('path');
const { withHead, copy: searchCopy } = require('../../shared/app-seo.cjs');

const appRoot = path.resolve(__dirname, '..');
const publicDir = path.join(appRoot, 'public');
const distDir = path.join(appRoot, 'dist');
const indexPath = path.join(distDir, 'index.html');

function copyRecursive(source, destination) {
  if (!fs.existsSync(source)) return;
  const stats = fs.statSync(source);
  if (stats.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function injectOnce(html, marker, snippet, before) {
  if (html.includes(marker)) return html;
  return html.replace(before, `${snippet}\n${before}`);
}

copyRecursive(publicDir, distDir);

if (!fs.existsSync(indexPath)) {
  throw new Error(`Expo web export did not create ${indexPath}`);
}

let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(/<meta\s+name=["']viewport["'][^>]*>\s*/i, '');

// Browsers + installed PWAs pin favicons hard (separate favicon DB), so give
// the cat mark a fresh URL to bust every cache layer in one move.
html = html.replace(/href="(?:\/app)?\/favicon\.ico(\?[^"]*)?"/, 'href="/app/favicon.ico?v=cat1"');

const webMountScript = '<!-- linkup-web-mount -->\n<script>\n' +
  fs.readFileSync(path.join(__dirname, 'web-mount.js'), 'utf8') + '\n</script>';

const pwaHead = [
  '<!-- linkup-pwa-meta -->',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />',
  '<meta name="format-detection" content="telephone=no" />',
  // Manifest and icons are inserted by web-mount.js with the current public mount.
  '<meta name="theme-color" content="#FBE618" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  '<meta name="apple-mobile-web-app-title" content="LINKUP" />',
  '<meta name="mobile-web-app-capable" content="yes" />',

  '<link rel="preconnect" href="https://firestore.googleapis.com" />',
  '<link rel="preconnect" href="https://identitytoolkit.googleapis.com" />',
  '<link rel="preconnect" href="https://www.googleapis.com" />',
  '<style id="linkup-mobile-viewport-fix">',
  'html, body, #root { width: 100%; height: 100%; min-width: 0; max-width: 100%; overflow-x: hidden; display: flex; flex-direction: column; flex: 1; box-sizing: border-box; }',
  'body { margin: 0; touch-action: manipulation; -webkit-text-size-adjust: 100%; overscroll-behavior-y: none; background-color: #ffffff; }',
  '/* iOS PWA (added to Home Screen): keep UI clear of the notch + home indicator */',
  '@media (display-mode: standalone) {',
  '  body { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); padding-left: env(safe-area-inset-left, 0px); padding-right: env(safe-area-inset-right, 0px); }',
  '}',
  '@media (max-width: 767px), (hover: none) and (pointer: coarse) {',
  '  html, body, #root { height: 100dvh; min-height: 100dvh; }',
  '  body { overscroll-behavior-y: contain; }',
  '}',
  '.linkup-linkedin-mobile body { min-width: 0 !important; max-width: 100vw !important; overflow-x: hidden !important; }',
  '/* iOS Safari / Chrome WebKit critical fixes */',
  '* { -webkit-tap-highlight-color: transparent; }',
  '/* Prevent iOS Safari from making elements disappear during navigation */',
  '#root > * { -webkit-transform: translateZ(0); transform: translateZ(0); }',
  '/* Fix iOS Safari blank screen on scroll: force GPU layer */',
  'body { -webkit-overflow-scrolling: touch; }',
  '/* Prevent touch callout on images/links that can freeze iOS UI */',
  'img, a { -webkit-touch-callout: none; }',
  '/* Fix input zoom on iOS Safari (font-size < 16px triggers unwanted zoom that can cause blank) */',
  'input, select, textarea { font-size: 16px !important; }',
  '/* Fix React Navigation screen containers disappearing on iOS */',
  '[data-testid], [style*="position: absolute"] { -webkit-backface-visibility: hidden; backface-visibility: hidden; }',
  '</style>',
  '<script id="linkup-linkedin-mobile-detect">',
  '(function () {',
  "  var ua = navigator.userAgent || '';",
  "  var isLinkedIn = /LinkedInApp|LinkedIn/i.test(ua);",
  '  var narrowDevice = Math.min(screen.width || 9999, screen.height || 9999) < 768;',
  '  if (isLinkedIn && narrowDevice) document.documentElement.classList.add("linkup-linkedin-mobile");',
  '}());',
  '</script>',
].join('\n');

const pwaScript = [
  '<!-- linkup-pwa-service-worker -->',
  '<script>',
  "if ('serviceWorker' in navigator) {",
  "  window.addEventListener('load', function () {",
  '    var basePath = window.__LINKUP_BASE_PATH__;',
  "    if (basePath !== '' && basePath !== '/app') return;",
  "    navigator.serviceWorker.register(basePath + '/service-worker.js', { scope: basePath + '/', updateViaCache: 'none' }).then(function (registration) {",
  '      return registration.update();',
  "    }).catch(function (error) {",
  "      console.warn('LINKUP service worker registration failed:', error);",
  '    });',
  '  });',
  '}',
  '</script>',
].join('\n');

// DevTools deterrent: block right-click inspect + the common DevTools /
// view-source keyboard shortcuts. NOTE: this is deterrence, not a lock —
// browsers ultimately control DevTools. Real data protection lives in the
// Firestore security rules.
const devToolsGuard = [
  '<!-- linkup-devtools-guard -->',
  '<script>',
  '(function () {',
  "  document.addEventListener('contextmenu', function (event) {",
  '    event.preventDefault();',
  '  });',
  "  document.addEventListener('keydown', function (event) {",
  '    var key = String(event.key || \'\').toLowerCase();',
  '    var meta = event.ctrlKey || event.metaKey;',
  '    if (',
  "      event.key === 'F12' ||",
  "      (meta && event.shiftKey && (key === 'i' || key === 'j' || key === 'c' || key === 'k')) ||",
  "      (meta && (key === 'u' || key === 's'))",
  '    ) {',
  '      event.preventDefault();',
  '      event.stopPropagation();',
  '    }',
  '  }, true);',
  '}());',
  '</script>',
].join('\n');

// BUILD IDENTITY. A tab left open across a deploy keeps running the previous
// bundle, so "I still see the bug" can mean "I am on yesterday's code". The
// crash screen prints this id, which makes every bug report unambiguous.
const buildId = String(
  process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_REF ||
    'dev'
).slice(0, 12);

const buildScript = [
  '<!-- linkup-build-id -->',
  '<script>',
  `  window.__LINKUP_BUILD__ = ${JSON.stringify(buildId)};`,
  '</script>',
].join('\n');

html = injectOnce(html, 'linkup-pwa-meta', pwaHead, '</head>');
html = injectOnce(html, 'linkup-web-mount', webMountScript, '</head>');
html = injectOnce(html, 'linkup-build-id', buildScript, '</body>');
html = injectOnce(html, 'linkup-pwa-service-worker', pwaScript, '</body>');
html = injectOnce(html, 'linkup-devtools-guard', devToolsGuard, '</body>');

// Export distinct public and private shells without changing app routes or assets.
fs.writeFileSync(indexPath, withHead(html, false));
const publicLanding = withHead(html, true).replace(/<noscript>[\s\S]*?<\/noscript>/i,
  '<noscript><main><h1>LINKUP: Cofounder Matching and Startup Networking</h1><p>' + searchCopy.description + '</p><p><a href="https://www.linkupbuild.com/app/builders">Explore public professional profiles</a>. Enable JavaScript to use the app.</p></main></noscript>');
fs.writeFileSync(path.join(distDir, 'landing.html'), publicLanding);

// Legal pages also exist at both mounts. Their root-relative cross-links must
// not accidentally open the marketing SPA when viewed through /app.
const legalLinksScript = [
  '<!-- linkup-legal-mount -->',
  '<script>',
  '(function () {',
  "  if (!/^\\/app(?:\\/|$)/.test(window.location.pathname)) return;",
  "  document.querySelectorAll('a[href^=\"/\"]').forEach(function (link) {",
  "    var href = link.getAttribute('href');",
  "    if (href.indexOf('//') !== 0 && !/^\\/app(?:\\/|$)/.test(href)) link.setAttribute('href', '/app' + href);",
  '  });',
  '}());',
  '</script>',
].join('\n');
for (const name of ['privacy-policy.html', 'data-deletion.html', 'child-safety-standards.html']) {
  const file = path.join(distDir, name);
  if (fs.existsSync(file)) {
    fs.writeFileSync(file, injectOnce(fs.readFileSync(file, 'utf8'), 'linkup-legal-mount', legalLinksScript, '</body>'));
  }
}
console.log('LINKUP PWA assets copied and root/subpath HTML patched.');
