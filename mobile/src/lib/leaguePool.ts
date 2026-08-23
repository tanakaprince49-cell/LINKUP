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
 *
 * NEVER read raw `users` docs here. Raw user docs carry base64 photos (up to
 * ~900KB each), so a 300-doc pull was tens of MB and stalled every listener
 * in the app. Standings are computed from the lean publicProfiles index:
 * tiny docs, hosted-URL images only, same stable order → identical pool on
 * every device.
 */
const LEAGUE_POOL_LIMIT = 300;
const CACHE_TTL_MS = 30 * 60 * 1000;

let cached: { at: number; rows: any[] } | null = null;

// League avatars are tiny circles — keep https URLs and small data URIs
// (<=~90KB binary = 120K chars); still drop megabyte-scale base64 monsters.
const urlOnlyImage = (value: unknown) => {
  const uri = String(value || '');
  if (/^https?:\/\//.test(uri)) return uri.slice(0, 1000);
  return uri.startsWith('data:image') && uri.length <= 120_000 ? uri : '';
};

const leanLeagueRow = (docId: string, data: any) => ({
  uid: data.uid || docId,
  displayName: String(data.displayName || '').slice(0, 100),
  username: String(data.username || '').slice(0, 40),
  bio: String(data.bio || '').slice(0, 700),
  profilePic: urlOnlyImage(data.profilePic),
  photos: [] as string[],
  occupation: String(data.occupation || '').slice(0, 100),
  company: String(data.company || '').slice(0, 120),
  city: String(data.city || '').slice(0, 80),
  country: String(data.country || '').slice(0, 80),
  age: Number(data.age || 0) || 0,
  skills: Array.isArray(data.skills) ? data.skills.slice(0, 20) : [],
  industries: Array.isArray(data.industries) ? data.industries.slice(0, 16) : [],
  lookingFor: Array.isArray(data.lookingFor) ? data.lookingFor.slice(0, 16) : [],
  projects: Array.isArray(data.projects) ? data.projects.slice(0, 5) : [],
  ambition: String(data.ambition || '').slice(0, 120),
  startupStage: String(data.startupStage || '').slice(0, 80),
  availability: String(data.availability || '').slice(0, 80),
  profileViews: Number(data.profileViews || 0) || 0,
  viewedBy: [] as any[],
  responseRate: Number(data.responseRate || 0) || 0,
  isVerified: !!data.isVerified,
  isPro: !!data.isPro,
  plan: String(data.plan || '').slice(0, 40),
  subscriptionPlan: String(data.subscriptionPlan || '').slice(0, 40),
  subscriptionStatus: String(data.subscriptionStatus || '').slice(0, 40),
  turboConnect: !!data.turboConnect,
  lastActiveAt: data.lastActiveAt || null,
  deleted: false,
  isVisible: data.isVisible !== false,
  isStealthMode: !!data.isStealthMode,
});

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
  const snap = await getDocs(query(collection(db, 'publicProfiles'), limit(LEAGUE_POOL_LIMIT)));
  const rows: any[] = [];
  snap.forEach((docSnap) => {
    const row = leanLeagueRow(docSnap.id, docSnap.data());
    if (isDiscoverableProfile(row)) rows.push(row);
  });
  // Stable input order keeps tie-breaks identical across devices.
  rows.sort((a, b) => String(a.uid).localeCompare(String(b.uid)));

  // Never cache an EMPTY pool for 30 minutes — an unlucky fetch before the
  // index existed (or on a dead network) would blank every league surface for
  // half an hour. Empty = retry on the next mount instead.
  cached = rows.length > 0 ? { at: Date.now(), rows } : null;
  return cached?.rows || rows;
};
