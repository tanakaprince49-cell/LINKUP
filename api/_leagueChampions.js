// Monthly and yearly Builder League champions.
//
// The weekly prize is a campaign (campaignRewards). A month or a year cannot
// buy "one more week", so the season winners get the permanent thing instead:
// their name and totals recorded in leagueChampions, a champion card, and a
// place on the league page. Awarding is idempotent by document id, uses only
// publicly opted-in recorded activity, and never invents a winner for a season
// where nobody recorded anything.
import { seasonDocId, seasonWindow, SEASON_PERIODS } from '../shared/league-season.js';
import { awardWeek, chooseChampion } from '../shared/campaign-reward.js';
import { loadActivityLeague } from './_leagueSeo.js';
import { clean } from './_builderCore.js';
import { REWARD_COLLECTION } from './_campaignReward.js';
import { notifyLeagueWinner } from './_leagueNotify.js';

export const CHAMPION_COLLECTION = 'leagueChampions';

const summary = (period, window, champion, participants, now) => ({
  period,
  key: window.key,
  start: window.start,
  end: window.end,
  awardedAt: now,
  participants,
  uid: champion.uid,
  name: champion.name || '',
  points: champion.points,
  buildDays: champion.buildDays,
  helpful: champion.helpful,
  status: 'champion',
});

/** Grant the last completed month/year. Safe to run on every cron tick. */
export async function awardSeasonChampion(db, period, now = Date.now(), deps = {}) {
  if (!SEASON_PERIODS.includes(period)) throw new Error('Unknown season period');
  const window = seasonWindow(period, now);
  const id = seasonDocId(period, window.key);
  const ref = db.collection(CHAMPION_COLLECTION).doc(id);
  if ((await ref.get()).exists) return { period, key: window.key, skipped: true };
  const board = await loadActivityLeague(db, { period, at: window.end - 1 });
  const rows = (board.rows || []).map(row => ({
    uid: row.uid,
    name: clean(row.name, 80),
    points: row.points,
    buildDays: row.buildDays,
    helpful: row.helpful,
  }));
  const winner = chooseChampion(rows);
  // chooseChampion keeps only the scoring fields, so the public name is
  // re-attached from the same row before it is stored.
  const champion = winner ? { ...winner, name: rows.find(r => r.uid === winner.uid)?.name || '' } : null;
  let granted = false;
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (current.exists) return;
    tx.set(ref, champion
      ? summary(period, window, champion, Number(board.participants) || 0, now)
      // A season nobody competed in stays empty on purpose: no filler champion.
      : { period, key: window.key, start: window.start, end: window.end, awardedAt: now, participants: Number(board.participants) || 0, status: 'no-winner' });
    granted = !!champion;
  });
  if (granted && champion) {
    await notifyLeagueWinner(db, {
      uid: champion.uid,
      kind: period,
      key: window.key,
      title: `Builder League ${period} champion!`,
      body: `${champion.name || 'Champion'} takes ${window.key} with ${champion.points} points and ${champion.buildDays} build days. The title and champion card are yours.`,
      url: '/builder-league',
      meta: { period, seasonKey: window.key, points: champion.points, buildDays: champion.buildDays, helpful: champion.helpful || 0 },
    }, deps).catch(() => null);
  }
  return { period, key: window.key, granted };
}

export async function awardSeasonChampions(db, now = Date.now(), deps = {}) {
  const out = {};
  for (const period of SEASON_PERIODS) {
    out[period] = await awardSeasonChampion(db, period, now, deps).catch(() => null);
  }
  return out;
}

const publicChampion = (period, key, data) => data?.status === 'champion'
  ? {
      kind: period,
      key,
      uid: String(data.uid || ''),
      name: clean(data.name, 80),
      points: Number(data.points) || 0,
      buildDays: Number(data.buildDays) || 0,
      helpful: Number(data.helpful) || 0,
      start: Number(data.start) || 0,
      end: Number(data.end) || 0,
    }
  : null;

/** Last completed month and year champions, or null where nobody qualified. */
export async function readSeasonChampions(db, now = Date.now()) {
  const month = seasonWindow('month', now), year = seasonWindow('year', now);
  const refs = [
    db.collection(CHAMPION_COLLECTION).doc(seasonDocId('month', month.key)),
    db.collection(CHAMPION_COLLECTION).doc(seasonDocId('year', year.key)),
  ];
  const snaps = await db.getAll(...refs).catch(() => []);
  return {
    month: publicChampion('month', month.key, snaps[0]?.exists ? snaps[0].data() : null),
    year: publicChampion('year', year.key, snaps[1]?.exists ? snaps[1].data() : null),
  };
}

/**
 * The strongest title this member currently holds, used for the champion
 * ribbon on their card. Year beats month beats week; the week title comes from
 * the reward document that already drives the campaign prize.
 */
export async function championFor(db, uid, now = Date.now()) {
  if (!uid) return null;
  const week = awardWeek(now);
  const month = seasonWindow('month', now), year = seasonWindow('year', now);
  const refs = [
    db.collection(REWARD_COLLECTION).doc(week.weekKey),
    db.collection(CHAMPION_COLLECTION).doc(seasonDocId('month', month.key)),
    db.collection(CHAMPION_COLLECTION).doc(seasonDocId('year', year.key)),
  ];
  const snaps = await db.getAll(...refs).catch(() => []);
  const [weekDoc, monthDoc, yearDoc] = snaps;
  if (yearDoc?.exists && yearDoc.data().uid === uid) return { kind: 'year', start: year.start, end: year.end };
  if (monthDoc?.exists && monthDoc.data().uid === uid) return { kind: 'month', start: month.start, end: month.end };
  if (weekDoc?.exists && weekDoc.data().uid === uid && weekDoc.data().status !== 'no-winner') {
    return { kind: 'week', start: week.start, end: week.end };
  }
  return null;
}
