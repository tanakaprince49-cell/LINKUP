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
