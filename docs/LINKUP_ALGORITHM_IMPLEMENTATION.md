# LINKUP matching algorithm — what is actually running

This is the shipping companion to [LINKUP_ALGORITHM_DESIGN.md](./LINKUP_ALGORITHM_DESIGN.md).
The design document says what the algorithm *should* be. This one says what is
**in the app today**, where it lives, and what is deliberately still missing.

Engine version: `linkup-match/1.1.0`

---

## 1. The one-paragraph version

`shared/linkup-match.js` is the shared deterministic scorer for LINKUP's introduction
surfaces. It turns profiles into a score, a band, reasons, and a small suggested task.
It runs on-device and server-side, does not read message text, and uses a single
explicit timestamp for recency. The optional LLM tie-break is capped at 2.5 seconds,
may only swap an adjacent candidate in the same band, and must cite an exact ledger
phrase or token. Members see bands, never percentages.

---

## 2. Where each design section landed

| Design section | Code | Status |
| --- | --- | --- |
| §3 L0 Eligibility | `eligibility()` plus server canonical profile, visibility, and bilateral block checks | ✅ live |
| §3 L1 Recall | rotating Firestore discovery window + deterministic intent/role/local/exploration shortlist (`selectRecallCandidates`) | ✅ bounded; semantic recall still uses the available public pool |
| §3 L2 Nine feature families | `featureFamilies()`, `fitProbability()`, `FIT_WEIGHTS` | ✅ live |
| §3 L2 idf / rarity weighting | `buildCorpus()`, `idf()` | ✅ live |
| §3 L2 missing data renormalised | `fitProbability()` weight renormalisation | ✅ live (tested) |
| §3 L3 Reciprocity harmonic mean | `harmonic()`, `fitAB`/`fitBA`, `reciprocityGuard()` | ✅ live |
| §3 L3 Stable allocation | `stableAllocation()` | ✅ live (weekly allocation job not yet wired) |
| §3 L4(a) extract, don't judge | `deriveFacets()` | ✅ deterministic extractor (LLM extraction is P3) |
| §3 L4(b) banded tie-break | `applyBandedOrder()`, `TIE_BREAK_BAND` | ✅ same-band, one-position and 2.5-second bounded on client and server |
| §3 L4(c) ledger-bound reasons | `buildLedger()`, `citesLedger()`, `parseModelAnswer()` | ✅ live |
| §3 L5 MMR + caps | `mmr()`, `composePortfolio()`; local recommendations consume `ranked` | ✅ MMR live; hard role/company/city exposure caps remain incomplete |
| §3 L5 Bands, not percentages | `bandOf()`, `BANDS` | ✅ live |
| Feedback | Builder `relevant` / `not_relevant` / `contacted` is read by the ranker and cached briefly on-device | ✅ explicit feedback signal; outcome labels still need instrumentation before fitting weights |
| §16 Wonder Ladder objective | `UTILITY_WEIGHTS`, `spark`/`artifact` heads | ✅ priors (no trained head yet) |
| §17 C1–C7 chemistry axes | `voltageScore`, `shapeScore`, `rhythmScore`, `safetyScore`, `ambitionSymmetry`, `valuesAdjacency`, `effortSymmetry` | ✅ live |
| §18.3 Archetype prior matrix | `ARCHETYPE_PRIOR`, `archetypeOf()` | ✅ live |
| §18.4 Chemistry killers | `detectKillers()` | ✅ live, every killer carries a repair line |
| §18.5 Bridging bonus | `bridgingBonus()` | ✅ live |
| §19.1 Work Style Card | `WORK_STYLE_QUESTIONS`, `workStyleAxes()`, `mobile/src/components/WorkStyleCard.tsx` | ✅ live (8 forced choices, opt-in, saved to the profile) |
| §20 Conversation vitals | `computeVitals()`, `vitalityState()` | ✅ live on-device, metadata only, never uploaded |
| §21 Courtship state machine | `nextPairAction()`, `PAIR_STATES` | ✅ live (drives the "next move" strip in the thread) |
| §21.2 one nudge per state | `nextPairAction()` + `nudged[]` | ✅ live |
| §21.4 72-hour graceful close | `nextPairAction()` | ✅ copy + state transition live |
| §22 Spark prompts | `composeCard()` (deterministic templates) | ✅ live; model-written copy is bounded by `citesLedger()` |
| §23 Wonder Ladder (W0–W1) | `composeCard().tiny_task` | ✅ live |
| §24 Mirror / Complement / Wildcard | `composePortfolio()`, `slotFor()` | ✅ live |
| §46 Endings | `endingFor()` | ✅ copy live, persistence not yet |
| §47/§28 Pair data model | — | ⛔ not built (needs an hourly job + rules) |

---

## 3. The surfaces, and what changed on each

| Surface | File | Before | Now |
| --- | --- | --- | --- |
| "Who to meet" list | `mobile/src/screens/RecommendedMatchesScreen.tsx` | a `%` pill and a one-line reason | band pill, slot label, **shared** reason, **different** reason, first move, tempo note |
| Discovery dashboard | `mobile/src/screens/DiscoveryDashboardScreen.tsx` | `87%` | `STRONG` / `GOOD` / `LOOK` / `THIN` |
| Profile (viewing someone) | `mobile/src/screens/ProfileScreen.tsx` | `92%` under "Compatibility" | band label under "Why you two" |
| Active opportunities | `mobile/src/screens/ActiveOpportunitiesScreen.tsx` | `74% FIT` | band chip |
| Chat thread | `mobile/src/screens/ChatScreen.tsx` | nothing | **next move** strip: vitality state, one suggestion, the 20-minute task, a one-tap first line |
| Local ranking | `mobile/src/lib/matchmaking.ts` | 11 hand-tuned point weights | the engine, plus banded tie-break and evidence-checked reasons |
| Server ranking | `api/rankCandidates.js` | asked Gemini for a 1–100 score | canonical Firestore profiles + block/visibility checks; engine scores; Gemini only does a bounded cited tie-break |

---

## 4. What the numbers mean

`scorePair()` returns:

| Field | Meaning |
| --- | --- |
| `fitAB` / `fitBA` | "how much would A act on B" and the reverse |
| `fit` | harmonic mean of the two — a 95/30 pair lands at 45, not 62 |
| `spark` | probability the conversation actually lives (R1) |
| `artifact` | probability something gets made (R3 given R1) |
| `utility` | `guard × (0.35·fit + 0.25·spark + 0.40·artifact)` |
| `display` | `utility` through one documented monotone recalibration (`DISPLAY_CALIBRATION`) |
| `band` | the only thing a member ever sees |

`DISPLAY_CALIBRATION` is the first number to tune when real R1–R4 labels
arrive. It is strictly increasing, so it can move band cut-offs but can never
change the order of two candidates.

---

## 5. What the model is allowed to do (and what happens when it fails)

1. It receives at most twelve candidates, each with a band and up to three
   `must_cite` strings taken from that pair's ledger.
2. It returns `{ order: [...], reasons: { uid: "…" } }`.
3. Server-side, `parseModelAnswer()` rejects unknown, duplicate, or missing uids and
   drops any reason that does not cite an exact ledger phrase/token or contains a
   banned token (`match`, `%`, `perfect`, `soulmate`, `synergy`, `chemistry`,
   `vibes`, `destined`, `compatible`).
4. `applyBandedOrder()` only swaps adjacent rows within 6 display points and the
   same band; no candidate can move more than one position.
5. The call has a 2.5-second timeout, no retry, and no provider failover. If it
   throws, times out, or returns invalid output, the route answers from the engine.

---

## 6. Privacy boundaries, as implemented

* `computeVitals()` takes `{from, at, length, hasQuestion}` and returns numbers.
  There is no field for message text, and a test asserts that.
* Vitals are computed on the device and are never uploaded.
* Chemistry is never shown as a score to anybody; a member sees a band, two
  reasons and one suggestion.
* A decline never tells the other person who declined or why.
* The Work Style Card's intro says, in the UI, that it changes introductions and
  suggestions only — never visibility or standing.

---

## 7. Tests

```
npm run test:match
```

44 tests in `tests/linkup-match.test.mjs`, covering:

* the harmonic mean's one-sided penalty;
* rarity weighting (a shared niche beats a shared buzzword);
* sparse profiles not reading as perfect matches;
* eligibility, and "contacted recently" demoting rather than deleting;
* complementary pairs beating mirror twins;
* red-line vetoes;
* every chemistry killer carrying a repair line;
* no generated line containing a banned token;
* every citation pointing at a real ledger atom;
* portfolio slots never repeating;
* stable allocation capping the popular member;
* one nudge per state, ever, and a 72-hour graceful close;
* vitals containing no text field;
* the card being capped at ±3 positions;
* timestamp-stable facet extraction and neutral unknown activity/geography;
* deterministic bounded recall and exploration;
* explicit feedback demotion;
* exact LLM permutations, same-band reorders, and one-position movement;
* a model being unable to promote a weak card, and invented people being dropped.

---

## 8. Not built yet (and why that is fine)

| Gap | Why it can wait |
| --- | --- |
| A trained `spark`/`artifact` head | there are no R1–R4 labels yet; the priors are honest until there are |
| Persisted `pairState` + hourly advance job | the state machine and its copy are live and deterministic; persistence is a Firestore job and a rules change, not a design change |
| Embedding/graph recall (L1) | current recall improves coverage within the rotating public-profile window; embeddings and graph reads need indexes and measurement |
| Server-side vitals aggregation | would require the message text to leave the device, which the design forbids |
| Trained archetype bilinear table `uᵀMu` | needs a few hundred observed pairs; `ARCHETYPE_PRIOR` is the fixed prior it will start from |

---

## 9. Tuning knobs, in the order they should be touched

1. `DISPLAY_CALIBRATION` — band cut-offs only.
2. `FIT_WEIGHTS` / `CHEM_WEIGHTS` — replace with fitted coefficients once there
   are labels.
3. `VOLTAGE` exponent and confidence floor — how "seen" two people in the same
   niche should feel.
4. `ARCHETYPE_PRIOR` — replace with the learned 8×8 matrix.
5. `DISPLAY_CALIBRATION` again — recalibrate, never re-order.

Everything is versioned by `MODEL_VERSION`, which is stamped on every score and
returned by the API, so a change can be attributed to a cohort after the fact.
