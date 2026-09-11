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

Limits: free = **5 searches/day and 2 Meets/day**; PLUS = 60 searches/day, unlimited
Meets. "Searches" is the metered thing - asking Linky to look through the network.
A lookup by name, small talk, "write me a message", hiding a fact and the whole
help flow answer before the counter, so the 5 a day are never spent on "hi".
One counter, not three: the app, the Telegram bot and WhatsApp all call the same
`ask()`, so 5 on one surface is 5 everywhere.
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

### How the outside answer is written (and re-written)

`pointers()` returns data, not decoration: `{intro, routes, leads, found, skipped,
searches, place}`. Every text-only surface renders that with one function
(`renderPointers` in `api/_linky.js`, `pointerText` in `api/linky.js`), so the app
cannot print the list twice behind the prose. Three small things keep it human:
`polishNeed()` reduces `find a 5 star tutor` to `5-star tutor` instead of throwing
the member's sentence back at them, `showPlace()` capitalises the parsed city for
display while the **query keeps the raw string** (so the 7-day result cache still
hits and no credit is re-spent), and `tidyTitle()`/`decodeEntities()` run again when
a cached SERP is replayed, because a run stored before the fix carried
`Electrical &amp; Electronic` and a mid-word `...`. The pointers cache key is
`p2_` + a shape guard (`intro` present, `leads` an array) precisely so a
legacy one-paragraph answer can never come back.

#### The "typing and nothing else" class of bug

Three ways a member can be left with a typing dot and no reply, all fixed and all
asserted in `linky-chat-outreach-e2e.mjs`:

1. **One bad button kills the whole message.** Telegram validates `reply_markup`
   before anything else and returns 400 for an empty `url` or a `callback_data`
   over 64 bytes - the text goes with it. `sanitizeTelegramMarkup` (in
   `api/_linky.js`) repairs keyboards on the way out: an unresolved profile link
   becomes a real search URL, a long `p:<encoded ask>` becomes `p:last` (the
   handler reads the ask back from `linkyState.lastAsk`), oversized labels are
   capped, and a keyboard with nothing usable is dropped rather than sent.
2. **Telegram still refuses it.** `sendTelegram` retries the same chunk once
   *without* the markup, so the words always arrive even if the buttons cannot, and
   a 429 waits the `retry_after` it was told to.
3. **The provider is slow.** `handleTelegram` races the reply against
   `LINKY_BOT_BUDGET_MS` (default 34s, under Vercel's 60s) and sends a plain,
   true line when it loses. Every one of these paths also writes
   `linkyOutreach/tg_err_<updateId>` with `kind` (`deadline`, `throw`,
   `handler`, `send-failed`), the member's text, and the error - because there is
   no production log to grep, so the diagnosis has to live in the database.

Telegram sends go through `sendTelegram`, which splits at paragraph boundaries
under 3800 chars, refuses to cut inside an `http` URL, puts the inline keyboard on
the last chunk, and logs the `description` Telegram gives back. Before this, a long
answer was `slice(0, 4000)`-ed or rejected with a 400 that nobody could see - which
is what "it is not pulling up the links" actually was.

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

## What a message means: the intent gate, then the word lists

Members text Linky like a person: `yoo`, `yoo whats up`, `no just wanna chill`,
`yes send]`, or something in Shona. Every one of those used to come back as *"Nobody
here fits \"yoo\" - I read all 56 visible profiles"* - a search report about a message
that was never a search.

**The model decides.** `intentGate()` (`api/_linky.js`) puts every inbound message to
Gemini (then Zen) and gets back one of three modes plus what it is about:

| mode | meaning | what the member gets |
| --- | --- | --- |
| `search` | an instruction to find or message people | the search runs, cards come back, one ask is spent |
| `ask_first` | thinking out loud, a problem described, not settled | a free line ending in **"Should I search for them?"** - no cards, nothing metered, the thought is held in `pendingIntent` |
| `chat` | greetings, feelings, banter, thanks, a stray word | a free reply written for this message, no pitch |

The gate also returns the wording for `chat` and `ask_first`, so those turns cost one
call, not two. Its verdict (mode + topic) is cached per member-message for a day;
the **words never are**, so a greeting is written fresh each time. When it hears an
order that no list could read (`ndinoda munhu anogona kubatsira nemombe dzangu`), the
`topic` it names becomes the query - unless the member's own words were already
well-formed (a role, a place, a name, a clear imperative), which are never rewritten.

**The word lists are the offline fallback, not the brain.** If no provider answers,
`parseAsk` decides with `SMALL_RX`: strip every greeting, laugh, filler and banter
word (including `mhoro`, `eish`, `mwadi`, `baba`) and if nothing with substance is
left, it is small talk. Emptiness after stripping is exact, which a list of greetings
can never be. Two things are never talked out of a search: a `yes` to his own question
and `who else` / `more`. Guards around it:

* a command word in front (`meet 1`, `cards`, `more`, `why`, `skip`) is never banter;
* a role, a place, an offer (`paid`/`equity`) or a name with substance pulls it back
  to a real ask - `someone who knows whatsapp`, `i just want to chat about a flutter
  developer`, `connect me with Cara Dube` all still search;
* a one-word "name" made of filler is not a name: `namePhrases("yoo")` returning
  `"yoo"` is what turned a greeting into a directory scan.

What the chat turn does: it is free, it never costs an ask, and it is written by the
model **every time** (`NO_CACHE_KINDS` - a greeting cached for fourteen days is what
sounds like a form). Linky counts consecutive chat turns in `linkyState.chitStreak`
and stops pitching after the first one: a member who says he is chilling gets company,
not `Tell me who you need and I will go and look - a role, a skill, a city...`. That
sentence only appears when they ask what he does (`what can you do`, `who are you` -
`kind: 'help'`) or when they are new and have never used him for anything.

**If Linky sounds canned, the model is not answering.** Every wording call that fails
writes a counter to `linkyOutreach/ai_err_<day>` (`{count, lastKind, lastError,
providers}`) - readable in the Firebase console, locked to clients by
`firestore.rules`. One curl says the same thing:

```bash
# the derived Telegram webhook secret works as the token, as does LINKY_CRON_SECRET
curl -s "https://<host>/api/linky?action=diag" -H "x-linky-diag: <secret>"
curl -s "https://<host>/api/linky?action=diag&probe=1" -H "x-linky-diag: <secret>"   # makes one real model call
```

```json
{"ok":true,"ai":{"ready":true,"gemini":{"configured":true,"from":"GEMINI_API_KEY","model":"gemini-2.5-flash-lite"},
  "zen":{"configured":false,"from":""}},"search":{"serpapi":true},"aiFaults":{"day":"2026-09-09","count":0}}
```

A member never reads any of this: `memberError()` in `api/linky.js` turns a provider
refusal, a timeout or a stack trace into `Hold on - that one did not go through. Say it
again and I will try once more.`, and the raw text goes only to `linkyOutreach/ai_err_*`
and `?action=diag`. Linky's own copy (the daily limit lines) passes through untouched.

`ai.ready: false` means no key is set under any accepted name (`GEMINI_API_KEY`,
`GOOGLE_GENERATIVE_AI_API_KEY`, `EXPO_PUBLIC_GEMINI_API_KEY`, `GOOGLE_API_KEY`, then
`ZEN_API_KEY`) and the app is running on fallback copy. `ready: true` with
`aiFaults.count` climbing means the key is set but refusing - `lastError` says why
(429 quota, bad model name in `GEMINI_MODEL`, network). The route never returns a key
value, only which variable it came from, and it needs the deployment token.

Wording also goes to Zen when Gemini fails (`aiText`, not `geminiText`) so a member
never reads an outage; the deterministic copy is the last resort and is now written to
sound like a person on a bad day, not a form.

## A thought is not a work order

Linky used to read every message as a search request, so "who could be my Co founder"
came back as "2 people fit that" plus five cards. That is the difference between a
member **talking to him as a friend** and a member **giving him an order**, and he now
tells them apart (`parseAsk` in `api/_linky.js`):

| they write | what he does |
| --- | --- |
| `who could be my Co founder`, `I am thinking about bringing on a technical co founder`, `should i look for a bookkeeper`, `anyone come to mind for taxes?` | **free** reflective reply that ends with `Should I search for them?` - no cards, no ask spent. `kind: 'check'`, `askingFirst: true`. On Telegram that comes with **Yes, search for them** / **No, just talking** buttons; in the app the two chips under the bubble are the same yes and no. |
| `yes`, `yeah`, `go ahead`, `ok`, `sure why not` (within 40 minutes, nothing else in the message) | the search he offered runs - this is the turn that costs an ask |
| `no`, `no thanks, just thinking`, `not now` | one short line, nothing searched, nothing charged |
| `find a flutter developer in harare, paid`, `who do you have for ...`, `search linkedin for ...` | an **order**: people come back immediately, no extra round trip |

A name lookup that also asks to send (`send an intro to Dan Ncube`) always ends with the
next step - `Reply meet 1 and I will ask them for you` - appended deterministically when
the cached sentence forgot it, and never twice.

What is deliberately protected:

* the pending question lives in `linkyState/{uid}.pendingIntent` (40 min TTL) and is
  **cleared by anything else they ask**, so a stray "ok" tomorrow cannot wake an offer
  they forgot about;
* a question is never recorded as an ask (no `lastAsk`, no cache entry), so it cannot
  poison the next answer, the repeat-cache, or a free member's 2 asks a day;
* a "yes" replaces their message with the stored need and re-enters the normal search
  path - budget, cache, drafts, approval - instead of a second code path;
* anything long, emotional or unusual falls through to a real search rather than
  getting stuck behind a question: `want` / `looking for` / `need` always count as
  asking, and a reply over 24 characters is an instruction, not an answer.

`functions/tests/linky-e2e.mjs` ("thinking out loud is not a work order", plus the
Telegram tap-Yes case in the bot section) holds all of this.

## Bot commands

Just type who you need (e.g. `a Flutter developer in Harare, paid`) → answered inline with numbered cards.
`cards` · `meet 1` (answers with a draft and waits for `send`) / `skip 1` / `save 1` ·
`send` · `edit <your own words>` · `cancel` · `sent` · `not interested 2` · `draft 2` · `unskip fred` (a skip is a 14-day cool-off, not a verdict - Linky says the words when it withholds someone) · `accept` / `decline` / `later` · `draft` (write the first line) · `more` (outside-LINKUP pointers after a no-match) · `meet squad` (approve one message, it goes to the trio as separate opt-in intros) · `1`-`4` (answer the 48-hour follow-up when one is open) · `prefs` · `audit` · `unlink` · `help`. Free replies carry a reply-keyboard of the suggestions Linky generated, so most taps are one button.
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

## What happens after Linky says "here they are"

Four things, all of them text, all of them in the same chat:

### The one-page Synergy Brief
When the other person accepts, Linky writes a single page into the chat both of
them can read (`matches/{matchId}/messages`, `type: 'synergy_brief'`, mirrored to
Telegram/WhatsApp and stored on the match as `synergyBrief`):

- **why you two** - computed locally from both profiles first (shared skills,
  shared industries, what each of you is `lookingFor` that the other already has,
  words both of you wrote about the work). If the two profiles genuinely share
  nothing, the page says that instead of inventing a compliment;
- **three icebreakers**, each anchored to a fact from one of the profiles
  (a project title, a stated goal, the city, the shared skill);
- **a 15-minute agenda** in three blocks (0-5 background, 5-10 show the real
  thing, 10-15 alignment check) and one rule: nobody hangs up without a next step.

One model call writes the whole page for the pair - never one per person - and it
is written **once**: `ensureBrief()` returns null if the match already has one, so
a reload never rewrites it. No key, no quota, or junk JSON, and the same page is
composed from the local overlap instead (same sections, shorter prose). Cron
finishes any brief a slow request could not make in time.

### The Post-Intro Loop (48 hours)
Accepting an intro sets `intros/{id}.followupDue = acceptedAt + 48h`,
`followupStatus: 'queued'`. The hourly cron (`?action=cron`) finds what is due and
asks the member who asked for the intro - `Did you actually connect with Grace?` -
with exactly four answers:

| answer | key | what Linky does with it |
| --- | --- | --- |
| Met & pursuing the project | `met` | the pair is warm; cards about that person say you already met |
| Great chat, staying in touch | `touch` | kept as a contact, not pushed for a project |
| No response yet | `quiet` | nothing is forced, the door stays open |
| Not a fit | `nope` | `linkyPairs/{a_b}` records it and `introBlocker` stops suggesting each of you to the other for 60 days |

On Telegram those are four inline buttons (`f:met` … `f:nope`); in the app they
are four labelled chips on the Linky tab (`home.loop`); a plain number works, and
so does a sentence - with a model online it is sorted into one of the four
(`intent: 'ai:loop'`), offline it is stored as a note against the intro rather
than being run as a search. One question per intro, one per member per day, and
never again after an answer. Everything the loop learns lives in `linkyPairs`,
which `buildMatchContext()` loads so the matcher actually uses it.

### Squad Finder (3-way, only when asked)
A member asking for "a dev + someone who can sell + an angel" gets a triangle, not
three searches. The intent gate returns `multi: true` (that is the primary
decider; `SQUAD_RX` on group words like "squad/team of three" is only the offline
fallback), then:

1. the roles come from the member's own words; when they only say "a squad", the
   gaps come from their profile (`lookingFor`), and only then from one cached model
   call;
2. every visible member is scored against every slot in **one local pass** - no
   search, no extra tokens - and a triangle is only accepted when no two of its
   members share more than one core skill and none of them is a copy of the
   requester;
3. **one** batched model call frames the whole answer (`part` per person,
   `missing` per squad), cite-or-reject as everywhere else.

Squads are ordinary cards carrying `squadId / squadRole / squadSize / squadIndex`,
so Save, Skip and Meet all still work per person. `meetSquad` writes one message
for the trio in a single call, the member approves it once, and then each of the
three gets their own double opt-in intro - nobody is added to a group they did not
agree to, and the free plan's 2 Meets a day still decide how many went out today
(the rest are named as still waiting). Linky never offers this feature on its own:
`VOICE_KINDS` and the help copy are told to keep quiet unless the member's own
message asked about it.

### Proof-of-work badges (`api/_proof.js`)
Every card carries up to three badges, and every badge is a fact, not a compliment:

- `checked: true` - LINKUP holds the record itself: a GitHub handle on their own
  profile, a project they published, `isVerified`, a funding stage, projects
  marked live;
- otherwise it is *their own words* and `quote` keeps the sentence: "40k users",
  "10k stars", "raised $2.5M", "Y Combinator alum", "featured in …".
  The channel copy labels those "(their words)" so a member never reads a quote as
  a verification.

Traction outranks contact details for the three slots (weights in `_proof.js`), and
the same extraction runs over outside leads from the SerpApi snippet we already paid
for - no extra search per person. Hidden facts stay hidden: `hidden.bio` /
`hidden.notes` are not scanned for quotes.

## Which AI key is actually answering

Linky has two brains and one search engine. `api/_gemini.js` reads whichever env
names exist (`GEMINI_API_KEY`, `ZEN_API_KEY`, `SERPAPI_KEY`, plus the `GOOGLE_API_KEY`
/ `GOOGLE_GEN_AI_API_KEY` aliases and the `OPENCODE_*` / `ZAI_*` names Zen answers to),
so the same app works on Vercel and on Cloud Functions without a code change.
**No key goes in the repo**: they live in Vercel's project env, copied from the GitHub
secrets on every deploy by `.github/workflows/vercel-production.yml`.

- Gemini answers first. If it fails, times out or comes back empty, the same request
  goes to **Zen**. If both fail, the member still gets a usable reply out of the
  built-in copy - never a stack trace, and never provider text.
- Zen's model name is configurable (`ZEN_MODEL`) because that catalog changes without
  asking. A model refused as *unknown* is retried down a short chain
  (lite -> flash -> gpt-5-nano -> haiku) and the one that answered is remembered for
  the life of the container. A *billing* refusal is not retried - one call, then out,
  so a dead key costs one timeout per message instead of four.
- An OpenCode **free-tier key cannot be used from a server** ("OpenCode's free tier can
  only be used in OpenCode"), so Zen needs a payment method on the workspace before it
  can be the rescue brain. Until then only Gemini's wording is live, and when Gemini's
  quota window closes members see the canned copy.

To check the truth of any deployment - ask the running app, don't read the code:

```bash
curl -s "https://linkup-muqu.vercel.app/api/linky?action=diag&probe=1" \
  -H "x-linky-diag: <TELEGRAM_BOT_TOKEN, or sha256(token) first 32 hex chars>" | jq
```

`ai.gemini.configured` / `ai.zen.configured` say a key is *present*; `probe.attempts`
says whether each one **answered a real round trip right now**, per provider.
`aiFaults` is the last fault members actually hit plus a snapshot of the keys as they
were at that moment (that snapshot can lag; `ai` is always live). No key value is ever
returned, only names and lengths. `?action=cron` uses the same token; `LINKY_DIAG_TOKEN`
overrides it if you would rather not lean on the bot token.

Native: version 14.0.0 / versionCode 20 — rebuild the APK whenever you like; the web is live now.
