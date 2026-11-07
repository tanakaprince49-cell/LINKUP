// Self-reported progress totals. Points are activity, not an expertise signal.
export const CONTRIBUTION_POINTS = 10;
export const CONTRIBUTION_HISTORY_DAYS = 366;
export const contributionDay = now => new Date(now).toISOString().slice(0, 10);
export const normalizeUpdate = text => String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
export function containsCredential(text) {
  return /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|github_pat_|ghp_[A-Za-z0-9]{20}|sk_(?:live|test)_[A-Za-z0-9]{12}|AIza[A-Za-z0-9_-]{20}|(?:password|api[_ -]?key|secret)\s*[:=]\s*["']?[A-Za-z0-9_\/-]{12}/i.test(String(text || ''));
}
export function calendarWeeks(days, now = Date.now(), count = 12) {
  const today = contributionDay(now);
  const anchor = new Date(today + 'T00:00:00Z');
  const offset = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - offset - (count - 1) * 7);
  const active = new Set(Array.isArray(days) ? days.filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) : []);
  return Array.from({length: count}, (_, week) => Array.from({length: 7}, (_, weekday) => {
    const date = new Date(anchor); date.setUTCDate(date.getUTCDate() + week * 7 + weekday);
    const day = contributionDay(date.getTime()), future = day > today;
    return {day, active: !future && active.has(day), today: day === today, future};
  }));
}
