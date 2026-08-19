import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from './firebase';
import { isDiscoverableProfile } from './discovery';

/**
 * League pool: ONE deterministic profile pool for every league surface
 * (Builder League, City League, dashboard preview).
 *
 * Why this exists: each screen used to rank whatever profiles that device
 * happened to have cached/paginated (8 docs on low-end Android, 60+ on web),
 * so the league standings looked different on every phone. Now everyone reads
 * the same documents in the same order, so the same formula always produces
 * the exact same standings everywhere.
 */
const LEAGUE_POOL_LIMIT = 300;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: { at: number; rows: any[] } | null = null;

export const invalidateLeaguePoolCache = () => {
  cached = null;
};

export const loadLeaguePool = async (options: { force?: boolean } = {}): Promise<any[]> => {
  if (!options.force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.rows;
  }

  // No orderBy on purpose: Firestore returns results in stable document-ID
  // order, and limit() applies to that stable order — so every device pulls
  // the identical pool, not "whatever its local pager had loaded".
  const snap = await getDocs(query(collection(db, 'users'), limit(LEAGUE_POOL_LIMIT)));
  const rows: any[] = [];
  snap.forEach((docSnap) => {
    const data: any = { ...docSnap.data() };
    if (!data.uid) data.uid = docSnap.id;
    if (isDiscoverableProfile(data)) rows.push(data);
  });
  // Stable input order keeps tie-breaks identical across devices.
  rows.sort((a, b) => String(a.uid).localeCompare(String(b.uid)));

  cached = { at: Date.now(), rows };
  return rows;
};
