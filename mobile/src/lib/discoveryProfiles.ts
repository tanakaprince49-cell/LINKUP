import { Platform } from 'react-native';
import { collection, deleteDoc, doc, limit, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { displayNameFor, isDiscoverableProfile } from './discovery';
import {
  IS_LOW_END_ANDROID,
  MOBILE_DISCOVERY_FALLBACK_QUERY_LIMIT,
  MOBILE_DISCOVERY_QUERY_LIMIT,
  MOBILE_LIST_IMAGE_LIMIT,
  compactProfileForList,
  safeProfileImageUri,
} from './profilePerformance';
import { UserProfile } from '../types';

const PUBLIC_DISCOVERY_LIMIT = IS_LOW_END_ANDROID ? 40 : Platform.OS === 'android' ? 80 : 160;
const FALLBACK_DELAY_MS = Platform.OS === 'android' ? 300 : 1200;
const USE_PUBLIC_PROFILE_INDEX = true;
const isPermissionDenied = (error: unknown) => String((error as any)?.code || '').includes('permission-denied');
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

  return {
    uid: compact.uid,
    displayName: displayNameFor(compact),
    username: text((compact as any).username, 40),
    bio: text(compact.bio, 700),
    profilePic: safeProfileImageUri((profile as any).profilePic || compact.profilePic, MOBILE_LIST_IMAGE_LIMIT),
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
    onboarded: !!(compact as any).onboarded,
    deleted: false,
    lastActiveAt: (compact as any).lastActiveAt || null,
    updatedAt: new Date().toISOString(),
  };
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

export const subscribeToDiscoveryProfiles = ({ userId, onData, onError }: SubscribeOptions) => {
  let closed = false;
  let sawPublicProfiles = false;
  let fallbackMode: 'filtered' | 'broad' | '' = '';
  let unsubscribePublic: (() => void) | null = null;
  let unsubscribeUsers: (() => void) | null = null;

  const emit = (rows: UserProfile[], source: 'publicProfiles' | 'users') => {
    if (closed) return 0;
    const list = rows
      .filter((profile: any) => profile.uid !== userId && isDiscoverableProfile(profile))
      .slice(0, MOBILE_DISCOVERY_QUERY_LIMIT);
    onData(list, source);
    return list.length;
  };

  const startFallback = (mode: 'filtered' | 'broad' = 'filtered') => {
    if (closed || fallbackMode === mode || (fallbackMode === 'broad' && mode === 'filtered')) return;
    fallbackMode = mode;
    if (unsubscribeUsers) {
      unsubscribeUsers();
      unsubscribeUsers = null;
    }
    const usersQuery =
      mode === 'filtered'
        ? query(
            collection(db, 'users'),
            where('isVisible', '==', true),
            where('isStealthMode', '==', false),
            limit(MOBILE_DISCOVERY_FALLBACK_QUERY_LIMIT)
          )
        : query(collection(db, 'users'), limit(MOBILE_DISCOVERY_FALLBACK_QUERY_LIMIT));
    unsubscribeUsers = onSnapshot(
      usersQuery,
      (snapshot) => {
        const rows = snapshot.docs.map((docSnap) =>
          compactProfileForList({ uid: docSnap.id, ...(docSnap.data() as any) })
        );
        const visibleCount = emit(rows, 'users');
        if (mode === 'filtered' && visibleCount === 0) {
          setTimeout(() => startFallback('broad'), 350);
        }
      },
      (error) => {
        if (mode === 'filtered') {
          startFallback('broad');
          return;
        }
        if (!closed && !isPermissionDenied(error)) onError?.(error);
        if (!closed && isPermissionDenied(error)) onData([], 'users');
      }
    );
  };

  const fallbackTimer = setTimeout(() => {
    if (!sawPublicProfiles) startFallback('filtered');
  }, FALLBACK_DELAY_MS);

  if (!USE_PUBLIC_PROFILE_INDEX) {
    clearTimeout(fallbackTimer);
    startFallback('filtered');
    return () => {
      closed = true;
      unsubscribeUsers?.();
    };
  }

  const publicQuery = query(collection(db, 'publicProfiles'), limit(PUBLIC_DISCOVERY_LIMIT));
  unsubscribePublic = onSnapshot(
    publicQuery,
    (snapshot) => {
      const rows = snapshot.docs.map((docSnap) =>
        compactProfileForList({ uid: docSnap.id, ...(docSnap.data() as any) })
      );
      const visibleCount = rows.filter((profile: any) => profile.uid !== userId && isDiscoverableProfile(profile)).length;
      if (visibleCount > 0) {
        sawPublicProfiles = true;
        if (unsubscribeUsers) {
          unsubscribeUsers();
          unsubscribeUsers = null;
          fallbackMode = '';
        }
        emit(rows, 'publicProfiles');
      } else if (!fallbackMode) {
        startFallback('filtered');
      }
    },
    (error) => {
      startFallback('filtered');
    }
  );

  return () => {
    closed = true;
    clearTimeout(fallbackTimer);
    unsubscribePublic?.();
    unsubscribeUsers?.();
  };
};
