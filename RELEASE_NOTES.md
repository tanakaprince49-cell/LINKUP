# LINKUP Release Notes

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
