# LINKUP 16.9.0 — Profile banners, daily-only free Linky, discoverable groups

- **Date:** 24 October 2026
- **Source version:** `16.9.0`
- **Android versionCode:** `32`
- **Baseline:** `c87242d` (`16.8.0`)
- **Requested branch:** `codex/mobile-port` (retained as HEAD)

## 1. Delivered behavior

Three member-facing features in one release:

1. **Profile banner pictures.** Every profile page now has a wide banner above the
   avatar. Owners pick a photo (16:9 crop), see it instantly, and can change or
   remove it; the image is hosted on the ImageKit CDN and every visitor sees the
   same banner. Profiles without a banner show a branded placeholder (owners get
   an "Add banner" prompt; visitors see nothing extra).
2. **Daily-only free Linky allowance.** The 15/month bucket is retired. Free
   members get **5 Linky messages per UTC day**, resetting at midnight UTC. The
   chat header shows "N of 5 free messages today" and nothing monthly; when the
   five are used up the composer locks with a live reset countdown and the PLUS
   paywall opens. PLUS remains unlimited.
3. **Discoverable groups.** Every new group is listed publicly by default, and any
   signed-in member can browse groups (search + paging) and join straight from
   the listing. Only the name, bio, photo and member count are listed — messages,
   member lists, rules and invites never leave the room. Group admins can unlist
   a group at any time; unlisted groups stay invite-only.

## 2. Profile banners

- `mobile/src/screens/ProfileScreen.tsx`: full-bleed banner (148pt, rounded to
  the hero card), avatar overlapping the bottom edge, tap-to-view fullscreen via
  the existing photo modal, camera pill to add/change, one-tap remove.
- Upload reuses the avatar pipeline: `expo-image-picker` → compressed data URI →
  immediate `users/{uid}.coverPhoto` save → hosted ImageKit URL
  (`/linkup-banners`, new `uploadBannerToImageKit` in
  `mobile/src/lib/imagekitUpload.ts`).
- Everyone sees the banner because it flows into the lean public index:
  `compactProfileForList` / `compactProfileForCache` preserve `coverPhoto`,
  `buildPublicProfileIndex` indexes the hosted URL only
  (`storedProfileImageUri`, never base64), and `firestore.rules` gained the
  `coverPhoto` key (string ≤ 2048) on `publicProfiles`. The `users` doc already
  allowed `coverPhoto`, so no other rule changed.
- New emulator rule test: owners can publish a hosted banner URL but not
  oversized values; strangers cannot write another member's index row.

## 3. Daily-only free Linky allowance

| Plan / guard | Current behavior |
| --- | --- |
| Free allowance | 5 messages per UTC day, resetting at 00:00 UTC; no monthly bucket |
| PLUS member allowance | Unlimited; no exhaustion |
| Shared daily deployment guard | Still rejects free asks at the configured ceiling; PLUS bypasses the rejection |
| Usage accounting | Free and PLUS reservations remain transactional and are counted |
| Failed processing | Existing reservation refund path remains active for member and shared counters |

- `shared/linky-budget.js`: `freePerMonth: 15` is retired; the free allowance is
  `freeDaily`/`freePerDay` (default 5, `LINKY_FREE_DAILY` override unchanged).
- `api/_linkyUsage.js`: the free quota is day-shaped (`period: 'day'`,
  `periodKey: YYYY-MM-DD`, single `daily` ledger bucket). Historical `month`
  ledgers are ignored, so every free member starts each UTC day fresh.
  Exhaustion returns `ask_limit` + `upgradeRequired: true` with a daily message.
- `api/_linky.js`: `LIMITS.free.asksPerDay`, home `limits` publish the daily
  allowance (`asksPerMonth`/`asksUsedThisMonth` are retired `null` aliases),
  and the limit-intent wording quotes 5/day.
- `mobile/src/screens/LinkyHomeScreen.tsx`: header shows
  "N of 5 free messages today" / "Today's free messages are used up" plus the
  reset countdown; the composer is replaced by a locked panel (tap → paywall)
  once the five are spent; the paywall is titled "Linky daily message allowance".
- `mobile/src/lib/linkyQuota.ts` fallback derives a day-shaped quota;
  `PaywallModal` default copy, store-listing copy, `LINKY_SETUP.md`,
  `LINKY_LIMITS_AND_REVIEWS.md`, `docs/qa/linky-allowance-plan.md` and
  `.env.example` all quote 5/day.

## 4. Discoverable groups

- `api/_groups.js`: `groupCreate` stamps `discoverable: true`; new `groupDiscover`
  op (safe metadata only, search + cursor paging over a bounded single-index
  query — no composite index needed); new `groupJoin` op with invitation-grade
  rails (blocks, bans, 32-member cap, archived/legacy/private refusal);
  `groupUpdate` lets admins toggle `discoverable`; `groupGet` and the `groups`
  list publish the flag. `api/_builder.js` allowlists the two new ops.
- `mobile/src/screens/GroupChatScreen.tsx`: the Groups panel gained a "Discover
  groups" section (search, cards with photo/bio/member count, Join/Open, "show
  more"); group settings gained a "List publicly" switch; headers and list rows
  label discoverable vs private groups. `builderRooms` stays server-only in the
  rules — discovery runs entirely through the authenticated API.
- New unit suite `tests/group-discover.test.mjs` (6 tests) plus two emulator
  tests in `tests/firestore-profile/builder-api.test.cjs` covering listing
  shape/privacy, paging, search, join rails, and unlist/relist.

## 5. Verification

- `node --test` over the Linky suites (`linky-usage`, `linky-companion`,
  `app-review`, `linky-shortlist`, `linky-text`), `group-discover`,
  `group-package`, `profile-save`, `linky-reengagement`: all pass.
- Builder suites (`builder-core`, `contributions`, `build-habit`,
  `activity-league`, `group-package`, `daily-workbench`): 56/56 pass.
- Firestore emulator (`rules`, `builder-api`, `contributions-api`,
  `build-habit-api`, `linky-reengagement-api`, `linky-unlimited`): 94/94 pass.
- `npm --prefix mobile run typecheck`: clean.
- Pre-existing failure, unchanged by this release: `retention-calendar-card`
  "the planner never sends the same category twice a day…" fails identically on
  the `16.8.0` baseline.

## 6. Rollout notes

- No database migration: retired monthly ledgers are ignored, legacy groups
  without the `discoverable` field list publicly until an admin unlists them,
  and profiles without `coverPhoto` render as before.
- Deploy the web/API and `firestore.rules` together so the banner index write
  is accepted; app clients pick up all three features from the same build.
- The backend/web deployment and Android/Play Store releases are separate.
  Check the GitHub production workflow and deployed build identifier for web
  rollout status; do not interpret a repository push as an Android publication.
