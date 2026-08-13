import { Platform } from 'react-native';
import { UserProfile } from '../types';

const androidApiLevel = Platform.OS === 'android' ? Number(Platform.Version || 0) : 0;

export const IS_LOW_END_ANDROID = Platform.OS === 'android' && androidApiLevel > 0 && androidApiLevel <= 29;
export const MOBILE_DISCOVERY_QUERY_LIMIT = IS_LOW_END_ANDROID ? 8 : Platform.OS === 'android' ? 14 : 60;
export const MOBILE_DISCOVERY_FALLBACK_QUERY_LIMIT = IS_LOW_END_ANDROID ? 6 : Platform.OS === 'android' ? 10 : 24;
export const MOBILE_CHAT_MESSAGE_LIMIT = IS_LOW_END_ANDROID ? 20 : Platform.OS === 'android' ? 28 : 80;
export const MOBILE_NOTIFICATION_QUERY_LIMIT = IS_LOW_END_ANDROID ? 16 : Platform.OS === 'android' ? 24 : 75;
export const MOBILE_HORIZONTAL_CARD_LIMIT = IS_LOW_END_ANDROID ? 4 : Platform.OS === 'android' ? 6 : 12;
export const MOBILE_SEARCH_RENDER_LIMIT = IS_LOW_END_ANDROID ? 8 : Platform.OS === 'android' ? 12 : 18;
export const MOBILE_SWIPE_DECK_LIMIT = IS_LOW_END_ANDROID ? 6 : Platform.OS === 'android' ? 10 : 12;
export const MOBILE_LIST_IMAGE_LIMIT = 240_000;

const PROFILE_IMAGE_CHAR_LIMIT = 240_000;
const LIST_IMAGE_CHAR_LIMIT = MOBILE_LIST_IMAGE_LIMIT;
const CACHE_IMAGE_CHAR_LIMIT = 240_000;

const text = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max);

const list = (value: unknown, maxItems = 16, maxChars = 80) =>
  Array.isArray(value)
    ? value.map((entry) => text(entry, maxChars)).filter(Boolean).slice(0, maxItems)
    : [];

export const safeProfileImageUri = (value: unknown, maxChars = LIST_IMAGE_CHAR_LIMIT) => {
  const uri = text(value, Number.MAX_SAFE_INTEGER);
  if (!uri) return '';
  const allowedChars = Math.max(0, maxChars);
  if (uri.startsWith('data:') && uri.length > allowedChars) return '';
  return uri;
};

const compactAnswers = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 24)
    .reduce<Record<string, string | string[]>>((result, [key, entry]) => {
      const safeKey = text(key, 80);
      if (!safeKey) return result;
      result[safeKey] = Array.isArray(entry) ? list(entry, 8, 100) : text(entry, 160);
      return result;
    }, {});
};

const compactResume = (resume: any = {}) => ({
  shippedProducts: list(resume.shippedProducts, 8, 100),
  sideProjects: list(resume.sideProjects, 8, 100),
  startupAttempts: list(resume.startupAttempts, 8, 100),
  hackathonWins: list(resume.hackathonWins, 8, 100),
  buildStreaks: Number(resume.buildStreaks || 0) || 0,
});

const compactProject = (project: any, index: number) => ({
  id: text(project?.id || `project_${index}`, 100),
  title: text(project?.title, 140),
  description: text(project?.description, 520),
  status: text(project?.status, 80),
  link: text(project?.link, 180),
  lookingFor: list(project?.lookingFor, 8, 80),
  tags: list(project?.tags, 8, 80),
});

const compactIdea = (idea: any, index: number) => ({
  id: text(idea?.id || `idea_${index}`, 100),
  title: text(idea?.title, 140),
  description: text(idea?.description, 520),
  stage: text(idea?.stage, 80),
  lookingFor: list(idea?.lookingFor, 8, 80),
  tags: list(idea?.tags, 8, 80),
});

export const compactProfileForList = (profile: any): UserProfile =>
  ({
    uid: text(profile?.uid, 140),
    displayName: text(profile?.displayName || profile?.fullName || profile?.name, 100),
    username: text(profile?.username, 40),
    bio: text(profile?.bio, 700),
    profilePic: safeProfileImageUri(profile?.profilePic, Platform.OS === 'android' ? 48_000 : LIST_IMAGE_CHAR_LIMIT),
    photos: Platform.OS === 'android'
      ? []
      : Array.isArray(profile?.photos)
        ? profile.photos.map((uri: unknown) => safeProfileImageUri(uri)).filter(Boolean).slice(0, 2)
        : [],
    occupation: text(profile?.occupation, 100),
    company: text(profile?.company, 120),
    country: text(profile?.country, 80),
    city: text(profile?.city, 80),
    age: Number(profile?.age || 0) || 0,
    skills: list(profile?.skills, 20, 80),
    interests: list(profile?.interests, 20, 80),
    industries: list(profile?.industries, 16, 80),
    lookingFor: list(profile?.lookingFor, 16, 80),
    goals: text(profile?.goals, 420),
    experience: text(profile?.experience, 80),
    personalityType: text(profile?.personalityType, 80),
    commitmentLevel: text(profile?.commitmentLevel, 80),
    startupStage: text(profile?.startupStage, 80),
    fundingStage: text(profile?.fundingStage, 80),
    availability: text(profile?.availability, 80),
    timezone: text(profile?.timezone, 80),
    languages: list(profile?.languages, 12, 80),
    workStyle: text(profile?.workStyle, 80),
    education: text(profile?.education, 80),
    networkingIntent: text(profile?.networkingIntent, 120),
    ambition: text(profile?.ambition, 120),
    remoteOnly: !!profile?.remoteOnly,
    willingToRelocate: !!profile?.willingToRelocate,
    teamSizePreference: text(profile?.teamSizePreference, 80),
    roleAnswers: compactAnswers(profile?.roleAnswers),
    personalityAnswers: compactAnswers(profile?.personalityAnswers),
    socialLinks: {},
    resume: compactResume(profile?.resume),
    projects: Array.isArray(profile?.projects) ? profile.projects.slice(0, 10).map(compactProject) : [],
    startupIdeas: Array.isArray(profile?.startupIdeas) ? profile.startupIdeas.slice(0, 20).map(compactIdea) : [],
    viewedBy: Array.isArray(profile?.viewedBy) ? profile.viewedBy.slice(0, 20) : [],
    reputationScore: Number(profile?.reputationScore || profile?.founderScore || 0) || 0,
    founderScore: Number(profile?.founderScore || profile?.reputationScore || 0) || 0,
    reputationMetrics: profile?.reputationMetrics || {},
    profileAnalytics: profile?.profileAnalytics || {},
    profileViews: Number(profile?.profileViews || 0) || 0,
    profileClicks: Number(profile?.profileClicks || profile?.clicks || 0) || 0,
    profileSaves: Number(profile?.profileSaves || profile?.saves || 0) || 0,
    responseRate: Number(profile?.responseRate || 0) || 0,
    streakCount: Number(profile?.streakCount || 0) || 0,
    hasExit: !!profile?.hasExit,
    isVisible: profile?.isVisible !== false,
    isStealthMode: !!profile?.isStealthMode,
    turboConnect: !!profile?.turboConnect,
    hideOnlineStatus: !!profile?.hideOnlineStatus,
    isVerified: !!profile?.isVerified,
    verificationProgram: text(profile?.verificationProgram, 80),
    verifiedBy: text(profile?.verifiedBy, 100),
    isBot: !!profile?.isBot,
    onboarded: !!profile?.onboarded,
    deleted: !!profile?.deleted,
    plan: profile?.plan,
    subscriptionPlan: profile?.subscriptionPlan,
    subscriptionStatus: profile?.subscriptionStatus,
    isPro: !!profile?.isPro,
    entitlements: profile?.entitlements || {},
    lastActiveAt: profile?.lastActiveAt || null,
  } as unknown as UserProfile);

export const compactProfileForCache = (profileData: any) => {
  const next = { ...(profileData || {}) };
  next.profilePic = safeProfileImageUri(next.profilePic, CACHE_IMAGE_CHAR_LIMIT);
  next.photos = Array.isArray(next.photos)
    ? next.photos.map((uri: unknown) => safeProfileImageUri(uri, CACHE_IMAGE_CHAR_LIMIT)).filter(Boolean).slice(0, 3)
    : [];

  const vibeMedia = text(next.vibeMedia, Number.MAX_SAFE_INTEGER);
  next.vibeMedia = vibeMedia.startsWith('data:') || vibeMedia.length > 4000 ? '' : vibeMedia;
  next.projects = Array.isArray(next.projects) ? next.projects.slice(0, 10).map(compactProject) : [];
  next.startupIdeas = Array.isArray(next.startupIdeas) ? next.startupIdeas.slice(0, 20).map(compactIdea) : [];
  next.resume = compactResume(next.resume);
  next.roleAnswers = compactAnswers(next.roleAnswers);
  next.personalityAnswers = compactAnswers(next.personalityAnswers);
  return next;
};
