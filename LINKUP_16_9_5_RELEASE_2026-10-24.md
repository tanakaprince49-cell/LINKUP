# LINKUP 16.9.5 — Banners visible to everyone, guaranteed

- **Date:** 24 October 2026
- **Source version:** `16.9.5`
- **Android versionCode:** `37`
- **Baseline:** `451e487` (`16.9.4`)
- **Requested branch:** `codex/mobile-port` (retained as HEAD)

## Problem

Banners still did not show on other profiles when viewed from a second
account. The public-index publish path depends on two deployment-state items
outside the app's control: deployed `firestore.rules` containing the
`coverPhoto` key, and the web `/api/imagekitAuth` endpoint producing hosted
URLs. If either is missing/stale, the index has no banner while the owner's
own doc does — owner sees it, nobody else does.

## Delivered behavior

Profile viewing gained a banner top-up that closes the gap no matter what:

- When the public-index copy of a viewed profile has no banner, the app merges
  `coverPhoto` from the directly readable `users/{uid}` doc (any signed-in,
  non-blocked visitor may read it, and it always carries the banner as a
  hosted URL or data URI).
- Cache-first (instant, free) with a server read right after for the
  authoritative copy; the screen re-renders the moment the banner arrives.
- The top-up only ever ADDS a missing banner — it never overwrites or removes
  one, and it fires zero extra reads when the index already has the banner.

Verified in code: the index payload keys are a strict subset of the rules
`hasOnly` list (no extra-key rejection), and the owner-visible banner proves
the `users`-doc write plus the render path already work.

## Still recommended (healthy state, lower cost)

Deploy the rules from the repo root (logged into the LINKUP Firebase project):

```sh
firebase deploy --only firestore:rules
```

With fresh rules + a working ImageKit endpoint, banners flow through the lean
index as small hosted URLs (one write, no extra reads). The top-up then simply
never fires.

## Verification

- `npm --prefix mobile run typecheck`: clean.
- No server, rules, or test changes; all `16.9.0` suites still apply unchanged.
