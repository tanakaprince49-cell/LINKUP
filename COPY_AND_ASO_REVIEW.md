# LINKUP — Professional Copy, Web SEO & Play Store ASO

Reviewed 16 October 2026.

## Delivery status

- **Implemented in the shared Android/web app source and validated locally.**
- The original wording/SEO release was deployed as `620523b`. Google Play still requires a separate signed Android release and listing submission. Subsequent quota/review changes are documented in `LINKY_LIMITS_AND_REVIEWS.md`.
- The original copy-only release preserved Android version, package identifiers, subscription products, prices, limits, routes, and member data. The subsequent requested change intentionally updates free Linky usage to 10 messages per month; PLUS retains 60 per day.
- The separate marketing website and its six previously approved screenshots are unchanged.

## Professional wording

**249 audited wording changes across 39 shared UI/helper files**, plus clearer navigation labels and professional Linky presentation prompts.

Coverage includes profile setup, onboarding, discovery, connection requests, messages, startup ideas/listings, recommendations, campaigns, account settings, deletion confirmations, billing explanations, profile insights, offline states, business challenges, progress updates, and local rankings. Standard actions such as Save, Cancel, and Search remain concise. Existing brand/feature names and runtime identifiers are preserved.

| Before | Now |
|---|---|
| “Are you sure you want to exit the realm?” | “Sign out of your LINKUP account on this device?” |
| “VIBE-CHECK (INTRO)” | “PROFESSIONAL INTRODUCTION” |
| “The room is still small.” | “Grow your professional network.” |
| “not posting hustle” | “Find a cofounder, discover startup collaborators, and build professional connections around shared skills and goals.” |
| “Ship log” | “Progress log” |
| “City league” | “Local rankings” |
| “See who's checking you out” | “Review your profile audience” |
| “Priority human review — live within 24 hours” | “Priority campaign review before publication” |

The complete before/after audit is in `tests/fixtures/professional-copy-review.json`. Historical user content, already-saved activity labels, previously generated conversations, and approved screenshot pixels were not bulk-rewritten.

### Linky

Professional, approachable, evidence-based wording replaces teasing, jokes, and promotional exaggeration in presentation prompts and key fallback replies. Matching, ranking, consent, sending permissions, and plan limits remain intact. Relevant presentation-cache namespaces were incremented so newly requested replies can use the revised style; no member records or existing messages were deleted. Responses still depend on the configured AI provider and need production sampling after release.

## Web SEO

- Shared title/description focused on **cofounder matching**, **startup networking**, and **professional collaboration**.
- A separately exported, indexable public `/app/landing` page with a canonical URL, social sharing metadata, and truthful `WebApplication` structured data.
- Private/account/conversation screens use `noindex,follow`; route transitions update the title and remove public landing schema/canonical metadata where inappropriate. This is search hygiene, not a substitute for access control.
- The public app landing is included in the static sitemap. Existing public professional profiles, pagination, privacy filters, canonical links, and member-feed protections remain intact.
- Root and `/app` hosting mounts remain supported; app routing, payment returns, PWA scope, and marketing-site isolation have regression coverage.
- No keyword-stuffing meta tag, fabricated testimonials, ratings, download counts, or ranking guarantees.

Search engines must recrawl deployed pages; this work does not guarantee a ranking or installation increase.

## Google Play listing — ready to submit

**Proposed app name — 28/30 characters**

> LINKUP: Cofounder Networking

**Short description — 80/80 characters**

> Find cofounders, meet startup collaborators, and grow your professional network.

**Full description:** 2,156/4,000 characters, in `store/google-play/en-US/full-description.txt`.

**Primary keyword intents:** cofounder networking, find cofounders, cofounder matching, startup networking, startup collaborators, professional networking, startup team, AI networking assistant.

These are editorial targets, not measured search-volume claims. Keywords are used naturally in the title and descriptions, not as a spam list. See `store/google-play/README.md` for exact files, supporting keyword intents, policy references, suggested screenshot captions, and the publishing checklist.

## Validation completed

| Check | Result |
|---|---|
| Shared mobile TypeScript | Passed |
| Expo production web export | Passed |
| Professional copy / ASO / SEO regressions | 8 passed |
| Public SEO and member-privacy regressions | 12 passed |
| Payment-return and webhook-signature regressions | 6 passed |
| Routing, assets and PWA regressions | 12 passed |
| Real Chromium smoke — original app root | Passed |
| Real Chromium smoke — custom `/app` proxy, desktop | Passed |
| Real Chromium smoke — custom `/app` proxy, 390px mobile | Passed |

Browser tests checked app loading, email-screen navigation and refresh, SEO transitions, canonical/schema removal from sign-in, no horizontal clipping, manifests, scoped service workers, API transport, legal links, and marketing-page/cache isolation. They blocked external providers and did not sign in, write production data, or charge money. Local visual evidence is in `docs/qa/`.

These checks are **not** a native Android device test, authenticated end-to-end test, live AI-quality review, Google Play approval, or real purchase/fulfillment test. Android large-font/accessibility QA remains part of the release checklist.

## Release next steps

1. Push the reviewed commit to both `main` and `codex/mobile-port`, leaving `codex/mobile-port` checked out. The production workflow now includes `npm run test:copy` before promotion.
2. Verify the deployment at `https://www.linkupbuild.com/app/landing`, inspect raw metadata and the static sitemap, then repeat the existing production routing audit.
3. For Android, check Play Console's highest versionCode before assigning a higher value. Current source config remains version `14.0.0`, versionCode `20`; production EAS auto-increment is disabled. Build, test, and upload a signed release separately.
4. Capture current Android screenshots and submit the prepared Play listing. Review support links, Data safety, permissions, paid-feature disclosure, and all relevant Play policies against the actual release.

No credentials are included in this handoff. Do not paste access tokens into source files or documentation.
