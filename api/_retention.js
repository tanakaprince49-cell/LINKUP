// Server side of the daily retention messages.
//
// Everything here is a *fact collector*: it reads what actually happened for
// this member and hands it to the pure planner in shared/retention.js. The
// planner cannot invent a number it was not given, which is what keeps the
// 2–4 daily messages true.
import { localTime, weekKey } from './_builderCore.js';
import { habitState } from '../shared/build-habit.js';
import { nextRetention, sentToday, RETENTION } from '../shared/retention.js';

const DAY = 86_400_000;
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);

/** Accept the timestamp shapes returned by Firestore, Auth and our own state. */
export function activityTimestamp(value) {
  if (typeof value?.toMillis === 'function') {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : 0;
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim()) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const seconds = Number(value?.seconds);
  return Number.isFinite(seconds) ? seconds * 1000 + Math.floor((Number(value?.nanoseconds) || 0) / 1e6) : 0;
}

/**
 * Last observed app/workspace activity. Scheduler writes to builderStates are
 * intentionally excluded: a notification job must never keep a member "active".
 */
export function lastActivityAt({ state = {}, user = {}, presence = {} } = {}) {
  return Math.max(
    activityTimestamp(user.lastActiveAt),
    activityTimestamp(presence.lastActiveAt),
    activityTimestamp(state.lastVisitAt),
  );
}

/** Monday 00:00 UTC of the week containing `ms`. */
export function utcWeekStart(ms) {
  const d = new Date(ms);
  const offset = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset);
}

/** Consecutive recorded UTC days, counting today if present, else ending yesterday. */
export function streakOf(days, now) {
  const set = new Set(Array.isArray(days) ? days : []);
  const today = dayOf(now);
  let cursor = set.has(today) ? now : now - DAY;
  let streak = 0;
  while (streak < 366) {
    if (!set.has(dayOf(cursor))) break;
    streak++;
    cursor -= DAY;
  }
  return streak;
}

const MISSING_LABELS = Object.freeze({
  photo: 'a profile photo',
  bio: 'a short bio',
  occupation: 'your role',
  location: 'your city',
  skills: 'your skills',
});

/** Which of the member's own public fields are still empty. */
export function profileMissing(user = {}) {
  const has = value => typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) && value.length > 0;
  const missing = [];
  if (!has(user.profilePic) && !has(user.profilePicUrl) && !has(user.photoURL) && !has(user.avatarUrl)) missing.push(MISSING_LABELS.photo);
  if (!has(user.bio)) missing.push(MISSING_LABELS.bio);
  if (!has(user.occupation)) missing.push(MISSING_LABELS.occupation);
  if (!has(user.city) && !has(user.country)) missing.push(MISSING_LABELS.location);
  if (!has(user.skills)) missing.push(MISSING_LABELS.skills);
  return missing;
}

/**
 * Build the fact bundle for one member.
 * `league` is the week board summary computed once per cron run:
 *   {byUid:{uid:{rank,points,nextRankGap}}, participants, top:{name,points}}
 */
export function retentionFacts({ uid = '', state = {}, contributions = {}, user = {}, presence = {}, now = Date.now(), league = null, review = null } = {}) {
  const prefs = state.prefs || {};
  const clock = localTime(now, prefs.timezone || 'UTC');
  const lastActiveAt = lastActivityAt({ state, user, presence });
  const daysSinceActive = lastActiveAt > 0 ? Math.max(0, Math.floor((now - lastActiveAt) / DAY)) : null;
  const days = Array.isArray(contributions.days) ? contributions.days.filter(d => typeof d === 'string') : [];
  const today = dayOf(now);
  const weekStart = dayOf(utcWeekStart(now));
  const weekDays = days.filter(d => d >= weekStart && d <= today).length;
  const habit = habitState(contributions);
  const helpfulWeek = (habit.awards || []).filter(a => a.day >= weekStart && a.day <= today).length;
  const mine = league?.byUid?.[uid] || null;
  const lastUpdateDay = [...days].sort().at(-1) || '';
  const daysSinceUpdate = lastUpdateDay ? Math.floor((Date.parse(today) - Date.parse(lastUpdateDay)) / DAY) : 0;
  const due = (state.followups || []).filter(f => f.status === 'open' && Number(f.dueAt) <= now)
    .sort((a, b) => Number(a.dueAt) - Number(b.dueAt));
  const weekTarget = [...(habit.goals || [])].filter(g => g.week <= weekStart).sort((a, b) => b.week.localeCompare(a.week))[0]?.target || 3;
  const week = weekKey(now, prefs.timezone || 'UTC');
  // Both of these are the member's own opt-ins, and both are only ever true
  // when a review really was computed for this run.
  const fridayDrop = Boolean(review) && prefs.friday === true && clock.weekday === 'Fri'
    && clock.hour >= 9 && clock.hour < 19 && state.lastFriday !== week;
  const digestDue = Boolean(review) && prefs.digest === true && clock.weekday === 'Sun'
    && clock.hour >= 17 && clock.hour < 20 && state.lastDigest !== week;
  return {
    localDay: clock.day,
    localHour: clock.hour,
    weekday: clock.weekday,
    isSundayEvening: clock.weekday === 'Sun' && clock.hour >= 17,
    todayRecorded: days.includes(today),
    weekDays,
    weekTarget,
    weekPoints: weekDays * 10 + helpfulWeek * 5,
    streakDays: streakOf(days, now),
    totalUpdates: Number(contributions.totalUpdates) || 0,
    points: Number(contributions.points) || 0,
    lastUpdateDay,
    daysSinceUpdate,
    lastActiveAt,
    daysSinceActive,
    publicMomentum: contributions.publicMomentum === true,
    rank: mine ? mine.rank : null,
    points7d: mine ? mine.points : 0,
    nextRankGap: mine ? mine.nextRankGap : null,
    participants: mine ? mine.participants : (league?.participants || 0),
    leagueParticipants: league?.participants || 0,
    topBuilderName: league?.top?.name || '',
    topBuilderPoints: league?.top?.points || 0,
    profileMissing: profileMissing(user),
    followupsDue: due.length,
    nextFollowupTitle: due[0]?.title || '',
    fridayDrop,
    digestDue,
    review: review || null,
  };
}

/** Compress this week's public board into the per-uid lookup the planner needs. */
export function leagueSummary(board = null) {
  if (!board || !Array.isArray(board.rows)) return null;
  const byUid = {};
  for (const row of board.rows) {
    if (!row || typeof row.uid !== 'string') continue;
    byUid[row.uid] = {
      rank: Number(row.rank) || 0,
      points: Number(row.points) || 0,
      nextRankGap: null,
      participants: Number(board.participants) || board.rows.length,
    };
  }
  // A member's real gap to the place above them, from the same ranked rows.
  for (const row of board.rows) {
    const target = byUid[row.uid];
    if (!target || target.rank <= 1) continue;
    const above = board.rows.find(r => r.rank === target.rank - 1);
    target.nextRankGap = above ? Math.max(0, Number(above.points) - target.points) : null;
  }
  const top = board.rows[0];
  return { byUid, participants: Number(board.participants) || board.rows.length, top: top ? { name: top.name || '', points: Number(top.points) || 0 } : null };
}

/**
 * Decide and describe this member's next message. Returns `{message, facts}`
 * where `message` is null when nothing is both true and due.
 */
export function planRetention({ uid, state, contributions, user, presence, now = Date.now(), league = null, review = null }) {
  const facts = retentionFacts({ uid, state, contributions, user, presence, now, league, review });
  const message = nextRetention({ state, facts, now, contributions });
  return { message, facts };
}

export const retentionKey = (uid, facts, message) => `retention_${uid}_${facts.localDay}_${message.category}_${message.slot}`;

export { sentToday, RETENTION };
