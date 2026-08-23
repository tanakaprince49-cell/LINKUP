import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { storedProfileImageUri } from './profilePerformance';
import { UserProfile } from '../types';

export const CONVERSATION_AVATAR_CHAR_LIMIT = 240_000;

const text = (value: unknown, max = 120) => String(value ?? '').trim().slice(0, max);

type CachedConversationProfile = {
  profile: UserProfile;
  checkedFat: boolean;
  at: number;
};

const profileCache = new Map<string, CachedConversationProfile>();
const inflightLoads = new Map<string, Promise<UserProfile>>();
const CONVERSATION_PROFILE_TTL_MS = 15 * 60 * 1000;

// Conversation/match snapshots are PERSISTED inside matches docs — they must
// stay base64-free forever (strict, hosted URLs only; legacy base64 renders
// from users docs at load time and never gets re-snapshotted).
export const conversationAvatarUri = (value: unknown) => storedProfileImageUri(value);

const isPlaceholderName = (value: unknown) => {
  const name = text(value).toLowerCase();
  return !name || name === 'builder' || name === 'new builder' || name === 'linkup builder';
};

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const next = text(value);
    if (next) return next;
  }
  return '';
};

const firstRealName = (...values: unknown[]) => {
  for (const value of values) {
    const next = text(value);
    if (next && !isPlaceholderName(next)) return next;
  }
  return '';
};

const profileNameFor = (profile: any = {}, fallback: any = {}) =>
  firstRealName(
    profile?.displayName,
    profile?.fullName,
    profile?.name,
    profile?.firstName && profile?.lastName ? `${profile.firstName} ${profile.lastName}` : '',
    profile?.username,
    fallback?.displayName,
    fallback?.fullName,
    fallback?.name,
    fallback?.firstName && fallback?.lastName ? `${fallback.firstName} ${fallback.lastName}` : '',
    fallback?.username,
    String(profile?.email || fallback?.email || '').split('@')[0]
  ) || firstText(profile?.displayName, fallback?.displayName);

const profilePicFor = (profile: any = {}, fallback: any = {}) =>
  conversationAvatarUri(
    profile?.profilePicUrl ||
      profile?.profilePic ||
      profile?.photoURL ||
      profile?.photoUrl ||
      profile?.avatarUrl ||
      profile?.avatar ||
      profile?.picture ||
      profile?.imageUrl ||
      profile?.profileImage ||
      fallback?.profilePicUrl ||
      fallback?.profilePic ||
      fallback?.photoURL ||
      fallback?.photoUrl ||
      fallback?.avatarUrl ||
      fallback?.avatar ||
      fallback?.picture ||
      fallback?.imageUrl ||
      fallback?.profileImage ||
      ''
  );

export const buildConversationProfileSnapshot = (uid: string, profile: any = {}) => ({
  uid,
  displayName: profileNameFor(profile, { displayName: 'Builder' }) || 'Builder',
  profilePic: profilePicFor(profile),
  isVerified: !!profile?.isVerified,
  hideOnlineStatus: !!profile?.hideOnlineStatus,
});

export const normalizeConversationProfile = (
  uid: string,
  profile: any = {},
  fallback: Partial<UserProfile> | null = null
): UserProfile => {
  const fallbackProfile = fallback || {};
  const nextPic = profilePicFor(profile, fallbackProfile);
  const rawName = profileNameFor(profile, fallbackProfile);
  const nextName = isPlaceholderName(rawName) ? profileNameFor(fallbackProfile, { displayName: 'Builder' }) : rawName;

  return {
    ...fallbackProfile,
    ...(profile || {}),
    uid,
    displayName: nextName || 'Builder',
    profilePic: nextPic,
    isVerified: !!(profile?.isVerified ?? (fallback as any)?.isVerified),
    hideOnlineStatus: !!(profile?.hideOnlineStatus ?? (fallback as any)?.hideOnlineStatus),
    lastActiveAt: profile?.lastActiveAt || (fallback as any)?.lastActiveAt || null,
  } as UserProfile;
};

export const needsFullConversationProfile = (profile: Partial<UserProfile> | null | undefined) =>
  !profile || isPlaceholderName((profile as any)?.displayName) || !conversationAvatarUri((profile as any)?.profilePic);

export const loadConversationProfile = (
  uid: string,
  fallback: Partial<UserProfile> | null = null
): Promise<UserProfile> => {
  const cached = profileCache.get(uid);
  if (cached && Date.now() - cached.at < CONVERSATION_PROFILE_TTL_MS) {
    // Cache hit: return instantly when the entry is complete, OR when we
    // already paid the fat users-doc tax once (checkedFat). Without this,
    // photo-less profiles failed the completeness check forever and the inbox
    // re-downloaded their ~900KB users doc on every single open.
    if (!needsFullConversationProfile(cached.profile) || cached.checkedFat) {
      return Promise.resolve(normalizeConversationProfile(uid, cached.profile, fallback));
    }
  }

  // Dedupe: 30 chat rows asking about the same person share ONE fetch.
  const inflight = inflightLoads.get(uid);
  if (inflight) {
    return inflight.then((profile) => normalizeConversationProfile(uid, profile, fallback));
  }

  const task = (async () => {
    let merged = normalizeConversationProfile(uid, cached?.profile || fallback || {});
    let checkedFat = !!cached?.checkedFat;

    // Lean index first: `users` docs are fat (base64 photos up to ~900KB) — only
    // fetch one if the lean index can't fill name + avatar. Chat lists render
    // instantly from the index without ever paying the fat-doc tax.
    const publicSnap = await getDoc(doc(db, 'publicProfiles', uid)).catch(() => null);
    if (publicSnap?.exists()) {
      merged = normalizeConversationProfile(uid, publicSnap.data(), merged);
    }

    if (needsFullConversationProfile(merged) && !checkedFat) {
      checkedFat = true;
      const userSnap = await getDoc(doc(db, 'users', uid)).catch(() => null);
      if (userSnap?.exists()) {
        merged = normalizeConversationProfile(uid, userSnap.data(), merged);
      }
    }

    profileCache.set(uid, { profile: merged, checkedFat, at: Date.now() });
    return merged;
  })();

  inflightLoads.set(uid, task);
  return task
    .then((profile) => normalizeConversationProfile(uid, profile, fallback))
    .finally(() => {
      inflightLoads.delete(uid);
    });
};
