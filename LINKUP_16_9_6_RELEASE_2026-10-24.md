# LINKUP 16.9.6 — Fix the Vercel promotion gate (copy-contract snapshot)

- **Date:** 24 October 2026
- **Source version:** `16.9.6`
- **Android versionCode:** `38`
- **Baseline:** `26470fe` (`16.9.5`)
- **Requested branch:** `codex/mobile-port` (retained as HEAD)

## Problem

`26470fe` failed the "Deploy existing Vercel project" workflow at the
pre-promotion battery (`test:copy`), so Vercel never promoted the build.
`tests/professional-copy.test.mjs` deep-compares a locked snapshot of runtime
call contracts per mobile screen against
`tests/fixtures/copy-runtime-contracts.json`. The intended `16.9.5` banner
top-up added one `doc(db, 'users', uid)` read plus one cache `.get(uid)` to
`ProfileScreen.tsx`, which the stale snapshot did not contain.

## Delivered behavior

- Regenerated the `ProfileScreen.tsx` entry of `copy-runtime-contracts.json`
  (31 → 33 contract tuples) to include the intended banner top-up reads.
- No app-code changes; the `16.9.5` banner top-up ships unchanged.

## Verification

- Full pre-promotion battery green locally: privacy 4/4, copy 8/8, linky
  84/84, identity 9/9, profile 4/4, builder 56/56, payments 6/6, seo 43/43,
  web-paths 11/11, plus `mobile` typecheck clean.
- The Vercel workflow conclusion for this commit was polled via the GitHub
  API until green (see push notes).
