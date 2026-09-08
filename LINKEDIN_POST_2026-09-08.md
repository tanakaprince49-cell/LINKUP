# LinkedIn — 8 September 2026

Everything below is drawn only from today's commits on LINKUP (`e903c98`…`fcc72bb`,
8 commits, 5,098 insertions / 4,621 deletions across 30 files). Post the first one
as-is; the short version is for a second slot or for X/Threads.

---

## Main post

A user told us our AI connector had "0 personality."

They were right, and the reason was embarrassing: every sentence LINKUP's Linky
sent back was a hard-coded template. "Nobody on LINKUP fits 'fred' yet — I checked
all 56 visible members…" Nobody talks like that. Nobody *should*.

Today's fixes, in one commit each:

**1. We stopped writing Linky's sentences.**
Every reply a member reads on Telegram, on Android and on the web is now written by
the model, from a dossier of real facts about the match. Same brain, same voice,
three surfaces — no per-channel tone copy drifting apart. And if the model fails,
times out or returns junk, a deterministic plain answer takes over on the same
facts. A member never sees an AI error, because a member never meets the AI — they
meet the person.

**2. "fred" now finds Fred.**
Type a name, "is fred on LINKUP", or "send a message to fred" and you get the human,
for free — the name lookup runs *before* the daily budget check, so being out of
asks never locks you out of a person. Two people tie? Linky asks which one instead of
guessing. Someone's hidden? It names the real reason (you skipped them 3 days ago,
their inbox cap is full, they're not open to paid work) and tells you "unskip fred".

**3. Searching the internet on 250 free searches a month.**
When nobody inside fits, Linky looks at public profiles outside. The constraint is
brutal: 250 searches a month, shared by every member. So:
• one search per ask, strict operators, 100 results requested per call;
• junk (news, pricing, company pages) filtered out locally with plain string rules
  *before* a single token is spent;
• 15 profiles at a time into ONE model call that returns strict JSON — never one
  call per person, never prose back;
• raw results saved the moment they arrive, and every later judgement made from
  that saved array. No second search per person, ever;
• a monthly ledger, an hourly cap and a reserve floor the pipeline refuses to cross.
Deep data — verified emails, contact — is a separate tool that gets handed the final
URL list. Clean separation, because the search bill is the product's real limit.

**4. We deleted 3,464 lines of swiping** and ~1,000 lines of an older,
personality-free Linky that was still reachable from one screen. Two Links, one of
them rude: that was the bug report waiting to happen.

Today's best find came from the tests, not from users. Writing the emulator suite
against a real captured search page surfaced four bugs in one hour:
"livestock" tripping a junk filter looking for "stock"; a redirect URL being fetched
as `https://www.google.com` + an already-absolute URL; the no-model scoring scale
never clearing the model's own threshold, so every lead vanished whenever the model
was down; and "fred" matching "Freda Ncube" as a substring of her full name, so two
people "tied" everywhere.

That's the whole lesson: personality in an AI product isn't adjectives in a prompt.
It's refusing to make a person feel like a support ticket, and being able to prove —
with tests, on real data — that the answer you ship is the answer you meant.

LINKUP. Harare. Building in public, one boring reliable feature at a time.

---

## Short version

"0 personality," a user said about our AI connector. Correct: every reply was a
hard-coded template, and "nobody on LINKUP fits 'fred' yet — I checked all 56
visible members" is not how a human talks.

Today:
• Linky's sentences are written by the model from real match facts — same voice on
  Telegram, Android and web, with a plain deterministic fallback underneath so a
  model outage is never visible to a member.
• "fred" / "send a message to fred" resolves to the human, free, before the budget
  check. Ties ask "which one". Hidden people come with the actual reason + "unskip".
• Outside search on a 250/month free tier: one search per ask, junk filtered locally
  before any token, 15 profiles per single strict-JSON model call, raw results saved
  before judgement, no per-person second lookup, a ledger + reserve it won't cross.
• Deleted 3,464 lines of swiping and an older, ruder Linky still reachable from one
  screen.

Four real bugs came out of writing tests against a captured live search page —
including "livestock" tripping a filter looking for "stock". Personality isn't
adjectives in a prompt. It's not making a person feel like a support ticket.

---

## Notes for posting

- If you attach a screenshot, use the Telegram thread where "tapiwa" gets
  "I have two Tapiwas — which one?" That single image carries the whole post.
- Numbers are exact and verifiable from `git log --since=2026-09-08 --no-merges` and
  `git diff --stat e903c98..fcc72bb` — no rounding, no invented users.
- Do not put the SerpApi key, the bot token or the reserve number in the image.
- Hashtags: #BuildInPublic #AIProducts #Zimbabwe #Startups #Founders
