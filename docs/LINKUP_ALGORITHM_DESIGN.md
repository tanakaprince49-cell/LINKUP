# LINKUP Matching Algorithm — Design v2

**Status:** proposal. Nothing here is built. This document designs the algorithm the AI
should use, explains why each piece exists, and gives implementable numbers, formulas,
pseudocode and a phased rollout.

**Revision:** v2 adds **Part II — Chemistry** (§15–§30): the model of *why two founders
would actually want to keep talking*, and the choreography that turns a good match into a
shared artefact. v1 (Part I, §0–§14) is unchanged and still authoritative for fairness,
recall, reciprocity, calibration and evaluation. Where the two meet (final ranking, copy,
metrics, rollout) Part II states exactly how it overrides or extends Part I.

**Scope:** every surface that answers *"who or what should this member see next?"* —
Home rails (people, project matches, active opportunities), search results, "recommended
for you" lists, the Linky companion's suggestions, and the notification/digest picker.
Builder League standings are **not** a matching surface and keep their own transparent
activity ranking.

---

## 0. The one-paragraph version

LINKUP should stop asking a language model to *guess* a match score and start asking it to
*explain and police* a score that a deterministic, measurable model produced. The model is
a small, explainable two-stage ranker: cheap structured recall over categorical + embedding
features, then a calibrated scoring model over nine feature families, then a **reciprocity**
adjustment (a match is only good if both people would act), then diversity and exposure
constraints, and only then does the LLM get involved — to pick among near-ties inside a
narrow band and to write an explanation that must cite evidence stored with the candidate.
Every score is a *probability of a reciprocated, useful action*, not a vibe, and it is
trained on LINKUP's own signed-up-for ground truth: request → accept → reply → next step.
Scores are shown as bands, not fake precision. Small pools bypass the model entirely.

---

## 1. What we are actually optimising

Optimise for **completed collaborations started**, not clicks.

Primary objective (north star):

> **Reciprocated connections that reach a declared next step within 7 days.**
> `connection request accepted` **AND** (`message replied` **OR** `project joined` **OR**
> `intro call logged` **OR** `follow-up created`).

Why this and not DAU: LINKUP is a network of builders, not a feed. A member who opens the
app 40 times and meets nobody has failed. A member who opens it twice and starts a real
collaboration has won, and they tell someone.

> **v2 note — read Part II before implementing the objective.** "Reached a declared next
> step" is the *entry* to a collaboration, not the collaboration. The north star is
> extended in §16 to a four-rung funnel that ends at **a shared artefact and a surviving
> working relationship**. A reciprocated introduction who never speaks again is a
> *successful match* and a *failed pairing*; Part II makes the difference measurable.

Guardrail metrics that can veto any model change:

| Guardrail | Rule |
| --- | --- |
| Unwanted-contact rate | declines + reports + blocks per 100 requests, must not rise |
| Coverage | share of *eligible* members receiving ≥1 impression per week ≥ 50 % |
| Concentration (Gini of impressions) | ≤ 0.55; the same 20 people must not own the network |
| Explanation truthfulness | 0 fabricated facts in sampled explanations |
| Latency | p75 rail render ≤ 120 ms warm, p99 ≤ 400 ms |
| Reversibility | a stale model must degrade to rules, never to an empty rail |

Anti-objectives (explicitly not optimised): session length, ad impressions, notification
opens. Sponsored cards are ranked by a **separate budget-and-quality auction** and are
never mixed into the match score. Paid plans may change *exposure* (disclosed boost), never
the *score*.

---

## 2. Signal inventory (what we already have)

Everything below exists in the current schema or a one-question addition. Nothing requires
a new data source.

| Family | Fields | Notes |
| --- | --- | --- |
| Intent | `lookingFor`, `networkingIntent`, `goal`, Linky `context.needs` | The single strongest signal — and it is *directional* |
| Role | `occupation`, `roleAnswers`, `company` | Founder / dev / designer / marketer / operator / investor / student |
| Skills | `skills[]`, project `tags[]`, GitHub-verified languages | Add evidence weight, not just presence |
| Domain | `industries[]`, news/blog topics read, project `status`/`sector` | Overlap = shared vocabulary, not necessarily fit |
| Stage & commitment | `startupStage`, `commitmentLevel`, `availability`, `workStyle` | Compatibility, not similarity: full-time × weekends is a mismatch even with equal skills |
| Execution evidence | build days, streak, shipped projects, `hasExit`, verified pushes, helpful awards | Temporal-decayed; never a skill verdict |
| Geography | `city`, `country`, timezone | Weighted by whether either party asked for local |
| Graph | connections, shared groups, mutual connections, intro paths | Best cold-start feature we have and currently unused |
| Behaviour | impressions, opens, saves, `recommendationFeedback` (`relevant` / `not_relevant` / `contacted`), drafts, replies | Already collected by `api/_builder.js` — currently thrown away |
| Negative | blocks, reports, declines, mute, stealth/hidden profiles | Hard filters plus a soft trust penalty |
| Content | bio, project descriptions, blog text | Embeddings + extraction into the structured fields above |

Two rules about signals:

1. **Directional data must stay directional.** "Alice is looking for a technical cofounder"
   is not the same fact as "Alice is a developer". Every intent field is scored one way.
2. **Activity is never skill.** Build days raise *responsiveness and reliability* features,
   never *competence*. The reason text must never imply otherwise.

---

## 3. Architecture: five layers, one LLM job

```
                        ┌──────────────────────────────────────────────┐
 request (viewer,       │  L0  ELIGIBILITY & HARD FILTERS              │
 surface, context)  →   │  visible, onboarded, not blocked, not self,  │
                        │  surface-specific gate (e.g. seeking role)   │
                        └───────────────────┬──────────────────────────┘
                                            ▼
                        ┌──────────────────────────────────────────────┐
                        │  L1  RECALL  (≈ 300 candidates)              │
                        │  a) categorical index  b) ANN on profile     │
                        │  vector  c) graph neighbours  d) exploration │
                        │  e) fresh/boosted  f) rotated local pool     │
                        └───────────────────┬──────────────────────────┘
                                            ▼
                        ┌──────────────────────────────────────────────┐
                        │  L2  SCORE  (deterministic, calibrated)      │
                        │  p(reciprocated next step | features)        │
                        │  9 feature families, 1 logistic/BT model     │
                        └───────────────────┬──────────────────────────┘
                                            ▼
                        ┌──────────────────────────────────────────────┐
                        │  L3  RECIPROCITY & MARKET BALANCE            │
                        │  harmonic mean of a→b and b→a; stable        │
                        │  allocation so a small pool cannot collapse  │
                        │  onto the same popular people                │
                        └───────────────────┬──────────────────────────┘
                                            ▼
                        ┌──────────────────────────────────────────────┐
                        │  L4  LLM: tie-break + explain + review       │
                        │  may reorder only inside a ±6 band of the    │
                        │  top 20; may only cite the evidence ledger   │
                        └───────────────────┬──────────────────────────┘
                                            ▼
                        ┌──────────────────────────────────────────────┐
                        │  L5  DIVERSITY, EXPOSURE, DISPLAY            │
                        │  MMR, role/geo caps, exploration quota,      │
                        │  band labels, impression logging             │
                        └──────────────────────────────────────────────┘
```

### L0 — Eligibility (never modelled)

Hard filters, applied first and identically for every surface:

```
eligible(viewer, candidate, surface) =
      candidate.uid ≠ viewer.uid
  ∧   candidate.onboarded ∧ candidate.isVisible ≠ false
  ∧   ¬candidate.banned ∧ ¬candidate.deleted ∧ ¬candidate.isStealthMode
  ∧   ¬blocked(viewer, candidate)  (either direction)
  ∧   surfaceGate(candidate)        e.g. "active opportunity" needs an open need
  ∧   ¬alreadyContacted(viewer, candidate, within=30d)   → demoted, not removed
```

Eligibility is never learned, never purchased and never LLM-decided. It lives in one
function so every surface and every test shares it.

### L1 — Recall (the part everyone forgets)

A great scorer over a bad candidate set is worthless, and today the pool is
`publicProfiles.orderBy(__name__).limit(160)` — literally alphabetical. Fix that first.
Six parallel recall channels, unioned and de-duplicated, capped at 300:

| Channel | Query | Budget |
| --- | --- | --- |
| Intent | candidates whose `iCanOffer` matches viewer's `lookingFor` | 80 |
| Role complement | complementary role set for the viewer's role | 60 |
| Vector | cosine kNN over profile embedding (skills + bio + projects) | 80 |
| Graph | friends-of-friends, shared groups, shared event/project | 40 |
| Exploration | Thompson-sampled "long tail": eligible people with < N impressions | 30 |
| Freshness | joined/updated in last 14 days | 20 |

For a network under ~2 000 eligible members, skip the ANN entirely and score the full pool
in memory. That is a linear pass over 2 000 objects — microseconds — and it guarantees
nobody is invisible. The rule of thumb:

```
pool ≤ 2 000  → brute-force full scoring (no recall loss, no infra)
pool > 2 000  → Firestore vector index (or pgvector) + the six channels above
```

### L2 — The scoring model

`score(a,b) = round(100 · σ(z))`, `z = wᵀx + b`, features in `[0,1]`.

Nine families. Weights below are a **prior**, to be replaced by fitted coefficients
(§6); they are stated so the first version is defensible and so every rail can be
explained to a member in plain English.

| # | Family | Weight | What it measures | Example feature |
| --- | --- | --- | --- | --- |
| 1 | **Intent reciprocity** | 0.26 | a needs what b offers *and* b needs what a offers | `offers → needs` cosine |
| 2 | **Complementarity** | 0.18 | skills/roles that fill gaps rather than duplicate | `1 − Jaccard(skills)` gated by role pair |
| 3 | **Domain overlap** | 0.12 | shared industries/topics → shared vocabulary | Jaccard(industries) |
| 4 | **Execution evidence** | 0.12 | did this person actually build/ship? (decayed) | build days 30d, projects shipped |
| 5 | **Commitment compatibility** | 0.10 | full-time vs weekend, availability windows | `1 − |rank(a) − rank(b)|/3` |
| 6 | **Collaboration style** | 0.06 | work style, communication preference | equality + roleAnswers overlap |
| 7 | **Geography / timezone** | 0.06 | proximity, *conditional on intent* | same city 1.0, ≤3h tz 0.7 |
| 8 | **Social proximity** | 0.06 | mutual connections, shared groups | `min(1, mutuals/3)` |
| 9 | **Freshness / novelty** | 0.04 | new or recently active members | exp decay on lastActiveAt |
| — | **Trust penalty** | −0.15 | reports, low reply rate, spammy links | `1 − replyRate^0.5` |
| — | **Fatigue penalty** | −0.10 | already shown/ignored N times | `min(1, ignores/4)` |

Feature construction rules:

* Normalise every count with a saturating curve, never raw counts: `x = n / (n + k)`
  with `k` tuned so ~10 shared skills ≈ 0.8. This is why nobody can farm the top of the
  list with a 60-skill profile.
* **Intent features are weighted by rarity.** A shared "AI/ML" interest is worth less than
  a shared "hardware sourcing in Harare". Use `idf = log(1 + N / df)` per tag, clipped to
  `[0.2, 3]`. This one change alone fixes most of the "everyone is a 20 % match" problem.
* **Decay**: every behavioural and activity feature uses `0.5^(days/30)`. Someone who was
  brilliant in March should not outrank someone active this week, and someone who stopped
  replying should quietly sink.
* **Missing data must not read as a perfect match.** If a family has no data, its feature
  is `0.5` (neutral) *and* its weight is renormalised downward in proportion to how many
  families are unknown; a two-field profile can never look like a five-dimensional fit.
* **Cap and floor**: keep the existing "everything with < 2 overlapping dimensions is
  capped" spirit but express it as `z = min(z, z_weak)` where `z_weak` maps to 25 %.

### L3 — Reciprocity and market balance (the idea most networks miss)

Score both directions and publish the **harmonic mean**:

```
symmetric(a,b) = 2·s(a→b)·s(b→a) / (s(a→b) + s(b→a))
```

Harmonic mean is brutal in the right way: a 95/30 pair scores 45, not 62. This alone
removes the classic failure mode where a popular founder's rail is full and everyone
else's rail is full *of the founder*.

Then allocate. For any fixed-size surface (a "3 picks today" rail, a digest of 5, a
weekly intro), do not sort globally — run a capacity-limited stable allocation
(Gale–Shapley with viewer capacity `k=3`, or a simple greedy Hungarian approximation under
100 ms) over the eligible pool. Effects:

* the same three people can't be handed to everyone;
* a member who is nobody's first choice still gets offered to the people who are *their*
  best match;
* reruns are stable day to day: same inputs → same allocation, so "your pick refreshed"
  is a real rotation, not a lottery.

Under 50 eligible members, disable L3 allocation (it just reshuffles the same four people)
and fall back to transparent rotation with a visible note. Honesty beats fake sophistication.

### L4 — What the LLM is allowed to do

The LLM is **not** the ranker. Giving a model 40 profiles and asking for a 1–100 score
produces numbers that are uncalibrated, inconsistent between runs, impossible to evaluate
and trivially prompt-injectable from profile text. Three legitimate jobs instead:

**(a) Extract, don't judge.** Turn free text into structure, once per profile edit:
`bio`/`projects` → `offers[]`, `needs[]`, `stage`, `sector`, `seniority`, `evidence[]`
(with the quote it came from), 384-dim embedding of a normalised "what I do + what I need"
document. Everything downstream scores numbers, not prose. Deterministic-ish, cacheable,
auditable, and prompt-injectable text never reaches the scorer as instructions.

**(b) Tie-break inside a band.** After L3, hand the model the top 20 with their scores and
their evidence ledgers. It may only reorder within ±6 points and may return, at most, a
permutation plus reasons:

```json
{"order":["uid_b","uid_a","uid_c"], "notes":{"uid_b":"needs a Flutter dev; you shipped 3",
 "uid_a":"both targeting Zimbabwe fintech"}}
```

Validation on the server, always:

* unknown `uid` → dropped; duplicate → dropped; score written back is the L2 score,
  never the model's opinion;
* any reorder that exceeds the band → rejected wholesale, fall back to L2 order;
* any `note` whose claim isn't in the evidence ledger → dropped and logged (a
  truthfulness violation, counted in the guardrail).

**(c) Write the explanation.** Reasons are assembled from an **evidence ledger** built
before the call — a list of atoms like
`{type:'shared_skill', value:'Flutter', weight:0.8}`,
`{type:'complementary_role', value:'designer ↔ founder'}`,
`{type:'mutual_connections', value:2, names:['Tendai']}`,
`{type:'recorded_activity', value:14, window:'30d'}`.
The prompt says: write ≤ 18 words, use only these atoms, no superlatives, no claims about
competence, no promises. This is what makes "Why you" trustworthy instead of decorative —
and it is the same ledger that powers a member-facing "why did I see this?" panel.

Cost and safety: one call per viewer per surface per day, keyed by the hash of
`(viewer evidence, candidate evidence, weights version)` — exactly the caching discipline
`api/rankCandidates.js` already uses. Batched, `temperature 0`, JSON schema, 700-token cap,
timeout 2.5 s, and a hard rule: **if the LLM is slow, missing, rate-limited or wrong, the
rail renders from L2/L3 without it.** The app must never be blocked on a model call.

### L5 — Diversity, exposure, display

Then, and only then, presentation constraints:

* **MMR**: pick greedily maximising `λ·score − (1−λ)·max_similarity(picked)`, `λ≈0.75`.
  Two clones back to back is a bug, not a coincidence.
* **Caps per rail**: ≤ 1 person per role family, ≤ 2 per company, ≤ 2 per city when the
  pool allows, ≥ 1 member who joined in the last 30 days, ≥ 1 from the exploration quota.
* **Fatigue**: an unopened card is retired after 3 impressions in 7 days; an opened one is
  retired for 30 days.
* **Display**: show a band, not a percentage.

  | Probability | Label | Secondary line |
  | --- | --- | --- |
  | ≥ 0.70 | **Strong fit** | "Both of you are looking for exactly this" |
  | 0.45–0.69 | **Good fit** | "Complementary skills, same market" |
  | 0.25–0.44 | **Worth a look** | one shared signal, named |
  | < 0.25 | not shown in a match rail | may appear in search/browse only |

  This kills the current `spreadTiedScores()` hack, which nudges numbers apart so two cards
  don't read "20 % / 20 %". Bands are honest; two "Worth a look" cards side by side are
  fine, and the raw probability stays in the debug panel and the API response.

---

## 4. Cold start (the real hard problem)

Most members have 4–6 filled fields, no connections and no behaviour. A recommender
trained on that is noise. Four mechanisms, cheapest first:

1. **Five forced-choice intent cards at onboarding** — a tap, not a form:
   *"I'm here to: find a cofounder / join a project / get advice / find clients / hire"*,
   *"I bring: code / design / distribution / capital / domain expertise / operations"*,
   *"I can commit: full-time / 10–20 h/wk / weekends"*, *"I want to meet people: locally /
   in my timezone / anywhere"*, *"Stage: idea / building / launched / funded"*.
   Ten seconds of taps converts a worthless vector into a decent one and gives the reason
   engine real atoms. It is the single highest-leverage change in this document.
2. **Graph seeding**: friends-of-friends and shared-group members are strong, free
   candidates even for a blank profile. Weight channel (d) in L1 up for cold viewers.
3. **Content-based backoff**: if behaviour is empty, score with families 1–3 + 7 only and
   renormalise; never fill missing families with optimistic values.
4. **Exploration with a budget** (see §5): every new member is guaranteed ~30 impressions
   in their first 21 days, spent across the ranked list rather than dumped on day one, so
   the model can learn whether they're a good match *before* deciding they're invisible.

---

## 5. The learning loop

### 5.1 Ground truth ladder

Log every rung with the surface, position, model version and propensity:

```
impression → open ≥ 3 s → save → connect request → request accepted
           → first message → reply received → next step declared → collaboration
```

Positives for training: **reciprocated** rungs only (accepted, replied, next step).
Explicit negatives: `not_relevant` feedback, decline, block, report. Everything in
between is weak negative with a weight of 0.2 — absence of action is not dislike.

### 5.2 Position bias

Rails are ordered, so a click at slot 1 is not the same evidence as a click at slot 8.
Fix with two cheap moves: a permanent **5 % randomised shuffle** of the tail (slots 4–10)
to estimate examination propensity, and inverse-propensity weighting in training. Without
this, every model converges to "whatever was already at the top".

### 5.3 Model choice for our size

Do not build a two-tower neural net at 5 000 members. Ship this ladder:

| Stage | Model | Why |
| --- | --- | --- |
| v0 | the weighted formula above | explainable, zero training data, shippable in a day |
| v1 | **Bradley–Terry / logistic regression** on pairwise "which of these two did the member act on" data, ~30 features, fit nightly | handles feature correlation, produces calibrated probabilities with a Platt/isotonic step |
| v2 | gradient-boosted trees (LightGBM), exported to a JSON tree ensemble evaluated in a Vercel function | non-linear interactions (e.g. "full-time + same city + cofounder intent") |
| v3 | two-tower / matrix factorisation **only for recall** if the pool passes ~20 k | recall quality, not final scoring |

Fit offline (Python job over exported, de-identified events), publish weights as a versioned
JSON artifact in the repo, and gate the swap behind a weights-version flag so rollback is a
config change, not a deploy.

### 5.4 Exploration

Reserve **15 % of every rail** for Thompson sampling over (candidate, feature-family) arms,
with the objective being *information gain about the match model*, not engagement. A member
who never gets shown never gets learned, and never gets a chance. Exploration slots are
labelled internally, not visually.

### 5.5 The feedback that already exists

`recommendationFeedback` (`relevant` / `not_relevant` / `contacted`) is currently collected
and unused. Wire it in as the highest-precision explicit signal, and add one 10-second
outcome question after a connection is accepted: *"What happened? — call booked / project
started / advice received / nothing yet."* That one field turns LINKUP's recommendation
problem from a proxy problem into a supervised one.

---

## 6. Calibration and honest numbers

A score is only useful if it means something. Therefore:

* Fit on `p(reciprocated next step within 7 days)`. Base rate will be low (≈ 3–8 %), so
  display a **normalised percentile of the eligible pool**, not the raw probability: map
  `p → band` as in §3 L5, and show "top 12 % of your matches" only if the percentile is
  reliable for pools ≥ 200.
* Track **Expected Calibration Error** per band monthly; a band claiming 70 %+ should
  convert 60–80 % of the time, or the label is lying and gets retuned.
* Never show two decimals. Never show a score that isn't in the response payload. Never
  show a score to a third party looking at someone else's profile.

---

## 7. Fairness, safety and anti-gaming

* **Exposure cap**: no member receives more than 1.5 % of network-wide impressions in a
  week; high scorers get queued, not flooded. This preserves the "market" that makes a
  small network useful.
* **Reciprocity floor**: a member who never accepts anyone is gradually deprioritised, with
  a transparent notice ("you haven't responded to 6 requests") rather than silent decay.
* **No pay-to-score**: paid tiers may buy *disclosed* placement in a clearly-labelled
  sponsored card, never in a match rail, and never a score change. The score is a
  prediction, and selling predictions is how a network dies.
* **Prompt-injection defence**: profile text is extracted into structured fields by a
  schema-constrained extractor; raw text never reaches the tie-breaker; the tie-breaker gets
  only the ledger and may only return a permutation of known uids.
* **Privacy**: the model sees the fields a viewer could already see through the profile's
  own visibility settings. Stealth mode, blocks and hidden fields are applied *before*
  feature assembly, so no private value can leak into a reason string. Reasons cite only
  public evidence; scores and ledgers are never shown to anyone but the viewer.
* **Explainability on demand**: a "Why am I seeing this?" panel that renders the ledger —
  same data the model used, no separate story.

---

## 8. Performance and cost

* Profile embeddings and extractions: computed on profile save (debounced) and in a nightly
  backfill; stored on the profile doc. Nothing is embedded at request time.
* Graph features (mutuals, group overlap): nightly batch into `matchGraph/{uid}`.
* Per-request work: eligibility → (full pool scan if small) → dot product of ~30 features.
  Budget: 40 ms. No LLM in the critical path.
* LLM: ≤ 1 call per viewer per surface per day, hash-cached, timeouts at 2.5 s, and a
  circuit breaker that disables the tie-breaker for 30 min after 3 consecutive failures.
* Degradation ladder — every step must render something:
  `L2+L3+L4` → `L2+L3` → `L2 only` → `last good cached rail` → `rotated eligible pool`.
  An empty rail is a product bug, never an acceptable failure mode.

---

## 9. Evaluation harness (build this before the model)

Offline, replayable, no production writes:

| Metric | Definition | Target direction |
| --- | --- | --- |
| recall@50 | share of next-week reciprocated pairs present in the top 50 | ↑ (the only metric that justifies a new recall channel) |
| NDCG@10 | ranking quality vs. observed reciprocated actions | ↑ |
| reciprocity@10 | mean `s(b→a)` of the top 10 | ↑ (protects the market) |
| coverage | eligible members with ≥1 impression / week | ≥ 50 % |
| Gini(impressions) | concentration | ≤ 0.55 |
| ECE | calibration error per band | ≤ 0.07 |
| truthfulness violations | unexplained claims per 1 000 reasons | 0 |
| p75 latency | rail render | ≤ 120 ms |
| unwanted-contact rate | declines+reports per 100 requests | not worse |

Online: 50/50 A/B with CUPED on the primary metric and a 4-week horizon, because
collaboration is slow; use **interleaving** for fast iteration on ranking tweaks (an order
of magnitude more sensitive per unit of traffic) and reserve A/B for weight and band changes.
Never ship a model that wins clicks and loses reciprocity@10.

---

## 10. Pseudocode (the whole thing, end to end)

```ts
async function rankForViewer(viewerId, surface, k = 10, now = Date.now()) {
  const viewer = await loadViewer(viewerId);                 // profile + behaviour + graph
  const pool   = eligiblePool(viewer, surface);              // L0, single shared predicate

  // L1 — recall (brute force under 2k, six channels above it)
  const candidates = pool.length <= 2000 ? pool : await recall(viewer, pool, 300);

  // L2 — deterministic scoring
  const scored = candidates.map(c => {
    const ev   = evidence(viewer, c, now);                   // 9 families → features + atoms
    const p    = 100 * sigmoid(dot(W, ev.features) + B);     // calibrated probability
    return { uid: c.uid, ab: p, ledger: ev.atoms, features: ev.features };
  });

  // L3 — reciprocity (skip when the pool is tiny; rotate instead)
  if (pool.length >= 50) {
    for (const row of scored) row.sym = harmonic(row.ab, scoreToward(row.uid, viewer));
    allocateStable(scored, { capacity: k });                 // no collapse onto the popular
  }

  // L5a — diversity before the model sees it, so the band is on a diverse set
  const top = mmr(scored, { k: 20, lambda: 0.75, caps: { role: 1, company: 2, city: 2 } });

  // L4 — LLM tie-break + explanation, inside a band, evidence only, never blocking
  let final = top;
  try {
    const order = await tieBreak(viewer, top, { band: 6, timeoutMs: 2500, cached: true });
    if (order) final = applyOrder(top, order);
  } catch { /* circuit-open: keep deterministic order */ }

  // L5b — display + logging
  const rails = final.map(f => ({ uid: f.uid, band: bandOf(f.sym ?? f.ab), reason: f.reason }));
  logImpressions(viewerId, surface, rails, { modelVersion: W.v, propensities: shuffleProps() });
  return rails;
}
```

---

## 11. Rollout plan

| Phase | Ships | Why first |
| --- | --- | --- |
| **P0 (days)** | Shared `eligible()`, real recall (stop the alphabetical 160), idf weighting, the 5 intent cards, evidence ledger + reason templates, bands instead of percentages, impression logging. Keep today's formula as v0. | Fixes the visible product problems (identical 20 %, invisible members, decorative reasons) without any ML. |
| **P1 (1–2 weeks)** | Reciprocity harmonic mean + stable allocation, diversity caps, exploration quota, fatigue retirement, circuit breaker. | Removes the popularity collapse and makes a small network feel alive. |
| **P2 (1 month)** | Position-bias-corrected event export, offline eval harness, logistic/BT model v1 behind a weights flag, calibration bands fitted from data. | Turns accumulated behaviour into a real model, safely reversible. |
| **P3 (quarter)** | LLM tie-breaker with strict band + ledger validation, "Why am I seeing this?" panel, nightly GBDT v2, exploration Thompson sampling. | Personalisation depth, once the fundamentals are trustworthy. |
| **P4 (later)** | Embedding recall at scale, project↔person two-sided matching (same machinery, different features), group/event matching. | Only when the pool outgrows brute force. |

---

## 12. Surfaces: same engine, different features

| Surface | Objective | Score = | Extra features |
| --- | --- | --- | --- |
| Home people rail | reciprocated connection | `harmonic(s(a,b), s(b,a))` | graph, geography |
| Project matches | member joins/contributes to a live project | `p(join · contribute)` | project `lookingFor` ↔ skills, time budget fit, project momentum |
| Active opportunities | member asks for help / answers a need | `p(reply with substance)` | need urgency, owner responsiveness, deadline |
| Search & browse | relevance, not prediction | structured match + recency | no LLM, no personalisation beyond filters |
| Linky suggestions ("next move") | one concrete action | `p(action taken today)` | context freshness, prior follow-ups |
| Digest / notifications | open + act, without spam | `p(reciprocated action) × fatigue` | per-member send caps (already enforced) |

---

## 13. Things we deliberately do not do

1. No LLM-generated 1–100 scores. They cannot be calibrated, evaluated or defended.
2. No similarity-only matching. Two identical designers are usually a bad pair; the product
   is complementarity plus shared vocabulary.
3. No engagement-maximising objective. It produces a feed, not a network.
4. No "activity = skill" inference. Build days measure consistency, not competence.
5. No hidden pay-to-rank inside match rails.
6. No fake precision ("87 % match") on a six-field profile.
7. No exposure lottery for new members: a deterministic exploration budget is a promise; a
   lottery is a tease.
8. No unreviewed AI reasons. A reason that cites nothing is worse than no reason.

---

## 14. Open questions for the founder

1. **Primary metric**: is *connection accepted with a reply* the right definition of a good
   match, or do you want *declared collaboration started* (rarer, slower, truer)?
2. **Geography**: should Harare/Zimbabwe proximity be boosted (local collaboration) or
   neutral (global remote-first)? This single weight changes the product's character.
3. **Members cannot be matched**: do we tell a member "you have 0 good matches today"
   honestly, or always show the best available with a "Worth a look" band?
4. **Monetisation boundary**: is a disclosed "Boost" in the discovery list acceptable, and
   if so, capped at what share of impressions?
5. **Data retention for learning**: how long do we keep impression-level events, given the
   privacy policy's stated minimisation?

Answer those five and P0/P1 can start without further decisions.

---
---

# Part II — Chemistry: designing pairs that actually build something

Part I answers *"is this a plausible match?"* Chemistry is the harder, more valuable
question: *"will these two still be talking in three weeks, and will something exist at the
end of it that did not exist before?"*

Everything in Part II is designed to be shippable by the same small team, on the same
Firestore documents, with the same LLM budget — and to degrade to rules when the data is
not there.

---

## 15. Chemistry is a different variable, and that changes the maths

Three things are routinely confused. They are not the same and must not share one score:

| Construct | Question it answers | Data | Failure if you conflate it |
| --- | --- | --- | --- |
| **Fit** (Part I) | *Should* these two meet? | structure: needs, skills, stage, geography | You rank by similarity and produce a room of twins |
| **Chemistry** (Part II) | Will they *enjoy* working together, and keep choosing to? | interaction style, rhythm, values, spark | You match capable strangers who go quiet by message three |
| **Outcome** (Part II) | Did something get *made*? | artefacts, commitments kept | You optimise vibes and ship nothing |

**Definition used throughout this document:**

> **Chemistry is the pair-specific, bidirectional probability that two people will keep
> choosing to spend scarce attention on each other and will produce something together
> within 30 days — given that a reasonable amount of structure already fits.**

Three consequences that follow, and that the rest of Part II implements:

1. **Chemistry is an interaction, not a trait.** You cannot score "how much chemistry does
   Tariro have" — only how much *this pair* does. Any additive trait sum throws away the
   signal that matters (this is the single biggest modelling error available here; see §18).
2. **Chemistry is observable in behaviour before it is visible in words.** Reply latency,
   turn-taking balance, question density and follow-through are measurable within 4
   messages, work in both directions, and need no content inspection (§20).
3. **Chemistry is partly manufactured, not found.** The highest-leverage part of this
   design is not ranking. It is giving two people **something small and concrete to do
   together** in the first ten days (§21–§23). Matches create introductions; *tasks* create
   chemistry.

---

## 16. The objective, upgraded: the Wonder Ladder

Replace the single "next step declared" metric with four rungs. Each rung is logged
separately, with timestamps, so every model change can be blamed at the right rung.

| Rung | Name | Definition | Rung survives for | Realistic target (first year) |
| --- | --- | --- | --- | --- |
| R1 | **Spark** | both sides send ≥2 turns within 7 days of the intro opening | 7 d | 45 % of accepted intros |
| R2 | **Meeting** | a call, voice note exchange, or co-working session is logged | 14 d | 55 % of sparks |
| R3 | **Artefact** | one shared object exists: a spec, a prototype, a repo commit, a landing page, a user interview recording, a loom | 30 d | 30 % of meetings |
| R4 | **Survival** | still exchanging ≥1 substantive message in a 7-day window at day 90, or a second artefact exists | 90 d | 55 % of artefacts |

Primary objective (v2 north star):

> **R3 per 100 accepted introductions, with R4 as the quality gate.**

That number is the whole product. It is also a hard number to game: you cannot fake an
artefact without exposing it, and you cannot fake survival at 90 days.

**How the four rungs feed the ranker.** Chemistry is a **second head** on the Part I model,
not a term inside it:

```
fit(a,b)    = Part I score                       → "should you meet"
spark(a,b)  = p(R1)                              → "will the conversation live"
artifact(a,b) = p(R3 | R1)                       → "will it produce anything"

utility(a,b) = [ 0.35 · fit + 0.25 · spark + 0.40 · artifact ] · reciprocity_guard
```

Why multiply-by-gating rather than add: an `artifact` head trained on its own outcome
naturally learns to distrust profiles that have never produced anything, which is exactly
what should *demote* — but the additive form lets a beautiful high-fit pair with zero
follow-through history outrank a smaller, likelier collaboration. Gating keeps the
integrity of the funnel:

```
if fit < 0.30                  → never shown in a match rail (Part I §3 L5 still applies)
if spark_pred > 0.55 ∧ artifact_pred > 0.25  → "worth an introduction" band
if R1 has failed twice for a viewer in the same archetype pair → demote that archetype
                                                                  pair for 60 days
```

**Honesty rule.** None of these four numbers are ever shown to a member as a percentage.
The card shows *two reasons* and *one thing to do* (§22), and the numbers live in the
debug payload and the "Why am I seeing this?" ledger.

---

## 17. The seven chemistry axes

Chemistry priors, weights are a **starting position** to be replaced by fitted coefficients
(§27). All features live in `[0,1]`; missing data is neutral `0.5` *and* its weight is
renormalised away (Part I §3 L2 rule).

| # | Axis | Weight | The human question | Signals we actually have |
| --- | --- | --- | --- | --- |
| **C1** | **Voltage** (spark) | 0.20 | Do they light up about the same things? | rarity-weighted overlap of "voltage tokens": projects, niches, tools, specific problems, causes |
| **C2** | **Shape** (complement) | 0.18 | Do they fill each other's gaps without speaking a different language? | domain overlap × function complementarity × role-pair prior (§18.3) |
| **C3** | **Rhythm** | 0.16 | Can they physically work at the same tempo? | commitment level, weekly capacity, timezone overlap, async/sync preference, decision cadence |
| **C4** | **Safety** (trust) | 0.12 | Can they disagree without it becoming a thing? | feedback style, conflict-repair answers, follow-through history, role flexibility |
| **C5** | **Ambition symmetry** | 0.12 | Are they building the same *size* of thing? | scale wanted, runway expectation, patience horizon, risk appetite, equity expectations |
| **C6** | **Values adjacency** | 0.12 | Do their red lines agree? | "won't build" answers, who they want to serve, quality-vs-speed bar, ethics answers |
| **C7** | **Effort symmetry** | 0.10 | Is the effort reciprocal once it starts? | measured: initiative share, length balance, question balance, commitments kept (§20) |
| — | **Ghost risk** | −0.10 | Is either of them likely to vanish? | follow-through rate, prior pair abandonment, response decay |
| — | **Crowding penalty** | −0.06 | Are they already building with 3 people? | active collaborations count, unread backlog |

### C1 — Voltage: match on the thing they can't stop talking about

Do not match on interest *tags* alone. Match on **voltage tokens**: the concrete, specific,
slightly unusual nouns a person chooses when describing their own work — "informal
cross-border payments", "offline-first sync", "cold-chain for vaccines", "Gatsby migrations
nobody wants to do".

```
voltage(a,b) = Σ_{t ∈ A∩B} idf(t)·w(t)  /  Σ_{t ∈ A∪B} idf(t)·w(t)     clipped to [0,1]
idf(t)       = log(1 + N/df(t)), clipped to [0.2, 3]
w(t)         = 1.0 if t appears in "what I'm building"
             + 0.6 if in skills, +0.3 if in bio, +0.2 if in industries
```

The effect to aim for: two people who both wrote "I want to fix how Zimbabwean SMEs get
paid across borders" should feel *seen* by the intro copy. Two people who both wrote "AI"
should feel nothing, because "AI" has an idf near the floor. This one formula is the
difference between a match that reads as intelligent and one that reads as a keyword filter.

### C2 — Shape: shared *why*, different *how*

The single most common bad pair in every builder network is two identical profiles. The
second most common is two people with nothing in common but ambition. The good pair is a
**T-junction**: a shared domain and a genuinely different function.

```
shape(a,b) = (0.45 + 0.55·domainOverlap(a,b)) · functionGap(a,b) · rolePrior(a,b)

functionGap(a,b) = 1 − jaccard(functionSkills(a), functionSkills(b))   -- rewards different how
domainOverlap    = rarityWeightedJaccard(domains(a), domains(b))       -- rewards shared what
rolePrior        = from the archetype matrix, §18.3, range [0.35, 1.0]
```

`functionSkills` are the *how* skills (React, Figma, financial modelling, growth loops,
hiring, legal), separated from *what* domains (fintech, agritech, logistics). The extractor
(Part I §3 L4a) must classify every skill into exactly one bucket, and the classifier is
versioned, because changing it silently reshuffles every rail.

`functionGap` is capped at 0.9 so a pure-gap pair cannot win on novelty alone, and
`domainOverlap` has a floor of 0.0 — two brilliant strangers in unrelated fields belong in
the **wildcard** slot (§24), not in the top slot.

### C3 — Rhythm: the axis that kills more partnerships than skill ever does

Full-time × weekends is a mismatch even at 99 % skill fit. Rhythm is cheap to measure and
almost never modelled.

```
rhythm(a,b) = 0.40 · capacityFit
            + 0.30 · timezoneOverlap
            + 0.20 · cadenceFit
            + 0.10 · asyncFit

capacityFit   = 1 − |cap_rank(a) − cap_rank(b)| / 3
                cap_rank: 0 = all-in, 1 = 25 h+/wk, 2 = 10–15 h/wk, 3 = weekends/5 h
                (deliberately harsh: 0 vs 3 scores 0.0, and that is correct)
timezoneOverlap = overlap of waking hours (08:00–22:00 local) / 4 h, clipped to [0,1]
cadenceFit    = 1 − min(1, |log2(cadence_a / cadence_b)| / 2)
                cadence = median hours-to-reply, floored at 1 h
asyncFit      = 1 if both declare async-tolerant; 0.6 if one is; 0.3 if both need real-time
```

**Design decision:** `capacityFit` is *not* compensated by other axes. A 0-vs-3 pair is
excluded from the "Complement" slot and may only appear in the Wildcard slot with an
explicit line in the copy ("she has five hours a week — this is an advice relationship, not
a build relationship"). Naming the asymmetry in the copy is what makes it honest instead of
quietly disappointing.

### C4 — Safety: the ability to disagree is the relationship's load-bearing wall

Every cofounder story that ends badly ends at an unresolved disagreement. Model the pair's
*repair capacity*, using the Work Style Card (§19.1) and history:

```
safety(a,b) = 0.35 · feedbackStyleFit
            + 0.30 · repairFit
            + 0.20 · roleFlexFit
            + 0.15 · followThroughFloor

feedbackStyleFit = 1 if both chose compatible styles (direct×direct, careful×careful,
                   questions×questions); 0.75 for adjacent; 0.45 for direct×careful
repairFit        = product of their "when someone disagrees with me publicly" answers
                   mapped to {defend 0.2, curious 1.0, go quiet 0.5, test-it 1.0}
roleFlexFit      = 1 − |rigidity(a) − rigidity(b)|, rigidity = times the member changed
                   their declared role/ownership answers in 90 d (lower = more flexible)
followThroughFloor = min(ft_a, ft_b), ft = kept commitments / total, decayed
```

Note the floor, not the average: one reliable person carrying an unreliable one is the
most common shape of a failed pairing. Minimums protect against it.

### C5 — Ambition symmetry: same size of dream, not the same dream

People rarely split over vision. They split over *scale and timeline*.

```
ambitionSym(a,b) = 0.35 · scaleFit + 0.25 · runwayFit + 0.20 · horizonFit + 0.20 · riskFit

scaleFit   = 1 if both want "venture-scale" or both want "profitable small business";
             1 if both "not sure yet"; 0.35 if venture × lifestyle
runwayFit  = 1 − min(1, |log10((runway_a+1)/(runway_b+1))| / 1)
horizonFit = 1 − min(1, |monthsToRevenue_a − monthsToRevenue_b| / 18)
riskFit    = 1 − |risk_rank(a) − risk_rank(b)| / 2      (0 cautious … 2 aggressive)
```

Symmetry, deliberately — not "more ambition is better". A pair of two cautious
bootstrappers is a fine company; a pair of one bootstrapper and one "we raise in March or
it's dead" founder is a time bomb with excellent credentials.

### C6 — Values adjacency: red lines must agree, taste may differ

```
values(a,b) = 0.50 · redLineCompatibility   -- hard: one 0 → cap the whole pair at 0.25
            + 0.30 · audienceAffinity      -- who they want to serve
            + 0.20 · qualityBarFit        -- speed-vs-polish distance, mild preference
```

`redLineCompatibility` reads the "I would not build…" answers (surveillance, gambling,
tobacco, exploitative lending, "anything I couldn't tell my mother about" — member-authored
free text, extracted to a taxonomy). This is the one place where a **near-zero must veto**:
two people who disagree about whether a business is ethical will not build it together, no
matter how well their skills fit. Veto, not penalty.

### C7 — Effort symmetry: measured, not assumed

Once a pair has interacted, behaviour beats every declared field:

```
effortSym(a,b) = harmonic( initiativeShare_a, initiativeShare_b )   -- harmonic, again
initiativeShare_x = (messages initiated by x + 0.5·questions asked by x)
                    / (total messages + 0.5·total questions)
```

A pair where one person opens every thread scores low even if both are lovely. The
harmonic mean makes 0.9 / 0.2 score 0.33 — which is the correct emotional read.

---

## 18. Chemistry is interactive: the pair model

### 18.1 Why the additive sum is wrong

If chemistry were additive, `chem(a,b) = f(a) + f(b)`, then every member would have one
chemistry value and the ranking would be a constant — the ether of "this person is great".
The interesting variance is in the interaction. We therefore score the **pair vector**:

```
x_pair = [ φ(a,b)             (the 7 axes above, 9 with penalties)
         , |φ_a − φ_b|        (difference terms: complementarity, symmetry)
         , φ_a ⊙ φ_b          (product terms: synergy, e.g. high voltage × high follow-through)
         , u_aᵀ M u_b         (bilinear archetype affinity, §18.3, 8×8 learned matrix)
         ]
z_chem   = wᵀ x_pair + b
```

The `u_aᵀ M u_b` term is the "learned chemistry table": a small matrix factorisation over
eight work archetypes. With 8 archetypes there are 64 cells, so this is fittable with a few
hundred observed pairs — the smallest amount of true pairwise data that exists in a network
of this size. Cap `‖M‖` so the prior cannot be swamped by 40 observations.

Train it as a Bradley–Terry preference model: for each viewer, we observe which of two
candidates they acted on. That is a *pairwise* signal, which is exactly what this model
needs, and it exists in the product from day one (impressions + actions, Part I §5.2).

### 18.2 Two heads, one model

| Head | Trains on | Used for |
| --- | --- | --- |
| `spark` | R1 vs no-R1 on opened intros | the *ordering* inside a band on Home and in the digest |
| `artifact` | R3 vs no-R3 | deciding whether to spend a scarce "intro slot" and which task to propose |
| `fit` | Part I R1 accept | keeping the rails honest about intent |

Sharing an encoder across the three heads is what keeps the model small: one 30-feature
vector, three logistic outputs, one weights artifact, one rollback flag.

### 18.3 The eight archetypes (priors, not astrology)

Archetypes exist for one reason: to give the pair model a **prior** before any pair has
been observed. They are derived from declared answers and extracted text, not from a
personality quiz, and they are never shown to the member as a label.

| Archetype | Signature | What they bring |
| --- | --- | --- |
| **Visionary** | narrative, why, demand creation | direction, story, recruiting |
| **Architect** | systems, abstractions, trade-offs | the shape of the thing |
| **Builder** | code, shipping, velocity | the thing itself |
| **Artisan** | design, craft, taste, detail | the thing people want to touch |
| **Operator** | process, sales, delivery, hiring | the thing becoming a business |
| **Connector** | distribution, community, partnerships | the thing reaching people |
| **Analyst** | research, data, evidence, rigour | the thing being right |
| **Steward** | finance, legal, risk, governance | the thing surviving |

Compatibility prior matrix (rows × columns, symmetric, diagonal is *not* 1.0 — sameness is
usually the trap):

|  | Vis | Arc | Bld | Art | Ops | Con | Ana | Stw |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Vis** | **0.35** | 0.80 | 0.85 | 0.70 | 0.75 | 0.80 | 0.55 | 0.50 |
| **Arc** | 0.80 | **0.40** | 0.70 | 0.55 | 0.80 | 0.60 | 0.75 | 0.65 |
| **Bld** | 0.85 | 0.70 | **0.30** | 0.75 | 0.70 | 0.65 | 0.60 | 0.45 |
| **Art** | 0.70 | 0.55 | 0.75 | **0.35** | 0.60 | 0.80 | 0.45 | 0.40 |
| **Ops** | 0.75 | 0.80 | 0.70 | 0.60 | **0.30** | 0.75 | 0.65 | 0.80 |
| **Con** | 0.80 | 0.60 | 0.65 | 0.80 | 0.75 | **0.30** | 0.50 | 0.45 |
| **Ana** | 0.55 | 0.75 | 0.60 | 0.45 | 0.65 | 0.50 | **0.35** | 0.70 |
| **Stw** | 0.50 | 0.65 | 0.45 | 0.40 | 0.80 | 0.45 | 0.70 | **0.40** |

Read the diagonal as *"two of the same need a third thing to work"*: Visionary × Visionary
is 0.35, not zero — two founders who both sell can be electric **if** one of them hires or
finds an Architect within a month. Encode that as a conditional bonus rather than a flat
penalty (§18.4, anti-pattern repair).

### 18.4 Chemistry killers — modelled explicitly, not hoped away

Every one of these is a feature with a name, so the copy can name it and the model can
penalise it:

| Killer | Detect | Penalty | Repair offered in copy |
| --- | --- | --- | --- |
| **Two generals, no soldier** | both Visionary/Connector, no exec archetype | −0.18 | "You both sell. Bring one builder into the first call." |
| **Mirror twins** | `functionGap < 0.25` | −0.15 | "Same craft — good for peer review, not a founding team." |
| **Pace collision** | `cadenceFit < 0.4` ∧ both heavy users | −0.12 | name the tempo difference in one clause |
| **Ghost risk** | `min(ft_a, ft_b) < 0.3` | −0.20 | propose a 20-minute task; low cost to test |
| **Politeness trap** | both "go quiet" on conflict | −0.10 | task includes a forced trade-off decision |
| **Runway mismatch** | one < 2 months, other > 12 | −0.14 | route to "advice", never "cofound" |
| **Title collision** | both want CEO/own the same function | −0.16 | label the intro "peer", not "cofounder" |
| **Clique echo** | 3+ mutual connections ∧ same employer history | −0.08 | you already know each other — route to a bridging tie |

### 18.5 The bridging term (the anti-echo-chamber clause)

Networks default to matching people who are *already alike* — same city, same school, same
industry, same demographic. That produces a comfortable, low-wonder network. Research on
innovation consistently finds the valuable ties are **bridges**: weak ties across
communities. So add a small, explicit bonus for difference that is *productive*, and never
use protected attributes to compute it:

```
bridging = 0.06 · domainDistance(a,b) · (1 − mutualConnectionDensity(a,b))
           gated on domainDistance ∈ [0.45, 0.85]   -- different field, same ambition
```

Only interest/domain/function distance is eligible. The aggregate *demographic* homogeneity
of each rail is measured for audit purposes (§25.3) and reported monthly — never fed back
into ranking. If the network becomes 90 % one city, the fix is a sourcing decision, not a
hidden per-person adjustment.

---

## 19. The three instruments (no personality astrology)

We refuse mandatory personality tests. We use three cheap, honest instruments, each with a
stated purpose shown to the member before they fill it in.

### 19.1 The Work Style Card — 8 forced choices, ~90 seconds, opt-in

Shown once, after the third match (not at signup), skippable forever, editable, and with
this line at the top: *"Eight taps. They only affect who we introduce you to and what we
suggest you do first — never your visibility, your score, or what other people see."*

1. **When the plan breaks, I first…** rebuild the plan · start building · call someone who's
   done it · dig into why it broke
2. **My best work happens…** in long uninterrupted blocks · in short bursts between
   conversations · under a hard deadline · with someone else in the room
3. **I'd rather be the one who…** decides and owns it · proposes and lets others refine ·
   implements what's decided · stress-tests everything
4. **My feedback tends to be…** blunt and fast · careful and specific · questions first ·
   in writing, later
5. **When a cofounder disagrees with me in front of others, my first instinct is to…**
   defend the decision · get curious · go quiet and follow up 1:1 · suggest we test it
6. **The thing that would end a partnership for me…** missed commitments · dishonesty ·
   no ambition · disrespect
7. **In 12 months I want to be able to say…** we have paying customers · we have the best
   product in the category · we raised and hired · we built something we're proud of,
   whatever its size
8. **My honest capacity for the next 3 months…** all in · 25 h+/week · 10–15 h/week ·
   a few hours at weekends

Every question has **"no preference"**, and every question's weight on the final rank is
capped so that the whole card can move a match by at most **±3 positions inside its band**.
That cap is the difference between a useful instrument and a horoscope that decides
people's lives.

### 19.2 Conversation vitals — metadata only

Defined in §20. No content is ever read by the scorer; only counts, timings and lengths
that the messaging layer already has.

### 19.3 The two-tap outcome question — asked of both sides, never revealed

After R2 (a meeting) and again after R3 (an artefact):

> **"Would you work with them again?"** — Yes, definitely · Maybe, in a different shape ·
> No

followed, only if "Maybe" or "No", by a taxonomy of reasons (one tap): *too vague · never
followed through · different pace · different ambition · I couldn't be honest with them ·
nothing wrong, wrong moment · other*. Free text is optional and never shown to the other
person, and *"nothing wrong, wrong moment"* explicitly parks the pair instead of killing it
(§21.5).

This is the most valuable label in the system: it is a direct, two-sided measurement of
chemistry, it arrives within days, and it is impossible to infer from clicks.

---

## 20. Conversation vitals: the measurable half of chemistry

Five numbers per pair, computed nightly from message metadata, never from message text:

| Vital | Formula | What it catches |
| --- | --- | --- |
| **Turn balance** | `min(t_a, t_b) / max(t_a, t_b)` | one person interviewing the other |
| **Question density** | `(q_a + q_b) / (m_a + m_b)`, `q` = message containing a `?` | curiosity vs broadcasting |
| **Latency fit** | `1 − min(1, |log2(lat_a / lat_b)| / 2)` | one replying in minutes, the other in four days |
| **Momentum** | `avg_len(last 4 msgs) / avg_len(first 3 msgs)`, clipped to `[0.4, 2] → /2` | conversations that grow vs die |
| **Follow-through** | promises detected ∧ artefacts produced / promises detected | "let's do X" with no X |

```
vitality = 0.30·turnBalance + 0.25·questionDensity_norm
         + 0.20·latencyFit  + 0.15·momentum        + 0.10·followThrough
```

`questionDensity_norm = min(1, questionDensity / 0.35)` — one question per three messages
saturates.

**Privacy boundary, written as code-level rules, because this is where a nice idea becomes a
creepy one:**

* Message *text* never leaves the messaging service for scoring purposes. The one exception
  is opt-in, on-device promise extraction for the follow-through vital, which sends a
  boolean count, not text.
* Vitals are per-pair, visible to neither member as numbers, and exposed only as one of
  three human states: **"warming up"**, **"in motion"**, **"gone quiet"**.
* Vitals expire: after 120 days of inactivity, the pair's vitals are deleted; a parked pair
  keeps only its park reason and its revival date.
* Vitals are never a public signal, never part of a public profile, never shown to a third
  party, and never used to rank a member's *other* matches except through the archetype-level
  aggregate (with a minimum cell size of 20 pairs — no n=1 anecdotes in the model).

---

## 21. The courtship state machine — where chemistry is actually made

A match is not an event; it is an **episode** with states, timers and a next best action.
This is the part of the design that most changes the product, because it converts the
companion (Linky) from a recommender into a matchmaker who is *in the room*.

| State | Enters when | Clock | Next best action (Linky) | Exits |
| --- | --- | --- | --- | --- |
| `mutual_yes` | both accept a double opt-in intro | 0 h | open the thread with a pair-specific opener + one tiny task | → `greeted` / `declined` |
| `greeted` | first message sent by both | 36 h | one nudge to the silent side, non-punitive | → `sparked` / `parked` |
| `sparked` | ≥2 turns each | 72 h | "you both mentioned X — here's the one question worth asking" | → `scheduled` / `faded` |
| `scheduled` | a call/co-work is proposed | 7 d | help pick a slot; supply a 5-line agenda | → `met` / `faded` |
| `met` | meeting logged by either side | 48 h after | the two-tap outcome question + a **tiny artefact** proposal | → `building` / `parked` |
| `building` | an artefact exists | 30 d | celebrate the artefact; propose the next rung (§23) | → `compounding` / `stalled` |
| `compounding` | 2nd artefact or 90-day survival | — | propose a bigger shared commitment | stays |
| `parked` | declined, faded, or "wrong moment" | — | **graceful close** copy, one revival per quarter (§21.5) | → `revived` |
| `declined` | either side says no | — | nothing to the other side beyond "not this time" | terminal |

### 21.1 Double opt-in intros

A one-sided request to a stranger is the largest source of unwanted contact and the biggest
killer of spark (the recipient's first impression is "who is this and why now"). Replace it
with: viewer taps **Meet** on a card → the other side gets a card that already contains the
pair-specific *why you two* and one specific opener, asks "open to a 15-minute conversation
about X?" → both yes → a thread opens *with that context pasted at the top*.

Measure `mutual_yes` rate per archetype pair. In practice it is also the cleanest label
available for the `spark` head, and it costs the recipient one tap.

### 21.2 The 36-hour nudge, and its limits

One nudge per stalled state, ever. Rules: never more than one nudge per pair per state;
never a nudge that shames ("you haven't replied"); never a nudge to the person who is
already carrying the thread. The nudge always adds something — a specific hook from the
other person's newest work, or a smaller ask.

> *"Tariro replied with the KYC flow she fought through. Want to send her the two-line
> version of what you're stuck on? It's a 30-second reply."*

### 21.3 Naming the tempo difference out loud

If `cadenceFit < 0.5`, Linky says it plainly to both: *"You two work at different speeds —
Tendai replies in minutes, Farai in a day or two. Nothing wrong with that; it just means
the first call should end with a date, not a 'let's see'."* Naming it converts a silently
fatal mismatch into a manageable one, and it is the single cheapest chemistry intervention
in this document.

### 21.4 The 72-hour graceful close

Ghosting is the network's biggest hidden cost: it teaches people that intros don't work.
After 72 h of one-sided effort, the pair closes itself with a message to *both* that
preserves face and keeps the door open:

> *"This one didn't catch — which happens more than anyone admits. Closing the thread so
> nobody is left hanging. I'll bring it back if something concrete changes on either side."*

The initiator never learns whether the other person opened it. Nothing is scored against the
silent side's profile (a person can be busy for a week and still be a great match) — only
against the *archetype pair* aggregate, and only after 20 observations.

### 21.5 Revival, not recycling

A parked pair can be revived **once per quarter**, and only on a *concrete* new signal:

* the counterpart shipped something that matches the viewer's declared need;
* the viewer's own `lookingFor` changed;
* a third member is now a useful bridge ("you both know Chido").

> *"Sam just shipped the merchant onboarding flow you said you were stuck on. Worth reopening
> that thread? I can write the first line."*

No revival for "it's been a while" — that is a notification with extra steps.

---

## 22. Spark prompts: exactly what the LLM writes, and what it may not

The chemistry LLM has one job per pair per day: **turn an evidence ledger into a reason to
talk and a first move that costs almost nothing.** It is not a copywriter for generic
flattery; it is a translator between two ledgers.

### 22.1 Output contract (strict JSON, validated server-side)

```json
{
  "headline":   "≤ 60 chars, no adjectives that aren't evidenced",
  "why_you_two": {
    "shared":  {"atom": "domain.border_payments", "quote": "…", "text": "≤ 70 chars"},
    "complement": {"atom": "skill.kic", "quote": "…", "text": "≤ 70 chars"}
  },
  "opener":     "≤ 240 chars, first person, ends with a specific low-cost ask",
  "tiny_task":  "≤ 120 chars, ≤ 20 minutes, produces an object",
  "agenda":     ["3 bullets for a first 15-minute call, ≤ 60 chars each"],
  "tempo_note": "≤ 90 chars, only when cadenceFit < 0.5",
  "tone":       "warm | direct | playful",
  "cites":      ["atom_id_1", "atom_id_2"]
}
```

Server validation (reject → fall back to templates in `api/_linky.js`'s existing
`templateOpener`):

* every `cites` id must exist in the pair's ledger, and at least one must be a *shared*
  atom and one a *complement* atom;
* every quote must be a literal substring of a field the viewer is allowed to see;
* banned tokens: `match`, `%`, `perfect`, `soulmate`, `synergy`, `chemistry`, `vibes`,
  `compatible`, `destined`, `AI-powered`, `revolutionary`;
* no personality claim ("you're both visionaries"), no flattery adjective without a quote;
  no claim about money, health, family or appearance; no gendered pronoun unless the profile
  states one; maximum one emoji; no exclamation marks in the opener;
* the opener must contain one of: a question, a concrete offer, or a named artefact.

Fallback is mandatory, never optional: a failed generation produces the deterministic
template with the top two ledger atoms — not an error, not silence.

### 22.2 Worked examples (the tone bar)

**Bad** (what most "AI matching" copy looks like — reject on sight):

> *"You two are a 92 % match! 🚀 You're both passionate about fintech and love building.
> Say hi and see where it goes!"*

Why it fails: no evidence, fake precision, adjective soup, and no next move.

**Good — complement slot, same city, different craft:**

> **Shared:** both working on getting SMEs paid across borders.
> **Different:** she's fought the KYC integration, you've built the merchant side.
>
> *"Tariro spent four months wiring KYC for cross-border payments in Harare — the exact wall
> your merchant onboarding hits. Worth asking her what she'd do differently? I can send the
> first line."*
>
> **Tiny task (20 min):** each writes the three biggest blockers you'd hit launching in the
> other's market. Compare on the call.

**Good — mirror slot, peer craft, different stage:**

> *"You've both shipped React Native apps solo. She's at 8 000 users and one crash a week;
> you're at 200 and no crashes. That's the most useful trade in the app right now."*
>
> **Tiny task:** swap one crash log and one growth number.

**Good — wildcard slot, cross-domain bridge:**

> *"You're building offline-first sync for clinics. He runs cold-chain logistics in Mutare and
> lost two weeks of stock records to bad connectivity last quarter. He's your user, not your
> competitor."*
>
> **Tiny task:** one 10-minute call where he describes the last time the app failed him —
> record it, that's your first user interview.

**Good — tempo note:**

> *"You two work at different speeds — Sam replies within the hour, Nyasha in a day or two.
> Fine, as long as the first call ends with a date instead of a 'let's see'."*

### 22.3 Cost and caching

One call per pair per day maximum, hash-cached on `(model, weights_version, ledger_hash,
prompt_version)`, 2.5 s timeout, circuit breaker after 3 failures (Part I §8). Because
openers are generated once per pair rather than per rail, a 300-candidate rail costs at most
3 generations — the two or three cards actually shown.

---

## 23. The Wonder Ladder: small shared artefacts, escalating commitment

Chemistry is built by *doing something together*, so the product must always be able to
answer: **"what is the smallest thing these two could make in 20 minutes?"**

| Rung | Artefact | Effort | Who proposes it | Signal it produces |
| --- | --- | --- | --- | --- |
| **W0** | A question answered with specifics (not "let's connect") | 5 min | Linky, in the opener | R1 spark |
| **W1** | Two lists compared (blockers, users, tools, pricing) | 20 min | Linky, after first exchange | R1 → R2 |
| **W2** | One shared object: a one-page spec, a Figma frame, an API stub, a landing-page draft, a user-interview recording | 2–4 h | Linky, after the meeting | R2 → R3 |
| **W3** | A joint experiment with a deadline: 5 user interviews, a paid pilot, a working demo by Friday | 1 week | the pair, prompted by Linky | R3 |
| **W4** | A declared collaboration with a scope and an end date | 1 month | the pair | R3 → R4 |
| **W5** | Something that exists in the world: users, revenue, a funded thing, a shipped product | months | the pair | R4 compound |

**Design rules**

1. **Never skip rungs.** Proposing W3 to a pair that hasn't had a single exchange reads as
   pressure and kills the thread. The state machine (§21) gates which rung may be proposed.
2. **Every task has an object.** "Have a chat" produces nothing measurable; "each write your
   three blockers" produces a document, and the document is the evidence of chemistry.
3. **Tasks must be asymmetric-friendly.** A 5-hour-a-week member should be able to complete
   every W0–W1 task. Capacity mismatch is handled by *task size*, not by excluding people.
4. **Propose, never assign.** The pair can decline a task with one tap ("not this one") and
   that is a labelled negative for the task generator, not for the people.
5. **Celebrate the artefact, not the streak.** The reward copy names the object ("you two
   shipped a spec in 9 days"), never the gamification ("+50 points"). LINKUP's league is for
   individual activity; pairing rewards must not touch it, or people will farm fake
   collaborations for points.

---

## 24. Portfolio composition: three different kinds of card, not three of the same

A rail of three near-identical people teaches a member that the app has one idea of them.
Compose each surface as a **portfolio** instead:

| Slot | Name | Selection rule | Copy framing |
| --- | --- | --- | --- |
| **A** | **The Mirror** | highest `fit` among pairs with `functionGap < 0.45` — same craft, different context | "peer review / trade notes" |
| **B** | **The Complement** | highest `fit · shape` with `functionGap ≥ 0.55` and `capacityFit ≥ 0.6` | "the gap you said you had" |
| **C** | **The Wildcard** | highest `spark · bridging` with `domainDistance ∈ [0.45, 0.85]`, capped at one per rail | "your next user, not your next competitor" |

Rules:

* Never two cards from the same archetype pair in one rail.
* Slot C may not be filled by someone with `fit < 0.25` — a wildcard is a surprise, not a bug.
* If the pool is smaller than ~30 eligible people, drop to **two honest cards** (Mirror +
  Complement) rather than padding slot C with a bad fit.
* Every card carries a *different* reason type, so a member reading all three learns
  something different about themselves — that is the feeling of being understood by a
  matchmaker, and it is the emotional core of the product.
* Portfolio diversity is logged per rail (archetype spread, city spread, stage spread) so
  homogeneity is visible before it becomes the network's character.

---

## 25. Chemistry metrics, guardrails and evaluation

### 25.1 Metrics

| Metric | Definition | Target (year 1) | Guard |
| --- | --- | --- | --- |
| R1 spark rate | `mutual_yes` → 2 turns each within 7 d | ≥ 45 % | — |
| R2 meeting rate | spark → meeting logged | ≥ 55 % | — |
| **R3 artefact rate** | meeting → artefact within 30 d | **≥ 30 %** | north star |
| R4 survival | artefact → still active at 90 d | ≥ 55 % | — |
| Regret rate | "No" answers at the outcome question among pairs that met | ≤ 8 % | veto if rising |
| Ghost rate | pairs with one-sided effort 72 h after spark | ≤ 25 % | veto if rising |
| Median vitality | §20 composite among live pairs | ≥ 0.55 | — |
| Mutual-yes rate | intros accepted by both sides | ≥ 40 % | — |
| Opener acceptance | generated opener sent unedited or lightly edited | 35–60 % | > 75 % means the copy is generic |
| Prompt hallucinations | fabricated facts per 1 000 generated prompts | 0 | absolute veto |
| Task completion | proposed W1/W2 tasks completed | ≥ 35 % | — |

The last two guard *quality of chemistry*, not quantity: if everyone accepts the generated
opener and nobody fails a task, the pair is being flattered by a machine and the numbers
will quietly rot.

### 25.2 Two-tower feedback loop (avoiding the "AI talking to AI" trap)

If both sides send generated openers, the first exchange is two bots shaking hands, and
vitality drops. Mitigation, in order:

1. The opener is **drafted, not sent**: the member always presses send, and the editor is
   one tap to personalise ("add one sentence of your own" is prompted, skippable).
2. Never generate the *second* message. After the first exchange, Linky suggests a
   *question*, not a paragraph.
3. Detect low-variance pairs (both messages high similarity to a template) and flag them at
   the cohort level — not to punish members, but to retrain the prompt.

### 25.3 Fairness guardrails specific to chemistry

* **No protected attributes in ranking.** City/language/industry are allowed as *context*
  (they are declared, functional and visible); gender, age band, ethnicity, religion,
  disability, and appearance are **never features**, not even through proxies like name.
* **Homogeneity audit.** Monthly: distribution of pairs across city, industry, archetype,
  and declared language. If any single grouping exceeds 60 % of intros, the fix is sourcing
  and copy, published in the monthly report — not a hidden per-person thumb on the scale.
* **No forced intimacy.** Copy never implies romance, "soulmate", "vibe", "energy"; the
  register is *craft, ambition and work rhythm*. Members who want a strictly professional
  register can set it in Linky settings, and the copy generator is constrained accordingly.
* **Right to be unmatched quietly.** A decline never tells the other person who declined,
  why, or that a reason was given at all.
* **No astrological determinism.** Any chemistry-derived line must be attributable to a
  ledger atom; "you two just fit" is a forbidden sentence.

---

## 26. Pseudocode: the chemistry layer

```ts
// ---- per pair, cheap, deterministic -------------------------------------------
function chemistry(viewer, cand, now) {
  const axes = {
    voltage:  voltageScore(viewer.voltage, cand.voltage),          // C1, idf-weighted
    shape:    shapeScore(viewer.facets, cand.facets),              // C2, T-junction
    rhythm:   rhythmScore(viewer.rhythm, cand.rhythm),              // C3
    safety:   safetyScore(viewer.workStyle, cand.workStyle),        // C4
    ambition: ambitionSymmetry(viewer.ambition, cand.ambition),     // C5
    values:   valuesAdjacency(viewer.values, cand.values),          // C6  (hard veto)
    effort:   effortSymmetry(pairVitals(viewer.uid, cand.uid)),     // C7
  };
  if (axes.values === 0) return { veto: 'red_lines', ...axes };     // §17 C6

  const killers = detectKillers(viewer, cand, axes);                 // §18.4
  const bridge  = bridgingBonus(viewer, cand);                       // §18.5

  const x = featureVector(axes, killers, bridge, archetypesOf(viewer, cand));
  const z = dot(W.chem, x) + B.chem + bilinear(viewer.archetype, cand.archetype, M);
  return { axes, killers, chem: sigmoid(z), sparks: sigmoid(zSpark), artefact: sigmoid(zArt) };
}

// ---- per rail ----------------------------------------------------------------
async function composeRail(viewerId, surface, k = 3, now = Date.now()) {
  const viewer = await loadViewer(viewerId);
  const pool   = eligiblePool(viewer, surface);                       // Part I L0
  const cands  = pool.length <= 2000 ? pool : await recall(viewer, pool, 300);

  const scored = cands.map(c => {
    const fit  = part1Score(viewer, c, now);                           // Part I L2
    const ch   = chemistry(viewer, c, now);
    if (ch.veto) return null;
    const util = 0.35 * fit + 0.25 * ch.sparks + 0.40 * ch.artefact;   // §16
    return { uid: c.uid, util, fit, ch };
  }).filter(Boolean);

  // reciprocity: a good pair, not a good person (Part I L3)
  if (pool.length >= 50) {
    for (const row of scored) row.sym = harmonic(row.util, scoreToward(row.uid, viewer));
    allocateStable(scored, { capacity: k });
  }

  // portfolio: Mirror / Complement / Wildcard (§24) — chosen before the LLM sees anything
  const slots = pickPortfolio(scored, { k, poolSize: pool.length });
  if (!slots.length) return honestEmptyState('No good introductions this week.');

  // LLM: explanation + first move only, evidence-bound (§22), never blocking
  const cards = await Promise.all(slots.map(async slot => {
    const gen = await safeGenerate(slot, { timeoutMs: 2500, cache: true });
    return { ...slot, copy: gen ?? templateCopy(slot), nextRung: nextLadderRung(pairState(slot)) };
  }));

  logImpressions(viewerId, surface, cards, { modelVersion: W.v, propensities: shuffleProps() });
  return cards;
}

// ---- the courtship, driven by a scheduled job (hourly) -------------------------
async function advancePair(pair, now) {
  const s = pair.state;
  if (s === 'greeted' && now - pair.greetedAt > 36 * HOUR) return nudgeOnce(pair, 'silent_side');
  if (s === 'sparked' && now - pair.lastMsg > 72 * HOUR)    return gracefulClose(pair, 'faded');
  if (s === 'met'     && now - pair.metAt     > 48 * HOUR)  return askOutcome(pair) + proposeW2(pair);
  if (s === 'building'&& now - pair.artefactAt> 30 * DAY)   return proposeW3(pair);
  if (s === 'parked'  && pair.reviveAt <= now && revivalSignal(pair)) return reviveOnce(pair);
}
```

---

## 27. Rollout for Part II (chemistry), slotted into Part I's phases

| Phase | Ships | Why in this order |
| --- | --- | --- |
| **C0 (days)** | Double opt-in intros; the pair-specific *why you two* card with two atoms (one shared, one complement); the deterministic opener + tiny task; 36-hour single nudge; 72-hour graceful close; pair state machine in Firestore with timers. | Highest chemistry-per-line-of-code in the document. No model, no quiz, no new data. Works with today's `pairNote` / `opener` in `api/_linky.js`. |
| **C1 (1–2 weeks)** | The 8-question Work Style Card; C1/C2/C3 axes live as deterministic features; portfolio composition (Mirror/Complement/Wildcard); tempo note; R1–R2 logging. | Turns chemistry from copy into ranking, and gives every rail three different reasons. |
| **C2 (1 month)** | Conversation vitals; the two-tap outcome question; effort symmetry; ghost-risk penalties; the archetype bilinear table fitted on observed pairs; R3/R4 logging; the Wonder Ladder task proposals with completion tracking. | Needs the funnel to have run for a few weeks — this is where the labels come from. |
| **C3 (quarter)** | `spark` and `artifact` heads fitted on top of the Part I feature vector; regeneration of copy per pair state; A/B with CUPED on R3; monthly homogeneity and calibration report. | Model depth only after the funnel exists, as with Part I. |

Dependency note: C0 should ship **before** Part I P2 (any learned model), because it creates
the labels the model will train on. The cheapest way to get ground truth in a builder
network is not better logging — it is giving people something worth doing together and then
asking both of them.

---

## 28. Data model (additions only; nothing here is built)

```
pairState/{uidA__uidB}          // uidA < uidB, canonical order
  state, createdAt, greetedAt, sparkAt, scheduledAt, metAt,
  artefactAt, parkedAt, parkReason, reviveAt, revivals[],
  vitals: {turnBalance, questionDensity, latencyFit, momentum, followThrough, vitality, asOf},
  tasks: [{rung, proposedAt, acceptedAt, doneAt, objectUrl?}],
  outcome: {a: 'yes'|'maybe'|'no', b: ..., reasonA?, reasonB?},   // never cross-shown
  ledgerHash, modelVersion

workStyleCard/{uid}             // opt-in, editable, capped influence (§19.1)
  answers{1..8}, version, updatedAt, skipped?

chemistryModel/{weightsVersion} // versioned weights artifact + baseline metrics
```

Rules: no message text anywhere in these documents; `pairState` is readable only by the two
members (as *states*, never as numbers) and by server-side jobs; deleting either member's
account deletes the pair document.

---

## 29. Failure modes we are designing against (and the rule that prevents each)

| Failure | What it looks like | Rule that prevents it |
| --- | --- | --- |
| **Manufactured intimacy** | app implies a bond before there is one | §22.1 banned tokens, §25.3 no romance register |
| **Personality-test apartheid** | one quiz decides a member's fate | influence cap ±3 positions (§19.1) |
| **AI talking to AI** | two generated openers, dead thread | draft-don't-send, no generated second message (§25.2) |
| **Vibe over substance** | high-spark pairs who never make anything | R3 is the north star, not R1 (§16) |
| **Nudge fatigue** | three reminders per pair | one nudge per state, ever (§21.2) |
| **Ghost equilibrium** | everyone waits for everyone | double opt-in + 72-hour graceful close (§21.1, §21.4) |
| **Clique machine** | intros concentrate in one city/craft | bridging term + homogeneity audit (§18.5, §25.3) |
| **Confident wrong copy** | reason cites something that isn't true | ledger-only generation + substring validation (§22.1) |
| **Task theatre** | tasks that produce nothing | every rung has an object (§23) |
| **Chemistry as a stick** | low-chemistry people told they're unlikeable | chemistry is never shown as a score, and only ever in aggregate (§20, §25.3) |
| **Farmable pairing** | fake collaborations for points | pair rewards never touch League points (§23 rule 5) |

---

## 30. Open questions for the founder (chemistry-specific)

1. **Register**: is the copy warm-peer ("two people who'd like each other's work") or
   strictly transactional ("here is a functional gap and a name")? Warm-peer lifts spark;
   transactional protects professionalism. Pick one as the default and let members switch.
2. **Double opt-in**: acceptable to gate *all* intros behind both sides saying yes? It costs
   some volume and buys a large lift in spark, ghost rate and reputation.
3. **Scarcity**: should a member have a maximum of 3 live introductions at a time? Scarcity
   raises follow-through measurably, but slows the network's warmth.
4. **Task authorship**: may Linky propose a task inside the chat thread, or only in the
   match card? In-thread is stronger, and requires a clear "this is a suggestion" grammar.
5. **Local-first anchoring**: should pairs in the same city be *steered toward meeting in
   person* (a co-working nudge), which historically produces the strongest R3?
6. **The 90-day promise**: are we willing to tell a member, in plain words, "we will check
   at 90 days whether this is still alive"? That sentence is the product's best claim.

---

## 31. The first ten tickets (build-ready, no new infrastructure)

Ordered so that each one ships on its own and none depends on a model. File names are the
existing seams in this repo.

| # | Ticket | Touches | Done when |
| --- | --- | --- | --- |
| 1 | **Pair ledger** — assemble a per-pair evidence ledger (shared atom + complement atom + quotes) from profile fields already visible to the viewer | `api/_linky.js` (extend the existing `pairNote`/`evidence` builder) | server returns `{shared, complement, cites[]}` for any pair; no free text unvalidated |
| 2 | **Deterministic opener + tiny task templates** — 12 templates keyed by archetype pair and rung W0 | `api/_linky.js` `templateOpener` | every match card renders an opener and a ≤20-minute task with no LLM call |
| 3 | **Banded display** — replace numeric match percentages on cards with bands + two reasons | `mobile/src/lib/matchmaking.ts`, `RecommendedMatchesScreen.tsx`, `MatchScreen.tsx` | no `%` match anywhere in the app copy; tests assert it |
| 4 | **Double opt-in intro** — "open to a 15-minute conversation about X?" with both-sides yes before a thread opens | `api/_builder.js` (`recommendations`, `recommendationFeedback`), `ChatScreen.tsx` | a thread can only be created from a mutual yes; declines stay invisible |
| 5 | **Pair state machine + timers** — the §21 states in Firestore with hourly advance job | new `api/_pairLifecycle.js`, `firestore.rules` | states transition on schedule; one nudge per state, ever |
| 6 | **Graceful close + revival** — 72-hour close copy, one revival per quarter on a concrete signal | `api/_pairLifecycle.js`, `shared/retention.js` | closing a pair messages both sides; revival requires a named signal |
| 7 | **Work Style Card** — 8 forced choices, opt-in, ±3-position influence cap | `mobile/src/screens/OnboardingScreen.tsx` (post-third-match) or a Linky settings panel | card editable and skippable; ranking delta provably ≤ 3 positions |
| 8 | **Portfolio rail** — Mirror / Complement / Wildcard composition with different reason types | `api/_builder.js` recommendations, `DiscoveryDashboardScreen.tsx` | a 3-card rail never repeats an archetype pair; degrades to 2 cards under 30 members |
| 9 | **Outcome question + R1–R4 logging** — two-tap "would you work with them again", funnel events with surface, position, model version | `api/_builder.js`, `shared/retention.js` | R1/R2/R3/R4 computed for any cohort from logged events |
| 10 | **Vitals job** — nightly per-pair metadata vitals, three-state display only | new `api/_pairVitals.js` | vitality computed without any message text leaving the messaging layer |

Tickets 1–4 alone change what the product feels like. Tickets 5–6 are what make pairs
survive a busy week. Everything after that is measurement.
