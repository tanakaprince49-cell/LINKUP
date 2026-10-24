# Linky message allowance and Android app reviews

Implementation handoff — originally 16 October 2026; daily-only allowance shipped in 16.9.0 on 24 October 2026.

## Current behavior

- Free accounts: **5 Linky messages per UTC day**, resetting at **midnight UTC**. There is no monthly bucket anymore.
- PLUS: **unlimited Linky messages**. There is no member daily allowance or shared-cap rejection. Meet limits, prices, billing products, and other entitlements are not changed by this update.
- The fifth successful free message is delivered. The shared Android/web UI then opens the PLUS paywall immediately and locks the composer; no sixth send is possible.
- At free exhaustion, entering the Linky screen also opens the paywall. Dismissing it leaves the last response readable but does not restore messages. The locked composer shows the live reset countdown and reopens the paywall on tap without sending another request.
- The next free daily reset is **00:00 UTC**. UTC-day rollover refreshes the client allowance. PLUS has no allowance reset countdown and displays **Unlimited messages · PLUS**.

## Server enforcement

`api/_linkyUsage.js` uses a Firestore transaction against the server-only `linkyUsage/{uid}` ledger. App, Telegram, and WhatsApp asks share this account allowance. Greetings, named-person asks, drafts, cached replies, confirmations, and typed introduction follow-ups all pass through the same reservation before any answer/model processing. Administrative actions such as viewing preferences, clearing chat, or approving a connection are not conversational messages and do not spend credits.

- Concurrent sends cannot spend more than the allowance.
- A ledger outage blocks processing; there is no silent fallback to unmetered use.
- Fatal processing failures attempt to refund their reservation. A delayed refund cannot subtract credits from a different calendar period.
- Clearing a conversation or using Forget does not reset the ledger. The UI explains this.
- Free monthly and PLUS daily accounting buckets are separate; upgrade/downgrade cannot erase free monthly usage. Only the free bucket represents an exhaustible allowance.
- Existing PLUS daily usage is migrated from the legacy state on first use. Free accounts start the new monthly ledger at zero because historical daily totals are not a complete monthly record.
- `messageQuota` is the authoritative API object. Daily-named `home.limits` fields remain compatibility aliases for older binaries and now carry the active period's usage. PLUS uses `unlimited: true` and null `limit`/`remaining`; new clients use the explicit metadata.
- Exhausted free asks return HTTP 402 with `code: ask_limit`, `messageQuota`, and `upgradeRequired`. Unauthenticated requests remain blocked before user processing.

Native clients installed before 16.8.0 can misrender the new null PLUS `remaining` value as **0 messages left**; the deployed server still does not enforce the retired member cap and those clients can continue sending. A new Android binary is required for the correct explicit **Unlimited** label. Older free clients likewise need the monthly-label release for the immediate-on-exhaustion paywall experience.

## Android reviews

Added `expo-store-review` at the Expo SDK-compatible version. Its Android module uses Google's official Play In-App Review API. No new review permission is required.

Automatic review requests are eligible only after:

1. At least three days since the first recorded use;
2. Use on at least three distinct days;
3. At least five successfully sent chat/media messages or completed Linky replies;
4. At least 90 days since the last request attempt, with at most three attempts in a rolling year.

The request waits 15 idle seconds on **Discover, Startups, or News**, while signed in, onboarded, online, and foregrounded. It is not triggered from onboarding, conversations, Linky, account settings, or checkout. Visible paywalls block review requests. Navigating away or backgrounding cancels the pending opportunity.

Google controls whether the native review dialog actually appears, its design, and dismissal. A completed API call does **not** prove that a review was shown or submitted. The app records only attempts, never an assumed rating. There is no sentiment pre-screen, five-star request, incentive, credit reward, or paid-feature benefit for reviewing.

A separate **Settings & Preferences → Rate LINKUP** button on Android opens the Google Play listing directly, with an HTTPS fallback if the market URL cannot open. It does not rely on the quota-limited review API and is available without waiting for automatic eligibility. Web and iOS do not show this Android-only control.

## Historical validation (original monthly-allowance release)

- 61 automated regressions passed: 23 allowance/review checks plus the existing 38 copy, SEO, privacy, routing, PWA, and payment-guard checks.
- Shared mobile TypeScript check passed.
- Expo web production export passed.
- Expo Android/Hermes JavaScript export passed. **This is not a signed APK/AAB or device test.**
- Chromium smoke passed at the original root and the `/app` proxy on desktop and 390px mobile. These tests block real providers and do not sign in or spend real members' credits.
- API tests exercise the real ask wrapper against a transaction-capable in-memory database and verify structured 402 responses, simultaneous exhaustion, cross-channel counting, refunds, calendar boundaries, PLUS migration, and clear/forget behavior. They are not a live Firestore concurrency test.
- Review tests mock the native module and local storage to verify eligibility, suppression, cooldown, billing blockers, failures, and manual-store fallback. Real Google Play UI still needs a Play-distributed device build.

## Android release checklist

1. Confirm the highest uploaded versionCode in Play Console and select a higher code. Source version for this update is `16.8.0` / `31`; EAS production auto-increment is disabled.
2. Build a signed Android release containing the newly linked `expo-store-review` module. Upload through an internal/closed track before production.
3. Verify free daily usage at 4 → 5 → blocked, immediate paywall plus locked composer, dismiss/retry, reload, multiple devices/channels, upgrade/restore, PLUS unlimited usage with an Unlimited label, and UTC-midnight rollover using dedicated test accounts. Never spend real members' credits for release verification.
4. Follow Google's review-testing requirements on a Google Play-enabled device and an eligible test account. Do not assume a sideloaded APK or a suppressed dialog proves the flow is broken.
5. Confirm that manual Rate LINKUP opens the correct `com.tana.linkup` listing, cancellation returns to the app, and review attempts never grant credits or rewards.
6. Recheck privacy/Data safety disclosures for local review-timing state and the server usage ledger. Existing app copy and this technical handoff are not a policy certification.
7. Store description/release-note files were updated to disclose the new allowance. They are prepared text, not a submitted Play listing.

## References

- [Google Play In-App Reviews API](https://developer.android.com/guide/playcore/in-app-review): timing, no sentiment questions or overlays, Google-controlled display quotas, and direct-store routing for a manual Rate button.
- [Testing in-app reviews](https://developer.android.com/guide/playcore/in-app-review/test): use eligible accounts and supported test distribution.

The backend/web deployment and Android/Play Store releases are separate. Check the GitHub production workflow and deployed build identifier for web rollout status; do not interpret a repository push as an Android publication.


### Allowance change (16.9.0)

The free allowance is now daily-only: 5 messages per UTC day, resetting at midnight UTC. The 15/month bucket is retired and historical monthly ledgers are ignored, so every free member starts each UTC day fresh. PLUS remains unlimited and the header displays that state directly after “Big ideas welcome.”
