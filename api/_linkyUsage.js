// Server-only, transactional allowance shared by app, Telegram and WhatsApp.
// Kept outside linkyState so Clear chat / Forget cannot refill credits.
export const MESSAGE_LIMITS = Object.freeze({ freePerMonth: 15, plusPerDay: 60 });
export const monthKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);
export const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export function nextResetAt(plus, now = Date.now()) {
  const d = new Date(now);
  return plus
    ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString()
    : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}
const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
export function messageQuota(usage = {}, { plus = false, now = Date.now(), legacyState = {} } = {}) {
  const period = plus ? 'day' : 'month';
  const periodKey = plus ? dayKey(now) : monthKey(now);
  const bucket = usage[period];
  // Preserve PLUS's current daily use during rollout. The new free monthly
  // allowance starts at zero on first use; historical daily totals are unknown.
  const used = bucket?.key === periodKey ? count(bucket.count)
    : plus && legacyState.asks?.day === periodKey ? count(legacyState.asks.count) : 0;
  const limit = plus ? MESSAGE_LIMITS.plusPerDay : MESSAGE_LIMITS.freePerMonth;
  const remaining = Math.max(0, limit - used);
  return { period, periodKey, limit, used, remaining, resetAt: nextResetAt(plus, now), exhausted: remaining === 0, upgradeRequired: !plus && remaining === 0 };
}
export function quotaMessage(quota) {
  return quota.period === 'month'
    ? 'You have used all 15 free Linky messages for this calendar month. Upgrade to LINKUP PLUS to continue, or wait until your monthly allowance resets.'
    : 'You have used your 60 Linky messages for today. Your PLUS allowance resets at midnight UTC.';
}
export async function readMessageQuota(database, uid, options) {
  const snap = await database.collection('linkyUsage').doc(uid).get();
  return messageQuota(snap.exists ? snap.data() : {}, options);
}
export async function reserveMessage(database, uid, options) {
  const ref = database.collection('linkyUsage').doc(uid);
  return database.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const quota = messageQuota(snap.exists ? snap.data() : {}, options);
    if (quota.exhausted) {
      const error = new Error(quotaMessage(quota));
      error.code = 'ask_limit'; error.messageQuota = quota;
      throw error;
    }
    const used = quota.used + 1;
    transaction.set(ref, { [quota.period]: { key: quota.periodKey, count: used } }, { merge: true });
    return { ...quota, used, remaining: quota.limit - used, exhausted: used >= quota.limit, upgradeRequired: quota.period === 'month' && used >= quota.limit };
  });
}
// Failed processing is not a delivered message. Only refund its reserved
// period; do not accidentally subtract a credit from the following month/day.
export async function refundMessage(database, uid, reservation) {
  const ref = database.collection('linkyUsage').doc(uid);
  await database.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const bucket = snap.exists ? snap.data()[reservation.period] : null;
    if (bucket?.key !== reservation.periodKey || count(bucket.count) === 0) return;
    transaction.set(ref, { [reservation.period]: { key: reservation.periodKey, count: count(bucket.count) - 1 } }, { merge: true });
  });
}
