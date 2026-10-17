# Linky monthly allowance and Android app reviews

Implementation handoff — 16 October 2026.

## Agreed behavior

The user selected **free members only** for the new Linky allowance.

- Free accounts: **15 Linky messages per UTC calendar month**.
- PLUS: **60 Linky messages per UTC day**, unchanged. Meet limits, prices, billing products, and entitlements are not changed.
- The tenth successful message is delivered. The shared Android/web UI then opens the PLUS paywall immediately; no eleventh send is required.
- At exhaustion, entering the Linky screen also opens the paywall. Dismissing it leaves the last response readable but does not restore messages. Further send attempts reopen the paywall without sending another request.
- The next monthly reset is **00:00 UTC on the first day of the next month**. Calendar rollover refreshes the client allowance. PLUS exhaustion displays a daily-limit notice, not another purchase prompt.

## Server enforcement

`api/_linkyUsage.js` uses a Firestore transaction against the server-only `linkyUsage/{uid}` ledger. App, Telegram, and WhatsApp asks share this account allowance. Greetings, named-person asks, drafts, cached replies, confirmations, and typed introduction follow-ups all pass through the same reservation before any answer/model processing. Administrative actions such as viewing preferences, clearing chat, or approving a connection are not conversational messages and do not spend credits.

- Concurrent sends cannot spend more than the allowance.
- A ledger outage blocks processing; there is no silent fallback to unmetered use.
- Fatal processing failures attempt to refund their reservation. A delayed refund cannot subtract credits from a different calendar period.
- Clearing a conversation or using Forget does not reset the ledger. The UI explains this.
- Free monthly and PLUS daily counters are separate; upgrade/downgrade cannot erase free monthly usage.
- Existing PLUS daily usage is migrated from the legacy state on first use. Free accounts start the new monthly ledger at zero because historical daily totals are not a complete monthly record.
- `messageQuota` is the authoritative API object. Daily-named `home.limits` fields remain compatibility aliases for older binaries and now carry the active period's usage. New clients use the explicit period/reset metadata.
- Exhausted asks return HTTP 402 with `code: ask_limit`, `messageQuota`, and `upgradeRequired`. Unauthenticated requests remain blocked before user processing.

Native clients installed before this release may still describe the old daily counter in their UI; the new server limit is enforced regardless. A new Android binary is required for the updated monthly labels and immediate-on-tenth paywall experience.

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

## Validation

- 61 automated regressions passed: 23 allowance/review checks plus the existing 38 copy, SEO, privacy, routing, PWA, and payment-guard checks.
- Shared mobile TypeScript check passed.
- Expo web production export passed.
- Expo Android/Hermes JavaScript export passed. **This is not a signed APK/AAB or device test.**
- Chromium smoke passed at the original root and the `/app` proxy on desktop and 390px mobile. These tests block real providers and do not sign in or spend real members' credits.
- API tests exercise the real ask wrapper against a transaction-capable in-memory database and verify structured 402 responses, simultaneous exhaustion, cross-channel counting, refunds, calendar boundaries, PLUS migration, and clear/forget behavior. They are not a live Firestore concurrency test.
- Review tests mock the native module and local storage to verify eligibility, suppression, cooldown, billing blockers, failures, and manual-store fallback. Real Google Play UI still needs a Play-distributed device build.

## Android release checklist

1. Confirm the highest uploaded versionCode in Play Console and select a higher code. Source version is still `14.0.0` / `20`; EAS production auto-increment is disabled.
2. Build a signed Android release containing the newly linked `expo-store-review` module. Upload through an internal/closed track before production.
3. Verify monthly usage at 9 → 10 → blocked, immediate paywall, dismiss/retry, reload, multiple devices/channels, upgrade/restore, PLUS 60/day, and UTC rollover using dedicated test accounts. Never spend real members' credits for release verification.
4. Follow Google's review-testing requirements on a Google Play-enabled device and an eligible test account. Do not assume a sideloaded APK or a suppressed dialog proves the flow is broken.
5. Confirm that manual Rate LINKUP opens the correct `com.tana.linkup` listing, cancellation returns to the app, and review attempts never grant credits or rewards.
6. Recheck privacy/Data safety disclosures for local review-timing state and the server usage ledger. Existing app copy and this technical handoff are not a policy certification.
7. Store description/release-note files were updated to disclose the new allowance. They are prepared text, not a submitted Play listing.

## References

- [Google Play In-App Reviews API](https://developer.android.com/guide/playcore/in-app-review): timing, no sentiment questions or overlays, Google-controlled display quotas, and direct-store routing for a manual Rate button.
- [Testing in-app reviews](https://developer.android.com/guide/playcore/in-app-review/test): use eligible accounts and supported test distribution.

The backend/web deployment and Android/Play Store releases are separate. Check the GitHub production workflow and deployed build identifier for web rollout status; do not interpret a repository push as an Android publication.


### Allowance increase

The free limit is now 15/month, preserving the existing UTC-month ledger count. A member at 10 used receives five additional messages, not a new 15-message bucket. PLUS remains 60/day. The counter appears in the Linky header directly after “Big ideas welcome.”
