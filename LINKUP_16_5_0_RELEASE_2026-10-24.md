# LINKUP 16.5.0 — streak card rebuild, League redesign, monthly and yearly champions

Branch `codex/mobile-port` + `main`. Android version 16.5.0 / versionCode 28.

## 1. The streak card was blank — root cause and fix

The card is a server-rendered 1080×1080 PNG (`api/_momentumCard.js`, served at
`/app/momentum/:uid/card`). It was passing the bundled font as `fontBuffers`,
which `@resvg/resvg-js` does not support, so every `<text>` node silently
rendered as nothing: a black card with a yellow rectangle and a grey grid.

Fix: the bundled face (`api/_assets/LinkupSans-Bold.ttf`) is now written once to
a temp file and registered through `font.fontFiles`, with `loadSystemFonts:false`
and `defaultFontFamily: 'DejaVu Sans'`. A regression test renders the same frame
twice (with and without a word) and fails if the text version is not
substantially larger, which is exactly what a missing font looks like.

## 2. The new card

Warm cream sheet, not a black slab:

| Band | Content |
|---|---|
| Header | **LINKUP** in a **gold** plate (the black brand band is gone), "THE BUILDER NETWORK", "MOMENTUM CARD" |
| Identity | 132 px photo (or initial), name auto-sized to fit 30 characters, occupation, blue/gold ticks, optional champion crown + ribbon |
| Hero | Gold gradient panel: the streak number, "CONSECUTIVE DAY STREAK", recorded days and points, and a /7 ring for this week |
| Stats | Three tiles: recorded days, build points, helpful steps |
| Calendar | Last 12 weeks (84 squares) on ink, with "27/84 days recorded in this window" and a legend |
| Footer | linkupbuild.com, the date, "activity, not verified skill", "BUILD · HELP · CLIMB" |

Champion cards add a crown on the avatar and a ribbon: `WEEK CHAMPION 12 OCT – 18 OCT`,
`MONTH CHAMPION SEP 2026`, or `YEAR CHAMPION 2025`.

Samples: `docs/qa/league-16-5/streak-card.png`, `streak-card-champion.png`.

## 3. Builder League, rebuilt

**Two pages, in the order you asked for**

1. **Builders** (opens first) — every eligible public builder with their **league position** (`#1`, `#2`, …) and points, profile photo, name, role, city and badges. Tapping any row opens that person's profile page. Builders who have not opted into activity still appear (no position).
2. **Activity competition** — the scored board:
   - **Number 1 wears a crown** on a gold champion card: photo, name, points, build days, helpful steps.
   - **The first four are featured** as a podium strip under the champion.
   - **Everyone else follows below** as numbered rows.
   - Your own place card, "what winning gets you", season champions, and the full rules.

**Periods:** This week · This month · This year. Weeks reset Monday 00:00 UTC,
months on the 1st, years on 1 January, with a live countdown.

**No black brand band.** The header is a gold card — `LINKUP / THE BUILDER NETWORK`
in dark gold ink on yellow, with the headline in ink. The only dark surfaces are
the ink accents on buttons and the tinted "what winning gets you" panel.

## 4. What winning gets you (now stated on the page)

* **Weekly champion** — one campaign of their own, run for **exactly seven days**:
  claimed on the Campaigns page within seven days of the win, live for one week
  after approval, then **deleted for good** and locked. No extension, no second
  campaign, nothing carried over.
* **Monthly champion** — the month title kept permanently, their name in the
  champions list, and a champion version of their streak card.
* **Yearly champion** — the same, for the whole year.

`shared/league-season.js` resolves the **last completed** month/year in UTC, so a
cron re-run can never mint a second trophy and an unfinished season never has a
winner. `api/_leagueChampions.js` stores `leagueChampions/{month-YYYY-MM|year-YYYY}`
(`uid`, public name, points, build days, helpful steps, dates), awards inside a
transaction, writes `no-winner` for an empty season, and resolves the strongest
title for the card ribbon (year → month → week). The hourly builder cron now runs
`awardWeeklyChampion`, `reconcileCampaignRewards` **and** `awardSeasonChampions`,
each isolated so a league failure can never block reminders.

Public policy: `leagueChampions` is readable by signed-in members and writable by
nobody; it holds only what the leaderboard already shows. The public league page
(`/builder-league`, `/builder-league/month`, `/builder-league/year`, `/builder-league/all`)
lists the current champions and explains the weekly prize.

## 5. Verification

- `node --test tests/*.test.mjs` → **232/232** (8 new: season windows, yearly
  scoring, single-grant champions, empty season, ribbon precedence, card text,
  font regression, cron wiring).
- `npm run test:firestore` (emulator) → **87/87**, including the real
  `awardWeeklyChampion` grant, hidden-profile exclusion, idempotent re-run, the
  no-activity week, and `leagueChampions` rules (signed-in read, no writes).
- `npm --prefix mobile run typecheck` → clean.
- `build:web` + `test:web-browser` → all three proxy modes pass.
- `activity-league-browser.cjs` (390/1150 px, light + dark) → pass, including the
  crowned number 1, the Builders positions, period switching and profile opens.
  `builder-browser`, `build-habit-browser`, `contribution-browser` → pass.
- Screenshots: `docs/qa/league-16-5/`.

## 6. Still open

- Monthly/yearly awards have been exercised only against the emulator and unit
  fixtures; the first real season close is 1 Nov 2026 for October.
- The card is verified as rendered bytes locally; production confirmation is the
  live URL after deploy.
- No native APK/AAB build in this release.
