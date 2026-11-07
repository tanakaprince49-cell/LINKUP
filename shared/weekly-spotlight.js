import { dayOf, weekOf } from './build-habit.js';

const DAY_MS = 86_400_000;

export function weeklySpotlightWindow(at = Date.now()) {
  const key = weekOf(dayOf(at));
  const start = Date.parse(`${key}T00:00:00.000Z`);
  return { key, start, end: start + 7 * DAY_MS };
}

/** Random future draw time inside this UTC week; called once and then persisted. */
export function randomWeeklySpotlightAt({ start, end, now = Date.now(), random = Math.random, minimumDelayMs = 60_000 } = {}) {
  const low = Math.max(Number(start) || 0, now + Math.max(0, minimumDelayMs));
  if (low >= end) return now;
  const sample = Math.min(0.999999999999, Math.max(0, Number(random()) || 0));
  return low + Math.floor(sample * (end - low));
}

/**
 * Recognition means sustained recorded activity, not verified skill:
 * at least two distinct build days, then points, days, helpful steps and UID
 * provide a deterministic order. Only the caller's opted-in, currently
 * eligible candidate set should be passed here.
 */
export function chooseWeeklySpotlight(rows = [], minimumBuildDays = 2) {
  const eligible = rows.filter(row =>
    row && typeof row.uid === 'string' && row.uid &&
    Number(row.points) > 0 && Number(row.buildDays) >= minimumBuildDays
  );
  eligible.sort((a, b) =>
    Number(b.points) - Number(a.points) ||
    Number(b.buildDays || 0) - Number(a.buildDays || 0) ||
    Number(b.helpful || 0) - Number(a.helpful || 0) ||
    String(a.uid).localeCompare(String(b.uid))
  );
  return eligible[0] || null;
}
