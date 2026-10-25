# LINKUP 16.9.7 — Free-tier survival: emulator dev + quota sipping

- **Date:** 25 October 2026
- **Source version:** `16.9.7`
- **Android versionCode:** `39`
- **Baseline:** `35f0c26` (`16.9.6`)
- **Requested branch:** `codex/mobile-port` (retained as HEAD)

## Problem

The production Firebase project exhausted its no-cost limits, so profiles
(and everything downstream) stopped loading until the daily reset — with no
budget to upgrade to Blaze. Heavy development testing must not depend on
production quota at all.

## Delivered behavior

- **Local emulator support (dev-only, $0 burn):** setting
  `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` in the gitignored `mobile/.env`
  points auth + Firestore at `firebase emulators:start --only
  auth,firestore`. The block is a no-op when unset or in production builds.
- **`firebase.json`:** emulator section added (auth `:9099`, firestore
  `:8085`, UI `:4000`, all LAN-bound `0.0.0.0` so Expo Go on a physical
  phone can reach them). CI deploy/test configs are unaffected.
- **Quota sipping:** founder-dashboard count queries are cached 5 minutes
  (and keep the last-known value on quota blips instead of flashing 0);
  the `16.9.5` banner top-up server read is throttled to once per profile
  per 10 minutes (the free cache probe still runs instantly).
- **`EMULATOR_TESTING.md`:** Windows-first guide — Java install, starting
  the emulators, finding the LAN IP, the one-line `.env`, firewall
  prompts, fresh email test accounts, data persistence, and switching
  back to production.
- `copy-runtime-contracts.json` regenerated for the two new cache `.get()`
  calls (33 → 35 tuples for `ProfileScreen.tsx`).

## Verification

- Full pre-promotion battery green locally: privacy 4/4, copy 8/8, linky
  84/84, identity 9/9, profile 4/4, builder 56/56, payments 6/6, seo
  43/43, web-paths 11/11, plus `mobile` typecheck clean.
- The Vercel workflow conclusion for this commit was polled via the GitHub
  API until green (see push notes).
