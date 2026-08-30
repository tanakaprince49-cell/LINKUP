// Re-export the canonical price list from the repo root so the app and the
// Vercel billing functions can never quote different numbers.
// See shared/pricing.js — that file is the source of truth.
export {
  CURRENCY,
  PLUS_PRICES,
  CAMPAIGNS_PRICES,
  PAYNOW_TERMS,
  TIERS,
  formatUsd,
} from '../../../shared/pricing';
