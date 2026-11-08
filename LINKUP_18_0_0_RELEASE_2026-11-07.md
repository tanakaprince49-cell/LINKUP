# LINKUP 18.0.0 — release notes and build

**Version:** `18.0.0` · **Android versionCode:** `47` (was 46) · **Package:** `com.tana.linkup`
**Date:** 2026-11-07 · **Branch:** `codex/mobile-port` (mirrored to `main`)

Everything in this release is behind the existing app; no new native modules, no
new permissions, no Play Console product changes. That means it can go out as a
normal update — the review should be short.

---

## What changed

### 1. The paywall now lists every paid feature, with the numbers

`shared/plus-perks.js` is the single source of truth: **10 perks**, each with the
free number and the PLUS number side by side, and every one traceable to a gate
that exists in code.

| # | Perk | Free | PLUS |
|---|------|------|------|
| 1 | Talk to Linky without counting | 4 messages a day | No limit |
| 2 | Ask to meet as many builders as you find | 2 Meet requests a day | No limit |
| 3 | Linky writes your profile for you | You write all of it | Linky writes it, you approve |
| 4 | Unlimited AI warm intros | 1 a month | No limit |
| 5 | See exactly who opened your profile | The number only | Names, photos, what they did |
| 6 | Every weekly recommendation | 3 a week | The whole ranked pool |
| 7 | Post as often as you ship | 1 startup a week | 10 a week |
| 8 | Turbo Connect | Standard ranking | +8 boost in Discover/search |
| 9 | No sponsored cards anywhere | 1 per 4 organic | None |
| 10 | Verified tick + PLUS crown | Hidden | Beside your name |

The paywall renders it as a value stack — the loss in numbers on the left, what
they get on the right — plus a **personalised headline** ("Tariro, this is
everything LINKUP can do"), their project and empty seat named in the second
line, and a "what you hit today" strip that restates their own limits. The
invite, the email and the release notes read from the same file, so no surface
can drift.

Two lines were removed for being untrue: *unlimited saved profiles* (nothing
caps saves) and *the PLUS themes* (the app colour picker has no tier check).

### 2. Linky stops at 4 messages a day, then the paywall

`shared/linky-budget.js`: `freePerDay` 5 → **4** (per UTC day, resets at
midnight UTC). The fifth message raises `ask_limit`, and the Linky screen opens
the paywall on that error. PLUS stays uncapped — `LINKY_PLUS_DAILY` is still
ignored on purpose so an env var can never re-cap an "unlimited" plan.

### 3. NEW — Linky writes your profile (PLUS only)

- **Server:** `api/_profileWriter.js` + `POST /api/linky {action:'writeProfile'}`.
  Gate is `isPlusUser` on the server → **402** for anyone who is not PLUS.
- **What it does:** takes the facts the member already gave LINKUP — what they
  are building, the one-liner, the empty seat, skills, stage, city, goals, their
  own bio — and writes a headline, a bio, a skills line and the roles they need.
  The prompt says *invent nothing*: a missing fact is left missing, never guessed.
- **Approval first:** the draft comes back to the app, the member reads it, and
  only then is it saved — sending the approved draft back, so what is saved is
  exactly the words they read (no second, unseen generation).
- **Blast radius:** the save writes `headline`, `bio`, `skills`,
  `lookingFor`, `profileWrittenByLinkyAt`, merge-only. Tier, matches, streak,
  settings and verification are untouched by construction.
- **Where:** Profile → Edit → "Let Linky write it" (`LinkyWritesProfile`).

### 4. Linky already knows the member — and may not ask again

`profileFacts` now carries `building`, `buildingOneLiner`, `seat` and `stage`,
and every member-facing prompt carries a new hard rule (`LINKY_KNOWS_PROFILE`):
never ask what they are building, what they do, what they need or where they are
if it is already in the dossier. Only a genuinely empty field may be asked
about, one question, in their words.

### 5. The ask at the top of home

A gold bar above the greeting: **UPGRADE TO LINKUP PLUS · 10 things you are not
getting yet · from $19.99/mo**, tapping opens the paywall. Never rendered for a
member who already pays.

### 6. Tap to reveal your founder — animated

The weekly wait still runs its four beats, then hands the moment to the member:
an ink-on-gold **TAP TO REVEAL YOUR FOUNDER** pill, and it is alive:

- it breathes, 1 → 1.045 → 1, every 1.24s;
- two ink rings leave the pill half a beat apart, walk out to 1.85× and die;
- a soft band of light crosses the pill every two seconds (an SVG gradient, so
  both edges of the glint fall off — no grey slab);
- the arrow bobs 3px on the same beat.

Tapping sets off a 220ms flare (scale 1 → 1.5, opacity .5 → 0) and the screen
leaves on the tail of it, so the founder arrives out of the member's own thumb
rather than replacing it. If they do nothing, the reveal happens on its own at
12s, so nobody is stuck. Everything runs on the native driver; reduced motion
gets a still button that still reveals on tap.

### 7. Matching is provably equal

Both people are written in **one Firestore transaction** — `{uidA, partnerUidB}`,
`{uidB, partnerUidA}`, same `pairId`, same `pairDocId`, same week — so a pair
cannot exist for one side and not the other. When each reads it, the payload
swaps the sides (`myOffers` ↔ `partnerOffers`, `profileA`/`profileB` by `isA`)
and gives each their own "why". If Prince is your 1-of-1 this week, you are his,
and he is looking at your real profile while you look at his.

`symmetryVerified` used to be a hardcoded `true`; it is now **read off the
stored record** — both profiles, both offer ledgers, both cards, and a partner
uid that is not your own — so an older, half-written pair reports `false`
instead of pretending. The test asserts the flag is no longer stamped on, and
that both sides resolve the same pair id, week, names and mirrored ledgers.

### 8. The home page is the phone

Carried over from the previous commit: no gutter, no nested card shells, no
dividers. 390pt screen → 354pt text column (was 246pt).

---

## Verification before this build

```
node --test tests/*.mjs                     → 405/405 pass
npm --prefix mobile run typecheck           → clean
npm run test:firestore                      → 94/96 (2 known-flaky transaction tests)
```

Release-specific tests:
`tests/plus-perks-and-writer.test.mjs` (15), `tests/plus-invite.test.mjs` (8),
`tests/weekly-wait-and-leaving.test.mjs` (8, now also pinning the halos, the
gradient glint, the tap flare and the reduced-motion guard), `tests/linky-usage.test.mjs` (18),
`tests/home-fullbleed.test.mjs` (7).

---

## Build commands

Run from `mobile/`. Log in once with `npx eas login` (Expo account that owns the
project), and make sure `google-services.json` is present (it is committed).

### A. Android App Bundle for Play Store (production)

```bash
cd mobile
npx eas build --platform android --profile production
```

`eas.json → production` has `autoIncrement: false`, so the version comes from
`app.json` (`18.0.0` / `versionCode 47`). The AAB is uploaded as a build
artifact; download it from the link EAS prints, or:

```bash
npx eas build:list --platform android --limit 1
```

### B. APK for testers (internal distribution)

```bash
cd mobile
npx eas build --platform android --profile apk
```

`apk` profile = `buildType: apk`, internal distribution, same JS bundle.

### C. Local build, no EAS queue (needs Android SDK + JDK 17)

This repo does **not** commit `mobile/android/` — it is generated, so the first
command below is required (and re-run it after any `app.json` or asset change,
because `versionCode` and the launcher icons are baked into the generated
project).

```bash
cd mobile
npx expo prebuild --platform android --clean
cd android
./gradlew clean
./gradlew bundleRelease     # → app/build/outputs/bundle/release/app-release.aab
./gradlew assembleRelease   # → app/build/outputs/apk/release/app-release.apk
```

If the keystore is not the EAS-managed one, put the release signing config in
`android/app/build.gradle` (or re-use the `keystore.properties` pattern) before
`bundleRelease`, and keep `mapping.txt` — the `production` profile already
collects it.

### D. Upload to Play

```bash
cd mobile
npx eas submit --platform android --profile production
```

Manual alternative: Play Console → LINKUP → Testing → Internal testing → create
release → upload the `.aab` → release notes below.

---

## Release notes (paste into Play Console — max 500 characters)

```
18.0.0

• Linky now writes your profile for you (PLUS) — you approve every word before it is saved
• Linky already knows what you're building, so it stops asking
• Clearer PLUS: every paid feature listed with what free gets and what PLUS gets
• A gold upgrade button at the top of home
• Tap to reveal your weekly co-founder — the reveal is yours now
• The whole home page uses the full width of your phone
• Linky free messages: 4 a day
```

---

## What is NOT in this build

- **Nothing is deployed to Play until the AAB above is uploaded.** The web app
  (`www.linkupbuild.com/app`) deploys on push to `main` via Vercel.
- The `sitemap.xml` / `publicSeo` 503 that reddens step 10 of the Deploy Expo Web
  workflow is pre-existing and unrelated to this release.
- Store listing text (title, short description, full description) is unchanged;
  if the Play listing should mention the new PLUS writer, that is a separate
  change to `store/google-play/en-US/*.txt`.
