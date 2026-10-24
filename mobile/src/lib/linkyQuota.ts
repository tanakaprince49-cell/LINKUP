import type { LinkyHome, LinkyMessageQuota } from './linkyApi';

export const FREE_LINKY_LIMIT_MESSAGE = 'You have used all of this month\'s free Linky messages. Upgrade to LINKUP PLUS to continue, or wait until your monthly allowance resets.';

export function quotaFromHome(home: LinkyHome): LinkyMessageQuota {
  if (home.messageQuota) return home.messageQuota;
  const period = home.plus ? 'day' : (home.limits.asksPeriod || 'month');
  const limit = home.limits.asksPerDay;
  const used = home.limits.asksUsedToday;
  return { period, periodKey: '', limit, used, remaining: Math.max(0, limit - used), resetAt: home.limits.asksResetAt || '', exhausted: used >= limit, upgradeRequired: !home.plus && used >= limit };
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
