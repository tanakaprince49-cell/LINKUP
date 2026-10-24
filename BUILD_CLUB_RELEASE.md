# Linky Build Club — 16.1.0 / Android 24

A Duolingo-inspired habit loop for useful building, not coercive networking. New controls are optional. No profile demotion, frozen matches, paid protection, fabricated activity, guilt scripts or additional AI allowance.

## Member experience

- **60-second mission:** a single sentence recording a result, lesson or next step. Existing private Progress Log still awards 10 server-owned contribution points once per UTC day and immediately returns its two-sentence deterministic Linky coach response. No AI provider or credit is used for tracking, rewards or reminders.
- **Choose a weekly pace:** 3, 5 or 7 actual build days, Monday–Sunday UTC. A target can be adjusted before the first update; afterward changes apply next Monday, never retroactively rewriting the current week's target.
- **A flexible build rhythm:** count actual consecutive contribution days, with explicitly labelled protected breaks allowed to bridge the run. A rest never becomes a recorded calendar square, an actual work day, progress toward a weekly target or contribution points. Missing days never removes earned contribution points or blocks matching.
- **Permanent activity milestones:** 1, 3, 7, 14, 30, 50, 100 and 365 total recorded build days. A new milestone is celebrated in the publish receipt. These are activity markers, not skill/verification/investment endorsements.
- **Rest protection:** one free protection per UTC week, usable for today or yesterday with recent preceding progress. A second protection costs one earned token; at most three tokens can be held. Purchases cost 20 community credits. If a member subsequently records an actual update on a protected day, protection is returned; a full three-token wallet receives the 20-credit refund instead of losing overflow.
- **Helpful-feedback rewards:** the request owner acknowledges a specific useful outcome; posting alone earns nothing. Eligible feedback is at least 40 characters and the outcome at least 12. First acknowledgement can earn 5 community credits, limited to two/day, four/week and once per recipient/week. Expired rounds, self-feedback, hidden/deleted/banned/blocked eligibility failures and recently rewarded copied feedback cannot mint credits. The public feedback record shows award amount only, not private rejection details or the author's wallet.
- **Cheeky opt-in nudges:** choose an IANA timezone, preferred reminder hour and quiet hours. Scripts have minimum absence thresholds of 1, 3 and 5 days; the third genuinely turns build reminders off until resumed. No more after today's recorded update, protected rest or completed weekly target. The existing shared 20-hour retention-alert cap still applies. Due follow-ups and actual Friday/Sunday summaries keep priority.

## UI

The compact mission appears in Linky's **scrollable empty state**, not its fixed chat header. Existing chats, header quota placement and pinned composer remain intact. A compact mission also appears on Builder Workspace Today. Progress Log keeps the composer before the full habit card. Goal, wallet, rest and reminder settings are collapsed by default, so configuration does not obstruct the one-sentence action. The help board explains reward eligibility and shows successful award amounts.

## Privacy, integrity and delivery

- Habit goals, rests, credits, feedback-reward metadata and a bounded 10-message private habit inbox live under server-owned `builderContributions/{uid}`. Direct client reads/writes remain denied by the already deployed rules.
- Own-only `habit`, `habitPrefs`, `habitRest` and `habitToken` API actions ignore client-supplied identity/balance/score fields. Transactional updates protect concurrent rest claims, recognition, spending, update publication and reward caps.
- Peer calendar projection remains date/count/point summaries only: no habit settings, wallet, text, coaching or reminder inbox.
- Token request replay records retain 20 purchases. Feedback caps/duplicate hashes retain 56 days; goal history is bounded to 54 changes and rest dates to 366 days. No claim of unlimited historical replay detection or perfect semantic spam detection is made. Acknowledgements plus caps/duplicate checks are practical safeguards, not a trust certification.
- Context reset disables build reminders but does not erase/refill reward ledgers. Owner export now includes workspace, progress and habit data. Existing contribution account-deletion cleanup and missing/deleted-profile scheduler fallback cover the new fields without a new collection or Function rollout.
- New **build nudges are stored in the private habit inbox**, not the legacy `notifications` collection. This avoids legacy Cloud Function and foreground-notification duplicate/unsolicited push paths. They surface in the habit cards. Only the existing server-native push adapter is called, and only when push is explicitly enabled; push bodies contain generic cheeky scripts, never project text. Native notification targets route `/ship` before generic builder routing.
- Background browser push is not configured. In-app habit nudges load on focus/refresh; supported registered native devices may receive direct push. Provider acceptance is not proof of delivery or opening. The existing bounded, paginated hourly scheduler and quiet hours can delay or skip a preferred reminder window; no exact-time delivery guarantee is made.
- Email remains disabled. Free 15 messages/month and PLUS quotas are unchanged. Existing SEO, payments, gold UID/white check, blue verification, LinkedIn consent and no-sparkle constraints remain unchanged.

## Verification

- 195/195 broad regression/source/web-mount tests.
- 59/59 Firestore Emulator/API/rules tests, including 13 new habit cases: goals, rest integrity/concurrency, refund, replay-safe spending, helpful-feedback privacy/caps/concurrency/duplicate copy checks, opt-in scheduling, completion/quiet suppression and real auto-pause.
- Mobile TypeScript and Functions TypeScript builds.
- Production Expo web export.
- Actual BuildHabitCard browser workflow at 390px and 1150px, with isolated offline adapters: mission, queued target, reminder opt-in, spending, protected rest without fake work, feedback/settings navigation and completion. No overflow, uncaught errors or external requests.
- Existing contribution and workspace component browser workflows at both widths.
- Fullscreen Linky fixture: pinned composer, restored-history geometry, top quota placement, chats, real-profile navigation, links, LinkedIn permission, activity tools and dark mode.
- Screenshots in `artifacts/build-habit/` are the isolated component harness, not production account evidence.

Run export before, not concurrently with, mount checks. Browser tools use the scratch `BUILDER_BROWSER_TOOLS` prefix as in `V16_BUILDER_RELEASE.md`. `npm run test:builder` includes the seven new pure/source habit tests; `npm run test:habit-browser` runs the new component workflow.

## Publication scope

Publish the exact verified commit to both `codex/mobile-port` and `main`, retaining codex checked out. Existing CI deploys web/API and runs emulator checks/rules deployments. This source change does not build/publish a signed native binary or roll out the earlier unrelated Firebase notification suppression Function. The new habit push path is isolated from that legacy trigger. An external deployment report records the exact published SHA, workflow conclusions and live checks; local tests alone are not proof of production publication or authenticated/device end-to-end delivery.
