const fs = require('fs');
const path = require('path');

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

const pwaHead = [
  '<!-- linkup-pwa-meta -->',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1" />',
  '<meta name="format-detection" content="telephone=no" />',
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<meta name="theme-color" content="#FBE618" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-title" content="LINKUP" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<link rel="apple-touch-icon" href="/icons/icon-192.png" />',
  '<link rel="preconnect" href="https://firestore.googleapis.com" />',
  '<link rel="preconnect" href="https://identitytoolkit.googleapis.com" />',
  '<link rel="preconnect" href="https://www.googleapis.com" />',
  '<style id="linkup-mobile-viewport-fix">',
  'html, body, #root { width: 100%; min-width: 0; max-width: 100%; overflow-x: hidden; }',
  'body { margin: 0; touch-action: manipulation; -webkit-text-size-adjust: 100%; }',
  '@media (max-width: 767px), (hover: none) and (pointer: coarse) {',
  '  html, body, #root { min-height: 100dvh; }',
  '  body { overscroll-behavior-y: contain; }',
  '}',
  '.linkup-linkedin-mobile body { min-width: 0 !important; max-width: 100vw !important; overflow-x: hidden !important; }',
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
  "    navigator.serviceWorker.register('/service-worker.js').then(function (registration) {",
  '      registration.update();',
  "    }).catch(function (error) {",
  "      console.warn('LINKUP service worker registration failed:', error);",
  '    });',
  '  });',
  '}',
  '</script>',
].join('\n');

html = injectOnce(html, 'linkup-pwa-meta', pwaHead, '</head>');
html = injectOnce(html, 'linkup-pwa-service-worker', pwaScript, '</body>');

fs.writeFileSync(indexPath, html);
console.log('LINKUP PWA assets copied and index.html patched.');
