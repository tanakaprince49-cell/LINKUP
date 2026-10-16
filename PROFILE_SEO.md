# Public member SEO — custom domain

## What ships in this repository

- Canonical public page: `https://www.linkupbuild.com/app/p/{uid}`. UID URLs remain stable when a member changes their name or username. Name/occupation appear in the HTML title and H1; bio, skills, coarse location and projects are visible without JavaScript or signing in.
- Public member directory: `https://www.linkupbuild.com/app/builders`, with crawlable links and cursor-based pagination (40 discovery candidates per page).
- Sitemap index: `https://www.linkupbuild.com/app/sitemap.xml`; static directory sitemap and 1,000-profile XML shards. No fabricated last-modified dates, ratings or keyword stuffing.
- Person/ProfilePage JSON-LD, canonical links, Open Graph/Twitter previews, and public social-link entity references where members have supplied them.
- Profile share/copy links use the canonical custom domain on web and native. Existing `/profile/{uid}` app routes and native API base URL are retained. Public pages link to those interactive app profiles.
- Root and `/app` aliases work on the app origin and after the marketing proxy strips `/app`.
- Public-page service-worker bypass and no-store response headers prevent a hidden/deleted profile from being reused from our caches. Google/third-party caches are not under LINKUP's control.

## Eligibility and privacy

A published profile must have a valid UID and name, `onboarded === true`, and must not be deleted, hidden, in stealth mode, synthetic or a bot. The handler checks the current `users` source of truth with a field mask, not just the eventually consistent `publicProfiles` discovery record. It projects an explicit public field allowlist. No email, phone, age, chats, activity, billing, private relationship data or complete Firestore documents are rendered.

Missing/ineligible profiles return real HTTP 404 plus noindex; outages return HTTP 503 with Retry-After rather than masquerading as deleted pages. User content is escaped, including JSON-LD, and public responses have a restrictive CSP. Firestore client rules remain unchanged: anonymous clients do NOT get database access.

Newly eligible members enter sitemap/directory discovery once their existing discovery-index sync/backfill runs. Direct public URLs check the source account immediately. Existing hourly `backfill-public-profiles.mjs` remains in place; no credential-dependent production data migration was run here.

**Visibility is now also internet visibility:** communicate this in product privacy/help copy. Members can disable discovery/visibility or enable stealth to remove their public page. Google can take time to remove an already indexed page; use Search Console removal for urgent cases.

## Runtime prerequisites

The Vercel app project needs the existing Firebase Admin credentials: either `FIREBASE_SERVICE_ACCOUNT`, or `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`. Never expose them with EXPO_PUBLIC variables or commit their values. This endpoint reuses `api/_firebaseAdmin.js`.

The app deploy workflow is triggered by `codex/mobile-port`; `main` is kept in sync by the owner's release convention. Pushing code is not proof of a successful deployment.

## Domain-level follow-up (marketing project / Search Console)

The domain root is owned by the **separate marketing project**, not this repository. Its observed root robots file currently allows crawling but advertises only the marketing sitemap. `/app/robots.txt` does not replace the domain's authoritative `/robots.txt`.

After the app deployment is verified:

1. Preserve the existing marketing `/robots.txt` and ADD this line:

   ```text
   Sitemap: https://www.linkupbuild.com/app/sitemap.xml
   ```

2. Add an ordinary visible `<a href="https://www.linkupbuild.com/app/builders">Meet LINKUP builders</a>` to the marketing footer/navigation. Do not replace the homepage, DNS, existing sitemap or `/app` proxy.
3. Verify the `linkupbuild.com` domain property in Google Search Console (DNS ownership verification requires the domain owner), and submit `https://www.linkupbuild.com/app/sitemap.xml`. You can submit this directly before the marketing robots change.
4. Inspect a real eligible member URL using Search Console's URL Inspection live test. Confirm HTTP 200, visible name/bio, canonical URL and valid ProfilePage/Person JSON-LD. Request indexing for a few representative profiles; sitemap discovery handles the rest. Google's Indexing API is not for ordinary profile pages.
5. Track Page indexing, Sitemaps and Performance for `/app/p/` URLs. Compare name queries over time. Good complete profiles, accurate names and genuine links to member pages help; neither immediate inclusion nor top ranking can be guaranteed.

No marketing repository or Search Console property was edited as part of these source changes.

## Verification

```sh
npm ci --no-audit --no-fund
npm --prefix mobile ci --no-audit --no-fund
npm run test:seo
npm --prefix mobile run typecheck
npm --prefix mobile run build:web
npm run test:web-paths
```

Tests use fake Firestore responses (no production reads/writes) and cover public content/metadata, escaping, privacy changes and stale index rows, pagination, sitemap shards, invalid IDs, HEAD/method errors, outage behavior, route precedence, canonical sharing, and service-worker isolation. Web export checks root and prefix-stripped asset resolution.

After deployment, verify actual HTTP responses at:

- `/app/builders`: HTML directory with real public member links
- `/app/p/{real-public-uid}`: HTTP 200 with the person's name already in response HTML
- `/app/p/{nonexistent-uid}`: HTTP 404, not a 200 app shell
- `/app/sitemap.xml`: application/xml and sitemapindex, not SPA HTML
- `/app/sitemap-profiles-0.xml`: application/xml with eligible canonical URLs
- Existing `/app/landing`, `/app/login`, authenticated app profiles and APIs still work

Also verify the corresponding root aliases on `https://linkup-muqu.vercel.app` because the marketing proxy strips `/app` once. All profile HTML canonicals must still point at the custom domain, never the Vercel origin.

### Scaling note

Profile and directory requests intentionally do not use shared caches so visibility changes apply immediately at origin. Sitemap generation performs authoritative source checks too; each 1,000-candidate shard uses discovery reads plus source-document reads. Shards currently use bounded page sizes with Firestore offsets (skipped rows incur reads). At large membership counts, replace offsets with stored cursor manifests or server-generated sitemap files plus a privacy-aware invalidation system. Do not silently truncate to the first 1,000 members or weaken privacy checks to save reads.
