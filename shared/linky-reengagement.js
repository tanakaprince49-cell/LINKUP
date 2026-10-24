// Linky's welcome-back campaign: catchy copy, real inactivity, no fake news.
//
// This module is deliberately deterministic. A comeback invitation does not
// spend AI credits, invent a match/message, or claim that something happened
// while the member was away. The server records which headline was used so the
// next eligible invitation rotates to a different one.

export const LINKY_REENGAGEMENT = Object.freeze({
  afterDays: 3,
  cooldownMs: 3 * 24 * 60 * 60 * 1000,
});

export const LINKY_COMEBACK_SCRIPTS = Object.freeze([
  Object.freeze({
    key: 'next-move',
    title: 'Your next move is calling.',
    body: 'Open LINKUP and choose one small, useful step. No catching up required.',
  }),
  Object.freeze({
    key: 'comeback-arc',
    title: 'Ready for your comeback arc?',
    body: 'Linky kept your place. Pick up where you left off and make today count in one small way.',
  }),
  Object.freeze({
    key: 'one-tap',
    title: 'One tap. Back in motion.',
    body: 'Return to your workspace and turn a fresh start into one honest next step.',
  }),
  Object.freeze({
    key: 'plot-twist',
    title: 'Plot twist: today can be different.',
    body: 'You do not need a perfect plan. Come back, choose one move and let momentum follow.',
  }),
  Object.freeze({
    key: 'big-dreams',
    title: 'Big dreams. Tiny next step.',
    body: 'Your goals do not need a marathon today. Open LINKUP and choose the smallest useful action.',
  }),
  Object.freeze({
    key: 'future-self',
    title: 'Your future self says: one small step.',
    body: 'No guilt and no streak debt. Linky can help you find a practical way forward.',
  }),
  Object.freeze({
    key: 'less-scrolling',
    title: 'Less scrolling. More shipping.',
    body: 'Give your next idea ten focused minutes. Your LINKUP workspace is ready when you are.',
  }),
  Object.freeze({
    key: 'next-chapter',
    title: 'Your next chapter is still wide open.',
    body: 'Come back for a fresh plan, a useful conversation, or one small build step.',
  }),
]);

const wholeNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

export function nextLinkyHeadlineIndex(index = 0) {
  return (wholeNumber(index) + 1) % LINKY_COMEBACK_SCRIPTS.length;
}

/**
 * Return one welcome-back invitation, or null when it is not due.
 *
 * Required fact: `daysSinceActive`, measured by the server from real activity
 * timestamps. Unknown activity fails closed rather than guessing that somebody
 * is inactive. `welcomeBack`, global retention, delivery-channel, quiet-hour,
 * daily-cap and minimum-gap preferences remain enforced by shared/retention.js.
 */
export function linkyComebackCandidate({ state = {}, facts = {}, now = Date.now() } = {}) {
  if (state.prefs?.welcomeBack === false) return null;

  const days = facts.daysSinceActive;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < LINKY_REENGAGEMENT.afterDays) return null;

  const lastComebackAt = Number(state.lastComebackAt) || 0;
  if (lastComebackAt > 0 && now - lastComebackAt < LINKY_REENGAGEMENT.cooldownMs) return null;

  const headlineIndex = wholeNumber(state.comebackSequence) % LINKY_COMEBACK_SCRIPTS.length;
  const script = LINKY_COMEBACK_SCRIPTS[headlineIndex];
  const absence = `${days} ${days === 1 ? 'day' : 'days'} since your last visit.`;

  return {
    category: 'comeback',
    title: script.title,
    body: `${absence} ${script.body}`,
    url: '/builder?section=Today',
    used: ['daysSinceActive'],
    section: 'Today',
    campaign: 'linky_reengagement',
    headlineKey: script.key,
    headlineIndex,
    pushTitle: `Linky · ${script.title}`,
  };
}
