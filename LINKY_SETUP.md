# Linky (Phase A) — what shipped and what to switch on

Swiping is gone. The tab where it lived is now **Linky**: intents → hourly
matching with a cited "why" → double opt-in intros → chat. Same Linky is
reachable as a Telegram bot and a WhatsApp bot. PLUS stays $19.99 / month.

## What runs where

| Piece | Where | Notes |
|---|---|---|
| Linky tab (cards, intents, intake composer) | `mobile/src/screens/LinkyHomeScreen.tsx` | Tab `LinkyHome`, deep link `/linky` |
| Preferences + bot linking | `LinkySettingsScreen.tsx` | `/linky/settings` |
| "What Linky knows about you" | `LinkyAuditScreen.tsx` | `/linky/audit`, has **Forget** |
| Existing Linky chat | `LinkyScreen.tsx` (unchanged, reachable via "Ask Linky") | |
| Server logic | `api/_linky.js` | intents, matching, intros, brief, audit, bots |
| Endpoint | `api/linky.js` → `POST /api/linky` | app actions, `?action=cron`, `?channel=telegram|whatsapp` |
| Bot webhooks | `vercel.json` rewrites `/api/telegram`, `/api/whatsapp` → `/api/linky` | one Vercel function (Hobby cap = 12) |
| Hourly pass | `.github/workflows/campaign-expiry.yml` → `functions/linky-cron.mjs` | expires intents/intros, matches ≤ 24 intents/run, sends the daily brief |
| Rules | `firestore.rules` | new notification types; Linky collections locked to clients |

Collections (Admin-SDK only): `intents`, `introSuggestions/{uid}`, `intros`,
`linkyState/{uid}`, `botUsers`, `botLinks`.

Limits: free = 1 open intent, 3 Meets/day, 3 new cards/day; PLUS = 3 intents,
unlimited Meets, 5 cards/day. Inbound cap 5/week (member-adjustable 0–20).
Decline = silent mute both ways. Intents expire after 30 days, intros after 7.

## One-time setup (you)

1. **Deploy rules** (CI still 403s): Firebase console → Firestore → Rules → paste `firestore.rules` → Publish.
2. **Telegram**: BotFather → `/newbot` → copy token → Vercel env `TELEGRAM_BOT_TOKEN` (Production) → redeploy.
   The hourly cron registers the webhook itself (`/api/telegram`). Optional: `EXPO_PUBLIC_LINKY_TELEGRAM_BOT=<botusername>` so the app's "Open Telegram" button deep-links correctly (default `LinkyLinkupBot`).
3. **WhatsApp** (Meta Cloud API): create a Meta app → WhatsApp → get the **Phone number ID** and a permanent **access token**. Vercel env:
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` (any string you invent), optional `WHATSAPP_APP_SECRET`.
   In Meta → Webhooks: callback `https://linkup-muqu.vercel.app/api/whatsapp`, verify token = the string you invented, subscribe to `messages`.
   Optional `EXPO_PUBLIC_LINKY_WHATSAPP_NUMBER=2637xxxxxxxx` for the app's wa.me button.
4. Nothing else: Gemini and the Firebase service account are already in Vercel; the cron authenticates with a Google token from the existing GitHub secret.

## Bot commands

`new <who you need>` · `brief` · `meet 1` / `skip 1` / `save 1` · `accept` / `decline` / `later` · `intents` · `close 1` · `prefs` · `unlink` · `help`.
Linking: app → Linky tab → Preferences & bots → Connect → send the 6-character code to the bot (15-minute validity).

## Verify after deploy

- Web: `linkup-muqu.vercel.app` → bottom tab shows **Linky** (sparkles) where Discover was.
- `POST https://linkup-muqu.vercel.app/api/linky` with a Firebase idToken and `{"action":"home"}` → JSON with `intents`, `cards`, `limits`.
- Actions → "Campaign expiry sweep" run log shows a `Linky hourly matching pass` step with `round 1: active=…`.
- Telegram: message the bot → it asks for a link code.

Native: version 13.5.0 / versionCode 19 — rebuild the APK whenever you like; the web is live now.
