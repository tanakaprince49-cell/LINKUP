# Linky companion upgrade

## Scope

App, Telegram and WhatsApp, using the shared core. The separate marketing repository is unchanged.

### Five additions

1. Saved warm / direct / playful conversation styles.
2. Contextual search refinements and a readable search brief.
3. Profile evidence plus explicit unknowns (`why 1`).
4. Current-shortlist comparison (`compare 1 and 2`).
5. First-chat preparation (`prep 1`).

### Main corrections

- No unrelated, nearest or random profile padding after a no-match or empty pagination.
- Deterministic relevance gates; AI cannot invent matching evidence or override the no-match verdict.
- Source profile visibility, both directions of blocks, quiet-decline mutes and evidence rechecked for saved cards and introduction approval.
- Pending-intro acceptance rejects blocked, deleted, muted or expired introductions.
- Names distinguish identity lookup from collaboration fit; ambiguous names remain selectable after reload.
- Current bot shortlist numbers stay consistent; invalid numbers do not silently target somebody else.
- Public-profile search restricts lead URLs and redirect hosts; cached snippet evidence is reassessed.
- Full squad-slot requirements survive card reload; incomplete squads are not padded.
- Transactional chat appends preserve concurrent turns.
- Pending-introduction follow-ups no longer swallow unrelated emotional chat or clear searches.
- Tone preferences actually pass through the app API and follow the member across channels.
- All conversational commands use the existing 10/month free or 60/day PLUS message ledger. The legacy app external-search action no longer bypasses it.
- Self-reported funding stages are no longer marked as checked proof.

## Validation completed

- **101/101 automated tests pass**, zero skipped, including **36 companion regression tests** exercising the shared core and app/Telegram/WhatsApp adapters with mocked infrastructure.
- TypeScript check passes (`npm run lint`).
- Production web export and postexport routing pass.
- Playwright Chromium browser checks pass for root hosting and both supported subpath proxy mounts, including API transport and marketing cache isolation.
- Android JavaScript/Hermes export passes.
- Git whitespace checks pass.

The browser checks are unauthenticated and use local stubs. Tests do not establish real production bot delivery, AI-provider availability, signed-in production UI, device behavior, payment behavior or a signed native release. The matcher is a conservative English evidence parser, not a complete interpreter of arbitrary requirements; quantitative experience, rate limits and immediate availability are not inferred from skill tags.

## Publication status

The tested implementation commit `b1ddab8` has been pushed to **both `main` and `codex/mobile-port`**. `codex/mobile-port` remains the checked-out branch. Initial publication was blocked by missing authentication; temporary authorized credentials subsequently unblocked the push.

The production workflow is triggered by the `codex/mobile-port` push. Check the latest workflow and live assets before treating a build as deployed. Real signed-in app behavior and linked Telegram/WhatsApp delivery still need authorized production test accounts. Updating installed Android clients requires a separate signed native release; the export here is not an APK/AAB.

Credentials are not part of this commit or report. Temporary push credentials must be removed after deployment checks; this workspace is not a secure long-term credential vault.

See `LINKY_SETUP.md` for current architecture, limits, setup and validation commands.
