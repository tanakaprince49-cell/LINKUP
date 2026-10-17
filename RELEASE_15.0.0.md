# LINKUP 15.0.0 — Android release

- App version: **15.0.0** (`mobile/app.json`).
- Android version code: **21** (previously 20).
- Package: `com.tana.linkup`.
- EAS uses the local app version; production auto-increment is disabled.
- Mobile package/lockfile versions are aligned with the app version.

## Google Play “What's new”

Paste `store/google-play/en-US/release-notes.txt` into the English release-notes field. It is below Play's 500-character limit. This file is source copy only; it has not been submitted to Play Console.

## Build with EAS (from the repository root)

```bash
cd mobile
npm ci
npx eas-cli@latest login

# Installable APK for testing/internal sharing (preview environment)
npx eas-cli@latest build --platform android --profile apk

# Release Android App Bundle for Google Play (production environment)
npx eas-cli@latest build --platform android --profile production
```

The existing `apk` profile explicitly builds an APK. The production Android profile uses EAS's default AAB output. These are **cloud builds**; an Android SDK is not required on your computer. EAS will return build/download links. Login requires access to the `talala` Expo account/project, and builds require the appropriate Android signing credentials and environment configuration. Use the existing app's signing key when updating it; do not replace it with a new key casually.

The APK uses the preview environment; the AAB uses production. Test the production build through a Play testing track before rollout. An AAB is not directly installable like an APK.

Before uploading, make sure **21 is higher than every version code already uploaded to Play Console**. If 21 or a higher code has already been used, raise `expo.android.versionCode` in `mobile/app.json` before building. `autoIncrement` is disabled, so future uploads also need an explicit version-code increase.

These commands have been documented, not executed. No signed APK/AAB, store submission, or production-device validation is implied by updating the version and exporting JavaScript.
