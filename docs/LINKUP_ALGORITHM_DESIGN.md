# LINKUP Matching Algorithm — Design v1

**Status:** proposal. Nothing here is built. This document designs the algorithm the AI
should use, explains why each piece exists, and gives implementable numbers, formulas,
pseudocode and a phased rollout.

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
