# LINKUP Release Notes

## 13.0.0 (versionCode 13)

**Play Console (paste into "What's new in this release"):**

```
What's new in 13.0.0:

⚡ Massively faster — rebuilt for speed: screens now open near-instantly
🖼 Photos load from a new fast cloud in HD quality
🎨 New themes — pick Full White or OG Yellow (Profile → Appearance)
🏙 City League is now truly local: ranked by Rep in YOUR city & country
🔁 Fresh faces every 24 hours on the Opportunity Radar
🧭 You can always see which screen you're on
🛠 Big stability and crash fixes
```

### Full changelog (internal)

- **League pool no longer firehoses Firestore:** `loadLeaguePool` used to pull up to **300 raw `users` docs (incl. ~900KB base64 photos each)** on every cold app start and re-fetch every 5 minutes — tens of MB and hundreds of MB of live JS strings. Every Firestore listener queued behind it (the "profiles take 5 minutes" symptom) and garbage collection froze navigation (the "black blink between pages" symptom). Now reads the lean `publicProfiles` index, URL-only images, compacted rows, 30-min cache. Standings stay deterministic (same stable doc-ID order on every device).
- **Discover cache cannot freeze startup again:** `writeCachedDiscovery` used to serialise up to 200 profiles *with base64 photos* into one giant AsyncStorage JSON, and `readCachedDiscovery` re-parsed it on the JS main thread at every open. Now the cache keeps text/meta only — photo pixels only ever travel as hosted URLs; profile docs hydrate from Firestore behind the instantly-rendered deck.
- **Inbox/conversation fan-out de-fatted:** every chat row used to fetch the full fat `users/<uid>` doc (with photo) in parallel with the lean index. Now it tries `publicProfiles` first and only touches `users` when the index can't supply a name/avatar — inbox renders from kilobytes instead of megabytes.

## 12.0.0 (versionCode 12)

**Play Console (paste into "What's new in this release"):**

```
What's new in 12.0.0:

• 🐱 New brand! Meet the plug-in cat — LINKUP's new logo on your app icon, splash and web
• ⚡ Smoother startup (no more white flash) and snappier first profile load
• 🎯 Discover: match % now sits next to each name, new card-stack tab icon
• 💬 Chats decluttered — AI intro magic-wand lives in the message box
• 👑 PLUS crown, real social links with brand logos, working profile share links
```

### Full changelog (internal)

- **Pro crown:** `ProCrownBadge` renders for paid PLUS members across the app — tab AppHeader, ScreenHeader screens, Swipe, Feed, Connections, League, Recommended, Viewers, Linky, own profile hero. Gated on `hasPaidLinkupPro` (the tick stays paid-only too).
- **Avatar fallbacks:** every hardcoded Unsplash stock-photo fallback replaced with neutral initial tiles (`ui-avatars`); `defaultAvatar.ts` helper; profile hero shows an initial tile when no pic.
- **Pic uploads:** `imageAssetToDataUri` caps at 235k chars by default so saved photos always pass the 240k display/cache limit — pics no longer "save but vanish". Profile/gallery/onboarding pickers all benefit.
- **Web dialogs:** new `notifyUser` — `Alert.alert` is a silent no-op on react-native-web, now falls back to `window.alert`/`confirm` with 2-button support (Profile, Onboarding, Linky, Trending Builders). Logout & Cancel-PLUS dialogs work on web.
- **League consistency:** shared `leaguePool` loader reads the same Firestore docs in stable order on every device (300-cap); City League + Builder League + dashboard preview all rank that identical pool with deterministic tie-breaks.
- **UI:** distinct Daily 5 (Flame) / Swipe (ArrowLeftRight) / Today's picks (UserCheck) icons; Linky screen re-themed to brand lime + theme-aware colors, verified badge, `Â·` mojibake fixed.
- **Connecting:** connection-note modal rides above the keyboard on web/iOS PWA (visualViewport inset) and Android (KAV height); senders now get a "request sent" confirmation notification; connect-flow success/failure dialogs visible on web.
- **Offline screen:** new flat-illustration cat-yanking-the-cable art + plain "No internet connection" copy.
- **Brand:** hand-drawn geometric "L + rising arrow" SVG mark replaces the AI-looking logo everywhere `BrandMark` renders (landing, auth, verification).
- **Discovery:** Idea Deck is now linked from Explore + Play hub (was orphaned); scroll-mode match percentage pill is big and readable (`72% match`).

### Batch 11–20 fixes (shipped with 12.0.0)

- **Search filters cleaned:** removed the dead free-text Timezone / Experience / Availability filters (they matched fields almost no profile has, so they silently emptied results). Kept the filters that actually work — Location, Skills, Industry (+ quick picks), Looking-for pills, Startup stage, Looking-for-cofounder, Verified only, Recently active, Compatibility slider — and added a **Has photo** toggle. Saved search alerts updated to match.
- **Inbox redesign:** double header removed, proper title row with Pro crown, calmer typography (16px bold names, themed timestamps/previews), dead chevron removed.
- **Privacy:** other people's "last seen" is gone everywhere — chat header only shows ONLINE while they're actually online (and TYPING… while typing); inbox presence line removed. (Hide-online setting still respected.)
- **Connection state on profiles:** viewing someone's profile now shows the real state — Message / Request pending / Answer their request / Request declined — instead of letting you fire a dead second request. Rejections already notify the sender; the alert now uses an X icon.
- **Chat self-heal:** opening a chat whose parent match doc was dropped by an old rules rejection now silently recreates the match shell — no more "no one messages each other" on a real connection.
- **Chat header:** "Safety tools on" clutter removed from the header; the banner keeps the safety line and gains an **Intro** button (same AI intro drafter as the input zap, spinner while thinking).
- **"Your LINKUP link" works:** `/profile/<uid>` links now open for people who aren't signed in — public get on the public profile index (lists stay signed-in), the app keeps a signed-out visitor on the shared page, "Join LINKUP to connect" CTA on the profile + a join button on the unavailable screen, and after login you're dropped on the exact profile you came from. **Requires `firebase deploy --only firestore:rules`.**
- **Onboarding grew up:** new Age (16+) and Country+City steps (saved to the profile + public index), and a one-time end-of-onboarding notice — "finish your profile for accurate matches" with **Finish now** (lands you straight on your profile to keep editing) and **I'll do it later**. Stored flag means it never shows twice; early "Skip extra" routes through it too.
- **Socials with real logos:** optional LinkedIn, GitHub, TikTok, Instagram, X and Website on your profile — brand-true SVG glyphs (lucide ships no brand icons), handle-or-URL input tolerated, tappable chips on every profile view, synced to the public index. **Requires `firebase deploy --only firestore:rules`.**

### Rebrand & stability batch (shipped with 12.0.0)

- **New brand mark — the plug-in cat:** cat plugging the cable back into the socket (= LINKUP connects you) is now the app icon, adaptive icon, splash, favicon, PWA icons, and the login/landing/verification marks. Lime flattened to brand `#FBE618`; adaptive-icon art zoomed out to sit clean inside the Android mask.
- **No more startup blink:** cold start used to flash white while the theme hydrated — `expo-splash-screen` now holds the splash until the theme + auth are ready (8s failsafe), so it loads straight into home.
- **"Looking for" chips fixed:** profile looking-for chips were white-on-white invisible in light mode — now themed like the rest of the card.
- **Favicon refresh:** `?v=cat1` cache-busters + service-worker bump so every device picks up the new cat icon on the web app.
- **Chat declutter:** the always-on "Stay on LINKUP, never send money…" banner is gone; crypto/OTP/off-app scanning still runs silently in the background, plus per-message warnings.
- **AI warm intro = magic wand:** single intro button lives in the message composer with a `WandSparkles` icon (reads "AI write it for me"); drafts into the box so you can edit before sending.
- **Discover (scroll mode):** the match-% pill was hidden behind the back button — it now sits next to the person's name, icon swapped from Zap to a 🎯 Target (fit = bullseye), and Zap is fully purged from Discover. Discover tab icon is now a Layers card-stack.
- **Firestore silence on Android:** forced long-polling on native — kills the `RPC 'Listen' stream transport errored` console spam every ~75s; web keeps fast streams + IndexedDB cache.
- **Cold-start diet:** a fresh install's first profile fetch downloads ~40% fewer (and leaner) docs, so the first deck shows up much faster and afterwards comes from cache.
- **Looking-for visibility:** onboarding choice labels no longer clipped at 2 lines, scroll hint added, fat bottom spacer; idea cards show up to 4 looking-for roles without clipping.

## 11.0.0 (versionCode 11)

**Play Console (paste into "What's new in this release"):**

```
What's new in 11.0.0:

• ⚡ Profiles load way faster — Discover, Messages and analytics now open instantly, with repeat views served from cache
• 🔐 Fixed Google sign-in on Android — the account picker opens properly again
• 🖼️ Fresh LINKUP logo across app icon, splash screen and in-app
• 👋 "Talk to #1" now actually sends a connection request
• 🐛 Stability fixes for the profile editor, Match Insights, Builder League and photo loading
```

### Full changelog (internal)

- **Performance:** persistent Firestore cache on web; cache-first profile views with background refresh; parallel conversation profile reads; compact viewer lookups; one shared discovery feed; smaller list photos (`fe8bef0`, `48168ef`, `92f18ad`)
- **Auth:** fixed native Google sign-in crash caused by synchronous `hasPreviousSignIn()` in google-signin v16 (`3dab343`)
- **Branding:** real LINKUP mark on icon, splash, and in-app logo (`d42a97c`)
- **Connections:** "Talk to #1" sends a real request (`2be8b63`)
- **Stability:** null-profile crash guards (Match Insights, startupStage), profile editor/dashboard fixes, photo restore on Android lists and Discover, Metro stylesheet cleanup, Builder League podium + top-3 notifications
