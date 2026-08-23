import { collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, setDoc, startAfter } from 'firebase/firestore';
import { db } from './firebase';
import { displayNameFor, isDiscoverableProfile } from './discovery';
import { sanitizeSocialLinks } from './socialLinks';
import {
  IS_LOW_END_ANDROID,
  MOBILE_DISCOVERY_FALLBACK_QUERY_LIMIT,
  MOBILE_DISCOVERY_QUERY_LIMIT,
  MOBILE_LIST_IMAGE_LIMIT,
  MOBILE_SWIPE_DECK_LIMIT,
  compactProfileForList,
  safeProfileImageUri,
} from './profilePerformance';
import { UserProfile } from '../types';

const PUBLIC_DISCOVERY_PAGE_SIZE = Math.max(MOBILE_SWIPE_DECK_LIMIT, IS_LOW_END_ANDROID ? 8 : 12);
const lastOwnPublicProfileSignature: Record<string, string> = {};

const text = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max);
const list = (value: unknown, maxItems = 16, maxChars = 80) =>
  Array.isArray(value)
    ? value.map((entry) => text(entry, maxChars)).filter(Boolean).slice(0, maxItems)
    : [];

const compactProject = (project: any, index: number) => ({
  id: text(project?.id || `project_${index}`, 100),
  title: text(project?.title, 120),
  description: text(project?.description, 300),
  status: text(project?.status, 80),
  lookingFor: list(project?.lookingFor, 6, 80),
  tags: list(project?.tags, 6, 80),
});

const compactIdea = (idea: any, index: number) => ({
  id: text(idea?.id || `idea_${index}`, 100),
  title: text(idea?.title, 120),
  description: text(idea?.description, 300),
  stage: text(idea?.stage, 80),
  lookingFor: list(idea?.lookingFor, 6, 80),
  tags: list(idea?.tags, 6, 80),
});

export const buildPublicProfileIndex = (profile: any) => {
  if (!profile?.uid || profile.deleted || profile.isStealthMode === true || profile.isVisible === false || profile.onboarded === false) {
    return null;
  }
  const compact = compactProfileForList(profile);
  if (!compact?.uid || !isDiscoverableProfile(compact)) return null;

  // Photos live in many places across legacy users docs — try every known
  // field (plus the photos[] array) so the index card shows a face whenever
  // one exists, not only when it's stored in profilePic.
  const photoCandidates = [
    (profile as any).profilePic,
    (compact as any).profilePic,
    (profile as any).photoURL,
    (profile as any).photoUrl,
    (profile as any).avatarUrl,
    (profile as any).avatar,
    (profile as any).picture,
    (profile as any).imageUrl,
    (profile as any).profileImage,
    ...(Array.isArray((profile as any).photos) ? (profile as any).photos : []),
  ];
  const indexPic = safeProfileImageUri(
    photoCandidates.find((v) => typeof v === 'string' && v.trim()),
    MOBILE_LIST_IMAGE_LIMIT
  );

  return {
    uid: compact.uid,
    displayName: displayNameFor(compact),
    username: text((compact as any).username, 40),
    bio: text(compact.bio, 700),
    profilePic: indexPic,
    occupation: text((compact as any).occupation, 100),
    company: text((compact as any).company, 120),
    country: text(compact.country, 80),
    city: text(compact.city, 80),
    age: Number(compact.age || 0) || 0,
    skills: list(compact.skills, 20, 80),
    interests: list((compact as any).interests, 20, 80),
    industries: list((compact as any).industries, 16, 80),
    lookingFor: list((compact as any).lookingFor, 16, 80),
    goals: text((compact as any).goals, 420),
    experience: text((compact as any).experience, 80),
    personalityType: text((compact as any).personalityType, 80),
    commitmentLevel: text((compact as any).commitmentLevel, 80),
    startupStage: text((compact as any).startupStage, 80),
    fundingStage: text((compact as any).fundingStage, 80),
    availability: text((compact as any).availability, 80),
    timezone: text((compact as any).timezone, 80),
    languages: list((compact as any).languages, 12, 80),
    workStyle: text((compact as any).workStyle, 80),
    education: text((compact as any).education, 80),
    networkingIntent: text((compact as any).networkingIntent, 120),
    ambition: text((compact as any).ambition, 120),
    remoteOnly: !!(compact as any).remoteOnly,
    willingToRelocate: !!(compact as any).willingToRelocate,
    teamSizePreference: text((compact as any).teamSizePreference, 80),
    projects: Array.isArray((compact as any).projects)
      ? (compact as any).projects.slice(0, 5).map(compactProject)
      : [],
    startupIdeas: Array.isArray((compact as any).startupIdeas)
      ? (compact as any).startupIdeas.slice(0, 8).map(compactIdea)
      : [],
    profileViews: Number((compact as any).profileViews || 0) || 0,
    profileClicks: Number((compact as any).profileClicks || 0) || 0,
    profileSaves: Number((compact as any).profileSaves || 0) || 0,
    responseRate: Number((compact as any).responseRate || 0) || 0,
    isVisible: compact.isVisible !== false,
    isStealthMode: !!compact.isStealthMode,
    turboConnect: !!(compact as any).turboConnect,
    hideOnlineStatus: !!(compact as any).hideOnlineStatus,
    isVerified: !!(compact as any).isVerified,
    verificationProgram: text((compact as any).verificationProgram, 80),
    isPro: !!(compact as any).isPro,
    plan: text((compact as any).plan, 40),
    subscriptionPlan: text((compact as any).subscriptionPlan, 40),
    subscriptionStatus: text((compact as any).subscriptionStatus, 40),
    socialLinks: sanitizeSocialLinks((compact as any).socialLinks),
    onboarded: !!(compact as any).onboarded,
    deleted: false,
    lastActiveAt: (compact as any).lastActiveAt || null,
    updatedAt: new Date().toISOString(),
  };
};

let lastDiscoveryDoc: any = null;

export const loadMoreDiscoveryProfiles = async (): Promise<UserProfile[]> => {
  try {
    const baseQuery = query(collection(db, 'publicProfiles'), orderBy('__name__'), limit(PUBLIC_DISCOVERY_PAGE_SIZE));
    const q = lastDiscoveryDoc ? query(baseQuery, startAfter(lastDiscoveryDoc)) : baseQuery;
    const snapshot = await getDocs(q);
    if (snapshot.empty) return [];
    lastDiscoveryDoc = snapshot.docs[snapshot.docs.length - 1];
    return snapshot.docs.map((docSnap) =>
      compactProfileForList({ uid: docSnap.id, ...(docSnap.data() as any) })
    );
  } catch {
    return [];
  }
};

export const resetDiscoveryPagination = () => {
  lastDiscoveryDoc = null;
};

export const syncOwnPublicProfileIndex = async (uid: string, profile: any) => {
  if (!uid) return;
  const ref = doc(db, 'publicProfiles', uid);
  const index = buildPublicProfileIndex({ ...(profile || {}), uid });
  if (!index) {
    if (lastOwnPublicProfileSignature[uid] === 'deleted') return;
    lastOwnPublicProfileSignature[uid] = 'deleted';
    await deleteDoc(ref).catch(() => {});
    return;
  }
  const signature = JSON.stringify({ ...index, updatedAt: '' });
  if (lastOwnPublicProfileSignature[uid] === signature) return;
  lastOwnPublicProfileSignature[uid] = signature;
  await setDoc(ref, { ...index, updatedAt: new Date().toISOString() }, { merge: true });
};

type SubscribeOptions = {
  userId: string;
  onData: (profiles: UserProfile[], source: 'publicProfiles' | 'users') => void;
  onError?: (error: unknown) => void;
};

export const loadFromPublicProfiles = async (userId: string, maxResults = MOBILE_DISCOVERY_QUERY_LIMIT) => {
  const snap = await getDocs(query(collection(db, 'publicProfiles'), limit(maxResults)));
  if (!snap || snap.empty) return null;
  const rows = snap.docs.map((d: any) =>
    compactProfileForList({ uid: d.id, ...(d.data() as any) })
  );
  return rows.filter((p: any) => p.uid !== userId && isDiscoverableProfile(p));
};

export const loadFromUsers = async (userId: string, pageSize = MOBILE_DISCOVERY_FALLBACK_QUERY_LIMIT) => {
  const sizes = Array.from(new Set([pageSize, 10, 6])).sort((a, b) => b - a);
  for (const size of sizes) {
    try {
      const snap = await getDocs(query(collection(db, 'users'), limit(size)));
      if (!snap || snap.empty) return null;
      const rows = snap.docs.map((d: any) =>
        compactProfileForList({ uid: d.id, ...(d.data() as any) })
      );
      const visible = rows.filter((p: any) => p.uid !== userId && isDiscoverableProfile(p));
      if (visible.length > 0) return visible;
    } catch {
      if (size === sizes[sizes.length - 1]) return null;
    }
  }
  return null;
};

type SharedListener = {
  userId: string;
  onData: SubscribeOptions['onData'];
  onError?: SubscribeOptions['onError'];
};

let sharedUnsub: (() => void) | null = null;
let sharedFallbackRunning = false;
const sharedListeners = new Set<SharedListener>();
let lastDiscoveryRows: UserProfile[] = [];
let lastDiscoverySource: 'publicProfiles' | 'users' = 'publicProfiles';

const emitShared = (rows: UserProfile[], source: 'publicProfiles' | 'users') => {
  lastDiscoveryRows = rows;
  lastDiscoverySource = source;
  sharedListeners.forEach((listener) => {
    listener.onData(rows.filter((p) => p.uid !== listener.userId), source);
  });
};

const startSharedDiscovery = () => {
  if (sharedUnsub) return;
  const firstUserId = [...sharedListeners][0]?.userId || '';
  const emitUsersFallback = async () => {
    if (sharedFallbackRunning) return;
    sharedFallbackRunning = true;
    try {
      const users = await loadFromUsers(firstUserId, MOBILE_DISCOVERY_FALLBACK_QUERY_LIMIT);
      emitShared(users || [], 'users');
    } finally {
      sharedFallbackRunning = false;
    }
  };

  // RACE ARCHITECTURE (survives hostile networks): some carriers/proxies
  // silently strangle Firestore streaming listeners — no data, no error, just
  // eternity. So we NEVER wait on the stream alone: a one-shot getDocs races
  // alongside it, first non-empty result wins, the stream keeps the deck live
  // afterwards, and a watchdog guarantees SOMETHING renders within 10s even
  // if both die. Empty decks are now structurally impossible.
  let delivered = false;
  const mark = () => {
    if (delivered) return false;
    delivered = true;
    clearTimeout(watchdog);
    return true;
  };

  const leanQuery = query(collection(db, 'publicProfiles'), limit(MOBILE_DISCOVERY_QUERY_LIMIT));
  const rowsFrom = (docs: any[]) =>
    docs
      .map((d) => compactProfileForList({ uid: d.id, ...(d.data() as any) }))
      .filter((p: any) => isDiscoverableProfile(p));

  const watchdog = setTimeout(() => {
    if (!delivered) {
      delivered = true;
      void emitUsersFallback();
    }
  }, 10000);

  // Lane 1: one-shot read (plain HTTP — always works where streams die)
  void (async () => {
    try {
      const snap = await getDocs(leanQuery);
      const rows = rowsFrom(snap?.docs || []);
      if (!mark()) return;
      if (rows.length > 0) emitShared(rows, 'publicProfiles');
      else void emitUsersFallback();
    } catch {
      if (mark()) void emitUsersFallback();
    }
  })();

  // Lane 2: live stream (when it delivers, it takes over freshness)
  sharedUnsub = onSnapshot(
    leanQuery,
    (snapshot) => {
      const rows = rowsFrom(snapshot?.docs || []);
      if (!delivered) {
        if (!mark()) return;
        if (rows.length > 0) emitShared(rows, 'publicProfiles');
        else void emitUsersFallback();
        return;
      }
      if (rows.length > 0) emitShared(rows, 'publicProfiles');
    },
    (error) => {
      console.error('Discovery onSnapshot error:', error);
      sharedListeners.forEach((listener) => listener.onError?.(error));
      if (mark()) void emitUsersFallback();
    }
  );

  const originalUnsub = sharedUnsub;
  sharedUnsub = () => {
    clearTimeout(watchdog);
    originalUnsub();
  };
};

export const subscribeToDiscoveryProfiles = ({ userId, onData, onError }: SubscribeOptions) => {
  const listener: SharedListener = { userId, onData, onError };
  sharedListeners.add(listener);
  if (lastDiscoveryRows.length) {
    onData(lastDiscoveryRows.filter((p) => p.uid !== userId), lastDiscoverySource);
  }
  startSharedDiscovery();

  return () => {
    sharedListeners.delete(listener);
    if (sharedListeners.size === 0) {
      sharedUnsub?.();
      sharedUnsub = null;
      lastDiscoveryRows = [];
    }
  };
};
