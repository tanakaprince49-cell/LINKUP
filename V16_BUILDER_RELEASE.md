# V16 — Build with Linky

Date: 23 October 2026
App version: **16.0.0** · Android version code: **22**
Status: **Implemented and locally verified. Not a production deployment or signed native release.**

## What is implemented

| Approved area | Working implementation |
|---|---|
| Linky-first entry | Linky is the initial tab. First-conversation goal shortcuts lead to collaboration/investor planning, pitch review, validation, blocker review or launch feedback. The full-screen chat and its top allowance counter remain intact. |
| Building Context and return briefing | Private editable project, stage, goal, skills, needed help and constraints; location/stage/remote/availability preferences; weekly outcomes; real due follow-ups, room changes, invitations and one recommended next move. Context can be cleared without resetting AI credits. |
| Relationship follow-through | Approved-connection selection, why-connected notes, private notes, next action/date, editing, permanent deletion, completion/dismissal/snooze, history and editable review-before-send drafts. Copying never sends a message. Existing approved conversations remain the sending surface. |
| Relevant Daily 5 | Server-checked public-profile evidence and blocking, preference filters, explanations, useful/not-useful/contacted feedback, fewer than five when appropriate. Self-reported availability expires in seven days. No filler fallback or XP for merely opening a Daily 5 card. |
| External sources | Four manually reviewed official investor/community/professional-service sources, attribution, official route, check date, relevance explanation, saving and a 90-day review expiry. External sources are never presented as LINKUP members or verified available people. Existing external-person search remains permission-based; LinkedIn searches require the member's request/confirmation. |
| Project rooms | Private accepted-member rooms, explicit goal and next milestone, assigned tasks, progress logs, conversation and HTTPS links. Invitations require approval and a current mutual connection; blocking revokes content access. Owners can archive; other members can leave, including after a block. |
| Voluntary accountability | Two-person opt-in accountability rooms, goals/check-ins, leave/archive controls and no compulsory streak. No automatic pairing. |
| Structured help and launch feedback | Specific question, context, time commitment, paid/voluntary/partnership disclosure, optional HTTPS demo, 14-day expiry, substantive feedback, author-recognized usefulness/outcome and closure. Cursor pagination and an author's closed/expired history are available. |
| Solo coach | Pitch, blocker/code-excerpt and customer-validation workflows. Saved context reaches coach prompts only with explicit consent. The same consent can enable context in ordinary in-app Linky advice, not bot conversations; private context is excluded from the shared intent cache. Known credential patterns are rejected in submitted review material. No execution, security-audit or investment-probability claims. |
| Friday drop | Opt-in, sourced review of recent member requests and relevant newly curated catalog entries. Delivered opportunity IDs are remembered. No fabricated members, events or new discoveries; no alert if there is nothing to include. Matching stays available all week. |
| Progress digest | Opt-in Sunday summary from actual goals, completed follow-ups, help-board replies, observed incoming chat messages, completed room tasks, due follow-ups, sourced opportunities and the next action. Empty context-only summaries do not trigger a digest. |
| Builder Momentum | Contribution days for completed outcomes, room progress, completed follow-through and feedback recognized as useful. Re-completing a task cannot farm another day. This is never evidence of expertise, trust, verification or investability. |
| Welcome-back reset | Continue/adjust/reset controls, availability refresh, a manageable next action and private reset without quota refill. Changing building goals/needs clears stale recommendation exclusions. |

## Delivery, privacy and quotas

- Free AI allowance remains **15 messages per calendar month**, shared with ordinary Linky chat. PLUS retains the existing **60 messages per day** ledger. A coach review uses one message; provider failures refund the reservation. Deterministic tracking/planning does not consume AI messages.
- Private state and all builder mutations are server-owned. Direct Firestore access to builder collections is denied, including for an apparent owner. Other users cannot request another member's notes/export through an input UID.
- In-app/push retention is opt-in by type. Defaults: reminders, digest, Friday drop, native/browser alerts and AI context use **off**; in-app inbox and allowing connection invitations **on**.
- Scheduling uses the member's validated IANA timezone and quiet hours; at most one scheduled retention notification per 20 hours. Reminder IDs and delivery transactions are idempotent under concurrent workers.
- Native push is best-effort. The adapter records whether Expo accepted the request; acceptance is not proof of device delivery. No receipt polling or automatic transport retry is claimed.
- Background web push is not configured. Foreground browser alerts require an open tab, browser permission, the builder push preference and in-app reminders enabled. In-app-only reminders do not create browser OS alerts.
- Email preferences fail closed: **no email sending until a verified provider, opt-in/suppression, domain setup, signed unsubscribe and idempotency are implemented/configured**.
- Private reset does not delete shared contributions; this is stated in the confirmation/export. The account-deletion Cloud Function removes private builder state, removes room access, archives owned shared rooms, removes the departing user's messages/logs/links and removes their asks/invitations/feedback. Deploying that function is a release prerequisite.
- Builder audit metadata is bounded to one document with the latest 40 entries per user; it does not store notes/prompts. Room, message, task, review and follow-up arrays have server-side bounds.

## Honest bounds and initial data

This is a working first release, not a claim of unlimited discovery or background research:

- Recommendations inspect up to 160 discovery records.
- Help-board pages inspect 40 records and expose a next cursor. Hidden, blocked, closed and expired public requests are excluded; an author can access their own history.
- Weekly summaries inspect the first 40 board records, the last ten messages in up to 20 currently approved chats, and up to 30 accepted rooms. Counts describe observed activity, not guaranteed exhaustive totals.
- Initial external catalog: **ABAN, Dazzle Angels, Open Source Community Africa and Andela**. These are organization/community/service routes, **not an imported directory of individual investors or developers**. No current pitch/hiring availability, endorsement, legal vetting or unsolicited outreach permission is inferred.
- There is no new events feed or invented new-member inventory. Only actual available sources are included in a drop. Broader individual-lead catalogs, licensed imports and verified event feeds require additional real source data and permission checks.
- Accountability check-in cadence is agreed by participants; there is no autonomous monitoring or guilt-based reminder system.

## Verification completed locally

| Check | Result |
|---|---|
| Root regression and web-mount contracts | **182/182 passed** |
| Firestore Emulator — API, concurrency, quota and security rules | **35/35 passed** |
| Builder pure/source tests | **15/15**, included in the 182 |
| Mobile TypeScript | Passed |
| Firebase Functions TypeScript build | Passed |
| Expo production web export | Passed |
| Exported-app Chromium smoke | Passed at original root, `/app` desktop proxy and `/app` mobile proxy; auth navigation, refresh, noindex, PWA/worker scope, transport and marketing isolation checked |
| Actual workspace component in Chromium | Passed at **390px and 1150px** for context, goals, coach UI, actual-profile navigation parameters, private draft copy, room plan, help history, source display and settings |
| Diff whitespace validation | Passed |

The workspace component smoke uses explicitly isolated auth/API adapters and cosmetic header/icon/rich-text adapters; it never contacts production or an AI provider. Backend behavior is independently exercised against the real Firestore Emulator. Screenshots under `artifacts/v16/` show this **offline test harness**, not a live account. Exported-app routing smoke does not sign in. No production AI, native device delivery, payment, live account deletion or signed Android/iOS build was tested in this release.

### Reproduce

```sh
npm ci
npm --prefix mobile ci
npm --prefix functions ci
npm --prefix tests/firestore-profile ci
npm --prefix mobile run typecheck
npm --prefix functions run build
npm --prefix mobile run build:web
node --test tests/*.test.mjs mobile/scripts/test-web-mount.cjs
npm run test:firestore
```

The emulator command requires Java and uses demo project `demo-linkup`; its Admin SDK tests refuse to run without `FIRESTORE_EMULATOR_HOST`.

Optional browser tools can be installed into a scratch prefix, without adding production dependencies:

```sh
npm install --prefix /tmp/linkup-browser esbuild playwright
/tmp/linkup-browser/node_modules/.bin/playwright install --with-deps chromium
BUILDER_BROWSER_TOOLS=/tmp/linkup-browser/node_modules npm run test:builder-browser
PLAYWRIGHT_MODULE_PATH=/tmp/linkup-browser/node_modules/playwright npm --prefix mobile run test:web-browser
```

## Repository handoff

The checked-out branch remains `codex/mobile-port`. No remote push occurred. A non-interactive dry-run to the repository failed because no repository username/credential was available. No PAT is saved. Authorize repository access before publishing; do not force-push over unseen remote changes.

Do not run the web export concurrently with the web-mount test: export replaces `mobile/dist`, which the mount test reads. The final passing run used the completed export.

## Release checklist — not yet performed

1. Authenticate repository access and push the **same reviewed commit to both `codex/mobile-port` and `main`**, retaining `codex/mobile-port` as the checked-out branch.
2. Deploy Firestore rules and the updated `cleanupDeletedUser` / `sendPushForNotification` functions. The latter suppresses duplicate pushes for server-managed builder notifications; it must be live before enabling native retention delivery. Confirm Firebase plan/deployment permissions first; no billing upgrade is authorized by this code change.
3. Promote the Vercel web/API release using the existing workflow. There is no extra Vercel function: builder actions remain inside `/api/linky`.
4. Confirm the existing hourly campaign-expiry workflow executes `functions/linky-cron.mjs`. Builder requests use the existing service-account authentication, persisted pagination cursor and bounded pages. The cron cannot send email.
5. In a dedicated test account, verify context save/erase, real paid/free AI ledger behavior, approved invitations, public visibility changes, room updates, notification deep links and account deletion on deployed services.
6. On a supported physical native build, verify permission/token registration, builder opt-out, quiet hours, push suppression and device delivery. Build/sign Android/iOS separately; version metadata is not a native binary.
7. Keep email disabled. Expand public-person/event catalogs only with actual attributable and permitted sources; continue asking before LinkedIn searches.

### Files and routes

- UI: `mobile/src/screens/BuilderWorkspaceScreen.tsx`; `/builder?section=Today` and the other eight sections.
- Client adapter: `mobile/src/lib/builder.ts`.
- Service and rules: `api/_builder.js`, `api/_builderCore.js`, `api/_builderRuntime.js`, `api/linky.js`, `firestore.rules`.
- Curated sources: `shared/builder-leads.js`.
- Scheduler: existing `functions/linky-cron.mjs` / campaign-expiry workflow.
- Regression coverage: `tests/builder-core.test.mjs`, `tests/firestore-profile/builder-api.test.cjs`, `tests/builder-browser.cjs`, existing Linky/copy/SEO/privacy/payment suites.

Prior SEO release `38a52cf` remains the last verified production baseline until an actual new deployment is confirmed.
