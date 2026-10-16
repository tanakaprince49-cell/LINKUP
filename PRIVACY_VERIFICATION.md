# LINKUP privacy verification handoff

Prepared 16 October 2026. Deployment and Google's verification approval are separate steps; this document does not certify either. Check the conversation and live responses for the latest release status.

## Confirmed identity

- App: LINKUP; Android package `com.tana.linkup`.
- Operator: **Tanaka Gaadzikwa**, acting as an individual.
- Privacy, deletion and safety contact: **tanakaprince49@gmail.com**.
- Minimum age: **16+**, or a higher minimum where local law requires. The professional network is not described as an adults-only dating service.
- Canonical policy: **https://www.linkupbuild.com/privacy**.

## What was fixed

The canonical `/privacy` URL previously returned the marketing homepage through a catch-all rewrite. The app and website also linked to an old Google Doc. The replacement is a dedicated, publicly accessible HTML policy with its full content present without JavaScript, cookies, sign-in, or a Google Doc viewer.

Both repositories carry the same `legal/privacy-policy.json` source and `scripts/render-privacy-policy.cjs` renderer. The generated HTML is `mobile/public/privacy-policy.html` in LINKUP and `public/privacy.html` in Linkup-landing-page. Both files have identical content. Each also generates `PRIVACY_POLICY.md`. To update the policy, mirror the source and renderer across both repositories, run `npm run privacy:render` in each, and run `npm run test:privacy`.

The new policy covers Google identity/email/profile access and its purposes; Firebase authentication/session handling; relevant Google-data sharing and storage; AI/profile context and external searches; public directory/search indexing; messages/media/introductions; optional messaging channels; purchases/allowance records; device permissions; providers; retention/deletion limits; security; international processing; privacy choices; and age/safety rules.

- Exact legal aliases are before the marketing SPA catch-all and app fallback; the existing `/app` proxy remains intact.
- Website footer, app sign-in, profile settings, and public SEO pages link to the canonical policy. The website footer identifies the individual operator rather than an unverified incorporated company.
- Deletion and child-safety pages have the confirmed contact and age/description. Deletion instructions accurately distinguish the current in-app flow from broader manually reviewed data requests.
- The marketing footer reopens Privacy choices. Optional Vercel traffic analytics on the marketing site and web app load only after acceptance. Declining previously enabled analytics reloads the page to unload the injected vendor script, including in other open tabs receiving the storage event. The static policy itself has no scripts, analytics, or external assets.
- Removed unused marketing Tiun initialization with its placeholder snippet ID. No networking, billing, quota, review, public-directory, or authentication feature was intentionally changed.

## Local validation

- LINKUP: **65/65 tests** across root test files and web-mount tests; TypeScript, Expo web production export, and the Android Hermes JavaScript export passed (not a signed APK/AAB).
- Marketing: **16/16 tests** across privacy/routing/member-directory/showcase tests; TypeScript and Vite production build passed. Existing large-chunk warning remains non-blocking.
- Browser checks: all three app mount scenarios passed (original root, custom-domain `/app`, mobile `/app`), using local stubs with external requests blocked.
- Privacy browser checks: full HTML and aliases read without JavaScript at **1280px and 390px**, no horizontal overflow, correct email and canonical links, real footer navigation, and optional analytics disabled before acceptance and after decline/reload.
- These tests do **not** prove authenticated Google sign-in, payment fulfillment, complete end-to-end deletion, an Android device/Play release, production deployment, or Google verification approval.

Commands:

```sh
# LINKUP
node --test tests/*.test.mjs mobile/scripts/test-web-mount.cjs
npm run lint
npm --prefix mobile run build:web
PLAYWRIGHT_MODULE_PATH=/path/to/playwright npm --prefix mobile run test:web-browser

# Linkup-landing-page
npm run lint
npm run build
PLAYWRIGHT_MODULE_PATH=/path/to/playwright npm run test:privacy-browser
```

Browser tests require Playwright and Chromium installed separately. The module-path override is optional if Playwright is resolvable normally.

## Publish and verify before responding to Google

1. Commit each repository on `codex/mobile-port`. Inspect the diff for secrets and unrelated changes.
2. In **each** repository, with restored GitHub credentials, push both branches while keeping `codex/mobile-port` checked out:

   ```sh
   git push --atomic origin HEAD:main HEAD:codex/mobile-port
   git ls-remote origin refs/heads/main refs/heads/codex/mobile-port
   ```

3. Wait for the LINKUP production/rules workflows and the marketing Vercel deployment; verify their commit SHAs. Marketing has a separate deployment from the app. Publishing only the app does not fix the reviewer's exact URL.
4. Fetch `https://www.linkupbuild.com/privacy` in a fresh session and inspect raw HTML: HTTP 200, `Privacy Policy` heading, operator/contact, Google sections, all 15 policy sections, canonical URL, no app bundle/Doc/iframe requirement. Also check `/privacy-policy`, `/app/privacy`, `/app/privacy-policy`, `/app/data-deletion`, and `/app/child-safety-standards` and ensure the app entrances, payments guards and public directory still work.
5. Confirm homepage/footer, Google sign-in page and profile-settings links actually open the policy. Test mobile layout and a JavaScript-disabled browser. Run the existing live routing verifier with the new app SHA after deployment.

## Operator checks before resubmission

A code audit cannot establish your production AI account tier, provider retention/training settings, processor contracts, infrastructure regions, or legal transfer safeguards. Confirm that AI gateways and underlying providers receiving Google API-derived profile information are configured/contracted to respect the Google API Services User Data Policy and applicable Limited Use restrictions, including no unauthorized generalized-model training, ads, brokerage, or unrelated use. Some name/photo fields can originate from Google sign-in; do not assume only typed prompts reach AI providers. If a provider cannot support the applicable restrictions, restrict/exclude the relevant data or disable that processing before using it.

Confirm that the monitored mailbox and manual deletion process are operational, particularly for uploaded media, chats, introductions, logs and third-party records not automatically removed by the current account-deletion function. This implementation does not silently claim that a comprehensive server-side erasure engine exists.

The policy is a factual product-specific disclosure, not a legal compliance certification. Have the operator or an appropriate adviser review jurisdiction-specific requirements.

## Google Cloud resubmission (manual)

Google Cloud and GitHub connectors were not available in this session. Do not claim the OAuth consent configuration was changed or a review was submitted through those consoles.

Google's guidance: https://support.google.com/cloud/answer/13806988

- Keep the consent screen's privacy-policy URL set to `https://www.linkupbuild.com/privacy` and verify that the app/homepage identity and authorized/verified domains match the project.
- Because the policy URL itself is unchanged, after the new page is publicly live, reply to the original verification email confirming the changes. If you change a Console URL or other configuration, save it and follow the Console's resubmission steps as well.
- Request only the Google identity/email/profile access actually used; do not add Gmail, Drive, Calendar or Contacts scopes for this policy fix.
- Google's reviewers determine approval. Expanded text and correct routing address the reported deficiency but cannot guarantee approval.

Suggested reply **only after deployment and operator checks**:

> Hello Google Verification Team,
>
> We have updated LINKUP's privacy policy at https://www.linkupbuild.com/privacy. It is now a dedicated public HTML page, accessible without sign-in or JavaScript, and is linked from our website and app. It explains the Google sign-in information accessed, its purposes, sharing, storage/security, retention, deletion and access-revocation choices, alongside the service's other data practices.
>
> LINKUP is operated by Tanaka Gaadzikwa. Our privacy contact is tanakaprince49@gmail.com. Please review the updated policy and continue the verification process. Thank you.

## Android release boundary

The public web policy and website links can deploy independently. New policy/deletion rows inside the native app require a new signed Android binary/Play release; a JavaScript export is not an APK/AAB or proof of store publication. Existing installed binaries retain their old hard-coded link until updated. No OAuth review approval or signed Play release is performed by committing these files.
