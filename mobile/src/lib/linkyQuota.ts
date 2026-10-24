import type { LinkyHome, LinkyMessageQuota } from './linkyApi';

export const FREE_LINKY_LIMIT_MESSAGE = 'You have used your 5 free Linky messages for today. Upgrade to LINKUP PLUS to keep chatting, or come back tomorrow when your allowance resets.';

export function quotaFromHome(home: LinkyHome): LinkyMessageQuota {
  if (home.messageQuota) return home.messageQuota;
  // Daily-only allowance: the monthly bucket is retired, so the legacy
  // fallback derives a day-shaped quota from the home limits.
  const period: LinkyMessageQuota['period'] = home.plus ? 'day' : (home.limits.asksPeriod || 'day');
  const limit = home.limits.asksPerDay;
  const used = home.limits.asksUsedToday;
  const unlimited = home.plus && limit === null;
  const finiteLimit = limit ?? 0;
  return {
    period, periodKey: '', limit, used, unlimited,
    remaining: unlimited ? null : Math.max(0, finiteLimit - used),
    resetAt: unlimited ? '' : (home.limits.asksResetAt || ''),
    exhausted: unlimited ? false : used >= finiteLimit,
    upgradeRequired: !home.plus && used >= finiteLimit,
    dailyLimit: unlimited ? null : limit ?? undefined,
    dailyRemaining: unlimited ? null : Math.max(0, finiteLimit - used),
  };
}
// Concurrent replies cannot restore credits just because an earlier request
// finishes later. A new server period or a plan change can reset the display.
export function mergeMessageQuota(current: LinkyMessageQuota | undefined, next: LinkyMessageQuota): LinkyMessageQuota {
  if (!current || current.period !== next.period || current.periodKey !== next.periodKey) return next;
  if (current.used <= next.used) return next;
  return current;
}
export function homeWithQuota(home: LinkyHome, next: LinkyMessageQuota): LinkyHome {
  const quota = mergeMessageQuota(home.messageQuota, next);
  return { ...home, messageQuota: quota, limits: { ...home.limits, asksPerDay: quota.limit, asksUsedToday: quota.used, asksPeriod: quota.period, asksResetAt: quota.resetAt } };
}
