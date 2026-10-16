# LINKUP at linkupbuild.com/app — deployment handoff

Prepared 16 October 2026. **App-side source changes are prepared locally, not proof of a production deployment.** No domain, DNS, Firebase console, landing-page source or webhook registration was changed by this work.

## Intended architecture

- `https://linkupbuild.com/` retains its existing redirect to `https://www.linkupbuild.com/`.
- `https://www.linkupbuild.com/` remains the marketing landing page.
- The **landing project** proxies `/app` and `/app/:path*` to the existing app origin, **stripping `/app` once**.
- The **app project** remains `https://linkup-muqu.vercel.app`. Its root routes and existing APIs/webhooks remain supported.
- The app also supports `/app/landing` directly on its own Vercel origin. Explicit aliases in the app's Vercel configuration let its `/app`-prefixed built assets load at either address.
- **Do not change Namecheap records, nameservers or root/www domain assignments.** Do not make the landing project use a global `/app` base path.

## What changed in the app repository

1. Expo's supported `experiments.baseUrl` is `/app`. Exported entry scripts, images and lazy chunks are prefix-aware.
2. The app's `vercel.json` and `mobile/vercel.json` include explicit `/app` aliases for assets, PWA files, existing legal/auth helpers and APIs. Unknown app screen paths still use the SPA shell. These rules belong in the **app project**, not the marketing project.
3. `mobile/src/lib/webPaths.ts` detects the browser mount with a segment-boundary check. The original `/landing` stays root-mounted; `/app/landing` is mounted at `/app`. Native defaults remain unchanged.
4. React Navigation uses **`config.path`**, not just URL prefixes, for web history. It also handles the library's empty prefixed-home parsing edge case and keeps the app home at `/app/` inside the PWA scope.
5. Signed-out route guards, public profile detection, logout, error recovery and deployment-refresh checks respect the mount.
6. Linky, news, ranking, AI, PLUS, ImageKit auth and checkout/status requests use the correct application API path. Profile share URLs and browser notification links/icons also respect it.
7. The export injects mount-aware favicon, manifest and touch-icon URLs. The manifest intentionally uses relative `./` values for `start_url` and `scope`. Its `id` is omitted so the browser uses the resolved start URL as its identity. Served at `/app/manifest.webmanifest`, these resolve to `/app/`; served at the old `/manifest.webmanifest`, they resolve to `/`. **Do not use `id: "./"`: manifest IDs resolve against the start URL’s origin, not the manifest directory, and would collapse both installs to `/`.** Chromium’s processed manifest is checked in the browser test. See [manifest ID resolution](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id).
8. The service worker is explicitly registered for the current mount and derives its URLs/cache namespace from `registration.scope`. It does not intercept another path's pages, cache API/auth responses, delete another app's caches, or reuse a marketing tab for an app notification.
9. Exported legal-page cross-links retain their mount.
10. Checkout requests send only the fixed mount name, not an arbitrary return URL. Default success/cancel returns include `/app/` for mounted clients. Explicit server-configured return URLs still take precedence and must be reviewed below.

## Local verification

Run from the repository root:

```sh
npm --prefix mobile ci --no-audit --no-fund
npm --prefix mobile run typecheck
npm --prefix mobile run build:web
npm run test:web-paths
```

The regression suite covers mount boundaries, actual React Navigation route parsing/serialization, logout, share URLs, manifest resolution, worker registration, cache isolation, API/auth bypass, notification targeting, mocked checkout return URLs, and emitted entry/lazy asset resolution through both hosting paths. Export first to run the emitted-asset test; it is explicitly skipped if no export exists.

Optional real Chromium smoke test, from `mobile/`:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
# On Linux, install Playwright's OS dependencies if required:
# npx playwright install-deps chromium
npm run test:web-browser
```

Alternatively set `PLAYWRIGHT_MODULE_PATH` to an existing Playwright installation. Playwright is optional test tooling, not a production dependency.

The smoke test starts temporary local app and marketing-fixture servers and shuts them down afterward. It exercises root and prefix-stripping-proxy access, email-screen navigation and refresh, scoped PWA registration, manifest resolution, POST body/query preservation to a **local API stub**, and marketing homepage/cache isolation. It also checks the bare app entry. External browser requests are blocked; the connectivity probe is fulfilled locally.

**These tests do not perform real Google/email authentication, authenticated database access, actual payments, provider webhooks, an Android build, or a live Vercel deployment.** They do not inspect the private landing project's real UI/source.

Recorded local results: web export and TypeScript checks passed; all 12 regression tests passed; Chromium smoke checks passed for both hosting modes. Production sign-in/payment/deployment checks remain pending.

## Deployment sequence — do not switch the landing CTAs early

### 1. Apply the complete app change set

Apply the supplied patch in `tanakaprince49-cell/LINKUP`, not `Linkup-landing-page`. It was prepared against commit `f241657`. Check for newer/unrelated work before applying; never overwrite it.

```sh
git apply --check /path/to/linkup-app-subpath.patch
git apply /path/to/linkup-app-subpath.patch
```

Or apply the Git-format patch as a commit using `git am` in an appropriate clean branch, instead of `git apply`. Do not use both.

Do not cherry-pick only `app.json`: the matching aliases, runtime paths, auth guards and export/PWA scripts are necessary to preserve the existing root deployment.

Run the checks above. When releasing, follow the owner's branch convention: the same tested changes go to `codex/mobile-port` and `main`, with `codex/mobile-port` checked out. No force pushes.

The existing workflow deploys the app when `codex/mobile-port` is pushed. Wait for a successful deployment and verify actual HTTP content; a local commit is not a deploy.

### 2. Check the app origin before touching the landing CTAs

Verify:

- `https://linkup-muqu.vercel.app/landing`
- `https://linkup-muqu.vercel.app/login` including refresh
- `https://linkup-muqu.vercel.app/app/landing`
- `https://linkup-muqu.vercel.app/app/login` including refresh
- The **actual script URLs from the new HTML**, including `/app/_expo/...`, return JavaScript rather than `index.html`.
- Logos/images and dynamically loaded screens resolve.
- The old API/webhook endpoints have not moved.

Do not call a JavaScript URL successful merely because it returns HTTP 200. Check its content type and body.

### 3. Firebase Authentication setup

In project `linkup-e0906`, check Authentication → Settings → Authorized domains and add, if absent:

- `linkupbuild.com`
- `www.linkupbuild.com`

Keep the existing `linkup-muqu.vercel.app` and Firebase domains. Do not replace the authorized-domain list.

The checked-in Firebase configuration currently uses `linkup-e0906.firebaseapp.com` as `authDomain`; this patch leaves it unchanged. No `/app` path belongs in `authDomain`. Test actual Google popup/redirect behavior, email login and logout on the final domain. If a provider redirect flow needs same-origin Firebase helpers, coordinate only the specific reserved helper paths; do not install broad root proxies or weaken security rules.

### 4. Review checkout return URL overrides

The existing server environment variables `PAYONIFY_SUCCESS_URL` and `PAYONIFY_CANCEL_URL` override dynamic defaults. If they are pinned to the old domain or the marketing root, payments may return to the wrong page/origin despite this patch.

For simultaneous root and `/app` support, unset fixed return overrides if that matches the intended configuration, allowing the request's origin and validated mount to supply the return URL. Confirm the proxy preserves the browser Origin header and confirm actual resulting success/cancel URLs in sandbox first. Do not change payment webhook registrations or API credentials for this migration.

The browser's saved pending reference is origin-specific, so testing a provider return to the correct origin matters. A completed checkout is not proof of fulfillment; existing server verification remains authoritative.

### 5. Have Gemini finish the landing project

Gemini's intended landing-side rules remain:

```json
[
  { "source": "/app", "destination": "https://linkup-muqu.vercel.app/" },
  { "source": "/app/:path*", "destination": "https://linkup-muqu.vercel.app/:path*" },
  { "source": "/(.*)", "destination": "/index.html" }
]
```

Merge these with any other legitimate existing rules. A `public/_redirects` file is a Netlify-style routing file; it is **not** what activates this proxy on Vercel. Verify the deployed `vercel.json` and route precedence.

Use a preview first. Do not change the homepage, root/www domain assignments, Namecheap DNS, or root asset/API routes. Do not move `/assets`, `/_expo` or `/api` wholesale to the app on the marketing domain.

On the real shared domain test:

- `/` and existing marketing pages/assets/forms remain intact.
- `/app`, `/app/landing`, `/app/login` load and refresh.
- Real sign-in/out works without leaving the prefix.
- Public shared-profile links work; authenticated deep links behave correctly.
- Lazy chunks and API requests stay in `/app/`.
- Service-worker scope is `/app/`; `/` is not controlled by it.
- Manifest scope/start URL resolve to `/app/`.
- A sandbox checkout returns to the correct app origin/path and reconciles.

Only after those checks should the existing web-app buttons change to `/app` or `/app/landing`. Preserve Google Play and unrelated external links.

At the read-only live check during preparation, `https://www.linkupbuild.com/app/` still returned the marketing SPA HTML, not the app export. This is an observation at that check, not a claim about a later deployment.

## Rollback

1. Keep or restore marketing CTAs to `https://linkup-muqu.vercel.app/landing`.
2. Revert only the landing proxy additions if necessary, keeping its original routing.
3. Do not alter DNS. The original app origin remains the fallback.
4. If reverting the app patch as well, revert the **whole coordinated change** and redeploy; do not remove the asset aliases while retaining an export built for `/app`.
5. If testing a previously installed `/app` PWA after rollback, remove only that app's `/app/` service-worker registration and scoped cache if necessary. Do not indiscriminately clear the marketing origin's workers, caches or user storage.

## Honest release status

Mark each separately: source prepared → local checks passed → app deployed → Firebase settings checked → landing preview tested → landing deployed → CTAs switched.

GitHub access was not working in this session. A downloadable patch/handoff is provided so it can be applied from an authenticated environment. Do not report the source changes as pushed or live without an actual successful push and deployment.
