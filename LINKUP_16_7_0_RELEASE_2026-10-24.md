# LINKUP V16 / 16.7.0 — Linky welcome-back push invitations

- Date: **24 October 2026**
- App version: **16.7.0** · Android versionCode: **30**
- Working HEAD: **`codex/mobile-port`**
- Publish target: **the same reviewed commit on `codex/mobile-port` and `main`**
- Starting point: **`808763b`**, the latest 16.6.0 CI/artefact handoff (which includes the `eed8961` code baseline)

## What we built

Linky can now invite an inactive member back to LINKUP with a short, catchy native push notification. This is a dedicated re-engagement campaign inside the existing V16 retention scheduler—not a second scheduler, a new serverless endpoint, or an AI-generation job.

A typical notification is:

> **Linky · Your next move is calling.**
>
> 4 days since your last visit. Open LINKUP and choose one small, useful step. No catching up required.

Tapping it opens **Build with Linky → Today** (`/builder?section=Today`), where the existing welcome-back/continue/adjust/reset experience is available.

The campaign is deliberately truthful. It does **not** claim that a new match, message, profile view, opportunity, league position, or other event happened while the member was away. It does not use a missing build post as proof that somebody stopped using the app.

## The eight rotating headlines

The headline index is persisted after each eligible invitation. The next campaign uses the next script, then wraps after all eight. There is no immediate headline repeat.

| Key | Push headline | Invitation sentence appended after the real absence |
|---|---|---|
| `next-move` | Your next move is calling. | Open LINKUP and choose one small, useful step. No catching up required. |
| `comeback-arc` | Ready for your comeback arc? | Linky kept your place. Pick up where you left off and make today count in one small way. |
| `one-tap` | One tap. Back in motion. | Return to your workspace and turn a fresh start into one honest next step. |
| `plot-twist` | Plot twist: today can be different. | You do not need a perfect plan. Come back, choose one move and let momentum follow. |
| `big-dreams` | Big dreams. Tiny next step. | Your goals do not need a marathon today. Open LINKUP and choose the smallest useful action. |
| `future-self` | Your future self says: one small step. | No guilt and no streak debt. Linky can help you find a practical way forward. |
| `less-scrolling` | Less scrolling. More shipping. | Give your next idea ten focused minutes. Your LINKUP workspace is ready when you are. |
| `next-chapter` | Your next chapter is still wide open. | Come back for a fresh plan, a useful conversation, or one small build step. |

The body begins with the measured absence, for example `3 days since your last visit.` The native push title is prefixed with `Linky ·`.

## Exactly when Linky sends one

A welcome-back invitation is planned only when all applicable conditions pass:

1. The member is already covered by the server-owned V16 `builderStates` retention scheduler. The account must exist, be onboarded, and not be deleted or banned.
2. The latest observed activity is at least **three full days (72 hours)** old.
3. Activity is taken from the latest valid timestamp among:
   - `users/{uid}.lastActiveAt`;
   - `presence/{uid}.lastActiveAt`; and
   - `builderStates/{uid}.lastVisitAt`.
4. Unknown activity fails closed: Linky does not guess that the member is inactive. Scheduler writes to `builderStates.updatedAt` are intentionally excluded, so the notification job cannot keep somebody artificially “active.”
5. Global Daily progress messages (`prefs.retention`) are enabled, the dedicated **Linky welcome-back invitations** preference (`prefs.welcomeBack`) is enabled, and at least one delivery surface (`inApp` or `push`) is enabled.
6. The member is in an allowed local-time evening/night slot and outside their quiet hours.
7. Existing shared guards still apply: at most four retention messages per local day, at least 2.5 hours between messages, and no category twice in one day.
8. The campaign has its own **three-day cooldown**. A member who stays away can receive at most one welcome-back invitation per 72 hours, not one every scheduler run.
9. The deterministic notification ID and Firestore transaction prevent a replayed or concurrent worker from creating a duplicate.

`welcomeBack` defaults to `true` inside the existing retention system, but **native/browser push remains separately opt-in and defaults to `false`**. A member can turn off only welcome-back invitations while retaining other progress messages, or disable all retention messages.

## Push and notification delivery

### Native Android/iOS

- Uses the existing `userPrivate/{uid}.pushTokens` Expo token registration.
- Requires notification permission and a supported native development/production build; Expo Go is not presented as remote-push capable.
- Sends through the existing Expo push adapter in `api/_builderRuntime.js`.
- Push title and body are bounded to 100 and 180 characters respectively.
- Push payload includes `url`, `targetUrl`, `type: builder`, `campaign: linky_reengagement`, and `category: comeback`.
- The notification document remains `serverPushManaged: true`, preventing the generic Cloud Function listener from sending a second push for the same event.
- Expo acceptance is recorded as `provider_accepted`; that is not represented as proof of device delivery. No receipt-polling or automatic retry guarantee was added.

### Alerts inbox and foreground web

- The notification is attributed to **Linky** and stores the separate `title`, `body`, combined `content`, `campaign`, and `headlineKey` fields.
- The Alerts inbox displays the combined title/body and opens the existing builder section.
- Foreground browser notifications use the catchy Linky title and non-duplicated body.
- **Background web push is still not configured.** Browser alerts still require browser permission, an open LINKUP tab, and the existing preferences.

### Cost and privacy boundaries

- No AI model call and no Linky message-credit consumption.
- No email sending; email remains fail-closed.
- No private follow-up title, relationship note, project constraint, or coaching content is placed in the push.
- No new Firestore collection or rules change is required.
- No credentials or PAT values are stored in the repository.

## Code changes by file

| File | V16 change |
|---|---|
| `shared/linky-reengagement.js` | New pure campaign module: eight scripts, three-day threshold/cooldown, headline rotation, deep link, and honest push copy. |
| `shared/retention.js` | Integrates the comeback candidate into evening/night retention while preserving global delivery guards. Replaces the old “missing build day means away” comeback with real inactivity targeting. |
| `api/_retention.js` | Normalizes Firestore/Date/numeric/ISO timestamps and derives `lastActiveAt` / `daysSinceActive` from user, presence, and workspace activity. |
| `api/_builder.js` | Reads presence, plans inside the existing transaction, persists cooldown/headline state, writes campaign metadata, and uses the Linky push title. |
| `api/_builderCore.js` | Adds and validates `welcomeBack`; default is enabled while native push remains disabled by default. |
| `api/_builderRuntime.js` | Carries campaign/category push data, high priority, and bounded title/body copy through Expo. |
| `mobile/src/screens/BuilderWorkspaceScreen.tsx` | Adds the **Linky welcome-back invitations** switch and plain-language cadence/privacy explanation in Settings. |
| `mobile/src/lib/notifications.ts` | Uses the Linky campaign headline and body for foreground browser/native local notification presentation. |
| `mobile/src/types.ts` | Adds optional campaign headline/body metadata to the notification type. |
| `functions/src/index.ts` | Keeps the generic notification fallback consistent with Linky campaign title/body fields; server-managed campaign pushes remain deduplicated. |
| `mobile/app.json`, `mobile/package.json`, `mobile/package-lock.json` | Bumps to 16.7.0 / Android versionCode 30. |
| `RELEASE_NOTES.md` | Adds the 16.7.0 summary and corrects the older quiet-hours wording to “never during quiet hours.” |
| `tests/linky-reengagement.test.mjs` | Six pure/source regression tests for scripts, eligibility, rotation, shared guards, timestamp selection, and UI/push wiring. |
| `tests/firestore-profile/linky-reengagement-api.test.cjs` | Two Emulator integration tests for real transactional delivery, push copy, dedupe, rotation, cooldown, opt-out, and recent-presence suppression. |
| `LINKUP_16_7_0_RELEASE_2026-10-24.md` | This complete V16 implementation and operations handoff. |

## Persisted state and diagnostics

Two fields are added to the server-owned builder state when an invitation is delivered:

- `lastComebackAt`: epoch milliseconds used for the campaign cooldown;
- `comebackSequence`: the next rotating headline index.

Comeback notification documents use the existing deterministic retention ID and include:

- `category: comeback`;
- `campaign: linky_reengagement`;
- `headlineKey`;
- `title`, `body`, and `content`;
- `url: /builder?section=Today`;
- `pushRequested`, `pushAttemptAt`, and best-effort `pushStatus` where applicable.

These fields require no migration. Older app versions ignore the extra metadata; the existing `/builder` deep-link handler remains compatible.

## Verification completed locally

| Check | Result |
|---|---|
| Complete root unit/source suite — `node --test tests/*.test.mjs` | **246 passed / 0 failed** |
| Firestore Emulator API, rules, concurrency, and delivery suite — `npm run test:firestore` | **89 passed / 0 failed** |
| New pure/source comeback tests | **6 passed**, included in the 246 |
| New Firestore comeback integration tests | **2 passed**, included in the 89 |
| Exported web-mount and deep-link contracts | **12 passed / 0 failed** |
| Mobile TypeScript — `npm --prefix mobile run typecheck` | Passed |
| Firebase Functions TypeScript — `npm --prefix functions run build` | Passed |
| Expo production web export — `npm --prefix mobile run build:web` | Passed |
| Live public routing — `npm run verify:web-routing` | Passed; this does not prove authenticated or payment flows |
| Version metadata consistency | 16.7.0 and versionCode 30 matched across app/package/lock files |
| Diff whitespace validation — `git diff --check` | Passed |
| Credential scan of tracked workspace changes | No supplied PAT found in repository files |

The new integration tests specifically proved that two overlapping workers produce one invitation/push, a replay does not send again, the next eligible send after 72 hours uses a different headline, recent presence suppresses the campaign, and the dedicated opt-out suppresses it.

## Reproduce

```sh
npm ci
npm --prefix mobile ci
npm --prefix functions ci
npm --prefix tests/firestore-profile ci

node --test tests/*.test.mjs
npm --prefix mobile run typecheck
npm --prefix functions run build
npm run test:firestore
npm --prefix mobile run build:web
node --test mobile/scripts/test-web-mount.cjs
npm run verify:web-routing
git diff --check
```

Run the web export before the exported web-mount test, not concurrently with it. The Emulator suite uses the demo project and requires Java; it does not write production data.

## Deployment and real-device checklist

1. Keep `codex/mobile-port` checked out as HEAD and publish the same reviewed commit to both `codex/mobile-port` and `main`; do not force-push over unseen remote changes.
2. Confirm the existing Vercel production workflow triggered by `codex/mobile-port` succeeds. The campaign planner and direct Expo adapter run inside the existing `/api/linky` builder cron path.
3. Confirm the hourly `.github/workflows/campaign-expiry.yml` workflow reaches `functions/linky-cron.mjs` with its service-account authentication and bounded pagination. There is no separate comeback cron to enable.
4. If deploying Firebase Functions separately, include the updated generic notification fallback. The direct campaign push itself does not require a new Cloud Function.
5. On an authorized test account, enable Daily progress messages, Linky welcome-back invitations, and native push; confirm a valid Expo token is registered.
6. With activity older than three days and outside quiet hours, run the scheduled path and verify one notification, one Expo request, the expected deep link, and no duplicate from the generic notification listener.
7. Verify on a physical Android/iOS device. Build/sign 16.7.0 separately if a new native binary is required; version metadata is not an APK/AAB.

## Not claimed by this release

- No physical-device push was sent during local verification.
- No signed APK/AAB, Play Console upload, production Vercel deployment, or live hourly cron run is proven by the local tests.
- No background web push, push receipt polling, delivery guarantee, AI-written personalization, or email re-engagement was added.
- Members without a server-owned builder retention state are not newly enrolled by this change; extending the campaign to every LINKUP account would require a separate global preference/scheduler design.

## Rollback

Members can immediately stop this campaign with **Settings → Linky welcome-back invitations**, or stop all daily messages with **Daily progress messages**. A code rollback can revert the 16.7.0 commit without a data migration; the two extra state fields and notification metadata are harmless to older code.
