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
| Server logic | `api/_linky.js` | `ask`, name lookup, matching, intros, facts, audit, bots |
| Outside-LINKUP outreach | `api/_serpapi.js` | one SerpApi search per ask, local prefilter, batched Gemini scoring, credit ledger |
| Linky chat screen | `LinkyHomeScreen.tsx` | the tab is a chat: bubbles, typing indicator, tappable suggestions, leads box |
| Endpoint | `api/linky.js` → `POST /api/linky` | app actions (`home`, `ask`, `pointers`, `pickPerson`, `meet`, `card`, `respond`, `prefs`, `facts`, `audit`, `forget`, `linkCode`, `unlinkChannel`, `limits`), `?action=cron`, `?channel=telegram|whatsapp` |
| Bot webhooks | `vercel.json` rewrites `/api/telegram`, `/api/whatsapp` → `/api/linky` | one Vercel function (Hobby cap = 12) |
| Housekeeping | `.github/workflows/campaign-expiry.yml` → `functions/linky-cron.mjs` | hourly: expires stale intro requests, keeps the Telegram webhook registered. Nothing a member sees waits on it |
| Rules | `firestore.rules` | new notification types; Linky collections locked to clients |

Collections (Admin-SDK only): `introSuggestions/{uid}` (cards), `intros`,
`linkyState/{uid}` (budgets, mutes, prefs, `facts` you told Linky, `lastAsk`,
`askHistory`, `chat` thread, channels), `botUsers`, `botLinks`,
`linkyCache/{x|p|v}_*` (term expansion, pointers, wording - all TTL'd),
`linkyOutreach/*` (monthly credit ledger, per-run raw SERP payloads, per-need cache). (`intents` is no longer
written; old docs are inert.)

## How an ask is answered (and why it does not eat Gemini tokens)

1. Parse the message locally (offer, location, keywords, **person names**). Greetings
   / nothing to search on → coaching reply, **no Gemini, no budget**.
2. "fred", "is fred on LINKUP", "send a message to fred" → a **name lookup**, free,
   run *before* the budget check so a member out of asks can still find a human.
   Two people tie → Linky asks which one; blocked / already connected / muted → the
   blocker is named instead of a fake intro.
3. Same ask again within 12 h → same answer from cache, **no Gemini, no budget**.
4. Keyword + compatibility scoring over visible `publicProfiles` (+ what each
   member told Linky). Plurals/verb forms are stemmed ("developers" → "developer").
5. Nobody word-for-word → built-in related concepts (`CONCEPTS` in `api/_linky.js`:
   "math" → statistics / data / analyst / accountant …), **no Gemini**. Cards say
   `(close to "math")` and cite the real profile fact.
6. Still nobody → **one** tiny Gemini term-expansion (≤160 output tokens), cached
   in `linkyCache/x_*` for 30 days **across all members** (a given ask costs at
   most one call, ever). If that ran, the rerank below is skipped.
7. Still nobody → graceful "nobody fits yet" with the 3 nearest people (own city
   first), how many members were checked, and a **"Where to look outside LINKUP"**
   button (bot: `more`) → one small Gemini call, cached 7 days per ask, static
   text without a key. Only for asks the member actually made.
8. **Every reply a member reads is written by Gemini** (`linkySay`), in Linky's
   voice, with the answer's facts handed over as a dossier; the model returns
   `{reply, suggest}` only. Gemini missing / failing / returning junk → a
   deterministic plain reply on the same facts, so nobody ever sees an AI error.
   `aiText()` (`api/_gemini.js`) tries Gemini first and re-sends the same prompt to
   OpenCode Zen (`ZEN_API_KEY`) when Gemini errors, is over quota or times out; the
   wording cache is shared across providers, so a rescue costs nothing the second time.
   Hand-written tone templates were deleted on purpose: three surfaces must not
   drift, and this is text-only - no voice anywhere in the product.
9. Otherwise, only when ≥ 2 plausible candidates exist: **one** compact
   Flash-Lite rerank of the shortlist (≤ 8 people) with cite-or-skip. If Gemini
   fails / is over quota / cites nothing, the cited template path answers
   instead — never an error.

Limits: free = **2 searches/day and 2 Meets/day**; PLUS = 60 searches/day, unlimited
Meets. "Searches" is the metered thing - asking Linky to look through the network.
A lookup by name, small talk, "write me a message", hiding a fact and the whole
help flow answer before the counter, so the 2 a day are never spent on "hi".
One counter, not three: the app, the Telegram bot and WhatsApp all call the same
`ask()`, so 2 on one surface is 2 everywhere.
Up to 5 cards per ask. Inbound cap 5/week (member-adjustable 0–20). Decline =
silent mute both ways; skipped people stay away for 14 days. Intros expire
after 7 days.

## Outside LINKUP: the outreach pipeline (`api/_serpapi.js`)

When nobody on LINKUP fits, Linky may look at the open web. Hard constraint: the
SerpApi **free plan is 250 searches a month for the whole product**, so:

1. **One search per ask, `num=100` + strict operators** in `q`:
   `site:linkedin.com/in ("developer" OR "software engineer") "flutter developer" "Harare"`.
   Free plan = 1 page per run, PLUS = 2 - and **only ever `site:linkedin.com/in`**:
   `serpSearch()` refuses a query that does not carry that operator
   (`{error:'not-linkedin'}`), so no credit can be spent on a general web search. `num=100` is sent because the extraction
   rule demands it, **but the account only returns ~10 results per credit**, so all
   budget maths is done at 10/page (`start=` paging only inside the remaining budget).
2. **Prefilter locally, before any token.** Title + snippet are matched on hardcoded
   string/regex rules (drop news / pricing / login / company pages, require a
   person-shaped title, require a needle from the ask). Whatever survives goes to
   Gemini **10–20 at a time in ONE batch call**, which returns strict JSON
   `{keep:[{i,fit,why}]}` - never one call per profile, never prose.
3. **Search and enrichment are decoupled.** Organic results are written to
   `linkyOutreach/run_<uid>_<ts>` as soon as they arrive, and every judgement after
   that is made from that saved array. **There is no second SerpApi call per
   person.** The only extra HTTP is the free `google.com/goto` 302 hop, which turns
   a wrapped result link back into a real profile URL (0 credits; if it fails the
   lead is flagged `resolved: false` and shown as a search link, never a fake URL).
   Deep data (verified email, contact) is a *separate* tool fed the finalised URLs -
   nothing here auto-messages anyone, and nothing outside LINKUP is ever imported
   as a member or sent an intro.

Guardrails: `linkyOutreach/budget_<YYYY-MM>` counts searches for the whole product
(and a rolling hour cap), and `linkyOutreach/day_<uid>_<YYYY-MM-DD>` caps one member
at 4 searches/day so a single keen brainstorm cannot empty the month; `/account.json` is read (5-min cache) and treated as truth - if
`total_searches_left` is at or under `OUTREACH_RESERVE_CREDITS`, the pipeline
refuses to spend and `pointers()` degrades to advice-only prose. Same query within
7 days is served from `linkyOutreach/q_*` at 0 credits.

**What the member can edit:** the "What Linky knows about you" screen
(`LinkyAuditScreen`) writes `linkyState/{uid}.facts`. Tapping any fact hides it from
Linky (`hideFact`) - the LINKUP profile keeps it, but the matcher and the "why"
never see it again, in any of its forms ("beekeeping" also hides "Beekeeper").
Giving it back is the same tap. A single past ask can be deleted (`removeAsk`),
which also lifts it out of the chat thread. Hiding or restoring busts that member's
answer cache so the next ask is re-run, not replayed.

**Vercel env for this:** `SERPAPI_KEY` (absent = the whole feature quietly stays
advice-only, which is the safe default) and `OUTREACH_RESERVE_CREDITS` (default
`40` - the floor of credits you never touch, raise it in a lean month, no deploy
needed). Both are documented in `.env.example`; the key must never be committed.
`.github/workflows/vercel-production.yml` copies `SERPAPI_KEY` from the GitHub
secret into Vercel production on deploy when the secret exists, so a key rotation
is one `gh secret set SERPAPI_KEY`.

This file **replaces** the earlier `api/_scout.js` prototype (same job, its own
`linkyScout` cache and 200/month cap). Two search callers on one 250-credit plan
would spend it twice as fast, so `_scout.js` and `linkyScout` are gone; the
captured live response it tested against is kept at
`functions/tests/fixtures/serpapi-fintech-zw.json` and both the prefilter and the
link-unwrapping are asserted against it.

## One-time setup (you)

1. **Deploy rules** (CI still 403s): Firebase console → Firestore → Rules → paste `firestore.rules` → Publish.
2. **Telegram** (DONE for @LINKUP_AIBOT, display name "LinkyLinkupBot"): token is in Vercel env `TELEGRAM_BOT_TOKEN`; webhook registered at `/api/telegram` with the token-derived secret; commands + description set via the Bot API.
   The hourly housekeeping re-registers the webhook if it ever changes. Optional: `EXPO_PUBLIC_LINKY_TELEGRAM_BOT=<botusername>` so the app's "Open Telegram" button deep-links correctly (default `LINKUP_AIBOT` — the username BotFather actually gave the bot; its display name is "LinkyLinkupBot").
3. **WhatsApp** (Meta Cloud API): create a Meta app → WhatsApp → get the **Phone number ID** and a permanent **access token**. Vercel env:
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` (any string you invent), optional `WHATSAPP_APP_SECRET`.
   In Meta → Webhooks: callback `https://linkup-muqu.vercel.app/api/whatsapp`, verify token = the string you invented, subscribe to `messages`.
   Optional `EXPO_PUBLIC_LINKY_WHATSAPP_NUMBER=2637xxxxxxxx` for the app's wa.me button.
4. **SerpApi** (only if you want the outside-LINKUP leads): Vercel env `SERPAPI_KEY`
   = the account key, optional `OUTREACH_RESERVE_CREDITS`. Free plan is 250/month -
   the pipeline caps itself, but check `linkyOutreach/budget_<YYYY-MM>` once a week.
5. **Bot menu** (one run per bot, needs only the token): `TELEGRAM_BOT_TOKEN=xxxx node functions/set-telegram-commands.mjs`
   - it registers commands, description and short description from `BOT_COMMANDS` in
   `api/linky.js`, so the menu can never advertise a command the bot does not answer.
   Pass `--webhook https://linkup-muqu.vercel.app/api/telegram` to (re)register the webhook from the same script.
6. Nothing else: Gemini and the Firebase service account are already in Vercel; housekeeping authenticates with a Google token from the existing GitHub secret.

## Permissioned outreach: Linky drafts, the member sends

Nothing Linky writes reaches another human on its own. That is true of the internal
Meet path and the outside-the-network lead path, and both are two calls, not one:

| | internal (someone on LINKUP) | outside (a public LinkedIn profile) |
|---|---|---|
| draft | `meet(uid, cardId)` → `{needsApproval, draftId, pitch, opener, targetName}` | `draftLead(uid, {index\|key\|lead, need})` → `{key, text, url, howTo}` |
| approve | `approveMeet(uid, {cardId, text?})` → the intro + notification are written **here**, and the Meet is spent **here** | `approveLead(uid, {text?})` → writes `outreachIntents/{id}` with `status: approved_for_self_send`; **no send**, the member pastes it |
| decline | `cancelMeet(uid, {cardId})` → nothing was ever sent, the card goes back to `saved` | `markLead(uid, {key, status:'not_interested'})` → muted, and the mute is applied to cached answers too, so a person said "no" to cannot come back |

The draft is `linkyState/{uid}.pendingMeet` / `.pendingLead` plus
`introDrafts/{uid}_{cardId}` (server-only; `firestore.rules` denies client reads of
`introDrafts`, `outreachIntents` and `linkyOutreach`), so a half-finished approval
survives a reload, a switch between Telegram and the app, and a night's sleep
(`home.pending` returns both for 3 days). Editing is allowed and expected: whatever
text comes back on the approve call is what the other person reads, verbatim - the
send path never re-drafts, never calls the model again, and never "improves" it.
Every step writes `linkyState/{uid}.outreach` (`drafted` → `approved` →
`sent`/`declined`), which is what turns search into a graph: `pointers()` filters
anyone already written to or declined, and says how many it left out.

App: `LinkyHomeScreen` renders leads as rows (name, title, why, the URL on its own
line) with **Profile / Draft a message / ✕**, and both draft kinds open the same
editable sheet with `SEND IT` / `Not now`. A banner above the chat re-opens a draft
that is still waiting. Telegram/WhatsApp get the same as inline keyboards: `w:<n>`
drafts, `y:`/`n:` approve or cancel an intro, `ld:y`/`ld:n` approve or mute a lead,
plus the typed grammar (`send`, `edit <text>`, `cancel`, `sent`, `not interested 2`,
`draft 2`) for people who would rather type.

## Bot commands

Just type who you need (e.g. `a Flutter developer in Harare, paid`) → answered inline with numbered cards.
`cards` · `meet 1` (answers with a draft and waits for `send`) / `skip 1` / `save 1` ·
`send` · `edit <your own words>` · `cancel` · `sent` · `not interested 2` · `draft 2` · `unskip fred` (a skip is a 14-day cool-off, not a verdict - Linky says the words when it withholds someone) · `accept` / `decline` / `later` · `draft` (write the first line) · `more` (outside-LINKUP pointers after a no-match) · `prefs` · `audit` · `unlink` · `help`. Free replies carry a reply-keyboard of the suggestions Linky generated, so most taps are one button.
Linking: app → Linky tab → Preferences & bots → Connect → send the 6-character code to the bot (15-minute validity).

## Verify after deploy

- Web: `linkup-muqu.vercel.app` → bottom tab shows **Linky** (handshake icon) where Discover was; Explore page has no Linky card/button.
- `POST https://linkup-muqu.vercel.app/api/linky` with a Firebase idToken and `{"action":"ask","message":"a Flutter developer in Harare"}` → JSON with `reply`, `cards`, `asksLeft` in one round trip.
- Same call with a nonsense ask → `none: true`, `nearest: [...]`, HTTP 200.
- `{"action":"facts","notes":"…","skills":["…"],"lookingFor":["…"]}` → `{ok:true}`; `{"action":"audit"}` shows it under `told`.
- Actions → "Campaign expiry sweep" run log shows a `Linky housekeeping` step with `housekeeping: pendingIntros=…`.
- Telegram: message the bot → it asks for a link code.

## Tests

Two suites run against the Firestore emulator (they seed their own users, so they
are safe on a throwaway project - never on production):

```bash
npx firebase-tools@13 emulators:start --only firestore --project linkup-e0906   # or your project
FAKE_SA_JSON=/tmp/fake-sa.json node functions/tests/linky-e2e.mjs              # matching, budgets, intros, bots, cron
FAKE_SA_JSON=/tmp/fake-sa.json node functions/tests/linky-chat-outreach-e2e.mjs # chat personality + name lookup + outreach, with Gemini/SerpApi mocked at fetch
```

The outreach suite mocks `globalThis.fetch`, so it spends **zero real SerpApi
credits** and asserts the budget rules themselves: `num=100` on every query, one
search per ask, no second lookup per person, the ledger counting exactly the
searches made, and refusal at the credit reserve.

Native: version 13.5.0 / versionCode 19 — rebuild the APK whenever you like; the web is live now.
