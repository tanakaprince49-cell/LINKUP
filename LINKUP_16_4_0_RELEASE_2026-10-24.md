# LINKUP 16.4.0 — League champion reward + Linky message budget

Released 24 October 2026 · `codex/mobile-port` = `main` = `a81f9a5bbe64647e54cf587473687980a89aab76`
(tag-worthy commit `b27f36f` carries the feature; `a81f9a5` adds the privacy wording.)

## 1. The weekly prize, exactly as asked

| Requirement | How it is enforced |
|---|---|
| Winner runs **one** campaign | `claimCampaignReward` creates exactly one `campaigns` doc from a single-use reward doc; the reward flips to `claimed` inside the same transaction, so a second claim is rejected with 409. |
| For **exactly one week** | Approval stamps `expiresAt = now + 7 days`, `expiresAtSource: 'league-reward'`. The normal 30-day window and the approval-time refresh are bypassed for reward campaigns. |
| Unlocked on the campaign page, claimed there | `renderReward()` renders **above** the `hasCampaignsPlan` paywall gate — a champion without a paid plan still sees and claims it. Same card on the campaigns page and a banner on the create screen. |
| Then **locks and is deleted forever** | Hourly `builderCron` runs `reconcileCampaignRewards`, which deletes the campaign with the Admin SDK (clients cannot delete campaigns at all), archives impressions/clicks/week/account to `campaignRewardsAudit`, and marks the reward `completed`. Nothing can be re-issued, extended or moved. |
| No winner if nobody worked | `chooseChampion` drops zero-point rows; the week is written `no-winner` and never retried. |
| Claim window | 7 days from the close of the winning week, then `expired` (410 on a late claim). Unapproved claims die at `activationDeadline`. |
| Can't be self-service | The reward never touches `campaignAccounts.status` (owner-writable) and `campaigns` keeps `allow delete: if false`. |

Award target: the **last completed** Monday-00:00-UTC week. On 24 Oct 2026 that is the week of **2026-10-12**. Ties break on points → build days → helpful credit → uid, so the winner is deterministic and re-running the cron cannot flip it.

Client surface: `mobile/src/lib/campaignReward.ts` + `CampaignsScreen.tsx` (`fetch`, headline, countdown, claim) + `CreateCampaignScreen.tsx` (`rewardWeek` route param → reward mode, no new campaign slot).

## 2. How many Linky messages a day the free tier really buys

Assumptions taken from the shipped code and the current Gemini free tier (`gemini-2.5-flash-lite`):
500 requests/day per project (Google no longer publishes the table; AI Studio shows it per project, reset at midnight Pacific), 2.1 model calls per delivered message, 20% headroom.

```
500 RPD × 0.80 headroom ÷ 2.1 calls = 190 delivered messages/day
```

That is the honest ceiling for the whole product, not per person. On 500 members:

- 190 ÷ 500 = **well under one message per member per day**. If every member used their 15 free messages a month (500 × 15 = 7,500 ≈ 250/day) the model quota would be exhausted before lunch. So the ceiling, not the allowance, is what protects the quota.
- A 25%-daily-active community of 500 gets ~**1 message per active member per day**; 100 active members get 7 each.
- Because the ceiling is generous relative to realistic use, a refused message **must not** consume anyone's allowance.

Shipped behaviour: `api/_linkyUsage.js` keeps the per-member monthly (free 15) and daily (PLUS 60) buckets plus a `_global` bucket, and refuses at the shared ceiling with HTTP 503 `{code: 'capacity', retryAt}`. That is a deployment limit, not an upsell, so it is never `402 ask_limit`, and any refund decrements all three buckets or the ceiling would drift downward permanently.

Tune without a deploy — `node scripts/linky-budget.mjs` prints the table:

```
LINKY_MODEL_RPD=500        LINKY_CALLS_PER_MESSAGE=2.1
LINKY_GLOBAL_DAILY_MESSAGES=200   (0 disables the ceiling)
LINKY_FREE_DAILY=0         LINKY_PLUS_DAILY=60
```

**Recommended for launch (until billing is on):** `LINKY_FREE_DAILY=3`, `LINKY_PLUS_DAILY=20`. A free member then cannot take the whole day's capacity in one sitting, and the 15/month promise still holds because 3/day × 30 > 15.

Billed cost if a paid key is switched on: 1k messages ≈ $0.40–1.30, 7.5k (500 members × 15) ≈ $3–9, 30k ≈ $11–35 per month.

## 3. Verification

- `node --test tests/*.test.mjs` → **224/224** (8 new reward tests, 17 Linky usage tests, regenerated copy contracts).
- `npm run test:firestore` (emulator) → **86/86**, including claim replay 409, expired claim 410, reconcile delete + audit, and the no-index reward read.
- `npm --prefix mobile run typecheck` → clean.
- `build:web` + `test:web-browser` → all three proxy root modes pass.
- `activity-league-browser.cjs` (1150px light/dark) and `builder-browser.cjs` (390/1150px) → pass.
- `verify:web-routing` with `EXPECTED_APP_SHA=b27f36f…` → **23/23**.
- Live: build marker `a81f9a5` served from `linkupbuild.com/app`; `campaignReward` and `campaignRewardClaim` return 401 anonymously; the reward paragraph is in the served privacy policy.
- CI: run `40077427660` / `40077427613` (Firestore rules, both branches) and `40077427611` (Vercel prod) all success; privacy-only commit `40077874929` success.

## 4. Still open

- `awardWeeklyChampion` (the cron grant itself) has never run against the emulator end to end — only its read/claim/reconcile halves are covered. A no-winner week plus an idempotent re-run is the missing test.
- No native APK/AAB, no authenticated production AI or payment flow, no Search Console indexing guarantee.
- Reward card has no real-device screenshot; browser mounts only.
