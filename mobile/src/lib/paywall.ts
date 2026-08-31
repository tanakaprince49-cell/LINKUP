import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PLUS_PRICES, formatUsd } from './pricing';

export const PRO_FEATURES = {
  startupAnalyzer: 'AI Startup Analyzer',
  warmIntro: 'AI Warm Intro',
  verifiedBadge: 'Verified Blue Check',
  linkyAssistant: 'Linky AI Assistant',
  turboConnect: 'Turbo Connect',
} as const;

/**
 * IDEA DECK IS FREE FOREVER — a standing product decree, not a default.
 * Swiping ideas and posting ideas are never gated and never counted. That is
 * deliberate: the idea deck is the top of the funnel. Every swipe warms the
 * sponsored inventory that Campaigns sells (1 sponsored card per
 * SPONSORED_INTERVAL organic cards), so capping the deck caps ad revenue.
 * PLUS sells discovery, search and reach — never ideas.
 *
 * Do not reintroduce `dailyIdeaSwipes` or `startupIdeas` here. If someone asks
 * to gate ideas, point them at this comment first.
 */
export const IDEA_DECK_FREE_FOREVER = true;

export const FREE_LIMITS = {
  swipesPer12Hours: 12,
  dailyStartupAnalyzer: 3,
  savedProfiles: 5,
  projects: 3,
  weeklyRecommendations: 3,
  warmIntrosPerMonth: 1,
} as const;

// ISO week key like 2026-W35 (weekly allowances reset on Monday).
export const getCurrentWeekKey = () => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

const currentMonthKey = () => new Date().toISOString().slice(0, 7);

const periodUsageKey = (uid: string, feature: string, period: string) =>
  `linkup:free-usage:${uid}:${feature}:${period}`;

const getPeriodUsage = async (uid: string, feature: string, period: string) => {
  const raw = await AsyncStorage.getItem(periodUsageKey(uid || 'anonymous', feature, period));
  const count = Number.parseInt(String(raw || '0'), 10);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
};

const consumePeriodUsage = async (uid: string, feature: string, limit: number, period: string) => {
  const key = periodUsageKey(uid || 'anonymous', feature, period);
  const current = await getPeriodUsage(uid || 'anonymous', feature, period);
  if (current >= limit) {
    return { allowed: false, used: current, remaining: 0, limit };
  }
  const next = current + 1;
  await AsyncStorage.setItem(key, String(next));
  return { allowed: true, used: next, remaining: Math.max(0, limit - next), limit };
};

export const getWeeklyUsage = (uid: string, feature: string) =>
  getPeriodUsage(uid, feature, getCurrentWeekKey());

export const consumeWeeklyUsage = (uid: string, feature: string, limit: number) =>
  consumePeriodUsage(uid, feature, limit, getCurrentWeekKey());

export const getMonthlyUsage = (uid: string, feature: string) =>
  getPeriodUsage(uid, feature, currentMonthKey());

export const consumeMonthlyUsage = (uid: string, feature: string, limit: number) =>
  consumePeriodUsage(uid, feature, limit, currentMonthKey());

const todayKey = () => new Date().toISOString().slice(0, 10);
const usageKey = (uid: string, feature: string) => `linkup:free-usage:${uid}:${feature}:${todayKey()}`;
const windowUsageKey = (uid: string, feature: string) => `linkup:free-window-usage:${uid}:${feature}`;
const proEntitlementKey = (uid: string) => `linkup:pro-entitlement:${uid || 'anonymous'}`;
export const GOOGLE_PLAY_PACKAGE_NAME = 'com.tana.linkup';
export const LINKUP_PLUS_PRODUCT_ID = 'linkup_plus_monthly';
export const LINKUP_PLUS_YEARLY_PRODUCT_ID = 'linkup_plus_yearly_2';
export const LINKUP_PLUS_MONTHLY_PRICE = formatUsd(PLUS_PRICES.monthly);
export const LINKUP_PLUS_YEARLY_PRICE = formatUsd(PLUS_PRICES.yearly);
export const GOOGLE_PLAY_SUBSCRIPTION_URL =
  `https://play.google.com/store/account/subscriptions?sku=${LINKUP_PLUS_PRODUCT_ID}&package=${GOOGLE_PLAY_PACKAGE_NAME}`;
export const SWIPE_USAGE_WINDOW_HOURS = 12;

// Real paid entitlement derived from stored profile data. Used for anything
// that WRITES state (Firestore sync, local entitlement storage) or signals
// paid identity (the verification tick). Never bypassed by platform.
export const hasPaidLinkupPro = (profile: any) => {
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

// Feature gate. There is NO platform bypass any more.
//
// Web used to short-circuit to `true` because expo-iap has no web store, which
// meant nobody on web could ever be charged. Web users are now billed through
// Paynow instead: AuthContext folds the webSubscriptions/{uid} entitlement into
// the profile (see withWebEntitlements), so this one expression is true for a
// Play subscriber on Android AND for a paid-up Paynow subscriber on web — and
// false for everyone else.
export const hasLinkupPro = (profile: any) => hasPaidLinkupPro(profile);

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
  // Free tier = the demo, not the product. Downgraded accounts keep their
  // profile and matches but lose every PLUS lever. Gating constants live in
  // FREE_LIMITS; these flags are the hard on/off switches.
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
    profileViewers: false,
    unlimitedSavedProfiles: false,
    turboConnect: false,
    priorityOpportunities: false,
    aiMatchReasons: false,
    profileImprovementSuggestions: false,
    unlimitedStartupAnalyzer: false,
    warmIntroGenerator: false,
    moreMedia: true,
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
    return hasPaidLinkupPro(entitlement) ? entitlement : null;
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
