# Linky — conversation, matching and operations

## Current behavior

Linky is LINKUP's AI connector, shared by the app, Telegram and WhatsApp. It can be warm and conversational without pretending to be human. It does not search for people merely because someone says hello or describes a difficult day.

**No-match means no profiles.** A discovery request must pass a deterministic evidence gate. AI wording, subscription status, an avatar, company names, and somebody else's wish list cannot manufacture a match. A name lookup is explicitly labeled as a lookup, not a proven collaboration fit.

### Five companion additions

1. **Saved conversation style:** `tone warm`, `tone direct`, or `tone playful`; also editable in Preferences. One preference follows the member across all three channels.
2. **Contextual search refinements:** `only in Bulawayo`, `also Python`, `Python instead of Flutter`, or `instead Python` when there is a single previous technology. `search brief` shows the current need, requirements, location, exclusions and constraints that cannot be confirmed. A vague collaborator request asks for a useful skill first.
3. **Evidence and uncertainty:** cards cite the actual role, skill, bio or location evidence, and disclose that availability, interest, rates and willingness to collaborate are unconfirmed. `why 1` expands this explanation. The Explore cards also show these caveats.
4. **Shortlist comparison:** `compare 1 and 2` compares the current cards without invented compatibility percentages or claims that anybody was contacted.
5. **First-chat preparation:** `prep 1` produces a grounded conversation plan, questions and next steps. It does not schedule a meeting or send a message.

## Implementation map

| Piece | Location |
|---|---|
| Strict evidence parser, matching and refinements | `api/_linkyQuality.js` |
| Conversation styles and companion utilities | `api/_linkyCompanion.js` |
| Shared discovery, history, source privacy, introductions, quotas | `api/_linky.js` |
| Authenticated app API and messaging adapters | `api/linky.js` |
| Public-profile search, safe URLs, search-credit ledger | `api/_serpapi.js` |
| Monthly/daily message reservation and refunds | `api/_linkyUsage.js` |
| Chat and results | `mobile/src/screens/LinkyHomeScreen.tsx` |
| Preferences and channel linking | `mobile/src/screens/LinkySettingsScreen.tsx` |
| Explore cards | `mobile/src/components/LinkyCardsSection.tsx` |
| Evidence, privacy, conversation and adapter regressions | `tests/linky-companion.test.mjs` |

The API runs with the Admin SDK. `introSuggestions`, `intros`, `linkyState`, `botUsers`, `botLinks`, `linkyCache`, `linkyUsage`, and `linkyOutreach` must remain server-controlled; clients use authenticated API actions rather than writing these records directly.

## Matching rules and boundaries

- Recognized roles, technologies, domains, seniority, location and exclusions are hard gates. Explicit `Flutter or React` alternatives differ from `Flutter and React` requirements.
- Explicit unknown qualifications following phrases such as `with`, `must know`, or `skilled in` are not dropped just because a recognized skill was also mentioned.
- Years of relevant experience, explicit numeric rate limits, and immediate availability are not established by a skill tag. Those recognized constraints fail closed when they cannot be confirmed, rather than returning people as though all conditions were satisfied.
- This is a conservative English parser, **not a complete interpreter of arbitrary requirements**. Keep complex requirements explicit, inspect `search brief`, and confirm claims with the person. False negatives are preferable to unrelated recommendations.
- Discovery considers the public-index candidate pool (currently capped at 600), then rereads current source `users` records. An out-of-date public index cannot revive a hidden, deleted or blocked account. This is not a claim to have exhaustively searched every member.
- Both directions of real blocks and quiet-decline mutes are respected. Source evidence and visibility are rechecked on card reload and introduction approval. Accepting a pending intro cannot bypass a newly created block, deletion, mute or expiry.
- Squad results require a candidate for every requested slot. New cards retain the full slot need so reload does not silently weaken the requirements; legacy squad cards missing that need are dropped.
- Empty results and exhausted pagination do not fall back to old, nearest or randomly selected cards. Ambiguous names are separate from discovery and require a choice.
- AI may help with general conversation, intent, or a human-reviewed draft. It does not choose unsupported people or rewrite the factual no-match verdict. Provider failures have deterministic fallbacks, not raw provider errors.
- Chat appends merge atomically and deduplicate turn IDs so concurrent replies do not overwrite each other's history. Other state transitions and introduction side effects are not claimed to be fully serialized.

## Message allowances

- Free: **15 conversational messages per UTC calendar month**, with a default **5-message daily burst cap**. The daily cap does not increase the monthly allowance.
- PLUS: **unlimited conversational messages**—no member daily/monthly allowance and no shared-cap rejection. `LINKY_PLUS_DAILY` is retired and ignored.
- One shared reservation/refund ledger across the app and linked channels. Conversational tone commands, explanations, comparison, preparation, greetings and name lookups sent through `ask` are metered for usage accounting; PLUS usage is counted but not capped. Settings changes and navigation/approval actions are not extra conversational turns.
- `LINKY_GLOBAL_DAILY_MESSAGES` still rejects free asks when the shared deployment ceiling is reached. PLUS asks continue and remain in the same global usage count; failed processing is refunded from member and global counters.
- Clearing history, forgetting Linky, or unlinking a channel does not reset usage. Free exhaustion returns the existing structured paywall/upgrade signal; PLUS quota payloads use `unlimited: true` with null `limit`/`remaining`.
- Meet limits remain separate: free 2/day; PLUS effectively unlimited. Target inbound cap defaults to 5/week and is adjustable. Introductions expire after 7 days.

## Introduction and outreach consent

An internal Meet first prepares a draft. The requester reviews/edits and approves it; the target must accept before a new chat is opened. Rechecking cards on approval prevents an old draft bypassing new privacy choices or blocks. AI-generated outreach is still a draft requiring human review, not a mechanically proven factual guarantee.

Outside LINKUP, `more` after a no-match may search public LinkedIn snippets using SerpApi. Search credits have a product-level ledger and reserves. External leads are **not LINKUP members or verified profiles**, and Linky does not harvest emails/phone numbers or send LinkedIn messages.

Only HTTPS LinkedIn `/in/` profile URLs can become leads. Redirect resolution is restricted to HTTPS Google allowlisted hosts with manual redirect handling. Current-version caches are scoped to the full need and public-source evidence is reassessed on read. Cached leads missing source evidence fail closed. These checks establish snippet relevance, not present availability, identity, skill verification or location verification.

## Channel setup

1. Deploy `firestore.rules` through the configured rules workflow or Firebase console.
2. Telegram: configure `TELEGRAM_BOT_TOKEN` in the server environment. Optional app setting: `EXPO_PUBLIC_LINKY_TELEGRAM_BOT` (default `LINKUP_AIBOT`). Run `node functions/set-telegram-commands.mjs` with the token supplied securely in the environment; it reads `BOT_COMMANDS` from the shared adapter. Register the webhook at the app deployment's `/api/telegram` endpoint. Re-register the menu after adding commands.
3. WhatsApp: configure `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, and the webhook signing secret `WHATSAPP_APP_SECRET`. Register `/api/whatsapp` with Meta and subscribe to `messages`. Optional app setting: `EXPO_PUBLIC_LINKY_WHATSAPP_NUMBER`.
4. Link a member from Linky → Preferences & bots → Connect. Send the six-character code to the bot within 15 minutes.
5. Optional public search: supply `SERPAPI_KEY`; configure `OUTREACH_RESERVE_CREDITS` as needed. Never put keys in committed files.
6. Optional richer wording: server-side `GEMINI_API_KEY` and/or `ZEN_API_KEY` (with optional `ZEN_MODEL`). `api/_gemini.js` handles supported aliases, provider fallback and timeouts. Neither provider is required for strict matching or the five companion utilities. A configured key is not proof that the provider successfully answered.

Housekeeping is still performed by `.github/workflows/campaign-expiry.yml` / `functions/linky-cron.mjs`; matching never waits on a cron. The existing production web workflow is `.github/workflows/vercel-production.yml`, triggered by pushes to `codex/mobile-port`.

## Validation and release checklist

```bash
npm ci
npm --prefix mobile ci
npm run lint
node --test tests/*.test.mjs mobile/scripts/test-web-mount.cjs
npm --prefix mobile run build:web
# Repeat the suite after export to include generated-web mount checks.
node --test tests/*.test.mjs mobile/scripts/test-web-mount.cjs
# Optional browser check; requires Playwright + Chromium:
node mobile/scripts/smoke-web-mount.cjs
# Android JavaScript/Hermes export; not a signed native release:
cd mobile && npx expo export --platform android --output-dir /path/to/android-export
```

The local companion tests use in-memory Admin SDK adapters, mocked AI and mocked external search. They cover the real shared core and both channel adapters without spending production credits, sending messages, or writing production accounts. The browser mount smoke test is unauthenticated and uses local API stubs; it does not prove signed-in production UI or bot delivery.

Before calling the change live: push to both `main` and `codex/mobile-port`, retain `codex/mobile-port` as the checked-out branch, verify the production workflow and authenticated responses, and refresh the Telegram command menu. Verify linked Telegram/WhatsApp delivery using real authorized test accounts. A successful web build or Android export alone does not deploy backend changes, update installed Android apps, generate a signed APK/AAB, or constitute Play approval.

Legacy scripts under `functions/tests/` contain historical quota and recommendation assumptions. They are not the authoritative companion acceptance suite and must be updated before being reused; do not run them against production data.
