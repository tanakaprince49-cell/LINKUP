# LINKUP 16.9.8 — Quota burners fixed + calendar shows the owner's name

- **Date:** 25 October 2026
- **Source version:** `16.9.8`
- **Android versionCode:** `40`
- **Baseline:** `c23a05a` (`16.9.7`)
- **Requested branch:** `codex/mobile-port` (retained as HEAD)

## Problem

The project exhausted its no-cost Firestore limits. A code audit ranked the
burners: group-chat polling (~360 reads/min per open chat), the hourly
full-database backfill (2N reads/hour), the Alerts tab (up to 450 reads +
450 writes per tap), an uncached 200-match scan per profile focus, hourly
full-collection reminder scans, and uncached sitemap XML for crawlers.

## Delivered behavior (quota)

- `groupMessages` short-circuits matching-revision polls: no 51-message
  query when nothing changed (access check only, ~5 reads vs ~60). Chat
  polling stays 10s with zero UX loss; read receipts auto-skip on empty
  polls. Group inbox polling slows 10s → 60s.
- The public-profiles backfill now runs daily at 03:00 UTC and renewal
  reminders daily at 04:00 UTC (was: both hourly); manual dispatch still
  runs any hour. Campaign sweep and Linky housekeeping stay hourly.
- Opening Alerts marks the already-loaded page read with zero fresh reads;
  the backlog sweep is capped 450 → 100 docs and throttled to once/minute.
- The 200-match response-rate scan is cached 5 minutes with last-known
  fallback (completing the `16.9.7` dashboard caching).
- Sitemap XML (`sitemap`, `static`, `profiles` modes) is edge/browser
  cached for 1 hour. Profile, directory and image responses stay
  `no-store` (privacy) — untouched.

## Delivered behavior (calendar)

- `ContributionCalendar` accepts the owner's display name; `ProfileScreen`
  passes it when viewing someone else's calendar, so the heading reads
  e.g. "Tanaka Prince's calendar, date by date" instead of "Your calendar,
  date by date". Own calendars are unchanged.

## Verification

- New emulator assertion: matching-revision poll returns empty messages
  with the same revision.
- Full pre-promotion battery green locally: privacy 4/4, copy 8/8, linky
  84/84, identity 9/9, profile 4/4, builder 56/56, payments 6/6, seo
  43/43, web-paths 11/11, emulator suite 94/94, plus `mobile` typecheck
  clean. `copy-runtime-contracts.json` regenerated for the new cache and
  mark-read calls.
- NOTE: the Vercel workflow's final live-routing step checks the
  quota-exhausted production site and stays red until the daily Firebase
  reset (~09:00 Harare); build, battery and promotion are unaffected.
