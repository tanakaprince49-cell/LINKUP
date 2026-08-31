# Google Play Console — LINKUP pricing & 7-day trial setup

Step-by-step, in the order you should click it. Everything here assumes
`com.tana.linkup` (LINKUP, EAS project `62db6e6e-e4be-44ff-a0c1-9437f43ba980`),
Android-first billing, and build **13.3.0 (versionCode 16)** — the build that
contains the trial code.

**Total time: ~45 min of clicking + up to 24 h of Play propagation.**

---

## What we are building

| Product ID | Name shown to user | Base plan | Price (USD) | Trial |
|---|---|---|---|---|
| `linkup_plus_monthly` | LINKUP PLUS Monthly | `plusmonthly` (auto-renew, **1 month**) | **$19.99** | 7 days |
| `linkup_plus_yearly_2` | LINKUP PLUS Yearly | `plusyearly2` (auto-renew, **1 year**) | **$149.99** | 7 days |
| `linkup_campaigns_monthly_2` | LINKUP Campaigns Monthly | `campaignsmonthly2` (auto-renew, **1 month**) | **$29.99** | 7 days |
| `linkup_campaigns_yearly_2` | LINKUP Campaigns Yearly | `campaignsyearly2` (auto-renew, **1 year**) | **$249.99** | 7 days |

> ### ⚠️ ID rules — read before you type anything
>
> Play enforces **different** character sets on the three kinds of ID, and
> the error you get back is the one for the field you are in:
>
> | Field | Allowed characters | Hyphens? |
> |---|---|---|
> | **Product ID** (the subscription itself) | start with a number or lowercase letter; then `a-z`, `0-9`, `_`, `.` (max 40) | **NO** — this is the field that rejects hyphens |
> | **Base plan ID** | start with a number or lowercase letter; then `a-z`, `0-9`, `-` | yes, allowed |
> | **Offer ID** | start with a number or lowercase letter; then `a-z`, `0-9`, `-` | yes, allowed |
>
> Product IDs are also **permanent** — they cannot be changed or reused once
> created, and they are the strings hardcoded in
> `mobile/src/lib/paywall.ts` (`LINKUP_PLUS_PRODUCT_ID`,
> `LINKUP_PLUS_YEARLY_PRODUCT_ID`) and `mobile/src/lib/campaigns.ts`
> (`LINKUP_CAMPAIGNS_PRODUCT_ID`, `LINKUP_CAMPAIGNS_YEARLY_PRODUCT_ID`).
>
> To dodge this entirely, every **base plan** and **offer** ID below is plain
> lowercase letters and numbers — the only character set Play accepts in all
> three fields. **Product IDs** are dictated by the app code and use
> underscores, which is legal for that field.

Two rules that shape the whole thing:

- **The product ID is permanent.** Type them exactly — lowercase,
  underscores, no hyphens. You cannot rename them later.
- **A free trial is an *offer* attached to a base plan**, not a field on the
  subscription. The base plan carries the real price; the offer carries the
  7 free days.
- **A base plan's billing period is immutable.** It cannot be edited after
  creation — if a yearly plan was created with a 1-month period, you must
  create a new base plan and deactivate the wrong one (see the warning under the base plan table in Part 2).

---

## Part 0 — Prerequisites (do these once)

1. **Play Console account** in good standing, with the app created
   (`com.tana.linkup`) — Play Console → **All apps** → LINKUP.
2. **Complete the app setup checklist.** Play hides monetisation until it's
   done: left menu → **Dashboard** → *"Set up your app"* → clear every item
   (App access, Ads, Content ratings, Target audience, News app, Data safety,
   **App category & contact details**, Store settings).
3. **Merchant account.** Play Console → **Settings → Payments profile**. If
   you see "Set up a payments profile", finish it — without it you cannot
   create products.
4. **Upload build 13.3.0 to a track.** Play will not serve subscription
   products to a build that doesn't exist on a track.
   ```
   cd mobile
   eas build --profile production --platform android   # or your release profile
   ```
   Then **Testing → Closed testing** → create/choose a track → **Create new
   release** → upload the `.aab`. Even a closed-testing upload is enough to
   start selling.
5. **Add license testers.** Play Console → **Settings → License testing** →
   add the Gmail addresses you'll test with, set *License response* to
   **RESPOND_NORMALLY**. License testers can buy without being charged — that
   is how you'll verify the trial end-to-end for free.

---

## Part 1 — Create the four subscriptions

Play Console → left menu → **Monetize with Play → Products → Subscriptions**
→ **Create subscription**.

Fill in, for **each** of the four rows in the table above:

1. **Product ID** — e.g. `linkup_plus_monthly`. ⚠️ Permanent, can't be changed
   or reused once activated.

> **ID character rules — these are different per field, and Play rejects them
> without explaining why.**
>
> | Field | Allowed characters | Rejected |
> |---|---|---|
> | Product ID (the subscription) | lowercase `a-z`, `0-9`, underscores `_`, periods `.` | **hyphens `-`**, uppercase, spaces |
> | Base plan ID | lowercase `a-z`, `0-9`, **hyphens `-`** | underscores, uppercase |
> | Offer ID | lowercase `a-z`, `0-9`, **hyphens `-`** | underscores, uppercase |
>
> All three must start with a lowercase letter or a number, and are immutable
> once activated. If a field still refuses your ID, strip it to plain lowercase
> letters and numbers — `plusyearly12m` is valid in every field.
2. **Name** — how users see it in emails and the subscription centre:
   - `LINKUP PLUS Monthly`
   - `LINKUP PLUS Yearly`
   - `LINKUP Campaigns Monthly`
   - `LINKUP Campaigns Yearly`
3. **Benefits** — 1–3 short lines. 🚫 **Play policy: benefits must NOT mention
   the free trial or the price.** "Try 7 days free" or "$19.99/mo" here will
   get the subscription rejected. Write capability, not commerce:
   - PLUS: *Unlimited discovery swipes and rewinds* / *See who viewed your
     profile* / *Advanced search, AI ranking and verified badge*
   - Campaigns: *Sponsored placements across Idea Deck, Discover, Search, Hub
     and Linky* / *3 live campaigns with live impressions and CTR* /
     *Priority human review*
4. **Description** — internal only, never shown to users. Put the price here
   for your own sanity.
5. **Tags** (optional) — leave default.
6. Click **Create**.

> Repeat all six steps four times. Do not reuse a product ID.

---

## Part 2 — Add the base plan (the real price)

Click the **→ arrow** on the subscription you just created → **Add base plan**.

| Field | PLUS monthly | PLUS yearly | Campaigns monthly | Campaigns yearly |
|---|---|---|---|---|
| **Base plan ID** | `plusmonthly` | `plusyearly` | `campaignsmonthly` | `campaignsyearly` |
| **Renewal type** | Auto-renewing | Auto-renewing | Auto-renewing | Auto-renewing |
| **Billing period** ⚠️ | 1 month | **1 year** | 1 month | **1 year** |
| **Price** | $19.99 | $149.99 | $29.99 | $249.99 |

⚠️ **Billing period is the field that silently costs you money.** It is
immutable once the base plan exists, and Play never questions a "$149.99
monthly plan" — it just charges it, every month. Open each base plan after
saving and confirm the summary reads `Auto-renewing · Yearly` for the two
yearly rows.

Then:

1. **Set price** — click **Update prices** → select the regions → enter the
   amount in USD → **Update**. Play converts to local currency per region; you
   can override individual regions later (**Manage prices**).
   - Local pricing tip: Play auto-converts. For your key markets (ZW/ZA/KE/NG,
     IN, UK, EU) open **Manage prices** and round to a psychological local
     number, e.g. ZAR 349.99 instead of the raw 366.42 conversion.
2. **Grace period** — set **7 days**. This is free insurance: if a renewal
   payment fails, Play retries for 7 days while the user keeps PLUS, instead of
   silently downgrading them and losing the subscription.
3. **Optional: regional availability.** If you only want to sell in a subset,
   untick regions here. Default = all regions the app is distributed in.
4. Click **Save**, then **Activate**.
5. **Backwards compatibility (do it).** In **Base plans and offers**, click the
   ⋮ next to the base plan → **Use for deprecated billing methods**. Anything
   running an older Billing Library (and Play's older server APIs) then still
   gets the right price instead of an error.

---

## Part 2.5 — If a yearly base plan was created with a 1-month period

Symptom: the yearly plan charges the **yearly** price **every month**
($149.99/mo instead of $149.99/yr).

`billingPeriodDuration` is immutable — it cannot be edited. Create a
replacement instead:

1. **Add base plan** on the same subscription:
   - PLUS → `plusyearly12m` · Auto-renewing · **Yearly** · $149.99 · grace 7 days
   - Campaigns → `campaignsyearly12m` · Auto-renewing · **Yearly** · $249.99 · grace 7 days
   - **Save → Activate**, then ⋮ → *Use for deprecated billing methods*.
2. **Add offer** on the **new** base plan: `plusyearly12mtrial7` /
   `campaignsyearly12mtrial7` · free trial · **7 days** → Save → **Activate**.
3. **Deactivate** the old base plan *and* its old offer (top right → Deactivate).
   Deactivating stops NEW purchases only.
4. **Refund + cancel** anyone already on the broken plan — they keep being
   charged monthly until you do.
5. **No app change, no rebuild.** The app buys the **product ID** and picks
   whichever offer carries a free-trial phase; it never references base plan
   IDs, so it picks up the new plan on its own once Play propagates.

The `12m` suffix exists only because a new ID must be unique within the
subscription — the old ID stays reserved forever.

---

## Part 3 — Add the 7-day free trial offer

Still inside the subscription → **Base plans and offers** → **Add offer**.

1. **Select base plan** → pick the one you just made (e.g. `plusyearly`) →
   **Add offer**.
2. **Offer ID** — `plusmonthlytrial7`, `plusyearlytrial7`,
   `campaignsmonthlytrial7`, `campaignsyearlytrial7`.
3. **Eligibility criteria** — this is the one real decision. See the table
   below.
4. **Phases** → **Add phase**:
   - **Type:** `Free trial`
   - **Duration:** `7` days
   - (Leave it at one phase. After the trial, Play rolls straight onto the base
     plan price — no second phase needed.)
5. **Region availability** — inherits from the base plan by default. Leave it.
6. Click **Save**, then **Activate**.

### Which eligibility criteria to pick

| | Criteria | Why |
|---|---|---|
| **PLUS monthly & yearly** | **New customer acquisition** → *Never had any subscription in this app* | Hardest abuse protection. A user gets one PLUS trial, ever, per Google account — even if they cancel and come back. |
| **Campaigns monthly & yearly** | **Developer determined** | "Never had any subscription in this app" would also block every existing PLUS subscriber from trialling Campaigns — that's your warmest advertiser audience. Developer-determined hands eligibility to us, so PLUS members can still trial Campaigns. |

⚠️ **Read this before you set Developer-determined:** "Developer determined"
means *Play does not check anything* — it is on us to decide who qualifies.
Today the app relies on:

- Play's own per-SKU rule: a Google account can't re-trial the **same** SKU
  after it lapses, even with developer-determined eligibility.
- `obfuscatedAccountId: user.uid`, which the app already sends on every
  purchase. That links every purchase to a LINKUP account, so you can add a
  server-side "has this `uid` trialled already?" check later without
  touching the client.

If trial abuse ever shows up in your numbers, the fix is a Cloud Function or a
`trialClaims/{uid}` doc checked before showing the paywall — not a client
change. Flag it then; don't block launch on it.

---

## Part 4 — The "one free trial per app" switch

Play Console → **Monetize with Play → Subscriptions** → click the ⋮ (top
right) → **Subscription settings**.

- **"Allow one free trial per app" is ON by default.** That means one trial
  *per subscriber across the whole app* — someone who trials PLUS can never
  trial Campaigns.
- **Turn it OFF** to make the trial limit per-*subscription* instead, so a user
  can trial PLUS and Campaigns independently.

**You want it OFF**, otherwise it silently overrides the Developer-determined
choice you made in Part 3 and kills the Campaigns trial for PLUS members.

---

## Part 5 — Set up testing before you ship

1. **License testers** — Settings → **License testing** → add your test Gmail
   addresses → **Save changes**. Testers get instant-purchase test cards and
   can buy without being charged.
2. **Closed testing track** — **Testing → Closed testing → Testers** → create a
   tester list, add the same addresses, copy the opt-in URL and open it on the
   test device to join.
3. **Install build 13.3.0** from the Play Store on that device (via the tester
   link). ⚠️ A debug/Expo Go build cannot talk to Play Billing — it must be a
   Play-signed build from a track.

---

## Part 6 — Verify the trial actually works

On the test device, signed in as a license tester:

1. Open a gated feature (e.g. Who Viewed You) → the paywall should read
   **"7 DAYS FREE"** in the hero and the button should say
   **"START 7-DAY FREE TRIAL"**.
2. The price card helper should read **"7 days free, then $19.99/mo"** — the
   price comes from Play's own pricing phases, not from a hard-coded string.
   If it shows the old static copy, Play hasn't returned the offer yet (see
   troubleshooting).
3. Tap the CTA → the Play sheet must show **"7 days free trial"** and
   **"$0.00 today"**, then the renewal amount.
4. Complete it → you should land on the unlocked state, and
   **Profile → LINKUP PLUS Plan** should read **"FREE TRIAL · 7 DAYS LEFT"**.
5. Repeat for **Campaigns** (Megaphone tab) → the dashboard badge should read
   **"FREE TRIAL · 7 DAYS LEFT"** instead of "CAMPAIGNS ACTIVE".
6. Check renewal timing: Play Console → **Monetize with Play → Subscriptions**
   → the subscription → **Order/subscription management**.

   ⚠️ **License-tester accounts run on a compressed clock** — this is
   expected, not a bug:

   | Real | Test period |
   |---|---|
   | Free trial | **3 minutes** |
   | 1-month renewal | 5 minutes |
   | 1-year renewal | 30 minutes |
   | Grace period | 5 minutes |

   So you can watch the whole trial→paid conversion fire inside ~10 minutes.
   It also means **a tester burns their trial eligibility in 3 minutes** — to
   re-test, use a fresh Google account.

   Two more gotchas:
   - *"If the device has more than one account, the purchase is made with the
     account that downloaded the app."* Remove your other Google accounts from
     the test device or you'll test the wrong account.
   - The local countdown in the app is still 7 real days, so it will **not**
     match Play's 3-minute test clock. That's fine — Play owns billing and the
     countdown is display-only. Don't chase it.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| *"Google Play product missing"* alert in the app | Base plan or products not active yet, or the signed-in account isn't a tester | Wait — new products/activations take **a few hours** (occasionally up to 24 h) to propagate. Confirm the build is on a track and the account is a license tester. |
| Play sheet shows the full price, no trial | The app bought the **base plan** token instead of the trial offer | `pickSubscriptionOffer()` in `mobile/src/lib/trial.ts` prefers an offer with a free-trial phase. If it still happens, the offer isn't **Activated** in Console. |
| Paywall shows "7 days free" but the helper shows the old static copy | No pricing phases returned yet | Same propagation wait. The code falls back to the shipped 7-day default, so the copy stays honest either way. |
| `BILLING_UNAVAILABLE` / "not ready" | Not a Play-signed build, or Play Store not logged in on device | Use a build installed from a Play track; log into the Play Store on the device. |
| Subscription rejected at review | Benefits text mentioned the trial or price | Rewrite the benefits (Part 1, step 3) and resubmit. |
| User can't trial Campaigns after having PLUS | "Allow one free trial per app" is still ON | Turn it off (Part 4). |

---

## After launch

- **Play Console → Monetize with Play → Subscriptions → [product] →
  Subscription analytics** — watch trial start → trial conversion. Below ~40%
  conversion, shorten to a 3-day trial rather than removing it.
- **Real-time developer notifications** (Cloud Pub/Sub) is the proper way to
  track trial→paid conversion and churn server-side. Worth wiring up once you
  have volume; `obfuscatedAccountId` already links purchases to LINKUP uids.
- **Win-back SKUs** later: remember Play blocks a second free trial on the same
  SKU unless you uncheck "Allow one free trial per app".

---

## Quick reference — where the code meets the Console

| Console value | Code |
|---|---|
| Product IDs | `mobile/src/lib/paywall.ts`, `mobile/src/lib/campaigns.ts` |
| Trial length / pricing-phase parsing | `mobile/src/lib/trial.ts` → `describeSubscriptionOffer()` |
| Which offer gets bought | `mobile/src/lib/trial.ts` → `pickSubscriptionOffer()` |
| Trial countdown state | `mobile/src/lib/trial.ts` → `saveTrialStart()` / `readActiveTrial()` |
| PLUS paywall UI | `mobile/src/components/PaywallModal.tsx` |
| Campaigns paywall UI | `mobile/src/screens/CampaignsScreen.tsx` |
| Account pill | `mobile/src/screens/ProfileScreen.tsx` |
| Package name | `mobile/app.json` → `expo.android.package` |
