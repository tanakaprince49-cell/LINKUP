const DAY = 86_400_000;
export type ReviewState = { firstSeenAt: number; activeDays: string[]; actions: number; requestedAt: number[] };
export function reviewState(value: unknown, now = Date.now()): ReviewState {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<ReviewState>;
  return {
    firstSeenAt: typeof v.firstSeenAt === 'number' && v.firstSeenAt > 0 ? v.firstSeenAt : now,
    activeDays: Array.isArray(v.activeDays) ? v.activeDays.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-30) : [],
    actions: typeof v.actions === 'number' && Number.isFinite(v.actions) ? Math.max(0, Math.floor(v.actions)) : 0,
    requestedAt: Array.isArray(v.requestedAt) ? v.requestedAt.filter((t) => Number.isFinite(t) && t > now - 365 * DAY).slice(-3) : [],
  };
}
export function withReviewVisit(state: ReviewState, now = Date.now()): ReviewState {
  const day = new Date(now).toISOString().slice(0, 10);
  return { ...state, activeDays: Array.from(new Set([...state.activeDays, day])).slice(-30) };
}
export function eligibleForReview(state: ReviewState, now = Date.now()): boolean {
  // Neutral experience-based timing, never based on sentiment, purchase, stars,
  // or promised rewards. Google applies its own additional display quota.
  return now - state.firstSeenAt >= 3 * DAY && new Set(state.activeDays).size >= 3 && state.actions >= 5
    && state.requestedAt.length < 3 && state.requestedAt.every((at) => now - at >= 90 * DAY);
}
export const SAFE_REVIEW_ROUTES = new Set(['Dashboard', 'Feed', 'News']);
