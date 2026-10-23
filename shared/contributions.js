// Instant topic-based coaching: deterministic, no model call or chat credit.
// Contribution points describe recorded activity, never technical ability.
export const CONTRIBUTION_POINTS = 10;
export const CONTRIBUTION_HISTORY_DAYS = 366;
export const contributionDay = now => new Date(now).toISOString().slice(0, 10);
export const normalizeUpdate = text => String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
export function containsCredential(text) {
  return /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|github_pat_|ghp_[A-Za-z0-9]{20}|sk_(?:live|test)_[A-Za-z0-9]{12}|AIza[A-Za-z0-9_-]{20}|(?:password|api[_ -]?key|secret)\s*[:=]\s*["']?[A-Za-z0-9_\/-]{12}/i.test(String(text || ''));
}
export function contributionInsight(text) {
  const update = normalizeUpdate(text);
  const topics = [
    [/\b(firebase|firestore|security rules|database rules)\b/, 'Good move—test both allowed and denied database requests before shipping.', 'Your update earned 10 contribution points; measure actual read volume before estimating cost savings.'],
    [/\b(customer|customers|interview|interviews|validation|validate|survey|surveys)\b/, 'Good progress—separate what customers actually said from what you still assume.', 'Your update earned 10 contribution points; use one observed finding to choose your next experiment.'],
    [/\b(test|tests|testing|bug|bugs|debug|fixed|code|deploy|deployed|api|performance)\b/, 'Nice step—turn the change into a repeatable check so the same issue is easier to catch next time.', 'Your update earned 10 contribution points; record the before-and-after evidence alongside the fix.'],
    [/\b(launch|launched|release|released|waitlist|published|live)\b/, 'That is a step forward—choose one activation signal to watch after the release.', 'Your update earned 10 contribution points; collect feedback before deciding what to build next.'],
    [/\b(revenue|sale|sales|paid|payment|payments|pricing|price)\b/, 'Useful progress—check whether the result repeats before changing your forecast.', 'Your update earned 10 contribution points; note the customer segment and how the result was measured.'],
    [/\b(design|prototype|onboarding|ux|usability|signup|sign-up)\b/, 'Good step—watch someone attempt the flow without explaining it first.', 'Your update earned 10 contribution points; let the first point of confusion guide the next revision.'],
    [/\b(team|collaborat|partner|partners|meeting|mentor)\b/, 'Good momentum—turn the conversation into one clear action with an owner.', 'Your update earned 10 contribution points; agree on what done looks like before the next check-in.'],
  ];
  const match = topics.find(([pattern]) => pattern.test(update));
  return match ? `${match[1]} ${match[2]}` : 'Good momentum—make the next step small enough to test or ship and say what evidence would count. Your update earned 10 contribution points; one observable result will make your next check-in more useful.';
}
export function calendarWeeks(days, now = Date.now(), count = 12) {
  const today = contributionDay(now);
  const anchor = new Date(today + 'T00:00:00Z');
  const offset = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - offset - (count - 1) * 7);
  const active = new Set(Array.isArray(days) ? days.filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) : []);
  return Array.from({length: count}, (_, week) => Array.from({length: 7}, (_, weekday) => {
    const date = new Date(anchor); date.setUTCDate(date.getUTCDate() + week * 7 + weekday);
    const day = contributionDay(date.getTime()), future = day > today;
    return {day, active: !future && active.has(day), today: day === today, future};
  }));
}
