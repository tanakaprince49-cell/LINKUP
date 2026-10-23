# Instant rewards, contribution calendar and icon cleanup

Release: **16.0.1**, Android version code **23**. Source/native metadata only; no signed native binary is produced by this change.

## Delivered

- Progress Log publishes through an authenticated server transaction, not a client-writable score.
- A successful update immediately returns **two sentences of topic-aware Linky coaching**, awards **10 contribution points**, and lights the recorded UTC day on a 12-week contribution calendar.
- Calendar appears on the owner's and eligible viewed profiles and in Progress Log. It has a glowing green recorded-day square, a subtle current-day pulse, a screen-reader summary and reduced-motion support. Gaps are neutral: no punitive streak loss.
- Coaching responds to database/rules work, code/testing, customer validation, launches, revenue, design and team updates. It is transparent, deterministic topic-based feedback: **no model call and no chat credit consumed**. A separate deeper-review button opens the existing one-message coach with the update prefilled.
- All sparkle and magic-wand-sparkle icons were removed from application source. Decorative icons are omitted; functional chat-intro and campaign-placement controls use ordinary people/conversation icons instead. Blue/gold verification identity is unchanged.

## Honest scoring

These are **contribution points for recording self-reported progress**, not a technical-founder rating, proof of expertise, verification or investability. There is no invented “top 5% of Harare” claim or guaranteed Firebase savings. Firebase-related feedback recommends testing allowed/denied requests and measuring actual read volume.

Example:

> Good move—test both allowed and denied database requests before shipping. Your update earned 10 contribution points; measure actual read volume before estimating cost savings.

## Integrity and privacy

- Server time determines the UTC day; input points, dates, percentiles or another user's UID cannot award rewards.
- At most one rewarded update per UTC day. Concurrent submissions cannot both win. Same-key retries return the recorded receipt without another award; changed payloads on that key are rejected. Exact duplicate content in retained update history is rejected on later days.
- Idempotent receipts/duplicate-text detection use the latest 20 retained canonical updates. This is not an unlimited archival receipt ledger. The daily counter remains authoritative independently of UI state, private-context resets or legacy profile fields.
- Calendar retains up to 366 days, private canonical text/coaching history up to 20 updates, and all-time recorded-point/update totals.
- New update text and Linky feedback are **private**, in `builderContributions/{uid}`. Other eligible members receive only date/point summaries, never update text, links or saved coaching. Older legacy profile-stored logs retain their existing storage/visibility and are not retroactively awarded points.
- Direct Firestore client reads/writes to the canonical collection are denied. Visibility, blocking, deletion and bans are checked server-side before exposing another profile's calendar.
- New updates are not copied into public `users` fields, do not modify reputation/founder scores and do not grant blue/gold/paid badges. The old progress helper now uses the same server adapter instead of trying to stamp verification fields from the client.
- Known credential patterns and non-HTTPS/embedded-credential URLs are rejected. This is a safety check, not a guarantee that arbitrary sensitive text can be detected.
- Account-deletion Cloud Function source deletes the new collection. The already authenticated hourly scheduler also removes contribution records when their owner profile is missing/deleted, so this cleanup path does not depend on the separate pending Cloud Function rollout. A private-context reset deliberately does not erase the progress ledger or refill rewards.
- Existing free **15 chats/month** and PLUS ledger are unchanged.

## Verification

- **188/188** broad regression/source/web-mount tests passed.
- **46/46** real Firestore Emulator API/rules tests passed, including contribution concurrency, retry, midnight rollover, privacy, no quota/provider call, no badge escalation, bounded retention and deleted-owner cleanup.
- Mobile TypeScript and Functions TypeScript build passed.
- Production web export passed.
- Actual Progress Log and ContributionCalendar components passed offline-adapter Chromium workflows at **390px and 1150px**: publish, two-sentence receipt, a 10-point receipt, glowing day, disabled same-day submission, deeper-coach navigation, no overflow, reduced motion and unavailable/blocked calendar handling.
- Existing builder workspace offline-adapter UI smoke passed at both widths. Exported-app root and `/app` proxy browser smoke is checked separately before publication.
- Browser adapters do not sign in or write to production and do not call an AI provider. Screenshots in `artifacts/contributions/` show this explicitly isolated UI harness, not a live account.

### Commands

```sh
npm run test:builder
npm run test:firestore
npm --prefix mobile run typecheck
npm --prefix functions run build
npm --prefix mobile run build:web
node --test tests/*.test.mjs mobile/scripts/test-web-mount.cjs
BUILDER_BROWSER_TOOLS=<scratch>/node_modules npm run test:contribution-browser
```

Optional browser dependencies: `esbuild` and `playwright`, installed in a scratch prefix as documented in `V16_BUILDER_RELEASE.md`. Run export before, not concurrently with, tests that inspect `mobile/dist`.

## Publication

The source change must be pushed to **both `codex/mobile-port` and `main`**, keeping `codex/mobile-port` checked out. Existing CI promotes web/API and deploys Firestore rules after tests. Web publication does not create a signed native binary or deploy the previously pending Firebase push-suppression Cloud Functions. An external deployment verification report, when created, records actual published commit and workflow results.
