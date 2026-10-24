# LINKUP 16.9.3 — Round the banner's bottom corners

- **Date:** 24 October 2026
- **Source version:** `16.9.3`
- **Android versionCode:** `35`
- **Baseline:** `97cf52f` (`16.9.2`)
- **Requested branch:** `codex/mobile-port` (retained as HEAD)

## Delivered behavior

The profile banner's bottom edge was a hard straight cut. It now has the same
rounded corners as the top (`15pt` on all four corners), so the banner picture
ends in a shaped curve matching the hero card.

## Verification

- `npm --prefix mobile run typecheck`: clean.
- No server, rules, or test changes; all `16.9.0` suites still apply unchanged.
