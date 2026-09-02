/**
 * LINKUP price list — the SINGLE source of truth.
 *
 * One table, two billing rails:
 *   - Android  -> Google Play Billing (auto-renewing subscriptions)
 *   - Web      -> Payonify (prepaid terms; Payonify has no recurring API)
 *
 * Same numbers on both. A user must never see $19.99 on one surface and be
 * charged something else on another.
 *
 * Imported by:
 *   - api/_payonify.js     (server — decides what the customer is charged)
 *   - mobile/src/lib/pricing.ts (client — decides what the customer is shown)
 *
 * Plain JS so both the Vercel functions and Metro can consume it without a
 * build step. Keep it dependency-free.
 */

export const CURRENCY = 'USD';

/** LINKUP PLUS — unlimited discovery, Who Viewed You, advanced search, no ads. */
export const PLUS_PRICES = {
  monthly: 19.99,
  yearly: 149.99,
};

/** LINKUP Campaigns — sponsored placements across the app. */
export const CAMPAIGNS_PRICES = {
  monthly: 29.99,
  yearly: 249.99,
};

/**
 * Web terms (Payonify).
 *
 * Payonify cannot auto-renew, so web sells a fixed prepaid window instead of
 * a subscription. `monthly` and `yearly` are priced IDENTICALLY to the Google
 * Play plans so the two rails never disagree. `plus_3m` is a web-only bundle
 * priced as a discount on three separate months (3 x 19.99 = 59.97).
 */
export const WEB_TERMS = {
  plus_1m: { label: 'LINKUP PLUS — 1 month', amount: PLUS_PRICES.monthly, months: 1, tier: 'plus' },
  plus_3m: { label: 'LINKUP PLUS — 3 months', amount: 49.99, months: 3, tier: 'plus' },
  plus_12m: { label: 'LINKUP PLUS — 12 months', amount: PLUS_PRICES.yearly, months: 12, tier: 'plus' },
  campaigns_1m: { label: 'LINKUP Campaigns — 1 month', amount: CAMPAIGNS_PRICES.monthly, months: 1, tier: 'campaigns' },
  campaigns_12m: { label: 'LINKUP Campaigns — 12 months', amount: CAMPAIGNS_PRICES.yearly, months: 12, tier: 'campaigns' },
};

/** Entitlement tiers. Matches the `tier` written to webSubscriptions/{uid}. */
export const TIERS = { PLUS: 'plus', CAMPAIGNS: 'campaigns' };

/** "$19.99" — formatted for display. */
export const formatUsd = (amount) => `$${Number(amount).toFixed(2)}`;
