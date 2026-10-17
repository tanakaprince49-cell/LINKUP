# Profile-save permission failure — 17 October 2026

## Confirmed cause

The client message suggesting that the rules needed deployment was not a diagnosis. The last rules workflows had already succeeded on 16 October. Reproducing an authenticated owner save against the actual rules in the Firestore Emulator returned `PERMISSION_DENIED` with **maximum of 1,000 expressions reached**, including a simple bio change with identity metadata and the normal core profile payload.

## Fix

- Reduced rules evaluation overhead for profile updates: shared change metadata; compact bounded string checks; no repeated checks for already-protected entitlement/verification fields; more efficient settings and reputation validation.
- Normal, verified PLUS and legacy accounts can save the existing **two-section** profile payload within the rule budget. Keep the bounded core and optional-section writes; combining every profile field into one large mutation can still exceed Firestore's rule-expression limit.
- Kept owner-only edits, paid/admin authority guards, existing verification policy, Turbo Connect entitlement restrictions, type/size/range limits and default-denied server collections. Changing a stored profile UID to another account is now explicitly rejected.
- Do not silently swallow an optional-section rejection. The client waits for both writes before applying all fields locally or closing the editor. If only the first succeeds, the editor stays open and the message explicitly reports a partial save. The two writes are not one atomic transaction.
- Removed the misleading user-facing instruction to deploy rules for every permission-denied response.
- Added actual Firestore Emulator acceptance/security tests before rules deployment, plus client save-flow tests before web promotion.

## Validation

- **11/11 real-emulator regressions:** normal core and optional saves for free/verified PLUS/legacy profiles, preserved server flags, simple legacy bio edits, owner/anonymous/UID protection, paid/admin/verification escalation rejection, Turbo Connect enforcement, type/size/range/map validation, Unicode/newline string bounds, protected ledger access, and normal profile creation.
- **131/131 standard automated regressions**, zero skipped after web export, including four client save-flow tests.
- TypeScript, production web export and Android Hermes JavaScript export passed. An export is not a signed APK/AAB.

Reproduce emulator checks (isolated demo project; never production):

```bash
npm --prefix tests/firestore-profile ci
npm run test:firestore
```

This uses Firebase CLI 13, the committed emulator configuration and an isolated test SDK lockfile. Java 11+ is needed locally; the deployment workflow explicitly installs Java 17. The rules workflow uses the existing CI service-account secret for deployment only after the emulator checks pass; no permissive fallback rules are introduced.

## Rollout boundary

Push the same commit to both release branches and verify **Firestore rules deploy** as well as **Deploy Expo Web to Vercel Production**. A web deployment alone does not update Firestore rules. Rules apply to installed clients immediately after publication; improved client-side error handling requires refreshed web code or a rebuilt native app. No production account profile is modified by these tests, and an actual signed-in save still needs user confirmation.
