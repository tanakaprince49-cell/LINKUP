import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const PRO_FEATURES = {
  swipeLimit: 'Unlimited swipes/discovery',
  ideaSwipeLimit: 'Unlimited idea swiping',
  advancedSearch: 'Advanced search filters',
  aiSearch: 'AI search',
  savedSearchAlerts: 'Saved search alerts',
  profileViewers: 'Advanced profile analytics',
  savedProfiles: 'Unlimited saved profiles',
  turboConnect: 'TurboConnect/profile boost',
  compatibilityDetails: 'AI match reasons',
  startupAnalyzer: 'Unlimited AI startup analyzer',
  warmIntro: 'AI warm intro',
  moreProjects: 'More projects and ideas',
  largerMedia: 'Larger media sending',
  messagePriority: 'Message priority',
} as const;

export const FREE_LIMITS = {
  swipesPer12Hours: 20,
  dailyIdeaSwipes: 5,
  dailyStartupAnalyzer: 1,
  savedProfiles: 5,
  projects: 2,
  startupIdeas: 2,
  dailyRecommendations: 20,
} as const;

const todayKey = () => new Date().toISOString().slice(0, 10);
const usageKey = (uid: string, feature: string) => `linkup:free-usage:${uid}:${feature}:${todayKey()}`;
const windowUsageKey = (uid: string, feature: string) => `linkup:free-window-usage:${uid}:${feature}`;
const proEntitlementKey = (uid: string) => `linkup:pro-entitlement:${uid || 'anonymous'}`;
export const GOOGLE_PLAY_PACKAGE_NAME = 'com.tana.linkup';
export const LINKUP_PLUS_PRODUCT_ID = 'linkup_plus_monthly';
export const LINKUP_PLUS_YEARLY_PRODUCT_ID = 'linkup_plus_yearly';
export const LINKUP_PLUS_MONTHLY_PRICE = '$19.99';
export const LINKUP_PLUS_YEARLY_PRICE = '$149.99';
export const GOOGLE_PLAY_SUBSCRIPTION_URL =
  `https://play.google.com/store/account/subscriptions?sku=${LINKUP_PLUS_PRODUCT_ID}&package=${GOOGLE_PLAY_PACKAGE_NAME}`;
export const SWIPE_USAGE_WINDOW_HOURS = 12;

export const hasLinkupPro = (profile: any) => {
  const status = String(profile?.subscriptionStatus || '').toLowerCase();
  if (['inactive', 'canceled', 'cancelled', 'expired', 'free'].includes(status)) return false;
  const plan = String(profile?.plan || '').toLowerCase();
  const subscriptionPlan = String(profile?.subscriptionPlan || '').toLowerCase();
  return (
    !!profile?.isPro ||
    plan === 'pro' ||
    plan === 'plus' ||
    subscriptionPlan === 'pro' ||
    subscriptionPlan === 'plus' ||
    (status === 'active' && ['pro', 'plus'].includes(subscriptionPlan)) ||
    profile?.entitlements?.pro === true ||
    profile?.entitlements?.linkupPro === true ||
    profile?.entitlements?.linkupPlus === true
  );
};

export const isAndroidProLocked = (profile: any) => Platform.OS === 'android' && !hasLinkupPro(profile);

export const buildLocalProEntitlement = (unlockedAt: string = new Date().toISOString()) => ({
  isPro: true,
  plan: 'plus',
  subscriptionPlan: 'plus',
  subscriptionStatus: 'active',
  proUnlockedAt: unlockedAt,
  subscriptionUpdatedAt: unlockedAt,
  isVerified: true,
  verificationProgram: 'LINKUP PLUS',
  verifiedBy: 'LINKUP PLUS',
  verifiedAt: unlockedAt,
  turboConnect: true,
  analyticsUnlocked: true,
  profileAnalyticsUnlocked: true,
  readReceiptsEnabled: true,
  messagePriorityEnabled: true,
  entitlements: {
    pro: true,
    linkupPro: true,
    linkupPlus: true,
    unlimitedSwipes: true,
    unlimitedIdeaSwipes: true,
    advancedSearch: true,
    aiSearch: true,
    savedSearchAlerts: true,
    profileViewers: true,
    unlimitedSavedProfiles: true,
    turboConnect: true,
    priorityOpportunities: true,
    aiMatchReasons: true,
    profileImprovementSuggestions: true,
    unlimitedStartupAnalyzer: true,
    warmIntroGenerator: true,
    moreMedia: true,
    verifiedFounder: true,
    profileAnalytics: true,
    readReceipts: true,
    messagePriority: true,
  },
});

export const buildLocalFreeEntitlement = (canceledAt: string = new Date().toISOString()) => ({
  isPro: false,
  plan: 'free',
  subscriptionPlan: 'free',
  subscriptionStatus: 'canceled',
  subscriptionCanceledAt: canceledAt,
  subscriptionUpdatedAt: canceledAt,
  isVerified: false,
  verificationProgram: '',
  verifiedBy: '',
  verifiedAt: null,
  turboConnect: false,
  analyticsUnlocked: false,
  profileAnalyticsUnlocked: false,
  readReceiptsEnabled: false,
  messagePriorityEnabled: false,
  entitlements: {
    pro: false,
    linkupPro: false,
    linkupPlus: false,
    unlimitedSwipes: false,
    unlimitedIdeaSwipes: false,
    advancedSearch: false,
    aiSearch: false,
    savedSearchAlerts: false,
    profileViewers: true,
    unlimitedSavedProfiles: false,
    turboConnect: false,
    priorityOpportunities: false,
    aiMatchReasons: false,
    profileImprovementSuggestions: false,
    unlimitedStartupAnalyzer: false,
    warmIntroGenerator: false,
    moreMedia: false,
    verifiedFounder: false,
    profileAnalytics: false,
    readReceipts: false,
    messagePriority: false,
  },
});

export const saveLocalProEntitlement = async (uid: string, entitlement: Record<string, unknown> = buildLocalProEntitlement()) => {
  if (!uid) return;
  await AsyncStorage.setItem(proEntitlementKey(uid), JSON.stringify(entitlement));
};

export const clearLocalProEntitlement = async (uid: string) => {
  if (!uid) return;
  await AsyncStorage.removeItem(proEntitlementKey(uid));
};

export const readLocalProEntitlement = async (uid: string) => {
  if (!uid) return null;
  try {
    const raw = await AsyncStorage.getItem(proEntitlementKey(uid));
    if (!raw) return null;
    const entitlement = JSON.parse(raw);
    return hasLinkupPro(entitlement) ? entitlement : null;
  } catch {
    return null;
  }
};

export const getDailyUsage = async (uid: string, feature: string) => {
  const raw = await AsyncStorage.getItem(usageKey(uid || 'anonymous', feature));
  const count = Number.parseInt(String(raw || '0'), 10);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
};

export const consumeDailyUsage = async (uid: string, feature: string, limit: number) => {
  const key = usageKey(uid || 'anonymous', feature);
  const current = await getDailyUsage(uid || 'anonymous', feature);
  if (current >= limit) {
    return { allowed: false, used: current, remaining: 0, limit };
  }

  const next = current + 1;
  await AsyncStorage.setItem(key, String(next));
  return { allowed: true, used: next, remaining: Math.max(0, limit - next), limit };
};

const parseWindowUsage = (raw: string | null, now: number, windowMs: number) => {
  if (!raw) {
    return { count: 0, resetAt: now + windowMs };
  }

  try {
    const parsed = JSON.parse(raw);
    const count = Number.parseInt(String(parsed?.count || 0), 10);
    const resetAt = Number.parseInt(String(parsed?.resetAt || 0), 10);
    if (!Number.isFinite(resetAt) || resetAt <= now) {
      return { count: 0, resetAt: now + windowMs };
    }
    return {
      count: Number.isFinite(count) ? Math.max(0, count) : 0,
      resetAt,
    };
  } catch {
    const count = Number.parseInt(String(raw || '0'), 10);
    return {
      count: Number.isFinite(count) ? Math.max(0, count) : 0,
      resetAt: now + windowMs,
    };
  }
};

export const getWindowUsage = async (uid: string, feature: string, windowHours: number) => {
  const windowMs = Math.max(1, windowHours) * 60 * 60 * 1000;
  const now = Date.now();
  const raw = await AsyncStorage.getItem(windowUsageKey(uid || 'anonymous', feature));
  const usage = parseWindowUsage(raw, now, windowMs);
  return { used: usage.count, resetAt: usage.resetAt, windowHours };
};

export const consumeWindowUsage = async (uid: string, feature: string, limit: number, windowHours: number) => {
  const windowMs = Math.max(1, windowHours) * 60 * 60 * 1000;
  const now = Date.now();
  const key = windowUsageKey(uid || 'anonymous', feature);
  const raw = await AsyncStorage.getItem(key);
  const usage = parseWindowUsage(raw, now, windowMs);
  if (usage.count >= limit) {
    return { allowed: false, used: usage.count, remaining: 0, limit, windowHours, resetAt: usage.resetAt };
  }

  const next = usage.count + 1;
  await AsyncStorage.setItem(key, JSON.stringify({ count: next, resetAt: usage.resetAt, updatedAt: now }));
  return { allowed: true, used: next, remaining: Math.max(0, limit - next), limit, windowHours, resetAt: usage.resetAt };
};
