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
   member told Linky). Plurals/verb forms are stemmed ("developers" → "developer").
4. Nobody word-for-word → built-in related concepts (`CONCEPTS` in `api/_linky.js`:
   "math" → statistics / data / analyst / accountant …), **no Gemini**. Cards say
   `(close to "math")` and cite the real profile fact.
5. Still nobody → **one** tiny Gemini term-expansion (≤160 output tokens), cached
   in `linkyCache/x_*` for 30 days **across all members** (a given ask costs at
   most one call, ever). If that ran, the rerank below is skipped.
6. Still nobody → graceful "nobody fits yet" with the 3 nearest people (own city
   first), how many members were checked, and a **"Where to look outside LINKUP"**
   button (bot: `more`) → one small Gemini call, cached 7 days per ask, static
   text without a key. Only for asks the member actually made.
7. Otherwise, only when ≥ 2 plausible candidates exist: **one** compact
   Flash-Lite rerank of the shortlist (≤ 8 people) with cite-or-skip. If Gemini
   fails / is over quota / cites nothing, the cited template path answers
   instead — never an error.

Limits: free = 10 asks/day, 3 Meets/day; PLUS = 60 asks/day, unlimited Meets.
Up to 5 cards per ask. Inbound cap 5/week (member-adjustable 0–20). Decline =
silent mute both ways; skipped people stay away for 14 days. Intros expire
after 7 days.

## One-time setup (you)

1. **Deploy rules** (CI still 403s): Firebase console → Firestore → Rules → paste `firestore.rules` → Publish.
2. **Telegram** (DONE for @LINKUP_AIBOT, display name "LinkyLinkupBot"): token is in Vercel env `TELEGRAM_BOT_TOKEN`; webhook registered at `/api/telegram` with the token-derived secret; commands + description set via the Bot API.
   The hourly housekeeping re-registers the webhook if it ever changes. Optional: `EXPO_PUBLIC_LINKY_TELEGRAM_BOT=<botusername>` so the app's "Open Telegram" button deep-links correctly (default `LINKUP_AIBOT` — the username BotFather actually gave the bot; its display name is "LinkyLinkupBot").
3. **WhatsApp** (Meta Cloud API): create a Meta app → WhatsApp → get the **Phone number ID** and a permanent **access token**. Vercel env:
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` (any string you invent), optional `WHATSAPP_APP_SECRET`.
   In Meta → Webhooks: callback `https://linkup-muqu.vercel.app/api/whatsapp`, verify token = the string you invented, subscribe to `messages`.
   Optional `EXPO_PUBLIC_LINKY_WHATSAPP_NUMBER=2637xxxxxxxx` for the app's wa.me button.
4. Nothing else: Gemini and the Firebase service account are already in Vercel; housekeeping authenticates with a Google token from the existing GitHub secret.

## Bot commands

Just type who you need (e.g. `a Flutter developer in Harare, paid`) → answered inline with numbered cards.
`cards` · `meet 1` / `skip 1` / `save 1` · `accept` / `decline` / `later` · `more` (outside-LINKUP pointers after a no-match) · `prefs` · `unlink` · `help`.
Linking: app → Linky tab → Preferences & bots → Connect → send the 6-character code to the bot (15-minute validity).

## Verify after deploy

- Web: `linkup-muqu.vercel.app` → bottom tab shows **Linky** (handshake icon) where Discover was; Explore page has no Linky card/button.
- `POST https://linkup-muqu.vercel.app/api/linky` with a Firebase idToken and `{"action":"ask","message":"a Flutter developer in Harare"}` → JSON with `reply`, `cards`, `asksLeft` in one round trip.
- Same call with a nonsense ask → `none: true`, `nearest: [...]`, HTTP 200.
- `{"action":"facts","notes":"…","skills":["…"],"lookingFor":["…"]}` → `{ok:true}`; `{"action":"audit"}` shows it under `told`.
- Actions → "Campaign expiry sweep" run log shows a `Linky housekeeping` step with `housekeeping: pendingIntros=…`.
- Telegram: message the bot → it asks for a link code.

Native: version 13.5.0 / versionCode 19 — rebuild the APK whenever you like; the web is live now.


## Personality + names (task 24)

Linky answers in character without a model call and without spending an ask for:
greetings, thanks, "who are you", "what can you do", "ok", "bye", banter (`smallTalk` in `api/_linky.js`).
A person by name ("fred", "Luke Tembani", "send a message to fred", "who is @handle", surname alone)
resolves against visible members (`nameMatches`) and returns that person's card with a human reply.
If the member is hidden from you, Linky says exactly why (you skipped them / they declined / intro inbox
full / not open to paid...) and offers `unskip <name>`. No-match replies rotate (4 variants) and only list
"nearest" people when the ask names a city we have members in.

## Outside search (SerpApi) - `api/_scout.js`

* Env: `SERPAPI_KEY` on Vercel. The GitHub Action syncs it from the GitHub secret `SERPAPI_KEY` on every deploy.
  Missing key -> Linky says outside search is off; nothing breaks.
* App: after a no-match, "Search outside LINKUP" (action `scout`). Bot: `outside` (or `outside <ask>`).
* Every call: `engine=google`, `num=100`, strict operators, e.g.
  `site:linkedin.com/in ("Founder") AND "Fintech" "Zimbabwe"` (built deterministically by `buildQuery`).
  Note: since Sept 2025 Google ignores `num` and returns 10 organic rows per call; we still send `num=100`.
* Raw organic results are stored once in `linkyScout/{sha1(query)}` for 30 days and shared by all members;
  evaluation happens in memory on title + snippet. Never a per-person lookup.
* Regex pre-filter first (core topic words / role words / place), then at most ONE Gemini call over <= 20
  rows returning `{"picks":[{"i":n,"fit":true}]}`. No key or failure -> keyword ranking only.
* Budget: `linkyMeta/serpapi` monthly counter capped at 200 (free tier is 250) + 4 fresh searches per member
  per day; both fail soft with a plain message. Cached answers never count.
* Results are external cards (name, headline, LinkedIn URL, Google snippet, "Copy first line", "Open profile").
  No Meet: they are not members.
