import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderSearchPage } from '../api/_searchGlobe.js';

test('search route renders only a full-viewport Earth and space scene', () => {
  const html = renderSearchPage();
  assert.match(html, /https:\/\/www\.linkupbuild\.com\/app\/assets\/earth-blue-marble\.jpg/);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/three-globe[^'" ]*earth-blue-marble/);
  assert.match(html, /#earthScene\{position:fixed;inset:0/);
  assert.match(html, /new THREE\.SphereGeometry\(radius,88,64\)/);
  assert.doesNotMatch(html, /globeFilter|globeCount|globePanel|globeTip|panelList|profile|builder|<input|<button|<footer/i);
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'inline globe script exists');
  assert.doesNotThrow(() => new Function(script), 'inline globe script parses');
  const texture = new URL('../mobile/public/assets/earth-blue-marble.jpg', import.meta.url);
  assert.ok(fs.statSync(texture).size > 500_000, 'bundled Blue Marble texture exists at production app asset path');
});
