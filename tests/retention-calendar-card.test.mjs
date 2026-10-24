import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { retentionCandidates, nextRetention, inQuietHours, slotFor, RETENTION, RETENTION_CATEGORIES } from '../shared/retention.js';
import { planRetention, leagueSummary, profileMissing, streakOf, utcWeekStart } from '../api/_retention.js';
import { monthGrid, monthsWithActivity, weeksWithActivity, dayLabel, addMonth, monthKeyOf, WEEKDAY_INITIALS } from '../shared/calendar.js';
import { leagueCardSvg, renderLeagueCard } from '../api/_leagueCard.js';
import { BUDGET_DEFAULTS, budgetConfig } from '../shared/linky-budget.js';
import { DEFAULT_PREFS, sanitizePrefs } from '../api/_builderCore.js';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const at = Date.parse('2026-10-24T09:00:00Z');
const baseState = (over = {}) => ({
  prefs: { inApp: true, push: false, reminders: false, dailyBuild: false, retention: true, timezone: 'UTC', quietStart: 23, quietEnd: 0, ...(over.prefs || {}) },
  followups: [], retention: { day: '', sent: [] }, lastDeliveryAt: 0, ...over,
});

test('Linky ships 5 free messages a day and 25 for PLUS, inside the 15-a-month allowance', () => {
  assert.equal(BUDGET_DEFAULTS.freeDaily, 5);
  assert.equal(BUDGET_DEFAULTS.plusDaily, 25);
  assert.equal(BUDGET_DEFAULTS.plusPerDay, 25);
  assert.equal(BUDGET_DEFAULTS.freePerMonth, 15);
  // Environment overrides still win, and nonsense falls back to the shipped value.
  assert.equal(budgetConfig({ LINKY_FREE_DAILY: '7' }).freeDaily, 7);
  assert.equal(budgetConfig({ LINKY_FREE_DAILY: '-2' }).freeDaily, 5);
  assert.equal(budgetConfig({ LINKY_PLUS_DAILY: 'abc' }).plusDaily, 25);
  // 15 a month is exactly three days at the burst cap, never a contradiction.
  assert.equal(BUDGET_DEFAULTS.freePerMonth, BUDGET_DEFAULTS.freeDaily * 3);
});

test('the four daily slots and quiet hours are local-time windows, not timestamps', () => {
  assert.equal(slotFor(7), null);
  assert.equal(slotFor(9).id, 'morning');
  assert.equal(slotFor(13).id, 'midday');
  assert.equal(slotFor(18).id, 'evening');
  assert.equal(slotFor(21).id, 'night');
  assert.equal(slotFor(23), null);
  assert.equal(inQuietHours(22, { quietStart: 21, quietEnd: 7 }), true);
  assert.equal(inQuietHours(6, { quietStart: 21, quietEnd: 7 }), true);
  assert.equal(inQuietHours(12, { quietStart: 21, quietEnd: 7 }), false);
  assert.equal(RETENTION.maxPerDay, 4);
});

test('every message is built from facts: no fact, no message', () => {
  const state = baseState();
  assert.deepEqual(retentionCandidates({ state, facts: { localDay: '2026-10-24', localHour: 13 } }), []);
  const facts = {
    localDay: '2026-10-24', localHour: 13, weekDays: 2, weekTarget: 3, lastUpdateDay: '2026-10-23',
    totalUpdates: 12, points: 120, streakDays: 2, todayRecorded: false,
    publicMomentum: true, rank: 4, points7d: 20, nextRankGap: 15, participants: 9,
    leagueParticipants: 9, topBuilderName: 'Bob', topBuilderPoints: 35,
  };
  const list = retentionCandidates({ state, facts });
  assert.ok(list.length >= 4, 'several distinct ideas are available');
  for (const item of list) {
    assert.ok(RETENTION_CATEGORIES.includes(item.category), item.category);
    assert.ok(item.used.length > 0, `${item.category} must declare the facts it used`);
    assert.doesNotMatch(item.body, /someone (just )?viewed|you are trending|don't miss out/i);
  }
  // Each body quotes a number that is in the facts it declared.
  const league = list.find(v => v.category === 'league');
  assert.match(league.body, /20 points/);
  assert.match(league.body, /15 points more passes #3/);
  assert.ok(list.every(v => v.title !== 'undefined — undefined'));
});

test('the planner never sends the same category twice a day, more than four times, or inside the gap', () => {
  const facts = { localDay: '2026-10-24', localHour: 9, weekDays: 1, weekTarget: 3, lastUpdateDay: '2026-10-23', totalUpdates: 5, streakDays: 1, todayRecorded: false, leagueParticipants: 4, topBuilderName: 'Bob', topBuilderPoints: 30 };
  const first = nextRetention({ state: baseState(), facts });
  assert.equal(first.category, 'kickoff');
  const sent = { ...baseState(), retention: { day: '2026-10-24', sent: [{ category: 'kickoff', at: at }] } };
  assert.equal(nextRetention({ state: sent, facts }), null, 'same idea again in the same day');
  const four = { ...baseState(), retention: { day: '2026-10-24', sent: ['followup', 'kickoff', 'league', 'discover'].map(category => ({ category, at })) } };
  assert.equal(nextRetention({ state: four, facts: { ...facts, localHour: 18 } }), null, 'four a day is the ceiling');
  const spaced = { ...baseState(), lastDeliveryAt: at - 60_000 };
  assert.equal(nextRetention({ state: spaced, facts }), null, 'no burst inside the minimum gap');
  const quiet = { ...baseState({ prefs: { quietStart: 8, quietEnd: 12 } }) };
  assert.equal(nextRetention({ state: quiet, facts }), null, 'quiet hours win over every slot');
  const optedOut = baseState({ prefs: { retention: false } });
  assert.equal(nextRetention({ state: optedOut, facts }), null);
  // The switch is reachable from the app, and off means off.
  assert.equal(DEFAULT_PREFS.retention, true);
  assert.equal(sanitizePrefs({ retention: false }).retention, false);
  assert.equal(sanitizePrefs({ retention: true }).retention, true);
  assert.throws(() => sanitizePrefs({ retention: 'no' }));
});

test('server facts are the member’s own recorded numbers', () => {
  const now = at;
  assert.equal(utcWeekStart(now), Date.UTC(2026, 9, 19));
  assert.equal(streakOf(['2026-10-22', '2026-10-23', '2026-10-24'], now), 3);
  assert.equal(streakOf(['2026-10-22', '2026-10-23'], now), 2, 'yesterday still counts');
  assert.equal(streakOf([], now), 0);
  assert.deepEqual(profileMissing({ displayName: 'A' }), ['a profile photo', 'a short bio', 'your role', 'your city', 'your skills']);
  assert.deepEqual(profileMissing({ profilePic: 'https://x.test/a.png', bio: 'b', occupation: 'Founder', city: 'Harare', skills: ['React'] }), []);
  const league = leagueSummary({ participants: 3, rows: [{ uid: 'a', name: 'A', rank: 1, points: 40 }, { uid: 'b', name: 'B', rank: 2, points: 25 }, { uid: 'c', name: 'C', rank: 3, points: 10 }] });
  assert.equal(league.byUid.b.nextRankGap, 15);
  assert.equal(league.byUid.c.nextRankGap, 15);
  assert.equal(league.top.name, 'A');
  // 13:00 is the league window; the morning kickoff is a different slot.
  const { message, facts } = planRetention({ uid: 'b', now: Date.parse('2026-10-24T13:00:00Z'), state: baseState(), contributions: { days: ['2026-10-23', '2026-10-24'], points: 20, totalUpdates: 2, publicMomentum: true }, user: { displayName: 'B' }, league });
  assert.equal(facts.rank, 2);
  assert.equal(facts.weekDays, 2);
  assert.equal(message.category, 'league');
  assert.match(message.body, /25 points/);
  assert.match(message.body, /passes #1/);
});

test('the calendar is a real month grid with dates, weeks and history', () => {
  const grid = monthGrid(['2026-10-01', '2026-10-24'], '2026-10', at);
  assert.equal(grid.label, 'October 2026');
  assert.equal(grid.daysInMonth, 31);
  assert.equal(grid.recorded, 2);
  assert.equal(grid.rows[0][0].day, '2026-09-28', 'a month grid always starts on a Monday');
  assert.equal(grid.rows.at(-1).at(-1).day, '2026-11-01');
  const one = grid.rows.flat().find(cell => cell.day === '2026-10-01');
  assert.equal(one.active, true);
  assert.equal(one.label, 1);
  assert.equal(grid.rows.flat().find(cell => cell.day === '2026-10-25').future, true);
  assert.equal(dayLabel('2026-10-24'), 'Sat 24 Oct 2026');
  assert.equal(addMonth('2026-01', -1), '2025-12');
  assert.equal(monthKeyOf('2026-10-24'), '2026-10');
  assert.deepEqual(monthsWithActivity(['2026-08-03', '2026-10-24', '2025-12-31'], at).slice(0, 3), ['2026-10', '2026-08', '2025-12']);
  const weeks = weeksWithActivity(['2026-10-19', '2026-10-24', '2026-10-12']);
  assert.equal(weeks.length, 2);
  assert.deepEqual(weeks[0], { weekStart: '2026-10-19', days: ['2026-10-19', '2026-10-24'], buildDays: 2 });
  assert.deepEqual([...WEEKDAY_INITIALS], ['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  // Every date in the month appears exactly once.
  const dates = grid.rows.flat().filter(cell => cell.inMonth).map(cell => cell.day);
  assert.equal(new Set(dates).size, 31);
});

test('the league top-three card exists, crowns only number one and is a real PNG', async () => {
  const board = { participants: 12, rows: [{ uid: 'a', name: 'Alice', rank: 1, points: 70, buildDays: 7 }, { uid: 'b', name: 'Bob', rank: 2, points: 50, buildDays: 5 }, { uid: 'c', name: 'Cara', rank: 3, points: 40, buildDays: 4 }] };
  const svg = leagueCardSvg({ period: 'week', rows: board.rows, participants: 12, at });
  assert.match(svg, /Top 3 · THIS WEEK/);
  assert.match(svg, /Only number one wears the crown/);
  assert.equal((svg.match(/<circle cx="\d+" cy="\d+" r="42" fill="#0A0B0D"\/>/g) || []).length, 1, 'exactly one crown badge');
  assert.match(svg, /#1/); assert.match(svg, /#2/); assert.match(svg, /#3/);
  const png = await renderLeagueCard({ period: 'week', board, at });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1080);
  // Fewer than three entrants still renders, with no invented names.
  const two = leagueCardSvg({ period: 'month', rows: board.rows.slice(0, 2), participants: 2, at });
  assert.doesNotMatch(two, /Cara/);
  // Wiring: public route, download button, app button, no auth required.
  const seo = read('api/_leagueSeo.js');
  assert.match(seo, /mode==='league-card'/);
  assert.match(seo, /Download the top-three card/);
  assert.match(read('vercel.json'), /"source": "\/builder-league\/card"/);
  assert.match(read('mobile/src/lib/leagueCard.ts'), /linkup-builder-league-top3\.png/);
  const screen = read('mobile/src/screens/TrendingBuildersScreen.tsx');
  assert.match(screen, /Download the top three builders card/);
  assert.match(screen, /photoOf\(/);
});

test('the calendar screen shows dates, a month picker and each week', () => {
  const source = read('mobile/src/components/ContributionCalendar.tsx');
  for (const text of ['Month', 'Recent', 'Weeks', 'Previous month', 'Next month', 'MONTHS WITH RECORDED DAYS', 'Week of', 'Jump to today']) {
    assert.ok(source.includes(text), text);
  }
  assert.match(source, /WEEKDAY_INITIALS/);
  // The month grid keeps the long-standing `contribution-<date>` test id so
  // existing suites and analytics keep working.
  assert.match(source, /testID=\{`contribution-\$\{cell\.day\}`\}/);
  // Server returns the real history bounds, not just a rolling window.
  const builder = read('api/_builder.js');
  assert.match(builder, /firstDay/);
  assert.match(builder, /historyDays/);
});
