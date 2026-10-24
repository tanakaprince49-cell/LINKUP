// Builder League weekly champion -> one seven-day campaign.
//
// Rules that must never drift:
//   * only one champion per completed UTC week, decided from recorded
//     activity that the member made public (the same board the league shows);
//   * no winner for a week with no recorded activity - never invent one;
//   * the reward is claimable for seven days after the week closes, then it is
//     locked for good (no extensions, no re-issue, no manual resurrection);
//   * a claimed reward buys exactly one campaign, serving seven days from
//     approval, then the campaign is deleted permanently.
export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;
export const REWARD = Object.freeze({ claimDays: 7, runDays: 7, placementsMax: 2 });

/** Monday 00:00 UTC containing `ms`. */
export function weekStart(ms) {
  const d = new Date(ms);
  const offset = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset);
}

/** The most recently COMPLETED week, which is what can be awarded. */
export function awardWeek(now = Date.now()) {
  const end = weekStart(now);
  const start = weekStart(end - DAY_MS);
  return { start, end, weekKey: new Date(start).toISOString().slice(0, 10) };
}

export const claimDeadline = weekEnd => weekEnd + REWARD.claimDays * DAY_MS;
export const runDeadline = startedAt => startedAt + REWARD.runDays * DAY_MS;

/** Deterministic champion: points, then build days, then helpful credit, then uid. */
export function chooseChampion(rows = []) {
  const viable = rows.filter(row => row && typeof row.uid === 'string' && Number(row.points) > 0);
  if (!viable.length) return null;
  const [top] = [...viable].sort((a, b) =>
    Number(b.points) - Number(a.points) ||
    Number(b.buildDays || 0) - Number(a.buildDays || 0) ||
    Number(b.helpful || 0) - Number(a.helpful || 0) ||
    String(a.uid).localeCompare(String(b.uid))
  );
  return { uid: top.uid, points: Number(top.points) || 0, buildDays: Number(top.buildDays) || 0, helpful: Number(top.helpful) || 0 };
}

export const toMs = value => {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** The one shape the campaign page renders. Never exposes private fields. */
export function rewardState(reward, campaign, now = Date.now()) {
  if (!reward) return { status: 'none', runDays: REWARD.runDays, placementsMax: REWARD.placementsMax };
  let status = reward.status;
  if (status === 'available' && now >= toMs(reward.claimBy)) status = 'expired';
  if (status === 'claimed' && !campaign) status = 'completed';
  const expiresAt = toMs(campaign?.expiresAt);
  return {
    status,
    weekKey: String(reward.weekKey || ''),
    points: Number(reward.points) || 0,
    buildDays: Number(reward.buildDays) || 0,
    helpful: Number(reward.helpful) || 0,
    claimBy: toMs(reward.claimBy),
    claimedAt: toMs(reward.claimedAt),
    activationDeadline: toMs(reward.activationDeadline),
    runDays: REWARD.runDays,
    placementsMax: REWARD.placementsMax,
    campaign: campaign
      ? { id: String(campaign.id || ''), status: String(campaign.status || ''), name: String(campaign.name || ''), startedAt: toMs(campaign.rewardStartedAt), expiresAt }
      : null,
    remainingMs: status === 'available'
      ? Math.max(0, toMs(reward.claimBy) - now)
      : campaign?.status === 'active' && expiresAt
        ? Math.max(0, expiresAt - now)
        : 0,
  };
}

/** Days + hours left, for copy that never overstates the window. */
export function timeLeft(ms) {
  if (!(ms > 0)) return 'now';
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h`;
  return `${Math.max(1, hours)}h`;
}
