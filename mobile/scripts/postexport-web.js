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

const pwaHead = [
  '<!-- linkup-pwa-meta -->',
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<meta name="theme-color" content="#FBE618" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-title" content="LINKUP" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<link rel="apple-touch-icon" href="/icons/icon-192.png" />',
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
