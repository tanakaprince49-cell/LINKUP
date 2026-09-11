# LINKUP — Whole-Codebase Bug & Security Audit
**Date:** 2026-09-11 · **Scope:** `api/` (16 files), `functions/src/` (3 files), `mobile/src/` (112 files), `firestore.rules`

Method: full read of the API layer and Cloud Functions, targeted pattern scans over the mobile app (38k lines), and a rules review. Static checks first: every `api/*.js` passes `node --check`, `mobile` passes `tsc --noEmit`, the web + Android exports build, and no leaked secrets (PAT/private keys) are committed.

---

## 🔴 CRITICAL — 1. Any user can grant themselves PLUS, verification, and admin (Firestore rules)

**File:** `firestore.rules`

The `users/{userId}` block wires the *wrong* validator:

```js
// firestore.rules:523-525
allow create: if isOwner(userId) && validOwnProfileWrite(incoming());
allow update: if isOwner(userId) && validOwnProfileWrite(incoming());
```

`validOwnProfileWrite` (line 292) only checks `uid` matches and `displayName` is a sane string. **That is the entire gate.** Every *real* validator in the file is defined but never referenced by any `allow` statement:

- `safeProfileUpdateKeys()` (line 304)
- `verificationFieldsSafe()` (line 322)
- `validProUnlockData()` / `safeProUnlockCreateKeys()` / `safeProUnlockUpdateKeys()` (lines ~331–380)
- `validProCancelData()` / `safeProCancelUpdateKeys()` (~391–443)
- `validProfileUpdateShape()` (~443)

They are dead code — presumably left behind when the `allow` lines were simplified.

**Impact — a signed-in user can write arbitrary fields to their own `users/{uid}` doc via the client SDK (or the REST API):**

| Field they can set | What it unlocks |
|---|---|
| `isPro: true`, `plan: 'plus'`, `subscriptionStatus: 'active'`, `turboConnect: true`, `entitlements: { pro: true }` | **Free PLUS.** `api/_linky.js` `isPlusUser()` (line 299) reads these fields first (`plusFromUserDoc`) — 60 Linky searches/day, Turbo Connect, PLUS visibility boost, no free-limit counters. Full paywall bypass. |
| `isVerified: true`, `verificationProgram: 'LINKUP PLUS'` | **Self-verified blue check** shown to everyone. |
| `role: 'admin'` or `isAdmin: true` | **Self-admin.** `functions/src/index.ts` `assertAdmin()` reads `users/{uid}.role === 'admin'`; `functions/src/campaignExpiry.ts` `isAdminUid()` reads `isAdmin === true`. Unlocks `adminAction` (ban, unban, deleteUserData, setRole, stats). |

**Same hole in the discovery index** (`firestore.rules:621`): `publicProfiles/{userId}` allows the owner to write `isPro`, `isVerified`, `verificationProgram`, `turboConnect`, `plan` with only *type* checks and no value restrictions — so the fake crown/check is visible in Discover, Search, and profile views for everyone else.

**Why it isn't caught:** the web billing path is correctly server-verified (Payonify webhook + `webSubscriptions` `allow write: if false`). The Android IAP path is the exception — Google Play subscription state is written by the client (see `buildLocalProEntitlement()` in `mobile/src/lib/paywall.ts:127`), and that client authority is what the loose rule is trying to accommodate. There is no server-side receipt verification for mobile (no Play RTDN wired).

**Recommended fix (needs a decision — do not do blind):**
1. Point `allow update` at `validProfileUpdateShape() && safeProfileUpdateKeys() && verificationFieldsSafe()` so ordinary profile edits work but `isVerified` can only be set `false`/cleared, and `isPro`/`plan`/`subscription*`/`turboConnect`/`entitlements` are NOT owner-writable.
2. Move PLUS/verification grants fully server-side: a Cloud Function/callable that verifies the Play receipt (or the existing web entitlement) and writes the flags with the Admin SDK — mirroring what `api/_entitlements.js` already does for web. Wire `validProUnlockData()` style rules only under that server identity, or keep `users` field-locked and let Admin SDK bypass.
3. Do the same for `publicProfiles` (drop `isPro`/`isVerified`/`turboConnect` from owner-writable keys; the server syncs them).

---

## 🟠 HIGH — 2. Unauthenticated AI endpoints (quota theft)

**Files:** `api/aiAssist.js`, `api/rankCandidates.js`

Both accept unauthenticated POSTs and immediately spend Gemini/Zen tokens. The web client calls them **by default** and sends no auth header (`mobile/src/lib/ai.ts:131`, `mobile/src/lib/matchmaking.ts`). Anyone who finds the URL can burn the AI budget with a curl loop.

Fix: verify the Firebase ID token (`verifyRequestUser`) like every other authenticated endpoint, and/or add per-uid rate limiting. The Cloud Function equivalents (`functions/src/index.ts` `aiAssist` / `rankCandidates`) already do the auth check.

## 🟠 HIGH — 3. Unauthenticated ImageKit upload signer (storage abuse)

**File:** `api/imagekitAuth.js`

Returns upload signatures to anyone — no auth. An attacker can upload arbitrary images to your ImageKit account (storage/quota cost, or abuse your media origin). The file's own comment says "Hardening path (later): verify a Firebase ID token here before signing." `later` is now.

---

## 🟡 MEDIUM — 4. Payonify sandbox flag has no effect

**File:** `api/_payonify.js:14-15`

```js
const SANDBOX_BASE = 'https://api.payonify.com';
const LIVE_BASE    = 'https://api.payonify.com';
```

`PAYONIFY_ENV=sandbox` and `live` select the same URL, so "sandbox" is not actually sandboxed unless `PAYONIFY_BASE_URL` is set. If a sandbox key is ever used for test purchases, it hits the live API. Confirm this matches Payonify's model or split the URLs.

## 🟡 MEDIUM — 5. Campaign sweep silently skips campaigns past 300

**File:** `functions/src/campaignExpiry.ts:285`

`endLapsedCampaigns` uses `.where('status','==','active').limit(300)` with no pagination and no ordering. If there are ever >300 active campaigns, the same first 300 are re-scanned every 6h and the rest never expire.

## 🟡 MEDIUM — 6. Webhook receiver has no auth if the secret env is unset

**File:** `functions/src/index.ts` `webhookReceive`

```js
if (expectedSecret && secret !== expectedSecret) { ... 401 }
```

When `WEBHOOK_SECRET` is not configured, the check is skipped entirely — anyone can POST and write to `webhookLogs`/`waitlist`. Fail closed instead (or make the secret required).

---

## 🟢 LOW — polish / robustness

7. **`searchUsers` filter precedence** (`functions/src/index.ts:896`): `else if` between `skillFilter` and `industryFilter` means both can't be applied together — industry is ignored when skills are present.
8. **`botReply` card-number regex** (`api/linky.js`): `\b(\d{1,2})\b` doesn't match 3-digit numbers, so `meet 100` falls back to card 1 (there are at most 5 cards, so this is theoretical).
9. **`rankCandidates.js` meta label** (`api/rankCandidates.js`): a cache hit is reported as `source: 'vercel-gemini'` instead of `'cache'` (cosmetic only).
10. **`google-services.json` committed** (`mobile/google-services.json`): the same values are already public in the web config, so severity is low — but conventional practice is to exclude it from git.
11. **`compactProfile` roleSignals** (`api/_gemini.js:104`): `roleSignals` can become an array when `roleAnswers` is an array — harmless today, but fragile typing.

---

## ✅ Verified clean (checked, no issue found)

- Billing chain (`payonifyCheckout` → `payonifyStatus` → `payonifyWebhook` → `_entitlements`): idempotent grants, signature-verified webhooks, timing-safe compares, amount/currency guards, 4xx never retried. Strong.
- Linky core (`_linky.js` ask/pointers/outreach, `_serpapi.js` budget ledger, `_proof.js`): no loose equality, no unguarded `JSON.parse`, no unchecked `.data()`; LinkedIn search correctly budgeted and cacheable.
- Firebase Auth/entitlements client flow, `plusRepair`, `discoveryProfiles` server-stamp preservation: correct and mutually consistent.
- `webSubscriptions` is `allow write: if false` (server-only) — the web paywall is not bypassable via rules.
- No loose `==` bugs, no `parseInt` without radix, all AsyncStorage `JSON.parse` calls are wrapped in try/catch.

---

## ✅ Fixes applied this round

**1. Critical — client self-grant of PLUS/verification/admin (firestore.rules)**
- `users/{userId}` now wires the real validators. `allow create` requires the key whitelist + no entitlement/verification/turbo fields; `allow update` requires `validProfileUpdateShape() && safeProfileUpdateKeys() && verificationSafe() && paidEscalationSafe() && turboConnectSafe()`, OR the self-service cancel shape (`validProCancelData`), OR the legacy push-token cleanup. `role`/`isAdmin`/`banned`/`isPro`/`plan`/`subscription*`/`entitlements`/`billingProvider`/… are client-forbidden; the server (Admin SDK) is the only writer.
- `publicProfiles/{userId}` create/update may no longer carry `isPro/isVerified/verificationProgram/plan/subscriptionPlan/subscriptionStatus/turboConnect`.
- Turbo Connect may only be set `false` by a client (or `true` when the account is already server-stamped PLUS). The only client-writable verification is the SHIPPED ship-badge (`verificationProgram=='SHIPPED' && verifiedBy=='SHIP LOG'`), preserving the gamification feature.

**Server grant path (new): `api/claimPlus.js` + `_entitlements.js`**
- `claim` — verifies the Google Play purchase with the Play Developer API (service-account JWT → androidpublisher subscriptionsv2), then `grantPlayPlus` stamps the PLUS identity on `users/{uid}` + `publicProfiles/{uid}`. Fails closed (503) until `PLAY_SERVICE_ACCOUNT_CLIENT_EMAIL` / `PLAY_SERVICE_ACCOUNT_PRIVATE_KEY` / `PLAY_PACKAGE_NAME` are set.
- `revoke` — self-service cancel/lapse: `revokePlusIdentity` demotes both docs.
- `turbo` — `setTurboConnect` (on requires an active PLUS term).

**Client rewiring (mobile)**
- `PaywallModal.unlockPurchasedPlan` now calls `claimPlayPlus` instead of writing PLUS flags via `setDoc`.
- `AuthContext` verification-sync now calls `repairPlusIdentity` (server) instead of client-stamping.
- `ProfileScreen.performCancelProPlan` now calls `revokePlayPlus` (server) so `publicProfiles` is demoted too.
- `discoveryProfiles` no longer writes paid/verification/turbo fields to `publicProfiles`.
- Web AI (`ai.ts`, `gemini.ts`, `matchmaking.ts`) and `imagekitUpload.ts` now send the Firebase ID token.

**2. Unauthenticated endpoints — fixed:** `api/aiAssist.js`, `api/rankCandidates.js`, `api/imagekitAuth.js` now verify the Firebase ID token (`verifyRequestUser`) before spending tokens/minting signatures.

**3. Misc fixes:**
- `functions/src/campaignExpiry.ts` — `toMillis` parses ISO strings; `isAdminUid` accepts both `isAdmin` and `role:admin`; `endLapsedCampaigns` pages through ALL active campaigns (orderBy `__name__`, batch commits every 400 writes).
- `functions/src/index.ts` — `assertAdmin` accepts both admin markers + founder email; `searchUsers` applies skills+industry together (industry filtered in memory after the single `array-contains-any`); `webhookReceive` fails closed when `WEBHOOK_SECRET` is unset.
- `api/_payonify.js` — added `PAYONIFY_SANDBOX_BASE_URL` override (Payonify serves test/live keys from one host; no separate sandbox host exists).

## Deploy / follow-up needed (founder action)
1. **Vercel env** (to activate server-side Play verification): `PLAY_SERVICE_ACCOUNT_CLIENT_EMAIL`, `PLAY_SERVICE_ACCOUNT_PRIVATE_KEY`, `PLAY_PACKAGE_NAME` (default `com.tana.linkup`). Until set, Android buyers get local-only PLUS (device entitlement + retry on later launches) and a 503 from `/api/claimPlus`.
2. Redeploy `firestore.rules` (the existing CI re-touch flow does this on deploy).
3. `functions/` is not deployed (no Blaze plan) — its fixes apply when it ships.
