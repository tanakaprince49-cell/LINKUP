import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  PanResponder,
  ScrollView,
  FlatList,
  InteractionManager,
  Linking,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { collection, query, where, addDoc, limit, serverTimestamp, getDocs, getDocsFromCache, doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../lib/firebase';
import { displayNameFor, earnedScore, isDiscoverableProfile, isSyntheticProfile } from '../lib/discovery';
import { localCommonalityRank, rankCandidatesHybrid } from '../lib/matchmaking';
import { trackProfileView } from '../lib/analytics';
import { ensureDirectMatch } from '../lib/chat';
import { ConnectionRequest, requestConnection, subscribeToConnectionRequest } from '../lib/connectionRequests';
import { useConnectionNote } from '../components/ConnectionNoteModal';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useGamification } from '../contexts/GamificationContext';
import { UserProfile } from '../types';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { roleInfoFor } from '../lib/roles';
import { X, Heart, RotateCcw, Target, ChevronDown, ChevronLeft, MapPin, Briefcase, MessageSquare, Globe, Package, Zap, Lock } from 'lucide-react-native';
import {
  Campaign,
  SponsoredIdeaDeckItem,
  buildHouseIdeaCard,
  isSponsoredHiddenForViewer,
  recordCampaignClick,
  recordCampaignImpression,
  sponsorOneLiner,
  subscribeActiveCampaigns,
  toSponsoredItem,
} from '../lib/campaigns';
import VerifiedBadge from '../components/VerifiedBadge';
import ErrorBoundary from '../components/ErrorBoundary';
import PaywallModal from '../components/PaywallModal';
import { consumeWindowUsage, FREE_LIMITS, getWindowUsage, hasLinkupPro, PRO_FEATURES, SWIPE_USAGE_WINDOW_HOURS } from '../lib/paywall';
import { compactProfileForList, storedProfileImageUri } from '../lib/profilePerformance';
import { AppImage } from '../components/AppImage';
import { ikAvatar, ikCard } from '../lib/ikImage';
import { avatarPlaceholderUri } from '../lib/defaultAvatar';
import ProCrownBadge from '../components/ProCrownBadge';
import { notifyUser } from '../lib/notify';
import { subscribeToDiscoveryProfiles, loadMoreDiscoveryProfiles } from '../lib/discoveryProfiles';
import { shareLinkupInvite } from '../lib/activation';

const windowSize = Dimensions.get('window');
const { width } = windowSize;
const SWIPE_THRESHOLD = 0.22 * width;
const DISCOVERY_LIMIT = 200;
const FALLBACK_PHOTO = avatarPlaceholderUri('', 512);
/**
 * Largest base64 photo a card may render inline.
 *
 * A data URI has no URL, so expo-image cannot cache it: every mount decodes
 * the whole string again on the JS/main thread. At 900k chars that decode was
 * hundreds of milliseconds of frozen frame, which is a card that appears
 * blank and then pops — the blink. Anything bigger falls back to the
 * placeholder and gets a real (hosted, cacheable) photo from the upgrade pass.
 */
const MAX_SWIPE_DATA_URI_CHARS = 320_000;
/** Order-sensitive fingerprint of a deck, used to drop no-op rebuilds. */
const deckKey = (items: UserProfile[]) => items.map((profile) => profile?.uid).join('|');
const USE_NATIVE_ANIMATION_DRIVER = Platform.OS !== 'web';
const discoveryCacheKey = (uid: string) => `linkup:discovery:v3:${uid}`;
const swipeProgressKey = (uid: string) => `linkup:swipe-progress:v1:${uid}`;
const MAX_STORED_SWIPED_IDS = 2000;

const getWebRuntimeFlags = () => {
  if (Platform.OS !== 'web') {
    return { isMobileWeb: false, screenWidth: 0 };
  }

  const nav = (globalThis as any)?.navigator;
  const screenLike = (globalThis as any)?.screen;
  const ua = String(nav?.userAgent || '');
  const screenWidth = Number(screenLike?.width || 0);
  const screenHeight = Number(screenLike?.height || 0);
  const shortestScreenSide = Math.min(screenWidth || 9999, screenHeight || 9999);
  const isMobileWeb =
    /LinkedInApp|LinkedIn|Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    shortestScreenSide < 768;

  return { isMobileWeb, screenWidth };
};

const readCachedDiscovery = async (uid: string): Promise<UserProfile[]> => {
  try {
    const raw = await AsyncStorage.getItem(discoveryCacheKey(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((profile) => profile?.uid && profile.uid !== uid && isDiscoverableProfile(profile)).slice(0, 500) : [];
  } catch {
    return [];
  }
};

const writeCachedDiscovery = async (uid: string, profiles: UserProfile[]) => {
  try {
    const compactProfiles = profiles.slice(0, DISCOVERY_LIMIT).filter((profile) => !!profile?.uid).map((profile) => ({
      uid: profile.uid,
      displayName: displayNameFor(profile),
      username: (profile as any).username || '',
      bio: profile.bio || '',
      profilePic: isCacheableSwipePhoto(profile.profilePic) ? (profile.profilePic as string).slice(0, 1000) : '',
      photos: Array.isArray((profile as any).photos) ? (profile as any).photos.filter(isCacheableSwipePhoto).slice(0, 3) : [],
      occupation: (profile as any).occupation || '',
      company: (profile as any).company || '',
      city: profile.city || '',
      country: profile.country || '',
      age: Number(profile.age || 0),
      skills: Array.isArray(profile.skills) ? profile.skills.slice(0, 12) : [],
      industries: Array.isArray((profile as any).industries) ? (profile as any).industries.slice(0, 12) : [],
      lookingFor: Array.isArray((profile as any).lookingFor) ? (profile as any).lookingFor.slice(0, 12) : [],
      startupStage: (profile as any)?.startupStage || '',
      availability: (profile as any).availability || '',
      reputationScore: earnedScore(profile),
      turboConnect: !!(profile as any).turboConnect,
      isVisible: profile.isVisible !== false,
      isStealthMode: !!profile.isStealthMode,
      isVerified: !!profile.isVerified,
      isBot: !!profile.isBot,
      onboarded: !!profile.onboarded,
      projects: Array.isArray((profile as any).projects) ? (profile as any).projects.slice(0, 3) : [],
    }));
    await AsyncStorage.setItem(discoveryCacheKey(uid), JSON.stringify(compactProfiles));
  } catch {
    // Cache is only used to make the deck appear instantly.
  }
};

const readSwipeProgress = async (uid: string) => {
  try {
    const raw = await AsyncStorage.getItem(swipeProgressKey(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    const ids = Array.isArray(parsed?.ids) ? parsed.ids : parsed;
    return new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
        .slice(0, MAX_STORED_SWIPED_IDS)
    );
  } catch {
    return new Set<string>();
  }
};

const writeSwipeProgress = async (uid: string, ids: string[]) => {
  try {
    const compactIds = Array.from(new Set(ids.filter(Boolean))).slice(-MAX_STORED_SWIPED_IDS);
    await AsyncStorage.setItem(
      swipeProgressKey(uid),
      JSON.stringify({ ids: compactIds, updatedAt: new Date().toISOString() })
    );
  } catch {
    // Swipe progress is a convenience cache. Firestore swipe writes still happen separately.
  }
};

const clearSwipeProgress = async (uid: string) => {
  try {
    await AsyncStorage.removeItem(swipeProgressKey(uid));
  } catch {
    // Best effort reset.
  }
};

const isSafeSwipePhoto = (uri: unknown): uri is string => {
  if (typeof uri !== 'string') return false;
  const value = uri.trim();
  if (!value) return false;
  return !value.startsWith('data:') || value.length <= MAX_SWIPE_DATA_URI_CHARS;
};

// Cache only hosted (https) photos. Base64 data URIs are megabytes of JSON —
// serialising them to AsyncStorage froze the whole app on startup.
const isCacheableSwipePhoto = (uri: unknown): uri is string =>
  typeof uri === 'string' && /^https:\/\//.test(uri);

const getSwipePhotos = (profile: UserProfile): string[] => {
  const rawPhotos: unknown[] = Array.isArray((profile as any).photos) && (profile as any).photos.length > 0
    ? (profile as any).photos
    : [profile.profilePic];
  const safePhotos = rawPhotos.filter(isSafeSwipePhoto);
  return safePhotos.length ? safePhotos : [avatarPlaceholderUri(displayNameFor(profile), 512)];
};

const ExpandedProfilePanel = React.memo(function ExpandedProfilePanel({
  profile,
  isDark,
  displayName,
  ageText,
  roleText,
  locationText,
  bio,
  compatibility,
  compatibilityReason,
  skills,
  lookingFor,
  industries,
  onClose,
  onContact,
  onLike,
  onPass,
  contactBusy,
  connectionRequest,
}: {
  profile: any;
  isDark: boolean;
  displayName: string;
  ageText: string;
  roleText: string;
  locationText: string;
  bio: string;
  compatibility: number;
  compatibilityReason: string;
  skills: string[];
  lookingFor: string[];
  industries: string[];
  onClose: () => void;
  onContact: () => void;
  onLike: () => void;
  onPass: () => void;
  contactBusy: boolean;
  connectionRequest: ConnectionRequest | null;
}) {
  const sheetBg = isDark ? '#0B1020' : '#FFF';
  return (
    <View style={StyleSheet.absoluteFill}>
      <TouchableOpacity style={styles.expandedBackdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.expandedSheet, { backgroundColor: sheetBg }]}>
        <View style={styles.expandedHandle} />
        <ScrollView style={styles.expandedScrollArea} contentContainerStyle={styles.expandedScrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.expandedHeader}>
            <Text style={[styles.expandedName, { color: isDark ? '#FFF' : '#000' }]}>{displayName}{ageText}</Text>
            {!!profile.isVerified && <VerifiedBadge size={20} />}
          </View>
          <Text style={[styles.expandedRole, { color: isDark ? '#B7C0D8' : '#42526B' }]}>{roleText}</Text>
          <Text style={[styles.expandedLocation, { color: isDark ? '#718096' : '#8492A6' }]}>{locationText}</Text>

          <View style={[styles.expandedMatchRow, { backgroundColor: isDark ? 'rgba(17, 24, 39,0.12)' : 'rgba(17, 24, 39,0.15)' }]}>
            <Target size={14} color={COLORS.primaryStrong} />
            <Text style={[styles.expandedMatchText, { color: COLORS.primaryStrong }]}>
              {compatibility}% fit — {compatibilityReason}
            </Text>
          </View>

          <View style={[styles.expandedDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]} />

          <Text style={[styles.expandedSectionLabel, { color: isDark ? '#B7C0D8' : '#42526B' }]}>Bio</Text>
          <Text style={[styles.expandedBio, { color: isDark ? '#FFF' : '#000' }]}>{bio || 'No bio yet.'}</Text>

          {skills.length > 0 && (
            <>
              <Text style={[styles.expandedSectionLabel, { color: isDark ? '#B7C0D8' : '#42526B' }]}>Skills</Text>
              <View style={styles.expandedTagRow}>
                {skills.slice(0, 8).map((s, i) => (
                  <View key={i} style={[styles.expandedTag, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                    <Text style={[styles.expandedTagText, { color: isDark ? '#FFF' : '#000' }]}>{s}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {industries.length > 0 && (
            <>
              <Text style={[styles.expandedSectionLabel, { color: isDark ? '#B7C0D8' : '#42526B' }]}>Industries</Text>
              <View style={styles.expandedTagRow}>
                {industries.slice(0, 4).map((s, i) => (
                  <View key={i} style={[styles.expandedTag, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                    <Text style={[styles.expandedTagText, { color: isDark ? '#FFF' : '#000' }]}>{s}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {lookingFor.length > 0 && (
            <>
              <Text style={[styles.expandedSectionLabel, { color: isDark ? '#B7C0D8' : '#42526B' }]}>Looking For</Text>
              <Text style={[styles.expandedLookingFor, { color: isDark ? '#FFF' : '#000' }]}>{lookingFor.join(' · ')}</Text>
            </>
          )}
        </ScrollView>

        <View style={[styles.expandedActionsBar, { backgroundColor: sheetBg, borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]}>
          <TouchableOpacity style={styles.expandedPassBtn} onPress={onPass}>
            <X size={24} color="#FF6B6B" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.expandedContactBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.04)' }]}
            onPress={onContact}
            disabled={contactBusy}
          >
            <MessageSquare size={18} color={isDark ? '#FFF' : '#000'} />
            <Text style={[styles.expandedContactText, { color: isDark ? '#FFF' : '#000' }]}>
              {contactBusy ? '…' : connectionRequest?.status === 'approved' ? 'Chat' : connectionRequest?.status === 'pending' ? 'Sent' : 'Request'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.expandedLikeBtn} onPress={onLike}>
            <Heart size={26} color="#000" fill="#000" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

export default function SwipeScreen({ navigation }: any) {
  const { user, profile: myProfile } = useAuth();
  const { theme } = useTheme();
  const { trackAction } = useGamification();
  const isFocused = useIsFocused();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const isDark = theme === 'dark';
  const isWeb = Platform.OS === 'web';
  const webRuntime = useMemo(() => getWebRuntimeFlags(), []);
  const safeViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : width;
  const safeViewportHeight =
    Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : windowSize.height || 900;
  const isWideWeb = isWeb && !webRuntime.isMobileWeb && safeViewportWidth >= 768;
  const isCompactWeb = isWeb && (webRuntime.isMobileWeb || !isWideWeb);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [aiOrderingDone, setAiOrderingDone] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [connectionRequest, setConnectionRequest] = useState<ConnectionRequest | null>(null);
  const [contactBusy, setContactBusy] = useState(false);
  const connectionNote = useConnectionNote();
  const [paywallFeature, setPaywallFeature] = useState('');

  // Free discovery budget: 12 profiles per 12 hours. PLUS = unlimited.
  const isProUser = hasLinkupPro(myProfile);
  // Ad visibility is its own switch: PLUS is ad-free, but founder/admin
  // accounts still see the placements so they can review and QA them. This
  // NEVER gates entitlement — budget, paywall and features read isProUser.
  const adsHiddenForViewer = isSponsoredHiddenForViewer(myProfile, {
    email: user?.email,
    isAdmin: (myProfile as any)?.isAdmin,
  });

  // --- Discover boost (sponsored interstitial) ----------------------------
  // A sponsored product card shows as an interstitial every
  // DISCOVER_SPONSORED_EVERY profile swipes. It never enters the profiles
  // array (so ranking/rescue logic is untouched), never burns the swipe
  // budget, and PLUS members never see it. Empty paid inventory falls back
  // to the PLUS house promo via sponsoredIdeaCardsForViewer.
  const DISCOVER_SPONSORED_EVERY = 4;
  const [discoverySponsor, setDiscoverySponsor] = useState<SponsoredIdeaDeckItem | null>(null);
  // Raw live inventory. Deliberately NOT pre-filtered by the daily impression
  // cap: recording an impression writes to the campaign doc, which re-fires the
  // listener, which used to rebuild the queue with the cap applied — so after
  // ~2 views per campaign every real ad was filtered out and users only ever
  // saw the same house promo. The cap still throttles impression STATS inside
  // recordCampaignImpression; it just no longer decides what you get shown.
  const sponsorInventoryRef = useRef<Campaign[]>([]);
  const sponsorShownRef = useRef<Record<string, number>>({});
  const lastSponsorIdRef = useRef<string>('');
  const swipesSinceSponsorRef = useRef(0);

  useEffect(() => {
    if (!user?.uid || adsHiddenForViewer) {
      sponsorInventoryRef.current = [];
      setDiscoverySponsor(null);
      return;
    }
    let cancelled = false;
    const unsubscribeSponsored = subscribeActiveCampaigns((campaigns) => {
      if (cancelled) return;
      sponsorInventoryRef.current = campaigns.filter(
        (campaign) =>
          !!campaign?.creative &&
          Array.isArray(campaign.placements) &&
          campaign.placements.includes('discover') &&
          campaign.ownerId !== user.uid // never advertise to yourself
      );
    }, () => {});
    return () => {
      cancelled = true;
      unsubscribeSponsored();
    };
  }, [user?.uid, adsHiddenForViewer]);

  /**
   * Choose the next sponsored card.
   *
   * Fewest-shows-first, so every live campaign gets a turn before any of them
   * repeats; ties are shuffled so the running order differs from cycle to
   * cycle; and it is never the same campaign twice in a row. Falls back to the
   * PLUS house promo only when there is genuinely no paid inventory.
   */
  const pickNextSponsor = (): SponsoredIdeaDeckItem | null => {
    const inventory = sponsorInventoryRef.current;
    // No paid inventory: promote PLUS — but never to someone who already has
    // it. A premium viewer gets no card rather than a "Go PLUS" upsell.
    if (!inventory.length) return isProUser ? null : buildHouseIdeaCard();

    const shown = sponsorShownRef.current;
    const ranked = [...inventory].sort((a, b) => {
      const diff = (shown[a.id] || 0) - (shown[b.id] || 0);
      return diff !== 0 ? diff : Math.random() - 0.5;
    });
    const next =
      ranked.length > 1
        ? ranked.find((campaign) => campaign.id !== lastSponsorIdRef.current) || ranked[0]
        : ranked[0];

    lastSponsorIdRef.current = next.id;
    shown[next.id] = (shown[next.id] || 0) + 1;
    return toSponsoredItem(next);
  };

  const maybeShowDiscoverySponsor = () => {
    if (adsHiddenForViewer || !user?.uid) return;
    const next = pickNextSponsor();
    if (!next) return;
    setDiscoverySponsor(next);
    void recordCampaignImpression(next.campaignId, user.uid);
  };

  /**
   * Resolve the sponsored slot that is currently on screen.
   *
   * Scroll mode has no swipe animation to hang this off, so the sponsored
   * card is a stop in the feed: advancing or pressing an action resolves it
   * before the feed moves again. 'open' counts a click (right-swipe
   * equivalent); 'skip' just dismisses. Returns true if a slot was resolved.
   */
  const resolveSponsor = (action: 'open' | 'skip') => {
    const sponsor = discoverySponsor;
    if (!sponsor) return false;
    if (action === 'open') {
      void recordCampaignClick(sponsor.campaignId, user?.uid || '');
      if (sponsor.house) openPaywall('Unlimited Discovery');
      else if (sponsor.website) Linking.openURL(sponsor.website).catch(() => {});
    }
    setDiscoverySponsor(null);
    return true;
  };
  const resolveSponsorRef = useRef<(action: 'open' | 'skip') => boolean>(() => false);
  resolveSponsorRef.current = resolveSponsor;
  const maybeShowSponsorRef = useRef<() => void>(() => {});
  maybeShowSponsorRef.current = maybeShowDiscoverySponsor;
  const swipeBudgetRef = useRef<number | null>(null);
  const [swipesLeft, setSwipesLeft] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user?.uid || isProUser) {
      swipeBudgetRef.current = null;
      setSwipesLeft(null);
      return;
    }
    (async () => {
      const usage = await getWindowUsage(user.uid, 'discovery-swipes', SWIPE_USAGE_WINDOW_HOURS);
      if (cancelled) return;
      const left = Math.max(0, FREE_LIMITS.swipesPer12Hours - usage.used);
      swipeBudgetRef.current = left;
      setSwipesLeft(left);
    })();
    return () => { cancelled = true; };
  }, [user?.uid, isProUser]);
  const [progressHydrated, setProgressHydrated] = useState(false);

  // --- Discovery budget: one wall for BOTH modes ---------------------------
  // Free members get FREE_LIMITS.swipesPer12Hours discoveries per window. That
  // budget used to be spent only by the swipe deck, so scroll mode never hit
  // the limit and free members could scroll the whole city forever. Scrolling
  // now spends the same budget, and the feed locks (paywall) when it runs out.
  //
  // Charging is per PROFILE, not per view: scrolling back up a card you have
  // already paid for — or flipping between modes — must never double-charge.
  const discoveryPaidUidsRef = useRef<Set<string>>(new Set());

  const hasDiscoveryBudget = (profileUid?: string) => {
    if (isProUser || !user?.uid) return true; // PLUS is unlimited
    if (profileUid && discoveryPaidUidsRef.current.has(profileUid)) return true;
    return (swipeBudgetRef.current ?? Number.POSITIVE_INFINITY) > 0;
  };

  /**
   * Spend one discovery. Returns false when the wall has already been hit, so
   * callers can lock and open the paywall.
   */
  const spendDiscoveryBudget = (profileUid?: string) => {
    if (isProUser || !user?.uid) return true;
    if (profileUid && discoveryPaidUidsRef.current.has(profileUid)) return true;
    if ((swipeBudgetRef.current ?? Number.POSITIVE_INFINITY) <= 0) return false;
    if (profileUid) discoveryPaidUidsRef.current.add(profileUid);
    swipeBudgetRef.current = Math.max(0, (swipeBudgetRef.current ?? FREE_LIMITS.swipesPer12Hours) - 1);
    setSwipesLeft(swipeBudgetRef.current);
    void consumeWindowUsage(user.uid, 'discovery-swipes', FREE_LIMITS.swipesPer12Hours, SWIPE_USAGE_WINDOW_HOURS).catch(() => {});
    return true;
  };

  const swipedSessionIdsRef = useRef<Set<string>>(new Set());
  const hasUserSwipedRef = useRef(false);
  const allProfilesRef = useRef<UserProfile[]>([]);
  const photoUpgradedRef = useRef<Set<string>>(new Set());
  const scoreByIdRef = useRef<Map<string, number>>(new Map());
  const lastSwipedProfileRef = useRef<UserProfile | null>(null);
  const [mode, setMode] = useState<'swipe' | 'scroll'>('swipe');
  const [scrollIndex, setScrollIndex] = useState(0);
  const [cardVisible, setCardVisible] = useState(true);
  const scrollPosition = useRef(new Animated.Value(0)).current;
  const isScrollAnimatingRef = useRef(false);
  const scrollIndexRef = useRef(0);
  const feed = useMemo(() => profiles.filter(Boolean).slice(0, 100), [profiles]);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const profilesRef = useRef<UserProfile[]>(profiles);
  profilesRef.current = profiles;
  const lastCacheSignatureRef = useRef('');
  const completeSwipeRef = useRef<(direction: 'left' | 'right', swipedItem?: UserProfile) => void>(() => {});
  const animateSwipeOutRef = useRef<(direction: 'left' | 'right') => void>(() => {});
  const resetSwipePositionRef = useRef<() => void>(() => {});
  const isAnimatingRef = useRef(false);
  const rankingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRankedProfileIdsRef = useRef('');
  const swipePosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  // Hides the top card during the profile swap so setValue(0,0) never paints
  // the old person at center while React is still committing the next profile.
  const topCardReveal = useRef(new Animated.Value(1)).current;
  const swapCoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeThresholdRef = useRef(SWIPE_THRESHOLD);
  const deckExitDistanceRef = useRef(width + 160);

  const topProfile = profiles[0];
  const nextProfile = profiles[1];
  const ScreenRoot = isWeb ? View : SafeAreaView;
  const compactWebWidth = Math.max(320, Math.min(safeViewportWidth, webRuntime.screenWidth || safeViewportWidth, 480));
  const deckWidth = isWeb ? (isCompactWeb ? compactWebWidth : safeViewportWidth) : undefined;
  const deckHeight = isWeb ? safeViewportHeight : undefined;
  const motionWidth = Math.max(deckWidth ?? safeViewportWidth, width);
  const swipeThreshold = Math.min(170, Math.max(92, (deckWidth ?? safeViewportWidth) * 0.27));
  const deckExitDistance = Math.max(deckWidth ?? safeViewportWidth, 360) + 190;
  const webDeckStyle =
    isWeb && deckWidth && deckHeight
      ? {
          width: deckWidth,
          height: deckHeight,
          minHeight: deckHeight,
          maxHeight: deckHeight,
          flexBasis: deckHeight,
          flexGrow: 0,
          flexShrink: 0,
          alignSelf: 'center' as const,
          marginHorizontal: 0,
        }
      : null;
  const openPaywall = (feature: string = PRO_FEATURES.startupAnalyzer) => setPaywallFeature(feature);
  const closePaywallToHome = () => {
    setPaywallFeature('');
    navigation?.navigate?.('Main', { screen: 'Swipe' });
  };

  const topProfileAgeText = topProfile && Number(topProfile.age) > 0 ? `, ${topProfile.age}` : '';
  const topProfileLocation = topProfile ? [topProfile.city, topProfile.country].filter(Boolean).join(', ') || 'Remote' : '';
  const topProfileRole = topProfile ? [
    (topProfile as any).occupation || 'Builder',
    (topProfile as any).company ? `@ ${(topProfile as any).company}` : null,
  ].filter(Boolean).join(' ') : '';
  const topProfileBio = topProfile?.bio || 'No bio yet.';
  const topProfileScore = topProfile ? (scoreByIdRef.current.get(topProfile.uid) ?? null) : null;
  const topProfileRank = topProfileScore != null
    ? { score: topProfileScore, reason: '' }
    : myProfile && topProfile
      ? localCommonalityRank(myProfile, [topProfile], 1)[0]
      : null;
  const topCompatibility = Math.max(1, Math.min(100, Math.round(topProfileRank?.score || 50)));
  const topCompatibilityReason = topProfileRank?.reason || '';

  const cardRotate = swipePosition.x.interpolate({
    inputRange: [-motionWidth, 0, motionWidth],
    outputRange: ['-14deg', '0deg', '14deg'],
    extrapolate: 'clamp',
  });
  const topCardScale = swipePosition.x.interpolate({
    inputRange: [-motionWidth, 0, motionWidth],
    outputRange: [0.96, 1, 0.96],
    extrapolate: 'clamp',
  });
  const topCardOpacity = swipePosition.x.interpolate({
    inputRange: [-motionWidth * 0.85, 0, motionWidth * 0.85],
    outputRange: [0.88, 1, 0.88],
    extrapolate: 'clamp',
  });
  const topCardCombinedOpacity = Animated.multiply(topCardOpacity, topCardReveal);
  const nextCardScale = swipePosition.x.interpolate({
    inputRange: [-swipeThreshold, 0, swipeThreshold],
    outputRange: [1, 0.94, 1],
    extrapolate: 'clamp',
  });
  const nextCardTranslateY = swipePosition.x.interpolate({
    inputRange: [-swipeThreshold, 0, swipeThreshold],
    outputRange: [0, 18, 0],
    extrapolate: 'clamp',
  });
  const nextCardOpacity = swipePosition.x.interpolate({
    inputRange: [-swipeThreshold, 0, swipeThreshold],
    outputRange: [1, 0.72, 1],
    extrapolate: 'clamp',
  });
  const previewCoverBoost = topCardReveal.interpolate({
    inputRange: [0, 1],
    outputRange: [0.28, 0],
  });
  const nextCardCombinedOpacity = Animated.add(nextCardOpacity, previewCoverBoost);
  const likeOpacity = swipePosition.x.interpolate({
    inputRange: [0, swipeThreshold],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const nopeOpacity = swipePosition.x.interpolate({
    inputRange: [-swipeThreshold, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const likeBadgeScale = swipePosition.x.interpolate({
    inputRange: [0, swipeThreshold],
    outputRange: [0.84, 1],
    extrapolate: 'clamp',
  });
  const nopeBadgeScale = swipePosition.x.interpolate({
    inputRange: [-swipeThreshold, 0],
    outputRange: [1, 0.84],
    extrapolate: 'clamp',
  });

  const profileIdsKey = useMemo(() => profiles.map((profile) => profile.uid).join('|'), [profiles]);

  const unswipedProfiles = (items: UserProfile[]) =>
    items.filter((profile) => profile?.uid && !swipedSessionIdsRef.current.has(profile.uid));

  useEffect(() => {
    swipeThresholdRef.current = swipeThreshold;
    deckExitDistanceRef.current = deckExitDistance;
  }, [deckExitDistance, swipeThreshold]);

  useEffect(() => {
    if (!user?.uid) {
      swipedSessionIdsRef.current.clear();
      hasUserSwipedRef.current = false;
      allProfilesRef.current = [];
      setProfiles([]);
      setProgressHydrated(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    allProfilesRef.current = [];
    setProfiles([]);
    setActivePhotoIndex(0);
    setInfoExpanded(false);
    setAiOrderingDone(false);
    setProgressHydrated(false);
    setLoading(true);
    void (async () => {
      let storedIds = await readSwipeProgress(user.uid).catch(() => new Set<string>());

      // Instant paint from local cache — avoids the Firestore round-trip on
      // repeat opens. The background merge below keeps it durable.
      if (storedIds.size > 0) {
        swipedSessionIdsRef.current = storedIds;
        hasUserSwipedRef.current = true;
        setProgressHydrated(true);
      }

      // Merge device-local progress with the durable Firestore swipe log.
      // Use getDocsFromCache first for instant paint, then refresh from
      // server in the background so the deck is never blocked on network.
      const mergeFirestoreHistory = async (useCache: boolean) => {
        try {
          const baseQuery = query(
            collection(db, 'swipes'),
            where('fromId', '==', user.uid),
            limit(2000)
          );
          const history = useCache
            ? await getDocsFromCache(baseQuery).catch(() => null)
            : await getDocs(baseQuery).catch(() => null);
          if (!history || cancelled) return;
          history.forEach((entry) => {
            const toId = String(entry.data()?.toId || '').trim();
            if (toId) storedIds.add(toId);
          });
          if (!cancelled) {
            swipedSessionIdsRef.current = storedIds;
            hasUserSwipedRef.current = storedIds.size > 0;
            setProgressHydrated(true);
          }
        } catch {}
      };

      // Lane 1: try local Firestore cache for instant paint
      await mergeFirestoreHistory(true);
      // Lane 2: refresh from server in background
      void mergeFirestoreHistory(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_evt, gestureState) =>
        !isAnimatingRef.current &&
        Math.abs(gestureState.dx) > 14 &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.25,
      onMoveShouldSetPanResponder: (_evt, gestureState) =>
        !isAnimatingRef.current &&
        Math.abs(gestureState.dx) > 14 &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.25,
      onPanResponderMove: (_evt, gestureState) => {
        if (isAnimatingRef.current) return;
        swipePosition.setValue({ x: gestureState.dx, y: gestureState.dy * 0.18 });
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (isAnimatingRef.current) return;
        if (gestureState.dx > swipeThresholdRef.current) animateSwipeOutRef.current('right');
        else if (gestureState.dx < -swipeThresholdRef.current) animateSwipeOutRef.current('left');
        else resetSwipePositionRef.current();
      },
      onPanResponderTerminate: () => resetSwipePositionRef.current(),
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  // --- Scroll step animation ---------------------------------------------
  // The scroll feed is ONE card translated by `scrollPosition`. That makes it
  // fragile in a specific way: if a spring is ever interrupted — mode switch,
  // the card unmounting mid-animation, the app backgrounded — React Native
  // never fires its completion callback, so `isScrollAnimatingRef` stays true
  // forever, the card stays parked ~a screen away, and every further gesture
  // is ignored. That is the "scroll mode goes blank after a few swipes" bug:
  // not a crash, a card translated off-screen with a dead gesture handler.
  //
  // So every scroll animation goes through these three rules:
  //   1. stop whatever is already running before starting a new one;
  //   2. settle through ONE function that clears the flag AND re-centres the
  //      card, so the two can never disagree;
  //   3. keep a timer safety net, in case the spring never reports back.
  const SCROLL_STEP_MS = 900;
  const scrollAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settleScroll = () => {
    if (scrollAnimTimerRef.current) {
      clearTimeout(scrollAnimTimerRef.current);
      scrollAnimTimerRef.current = null;
    }
    isScrollAnimatingRef.current = false;
    scrollPosition.stopAnimation();
    scrollPosition.setValue(0);
  };

  const animateScrollStep = (from: number) => {
    settleScroll();
    isScrollAnimatingRef.current = true;
    scrollAnimStartedAtRef.current = Date.now();
    scrollPosition.setValue(from);
    Animated.timing(scrollPosition, {
      toValue: 0,
      duration: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      scrollPosition.setValue(0);
      isScrollAnimatingRef.current = false;
    });
    // Safety net: if the JS thread stalls or the animation callback never
    // fires (mode switch, backgrounding), force-reset after a generous
    // window so the next gesture is never permanently blocked.
    if (scrollAnimTimerRef.current) clearTimeout(scrollAnimTimerRef.current);
    scrollAnimTimerRef.current = setTimeout(() => {
      scrollPosition.setValue(0);
      isScrollAnimatingRef.current = false;
      scrollAnimTimerRef.current = null;
    }, 400);
  };

  const springScrollBack = () => {
    settleScroll();
    scrollPosition.setValue(0);
  };

  const goToProfile = (dir: 'up' | 'down') => {
    // A sponsored slot on screen resolves before the feed moves again. The
    // sponsored stop is an ad, not a discovery, so it never spends budget.
    if (resolveSponsorRef.current('skip')) return;
    // If the previous scroll animation is stuck (e.g. the app was backgrounded
    // mid-animation), force-reset so the next gesture is never permanently
    // blocked — the "blank screen after a few swipes" bug.
    if (isScrollAnimatingRef.current) {
      settleScroll();
    }
    const len = feedRef.current.length;
    const cur = scrollIndexRef.current;
    if (dir === 'up' && cur < len - 1) {
      // SCROLLING IS BROWSING — always free, never paywalled. The 12-per-12h
      // discovery budget is spent by ACTIONS (like/pass/request), not by
      // looking, so swiping up must never open the paywall. The feed still
      // locks at the last card (see the scrollIndex clamp below) instead of
      // running past the end and looping back to the first profile.
      setScrollIndex(cur + 1);
      scrollIndexRef.current = cur + 1;
      animateScrollStep(360);
      // Every DISCOVER_SPONSORED_EVERY advances, queue the sponsored slot.
      swipesSinceSponsorRef.current += 1;
      if (swipesSinceSponsorRef.current >= DISCOVER_SPONSORED_EVERY) {
        swipesSinceSponsorRef.current = 0;
        maybeShowSponsorRef.current();
      }
    } else if (dir === 'down' && cur > 0) {
      setScrollIndex(cur - 1);
      scrollIndexRef.current = cur - 1;
      animateScrollStep(-360);
    }
  };

  const goToProfileRef = useRef<(dir: 'up' | 'down') => void>(() => {});
  goToProfileRef.current = goToProfile;

  // Switching modes must never leave the feed parked off-centre by a step
  // animation that was still in flight when the card unmounted.
  useEffect(() => {
    settleScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Non-Plus users can never enter scroll mode. If they somehow land here
  // (stale state, deep link), force them back to swipe.
  useEffect(() => {
    if (mode === 'scroll' && !isProUser) {
      setMode('swipe');
      settleScroll();
    }
  }, [mode, isProUser]);

  useEffect(
    () => () => {
      if (scrollAnimTimerRef.current) clearTimeout(scrollAnimTimerRef.current);
    },
    []
  );

  // The feed shrinks under the scroll index whenever a card is liked/passed.
  // Without this clamp scrollIndex points past the end, renderScrollProfile
  // falls back to feed[0], and the deck silently loops back to the first
  // profile — "it just keeps scrolling" instead of stopping at the last card.
  useEffect(() => {
    const len = feed.length;
    if (len === 0) {
      if (scrollIndexRef.current !== 0) {
        scrollIndexRef.current = 0;
        setScrollIndex(0);
      }
      return;
    }
    if (scrollIndexRef.current > len - 1) {
      const clamped = len - 1;
      scrollIndexRef.current = clamped;
      setScrollIndex(clamped);
    }
  }, [feed]);

  const scrollAnimStartedAtRef = useRef(0);

  const scrollPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_evt, gs) => {
        // If animation has been running for too long (>400ms), it is stuck.
        // Force-reset so the user is never locked out of the feed.
        if (isScrollAnimatingRef.current && Date.now() - scrollAnimStartedAtRef.current > 400) {
          settleScroll();
        }
        return !isScrollAnimatingRef.current && Math.abs(gs.dy) > 12 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5;
      },
      onMoveShouldSetPanResponder: (_evt, gs) => {
        if (isScrollAnimatingRef.current && Date.now() - scrollAnimStartedAtRef.current > 400) {
          settleScroll();
        }
        return !isScrollAnimatingRef.current && Math.abs(gs.dy) > 12 && Math.abs(gs.dy) > Math.abs(gs.dx) * 1.5;
      },
      onPanResponderGrant: () => {
        scrollPosition.setValue(0);
      },
      onPanResponderMove: (_evt, gs) => {
        if (isScrollAnimatingRef.current) return;
        scrollPosition.setValue(gs.dy * 0.5);
      },
      onPanResponderRelease: (_evt, gs) => {
        if (isScrollAnimatingRef.current) return;
        if (gs.dy < -70) {
          goToProfileRef.current('up');
        } else if (gs.dy > 70) {
          goToProfileRef.current('down');
        } else {
          springScrollBack();
        }
      },
      onPanResponderTerminate: () => {
        springScrollBack();
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  useEffect(() => {
    if (!user?.uid) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    if (!isFocused || !progressHydrated) return;
    let isMounted = true;
    if (allProfilesRef.current.length === 0) setLoading(true);
    readCachedDiscovery(user.uid).then((cachedProfiles) => {
      if (!isMounted) return;
      const instantProfiles = unswipedProfiles(cachedProfiles);
      if (instantProfiles.length) {
        allProfilesRef.current = cachedProfiles;
        setProfiles(instantProfiles);
        setLoading(false);
      }
    });
    const unsubscribe = subscribeToDiscoveryProfiles({
      userId: user.uid,
      onData: (allUsers) => {
        const visibleUsers = allUsers
          .filter((profile: any) => profile.uid !== user.uid && isDiscoverableProfile(profile))
          .sort((a: any, b: any) => (b.turboConnect ? 1 : 0) - (a.turboConnect ? 1 : 0));
        const mergedUsers = visibleUsers;
        const locallyRanked = myProfile ? localCommonalityRank(myProfile, mergedUsers, mergedUsers.length) : [];
        const localScoreById = new Map(locallyRanked.map((rank) => [rank.uid, rank.score]));
        const orderedUsers = locallyRanked.length
          ? [...mergedUsers].sort(
              (a: any, b: any) =>
                ((localScoreById.get(b.uid) ?? 0) + (b.turboConnect ? 8 : 0)) -
                ((localScoreById.get(a.uid) ?? 0) + (a.turboConnect ? 8 : 0))
            )
          : mergedUsers;

        if (orderedUsers.length === 0 && allProfilesRef.current.length > 0) {
          setLoading(false);
          return;
        }

        allProfilesRef.current = orderedUsers;
        // Cold-start cache write, guarded by a signature check.
        //
        // This listener re-emits on every write to any profile in the pool
        // (presence, updatedAt, view tracking), and each emission used to
        // serialise the whole deck to AsyncStorage — a multi-hundred-KB JSON
        // write on the JS thread, on Android, several times per swipe. That
        // is a long main-thread stall, which is what "it goes blank while I
        // keep swiping" looks like from the outside. The cache only needs to
        // change when the actual roster changes.
        const cacheSignature = `${orderedUsers.length}:${deckKey(orderedUsers)}`;
        if (cacheSignature !== lastCacheSignatureRef.current) {
          lastCacheSignatureRef.current = cacheSignature;
          writeCachedDiscovery(user.uid, orderedUsers.filter((profile) => !isSyntheticProfile(profile))).catch(() => {});
        }
        const remainingUsers = unswipedProfiles(orderedUsers);
        if (remainingUsers.length === 0 && orderedUsers.length > 0) {
          // Pool exhausted — try to load more profiles from pagination
          // before resorting to a full reset that causes duplicates.
          if (!allLoadedRef.current && !loadingMoreRef.current) {
            void (async () => {
              try {
                const moreProfiles = await loadMoreDiscoveryProfiles();
                if (moreProfiles.length > 0) {
                  const existingIds = new Set(orderedUsers.map((p) => p.uid));
                  const freshProfiles = moreProfiles.filter(
                    (p) => !existingIds.has(p.uid) && !swipedSessionIdsRef.current.has(p.uid)
                  );
                  if (freshProfiles.length > 0) {
                    allProfilesRef.current = [...orderedUsers, ...freshProfiles];
                    setProfiles(freshProfiles);
                    setLoading(false);
                    return;
                  }
                }
                allLoadedRef.current = true;
              } catch {}
              // No more profiles anywhere — safe to reset the seen set.
              swipedSessionIdsRef.current.clear();
              hasUserSwipedRef.current = false;
              if (user?.uid) void clearSwipeProgress(user.uid);
              setProfiles(orderedUsers);
              setLoading(false);
            })();
            return;
          }
          // Already tried pagination — reset.
          swipedSessionIdsRef.current.clear();
          hasUserSwipedRef.current = false;
          if (user?.uid) void clearSwipeProgress(user.uid);
          setProfiles(orderedUsers);
          setLoading(false);
          return;
        }
        if (hasUserSwipedRef.current) {
          setProfiles((current) => {
            const currentIds = new Set(current.map((profile) => profile.uid));
            const additions = remainingUsers.filter(
              (profile) => !swipedSessionIdsRef.current.has(profile.uid) && !currentIds.has(profile.uid)
            );
            return additions.length ? [...current, ...additions] : current;
          });
        } else if (deckKey(remainingUsers) !== deckKey(profilesRef.current)) {
          // Rebuild only when the visible deck actually changed.
          //
          // The discovery listener is shared and re-emits whenever ANY profile
          // in the pool is written — someone's presence, an updatedAt, a
          // viewer count. Each of those emissions used to hand React a brand
          // new array, which re-rendered the deck, re-ran the local sort and,
          // on Android, read as the whole screen refreshing itself. Identical
          // uid order = nothing to do.
          setProfiles(remainingUsers);
        }
        setAiOrderingDone(false);
        setLoading(false);
      },
      onError: (error) => {
        console.error('SwipeScreen query error:', error);
        setLoading(false);
      },
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [isFocused, progressHydrated, user?.uid, myProfile?.uid]);

  useEffect(() => {
    if (!user?.uid || !isFocused || aiOrderingDone || profiles.length < 2 || hasUserSwipedRef.current) return;

    let cancelled = false;
    let interaction: { cancel?: () => void } | null = null;
    if (rankingTimerRef.current) {
      clearTimeout(rankingTimerRef.current);
      rankingTimerRef.current = null;
    }

    const currentProfileIds = profiles
      .filter((profile) => !isSyntheticProfile(profile))
      .slice(0, DISCOVERY_LIMIT)
      .map(p => p.uid)
      .sort()
      .join(',');

    if (currentProfileIds === lastRankedProfileIdsRef.current) {
      setAiOrderingDone(true);
      return () => {
        cancelled = true;
      };
    }

    rankingTimerRef.current = setTimeout(() => {
      interaction = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        try {
          const candidates = profiles
            .filter((profile) => !isSyntheticProfile(profile))
            .slice(0, DISCOVERY_LIMIT);
          if (candidates.length < 2) return;
          const ranked = await rankCandidatesHybrid(myProfile, candidates, Math.min(candidates.length, 12));
          if (cancelled || ranked.length === 0 || hasUserSwipedRef.current) return;

          lastRankedProfileIdsRef.current = currentProfileIds;
          scoreByIdRef.current = new Map(ranked.map((rank) => [rank.uid, rank.score]));
          setProfiles((current) =>
            [...current].sort(
              (a: any, b: any) =>
                ((scoreByIdRef.current.get(b.uid) ?? -1) + (b.turboConnect ? 8 : 0)) -
                ((scoreByIdRef.current.get(a.uid) ?? -1) + (a.turboConnect ? 8 : 0))
            )
          );
        } catch {
          // Local ranking is already applied. Keep swipe stable.
        } finally {
          if (!cancelled) setAiOrderingDone(true);
        }
      })();
      });
    }, 3500);

    return () => {
      cancelled = true;
      if (rankingTimerRef.current) {
        clearTimeout(rankingTimerRef.current);
        rankingTimerRef.current = null;
      }
      interaction?.cancel?.();
    };
  }, [isFocused, user?.uid, myProfile?.uid, profileIdsKey, aiOrderingDone, profiles.length]);

  // After a swipe the top card is hidden (topCardReveal=0) and re-centred while
  // the preview card underneath already shows the next person. Reveal only once
  // React has committed the new topProfile so we never flash the old face.
  const prevTopUidRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const uid = topProfile?.uid ?? null;
    if (prevTopUidRef.current !== uid && prevTopUidRef.current !== null) {
      if (swapCoverTimerRef.current) {
        clearTimeout(swapCoverTimerRef.current);
        swapCoverTimerRef.current = null;
      }
      topCardReveal.setValue(1);
      swipePosition.setValue({ x: 0, y: 0 });
      isAnimatingRef.current = false;
    }
    prevTopUidRef.current = uid;
  }, [topProfile?.uid]);

  useEffect(() => {
    if (!user?.uid || !isFocused || !topProfile || isSyntheticProfile(topProfile)) return;

    let cancelled = false;
    const interaction = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      trackProfileView({
        profileId: topProfile.uid,
        viewerId: user.uid,
        viewerName: user.displayName || 'Someone',
        notify: false,
      }).catch((error) => console.warn('Swipe view tracking skipped:', error));
    });

    return () => {
      cancelled = true;
      interaction.cancel();
    };
  }, [isFocused, topProfile?.uid, user?.uid]);

  const allLoadedRef = useRef(false);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    if (profiles.length > 3 || allLoadedRef.current || loadingMoreRef.current || !user?.uid) return;
    let cancelled = false;
    loadingMoreRef.current = true;
    void (async () => {
      try {
        const moreProfiles = await loadMoreDiscoveryProfiles();
        if (cancelled || moreProfiles.length === 0) {
          if (moreProfiles.length === 0) allLoadedRef.current = true;
          return;
        }
        const existingIds = new Set(allProfilesRef.current.map((p) => p.uid));
        const newProfiles = moreProfiles.filter((p) => !existingIds.has(p.uid) && !swipedSessionIdsRef.current.has(p.uid));
        if (newProfiles.length === 0) {
          allLoadedRef.current = true;
          return;
        }
        allProfilesRef.current = [...allProfilesRef.current, ...newProfiles];
        setProfiles((current) => [...current, ...newProfiles]);
      } finally {
        if (!cancelled) loadingMoreRef.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [profiles.length, user?.uid]);

  useEffect(() => {
    const toPrefetch = [topProfile, nextProfile, profiles[2], profiles[3], profiles[4]].filter(Boolean);
    toPrefetch.forEach((profile) => {
      getSwipePhotos(profile as UserProfile)
        .slice(0, 1)
        .filter((uri) => /^https?:\/\//.test(uri))
        .forEach((uri) => Image.prefetch(uri).catch(() => {}));
    });
  }, [topProfile?.uid, nextProfile?.uid, profiles.length]);

  useEffect(() => {
    // Photo upgrade pass. Lean index rows and the instant-cache carry no
    // guaranteed pic (index keeps <=240KB data URIs; cache is https-only), so
    // a card can arrive faceless. For the visible top cards with no renderable
    // pic, pull their single users doc ONCE per session and patch real photos
    // in place. Bounded, cached, and silent.
    // Scroll mode shows the card at the scroll index, which can sit far from
    // the top of the deck, so that card is upgraded too — otherwise deep cards
    // are the only ones that stay faceless.
    [
      topProfile,
      nextProfile,
      profiles[2],
      profiles[3],
      profiles[4],
      mode === 'scroll' ? feedRef.current[Math.min(scrollIndexRef.current, feedRef.current.length - 1)] : null,
    ]
      .filter(Boolean)
      .forEach((target: any) => {
        if (!target?.uid || photoUpgradedRef.current.has(target.uid)) return;
        if (isSafeSwipePhoto(target.profilePic)) return;
        photoUpgradedRef.current.add(target.uid);
        void getDoc(doc(db, 'users', target.uid))
          .then((snap) => {
            if (!snap.exists()) return;
            const u: any = snap.data();
            const candidates = [
              u.profilePic,
              ...(Array.isArray(u.photos) ? u.photos : []),
              u.photoURL,
              u.photoUrl,
              u.avatarUrl,
              u.picture,
            ];
            const usable = candidates.filter(isSafeSwipePhoto);
            if (!usable.length) return;
            const photos =
              Array.isArray(u.photos) && u.photos.filter(isSafeSwipePhoto).length
                ? u.photos.filter(isSafeSwipePhoto)
                : [usable[0]];
            const patch = (list: any[]) =>
              list.map((cp) => (cp.uid === target.uid ? { ...cp, profilePic: usable[0], photos } : cp));
            setProfiles((current) => patch(current as any[]));
            allProfilesRef.current = patch(allProfilesRef.current as any[]);
          })
          .catch(() => {});
      });
  }, [topProfile?.uid, nextProfile?.uid, profiles.length, mode, scrollIndex]);

  useEffect(() => {
    setInfoExpanded(false);
  }, [topProfile?.uid]);

  useEffect(() => {
    if (!user?.uid || !isFocused || !topProfile?.uid || isSyntheticProfile(topProfile)) {
      setConnectionRequest(null);
      return;
    }

    return subscribeToConnectionRequest(user.uid, topProfile.uid, setConnectionRequest);
  }, [isFocused, topProfile?.uid, user?.uid]);

  const handleLike = async (target: UserProfile) => {
    if (!user?.uid || !target || isSyntheticProfile(target)) return;
    try {
      await addDoc(collection(db, 'swipes'), {
        fromId: user.uid,
        toId: target.uid,
        type: 'like',
        timestamp: serverTimestamp(),
      });

      const reciprocalQuery = query(
        collection(db, 'swipes'),
        where('fromId', '==', target.uid),
        where('toId', '==', user.uid),
        where('type', '==', 'like')
      );
      const querySnapshot = await getDocs(reciprocalQuery);

      await requestConnection({
        senderId: user.uid,
        recipientId: target.uid,
        senderName: displayNameFor(myProfile || user),
        senderPic: storedProfileImageUri((myProfile as any)?.profilePicUrl || myProfile?.profilePic || user.photoURL || ''),
        message: querySnapshot.empty ? 'liked your profile and wants to talk.' : 'liked you back and wants to talk.',
        recipientName: displayNameFor(target),
      }).catch(() => {});

      if (querySnapshot.empty) {
        await addDoc(collection(db, 'notifications'), {
          userId: target.uid,
          fromId: user.uid,
          type: 'like',
          content: 'liked your profile!',
          isRead: false,
          timestamp: serverTimestamp(),
        });
      }
    } catch (error) {
      console.warn('Swipe like skipped:', error);
    }
  };

  const handleContactRequest = async () => {
    const target = profiles[0];
    if (!user?.uid || !target || isSyntheticProfile(target) || contactBusy) return;

    if (connectionRequest?.status === 'approved') {
      const matchId = await ensureDirectMatch(user.uid, target.uid);
      navigation.navigate('Chat', { matchId, otherUser: target });
      return;
    }

    if (connectionRequest?.status === 'pending') {
      notifyUser('Request pending', `${displayNameFor(target)} has not answered yet.`);
      return;
    }

    if (connectionRequest?.status === 'rejected') {
      notifyUser('Request rejected', `${displayNameFor(target)} declined this request.`);
      return;
    }

    const drafted = await connectionNote.ask(displayNameFor(target));
    if (drafted === null) return;

    setContactBusy(true);
    try {
      const request = await requestConnection({
        senderId: user.uid,
        recipientId: target.uid,
        senderName: displayNameFor(myProfile || user),
        senderPic: storedProfileImageUri((myProfile as any)?.profilePicUrl || myProfile?.profilePic || user.photoURL || ''),
        message: drafted,
        recipientName: displayNameFor(target),
      });
      setConnectionRequest(request);
      trackAction('connect');
      notifyUser('Request sent', `${displayNameFor(target)} can approve or reject it.`);
    } catch (error) {
      console.warn('Contact request failed:', error);
      notifyUser('Request failed', 'Could not send this contact request. Check Firebase rules and try again.');
    } finally {
      setContactBusy(false);
    }
  };

  const completeSwipe = (direction: 'left' | 'right', swipedItem?: UserProfile) => {
    // Sponsored interstitial consumes itself — no profile is touched, no
    // budget is burned, no like/skip is written to Firestore.
    if (discoverySponsor) {
      swipePosition.stopAnimation();
      topCardReveal.setValue(1);
      swipePosition.setValue({ x: 0, y: 0 });
      hasUserSwipedRef.current = true;
      setActivePhotoIndex(0);
      setInfoExpanded(false);
      if (direction === 'right') {
        void recordCampaignClick(discoverySponsor.campaignId, user?.uid || '');
        if (discoverySponsor.house) {
          openPaywall('Unlimited Discovery');
        } else if (discoverySponsor.website) {
          Linking.openURL(discoverySponsor.website).catch(() => {});
        }
      }
      setDiscoverySponsor(null);
      trackAction('swipe');
      return;
    }

    const item = swipedItem || profiles[0];
    if (!item) return;

    hasUserSwipedRef.current = true;
    swipedSessionIdsRef.current.add(item.uid);
    lastSwipedProfileRef.current = item;
    if (user?.uid) {
      void writeSwipeProgress(user.uid, Array.from(swipedSessionIdsRef.current));
    }

    setActivePhotoIndex(0);
    setInfoExpanded(false);
    setProfiles((current) => {
      if (current[0]?.uid === item.uid) return current.slice(1);
      return current.filter((profile) => profile.uid !== item.uid);
    });

    if (direction === 'right') {
      void handleLike(item);
    } else if (user?.uid && !isSyntheticProfile(item)) {
      // Passes count as "seen" too — persist them durably so this person
      // never comes back, on any device.
      void addDoc(collection(db, 'swipes'), {
        fromId: user.uid,
        toId: item.uid,
        type: 'skip',
        timestamp: serverTimestamp(),
      }).catch(() => {});
    }

    // Card mode AND scroll mode spend the same 12-per-12h discovery budget;
    // PLUS is unlimited. The gate itself lives in animateSwipeOut/goToProfile,
    // so anything that reaches here was already allowed through the wall.
    void spendDiscoveryBudget(item.uid);

    trackAction(direction === 'right' ? 'like' : 'swipe');

    // Every DISCOVER_SPONSORED_EVERY real swipes, queue the sponsored slot.
    swipesSinceSponsorRef.current += 1;
    if (swipesSinceSponsorRef.current >= DISCOVER_SPONSORED_EVERY) {
      swipesSinceSponsorRef.current = 0;
      maybeShowDiscoverySponsor();
    }
  };

  const resetSwipePosition = () => {
    swipePosition.stopAnimation();
    Animated.spring(swipePosition, {
      toValue: { x: 0, y: 0 },
      tension: 85,
      friction: 9,
      useNativeDriver: false,
    }).start(() => {
      isAnimatingRef.current = false;
    });
  };

  const startSwipeAnimation = (direction: 'left' | 'right', swipedItem: UserProfile) => {
    isAnimatingRef.current = true;
    setInfoExpanded(false);
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      // useNativeDriver:false — all updates on JS thread, no timing gap.
      // Reset position + swap profiles atomically. No hide/reveal needed.
      swipePosition.stopAnimation();
      swipePosition.setValue({ x: 0, y: 0 });
      completeSwipe(direction, swipedItem);
      isAnimatingRef.current = false;
    };

    Animated.timing(swipePosition, {
      toValue: { x: direction === 'right' ? deckExitDistanceRef.current : -deckExitDistanceRef.current, y: 0 },
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(finish);

    setTimeout(finish, 220);
  };

  const animateSwipeOut = (direction: 'left' | 'right') => {
    // In scroll mode the card on screen is the one at the scroll index, NOT
    // profiles[0] — without this a like/pass in the feed acted on (and billed)
    // whichever profile happened to sit at the top of the deck.
    const swipedItem = mode === 'scroll' ? (feedRef.current[scrollIndexRef.current] || profiles[0]) : profiles[0];
    if (isAnimatingRef.current || (!discoverySponsor && !swipedItem)) return;
    // Sponsored cards never hit the discovery gate — they are ads, not
    // discoveries. Scroll mode DOES: it spends the same 12-per-12h budget as
    // the swipe deck, so the wall locks this feed too. A card already paid for
    // (scrolled back over) is never re-charged.
    if (!discoverySponsor && !hasDiscoveryBudget(swipedItem?.uid)) {
      openPaywall('Unlimited Discovery');
      return;
    }

    startSwipeAnimation(direction, swipedItem as UserProfile);
  };

  completeSwipeRef.current = completeSwipe;
  animateSwipeOutRef.current = animateSwipeOut;
  resetSwipePositionRef.current = resetSwipePosition;

  const rewindLast = () => {
    const last = lastSwipedProfileRef.current;
    if (!last || isAnimatingRef.current) return;
    // Rewinds are a PLUS power tool — free swipes are final.
    if (!isProUser) {
      openPaywall('Unlimited Rewinds');
      return;
    }
    lastSwipedProfileRef.current = null;
    topCardReveal.setValue(1);
    swipePosition.setValue({ x: 0, y: 0 });
    isAnimatingRef.current = false;
    setInfoExpanded(false);
    swipedSessionIdsRef.current.delete(last.uid);
    setProfiles((current) => [last, ...current]);
  };

  const resetDeck = () => {
    swipedSessionIdsRef.current.clear();
    hasUserSwipedRef.current = false;
    if (user?.uid) {
      void clearSwipeProgress(user.uid);
    }
    setActivePhotoIndex(0);
    setInfoExpanded(false);
    setAiOrderingDone(false);
    topCardReveal.setValue(1);
    swipePosition.setValue({ x: 0, y: 0 });
    isAnimatingRef.current = false;
    setProfiles(allProfilesRef.current);
  };

  const openInfoPanel = React.useCallback(() => {
    if (isAnimatingRef.current || !topProfile) return;
    swipePosition.stopAnimation();
    topCardReveal.setValue(1);
    swipePosition.setValue({ x: 0, y: 0 });
    setInfoExpanded(true);
  }, [topProfile]);

  const renderEmpty = () => {
    if (mode === 'scroll' && !isProUser && swipesLeft === 0) {
      return (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIcon}>
            <Zap size={26} color={COLORS.primary} />
          </View>
          <Text style={[styles.emptyText, { color: textColor(isDark) }]}>Daily limit reached</Text>
          <Text style={[styles.emptySubtext, { color: textColor(isDark, 'muted') }]}>
            You've used your free discovery quota. Upgrade to PLUS for unlimited swipes.
          </Text>
          <TouchableOpacity style={styles.resetBtn} onPress={() => openPaywall('Unlimited Discovery')}>
            <Text style={styles.resetText}>Go PLUS</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIcon}>
          <Target size={26} color="#111" />
        </View>
        <Text style={[styles.emptyText, { color: textColor(isDark) }]}>No one left to meet</Text>
        <Text style={[styles.emptySubtext, { color: textColor(isDark, 'muted') }]}>
          {allProfilesRef.current.length === 0
            ? 'The network is still small. Invite people you know, then refresh.'
            : "You've seen everyone here. Invite more builders or refresh the deck."}
        </Text>
        <TouchableOpacity style={styles.resetBtn} onPress={() => void shareLinkupInvite()}>
          <Text style={styles.resetText}>Invite builders</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.resetBtn, styles.resetGhost]} onPress={resetDeck}>
          <Text style={[styles.resetText, { color: textColor(isDark) }]}>Refresh</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderPreviewCard = () => {
    if (!nextProfile || infoExpanded) return null;
    const photos = getSwipePhotos(nextProfile);
    const ageText = Number(nextProfile.age) > 0 ? `, ${nextProfile.age}` : '';
    const roleText = [
      (nextProfile as any).occupation || 'Builder',
      (nextProfile as any).company ? `@ ${(nextProfile as any).company}` : null,
    ].filter(Boolean).join(' ');

    return (
      <Animated.View
        // Deliberately NOT keyed on the profile uid. A uid key made React
        // unmount and rebuild this view after every swipe, so expo-image had
        // to re-attach and re-decode the photo from scratch: one empty frame
        // per swipe, which is the blink. One stable view, one swap of the
        // image uri, no remount.
        key="swipe-preview-card"
        pointerEvents="none"
        style={[
          styles.card,
          styles.deckCardLayer,
          styles.previewCard,
          liquidGlass(isDark, false),
          isWeb && (isCompactWeb ? styles.compactWebCard : styles.webCard),
          {
            opacity: nextCardCombinedOpacity,
            transform: [{ translateY: nextCardTranslateY }, { scale: nextCardScale }],
          },
        ]}
      >
        <AppImage uri={ikCard(photos[0]) || FALLBACK_PHOTO} style={[styles.cardImg, styles.faceFocusedImg]} transitionMs={0} />
        <View style={styles.previewOverlay} pointerEvents="none" />
        <View style={styles.previewInfo}>
          <Text style={styles.previewEyebrow}>Up next</Text>
          <View style={styles.previewNameRow}>
            <Text style={styles.previewName} numberOfLines={1}>
              {displayNameFor(nextProfile)}{ageText}
            </Text>
            {!!nextProfile.isVerified && <VerifiedBadge size={20} />}
          </View>
          <Text style={styles.previewRole} numberOfLines={1}>{roleText}</Text>
        </View>
      </Animated.View>
    );
  };

  /**
   * Sponsored card chrome.
   *
   * The card-mode styles hardcoded `#FFFFFF` for the title and a white pill,
   * so in light mode the product name was white-on-white and simply vanished
   * (and the "SPONSORED" pill had no background to speak of). Everything
   * here now derives from the theme; the pill uses the same ink-on-paper
   * inversion as the Campaigns hero so it reads in both modes.
   */
  const sponsorPillBg = isDark ? '#FFFFFF' : COLORS.inkButton;
  const sponsorPillInk = isDark ? '#0A0B0D' : '#FFFFFF';
  const sponsorTileBg = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(10, 11, 13, 0.06)';
  const sponsorIconInk = isDark ? '#FFFFFF' : COLORS.inkButton;

  const renderSponsorBadge = () => (
    <View style={[styles.sponsorPill, { backgroundColor: sponsorPillBg }]}>
      <Text style={[styles.sponsorPillText, { color: sponsorPillInk }]}>SPONSORED</Text>
    </View>
  );

  const renderSponsorLogo = () => (
    <View style={[styles.sponsorIconTile, !discoverySponsor?.logo && { backgroundColor: sponsorTileBg }]}>
      {discoverySponsor?.logo ? (
        <Image source={{ uri: ikAvatar(discoverySponsor.logo) }} style={styles.sponsorLogo} resizeMode="cover" />
      ) : discoverySponsor?.house ? (
        <Zap size={38} color={sponsorIconInk} fill={sponsorIconInk} />
      ) : (
        <Package size={38} color={sponsorIconInk} />
      )}
    </View>
  );

  const renderSponsoredCard = () => {
    if (!discoverySponsor) return null;
    // One line, not a paragraph: what the product does, at a glance.
    const sponsorLine = sponsorOneLiner(discoverySponsor);
    return (
      <Animated.View
        key={`sponsor-${discoverySponsor.id}`}
        style={[
          styles.card,
          styles.deckCardLayer,
          liquidGlass(isDark, false),
          isWeb && (isCompactWeb ? styles.compactWebCard : styles.webCard),
          {
            opacity: topCardCombinedOpacity,
            transform: isWeb
              ? [{ translateX: swipePosition.x }, { translateY: swipePosition.y }]
              : [
                  { translateX: swipePosition.x },
                  { translateY: swipePosition.y },
                  { rotate: cardRotate },
                  { scale: topCardScale },
                ],
          },
        ]}
        {...(infoExpanded ? {} : panResponder.panHandlers)}
      >
        <View style={styles.sponsorBody}>
          {renderSponsorBadge()}
          {renderSponsorLogo()}
          <Text style={[styles.sponsorTitle, { color: textColor(isDark) }]} numberOfLines={2}>
            {discoverySponsor.title}
          </Text>
          {!!sponsorLine && (
            <Text style={[styles.sponsorTagline, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>
              {sponsorLine}
            </Text>
          )}
          <TouchableOpacity
            activeOpacity={0.88}
            style={styles.sponsorCta}
            onPress={() => {
              void recordCampaignClick(discoverySponsor.campaignId, user?.uid || '');
              if (discoverySponsor.house) openPaywall('Unlimited Discovery');
              else if (discoverySponsor.website) Linking.openURL(discoverySponsor.website).catch(() => {});
            }}
          >
            <Globe size={15} color="#000" />
            <Text style={styles.sponsorCtaText}>{discoverySponsor.house ? 'Upgrade to PLUS' : 'Visit Website'}</Text>
          </TouchableOpacity>
          <Text style={styles.sponsorHint}>Swipe right to open · left to skip</Text>
        </View>
      </Animated.View>
    );
  };

  const renderCard = () => {
    if (discoverySponsor) return renderSponsoredCard();
    if (!topProfile) return renderEmpty();

    const photos = getSwipePhotos(topProfile);
    const safeIndex = Math.min(activePhotoIndex, Math.max(0, photos.length - 1));
    const ageText = Number(topProfile.age) > 0 ? `, ${topProfile.age}` : '';
    const locationText = [topProfile.city, topProfile.country].filter(Boolean).join(', ') || 'Remote';
    const roleText = [
      (topProfile as any).occupation || 'Builder',
      (topProfile as any).company ? `@ ${(topProfile as any).company}` : null,
    ].filter(Boolean).join(' ');
    const lookingFor = Array.isArray((topProfile as any).lookingFor) ? (topProfile as any).lookingFor : [];
    const industries = Array.isArray((topProfile as any).industries) ? (topProfile as any).industries : [];
    const bio = topProfile.bio || 'No bio yet. Open their profile to learn more.';
    const existingScore = scoreByIdRef.current.get(topProfile.uid);
    const matchRank = existingScore != null ? { score: existingScore, reason: '' } : (myProfile ? localCommonalityRank(myProfile, [topProfile], 1)[0] : null);
    const compatibility = Math.max(1, Math.min(100, Math.round(matchRank?.score || 50)));
    const compatibilityReason = matchRank?.reason || 'Compatibility based on profile signals';
    const requestLabel =
      contactBusy
        ? '…'
        : connectionRequest?.status === 'approved'
          ? 'Chat'
          : connectionRequest?.status === 'pending'
            ? 'Sent'
            : connectionRequest?.status === 'rejected'
              ? 'Declined'
              : 'Request';
    const renderCardActions = () => (
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtnSmall} onPress={() => animateSwipeOut('left')} activeOpacity={0.85}>
          <View style={styles.actionBtnInnerSmall}>
            <X size={22} color="#E11D48" />
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.contactActionBtn,
            connectionRequest?.status === 'approved' && styles.contactApprovedBtn,
            connectionRequest?.status === 'pending' && styles.contactPendingBtn,
            connectionRequest?.status === 'rejected' && styles.contactRejectedBtn,
          ]}
          disabled={contactBusy || !topProfile || isSyntheticProfile(topProfile)}
          onPress={handleContactRequest}
          activeOpacity={0.88}
        >
          <MessageSquare size={18} color="#111" />
          <Text style={styles.contactActionText}>{requestLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtnLarge} onPress={() => animateSwipeOut('right')} activeOpacity={0.88}>
          <View style={styles.actionBtnInnerLarge}>
            <Heart size={26} color="#111" fill="#111" />
          </View>
        </TouchableOpacity>
      </View>
    );

    return (
      <Animated.View
        // Stable key, same as the preview card: the deck is one persistent
        // view whose contents change, not a new view per person. Keying on
        // the uid remounted it on every swipe and flashed an empty card.
        key="swipe-top-card"
        style={[
          styles.card,
          styles.deckCardLayer,
          liquidGlass(isDark, false),
          isWeb && (isCompactWeb ? styles.compactWebCard : styles.webCard),
          {
            opacity: topCardCombinedOpacity,
            transform: isWeb
              ? [{ translateX: swipePosition.x }, { translateY: swipePosition.y }]
              : [
                  { translateX: swipePosition.x },
                  { translateY: swipePosition.y },
                  { rotate: cardRotate },
                  { scale: topCardScale },
                ],
          },
        ]}
        {...(infoExpanded ? {} : panResponder.panHandlers)}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.badge,
            styles.likeBadge,
            {
              opacity: likeOpacity,
              transform: [{ rotate: '-14deg' }, { scale: likeBadgeScale }],
            },
          ]}
        >
          <Text style={[styles.badgeText, { color: '#4ADE80' }]}>Like</Text>
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.badge,
            styles.nopeBadge,
            {
              opacity: nopeOpacity,
              transform: [{ rotate: '14deg' }, { scale: nopeBadgeScale }],
            },
          ]}
        >
          <Text style={[styles.badgeText, { color: '#FF4444' }]}>NOPE</Text>
        </Animated.View>

        <AppImage uri={ikCard(photos[safeIndex]) || FALLBACK_PHOTO} style={[styles.cardImg, styles.faceFocusedImg]} transitionMs={0} />
        <View style={[styles.cardOverlay, infoExpanded && styles.cardOverlayExpanded]} pointerEvents="none" />

        <View style={[styles.cardInfo, isCompactWeb && styles.compactCardInfo]}>
          <View style={styles.cardTopRow}>
            {photos.length > 1 ? (
              <View style={styles.photoDots}>
                {photos.slice(0, 5).map((_, idx) => (
                  <TouchableOpacity
                    key={`${topProfile.uid}-dot-${idx}`}
                    onPress={() => setActivePhotoIndex(idx)}
                    style={[styles.photoDot, idx === safeIndex && styles.photoDotOn]}
                  />
                ))}
              </View>
            ) : <View />}
            <View style={styles.aiBadge}>
              <Text style={styles.aiBadgeText}>{compatibility}%</Text>
            </View>
          </View>

          <View style={[styles.compactMeta, isCompactWeb && styles.compactWebMeta]}>
            <View style={styles.nameRow}>
              <Text style={[styles.nameText, isCompactWeb && styles.compactNameText]} numberOfLines={1}>
                {displayNameFor(topProfile)}{ageText}
              </Text>
              {topProfile.isVerified && <VerifiedBadge size={22} />}
            </View>
            <Text style={styles.metaLineText} numberOfLines={1}>{roleText}</Text>
            <View style={styles.metaLine}>
              <MapPin size={13} color="rgba(255,255,255,0.85)" />
              <Text style={styles.metaLineText} numberOfLines={1}>{locationText}</Text>
            </View>
            {!!compatibilityReason && (
              <Text style={styles.aiReasonText} numberOfLines={2}>{compatibilityReason}</Text>
            )}
            <TouchableOpacity
              activeOpacity={0.88}
              style={styles.moreInfoBtn}
              onPressIn={openInfoPanel}
              onPress={openInfoPanel}
            >
              <Text style={styles.moreInfoText}>About</Text>
              <ChevronDown size={16} color="#111" />
            </TouchableOpacity>
          </View>
        </View>
        {!infoExpanded && renderCardActions()}
      </Animated.View>
    );
  };

  /**
   * Scroll-mode sponsored stop: same creative as the swipe interstitial,
   * laid out to match the scroll card so the feed never jumps.
   *
   * This card carries a THEMED surface, not the always-black photo card. It
   * used to sit on `#0a0a0a` while the title was painted with the light-theme
   * ink colour — so in light mode the product name was dark-on-dark and the
   * card read as completely blank. Every colour here now follows the theme.
   */
  const renderScrollSponsor = () => {
    if (!discoverySponsor) return null;
    const sponsorName = discoverySponsor.title || 'Sponsored';
    // Same rule as the swipe interstitial: one line saying what it does.
    const sponsorLine = sponsorOneLiner(discoverySponsor);
    return (
      <Animated.View
        style={[
          styles.scrollFeedCard,
          liquidGlass(isDark, false),
          { transform: [{ translateY: scrollPosition }] },
        ]}
        {...scrollPanResponder.panHandlers}
      >
        <View style={styles.sponsorBody}>
          {renderSponsorBadge()}
          {renderSponsorLogo()}
          <Text style={[styles.sponsorTitle, { color: textColor(isDark) }]} numberOfLines={2}>
            {sponsorName}
          </Text>
          {!!sponsorLine && (
            <Text style={[styles.sponsorTagline, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>
              {sponsorLine}
            </Text>
          )}
          <TouchableOpacity
            activeOpacity={0.88}
            style={[
              styles.sponsorCta,
              // In the white brand flavour a light-theme CTA is white-on-white;
              // the hairline keeps the button visible without stealing the
              // yellow flavour's solid fill.
              { borderWidth: 1, borderColor: isDark ? 'transparent' : 'rgba(10,11,13,0.14)' },
            ]}
            onPress={() => resolveSponsor('open')}
          >
            <Globe size={15} color="#000" />
            <Text style={styles.sponsorCtaText}>{discoverySponsor.house ? 'Upgrade to PLUS' : 'Visit Website'}</Text>
          </TouchableOpacity>
          <Text style={[styles.sponsorHint, { color: textColor(isDark, 'muted') }]}>Swipe up to skip · tap to open</Text>
        </View>
        <View style={styles.scrollBottomActions}>
          <TouchableOpacity
            style={[
              styles.scrollBottomBtn,
              {
                backgroundColor: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(10,11,13,0.06)',
                borderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(10,11,13,0.12)',
              },
            ]}
            onPress={() => resolveSponsor('skip')}
          >
            <X size={20} color="#FF6B6B" />
            <Text style={[styles.scrollBottomLabel, { color: textColor(isDark) }]}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scrollBottomContact, { backgroundColor: isDark ? '#FFFFFF' : COLORS.inkButton }]}
            onPress={() => resolveSponsor('open')}
          >
            <MessageSquare size={16} color={isDark ? '#000' : '#FFFFFF'} />
            <Text style={[styles.scrollBottomLabel, { color: isDark ? '#000' : '#FFFFFF' }]}>Learn more</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scrollBottomBtn, { backgroundColor: '#FF3B5C' }]}
            onPress={() => resolveSponsor('open')}
          >
            <Heart size={20} color="#000" fill="#000" />
            <Text style={styles.scrollBottomLabel}>Open</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  };

  const renderScrollProfile = () => {
    // The sponsored slot wins the frame it owns, but never when the deck is
    // empty with nothing behind it.
    if (discoverySponsor) {
      return (
        <View style={styles.scrollFeed}>
          {renderScrollSponsor()}
          <View style={styles.scrollSwipeHint}>
            <Text style={[styles.scrollSwipeHintText, { color: textColor(isDark, 'muted') }]}>sponsored · {Math.max(0, feed.length - scrollIndex - 1)} profiles left</Text>
          </View>
        </View>
      );
    }
    if (feed.length === 0) return renderEmpty();
    // Never fall back to feed[0]: an out-of-range index must not silently
    // wrap the deck back around to the first profile.
    const profile = feed[Math.min(scrollIndex, feed.length - 1)];
    if (!profile) return renderEmpty();
    const photos = getSwipePhotos(profile);
    const ageText = Number(profile.age) > 0 ? `, ${profile.age}` : '';
    const locationText = [profile.city, profile.country].filter(Boolean).join(', ') || 'Remote';
    const roleText = [
      (profile as any).occupation || 'Builder',
      (profile as any).company ? `@ ${(profile as any).company}` : null,
    ].filter(Boolean).join(' ');
    const existingScore = scoreByIdRef.current.get(profile.uid);
    const matchRank = existingScore != null ? { score: existingScore, reason: '' } : (myProfile ? localCommonalityRank(myProfile, [profile], 1)[0] : null);
    const compatibility = Math.max(1, Math.min(100, Math.round(matchRank?.score || 50)));
    const skills = Array.isArray(profile.skills) ? profile.skills.slice(0, 6) : [];

    return (
      <View style={styles.scrollFeed}>
        <Animated.View
          style={[styles.scrollFeedCard, { transform: [{ translateY: scrollPosition }] }]}
          {...scrollPanResponder.panHandlers}
        >
          <AppImage uri={ikCard(photos[0]) || FALLBACK_PHOTO} style={styles.scrollCardImg} transitionMs={0} />
          <View style={styles.scrollCardOverlay} />
          <View style={styles.scrollCardBody}>
            <View style={styles.scrollCardMeta}>
              <View style={styles.scrollCardNameRow}>
                <Text style={styles.scrollCardName} numberOfLines={1}>{displayNameFor(profile)}{ageText}</Text>
                {profile.isVerified && <VerifiedBadge size={18} />}
                <View style={styles.scrollCompatPillSmall}>
                  <Target size={12} color="#000" />
                  <Text style={styles.scrollCompatTextSmall}>{compatibility}%</Text>
                </View>
              </View>
              <Text style={styles.scrollCardRole} numberOfLines={1}>{roleText}</Text>
              <Text style={styles.scrollCardLocation} numberOfLines={1}>{locationText}</Text>
              {skills.length > 0 && (
                <View style={styles.scrollSkillsRow}>
                  {skills.map((s, i) => (
                    <View key={i} style={styles.scrollSkillTag}>
                      <Text style={styles.scrollSkillText}>{s}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
            <View style={styles.scrollIndicatorRow}>
              <View style={[styles.scrollDot, { backgroundColor: COLORS.primary }]} />
              <Text style={styles.scrollDotLabel}>{scrollIndex + 1} / {feed.length}</Text>
            </View>
          </View>
          <View style={styles.scrollBottomActions}>
            <TouchableOpacity
              style={[styles.scrollBottomBtn, { backgroundColor: 'rgba(0,0,0,0.5)', borderColor: 'rgba(255,255,255,0.2)' }]}
              onPress={() => {
                if (resolveSponsorRef.current('skip')) return;
                animateSwipeOutRef.current('left');
              }}
            >
              <X size={20} color="#FF6B6B" />
              <Text style={styles.scrollBottomLabel}>Pass</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.scrollBottomContact]}
              disabled={contactBusy || isSyntheticProfile(profile)}
              onPress={() => {
                if (profile.uid !== topProfile?.uid) {
                  const reordered = [...profiles];
                  const idx = reordered.findIndex((p) => p.uid === profile.uid);
                  if (idx > 0) {
                    const [p] = reordered.splice(idx, 1);
                    reordered.unshift(p);
                    setProfiles(reordered);
                  }
                }
                setTimeout(() => handleContactRequest(), 150);
              }}
            >
              <MessageSquare size={16} color="#000" />
              <Text style={[styles.scrollBottomLabel, { color: '#000' }]}>
                {connectionRequest?.status === 'approved' ? 'Chat' : connectionRequest?.status === 'pending' ? 'Sent' : 'Request'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.scrollBottomBtn, { backgroundColor: '#FF3B5C' }]}
              onPress={() => {
                if (resolveSponsorRef.current('open')) return;
                animateSwipeOutRef.current('right');
              }}
            >
              <Heart size={20} color="#000" fill="#000" />
              <Text style={styles.scrollBottomLabel}>Like</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
        <View style={styles.scrollSwipeHint}>
          {/* Sits on the app background, so it follows the theme instead of
              the fixed white-on-photo palette (invisible in light mode). */}
          <Text style={[styles.scrollSwipeHintText, { color: textColor(isDark, 'muted') }]}>
            {!isProUser && swipesLeft === 0
              ? 'Daily limit reached · go PLUS for unlimited'
              : scrollIndex < feed.length - 1
                ? '↑ swipe up for next'
                : 'last profile'}
          </Text>
        </View>
      </View>
    );
  };

  if (!user?.uid) {
    return (
      <ScreenRoot style={[styles.container, isWeb && styles.webRoot, appBackground(isDark)]}>
        <View style={styles.authGate}>
          <Target size={44} color={COLORS.primaryStrong} />
          <Text style={[styles.authGateTitle, { color: textColor(isDark) }]}>JOIN LINKUP FIRST</Text>
          <Text style={[styles.authGateCopy, { color: textColor(isDark, 'secondary') }]}>Sign in to unlock smart matchmaking, builder search, and swipe discovery.</Text>
          <TouchableOpacity
            style={styles.authGateButton}
            onPress={() => navigation?.reset?.({ index: 0, routes: [{ name: 'Landing' }] }) || navigation?.navigate?.('Landing')}
            activeOpacity={0.85}
          >
            <Text style={styles.authGateButtonText}>GO TO LOGIN</Text>
          </TouchableOpacity>
        </View>
      </ScreenRoot>
    );
  }

  if ((!progressHydrated || loading) && profiles.length === 0) {
    return (
      <View style={[styles.container, appBackground(isDark), { justifyContent: 'center' }]}>
        <ActivityIndicator color={COLORS.primaryStrong} />
      </View>
    );
  }

  return (
    <View style={[styles.container, appBackground(isDark)]}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={[styles.webStage, isWideWeb && styles.webStageDesktop, isCompactWeb && styles.webStageMobile]}>
          <View style={[styles.topBar, isWeb && { width: deckWidth, alignSelf: 'center' }, isCompactWeb && styles.compactTopBar]}>
          {navigation?.canGoBack() ? (
            <TouchableOpacity
              onPress={() => navigation?.goBack?.()}
              style={[styles.topBtn, isCompactWeb && styles.compactTopBtn]}
            >
              <ChevronLeft size={22} color={textColor(isDark)} />
            </TouchableOpacity>
          ) : (
            <View style={[styles.topBtn, styles.topBtnGhost, isCompactWeb && styles.compactTopBtn]} />
          )}
          <View style={styles.modeSwitch}>
            <TouchableOpacity
              onPress={() => setMode('swipe')}
              style={[styles.modeChip, mode === 'swipe' && styles.modeChipOn]}
              activeOpacity={0.88}
            >
              <Text style={[styles.modeChipText, mode === 'swipe' && styles.modeChipTextOn]}>Swipe</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (!isProUser) {
                  openPaywall('Scroll Mode');
                  return;
                }
                setMode('scroll');
              }}
              style={[styles.modeChip, mode === 'scroll' && styles.modeChipOn]}
              activeOpacity={0.88}
            >
              {!isProUser && <Lock size={10} color={textColor(isDark, 'muted')} style={{ marginRight: 3 }} />}
              <Text style={[styles.modeChipText, mode === 'scroll' && styles.modeChipTextOn]}>Scroll</Text>
            </TouchableOpacity>
          </View>
          <ProCrownBadge />
          {/* Scroll mode spends the same budget as the swipe deck, so the
              counter belongs on screen in both modes. */}
          {!isProUser && swipesLeft != null ? (
            <View style={{
              paddingHorizontal: 9,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
              borderWidth: 1,
              borderColor: swipesLeft > 0 ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)') : '#EF4444',
            }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: swipesLeft > 0 ? COLORS.primaryStrong : '#EF4444' }}>
                {swipesLeft > 0 ? `${swipesLeft} left` : 'Limit hit'}
              </Text>
            </View>
          ) : null}
          <TouchableOpacity onPress={rewindLast} style={[styles.topBtn, isCompactWeb && styles.compactTopBtn]}>
            <RotateCcw size={18} color={textColor(isDark)} />
          </TouchableOpacity>
        </View>

        <View style={[styles.stackArea, webDeckStyle, isCompactWeb && styles.compactStackArea]}>
          {/* If a card ever throws, show a labelled retry inside the deck
              instead of an empty gap. A blank deck is indistinguishable from
              "the app died", and gives nobody anything to report. */}
          <ErrorBoundary screenName="Discovery deck" inline>
            {mode === 'swipe' ? (
              <>
                {renderPreviewCard()}
                {renderCard()}
              </>
            ) : (
              renderScrollProfile()
            )}
          </ErrorBoundary>
        </View>
      </View>
      {connectionNote.modal}
      <PaywallModal
        visible={!!paywallFeature}
        feature={paywallFeature || PRO_FEATURES.startupAnalyzer}
        description={`Warm intros, verified badges, startup analyzer, and Linky AI are LINKUP PLUS features.`}
        onClose={closePaywallToHome}
        onUnlocked={() => setPaywallFeature('')}
      />
      {infoExpanded && topProfile && (
        <ExpandedProfilePanel
          profile={topProfile}
          isDark={isDark}
          displayName={displayNameFor(topProfile)}
          ageText={topProfileAgeText}
          roleText={topProfileRole}
          locationText={topProfileLocation}
          bio={topProfileBio}
          compatibility={topCompatibility}
          compatibilityReason={topCompatibilityReason}
          skills={topProfile.skills || []}
          lookingFor={(topProfile as any).lookingFor || []}
          industries={(topProfile as any).industries || []}
          onClose={() => setInfoExpanded(false)}
          onContact={handleContactRequest}
          onLike={() => animateSwipeOut('right')}
          onPass={() => animateSwipeOut('left')}
          contactBusy={contactBusy}
          connectionRequest={connectionRequest}
        />
      )}
    </SafeAreaView>
    </View>
  );
}

const SparkleDot = () => <View style={styles.sparkleDot} />;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  fullBgImg: {
    width: '100%',
    height: '100%',
  },
  webRoot: {
    height: '100dvh' as any,
    minHeight: '100dvh' as any,
    overflow: 'hidden' as any,
  },
  webStage: {
    flex: 1,
  },
  webStageDesktop: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    paddingTop: 0,
    paddingBottom: 0,
  },
  webStageMobile: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    paddingTop: 0,
    paddingBottom: 0,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  topBtn: {
    width: 40,
    height: 40,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  topBtnGhost: {
    opacity: 0,
  },
  topTitle: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 4,
    color: '#FFF',
  },
  compactTopBar: {
    paddingHorizontal: 10,
    paddingTop: 0,
    paddingBottom: 0,
    minHeight: 38,
  },
  compactTopBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
  },
  compactTopTitle: {
    fontSize: 11,
    letterSpacing: 4,
  },
  stackArea: {
    flex: 1,
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
    justifyContent: 'center',
    position: 'relative',
  },
  compactStackArea: {
    marginTop: 0,
    marginBottom: 0,
  },
  card: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
    backgroundColor: '#0a0a0a',
  },
  webCard: {
    width: '100%',
    height: '100%',
    minHeight: 560,
    flexGrow: 0,
    flexShrink: 0,
  },
  compactWebCard: {
    width: '100%',
    height: '100%',
    minHeight: 390,
    flexGrow: 0,
    flexShrink: 0,
  },
  deckCardLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  previewCard: {
    borderColor: 'rgba(0,0,0,0.08)',
  },
  cardImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  faceFocusedImg: {
    ...(Platform.OS === 'web' ? ({ objectPosition: 'center 18%' } as any) : null),
  },
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  cardOverlayExpanded: {
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.26)',
  },
  previewInfo: {
    position: 'absolute',
    left: 22,
    right: 22,
    bottom: 22,
    borderRadius: 16,
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  previewEyebrow: {
    fontSize: 9,
    fontWeight: '900',
    color: COLORS.primaryStrong,
    letterSpacing: -0.2,
  },
  previewName: {
    marginTop: 5,
    fontSize: 22,
    fontWeight: '900',
    color: '#FFF',
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  previewNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  previewRole: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '800',
    color: '#E5E7EB',
  },
  cardInfo: {
    ...StyleSheet.absoluteFillObject,
    padding: 20,
    paddingTop: 78,
    paddingBottom: 100,
    justifyContent: 'space-between',
    zIndex: 20,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 999,
    padding: 3,
    gap: 2,
  },
  modeChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  modeChipOn: {
    backgroundColor: COLORS.primary,
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFF',
  },
  modeChipTextOn: {
    color: '#111',
  },
  compactCardInfo: {
    padding: 14,
    paddingTop: 70,
    paddingBottom: 116,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  topBadgeColumn: {
    gap: 8,
    alignItems: 'flex-start',
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 5,
    alignSelf: 'flex-start',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  aiBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.4,
  },
  photoThumbRow: {
    flexDirection: 'row',
    gap: 8,
    alignSelf: 'flex-end',
  },
  photoThumbWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  photoThumbWrapActive: {
    borderColor: COLORS.lightBorderActive,
  },
  photoThumbImg: {
    width: '100%',
    height: '100%',
  },
  compactMeta: {
    borderRadius: 16,
    padding: 18,
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    zIndex: 30,
    elevation: 30,
  },
  compactWebMeta: {
    borderRadius: 16,
    padding: 13,
  },
  moreInfoBtn: {
    marginTop: 14,
    minHeight: 44,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    zIndex: 40,
    elevation: 40,
  },
  compactMoreInfoBtn: {
    minHeight: 40,
    marginTop: 10,
  },
  moreInfoText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  expandedBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 100,
  },
  expandedSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: '15%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    zIndex: 101,
    paddingTop: 12,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -10 },
    elevation: 20,
  },
  expandedHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(150,150,150,0.3)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  expandedScrollArea: {
    flex: 1,
  },
  expandedScrollContent: {
    paddingBottom: 20,
  },
  expandedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  expandedName: {
    fontSize: 24,
    fontWeight: '900',
    },
  expandedRole: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  expandedLocation: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  expandedMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: 'rgba(17, 24, 39,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  expandedMatchText: {
    fontSize: 12,
    fontWeight: '800',
    flexShrink: 1,
  },
  expandedDivider: {
    height: 1,
    marginVertical: 16,
  },
  expandedSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  expandedBio: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 16,
  },
  expandedTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  expandedTag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  expandedTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  expandedLookingFor: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    marginBottom: 8,
  },
  expandedActionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingVertical: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  expandedPassBtn: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  expandedContactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    height: 52,
    borderRadius: 16,
  },
  expandedContactText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  expandedLikeBtn: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF3B5C',
    shadowColor: '#FF3B5C',
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  exitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.success,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 4,
  },
  exitText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
  },
  verifiedMiniBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  nameText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFF',
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  compactNameText: {
    fontSize: 22,
    lineHeight: 26,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  metaLineText: {
    flex: 1,
    fontSize: 12,
    color: '#F3F4F6',
    fontWeight: '800',
  },
  roleBadge: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  roleBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1,
  },
  aiReasonPill: {
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(17, 24, 39,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 39,0.26)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sparkleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  aiReasonText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 0.3,
  },
  bioCard: {
    marginTop: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  bioText: {
    fontSize: 15,
    marginTop: 9,
    fontWeight: '700',
    lineHeight: 23,
  },
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
    marginBottom: 10,
  },
  skillTag: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  skillTagText: {
    fontSize: 10,
    fontWeight: '900',
  },
  detailGrid: {
    gap: 10,
    marginTop: 8,
  },
  detailCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  detailLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  detailValue: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  scrollIndicator: {
    alignItems: 'center',
    paddingTop: 12,
  },
  scrollText: {
    fontSize: 8,
    fontWeight: '900',
    marginTop: 4,
  },
  badge: {
    position: 'absolute',
    top: 40,
    zIndex: 100,
    borderWidth: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  likeBadge: {
    right: 30,
    borderColor: '#4ADE80',
  },
  nopeBadge: {
    left: 30,
    borderColor: '#FF4444',
  },
  badgeText: {
    fontSize: 32,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  actionRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
    zIndex: 70,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 20,
    paddingBottom: 4,
  },
  actionBtnSmall: {
    alignItems: 'center',
    gap: 4,
  },
  actionBtnInnerSmall: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  actionLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0,
  },
  actionLabelLarge: {
    color: '#FFF',
  },
  contactActionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#FFF',
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  contactActionText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: '#000',
  },
  actionBtnLarge: {
    alignItems: 'center',
    gap: 4,
  },
  actionBtnInnerLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF3B5C',
    shadowColor: '#FF3B5C',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  contactApprovedBtn: {
    backgroundColor: '#16A34A',
    borderColor: '#16A34A',
  },
  contactPendingBtn: {
    backgroundColor: '#FBBF24',
    borderColor: '#FBBF24',
    opacity: 0.86,
  },
  contactRejectedBtn: {
    backgroundColor: '#EF4444',
    borderColor: '#EF4444',
    opacity: 0.7,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  authGate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    gap: 14,
  },
  authGateTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
  },
  authGateCopy: {
    maxWidth: 310,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 20,
    textAlign: 'center',
  },
  authGateButton: {
    marginTop: 8,
    height: 52,
    paddingHorizontal: 28,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authGateButtonText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.6,
    color: '#000',
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '900',
    },
  emptySubtext: {
    fontSize: 13,
    marginTop: 6,
    marginBottom: 16,
    textAlign: 'center',
  },
  resetBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 16,
  },
  resetText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1,
  },
  sponsorBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, gap: 14 },
  sponsorIconTile: {
    width: 84,
    height: 84,
    borderRadius: 26,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  sponsorPill: { borderRadius: 999, backgroundColor: '#111217', paddingHorizontal: 12, paddingVertical: 6 },
  sponsorPillText: { color: '#FFF', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  sponsorTitle: { fontSize: 28, lineHeight: 34, fontWeight: '900', textAlign: 'center', textTransform: 'uppercase' },
  sponsorTagline: { fontSize: 14, lineHeight: 21, fontWeight: '700', textAlign: 'center' },
  sponsorCta: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  sponsorCtaText: { color: '#000', fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  sponsorHint: { marginTop: 8, fontSize: 10, fontWeight: '800', color: '#8A8A93', textAlign: 'center' },
  sponsorLogo: { width: '100%', height: '100%', borderRadius: 26 },
  modeToggle: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    padding: 2,
  },
  modeToggleOption: {
    width: 28,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeToggleText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  modeToggleTextActive: {
    color: '#000',
    fontWeight: '900',
  },
  scrollFeed: {
    flex: 1,
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  scrollFeedCard: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#0a0a0a',
  },
  scrollCardImg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  scrollCardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  scrollCardBody: {
    flex: 1,
    justifyContent: 'flex-end',
    gap: 10,
    padding: 18,
  },
  scrollCompatPillSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  scrollCompatTextSmall: {
    fontSize: 12,
    fontWeight: '900',
    color: '#000',
    letterSpacing: -0.2,
  },
  scrollCardMeta: {
    gap: 4,
  },
  scrollCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scrollCardName: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
    color: '#FFF',
    flexShrink: 1,
  },
  scrollCardRole: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
  },
  scrollCardLocation: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },
  scrollSkillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 6,
  },
  scrollSkillTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  scrollSkillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFF',
  },
  scrollIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
  },
  scrollDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  scrollDotLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.5,
  },
  scrollBottomActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  scrollBottomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  scrollBottomContact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: '#FFF',
  },
  scrollBottomLabel: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 0.6,
  },
  scrollSwipeHint: {
    alignItems: 'center',
    paddingBottom: 4,
  },
  scrollSwipeHintText: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 0.5,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  resetGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.28)',
  },
  photoDots: {
    flexDirection: 'row',
    gap: 5,
    flex: 1,
    alignItems: 'center',
  },
  photoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  photoDotOn: {
    width: 16,
    backgroundColor: COLORS.primary,
  },
});
