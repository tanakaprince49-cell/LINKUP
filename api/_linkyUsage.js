// Server-only, transactional allowance shared by app, Telegram and WhatsApp.
// Kept outside linkyState so Clear chat / Forget cannot refill credits.
//
// The free allowance is DAILY-ONLY: LINKY_FREE_DAILY messages (default 5)
// per UTC day, resetting at midnight UTC. There is no monthly bucket: the
// header shows "5 free messages today" and the composer locks when the five
// are used up. PLUS is unlimited.
import { budgetConfig, BUDGET_DEFAULTS } from '../shared/linky-budget.js';

export const MESSAGE_LIMITS = Object.freeze({ freePerDay: BUDGET_DEFAULTS.freePerDay, plusPerDay: BUDGET_DEFAULTS.plusPerDay });
// The provider quota belongs to the project, not the member. The shared bucket
// protects free-plan capacity and records all use; PLUS is never rejected by it.
const GLOBAL_DOC = '_global';
export const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
// Every allowance — free daily or PLUS bookkeeping — resets at UTC midnight.
export function nextResetAt(plus = false, now = Date.now()) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}
const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
export function messageQuota(usage = {}, { plus = false, now = Date.now(), legacyState = {} } = {}) {
  const period = 'day';
  const periodKey = dayKey(now);
  const daily = usage.daily?.key === periodKey ? count(usage.daily.count) : 0;
  // Null is an explicit unlimited contract, not a very large finite allowance.
  // The daily bucket remains for PLUS usage audits and failure refunds.
  if (plus) return {
    period, periodKey, limit: null, used: daily, remaining: null, resetAt: '',
    exhausted: false, upgradeRequired: false, unlimited: true,
    dailyLimit: null, dailyUsed: daily, dailyRemaining: null,
  };
  // Historical monthly ledgers (usage.month) are deliberately ignored: the
  // monthly allowance is retired and every free member starts each UTC day
  // with a fresh daily allowance.
  void legacyState;
  const config = budgetConfig(typeof process !== 'undefined' ? process.env : {});
  const limit = Math.max(0, config.freeDaily);
  const used = daily;
  const remaining = Math.max(0, limit - used);
  const exhausted = used >= limit;
  return {
    period, periodKey, limit, used, remaining,
    resetAt: nextResetAt(false, now), exhausted,
    upgradeRequired: exhausted, unlimited: false,
    dailyLimit: limit, dailyUsed: used, dailyRemaining: remaining,
  };
}
export function quotaMessage(quota) {
  if (quota.unlimited) return 'LINKUP PLUS includes unlimited Linky messages.';
  if (!quota.limit) return 'Free Linky messages are currently paused on this deployment. Upgrade to LINKUP PLUS to keep chatting.';
  return `You have used your ${quota.limit} free Linky messages for today. Upgrade to LINKUP PLUS to keep chatting, or come back tomorrow — your allowance resets at midnight UTC.`;
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
    const config = budgetConfig(typeof process !== 'undefined' ? process.env : {});
    const day = dayKey(options?.now);
    if (config.globalDailyMessages > 0) {
      const bucket = await transaction.get(globalRef);
      const state = bucket.exists ? bucket.data() : {};
      const shared = state.day?.key === day ? count(state.day.count) : 0;
      // Unlimited means no hidden deployment-wide allowance for PLUS either.
      // PLUS still increments the counter so budget reports retain actual use.
      if (!quota.unlimited && shared >= config.globalDailyMessages) {
        const error = new Error('Linky has reached today\'s shared capacity for this deployment. Your message allowance was not used. Try again after midnight UTC.');
        error.code = 'capacity'; error.messageQuota = quota; error.retryAt = nextResetAt(true, options?.now);
        throw error;
      }
      transaction.set(globalRef, { day: { key: day, count: shared + 1 } }, { merge: true });
    }
    const used = quota.used + 1;
    transaction.set(ref, { daily: { key: quota.periodKey, count: used } }, { merge: true });
    const remaining = quota.unlimited ? null : Math.max(0, quota.limit - used);
    return {
      ...quota, used, remaining, dailyUsed: used,
      dailyRemaining: quota.unlimited ? null : remaining,
      exhausted: quota.unlimited ? false : used >= quota.limit,
      upgradeRequired: !quota.unlimited && used >= quota.limit,
    };
  });
}
// Failed processing is not a delivered message. Only refund its reserved
// day; do not accidentally subtract a credit from the following day.
export async function refundMessage(database, uid, reservation) {
  const ref = database.collection('linkyUsage').doc(uid);
  const globalRef = database.collection('linkyUsage').doc(GLOBAL_DOC);
  await database.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.exists ? snap.data() : {};
    const bucket = data.daily;
    const day = dayKey();
    const globals = await transaction.get(globalRef);
    const shared = globals.exists ? globals.data()?.day : null;
    if (shared?.key === day && count(shared.count) > 0) {
      transaction.set(globalRef, { day: { key: day, count: count(shared.count) - 1 } }, { merge: true });
    }
    if (bucket?.key !== (reservation?.periodKey || day) || count(bucket?.count) === 0) return;
    transaction.set(ref, { daily: { key: bucket.key, count: count(bucket.count) - 1 } }, { merge: true });
  });
}
