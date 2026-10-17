# Full-screen Linky and exclusive gold verification

## Requested identity

- Account: `FvxIfciyHMfQZbLwziZpseMNKxC3` (the profile link confirmed by the user).
- Name: Tanaka Gaadzikwa.
- Two checks together: existing blue plus a gold check.
- Exact profile label below the existing high-signal notice: **GOLD member CEO**.

`shared/member-badges.js` is the single UID allowlist. The entitlement is not derived from a display name, email, PLUS plan, paid verification, `isCEO`, `isGold`, or other editable flags. No database flag, subscription privilege, admin permission, or profile-visibility bypass is introduced. A copied name cannot acquire gold status. The UID is a public identity, not a credential.

`MemberBadges.tsx` applies the pair to member-name surfaces: profiles, discovery, search, recommendations, active opportunities, messages/chat headers, matches, feed authors/comments/replies, idea owners, leagues, viewers, Linky cards/intros, alerts, campaign owners and game challenges. Public profile pages and the builder directory use the same UID decision. Blue verification for other members is preserved; generic PLUS decoration now uses a trophy rather than duplicating a member's verification checks.

## Full-screen conversation

- Linky's tab hides its bottom navigation and generic app header.
- A compact, safe-area-aware header provides Back to network, Preferences & bots, What Linky knows, and Activity.
- The conversation fills the remaining screen instead of sitting inside a dashboard card.
- The composer stays pinned to the bottom, with measured clearance and no obsolete tab-bar offset on Android.
- Introduction requests, pending drafts, follow-ups, clear-chat and tone/search tools remain accessible in the Activity panel rather than occupying the message area.
- All retained server thread turns are rendered (up to the server's existing 24-turn cap); restored chat opens at the latest turn. Empty-state suggestions do not reappear underneath restored chat history.
- The 10/month free and 60/day PLUS quotas, exhaustion paywall, privacy gates and introduction approval behavior are unchanged.

## Validation

- **109/109 automated tests pass**, zero skipped, including 8 new identity/full-screen tests.
- TypeScript passes.
- Production web export passes.
- Android JavaScript/Hermes export passes; this is **not a signed APK/AAB or native store release**.
- Browser mount checks pass for the root host and both supported proxy subpaths.
- Isolated mobile-width browser fixture passes for the actual Linky screen and badge components: pinned composer, message send, activity panel, two owner checks, Back navigation and restored-history scrolling.

QA screenshots under `docs/qa/`: `linky-fullscreen-390.png`, `linky-fullscreen-history-390.png`, `exclusive-gold-badge-390.png`. These are **isolated test fixtures**, with mocked auth/API/navigation hooks/header icons; they do not represent production-account writes or prove real signed-in/keyboard/device behavior. Real native keyboard behavior still requires device verification.

Optional browser fixture reproduction (test tooling only):

```bash
npm install --no-save --package-lock=false esbuild playwright
npx playwright install --with-deps chromium
node mobile/scripts/smoke-linky-fullscreen.mjs
```

The production workflow now runs `npm run test:identity` before promotion and retries strict post-promotion routing/SHA checks for a bounded edge-cache propagation window. It does not weaken those checks.

## Publication boundaries

Publish the same commit to both `codex/mobile-port` and `main`, leaving `codex/mobile-port` checked out. Verify the workflow and live assets after promotion. New web UI becomes available after deployment/cache refresh. Installed native apps require a new native release to display the new client-side layout and badges; the export alone does not update installed apps.
