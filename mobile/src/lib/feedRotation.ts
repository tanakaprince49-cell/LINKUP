import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * ANTI-RERUN FEED ROTATION.
 * The ranked feeds (Opportunity Radar, project recs) are scored by pure
 * functions: same people in -> same top-N out, every open, every day.
 * Users were seeing the SAME 3 faces for weeks and (rightly) rioting.
 *
 * rotateFeed keeps scores honest but kills the rerun:
 *   1. score order preserved (quality never sacrificed)
 *   2. ties shuffle with a DAILY seed (stable within the day — reopening the
 *      app doesn't reshuffle, but tomorrow is different)
 *   3. a "seen" log (AsyncStorage) keeps never-shown entries surfacing first
 *   4. the visible window rotates daily through the fresh pool, so it takes
 *      days — not minutes — before anyone repeats
 */

const hashString = (value: string) => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

const dailySeed = (userId: string, feed: string) => {
  const now = new Date();
  const stamp = `${userId}:${feed}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return hashString(stamp);
};

const tieJitter = (seed: number, id: string) => hashString(`${seed}:${id}`);

const seenKey = (userId: string, feed: string) => `linkup:feedSeen:${feed}:${userId}`;
const stateKey = (userId: string, feed: string) => `linkup:feedState:${feed}:${userId}`;

// USER DECREE: a featured person stays exactly 24 hours, then swaps.
const HOLD_MS = 24 * 60 * 60 * 1000;

export async function rotateFeed<T>(
  userId: string | undefined,
  feed: string,
  rankedDescending: T[],
  limitCount: number,
  idOf: (item: T) => string,
  scoreOf: (item: T) => number = () => 0
): Promise<T[]> {
  if (!rankedDescending.length || limitCount <= 0) return [];
  const uid = userId || 'anon';
  const seed = dailySeed(uid, feed);

  // 1) keep score order; break ties pseudo-randomly but STABLY for today
  const jittered = [...rankedDescending].sort((a, b) => {
    const byScore = scoreOf(b) - scoreOf(a);
    if (byScore !== 0) return byScore;
    return tieJitter(seed, idOf(a)) - tieJitter(seed, idOf(b));
  });

  // 2) THE 24H HOLD: if we already featured a set less than 24h ago and it's
  // still in the pool, keep serving exactly it. A person holds the spot for
  // a full day, THEN the radar changes the person.
  const byId = new Map(jittered.map((item) => [idOf(item), item] as const));
  try {
    const raw = await AsyncStorage.getItem(stateKey(uid, feed));
    const state = raw ? (JSON.parse(raw) as { at?: number; ids?: string[] }) : null;
    if (state && Array.isArray(state.ids) && state.ids.length && Date.now() - Number(state.at || 0) < HOLD_MS) {
      const held = state.ids.map((id) => byId.get(id)).filter(Boolean) as T[];
      if (held.length) return held;
    }
  } catch {
    /* storage read failed — fall through and rotate fresh */
  }

  // 3) fresh-first: anything never shown outranks a rerun
  let seen: string[] = [];
  try {
    seen = JSON.parse((await AsyncStorage.getItem(seenKey(uid, feed))) || '[]');
  } catch {
    seen = [];
  }
  const seenSet = new Set(seen);
  const fresh = jittered.filter((item) => !seenSet.has(idOf(item)));
  const working = fresh.length >= limitCount ? fresh : jittered;

  // 4) pick the next window through the working pool
  const windows = Math.max(1, Math.ceil(working.length / limitCount));
  const start = (seed % windows) * limitCount;
  const shown = working.slice(start, start + limitCount);
  if (!shown.length) return working.slice(0, limitCount);

  // 5) stamp the featured set NOW — it holds for the next 24h — and log seen
  void AsyncStorage.setItem(stateKey(uid, feed), JSON.stringify({ at: Date.now(), ids: shown.map(idOf) })).catch(() => {});
  const keep = Math.max(12, jittered.length - limitCount);
  const next = [...seen, ...shown.map((item) => idOf(item)).filter((id) => !seenSet.has(id))].slice(-keep);
  void AsyncStorage.setItem(seenKey(uid, feed), JSON.stringify(next)).catch(() => {});

  return shown;
}
