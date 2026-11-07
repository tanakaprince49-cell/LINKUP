import { randomInt } from 'node:crypto';
import { chooseWeeklySpotlight, randomWeeklySpotlightAt, weeklySpotlightWindow } from '../shared/weekly-spotlight.js';
import { loadActivityLeague } from './_leagueSeo.js';
import { notifyLeagueWinner } from './_leagueNotify.js';
import { clean } from './_builderCore.js';

const randomUnit = () => randomInt(0, 1_000_000) / 1_000_000;
const shareUrlFor = (uid, weekKey) =>
  `https://www.linkupbuild.com/app/founder-spotlight/${encodeURIComponent(uid)}/${weekKey}`;

/**
 * Hourly cron hook. It persists one randomly selected draw time per UTC week,
 * then awards at most once. Ranking is over the complete currently eligible,
 * publicly opted-in activity pool (up to the existing 5,000-record safety cap);
 * if that cap is exceeded, it fails closed rather than mislabel a partial pool
 * as the best founder overall.
 */
export async function runWeeklyFounderSpotlight(db, now = Date.now(), deps = {}) {
  const window = weeklySpotlightWindow(now);
  const key = window.key;
  const ref = db.collection('weeklyFounderSpotlights').doc(key);
  const random = deps.random || randomUnit;
  const drawAt = randomWeeklySpotlightAt({ start: window.start, end: window.end, now, random });

  const scheduled = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) return snapshot.data();
    const record = {
      weekKey: key,
      weekStart: window.start,
      weekEnd: window.end,
      drawAt,
      status: 'scheduled',
      createdAt: now,
    };
    tx.set(ref, record);
    return record;
  });

  if (scheduled.status !== 'scheduled' || Number(scheduled.drawAt) > now) {
    return { weekKey: key, status: scheduled.status, drawAt: scheduled.drawAt, pending: scheduled.status === 'scheduled' };
  }

  // Existing board code filters opt-out, hidden, deleted, banned and stealth
  // accounts. Return all ranked rows only to this server-side award job.
  const loadBoard = deps.loadBoard || loadActivityLeague;
  const board = await loadBoard(db, { period: 'week', at: now, includeAll: true });
  const winner = board.complete
    ? chooseWeeklySpotlight(board.candidateRows || board.rows || [], 2)
    : null;

  const committed = await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists) return null;
    const value = current.data();
    if (value.status !== 'scheduled' || Number(value.drawAt) > now) return null;
    const awardedAt = now;
    const record = winner
      ? {
          ...value,
          status: 'awarded',
          uid: winner.uid,
          name: clean(winner.name, 80) || 'LINKUP founder',
          points: Number(winner.points) || 0,
          buildDays: Number(winner.buildDays) || 0,
          helpful: Number(winner.helpful) || 0,
          participants: Number(board.participants) || 0,
          scanned: Number(board.scanned) || 0,
          awardedAt,
          shareUrl: shareUrlFor(winner.uid, key),
        }
      : {
          ...value,
          status: 'no-winner',
          reason: board.complete ? 'minimum-activity-not-met' : 'eligible-pool-over-safety-cap',
          participants: Number(board.participants) || 0,
          scanned: Number(board.scanned) || 0,
          awardedAt,
        };
    tx.set(ref, record);
    return record;
  });

  if (!committed) return { weekKey: key, status: 'already-processed' };
  if (committed.status !== 'awarded') return { weekKey: key, status: committed.status, reason: committed.reason };

  const displayName = committed.name;
  const cohort = committed.participants;
  const body = `${displayName}, your consistency earned you this week’s LINKUP Founder Spotlight. You led the recorded activity among ${cohort} publicly opted-in founders who made progress this week: ${committed.buildDays} build days, ${committed.helpful} acknowledged helpful steps, and ${committed.points} activity points. This celebrates recorded effort—not a claim about anyone’s skill or company outcomes. Your private update text stays private. Share your spotlight and invite a founder who should be in next week’s conversation.`;
  const notify = deps.notify || notifyLeagueWinner;
  const delivery = await notify(db, {
    uid: committed.uid,
    kind: 'week',
    key,
    title: `${displayName}, you’re LINKUP’s weekly Founder Spotlight ✨`,
    body,
    url: committed.shareUrl,
    notificationType: 'founder_spotlight',
    fromName: 'LINKUP Founder Spotlight',
    meta: {
      weekKey: key,
      points: committed.points,
      buildDays: committed.buildDays,
      helpful: committed.helpful,
      participants: cohort,
      shareUrl: committed.shareUrl,
    },
    email: {
      minUserGapMs: 0,
      subject: `A private LINKUP recognition: ${displayName}, you stood out this week`,
      headline: `${displayName}, your work was noticed.`,
      body,
      ctaLabel: 'Open and share your spotlight',
    },
  }, deps.notifyOptions || {});
  await ref.set({ deliveryStatus: delivery?.notified ? 'queued' : 'failed', deliveredAt: now }, { merge: true }).catch(() => {});
  return { weekKey: key, status: 'awarded', uid: committed.uid, buildDays: committed.buildDays, points: committed.points, notification: delivery };
}
