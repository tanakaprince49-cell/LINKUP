# LINKUP 16.9.1 — Taller profile banner, Photos move into edit mode

- **Date:** 24 October 2026
- **Source version:** `16.9.1`
- **Android versionCode:** `33`
- **Baseline:** `8b5859c` (`16.9.0`)
- **Requested branch:** `codex/mobile-port` (retained as HEAD)

## Delivered behavior

The profile banner now covers the space where the "Photos" section used to sit:

- The banner grows from 148pt to 220pt, filling the reclaimed space so the
  cover picture dominates the profile hero.
- The "Photos" heading with the three swipe-photo slots no longer shows on the
  normal profile view. It still appears in edit mode (pencil icon), so managing
  swipe photos keeps working exactly as before — nothing was deleted.

## Verification

- `npm --prefix mobile run typecheck`: clean.
- No server, rules, or test changes; all `16.9.0` suites still apply unchanged.
