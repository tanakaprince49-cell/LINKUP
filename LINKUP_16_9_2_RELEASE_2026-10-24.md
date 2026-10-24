# LINKUP 16.9.2 — Photos restored, avatar sits inside the banner

- **Date:** 24 October 2026
- **Source version:** `16.9.2`
- **Android versionCode:** `34`
- **Baseline:** `095b718` (`16.9.1`)
- **Requested branch:** `codex/mobile-port` (retained as HEAD)

## Delivered behavior

Correction to `16.9.1`: the Photos section is back, and the avatar moves
instead:

- The "Photos" heading with the three swipe-photo slots is restored on the
  normal profile view, with its tap-to-edit shortcut and hint text, exactly as
  in `16.9.0`.
- The profile photo circle now sits fully **inside** the 220pt banner (lifted
  from the half-overlap position), so the banner ends right where Photos
  begins.
- The "Add a banner picture" pill is pinned to the top of the empty banner
  slot so the avatar circle never covers it.

## Verification

- `npm --prefix mobile run typecheck`: clean.
- No server, rules, or test changes; all `16.9.0` suites still apply unchanged.
