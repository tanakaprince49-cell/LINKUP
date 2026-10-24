# Groups, genuine builders and Momentum cards — 2026-10-24

## Scope

- Accepted private groups are listed in Messages as their own persistent conversations, above the direct-message section. This is not a single globally intersorted list of DMs and groups.
- Group photo upload/removal, bio, rules, co-admin invitations and promotions, member role labels, blue/gold group and sender checks, replies, own-message edits, own/admin deletion markers, message pinning, five reactions, bans/unbans, announcements-only posting, conversation mute/pin, block/unblock recovery, ownership transfer and archiving.
- Co-admin invitations require recipient acceptance. Co-admins can invite/promote other admins; only the owner can demote co-admins, moderate another admin, transfer ownership or archive the group. A blocked pair cannot use the shared conversation until the block or membership is resolved.
- Group verification uses immutable, server-stamped creator identity and PLUS-at-creation provenance. CEO-created groups receive both checks only for UID `FvxIfciyHMfQZbLwziZpseMNKxC3`. Ownership transfer does not change provenance. **Older groups without trustworthy creator records are not guessed to be CEO/PLUS-created from their current owner**; audited server-side backfill would be needed for those records.
- Foreground group polling is every 10 seconds, with a bounded mutation journal for changes beyond the latest 50 messages. A missed journal window resets loaded history to avoid retaining stale edits/deletions. Up to 500 history messages are loaded in memory; the copy/export action explicitly exports the latest 50 plus older project notes, not an entire unlimited archive.
- Group-message notifications are generic in-app notifications, without message text or native group push. Muting suppresses their creation. No email or AI-provider group processing was added.
- Builder League defaults to genuine eligible public profiles, including name-only profiles and people who have not published activity. The disclosed completeness ordering is not expertise, trust, activity or paid ranking. It is bounded to the first 300 discovery records and live-checks source-profile eligibility. Activity competition remains a separate, explicit opt-in view.
- Public Momentum adds an actual 1080×1080 PNG card with public profile name/photo, actual consecutive UTC build streak, recorded days/points, authoritative checks, yellow/ink branding and linkupbuild.com. Unsupported/oversized avatar images fall back to initials. Public pages, profile calendars, card responses and sitemap eligibility retain explicit activity opt-in plus live public-profile checks. Private update text/links, groups and balances are not included.
- PNG responses and public-profile responses are no-store. Shared/downloaded copies cannot be recalled after opt-out. Image cards are noindex; consented HTML Momentum/profile pages remain indexable. No promise of search-engine indexing or cache-removal timing is made.
- Existing main Linky AI, quota contracts, deterministic two-sentence update reward and removed dedicated Coach stay unchanged. No new model calls.

## Validation

- Node regressions: **201 passed**, including new policy, revision journal, quote refresh, streak, PNG, avatar SSRF/size/dimension safeguards, directory eligibility, consent and tier tests.
- Firestore emulator: **79 passed**. The expanded suite includes owner/co-admin boundaries, co-admin invitation consent, bans, blocks/recovery, inbox preferences, generic notifications, immutable group provenance, message actions, old-history edits/deletions and live card opt-out/hidden/banned checks.
- Mobile TypeScript check passed.
- Real-component browser harness: 390px and 1150px, light/dark, with isolated auth/API/upload adapters. Exercises default builders without activity opt-in, activity consent, period races, profiles, accepted-group inbox navigation, failed-send retry/idempotency, immediate reply quotes, editing/pinning, photo-upload metadata, bio/rules, conversation pinning, invitations, PNG download/copy, denied access and identity changes. No external browser calls or overflow.
- Existing builder workspace, contribution calendar and habit browser suites passed at phone/desktop sizes.
- Production Expo web export and root/subpath proxy browser smoke passed. Web-path contract suite: 12 passed.
- Actual resvg PNG renders visually inspected, including an avatar, dual checks, maximum-width 34-character name and 365-day streak. Function tracing includes renderer, bundled font and the Linux x64 GNU native binding. Optional-platform and existing optional-dependency trace warnings remain; this is not a live Vercel render verification.

## Fixtures

All screenshots and card images in this directory are **synthetic QA fixtures, not production users, activity or verification claims**. `momentum-demo.png` deliberately exercises the CEO-only dual-check branch; `momentum-long-name.png` exercises layout limits. Browser screenshots use API, upload and badge adapters; they do not prove a native device share or a real CDN upload.

## Release boundaries and maintenance

- App metadata is 16.2.0, Android versionCode 25. Native PNG sharing uses expo-sharing/expo-file-system and needs a newly built binary. Older unsupported binaries fall back to public-link sharing when the sharing module is unavailable. Native/device gallery, ImageKit upload and native share-sheet tests have not run. No APK/AAB/store release was produced.
- Existing dependency debt was measured, not silently upgraded: root npm audit reports 9 findings (8 moderate, 1 high); mobile reports 19 (1 low, 4 moderate, 12 high, 2 critical). Every reported vulnerable installed node/version matches the pre-change lockfile; the added renderer/sharing modules did not introduce these reported findings. Some recommended automatic fixes are incompatible major downgrades, so no force fixes were applied. Critical mobile findings include existing shell-quote and websocket-driver dependencies; dedicated maintenance is still needed.
- Expo's dependency check flags pre-existing SDK-57 patch drift in nine packages. The newly added sharing/file-system packages are not in that mismatch list. Do not call dependency health fully clean.
- Generated app privacy policy and repository policy were updated. The separately hosted marketing site's canonical `/privacy` still needs its own publication/synchronization process.
- Changes must be pushed to both `codex/mobile-port` and `main`, leaving `codex/mobile-port` checked out. No token is stored in source, Git remote URLs or credential files. Until an authenticated push and successful CI/live checks, this package is **not deployed**. The previously verified deployment remains `d7494d404b6ef3cd356b4758e0bdf30e4aa639fa`.
