// Server-only, transactional allowance shared by app, Telegram and WhatsApp.
// Kept outside linkyState so Clear chat / Forget cannot refill credits.
import { budgetConfig, BUDGET_DEFAULTS } from '../shared/linky-budget.js';

export const MESSAGE_LIMITS = Object.freeze({ freePerMonth: BUDGET_DEFAULTS.freePerMonth, plusPerDay: BUDGET_DEFAULTS.plusPerDay });
// The provider quota belongs to the project, not the member. One shared bucket
// stops a busy morning from silently burning the whole day's model requests and
// leaving every later member with template fallbacks.
const GLOBAL_DOC = '_global';
export const monthKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);
export const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export function nextResetAt(plus, now = Date.now()) {
  const d = new Date(now);
  return plus
    ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString()
    : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}
const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
const dailyCap = (plus, config) => plus ? config.plusDaily : config.freeDaily;
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
  const config = budgetConfig(process.env);
  const cap = dailyCap(plus, config);
  const daily = usage.daily?.key === dayKey(now) ? count(usage.daily.count) : 0;
  const dailyRemaining = cap > 0 ? Math.max(0, cap - daily) : remaining;
  return { period, periodKey, limit, used, remaining, resetAt: nextResetAt(plus, now), exhausted: remaining === 0, upgradeRequired: !plus && remaining === 0, dailyLimit: cap, dailyUsed: daily, dailyRemaining };
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
  const globalRef = database.collection('linkyUsage').doc(GLOBAL_DOC);
  return database.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const quota = messageQuota(snap.exists ? snap.data() : {}, options);
    if (quota.exhausted) {
      const error = new Error(quotaMessage(quota));
      error.code = 'ask_limit'; error.messageQuota = quota;
      throw error;
    }
    const config = budgetConfig(process.env);
    const day = dayKey(options?.now);
    const daily = quota.dailyLimit > 0 && quota.dailyUsed >= quota.dailyLimit;
    if (daily) {
      const error = new Error(`You have used today's ${quota.dailyLimit} Linky messages. ${options?.plus ? 'Your daily allowance resets at midnight UTC.' : 'Your monthly allowance is unchanged and still has ' + quota.remaining + ' messages.'}`);
      error.code = 'ask_limit'; error.messageQuota = quota;
      throw error;
    }
    let shared = 0;
    if (config.globalDailyMessages > 0) {
      const bucket = await transaction.get(globalRef);
      const state = bucket.exists ? bucket.data() : {};
      shared = state.day?.key === day ? count(state.day.count) : 0;
      if (shared >= config.globalDailyMessages) {
        const error = new Error('Linky has reached today\'s shared capacity for this deployment. Your message allowance was not used. Try again after midnight UTC.');
        error.code = 'capacity'; error.messageQuota = quota; error.retryAt = nextResetAt(true, options?.now);
        throw error;
      }
      transaction.set(globalRef, { day: { key: day, count: shared + 1 } }, { merge: true });
    }
    const used = quota.used + 1;
    const patch = { [quota.period]: { key: quota.periodKey, count: used } };
    if (quota.dailyLimit > 0) patch.daily = { key: day, count: quota.dailyUsed + 1 };
    transaction.set(ref, patch, { merge: true });
    return { ...quota, used, remaining: quota.limit - used, dailyUsed: quota.dailyLimit > 0 ? quota.dailyUsed + 1 : quota.dailyUsed, dailyRemaining: quota.dailyLimit > 0 ? Math.max(0, quota.dailyLimit - quota.dailyUsed - 1) : quota.remaining, exhausted: used >= quota.limit, upgradeRequired: quota.period === 'month' && used >= quota.limit };
  });
}
// Failed processing is not a delivered message. Only refund its reserved
// period; do not accidentally subtract a credit from the following month/day.
export async function refundMessage(database, uid, reservation) {
  const ref = database.collection('linkyUsage').doc(uid);
  const globalRef = database.collection('linkyUsage').doc(GLOBAL_DOC);
  await database.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.exists ? snap.data() : {};
    const bucket = data[reservation.period];
    const day = dayKey();
    const globals = await transaction.get(globalRef);
    const shared = globals.exists ? globals.data()?.day : null;
    if (shared?.key === day && count(shared.count) > 0) {
      transaction.set(globalRef, { day: { key: day, count: count(shared.count) - 1 } }, { merge: true });
    }
    if (data.daily?.key === day && count(data.daily.count) > 0) {
      transaction.set(ref, { daily: { key: day, count: count(data.daily.count) - 1 } }, { merge: true });
    }
    if (bucket?.key !== reservation.periodKey || count(bucket.count) === 0) return;
    transaction.set(ref, { [reservation.period]: { key: reservation.periodKey, count: count(bucket.count) - 1 } }, { merge: true });
  });
}
