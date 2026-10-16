# Live landing-page member feed

The marketing site's “Meet the Builders on LINKUP” component now consumes:

`GET https://www.linkupbuild.com/app/api/publicSeo?mode=members`

The original-origin equivalent is `/api/publicSeo?mode=members`. No extra Vercel function or marketing Firebase credentials are required; the existing `/app` proxy forwards it to the app.

Response: `{ "profiles": [...], "nextCursor": "uid-or-null" }`. Supply `&after={nextCursor}` for the next page. Each query scans at most 40 discovery candidates plus one lookahead. A page can contain fewer or even zero public members while still having a next cursor, since privacy is checked against the current source account.

The feed shares the SEO directory's authoritative eligibility checks: current `users` data, completed onboarding, visible/not stealth/not deleted, no known synthetic/bot profiles. The discovery index is used only for candidate IDs, never as the privacy authority. Responses are no-store, JSON and noindex.

The explicit card-field allowlist is uid, name, bio, occupation, company, coarse location, skills, lookingFor, HTTPS avatar and canonical profile URL. No email, phone, private/account/billing fields, match percentage, reputation score or verification claim is returned. No database rules or member records are modified.

The marketing UI shows 12 cards at a time, paginates in bounded batches, searches/filters loaded members, links directly to each canonical public profile, and uses initials for missing/broken photos. It fetches on mount and refreshes on tab visibility/focus. Failure/empty states never substitute fictional people. Static demo builder data has been removed from the marketing repository.

Backend regression tests are included in `npm run test:seo`. The marketing repository runs data/search/pagination/failure tests in `npm run test:builders` and before its production build.
