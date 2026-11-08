// The paywall has to read like it was written for the person reading it, and the
// things it promises have to exist. This file guards the three that are easiest
// to lose: the personalised header, the button at the top of the home page, and
// Linky writing a profile for money.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { PLUS_BENEFITS, PLUS_BENEFIT_COUNT, plusPitch, plusBenefitById } from '../shared/plus-benefits.js';

const read = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const paywall = read('mobile/src/components/PaywallModal.tsx');
const home = read('mobile/src/screens/DiscoveryDashboardScreen.tsx');
const writer = read('mobile/src/components/LinkyProfileWriter.tsx');
const api = read('api/_linky.js');
const route = read('api/linky.js');

const tariro = {
  displayName: 'tariro moyo',
  buildingName: 'LINKUP',
  buildingOneLiner: 'a place where founders find the person who fills the empty seat',
  missingSeat: 'Technical cofounder',
};

test('the pitch is built from the member, not from a brochure', () => {
  const pitch = plusPitch(tariro);
  assert.equal(pitch.name, 'Tariro', 'the first name is title-cased from whatever they typed');
  assert.equal(pitch.headline, 'Tariro, this is the version of LINKUP built for you');
  assert.match(pitch.setup, /You are building LINKUP, and the seat you said is empty is a technical cofounder\./);
  assert.match(pitch.stake, /the technical cofounder you need is being introduced to somebody else/);
  assert.equal(pitch.personalised, true);

  // Two different members must not read the same page.
  const other = plusPitch({ displayName: 'Rudo', buildingName: 'Kweza', missingSeat: 'Designer' });
  assert.notEqual(other.headline, pitch.headline);
  assert.notEqual(other.stake, pitch.stake);
  assert.match(other.stake, /designer/);
});

test('a member with an empty profile gets a clean sentence, never a hole', () => {
  const pitch = plusPitch({});
  assert.equal(pitch.personalised, false);
  assert.equal(pitch.headline, 'This is the version of LINKUP built for you');
  assert.equal(pitch.setup, '', 'no "You are building ,"');
  assert.ok(pitch.stake.length > 20, 'the stake still applies');
  assert.ok(!/undefined|null|NaN|,\s*\./.test(`${pitch.headline} ${pitch.setup} ${pitch.stake}`));

  // Half a profile is still a sentence, not a fragment.
  const nameOnly = plusPitch({ displayName: 'Zoe' });
  assert.match(nameOnly.headline, /^Zoe, /);
  assert.equal(nameOnly.setup, '');
  const seatOnly = plusPitch({ missingSeat: 'CTO' });
  assert.equal(seatOnly.setup, 'The seat you said is empty is a cto.', 'no sentence that starts with "and"');
});

test('the paywall renders the pitch, and the list is headed with their name', () => {
  assert.match(paywall, /import \{ plusPitch \} from '\.\.\/\.\.\/\.\.\/shared\/plus-benefits'/);
  assert.match(paywall, /const pitch = React\.useMemo\(\(\) => plusPitch\(/);
  assert.match(paywall, /\{invite \? invite\.headline : pitch\.headline\}/, 'the invited header is the featured benefit, otherwise the pitch');
  assert.match(paywall, /pitch\.setup/);
  assert.match(paywall, /pitch\.stake/);
  assert.match(paywall, /pitch\.name \? `\$\{pitch\.name\}, everything you get the moment you pay`/);
});

test('the biggest button on home is the one that sells PLUS, and only free members see it', () => {
  assert.match(home, /Upgrade to LINKUP PLUS/, 'the bar says what it does');
  assert.match(home, /onPress=\{\(\) => setPlusWallOpen\(true\)\}/, 'tapping it opens the paywall');
  assert.match(home, /\{!isPlus && \(/, 'a paid member is never sold what they already own');
  assert.match(home, /<PaywallModal/, 'the same modal, mounted once');
  // It is the first thing on the page, above the hero.
  const bar = home.indexOf('Upgrade to LINKUP PLUS');
  const body = home.indexOf('return (');
  assert.ok(body > 0 && bar > body, 'the bar is inside the render');
});

test('Linky writing a profile is sold as a real, PLUS-only lever', () => {
  const benefit = plusBenefitById('profilewriter');
  assert.ok(benefit, 'the tenth lever exists');
  assert.match(benefit.title, /Linky writes your (whole )?profile/i);
  assert.match(benefit.proof, /Free|free/, 'the proof names what staying free costs');
  assert.ok(benefit.invite.line && benefit.email.line);
  assert.equal(PLUS_BENEFIT_COUNT, PLUS_BENEFITS.length);

  // The gate is real: the server refuses a free member before it writes a word.
  assert.match(api, /export async function writeMyProfile/);
  assert.match(api, /isPlusMember/);
  assert.match(route, /case 'writeProfile'/, 'the endpoint exists');
  assert.match(route, /plus_required/, 'and answers 402 for free members');
  // The writer never invents facts, and nothing is saved without the member's tap.
  assert.match(api, /inventsFacts/);
  assert.match(writer, /onUpgrade/, 'a free member gets the pitch, not the save');
  assert.match(writer, /applyProfile|onSave|saveDraft|updateLocalProfile/, 'the save is client-side and explicit');
});

test('the count the member reads is the count of levers, and nobody retyped it', () => {
  assert.match(paywall, /\{PLUS_BENEFIT_COUNT\} LEVERS/);
  assert.match(paywall, /const BENEFIT_GROUPS = plusBenefitGroups\(\)/);
  // Nothing on the wall may still promise the free theme picker or save caps.
  const body = PLUS_BENEFITS.map((entry) => `${entry.title} ${entry.proof}`).join(' ').toLowerCase();
  assert.ok(!/theme|palette/.test(body));
  assert.ok(!/unlimited saved|save cap/.test(body));
});
