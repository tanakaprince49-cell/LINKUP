// Monthly and yearly Builder League seasons. A season is only decided once it
// has actually finished: the window below always points at the last COMPLETE
// month (or year) in UTC, so the same runner can be retried all day without
// ever handing out a second trophy or a title for an unfinished race.
export const SEASON_PERIODS = Object.freeze(['month', 'year']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function seasonWindow(period, now = Date.now()) {
  const d = new Date(now);
  if (period === 'month') {
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
    const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    return { period, key: new Date(start).toISOString().slice(0, 7), start, end };
  }
  if (period === 'year') {
    const year = d.getUTCFullYear() - 1;
    return { period, key: String(year), start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) };
  }
  throw new Error('Unknown season period');
}

export const seasonDocId = (period, key) => `${period}-${key}`;

export function seasonLabel(period, key) {
  if (period === 'month') {
    const [year, month] = String(key).split('-');
    return `${MONTHS[Number(month) - 1] || month} ${year}`;
  }
  return String(key);
}
