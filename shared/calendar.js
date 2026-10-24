// Real dated calendar math for the Builder Momentum calendar.
//
// The grid used to be a wall of anonymous squares. A member could see that
// something was lit, but not which day it was, which week it belonged to, or
// what happened three months ago. These helpers produce a genuine month grid:
// weekday-aligned cells, ISO dates, today/future flags and the month's real
// counts, so the screen can show dates, weeks and a month picker.
export const MONTH_NAMES = Object.freeze(['January','February','March','April','May','June','July','August','September','October','November','December']);
export const WEEKDAY_INITIALS = Object.freeze(['M','T','W','T','F','S','S']);
const DAY = 86_400_000;
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** `YYYY-MM` for a timestamp or ISO day. */
export const monthKeyOf = value => {
  const ms = typeof value === 'number' ? value : Date.parse(String(value) + (isDay(value) ? 'T00:00:00Z' : ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 7) : '';
};

export const addMonth = (key, delta = 0) => {
  const [year, month] = String(key).split('-').map(Number);
  if (!year || !month) return '';
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

export const monthLabel = key => {
  const [year, month] = String(key).split('-').map(Number);
  return year && month ? `${MONTH_NAMES[month - 1]} ${year}` : '';
};

/**
 * A full month as week rows starting on Monday.
 * Each cell: {day, active, today, future, inMonth, label}
 */
export function monthGrid(activeDays = [], monthKey = '', now = Date.now()) {
  const key = /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : monthKeyOf(now);
  const [year, month] = key.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const today = new Date(now).toISOString().slice(0, 10);
  const active = new Set((Array.isArray(activeDays) ? activeDays : []).filter(isDay));
  const cells = [];
  for (let i = 0; i < lead; i++) {
    const d = new Date(first.getTime() - (lead - i) * DAY);
    cells.push({ day: d.toISOString().slice(0, 10), active: false, today: false, future: false, inMonth: false, label: d.getUTCDate() });
  }
  for (let date = 1; date <= daysInMonth; date++) {
    const d = new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10);
    cells.push({ day: d, active: active.has(d), today: d === today, future: d > today, inMonth: true, label: date });
  }
  while (cells.length % 7) {
    const last = Date.parse(cells.at(-1).day + 'T00:00:00Z') + DAY;
    const d = new Date(last);
    cells.push({ day: d.toISOString().slice(0, 10), active: false, today: false, future: true, inMonth: false, label: d.getUTCDate() });
  }
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  const inMonth = cells.filter(c => c.inMonth);
  return {
    key, label: monthLabel(key), rows,
    recorded: inMonth.filter(c => c.active).length,
    daysInMonth,
    firstRecorded: inMonth.find(c => c.active)?.day || '',
    lastRecorded: [...inMonth].reverse().find(c => c.active)?.day || '',
  };
}

/** Every month that holds at least one recorded day, newest first. */
export function monthsWithActivity(days = [], now = Date.now()) {
  const keys = new Set((Array.isArray(days) ? days : []).filter(isDay).map(d => d.slice(0, 7)));
  keys.add(monthKeyOf(now));
  return [...keys].sort((a, b) => b.localeCompare(a));
}

/** Group recorded days by ISO week (Monday keys), newest first. */
export function weeksWithActivity(days = []) {
  const byWeek = new Map();
  for (const day of (Array.isArray(days) ? days : []).filter(isDay)) {
    const d = new Date(day + 'T00:00:00Z');
    const offset = (d.getUTCDay() + 6) % 7;
    const start = new Date(d.getTime() - offset * DAY).toISOString().slice(0, 10);
    const entry = byWeek.get(start) || { weekStart: start, days: [], buildDays: 0 };
    entry.days.push(day); entry.buildDays++;
    byWeek.set(start, entry);
  }
  return [...byWeek.values()].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

/** Human label for a single recorded day, e.g. "Fri 24 Oct 2026". */
export function dayLabel(day) {
  if (!isDay(day)) return '';
  const d = new Date(day + 'T00:00:00Z');
  const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return `${names[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()].slice(0,3)} ${d.getUTCFullYear()}`;
}
