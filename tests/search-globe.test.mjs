import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderSearchPage } from '../api/_searchGlobe.js';

const member = {
  uid: 'profile-1', name: 'Builder One', occupation: 'Founder', company: 'LINKUP',
  city: 'Harare', country: 'Zimbabwe', skills: ['Product'], image: '', url: '/app/p/profile-1',
};

test('search globe uses the bundled Earth map texture, not a fragile third-party texture URL', () => {
  const html = renderSearchPage({ members: [member] });
  assert.match(html, /https:\/\/www\.linkupbuild\.com\/app\/assets\/earth-blue-marble\.jpg/);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/three-globe[^'" ]*earth-blue-marble/);
  const texture = new URL('../mobile/public/assets/earth-blue-marble.jpg', import.meta.url);
  assert.ok(fs.statSync(texture).size > 500_000, 'bundled Blue Marble texture exists at production app asset path');
});
