# LINKUP

LINKUP is an Expo React Native app for mobile and web. The production web deploy now serves the same Expo app from `mobile/`, so Vercel shows the same experience as the mobile build.

## Local Development

```bash
cd mobile
npm install
npm run web
```

## Production Web Build

```bash
cd mobile
npm run build:web
```

The static Expo web output is generated at `mobile/dist`.

## Vercel

This repo includes `vercel.json`, so Vercel deploys the Expo web build automatically:

- Install command: `cd mobile && npm ci`
- Build command: `cd mobile && npm run build:web`
- Output directory: `mobile/dist`
- Web analytics: `@vercel/analytics/react` is loaded only on Expo Web.
- PWA install: the web build injects `manifest.webmanifest` and `service-worker.js` after export.
- Web notifications: browser notifications mirror in-app notifications while the web/PWA app is running.

Set this environment variable in Vercel before launching:

- `EXPO_PUBLIC_GEMINI_API_KEY`
