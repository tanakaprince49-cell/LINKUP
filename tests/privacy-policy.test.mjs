import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const isApp = existsSync(new URL('mobile/public/', root));
const html = read(isApp ? 'mobile/public/privacy-policy.html' : 'public/privacy.html');
const policy = JSON.parse(read('legal/privacy-policy.json'));
const config = JSON.parse(read('vercel.json'));
test('generated privacy HTML and Markdown match the reviewed source', () => {
  execFileSync(process.execPath, ['scripts/render-privacy-policy.cjs', '--check'], {cwd: root});
});
test('dedicated raw HTML contains Google disclosures and no JS/iframe/external assets', () => {
  assert.match(html, /<h1>Privacy Policy<\/h1>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www.linkupbuild.com\/privacy">/);
  assert.doesNotMatch(html, /<script\b|<iframe\b|<img\b|<link[^>]+stylesheet|docs\.google\.com|adults-only|18 and older|linkupp49@gmail\.com/i);
  for (const id of ['operator','google-data','data-collected','public-profiles','ai','channels','permissions','providers','storage','retention','deletion','security','choices','age','updates']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const text of ['Tanaka Gaadzikwa','tanakaprince49@gmail.com','16+','com.tana.linkup','email','profile','Firebase','Google password','Limited Use','train','retention','Google Account','data deletion','OpenRouter','ImageKit','Payonify']) assert.ok(html.includes(text), text);
  assert.ok(policy.sections.length >= 15);
});
test('privacy routes resolve to dedicated HTML before all SPA catchalls', () => {
  const destination = isApp ? '/privacy-policy.html' : '/privacy.html';
  const catchall = config.rewrites.findIndex(r => ['/(.*)', '/:path*', '/app/:path*'].includes(r.source));
  for (const source of ['/privacy','/privacy/','/privacy-policy', ...(isApp ? ['/app/privacy','/app/privacy-policy'] : [])]) {
    const index = config.rewrites.findIndex(r => r.source === source);
    assert.ok(index >= 0, source);
    assert.equal(config.rewrites[index].destination, destination);
    assert.ok(index < catchall, `${source} must precede catchall`);
  }
});
test('public entry links, contacts and analytics consent are aligned', () => {
  if (isApp) {
    assert.match(read('mobile/src/screens/LandingScreen.tsx'), /href: 'https:\/\/www.linkupbuild.com\/privacy'/);
    assert.match(read('mobile/src/screens/ProfileScreen.tsx'), /Account & Data Deletion/);
    for (const page of ['data-deletion','child-safety-standards']) {
      const content = read(`mobile/public/${page}.html`);
      assert.match(content, /tanakaprince49@gmail\.com/);
      assert.doesNotMatch(content, /linkupp49@gmail\.com|adults-only|adults 18|social and dating/);
    }
    assert.match(read('mobile/public/data-deletion.html'), /does not automatically erase/);
    assert.match(read('mobile/src/components/WebAnalytics.web.tsx'), /accepted \? <Analytics \/> : null/);
  } else {
    const footer = read('src/components/Footer.tsx');
    assert.match(footer, /href="\/privacy"/);
    assert.doesNotMatch(footer, /LINKUP Network Inc\.|1FUTyaNfaBXz/);
    assert.match(footer, /Privacy choices/);
    assert.match(read('src/components/ConsentAnalytics.tsx'), /accepted \? <Analytics \/> : null/);
    assert.match(read('src/components/CookieConsent.tsx'), /window.location.reload\(\)/);
    assert.doesNotMatch(read('src/App.tsx'), /tiun\.init|<Analytics/);
    for (const file of ['public/sitemap.xml','sitemap.xml']) assert.match(read(file), /<loc>https:\/\/www.linkupbuild.com\/privacy<\/loc>/);
  }
});
