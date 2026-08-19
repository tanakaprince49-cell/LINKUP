# LINKUP Release Notes

## 12.0.0 (versionCode 12)

**Play Console (paste into "What's new in this release"):**

```
What's new in 12.0.0:

• 👑 LINKUP PLUS members now wear a crown at the top of the app
• 🖼️ No more random placeholder photos — profiles without a picture show clean initials instead
• 📸 Adding a profile picture now works reliably on every device
• 🏆 Builder League & City League now show the SAME standings on every phone
• ✨ Fresh, clearer icons on Explore (Daily 5, Swipe, Today's picks) and a restyled Linky AI chat that matches the app
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
