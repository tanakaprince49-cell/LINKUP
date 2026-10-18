# Public profile titles and photos

## Requested output

A person's public profile title is their **name only**. Do not append their role or `| LINKUP` to that title. The platform remains the hosting website, not an implied employer. Company and role are separately labelled on the page and in the description. Person `worksFor` is emitted only for an explicitly supplied company; a company is never invented from the platform name, nickname or bio.

For the reported Rudra example, the current public source supplies the name and Founder role, but no company field. The renderer must not invent TIBER as an employer from the nickname. Google may still display a website/site-name label or rewrite a title; changing source metadata cannot force a particular search-result layout or immediate recrawl.

## Photo implementation

- The current selected `profilePic` takes priority, then hosted/provider aliases. Existing valid hosted photos remain hosted photos.
- Public profile HTML includes the actual image, descriptive alt text, and eager priority on the primary photo.
- Person image and ProfilePage primaryImageOfPage use ImageObject metadata. Open Graph, Twitter and image_src metadata identify the same photo. The builder directory shows member photos, and profile sitemap entries include image locations.
- A missing photo does not produce an app-logo image pretending to be the person's photo. No fake profile photo is generated.
- Legacy inline PNG/JPEG/GIF/WebP photos get a stable HTTPS URL through the existing `publicSeo` function's `mode=image`. No new serverless function is required. The handler re-reads the current source account and visibility on every request, returns no-store responses, and only serves bounded base64 raster data with matching file signatures. SVG/HTML, malformed encodings and oversized payloads are rejected.
- The image route redirects already-hosted photos without fetching any remote URL. It is not an arbitrary image proxy or an SSRF fetch surface. Hidden/deleted/stealth/unfinished/synthetic profiles return noindex 404s, including for formerly known image URLs. Third-party caches and already-public CDN images remain outside LINKUP's control.

## Hosted-avatar persistence

The existing background uploader attempted to save `profilePicUrl`, but the owner-update rules did not allow that field. Added narrowly bounded owner support for the HTTPS alias. The client awaits persistence of the hosted URL before applying the hosted value locally and syncing the public index; failed URL writes are no longer silently treated as successful. Selecting a new image clears the old hosted alias so a failed CDN upload cannot keep advertising the previous photo. Avatar selections are serialized while hosting finishes, draft state is advanced only when it still refers to that selection, and new CDN uploads use unique URLs rather than overwriting cached files. The previously saved selected image remains available through the legacy image route if hosting is unavailable. Paid/admin/verification protections and the profile-save expression-budget fix remain intact.

## Validation and rollout

- SEO tests cover name-only titles, separate company/role, no invented employer, image metadata and sitemaps, hosted-photo redirects, valid legacy image GET/HEAD, unsupported/unsafe data, visibility changes and missing photos.
- Emulator coverage adds successful owner avatar persistence plus rejection of oversized, non-HTTPS, malformed and cross-owner writes, alongside all existing profile-save and authority tests.
- Check the web deployment **and** Firestore rules workflows after pushing both release branches. The SEO fixes and legacy photo support are server-side; the updated native uploader requires a rebuilt native client. No signed APK/AAB or Play release is created by this change.

Google chooses indexing, title rewrites, thumbnail display and ranking. After deployment, request recrawling of representative public profiles and the profile sitemap through the owner's verified Search Console property if available. Do not promise instant updates, photos for accounts without a real photo, or ranking gains.

## Local release check — 18 October 2026

- 142/142 standard tests passed, no skips, after production web export.
- 12/12 real Firestore Emulator tests passed, including existing authority and expression-budget regressions.
- TypeScript typecheck and production Expo web export passed; `git diff --check` clean.
- Rudra's existing hosted avatar was HTTP HEAD-verified: 200, image/jpeg, 17,995 bytes. This verifies the source image, not Google's thumbnail choice.
- Deployment is **pending**, not verified: the session has no authenticated Git credentials and the dry-run push failed with an unavailable GitHub username. No claim of live metadata or rules changes is made. Restore authorized Git access, push HEAD to both `codex/mobile-port` and `main`, keep `codex/mobile-port` checked out, then monitor the exact-SHA web and rules workflows and verify production profile, image route and sitemap responses.
