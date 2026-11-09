import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLUS_PRICES, formatUsd } from '../shared/pricing.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('PLUS costs $19.99/month and $149.99/year — that is the product truth', () => {
  assert.equal(PLUS_PRICES.monthly, 19.99);
  assert.equal(PLUS_PRICES.yearly, 149.99);
  assert.equal(formatUsd(PLUS_PRICES.monthly), '$19.99');
  assert.equal(formatUsd(PLUS_PRICES.yearly), '$149.99');
});

test('the paywall invents no anchor price and no fake discount', () => {
  const modal = read('mobile/src/components/PaywallModal.tsx');
  assert.doesNotMatch(modal, /originalPrice/, 'no strikethrough anchor price');
  assert.doesNotMatch(modal, /DISCOUNT/, 'no fake discount badge');
  assert.doesNotMatch(modal, /\$25\.00/, 'the $25 anchor never returns');
  assert.doesNotMatch(modal, /SAVE \$\d/, 'a hardcoded dollar saving stops matching real store prices');
  // The yearly badge is a percentage computed from the canonical prices, so
  // it stays true in every currency Play converts into.
  assert.match(modal, /YEARLY_SAVE_BADGE/);
  assert.match(modal, /PLUS_PRICES\.yearly \/ \(PLUS_PRICES\.monthly \* 12\)/);
});

test('the app cannot quote prices of its own — cards fall back to canonical only', () => {
  const modal = read('mobile/src/components/PaywallModal.tsx');
  assert.match(modal, /price: LINKUP_PLUS_MONTHLY_PRICE/);
  assert.match(modal, /price: LINKUP_PLUS_YEARLY_PRICE/);
  const paywall = read('mobile/src/lib/paywall.ts');
  assert.match(paywall, /LINKUP_PLUS_MONTHLY_PRICE = formatUsd\(PLUS_PRICES\.monthly\)/);
  assert.match(paywall, /LINKUP_PLUS_YEARLY_PRICE = formatUsd\(PLUS_PRICES\.yearly\)/);
});
