# LINKUP — Google Play listing and ASO handoff

**Status: prepared locally; not published to Google Play.** English (United States), reviewed 16 October 2026. The installed app remains named LINKUP; the proposed store title does not rename the Android package or app.

## Ready-to-paste listing

| Field | File | Characters (excluding final newline) | Google Play limit |
|---|---|---:|---:|
| App name | `en-US/title.txt` | 28 | 30 |
| Short description | `en-US/short-description.txt` | 80 | 80 |
| Full description | `en-US/full-description.txt` | 2,074 | 4,000 |
| Suggested release notes | `en-US/release-notes.txt` | 271 | 500 |

**App name:** LINKUP: Cofounder Networking

**Short description:** Find cofounders, meet startup collaborators, and grow your professional network.

Use the text files as the source of truth. `npm run test:copy` validates character limits, wording, package identity, and selected runtime contracts.

## Keyword strategy

These are **editorial intent targets**, not measured search-volume or ranking claims. Google Play does not provide a general hidden keyword field: integrate relevant terms naturally into the listing and localizations. Do not paste a comma-separated keyword block into the full description.

| Priority | Search intent | Natural placement |
|---|---|---|
| Primary | cofounder networking; find cofounders; cofounder matching | Title, short description, opening paragraph |
| Primary | startup networking; startup collaborators | Short description, opening paragraph |
| Supporting | professional networking; professional connections | Opening paragraph, profile and messaging sections |
| Supporting | find a co-founder; startup team; business collaboration | Collaboration and professional profile sections |
| Supporting | founders; developers; designers; operators; investors | Accurate member-discovery explanation, not a promise of access |
| Supporting | AI networking assistant; startup ideas; project opportunities | Linky and startup opportunity sections |
| Optional regional test | cofounder networking in Zimbabwe; startup collaborators in Harare | Only in a relevant localized listing if member coverage and audience justify it |

Use both natural “cofounder” and “co-founder” phrasing in context. No competitor trademarks, fabricated rankings, download counts, guaranteed funding, guaranteed matches, or repeated keyword lists. Do not describe ordinary account or activity badges as independently verified professional credentials.

**Suggested category for review:** Business. Confirm the existing category and choose only relevant tags actually offered in Play Console. No category or tag changes have been published.

## Publishing checklist

1. Open the existing Play Console app for **`com.tana.linkup`**. Do not create a replacement package or alter billing product IDs.
2. Confirm which listing language is currently primary. This pack is `en-US`; prepare human-reviewed localizations separately rather than assuming all English locales are interchangeable.
3. Paste the app name, short description, and full description into the appropriate main store listing. Review the preview and any policy warnings.
4. Keep existing truthful support, website, and privacy URLs. Check that account-deletion, data-safety, AI features, permissions, ads, target audience, and paid-feature disclosures match the released binary. This copy work is not a policy or billing compliance certification.
5. Capture new screenshots **from the revised Android build**. Suggested captions: “Find relevant cofounders”, “Present your professional expertise”, “Explore startup opportunities”, “Review AI-assisted introductions”, “Connect with mutual approval”, and “Share project progress”. Do not publish screenshots implying unavailable features. Previously approved marketing screenshots are unchanged.
6. Build and test a signed Android release, then roll it out through the appropriate track. Current repository config: version `14.0.0`, versionCode `20`; confirm Play Console's highest code and assign a higher code before a new upload. `mobile/eas.json` uses local versioning and does not auto-increment production versionCode.
7. Test profile setup, long labels at Android accessibility font sizes, connection approval, Linky recommendations/consent, subscriptions, restore purchases, and cancellation on actual devices. Web smoke tests and TypeScript checks do not replace native QA.
8. Save and submit the listing for review. Store copy can be submitted separately, but screenshots and claims must match the available release. Publishing requires Play Console access; no publishing integration was available for this work.
9. After approval, track search acquisition, store visitors, first-time installs, listing conversion, crashes, and retention against a baseline. Test one meaningful listing change at a time with Store Listing Experiments when available. Set no guaranteed ranking or install target.

## Sources

- [Google Play — Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en): app name 30 characters, short description 80, full description 4,000; avoid repetitive or irrelevant keyword use. Retrieved during this copy review.
- [Google Play — Metadata policy](https://support.google.com/googleplay/android-developer/answer/9898842?hl=en): review accuracy, formatting, and promotional claims before submission.

## Release boundary

Updating repository text or deploying the web app does **not** update an installed Android app or publish a Google Play listing. Android release, store listing submission, and approval are separate steps.
