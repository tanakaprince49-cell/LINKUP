# LINKUP 16.9.4 — Banners visible to everyone, resilient index publish

- **Date:** 24 October 2026
- **Source version:** `16.9.4`
- **Android versionCode:** `36`
- **Baseline:** `01c7e54` (`16.9.3`)
- **Requested branch:** `codex/mobile-port` (retained as HEAD)

## Root cause

Visitors read `publicProfiles/{uid}` (world-readable), while the owner reads
`users/{ownUid}`. The banner publish to the public index requires the deployed
`firestore.rules` to contain `coverPhoto` in the `hasOnly` key list. With
pre-`16.9.0` rules still deployed, every index write is rejected as
PERMISSION_DENIED (previously swallowed silently), so the owner sees their
banner while nobody else does — and the rest of the public index freezes too.

## Delivered behavior

- `syncOwnPublicProfileIndex` no longer lets one rejected key freeze the whole
  public profile: on failure it retries once without `coverPhoto` so name,
  avatar, bio, search and discovery stay fresh for everyone, and logs a loud
  warning to deploy the latest `firestore.rules`.
- The publish signature is now recorded only after a successful write, so a
  failed banner publish retries on the next sync instead of being skipped for
  the rest of the session. App launch re-syncs the full index, so deploying
  the rules plus an app restart backfills every banner automatically.
- Profile viewing now live-refreshes: when the server copy of a viewed profile
  arrives and differs from the cached copy, the screen re-renders with it, so
  a newly set banner appears within ~1s instead of only on revisit.

## Required deployment step

Deploy the rules from the repo root (logged into the LINKUP Firebase project):

```sh
firebase deploy --only firestore:rules
```

Then restart the app on the banner owner's device and view the profile from a
second account. Sanity check: if other people's avatars render, the ImageKit
CDN lane works and the rules deploy is the only missing piece.

## Verification

- `npm --prefix mobile run typecheck`: clean.
- No server, rules, or test changes; all `16.9.0` suites still apply unchanged.
