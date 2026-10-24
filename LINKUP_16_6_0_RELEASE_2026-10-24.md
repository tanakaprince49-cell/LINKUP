# LINKUP 16.6.0 — honest daily retention, real dates, a downloadable League card

Android version 16.6.0 / versionCode 29. Branch `codex/mobile-port` and `main`.

This release is about one promise: **every notification and every number is
true, and every date is real.** Nothing in it invents activity, points, people
or events.

## 1. Retention: 2–4 messages a day, each one different, each one true

The old scheduler sent at most one message per 20 hours, and the message it
sent was a generic nudge. It is replaced by a fact-driven planner.

`shared/retention.js` (pure, no I/O) builds the candidate list from a fact
bundle; `api/_retention.js` collects those facts from the member's own records.
A category only exists when the number behind it exists — the planner cannot
render a sentence it has no fact for.

| Slot (member's local time) | Preferred message |
|---|---|
| 08:00–11:00 | their own calendar: last recorded day, build days this week against their target |
| 12:00–15:00 | their real league rank and points, or the real size of the board and its current leader |
| 17:00–20:00 | today's square: lit (points, streak) or still open (only if they opted into build nudges) |
| 20:00–22:00 | Sunday recap of the closing week, or a comeback line after a measured gap |

Two more categories follow the event, not the clock: a **follow-up that reached
its date** (only when the member opted into follow-up reminders) and their own
**Friday sourced-opportunity drop** (only when the weekly review actually found
something new). A follow-up message deliberately does **not** carry the
follow-up's title or note — those stay in the private workspace.

Hard guards, all enforced in one place and covered by tests:

* `prefs.retention === false` → nothing. The switch now exists in Settings
  (`Daily progress messages`) and in `sanitizePrefs`, so it can actually be
  turned off — previously the flag was readable but unreachable.
* quiet hours (`quietStart`/`quietEnd`) are checked **inside** `nextRetention`,
  not only by the cron.
* at most **4 per local day**, at least **2.5 hours** apart, and a category can
  never repeat in the same day.
* notification id is `retention_<uid>_<day>_<category>_<slot>`, so a replayed or
  concurrent cron run cannot duplicate a message.
* the push path now carries the notification reference from the transaction
  instead of rebuilding an id from `delivery.key.split(':')[0]`, which silently
  addressed the wrong document.

`nextDelivery()` is deleted from `api/_builderCore.js`. `runReminderPage` is now:
read the board once → per member, collect facts → plan → write.

## 2. Linky: 5 messages a day free, 25 for PLUS

`LINKY_FREE_DAILY` defaults to **5**, `LINKY_PLUS_DAILY` to **25** (down from
60, which the free Gemini key cannot honestly sustain). The 15-messages-a-month
free allowance is unchanged and is exactly three days at the new cap.

The over-limit copy now quotes the real numbers: *"You have used today's 5 Linky
messages. Your monthly allowance is unchanged and still has 10 messages."* The
home screen shows `N of 15 free messages left this month · M today`, and the
quota payload gained `dailyLimit`, `dailyUsed` and `dailyRemaining`.

## 3. The calendar shows every day, every week, every real date

New `shared/calendar.js` + `shared/calendar.d.ts`:

* `monthGrid(days, monthKey, now)` → a Monday-first grid of **every** date in the
  month, including leading/trailing days, with `active`, `today`, `future`,
  `inMonth` and a numeric label per cell.
* `weeksWithActivity(days)` → every recorded week as `{weekStart, days, buildDays}`.
* `monthsWithActivity(days, now)`, `dayLabel('2026-10-24') → 'Sat 24 Oct 2026'`,
  `addMonth`, `monthKeyOf`.

`ContributionCalendar` is rewritten around it with three views:

* **Month** — real dates, arrows, a "jump to today" control, a per-month count
  ("3 of 31 days recorded in October 2026"), a tappable date that opens that
  day's own entry, and a list of every month that has recorded days.
* **Recent** — the familiar 12-week square grid, unchanged ids.
* **Weeks** — one row per recorded week with the actual dates and a build-day
  count, up to 26 rows.

`contributionData` now returns `firstDay`, `lastDay`, `historyDays` and
`updatedDays`, and no longer slices history before the client sees it.

## 4. Real profile pictures in the activity competition

The activity board rows carry `image`, and every avatar goes through `photoOf()`
which reads `image → profilePic → photoURL → avatarUrl`. The league row push in
`api/_leagueSeo.js` now includes `image` for both boards, so the competition page
stops rendering empty circles. Avatars on that screen are also larger (76 px
champion, 52–56 px rows).

## 5. A League card anyone can download, any time

`api/_leagueCard.js` renders a 1080×1080 PNG of **numbers 1, 2 and 3 only**,
with a crown on #1 only.

* `GET /builder-league/card?period=week|month|year` and `/app/builder-league/card`
  (rewrites to the existing `publicSeo` function — no new serverless function),
  served as `image/png` with `Cache-Control: public, max-age=60, s-maxage=300`
  and `Content-Disposition: inline; filename="linkup-builder-league-top3.png"`.
* The public page has a **Download the top-three card** link; the app has a "Top
  three card" panel with Download and Open-page actions
  (`mobile/src/lib/leagueCard.ts`).
* Header "Top 3 · THIS WEEK", strapline "Only number one wears the crown.",
  footer "10 points per recorded build day + 5 per acknowledged helpful step ·
  UTC", "Activity, not verified skill", linkupbuild.com.
* Fewer than three entrants still renders — no invented names, no filler row.

## 6. Tests

| Suite | Result |
|---|---|
| `node --test tests/*.test.mjs` | **240 pass / 0 fail** (new `tests/retention-calendar-card.test.mjs`, 8 tests) |
| `npm run test:firestore` | **87 pass / 0 fail** |
| `node tests/contribution-browser.cjs` | PASS 390 px and 1150 px, now asserting real month labels, browsable months and the weeks view |
| `node tests/activity-league-browser.cjs` | PASS 390/1150 px, light and dark |
| `node tests/builder-browser.cjs`, `build-habit-browser.cjs` | PASS 390/1150 px |
| `npm run verify:web-routing` | all public routes PASS |
| `npm run test:seo` | 43 pass |

The new unit suite pins the things a reviewer would want pinned: the budget in
the code matches 5/25/15, every candidate declares the facts it used and quotes
a number present in them, a category cannot repeat in a day, the 4-a-day and
2.5 h guards hold, quiet hours win over every slot, the month grid contains all
31 dates exactly once, and the rendered card is a real 1080×1080 PNG with
exactly one crown.

## 7. Not verified

Native APK/AAB build, authenticated production AI and payment paths, a real
season close, Search Console indexing, and delivery of a real push to a device.
The eight existing production caveats from 16.5.0 still apply.
