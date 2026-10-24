# LINKUP 16.8.0 — Unlimited Linky messages for PLUS

- **Date:** 24 October 2026
- **Source version:** `16.8.0`
- **Android versionCode:** `31`
- **Baseline:** `bb61c890530f6ff2b195f4b5acc7a05b7de41423` (`16.7.0`)
- **Requested branches:** `codex/mobile-port` and `main`, with `codex/mobile-port` retained as HEAD

## 1. Delivered behavior

LINKUP PLUS now has **unlimited Linky conversational messages** across the app,
Telegram, and WhatsApp. This is enforced by the shared server ledger, not merely
by changing marketing copy or replacing 25 with a larger finite number.

| Plan / guard | Current behavior |
| --- | --- |
| Free monthly allowance | 15 messages per UTC calendar month |
| Free daily burst cap | 5 per UTC day by default, inside the same 15/month allowance |
| PLUS member allowance | Unlimited; no daily or monthly exhaustion |
| Shared daily deployment guard | Still rejects free asks at the configured ceiling; PLUS bypasses the rejection |
| Usage accounting | Free and PLUS reservations remain transactional and are counted |
| Failed processing | Existing reservation refund path remains active for member, daily, and shared counters |

PLUS usage still increments the shared daily counter for operational visibility.
It does not stop at that counter. Consequently, PLUS activity can contribute to
the shared count used when deciding whether a later **free** ask has capacity.

## 2. Explicit unlimited API contract

`api/_linkyUsage.js` now returns an unlimited PLUS quota instead of a finite
25/day allowance:

```json
{
  "period": "day",
  "periodKey": "2026-10-24",
  "limit": null,
  "used": 42,
  "remaining": null,
  "resetAt": "",
  "exhausted": false,
  "upgradeRequired": false,
  "unlimited": true,
  "dailyLimit": null,
  "dailyUsed": 42,
  "dailyRemaining": null
}
```

The values above are an example; `used` and the period key reflect real usage.
`null` is intentional. JSON serializes `Infinity` as `null`, while a very large
number would still imply a finite remainder. The explicit `unlimited` flag makes
the contract unambiguous.

- `asksLeft` is `null` for PLUS and remains numeric for free accounts.
- `home.limits.asksPerDay` and the other PLUS allowance aliases are `null`.
- Daily buckets remain as accounting records, not an allowance.
- Legacy PLUS daily use is preserved during migration.
- Upgrading does not erase free usage; downgrading immediately restores the
  existing free monthly limit and any already-exhausted state.
- Clear chat and Forget still do not reset usage records.

### Native compatibility

Older native binaries can coerce the new null `remaining` value to zero and show
**“0 messages left”** even though the deployed server no longer stops PLUS at
the retired cap. They can continue sending. Version 16.8.0 is required for the
correct **“Unlimited messages · PLUS”** label and nullable TypeScript contract.

## 3. Retired configuration

`LINKY_PLUS_DAILY` is retired and deliberately ignored. Leaving an old value in
Vercel cannot silently recreate a PLUS cap. It can be removed during routine
environment cleanup, but removal is not required for this code to take effect.

The remaining budget controls retain their existing roles:

- `LINKY_FREE_DAILY` changes the free burst cap.
- `LINKY_GLOBAL_DAILY_MESSAGES` controls the free shared-cap rejection.
- `LINKY_MODEL_RPD` and `LINKY_CALLS_PER_MESSAGE` feed budget arithmetic; they
  are not provider request-enforcement mechanisms.

`node scripts/linky-budget.mjs` now reports **PLUS messages: unlimited** and no
longer suggests the retired environment variable.

## 4. Product surfaces aligned

- Linky home header: **Unlimited messages · PLUS**.
- PLUS paywall perks and Linky cards paywall: unlimited Linky messages.
- Linky audit screen: unlimited PLUS messages and Meets; free copy now states
  15/month and 5/day.
- Telegram/WhatsApp audit: reports actual daily PLUS usage with “unlimited on
  PLUS” rather than formatting “used N of null.”
- Linky limit explanation and AI wording instructions describe the current
  free allowance and unlimited PLUS entitlement.
- Current setup guide, allowance guide, release notes, budget documentation,
  and Google Play source copy are aligned. Older numbered release documents
  remain historical records.

## 5. Regression coverage

### Unit and contract tests

`tests/linky-usage.test.mjs` now covers:

- legacy PLUS usage beyond the retired 25/day allowance;
- 40 concurrent PLUS reservations with `LINKY_PLUS_DAILY=1` and a shared cap of 2;
- continued free shared-cap rejection without spending free allowance;
- upgrade/downgrade preservation of exhausted free monthly use;
- 30 real cross-channel asks through the actual ask wrapper;
- PLUS home/legacy aliases and null `asksLeft`;
- failed-processing refund of PLUS member and global accounting;
- nullable client fallback behavior and the Unlimited header;
- all existing free monthly, daily, concurrency, refund, and paywall behavior.

`tests/retention-calendar-card.test.mjs` verifies the unlimited budget defaults
and that the retired environment variable cannot restore a cap.

### Real Firestore transactions

`tests/firestore-profile/linky-unlimited.test.cjs` runs against the Firestore
Emulator with Admin SDK transactions. It verifies:

- 40 real concurrent PLUS transactions beyond both configured caps;
- exact member, daily, and global counts after transaction retries;
- free capacity rejection at the same shared counter;
- a real PLUS refund restoring member, daily, and global counters to zero;
- no client access to the server-only usage ledger is introduced.

### Isolated browser check

`mobile/scripts/smoke-linky-fullscreen.mjs` includes a PLUS fixture with 42 used
messages and null remaining quota. It sends another message and verifies that
the header remains **Unlimited messages · PLUS**. The harness was also updated
for the current header subtitle and its Expo Clipboard mock.

## 6. Verification results

All checks below ran locally against this source tree:

| Check | Result |
| --- | --- |
| Focused allowance, budget, and copy tests | **35/35 passed** |
| Full unit + generated web-mount suite, before export | **260/260 passed** |
| Firestore Emulator suite | **91/91 passed** |
| Mobile TypeScript (`mobile@16.8.0`) | **Passed** |
| Functions TypeScript build | **Passed** |
| Expo web production export and post-export processing | **Passed** |
| Full unit + generated web-mount suite, after export | **260/260 passed** |
| Isolated Chromium Linky fixtures, including PLUS send | **Passed** |
| Live public routing/payment-guard checks | **Passed** |
| `git diff --check` | **Passed** |

The exported web bundle contains the Unlimited label and does not contain the
old 60-message PLUS marketing strings.

## 7. Deployment and operational boundaries

- A repository push is not, by itself, proof that the new server deployment has
  completed. Check the production workflow and deployed build identifier.
- The live routing check ran before this release was pushed and still observed
  the prior production build ID. It verifies routing, not adoption of 16.8.0.
- No physical Android device test, signed APK/AAB, Play submission, or Play
  approval is claimed. A new native binary is needed for the corrected label.
- The Google Play files are prepared source copy, not proof that the public
  listing was updated.
- Tests use mocks, an in-memory transactional adapter, the Firestore Emulator,
  and isolated browser fixtures. They do not spend production model credits or
  send messages to real members.
- Unlimited is the product entitlement, not a guarantee that an external model
  provider will never be unavailable. Unlimited PLUS removes the member-level
  cost brake, so provider billing, quotas, monitoring, and abuse response remain
  operational requirements.
