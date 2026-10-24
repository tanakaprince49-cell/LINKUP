# Linky message allowance — what 500 members can actually afford

Run `node scripts/linky-budget.mjs` for the live numbers of whatever configuration
is deployed. Everything below is arithmetic from those inputs, not a marketing claim.

## 1. What one Linky message costs in model requests

A delivered message is not one API call:

| Path | Calls |
| --- | --- |
| Greeting / thanks / "what can you do" | 0 (deterministic, no model) |
| Ordinary question | 2 — intent gate, then the sentence |
| Question with a follow-up branch (loop answer, squad, ambiguity) | 3 |
| Provider failover to the second provider | doubles the above |

Measured average used in the model: **2.1 requests per delivered message**. Prompts are
capped (dossier 2,400 characters, thread 24 turns, output 40–700 tokens), so per-message
tokens are roughly 2,000–2,600 in / 150–400 out.

## 2. What the provider gives us

- Google stopped publishing per-model free-tier tables; the limits live in AI Studio.
- Developers report the free tier returning 429 at **~500 requests/day for 3.x Flash-Lite**
  and **~20/day for 3.x Flash** (September 2026).
- Gemini 2.5 models are closed to new signups; free Search grounding is attached to
  2.5 only.
- Limits are **per project**, reset at **midnight Pacific**.

With 500 requests/day and 2.1 calls per message, minus 20% headroom for retries and
recovered failures:

    500 × 0.8 ÷ 2.1 = 190 delivered messages per day

## 3. What 500 members would consume

| Plan | Promise | Worst case per day | Fits in 190/day? |
| --- | --- | --- | --- |
| Free | 15 / month | 7,500/month ÷ 30 = **250/day** | No |
| PLUS | 60 / day | **60/day per member** (10 members = 600/day) | No |
| Free + PLUS mix | — | well above 190 | No |

So the current promises **cannot** run on a 500-request free tier at 500 engaged members.
The free tier covers roughly **11 messages per member per month** if all 500 use Linky.

## 4. Recommended allowance

| Setting | Value | Why |
| --- | --- | --- |
| Free monthly | **15** (unchanged) | Keep the promise you already made. |
| Free daily cap | **3** (`LINKY_FREE_DAILY=3`) | Stops one member spending a whole day's shared budget in ten minutes. 15/month still fits: 3/day × 5 days. |
| PLUS daily | **20–30** (`LINKY_PLUS_DAILY=20`) | 60/day is only honest once billing is on. |
| Shared ceiling | **200/day** (`LINKY_GLOBAL_DAILY_MESSAGES=200`) | Already shipped. When hit, the member is told, and **their allowance is not spent**. |
| Headroom | 20% | Retries, provider failover, the occasional 3-call path. |

A member hitting the shared ceiling sees "Linky has reached today's shared capacity… your
message allowance was not used" instead of a silent hard-coded answer. Deterministic
answers (greetings, quota questions, saved cards) still work.

## 5. The cheaper answer: turn billing on

Free-tier math is the only reason this is tight. Paid Flash-Lite pricing is small enough
that the promise costs cents:

| Volume | Tokens (in/out) | Estimated cost |
| --- | --- | --- |
| 1,000 messages/month | ~2.4M / 0.3M | **$0.4 – $1.3** |
| 7,500 messages/month (500 free members at 15) | ~18M / 2.3M | **$3 – $9** |
| 30,000 messages/month | ~72M / 9M | **$11 – $35** |

(Range spans published Flash-Lite pricing tiers; check the current pricing page before
budgeting.) With billing on, set `LINKY_MODEL_RPD` to the plan's limit, keep the shared
ceiling as a runaway guard, and raise `LINKY_PLUS_DAILY` back toward 60.

## 6. Fairness rules that do not depend on the provider

1. One shared ceiling, checked in the same transaction that spends a member's allowance —
   no over-serving through races.
2. A message that fails is refunded from both the member bucket and the shared bucket.
3. Only delivered answers count; a blocked request costs nobody anything.
4. Deterministic paths (greetings, quota, saved cards) never need the model.
5. The global counter resets at 00:00 UTC; the member's monthly counter resets on the 1st.
