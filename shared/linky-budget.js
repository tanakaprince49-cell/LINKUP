// How many Linky messages this deployment can honestly afford.
//
// The model quota belongs to the API project, not to the member, so every
// per-member allowance has to fit inside one shared ceiling. These numbers are
// derived, not guessed: see docs/qa/linky-allowance-plan.md for the arithmetic.
//
// Overrides (Vercel env, no redeploy of code needed):
//   LINKY_FREE_DAILY              free members, messages per UTC day (0 = no daily cap)
//   LINKY_PLUS_DAILY              PLUS members, messages per UTC day (0 = use the plan)
//   LINKY_GLOBAL_DAILY_MESSAGES   shared ceiling across every member (0 = disabled)
//   LINKY_MODEL_RPD               the provider's requests/day for the wired model
//   LINKY_CALLS_PER_MESSAGE       average model calls per delivered message
export const BUDGET_DEFAULTS = Object.freeze({
  freePerMonth: 15,
  plusPerDay: 60,
  freeDaily: 0,
  plusDaily: 60,
  globalDailyMessages: 200,
  modelRequestsPerDay: 500,
  callsPerMessage: 2.1,
  headroom: 0.2,
});

const num = (value, fallback, min = 0, max = 1_000_000) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
};

export function budgetConfig(env = {}) {
  return {
    ...BUDGET_DEFAULTS,
    freeDaily: num(env.LINKY_FREE_DAILY, BUDGET_DEFAULTS.freeDaily, 0, 500),
    plusDaily: num(env.LINKY_PLUS_DAILY, BUDGET_DEFAULTS.plusDaily, 0, 500),
    globalDailyMessages: num(env.LINKY_GLOBAL_DAILY_MESSAGES, BUDGET_DEFAULTS.globalDailyMessages, 0, 100_000),
    modelRequestsPerDay: num(env.LINKY_MODEL_RPD, BUDGET_DEFAULTS.modelRequestsPerDay, 1, 10_000_000),
    callsPerMessage: Number(env.LINKY_CALLS_PER_MESSAGE) > 0 ? Number(env.LINKY_CALLS_PER_MESSAGE) : BUDGET_DEFAULTS.callsPerMessage,
  };
}

/** Messages the shared provider quota can actually deliver in a day. */
export function sustainableMessages({ modelRequestsPerDay, callsPerMessage, headroom }) {
  const usableRequests = modelRequestsPerDay * (1 - headroom);
  return Math.max(0, Math.floor(usableRequests / Math.max(0.1, callsPerMessage)));
}

/** Per-member daily allowance that 500 members can share without starving. */
export function fairShare({ messagesPerDay, members, activeShare = 0.25 }) {
  const active = Math.max(1, Math.round(members * activeShare));
  return Math.max(0, Math.floor(messagesPerDay / active));
}

export function budgetReport(env = {}) {
  const config = budgetConfig(env);
  const messagesPerDay = sustainableMessages(config);
  const report = { config, messagesPerDay };
  for (const members of [100, 500, 1_000]) {
    report[`active_${members}`] = fairShare({ messagesPerDay, members });
  }
  report.monthlyFor500 = Math.floor(messagesPerDay * 30 / 500);
  report.freeMonthsCovered = Math.floor(messagesPerDay * 30 / Math.max(1, 500 * config.freePerMonth));
  return report;
}
