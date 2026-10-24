import type { LinkyHome, LinkyMessageQuota } from './linkyApi';

export const FREE_LINKY_LIMIT_MESSAGE = 'You have used all of this month\'s free Linky messages. Upgrade to LINKUP PLUS to continue, or wait until your monthly allowance resets.';

export function quotaFromHome(home: LinkyHome): LinkyMessageQuota {
  if (home.messageQuota) return home.messageQuota;
  const period: LinkyMessageQuota['period'] = home.plus ? 'day' : (home.limits.asksPeriod || 'month');
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
    dailyLimit: unlimited ? null : undefined,
    dailyRemaining: unlimited ? null : undefined,
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
