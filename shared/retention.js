// Daily retention notifications: 2–4 per day, never the same idea twice.
//
// The rule that matters more than the cadence: every sentence has to be TRUE
// for that member at that moment. So this module never invents a fact. A
// candidate exists only when the number behind it exists, and every candidate
// declares which facts it used (`used`), which the tests assert on.
//
// Slots are local-time windows, not timestamps, so a delayed cron run still
// lands somewhere sensible and quiet hours are always respected:
//
//   08:00–11:00  a private kickoff from their own calendar
//   12:00–15:00  the league (their real rank/points) or real discovery numbers
//   17:00–20:00  their own calendar for today (unrecorded → nudge, recorded → win)
//   20:00–22:00  Sunday week recap, or a comeback line after a real gap
//
// A due follow-up and the member's own Friday drop follow the event, not the
// clock, so those two are allowed in any slot (`ANY_SLOT_CATEGORIES`).
//
// Two more guards keep the product honest: at most four a day, at least
// `MIN_GAP_MS` between any two, and one message per category per local day.
import { habitReminder } from './build-habit.js';

export const RETENTION = Object.freeze({
  maxPerDay: 4,
  minGapMs: 2.5 * 60 * 60 * 1000,
  comebackAfterDays: 3,
});

export const RETENTION_CATEGORIES = Object.freeze(['followup', 'friday', 'kickoff', 'league', 'discover', 'profile', 'build', 'progress', 'digest', 'weekly', 'comeback']);
// Categories that follow a real event rather than a time window of day: a
// follow-up that reached its date, and the member's own Friday drop. They are
// still capped by the daily limit, the per-category once-a-day rule, quiet
// hours and the minimum gap.
export const ANY_SLOT_CATEGORIES = Object.freeze(['followup', 'friday']);

/** Which categories each window may speak in, most valuable first. */
export const SLOTS = Object.freeze([
  { id: 'morning', from: 8, to: 11, prefer: ['followup', 'kickoff'] },
  { id: 'midday', from: 12, to: 15, prefer: ['league', 'discover', 'profile'] },
  { id: 'evening', from: 17, to: 20, prefer: ['build', 'progress'] },
  { id: 'night', from: 20, to: 22, prefer: ['weekly', 'comeback'] },
]);

const n = value => (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0);
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** Same quiet-hours rule the rest of the builder uses, in the member's timezone. */
export function inQuietHours(hour, prefs = {}) {
  const a = Number(prefs.quietStart), b = Number(prefs.quietEnd);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return false;
  return a < b ? hour >= a && hour < b : hour >= a || hour < b;
}

export function slotFor(hour) {
  return SLOTS.find(slot => hour >= slot.from && hour < slot.to) || null;
}

/** Records already delivered today, from persisted state. */
export function sentToday(state = {}, localDay = '') {
  const retention = state.retention || {};
  if (retention.day !== localDay) return [];
  return Array.isArray(retention.sent) ? retention.sent.filter(v => v && typeof v.category === 'string') : [];
}

/**
 * Every truthful message this member could receive right now.
 * A category that lacks its facts simply does not appear.
 */
export function retentionCandidates({ state = {}, facts = {}, now = Date.now(), contributions = {} } = {}) {
  const prefs = state.prefs || {};
  const out = [];
  const add = (category, title, body, url, used, extra = {}) => out.push({ category, title, body, url, used, ...extra });

  // 1. A real obligation. Never a fake one: `followupsDue` counts open items
  //    already past their own dueAt.
  const due = n(facts.followupsDue);
  if (prefs.reminders && due) {
    add('followup', due === 1 ? 'One follow-up is due' : `${due} follow-ups are due`,
      // Never the note or the title: those stay inside the private workspace,
      // and the notification only says that something real is waiting.
      due === 1 ? 'One follow-up has reached its date. Open your private workspace and agree the next step.' : 'Several follow-ups have reached their date. Open your private workspace and clear the ones that matter.',
      '/builder?section=Follow-ups', ['followupsDue'], { section: 'Follow-ups' });
  }

  // 2. Kickoff: their own real history, no scoreboard needed.
  const weekDays = n(facts.weekDays), target = n(facts.weekTarget) || 3;
  if (facts.lastUpdateDay) {
    add('kickoff', 'One step for today',
      weekDays === 0
        ? `No build day recorded this week yet. Last one: ${facts.lastUpdateDay}. One small result today starts it.`
        : `${plural(weekDays, 'build day', 'build days')} this week, target ${target}. One more useful step keeps it moving.`,
      '/ship', ['lastUpdateDay', 'weekDays']);
  } else if (facts.totalUpdates === 0) {
    add('kickoff', 'Start your calendar',
      'Your build calendar is still empty. Record what you actually moved forward — one sentence is enough.',
      '/ship', ['totalUpdates']);
  }

  // 3. The member's own Friday drop, built from the sources the review
  //     actually found. If nothing new was sourced, there is no drop.
  const review = facts.review || {};
  const fresh = Array.isArray(review.newOpportunities) ? review.newOpportunities : [];
  if (facts.fridayDrop && fresh.length) {
    const first = fresh[0] || {};
    add('friday', 'Your Friday drop is ready',
      `${plural(fresh.length, 'sourced opportunity', 'sourced opportunities')} matched what you are working on. First: “${first.title}”${first.source ? ` — ${first.source}` : ''}. Open it, or leave it; nothing is sent anywhere on your behalf.`,
      '/builder?section=Leads', ['fridayDrop', 'review.newOpportunities'], { section: 'Leads' });
  }

  // 3b. The opt-in Sunday digest, also only from the last seven days that the
  //     review could actually see.
  if (facts.digestDue && review.meaningful) {
    add('digest', 'Last seven days, in real numbers',
      `${plural(n(review.completed?.length), 'outcome closed', 'outcomes closed')} · ${plural(n(review.followedThrough), 'follow-up finished', 'follow-ups finished')} · ${plural(n(review.replies), 'reply', 'replies')} · ${n(review.roomMilestones)} room tasks · ${plural(n(review.due), 'follow-up due now', 'follow-ups due now')}.`,
      '/builder?section=Overview', ['digestDue', 'review'], { section: 'Weekly review' });
  }

  // 4. League: only for members who opted into the public board and hold a
  //    real rank this period.
  if (facts.publicMomentum && n(facts.rank)) {
    const rank = n(facts.rank), points = n(facts.points7d);
    const gap = facts.nextRankGap == null ? null : n(facts.nextRankGap);
    add('league', rank === 1 ? 'You hold #1 this week' : `You're #${rank} this week`,
      rank === 1
        ? `${plural(points, 'point', 'points')} this week, and nobody has more. ${plural(n(facts.participants), 'builder is', 'builders are')} chasing.`
        : gap != null && gap > 0
          ? `${plural(points, 'point', 'points')}. ${plural(gap, 'point', 'points')} more passes #${rank - 1}. A recorded build day is 10.`
          : `${plural(points, 'point', 'points')} this week, ranked #${rank} of ${n(facts.participants)}.`,
      '/trending-builders', ['publicMomentum', 'rank', 'points7d']);
  }

  // 4. Real board numbers. True for everyone at that moment because they are
  //    the same public facts, and skipped entirely when nobody is on the board.
  const participants = n(facts.leagueParticipants);
  if (participants) {
    add('discover', `${plural(participants, 'builder is', 'builders are')} on the board`,
      facts.topBuilderName
        ? `This week's leader is ${facts.topBuilderName} with ${plural(n(facts.topBuilderPoints), 'point', 'points')}. See the full board.`
        : 'The week is still open. See who is building and what they recorded.',
      '/trending-builders', ['leagueParticipants']);
  }

  // 4b. Profile completeness is a real count of the member's own fields, so it
  //     is always true and always actionable for a quiet account.
  const missing = Array.isArray(facts.profileMissing) ? facts.profileMissing.slice(0, 3) : [];
  if (missing.length) {
    add('profile', `${plural(missing.length, 'profile field is', 'profile fields are')} empty`,
      `Add ${missing.join(', ')} and the right people can find you. Nothing is published that you do not save.`,
      '/profile', ['profileMissing']);
  }

  // 5. Their own evening: unrecorded day vs a real recorded day.
  const recordedToday = facts.todayRecorded === true;
  if (recordedToday) {
    add('progress', `Day ${Math.max(1, n(facts.streakDays))} is recorded`,
      `${plural(n(facts.weekDays), 'build day', 'build days')} this week · ${plural(n(facts.points), 'point', 'points')} in total. Your square is lit.`,
      '/ship', ['todayRecorded', 'streakDays', 'weekDays']);
  } else if (prefs.dailyBuild) {
    const nudge = habitReminder(state, contributions, now);
    if (nudge) add('build', 'Today is not recorded yet', nudge.content, '/ship', ['dailyBuild', 'todayRecorded'], { kind: 'build', pause: nudge.pause === true });
  } else if (n(facts.streakDays) > 0) {
    add('progress', `${plural(n(facts.streakDays), 'day', 'days')} in a row is still open`,
      'Today is not recorded yet. One honest step keeps the run alive — and nothing is lost if you rest instead.',
      '/ship', ['streakDays', 'todayRecorded']);
  }

  // 6. A real gap, measured from their own last recorded day.
  if (n(facts.daysSinceUpdate) >= RETENTION.comebackAfterDays) {
    add('comeback', `${plural(n(facts.daysSinceUpdate), 'quiet day', 'quiet days')} on your calendar`,
      `Your last recorded day was ${facts.lastUpdateDay}. Your ${plural(n(facts.points), 'point', 'points')} are still there. Pick the smallest next step.`,
      '/ship', ['daysSinceUpdate', 'lastUpdateDay']);
  }

  // 7. Sunday recap with the member's own numbers for the closing UTC week.
  if (facts.isSundayEvening) {
    add('weekly', 'Your week, in real numbers',
      `${plural(n(facts.weekDays), 'build day', 'build days')} recorded this week · ${plural(n(facts.weekPoints), 'point', 'points')}. ${
        facts.rank ? `You finished #${n(facts.rank)} on the board.` : 'The board resets Monday and your lifetime total stays.'}`,
      '/trending-builders', ['isSundayEvening', 'weekDays', 'weekPoints']);
  }

  return out.map((candidate, index) => ({
    ...candidate,
    key: `${facts.localDay || ''}:${candidate.category}`,
    order: index,
  }));
}

/**
 * The one message to deliver now, or null.
 * Called by the hourly scheduler; safe to call repeatedly.
 */
export function nextRetention({ state = {}, facts = {}, now = Date.now(), contributions = {} } = {}) {
  const prefs = state.prefs || {};
  if (prefs.retention === false) return null;
  if (prefs.inApp === false && prefs.push !== true) return null;
  if (state.lastDeliveryAt && now - state.lastDeliveryAt < RETENTION.minGapMs) return null;
  if (inQuietHours(n(facts.localHour), prefs)) return null;
  const localDay = facts.localDay || '';
  const sent = sentToday(state, localDay);
  if (sent.length >= RETENTION.maxPerDay) return null;
  const slot = slotFor(n(facts.localHour));
  if (!slot) return null;
  const allowed = slot.prefer;
  const candidates = retentionCandidates({ state, facts, now, contributions })
    .filter(candidate => allowed.includes(candidate.category) || ANY_SLOT_CATEGORIES.includes(candidate.category))
    .filter(candidate => !sent.some(v => v.category === candidate.category));
  const next = candidates[0];
  if (!next) return null;
  return { ...next, slot: slot.id, section: next.section || 'Today', content: `${next.title} — ${next.body}` };
}

/** What one cron run reports when it happens to pass this member. */
export const retentionProgress = (state, facts) => ({
  day: facts.localDay,
  delivered: sentToday(state, facts.localDay).length,
  limit: RETENTION.maxPerDay,
});
