# Campaigns, Startups and News SEO

## Scope

This is a shared server-rendered publication layer for every eligible existing and future listing, not a set of hard-coded pages for selected companies. It reuses the existing `publicSeo` serverless function; there is no additional serverless function or Firebase rules relaxation.

Canonical public routes:

- `https://www.linkupbuild.com/app/campaigns`
- `https://www.linkupbuild.com/app/campaigns/<campaignId>`
- `https://www.linkupbuild.com/app/startups`
- `https://www.linkupbuild.com/app/startups/<postId>`
- `https://www.linkupbuild.com/app/news`

All routes return useful HTML content, headings, real crawlable links, self-canonical URLs, descriptions, Open Graph/Twitter metadata and JSON-LD without login or client-side JavaScript. Root and `/app` route variants share the same canonical URLs; both Vercel configurations support the landing proxy stripping `/app`.

## Automatic discovery

The sitemap index now includes bounded campaign and startup shards, alongside the existing profiles and static sitemap. Static entries include the three public listing pages. Sitemaps and listing pages read the source collections on each request, so future eligible listings do not need a deployment, backfill, generated static file, manual URL entry or submission job.

- `sitemap-campaigns-<page>.xml`: active campaign candidates, rechecked before inclusion.
- `sitemap-startups-<page>.xml`: startup post candidates, rechecked before inclusion.
- Modification dates come from actual source timestamps; no artificial freshness stamps.
- Image entries use real hosted logos, not made-up product images.
- Listings have bounded cursor pagination, self-canonical cursor URLs and ordinary HTML next links. Pagination continues even if a source page contains only ineligible rows.
- Public pages cross-link Campaigns, Startups, News and the builders directory. The public landing links to the new directories in both its interactive page and noscript content.
- Startup sharing includes its public detail URL. Active campaign details include a public-product share action.

The authoritative root robots file already advertises the app sitemap. The release checker verifies this rather than editing an unrelated marketing deployment.

## Publication and privacy gates

Campaigns must be active, have a real future expiry (matching the app's serving rule), and have a named creative and substantive description. Pending, paused, rejected, ended, expired and unstamped campaigns are excluded. Legacy idea creatives use CreativeWork, not Product. House ads and synthetic/demo records are excluded.

Startups must be actual `posts` records with `type: startup`, a startup name, an introduction, and no draft/removed state. Legacy discussion posts are not republished as startups.

Both surfaces reject deleted, hidden, private, stealth or unapproved content and recheck the current creator account: it must satisfy the existing public-profile eligibility gate. Hidden/deleted/missing/unfinished/synthetic owners cannot be exposed indirectly through these pages. Every surface uses the same checks, including direct detail requests and sitemap requests. A formerly valid direct URL returns a genuine noindex 404 after withdrawal.

Source reads use field masks and explicit output projections. Billing, moderation notes, campaign performance, view/like identities, comments, targeting data, email and other private creator fields are never serialized. No-store headers prevent application/CDN caches from retaining withdrawn content; third-party search/CDN caches remain outside LINKUP's control.

Publication disclosures were added to the campaign and startup submission screens. App management and interaction routes remain private/noindex (`campaign-manager`, `campaign-dashboard`, `startup-feed`, `news-feed`). The service worker skips public SEO routes and cannot replace a withdrawn listing with a cached app shell.

## Accurate structured data

- Campaign products: WebPage with Product mainEntity, real description/image/category, breadcrumbs and a clearly visible sponsored disclosure. No fabricated price, availability, rating, review, brand or seller. Product markup without genuine offers/reviews may not qualify for Google's product rich results; organic indexing does not require inventing those fields.
- Startup introductions: WebPage with Organization mainEntity and real logo/official website. The posting member is attributed, not automatically declared the startup's founder.
- Listings and News: CollectionPage with ItemList and crawlable links.
- News is an attributed external-headline collection, not original LINKUP reporting. It does not claim NewsArticle authorship, create thin local copies of third-party articles, or include a Google News sitemap for external publishers.

## Real news feed

The API and crawlable News page share one server-side NewsAPI loader. It bounds requests, has an eight-second upstream timeout, coalesces concurrent warm-instance requests, caches real results for ten minutes, and permits at most a one-hour stale-real-result fallback during outages. IDs are stable hashes of article URLs, not changing clock values. Original publication dates are preserved; missing dates are not invented. Unsafe URLs and duplicate headlines are excluded.

The crawlable page never publishes the interactive app's sample story pool. On a provider outage it renders its genuine evergreen introduction and a visible availability notice, without fabricated headlines or fresh timestamps. Provider secrets are never included in public responses or logged upstream errors.

## Validation and rollout

Local verification: 166/166 standard tests passed with zero skips after production web export; mobile TypeScript typecheck passed; git whitespace validation passed. There are 24 new content/news regression tests, and service-worker, sitemap and route expectations were updated to distinguish public content from private management pages. Existing profile and safety tests remain in place. The production workflow runs the expanded SEO suite before promotion and verifies the new listing routes and sitemap shards afterward.

After an authorized push to both `codex/mobile-port` and `main`, monitor the exact-SHA production workflow and verify actual public listing/detail HTML and sitemap contents. Keep `codex/mobile-port` checked out. No signed native APK/AAB is produced by this web SEO release; existing native clients already benefit from public server-rendered pages, while native share/disclosure UI changes require a later native build.

## Search Console follow-through

In the owner's verified Search Console property:

1. Submit or confirm `https://www.linkupbuild.com/app/sitemap.xml`.
2. Inspect the Campaigns, Startups and News URLs and representative eligible detail URLs; run the live test and request indexing where appropriate.
3. Check Page indexing and sitemap reports after recrawling. Investigate blocked resources, non-indexed canonicals or thin/duplicate listings rather than promising a fixed rank or deadline.
4. Encourage complete, unique, factual product and startup descriptions and real logos. Listing text, editorial quality, relevance and earned links affect discovery beyond technical markup.

No Search Console access, sitemap submission, Google indexing, Google News inclusion, rich result, ranking position or indexing timetable is claimed by implementing this release. Google's general Indexing API is not a submission mechanism for these product/startup listings. Google chooses crawling, indexing, displayed titles/images and ranking.
