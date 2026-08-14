import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { safeProfileImageUri } from './profilePerformance';
import { UserProfile } from '../types';

export const CONVERSATION_AVATAR_CHAR_LIMIT = 240_000;

const text = (value: unknown, max = 120) => String(value ?? '').trim().slice(0, max);
const profileCache = new Map<string, UserProfile>();

export const conversationAvatarUri = (value: unknown) =>
  safeProfileImageUri(value, CONVERSATION_AVATAR_CHAR_LIMIT);

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
    profile?.profilePic ||
      profile?.photoURL ||
      profile?.photoUrl ||
      profile?.avatarUrl ||
      profile?.avatar ||
      profile?.picture ||
      profile?.imageUrl ||
      profile?.profileImage ||
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

export const loadConversationProfile = async (
  uid: string,
  fallback: Partial<UserProfile> | null = null
): Promise<UserProfile> => {
  const cached = profileCache.get(uid);
  if (cached && !needsFullConversationProfile(cached)) {
    return normalizeConversationProfile(uid, cached, fallback);
  }

  let merged = normalizeConversationProfile(uid, fallback || {});

  // Fire both candidate reads in parallel instead of waiting for the public
  // index before deciding to hit `users` — the slow path drops from two
  // serial round trips to one.
  const publicPromise = getDoc(doc(db, 'publicProfiles', uid)).catch(() => null);
  const userPromise = needsFullConversationProfile(merged)
    ? getDoc(doc(db, 'users', uid)).catch(() => null)
    : Promise.resolve(null);

  const [publicSnap, userSnap] = await Promise.all([publicPromise, userPromise]);
  if (publicSnap?.exists()) {
    merged = normalizeConversationProfile(uid, publicSnap.data(), merged);
  }

  if (userSnap?.exists() && needsFullConversationProfile(merged)) {
    merged = normalizeConversationProfile(uid, userSnap.data(), merged);
  }

  profileCache.set(uid, merged);
  return merged;
};
