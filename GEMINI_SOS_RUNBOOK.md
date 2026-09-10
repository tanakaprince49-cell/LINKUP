# LINKUP — Gemini SOS Runbook

**What this is:** the emergency plan for when Gemini fails (down, over quota, key
revoked, billing broke). Read the 60-second version first; the rest is the full
map.

**Bottom line:** nothing hard-breaks. Gemini is the *primary* brain, not the only
one. Below it sit a second provider (OpenCode Zen), deterministic cited answers,
and offline word lists — and there is a single flag that drops Linky into fully
deterministic mode with one env change and no redeploy.

---

## 1. The 60-second version

| Situation | Do this |
|---|---|
| Gemini slow / occasional 429s | **Nothing.** Zen + fallbacks absorb it. Check the fault doc to confirm it's a trickle, not a flood. |
| Gemini quota exhausted / key revoked | Put a fresh `GEMINI_API_KEY` in Vercel. Until then **Zen automatically carries everything.** |
| Gemini **and** Zen both down | Set `LINKY_AI_OFF=true` in Vercel → fully deterministic, **zero model spend**, Linky still answers (shorter, blunter). |
| Suspected key leak | Rotate both keys. Client bundle + logs + chat history are the leak vectors. |

Recovery in all cases: fix the key → clear `LINKY_AI_OFF` → confirm via
`/api/linky?action=diag&probe=1`.

---

## 2. How to tell Gemini is down (detection)

1. **Diag endpoint (no logs needed):**
   `GET https://<deployment>/api/linky?action=diag`
   with header `x-linky-diag: <cron token>` (the cron token or the derived
   Telegram webhook secret — see `cronToken()` in `api/linky.js`).
   Returns `ai.status` (which keys are SET and which env var they came from,
   model name, `off` flag) + `aiFaults` (today's failure count) + SerpApi +
   Telegram status. Add `&probe=1` to make **one real round trip per provider**
   and see, per provider, ok / error / latency — a quota refusal on one key is
   never mistaken for a broken app.

2. **Fault counter in Firebase:** `linkyOutreach/ai_err_<YYYY-MM-DD>`.
   Written by `noteAiFault()` in `api/_linky.js` on every model failure, with
   `count`, `lastKind`, `lastError`, and which providers were configured.
   "Linky has no personality today" almost always means this doc is counting.

3. **Vercel function logs:** grep for `[ai] gemini failed, trying Zen` and
   `[linky] wording call failed, using plain reply`.

---

## 3. The automatic layers (what already happens, in order)

Every AI feature has a deterministic answer behind it. A model failure is
**never** an error a member sees.

| # | Feature (file:line) | 1st fallback | Final fallback (no keys at all) |
|---|---|---|---|
| 1 | Linky wording `linkySay` / `wordingOnce` (`api/_linky.js:1277`) | Zen (same prompt) | `plainReply()` — cited, per-kind template |
| 2 | Intent gate `intentGate` (`:1595`) | Zen | `null` → word lists take over: `SMALL_RX`, `CHIT_RX`, `ROLEISH_RX`, `REFLECT_RX`, `ORDER_RX` (`:520-680`). Small talk skips the gate entirely |
| 3 | Rerank `geminiRerank` (`:929`) | Zen | skipped → `templateWhy` / `templateOpener` cited path |
| 4 | Term expansion `aiExpandTerms` (`:905`) | Zen | skipped → local stems (`expandTerms`, `CONCEPT_BY_ALIAS`) |
| 5 | **Synergy Brief** `ensureBrief` (`:2989`) | Zen | composed locally: `sharedGround` + `groundLines` + `ICEBREAKERS` + `FALLBACK_AGENDA` — a real brief, never a generic one |
| 6 | Loop classify `classifyLoopAnswer` (`:3237`) | Zen | `''` → word-based `answerLoop` path |
| 7 | Outreach scoring `scoreBatch` (`api/_serpapi.js`) | Zen | keeps the local prefilter order |
| 8 | Squad framing `findSquads` / `squadSlotsFromModel` | Zen | `plainReply('squad')` / empty slots → Linky asks for roles |
| 9 | Web ranking `api/rankCandidates.js` | Zen | `localRank()` + 24h Firestore cache |
| 10 | Functions ranking `functions/src/index.ts` | none (per-candidate catch) | `preScore` "Ranked by fast match score" — **functions are off by default**, keep them off |
| 11 | Mobile native direct calls (`mobile/src/lib/*`) | **off by default** | local fallbacks (`localSearchFilters`, local insights, warm-intro template) |

The provider chain lives in one place — `aiText()` in `api/_gemini.js` — which
tries Gemini then Zen and throws only when **both** fail, at which point every
caller's deterministic answer takes over.

---

## 4. Escalation ladder (you, in order)

- **Level 1 — degraded:** members see canned-but-cited replies, `ai_err_*` count
  climbing slowly. Verify with `?probe=1` which provider is failing. Fix that key.
- **Level 2 — Gemini out:** `ZEN_API_KEY` already set? You're fine; nothing to do
  but replace the Gemini key. Zen billing must be active on the workspace (OpenCode
  free-tier keys answer from a server with an error — see `.env.example`).
- **Level 3 — both out:** set `LINKY_AI_OFF=true` in Vercel. Instant, zero-cost,
  no redeploy. Every answer still works from the template paths.
- **Level 4 — full detonation drill:** same as Level 3, plus keep an eye on the
  SerpApi outreach (independent key) and the cron housekeeping (runs on the
  Firebase service account, not on any model).

After any fix: clear `LINKY_AI_OFF`, redeploy if you changed code, then
`?action=diag&probe=1` and confirm both providers show `ok: true`.

---

## 5. The one-flag kill switch (added for this plan)

`LINKY_AI_OFF=true` in Vercel makes `aiReady()` return `false` **everywhere** —
no Gemini calls, no Zen calls, no tokens spent. Linky keeps working from the
deterministic paths in the table above. It is surfaced in `aiStatus()` and
`aiProbe()` so the diag endpoint reports `off: true`.

---

## 6. Provider configuration (env vars, server-side)

| Var | Meaning |
|---|---|
| `GEMINI_API_KEY` | Primary. Also accepted: `GOOGLE_GENERATIVE_AI_API_KEY`, `EXPO_PUBLIC_GEMINI_API_KEY`, `GOOGLE_API_KEY` — first found wins |
| `GEMINI_MODEL` | default `gemini-2.5-flash-lite` |
| `ZEN_API_KEY` | Second brain (OpenAI-compatible) |
| `ZEN_MODEL` / `ZEN_API_URL` | optional overrides; a refused model name is retried down a chain |
| `LINKY_AI_OFF` | **SOS kill switch** — `true` = deterministic mode |
| `SERPAPI_KEY` | outreach (independent of AI) |
| `LINKY_CRON_SECRET` | cron auth (or derived from the service-account key) |

Mobile native keys (`EXPO_PUBLIC_GEMINI_API_KEY`, `EXPO_PUBLIC_OPENCODE_ZEN_API_KEY`,
`EXPO_PUBLIC_OPENROUTER_API_KEY`) still exist in `mobile/src/lib/aiDiagnostics.ts`
but direct device calls are **off by default** — keep them off; they are uncached
and expose the key to the bundle.

---

## 7. Cost guardrails already in place (why a failure ≠ a bill spike)

- Token caps + timeouts on every call (`_gemini.js` clamps `maxOutputTokens`).
- Wording cached in `linkyCache/v2_*` per (kind, ask, channel), 14 days, shared
  across members; `aiExpandTerms` 30 days; intent gate 24h; ranking `rank_*` 24h.
- The Synergy Brief is written **once** per pair (idempotent), one model call per
  pair, with a local composer behind it; cron backfills any missed by a deploy.
- 2 free messages/day cap means an outage can't be farmed into a token bill.
- `noteAiFault` + `aiProbe` make "quota refusal" distinguishable from "app broken".

---

## 8. Known soft spots to watch

1. **OpenCode Zen free tier doesn't work from a server** — the fallback is only
   real if the Zen workspace has billing.
2. **`functions/` has no Zen fallback** and ranks per-candidate. Keep
   `EXPO_PUBLIC_ENABLE_CLOUD_FUNCTIONS` off (it is) — the Vercel routes are the
   resilient path.
3. **Re-enabling direct device calls** re-exposes the key and un-caches spend.
   Leave `EXPO_PUBLIC_ENABLE_DIRECT_AI` / `..._GEMINI_RANKING` at `false`.

---

## 9. Recovery checklist (printable)

- [ ] `GET /api/linky?action=diag&probe=1` — which provider failed, `off` state, fault count
- [ ] Firebase `linkyOutreach/ai_err_<today>` — count + last error
- [ ] `ZEN_API_KEY` set and Zen billing active? (if Gemini is the failure)
- [ ] Not yet? → set `LINKY_AI_OFF=true` (instant deterministic mode)
- [ ] Regenerate `GEMINI_API_KEY` in AI Studio → update Vercel
- [ ] Clear `LINKY_AI_OFF` → redeploy if needed → re-run diag probe → both `ok: true`
- [ ] Rotate keys if the old ones ever touched a client bundle, log, or chat
