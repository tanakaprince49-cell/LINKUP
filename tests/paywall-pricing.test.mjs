import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLUS_PRICES, PLUS_LIST_PRICES, formatUsd } from '../shared/pricing.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('PLUS costs $19.99/month and $149.99/year — that is the product truth', () => {
  assert.equal(PLUS_PRICES.monthly, 19.99);
  assert.equal(PLUS_PRICES.yearly, 149.99);
  assert.equal(formatUsd(PLUS_PRICES.monthly), '$19.99');
  assert.equal(formatUsd(PLUS_PRICES.yearly), '$149.99');
});

test('the discount anchors are defined once, in the canonical price list', () => {
  // Monthly: the launch offer is 20% under the $25 list price. Yearly: the
  // anchor is a year paid month-to-month, so the saving is a real comparison.
  assert.equal(PLUS_LIST_PRICES.monthly, 25);
  assert.equal(PLUS_LIST_PRICES.yearly, PLUS_PRICES.monthly * 12);
});

test('the paywall discount is computed, never a hardcoded dollar amount', () => {
  const modal = read('mobile/src/components/PaywallModal.tsx');
  assert.doesNotMatch(modal, /SAVE \$\d/, 'a hardcoded dollar saving stops matching real store prices');
  // Both badges are percentages derived from the canonical prices, so they
  // stay true in every currency Play converts into.
  assert.match(modal, /MONTHLY_SAVE_BADGE/);
  assert.match(modal, /YEARLY_SAVE_BADGE/);
  assert.match(modal, /PLUS_LIST_PRICES\.monthly/);
  assert.match(modal, /PLUS_LIST_PRICES\.yearly/);
  // The struck-through anchor is the displayed store price scaled by the
  // list/offer ratio — the same offer in every region, never invented text.
  assert.match(modal, /scalePriceLabel\(storePrice, plan\.anchorRatio\)/);
  assert.match(modal, /textDecorationLine: 'line-through'/);
});

test('the app cannot quote prices of its own — cards fall back to canonical only', () => {
  const modal = read('mobile/src/components/PaywallModal.tsx');
  assert.match(modal, /price: LINKUP_PLUS_MONTHLY_PRICE/);
  assert.match(modal, /price: LINKUP_PLUS_YEARLY_PRICE/);
  const paywall = read('mobile/src/lib/paywall.ts');
  assert.match(paywall, /LINKUP_PLUS_MONTHLY_PRICE = formatUsd\(PLUS_PRICES\.monthly\)/);
  assert.match(paywall, /LINKUP_PLUS_YEARLY_PRICE = formatUsd\(PLUS_PRICES\.yearly\)/);
});
