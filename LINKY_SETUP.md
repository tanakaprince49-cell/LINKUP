# Linky — what shipped and what to switch on

Swiping is gone. The tab where it lived is now **Linky**: ask who you need →
he answers in the same request with the people on LINKUP he can cite a reason
for (or says plainly that nobody fits yet) → Meet → double opt-in intro → chat.
No intents, no waiting, no hourly matching. Same Linky is reachable as a
Telegram bot and a WhatsApp bot. PLUS stays $19.99 / month.

## What runs where

| Piece | Where | Notes |
|---|---|---|
| Linky tab (ask composer, answer, cards) | `mobile/src/screens/LinkyHomeScreen.tsx` | Tab `LinkyHome`, deep link `/linky` |
| Preferences + bot linking | `LinkySettingsScreen.tsx` | `/linky/settings` |
| "What Linky knows about you" (editable) | `LinkyAuditScreen.tsx` | `/linky/audit`: **Tell Linky more** (notes, extra skills, who you want to meet), profile facts, history, **Forget** |
| Server logic | `api/_linky.js` | `ask`, matching, intros, facts, audit, bots |
| Endpoint | `api/linky.js` → `POST /api/linky` | app actions (`home`, `ask`, `meet`, `card`, `respond`, `prefs`, `facts`, `audit`, `forget`, `linkCode`, `unlinkChannel`), `?action=cron`, `?channel=telegram|whatsapp` |
| Bot webhooks | `vercel.json` rewrites `/api/telegram`, `/api/whatsapp` → `/api/linky` | one Vercel function (Hobby cap = 12) |
| Housekeeping | `.github/workflows/campaign-expiry.yml` → `functions/linky-cron.mjs` | hourly: expires stale intro requests, keeps the Telegram webhook registered. Nothing a member sees waits on it |
| Rules | `firestore.rules` | new notification types; Linky collections locked to clients |

Collections (Admin-SDK only): `introSuggestions/{uid}` (cards), `intros`,
`linkyState/{uid}` (budgets, mutes, prefs, `facts` you told Linky, `lastAsk`,
`askHistory`, channels), `botUsers`, `botLinks`. (`intents` is no longer
written; old docs are inert.)

## How an ask is answered (and why it does not eat Gemini tokens)

1. Parse the message locally (offer, location, keywords). Greetings / nothing
   to search on → coaching reply, **no Gemini, no budget**.
2. Same ask again within 12 h → same answer from cache, **no Gemini, no budget**.
3. Keyword + compatibility scoring over visible `publicProfiles` (+ what each
   member told Linky). Zero candidates → graceful "nobody fits yet" with the
   3 nearest people and how many members were checked, **no Gemini**.
4. Only when ≥ 2 plausible candidates exist: **one** compact Flash-Lite call to
   rerank the shortlist (≤ 8 people) with cite-or-skip. If Gemini fails / is
   over quota / cites nothing, the cited template path answers instead — never
   an error.

Limits: free = 10 asks/day, 3 Meets/day; PLUS = 60 asks/day, unlimited Meets.
Up to 5 cards per ask. Inbound cap 5/week (member-adjustable 0–20). Decline =
silent mute both ways; skipped people stay away for 14 days. Intros expire
after 7 days.

## One-time setup (you)

1. **Deploy rules** (CI still 403s): Firebase console → Firestore → Rules → paste `firestore.rules` → Publish.
2. **Telegram**: BotFather → `/newbot` → copy token → Vercel env `TELEGRAM_BOT_TOKEN` (Production) → redeploy.
   The hourly housekeeping registers the webhook itself (`/api/telegram`). Optional: `EXPO_PUBLIC_LINKY_TELEGRAM_BOT=<botusername>` so the app's "Open Telegram" button deep-links correctly (default `LinkyLinkupBot`).
3. **WhatsApp** (Meta Cloud API): create a Meta app → WhatsApp → get the **Phone number ID** and a permanent **access token**. Vercel env:
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` (any string you invent), optional `WHATSAPP_APP_SECRET`.
   In Meta → Webhooks: callback `https://linkup-muqu.vercel.app/api/whatsapp`, verify token = the string you invented, subscribe to `messages`.
   Optional `EXPO_PUBLIC_LINKY_WHATSAPP_NUMBER=2637xxxxxxxx` for the app's wa.me button.
4. Nothing else: Gemini and the Firebase service account are already in Vercel; housekeeping authenticates with a Google token from the existing GitHub secret.

## Bot commands

Just type who you need (e.g. `a Flutter developer in Harare, paid`) → answered inline with numbered cards.
`cards` · `meet 1` / `skip 1` / `save 1` · `accept` / `decline` / `later` · `prefs` · `unlink` · `help`.
Linking: app → Linky tab → Preferences & bots → Connect → send the 6-character code to the bot (15-minute validity).

## Verify after deploy

- Web: `linkup-muqu.vercel.app` → bottom tab shows **Linky** (handshake icon) where Discover was; Explore page has no Linky card/button.
- `POST https://linkup-muqu.vercel.app/api/linky` with a Firebase idToken and `{"action":"ask","message":"a Flutter developer in Harare"}` → JSON with `reply`, `cards`, `asksLeft` in one round trip.
- Same call with a nonsense ask → `none: true`, `nearest: [...]`, HTTP 200.
- `{"action":"facts","notes":"…","skills":["…"],"lookingFor":["…"]}` → `{ok:true}`; `{"action":"audit"}` shows it under `told`.
- Actions → "Campaign expiry sweep" run log shows a `Linky housekeeping` step with `housekeeping: pendingIntros=…`.
- Telegram: message the bot → it asks for a link code.

Native: version 13.5.0 / versionCode 19 — rebuild the APK whenever you like; the web is live now.
