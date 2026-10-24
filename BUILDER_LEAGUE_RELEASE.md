# Builder League / private Groups release

Date: 24 October 2026. Base: `94e8044fe2b673d79226cc94be54d95cf07d44d2`.

## Implemented

- Server-owned weekly, monthly and lifetime Builder League: 10 points per recorded build day, 5 per recipient-acknowledged helpful contribution. UTC resets, deterministic shared ranks, podium, own rank, next-target gap and exact city/country filtering. No paid, login, profile-view or invented skill boosts.
- Searchable server-rendered public league and Momentum pages: canonical metadata, social metadata, JSON-LD, internal links and live-eligibility sitemap. Works without JavaScript. Root and `/app` rewrites use the existing public SEO function, not a new serverless function.
- Public Momentum remains OFF until explicitly enabled. Consent covers public name/location/totals/calendar dates and search caching. Visible Progress Log switch enables and disables it; turning it off immediately makes the public calendar return 404/noindex and removes it from the live league/sitemap. Hidden, deleted, banned and stealth accounts are excluded. No update text, private links, chat, feedback notes or wallet records are published.
- Rooms UI replaced by private Groups: create, approved-connection invitations, acceptance/decline, full-screen chat, retry-safe sends, paginated history, foreground polling, admin removal/transfer, archive and leave. 32 accepted members, 12 active owned groups. Server-only message collection; block checks apply in both directions. Legacy project data remains available through explicitly scoped export rather than deleted.
- Dedicated paid Coach removed, old clients receive 410, and there is no model dependency in the builder runtime. Main Linky implementation restored to pre-V16 `38a52cf` behavior, including its existing caching. Main allowances stay 15/month free and 60/day PLUS. Deterministic instant progress feedback, goals, breaks, reminders, helpful-feedback credits, Daily 5 and follow-ups remain. Email remains disabled.
- Momentum and workspace use LINKUP yellow/ink/paper. Recorded calendar cells are solid `#FBE618` with static glow; empty/rest days do not masquerade as work. Group and league asynchronous responses are scoped to account/route/period to avoid stale private views.
- Deletion cleanup pages authored group messages, including former members and accounts whose private workspace state has already been erased. Existing cron performs a bounded group-author sweep; no new AI or extra scheduled function.
- App privacy policy source and generated HTML/Markdown now disclose public calendars and private group processing. The separate marketing repository's canonical `/privacy` copy must also be synchronized before this policy update is considered deployed everywhere; this repository's `/app/privacy` copy is included here.

## Verification

- Node regressions: 190 passing (includes new activity scoring, source visibility, SSR escaping, consent/opt-out and bounded top-100 tests).
- Firestore Emulator: 67 passing (includes nested-message denial, idempotent sends/cursors, membership/admin/block/invite/32-member limits, no AI/quota spend, consent preservation, live SSR privacy and former-author deletion).
- TypeScript typecheck: pass.
- Expo production web export: pass.
- Root and `/app` routing/mount/export tests: 12 passing.
- Real-component Chromium smokes, isolated auth/API adapters and no production writes: workspace, Momentum publishing, habit/public opt-in/out at 390px and 1150px; league/group checks in light and dark at both widths. Covers rapid period changes, own rank/gap, profile navigation, group create/send/retry/invite, account-switch privacy, no overflow/runtime errors/external calls.
- Screenshots under `docs/qa/activity-league/` use clearly fictional offline fixture members; these are QA artifacts, not production standings.

## Operational limits and remaining deployment work

- League scans at most 5,000 public opt-in records and returns top 100 plus own row and nearest higher-ranked target. A truncated scan is disclosed, never presented as a complete global ranking. Live visibility checks intentionally avoid public profile caching; monitor Firestore read costs as participation grows. Scale with a privacy-safe materialized score index before exceeding the scan ceiling.
- Group history is paginated 50 messages per API response, with a 500-message client window. Copy export is explicitly **latest 50 plus retained legacy project notes**, not a complete-history export; cursors can retrieve earlier history.
- Foreground group polling is every 10 seconds; not an independently verified native realtime/push delivery guarantee.
- Searchable pages and sitemaps do not guarantee Google indexing or ranking. Search Console ownership, submission, recrawling and live deployment checks remain operational steps.
- Native APK/AAB/iOS build and device acceptance are separate; this is shared-source/web work.
- No production member login, model/provider call, payment transaction, native push or production account deletion was exercised.
- Push authorization is currently absent: a noninteractive push dry-run returned a GitHub username/credential error. No PAT is stored in source, remote URL or credential files. Both branches must be pushed atomically after authorization; keep `codex/mobile-port` checked out. Exact-SHA CI/live verification must follow the push. Do not describe this local work as deployed.
