# Free unlimited testing with the Firebase emulators ($0 quota burn)

The Firebase emulators run a **fake Firebase on your own PC**: sign-in,
Firestore, everything the app needs for profiles, banners, groups and
discovery. Testing against it costs **$0 and burns zero production quota** —
ideal when the free tier is exhausted or you just don't want to pay while
building.

Production stays untouched: the app only uses the emulators when
`EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` is set in `mobile/.env` (a gitignored
local file), and never in production builds.

## One-time setup (Windows)

1. **Install Java 17+** (the emulators need it). In PowerShell:
   ```powershell
   java -version
   ```
   If Java is missing:
   ```powershell
   winget install -e --id EclipseAdoptium.Temurin.17.JDK
   ```
   Close and reopen the terminal afterwards.
2. **Pull the latest code**: `git pull` on `codex/mobile-port`.

## Every testing session (two terminals)

**Terminal 1 — start the fake Firebase** (from the repo root):

```powershell
npx --yes firebase-tools@13 emulators:start --only auth,firestore
```

First run downloads the emulators (~200 MB, once). Leave it running.
Auth lands on port `9099`, Firestore on `8085`, and a data dashboard on
http://localhost:4000 (open it on the PC to inspect accounts/docs live).

**Terminal 2 — point the app at it:**

1. Find your PC's LAN IP. Easiest: it's the IP Metro already prints, e.g.
   `exp://192.168.43.237:8081` → your IP is `192.168.43.237`.
   (Or run `ipconfig` and read the Wi-Fi/hotspot "IPv4 Address".)
2. Create `mobile/.env` with one line (no quotes, your IP):
   ```sh
   EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=192.168.43.237
   ```
3. Start the app fresh:
   ```powershell
   cd mobile
   npx expo start -c
   ```
4. Scan the QR with Expo Go (phone on the same Wi-Fi/hotspot).
5. When Windows Firewall asks, **allow Java and Node on private networks** —
   otherwise the phone cannot reach the emulators.

You should see in the Metro logs:

```text
[LINKUP] Using local Firebase emulators at 192.168.43.237 (auth :9099, firestore :8085) — $0 quota burn.
```

## Testing checklist (all free)

- **Sign UP (don't sign in):** the emulator starts empty. Create two fresh
  accounts with **email + password** — Google sign-in cannot work offline.
  On one phone, sign out/in to switch between them.
- **Banners:** set a banner on account A, view A's profile from account B —
  it shows via the app's offline-safe path. (The ImageKit CDN upload step
  can't complete offline; layout + visibility test perfectly anyway.)
- **Profiles, groups, discovery, swipes:** all work against the fake backend
  with the repo's real `firestore.rules` enforced.
- **Linky / AI chat:** needs production (it calls the deployed web API), so
  test that sparingly on production after quota resets.

## Keep your fake data between restarts (optional)

```powershell
npx --yes firebase-tools@13 emulators:start --only auth,firestore --import=./emulator-data --export-on-exit=./emulator-data
```

## Back to production

Delete the `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` line from `mobile/.env`
(or delete the file), then `npx expo start -c`.

## Quota tips for the free tier

- Do all heavy/repeat testing on the emulator; touch production only for
  final checks.
- Free quotas reset daily at midnight Pacific (~09:00 Harare).
- The app now caches founder-dashboard counts (5 min) and throttles repeat
  banner lookups (10 min) so normal use sips quota instead of chugging it.
