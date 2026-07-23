import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  InteractionManager,
  Platform,
  useWindowDimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { collection, query, where, addDoc, limit, serverTimestamp, getDocs } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../lib/firebase';
import { displayNameFor, earnedScore, isDiscoverableProfile, isSyntheticProfile } from '../lib/discovery';
import { localCommonalityRank, rankCandidatesHybrid } from '../lib/matchmaking';
import { trackProfileView } from '../lib/analytics';
import { ensureDirectMatch } from '../lib/chat';
import { ConnectionRequest, requestConnection, subscribeToConnectionRequest } from '../lib/connectionRequests';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile } from '../types';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { roleInfoFor } from '../lib/roles';
import { X, Heart, Zap, RotateCcw, Target, ChevronDown, ChevronLeft, MapPin, Briefcase, MessageSquare } from 'lucide-react-native';
import VerifiedBadge from '../components/VerifiedBadge';
import PaywallModal from '../components/PaywallModal';
import { consumeDailyUsage, consumeWindowUsage, getDailyUsage, FREE_LIMITS, isAndroidProLocked, PRO_FEATURES, SWIPE_USAGE_WINDOW_HOURS } from '../lib/paywall';
import { MOBILE_LIST_IMAGE_LIMIT, compactProfileForList, safeProfileImageUri } from '../lib/profilePerformance';
import { subscribeToDiscoveryProfiles, loadMoreDiscoveryProfiles } from '../lib/discoveryProfiles';

const windowSize = Dimensions.get('window');
const { width } = windowSize;
const SWIPE_THRESHOLD = 0.22 * width;
const DISCOVERY_LIMIT = 12;
const FALLBACK_PHOTO = 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=800';
const MAX_SWIPE_DATA_URI_CHARS = 900_000;
const USE_NATIVE_ANIMATION_DRIVER = Platform.OS !== 'web';
const discoveryCacheKey = (uid: string) => `linkup:discovery:v3:${uid}`;
const swipeProgressKey = (uid: string) => `linkup:swipe-progress:v1:${uid}`;
const MAX_STORED_SWIPED_IDS = 500;

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
    return Array.isArray(parsed) ? parsed.filter((profile) => profile?.uid && profile.uid !== uid && isDiscoverableProfile(profile)).slice(0, DISCOVERY_LIMIT) : [];
  } catch {
    return [];
  }
};

const writeCachedDiscovery = async (uid: string, profiles: UserProfile[]) => {
  try {
    const compactProfiles = profiles.slice(0, DISCOVERY_LIMIT).map((profile) => ({
      uid: profile.uid,
      displayName: displayNameFor(profile),
      username: (profile as any).username || '',
      bio: profile.bio || '',
      profilePic: isSafeSwipePhoto(profile.profilePic) ? profile.profilePic : '',
      photos: Array.isArray((profile as any).photos) ? (profile as any).photos.filter(isSafeSwipePhoto).slice(0, 3) : [],
      occupation: (profile as any).occupation || '',
      company: (profile as any).company || '',
      city: profile.city || '',
      country: profile.country || '',
      age: Number(profile.age || 0),
      skills: Array.isArray(profile.skills) ? profile.skills.slice(0, 12) : [],
      industries: Array.isArray((profile as any).industries) ? (profile as any).industries.slice(0, 12) : [],
      lookingFor: Array.isArray((profile as any).lookingFor) ? (profile as any).lookingFor.slice(0, 12) : [],
      startupStage: (profile as any).startupStage || '',
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

const getSwipePhotos = (profile: UserProfile): string[] => {
  const rawPhotos: unknown[] = Array.isArray((profile as any).photos) && (profile as any).photos.length > 0
    ? (profile as any).photos
    : [profile.profilePic];
  const safePhotos = rawPhotos.filter(isSafeSwipePhoto);
  return safePhotos.length ? safePhotos : [FALLBACK_PHOTO];
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
}) {
  return (
    <ScrollView
      style={[styles.bottomMeta, liquidGlass(isDark, false), { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
      contentContainerStyle={styles.bottomMetaContent}
      showsVerticalScrollIndicator
      nestedScrollEnabled
      bounces
      scrollEventThrottle={16}
    >
      <View style={[styles.detailsHeader, liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder, backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard }]}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[styles.detailsTitle, { color: textColor(isDark) }]}>BUILDER DETAILS</Text>
          <Text style={[styles.detailsSubtitle, { color: textColor(isDark, 'secondary') }]}>Clear profile signals for this match</Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeInfoBtn}>
          <Text style={styles.closeInfoText}>HIDE</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.expandedProfileHeader, liquidGlass(isDark, false), { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
        <View style={styles.expandedNameRow}>
          <Text style={[styles.expandedName, { color: textColor(isDark) }]} numberOfLines={2}>
            {displayName}{ageText}
          </Text>
          {!!profile.isVerified && <VerifiedBadge size={24} />}
        </View>
        <Text style={[styles.expandedMetaText, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>{roleText}</Text>
        <Text style={[styles.expandedMetaText, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>{locationText}</Text>
      </View>

      <View style={[styles.bioCard, liquidGlass(isDark, false), { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
        <Text style={[styles.detailLabel, { color: textColor(isDark, 'secondary') }]}>BIO</Text>
        <Text style={[styles.bioText, { color: textColor(isDark) }]}>{bio || 'No bio yet.'}</Text>
      </View>

      <View style={styles.tagGrid}>
        {skills?.slice(0, 8).map((skill, idx) => (
          <View key={`${profile?.uid}-${skill}-${idx}`} style={[styles.skillTag, liquidGlass(isDark, false), { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(251,230,24,0.16)', borderColor: isDark ? COLORS.darkBorder : COLORS.primary }]}>
            <Text style={[styles.skillTagText, { color: textColor(isDark) }]}>{String(skill).toUpperCase()}</Text>
          </View>
        ))}
      </View>

      <View style={styles.detailGrid}>
        <View style={[styles.detailCard, liquidGlass(isDark, false), { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
          <Text style={[styles.detailLabel, { color: textColor(isDark, 'secondary') }]}>MATCH FIT</Text>
          <Text style={[styles.detailValue, { color: textColor(isDark) }]}>{compatibility}% - {compatibilityReason}</Text>
        </View>
        <View style={[styles.detailCard, liquidGlass(isDark, false), { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
          <Text style={[styles.detailLabel, { color: textColor(isDark, 'secondary') }]}>LOOKING FOR</Text>
          <Text style={[styles.detailValue, { color: textColor(isDark) }]}>{lookingFor.slice(0, 4).join(' - ') || 'Networking'}</Text>
        </View>
        <View style={[styles.detailCard, liquidGlass(isDark, false), { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
          <Text style={[styles.detailLabel, { color: textColor(isDark, 'secondary') }]}>STAGE</Text>
          <Text style={[styles.detailValue, { color: textColor(isDark) }]}>{(profile as any).startupStage || 'Exploring'}</Text>
        </View>
        <View style={[styles.detailCard, liquidGlass(isDark, false), { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
          <Text style={[styles.detailLabel, { color: textColor(isDark, 'secondary') }]}>INDUSTRY</Text>
          <Text style={[styles.detailValue, { color: textColor(isDark) }]}>{industries.slice(0, 4).join(' - ') || 'Open'}</Text>
        </View>
        <View style={[styles.detailCard, liquidGlass(isDark, false), { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
          <Text style={[styles.detailLabel, { color: textColor(isDark, 'secondary') }]}>AVAILABILITY</Text>
          <Text style={[styles.detailValue, { color: textColor(isDark) }]}>{(profile as any).availability || 'Open'}</Text>
        </View>
      </View>

      <View style={styles.scrollIndicator}>
        <ChevronDown size={14} color={COLORS.primary} />
        <Text style={[styles.scrollText, { color: textColor(isDark, 'secondary') }]}>SCROLL FOR DETAILS</Text>
      </View>
    </ScrollView>
  );
});

export default function SwipeScreen({ navigation }: any) {
  const { user, profile: myProfile } = useAuth();
  const { theme } = useTheme();
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
  const [paywallFeature, setPaywallFeature] = useState('');
  const [progressHydrated, setProgressHydrated] = useState(false);

  const swipedSessionIdsRef = useRef<Set<string>>(new Set());
  const hasUserSwipedRef = useRef(false);
  const allProfilesRef = useRef<UserProfile[]>([]);
  const scoreByIdRef = useRef<Map<string, number>>(new Map());
  const dailyLimitReachedRef = useRef(false);
  const [dailyRemaining, setDailyRemaining] = useState<number>(FREE_LIMITS.dailyRecommendations);
  const completeSwipeRef = useRef<(direction: 'left' | 'right', swipedItem?: UserProfile) => void>(() => {});
  const animateSwipeOutRef = useRef<(direction: 'left' | 'right') => void>(() => {});
  const resetSwipePositionRef = useRef<() => void>(() => {});
  const isAnimatingRef = useRef(false);
  const rankingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRankedProfileIdsRef = useRef('');
  const swipePosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
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
  const proLocked = isAndroidProLocked(myProfile);
  const openPaywall = (feature: string = PRO_FEATURES.swipeLimit) => setPaywallFeature(feature);
  const closePaywallToHome = () => {
    setPaywallFeature('');
    navigation?.navigate?.('Main', { screen: 'Swipe' });
  };

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
    readSwipeProgress(user.uid).then((storedIds) => {
      if (cancelled) return;
      swipedSessionIdsRef.current = storedIds;
      hasUserSwipedRef.current = storedIds.size > 0;
      setProgressHydrated(true);
    });

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

        const cap = dailyLimitReachedRef.current ? 0 : Math.min(FREE_LIMITS.dailyRecommendations, orderedUsers.length);
        const dailyCapped = orderedUsers.slice(0, cap);

        allProfilesRef.current = dailyCapped;
        writeCachedDiscovery(user.uid, orderedUsers.filter((profile) => !isSyntheticProfile(profile))).catch(() => {});
        const remainingUsers = unswipedProfiles(orderedUsers);
        if (hasUserSwipedRef.current) {
          setProfiles((current) => {
            const currentIds = new Set(current.map((profile) => profile.uid));
            const additions = remainingUsers.filter(
              (profile) => !swipedSessionIdsRef.current.has(profile.uid) && !currentIds.has(profile.uid)
            );
            return additions.length ? [...current, ...additions] : current;
          });
        } else {
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

    if (Platform.OS !== 'web') {
      setAiOrderingDone(true);
      return () => {
        cancelled = true;
      };
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
    if (!user?.uid) return;
    void getDailyUsage(user.uid, 'dailyRecommendations').then((used) => {
      const remaining = Math.max(0, FREE_LIMITS.dailyRecommendations - used);
      setDailyRemaining(remaining);
      if (remaining <= 0) dailyLimitReachedRef.current = true;
    });
  }, [user?.uid]);

  useEffect(() => {
    if (profiles.length > 3 || allLoadedRef.current || loadingMoreRef.current || !user?.uid || dailyLimitReachedRef.current) return;
    let cancelled = false;
    loadingMoreRef.current = true;
    void (async () => {
      try {
        const moreProfiles = await loadMoreDiscoveryProfiles();
        if (cancelled || moreProfiles.length === 0) {
          if (moreProfiles.length === 0) allLoadedRef.current = true;
          return;
        }
        const cap = dailyLimitReachedRef.current ? 0 : Math.max(0, FREE_LIMITS.dailyRecommendations - profiles.length);
        if (cap <= 0) {
          allLoadedRef.current = true;
          return;
        }
        const existingIds = new Set(allProfilesRef.current.map((p) => p.uid));
        const newProfiles = moreProfiles.filter((p) => !existingIds.has(p.uid) && !swipedSessionIdsRef.current.has(p.uid)).slice(0, cap);
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
    [topProfile, nextProfile].filter(Boolean).forEach((profile) => {
      getSwipePhotos(profile as UserProfile)
        .slice(0, 1)
        .filter((uri) => /^https?:\/\//.test(uri))
        .forEach((uri) => Image.prefetch(uri).catch(() => {}));
    });
  }, [topProfile?.uid, nextProfile?.uid]);

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

      if (!querySnapshot.empty) {
        const matchId = await ensureDirectMatch(user.uid, target.uid);
        await addDoc(collection(db, 'notifications'), {
          userId: target.uid,
          fromId: user.uid,
          type: 'match',
          content: 'You got a new match!',
          matchId,
          isRead: false,
          timestamp: serverTimestamp(),
        });
        await addDoc(collection(db, 'notifications'), {
          userId: user.uid,
          fromId: target.uid,
          type: 'match',
          content: 'You got a new match!',
          matchId,
          isRead: false,
          timestamp: serverTimestamp(),
        });
      } else {
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
      Alert.alert('Request pending', `${displayNameFor(target)} has not answered yet.`);
      return;
    }

    if (connectionRequest?.status === 'rejected') {
      Alert.alert('Request rejected', `${displayNameFor(target)} declined this request.`);
      return;
    }

    setContactBusy(true);
    try {
      const request = await requestConnection({
        senderId: user.uid,
        recipientId: target.uid,
        senderName: displayNameFor(myProfile || user),
        senderPic: safeProfileImageUri(myProfile?.profilePic || user.photoURL || '', MOBILE_LIST_IMAGE_LIMIT),
      });
      setConnectionRequest(request);
      Alert.alert('Request sent', `${displayNameFor(target)} can approve or reject it.`);
    } catch (error) {
      console.warn('Contact request failed:', error);
      Alert.alert('Request failed', 'Could not send this contact request. Check Firebase rules and try again.');
    } finally {
      setContactBusy(false);
    }
  };

  const completeSwipe = (direction: 'left' | 'right', swipedItem?: UserProfile) => {
    const item = swipedItem || profiles[0];
    if (!item) return;

    hasUserSwipedRef.current = true;
    swipedSessionIdsRef.current.add(item.uid);
    if (user?.uid) {
      void writeSwipeProgress(user.uid, Array.from(swipedSessionIdsRef.current));
    }

    if (direction === 'right' && user?.uid) {
      void (async () => {
        const usage = await consumeDailyUsage(user.uid, 'dailyRecommendations', FREE_LIMITS.dailyRecommendations);
        setDailyRemaining(Math.max(0, usage.remaining));
        if (!usage.allowed) {
          dailyLimitReachedRef.current = true;
          setProfiles([]);
        }
      })();
    }

    setActivePhotoIndex(0);
    setInfoExpanded(false);
    setProfiles((current) => {
      if (current[0]?.uid === item.uid) return current.slice(1);
      return current.filter((profile) => profile.uid !== item.uid);
    });

    if (direction === 'right') {
      void handleLike(item);
    }
  };

  const resetSwipePosition = () => {
    swipePosition.stopAnimation();
    Animated.spring(swipePosition, {
      toValue: { x: 0, y: 0 },
      tension: 85,
      friction: 9,
      useNativeDriver: USE_NATIVE_ANIMATION_DRIVER,
    }).start(() => {
      isAnimatingRef.current = false;
    });
  };

  const startSwipeAnimation = (direction: 'left' | 'right', swipedItem: UserProfile) => {
    isAnimatingRef.current = true;
    setInfoExpanded(false);
    const exitX = direction === 'right' ? deckExitDistanceRef.current : -deckExitDistanceRef.current;

    Animated.timing(swipePosition, {
      toValue: { x: exitX, y: direction === 'right' ? 34 : -34 },
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_ANIMATION_DRIVER,
    }).start(({ finished }) => {
      if (finished) {
        completeSwipe(direction, swipedItem);
        requestAnimationFrame(() => {
          swipePosition.setValue({ x: 0, y: 0 });
          isAnimatingRef.current = false;
        });
        return;
      }
      swipePosition.setValue({ x: 0, y: 0 });
      isAnimatingRef.current = false;
    });
  };

  const animateSwipeOut = (direction: 'left' | 'right') => {
    const swipedItem = profiles[0];
    if (isAnimatingRef.current || !swipedItem) return;

    if (proLocked) {
      consumeWindowUsage(user?.uid || 'anonymous', 'builder-swipes', FREE_LIMITS.swipesPer12Hours, SWIPE_USAGE_WINDOW_HOURS)
        .then((usage) => {
          if (!usage.allowed) {
            openPaywall(PRO_FEATURES.swipeLimit);
            return;
          }
          startSwipeAnimation(direction, swipedItem);
        })
        .catch(() => startSwipeAnimation(direction, swipedItem));
      return;
    }

    startSwipeAnimation(direction, swipedItem);
  };

  completeSwipeRef.current = completeSwipe;
  animateSwipeOutRef.current = animateSwipeOut;
  resetSwipePositionRef.current = resetSwipePosition;

  const resetDeck = () => {
    if (proLocked) {
      openPaywall(PRO_FEATURES.swipeLimit);
      return;
    }
    swipedSessionIdsRef.current.clear();
    hasUserSwipedRef.current = false;
    if (user?.uid) {
      void clearSwipeProgress(user.uid);
    }
    setActivePhotoIndex(0);
    setInfoExpanded(false);
    setAiOrderingDone(false);
    swipePosition.setValue({ x: 0, y: 0 });
    isAnimatingRef.current = false;
    setProfiles(allProfilesRef.current);
  };

  const openInfoPanel = React.useCallback(() => {
    if (isAnimatingRef.current || !topProfile) return;
    swipePosition.stopAnimation();
    swipePosition.setValue({ x: 0, y: 0 });
    setInfoExpanded(true);
  }, [topProfile]);

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Target size={48} color={dailyLimitReachedRef.current ? textColor(isDark, 'muted') : COLORS.primary} />
      <Text style={[styles.emptyText, { color: textColor(isDark) }]}>
        {dailyLimitReachedRef.current ? 'DAILY MATCHES EXHAUSTED' : 'NO MORE PROFILES'}
      </Text>
      <Text style={[styles.emptySubtext, { color: textColor(isDark, 'muted') }]}>
        {dailyLimitReachedRef.current ? `Come back in ${SWIPE_USAGE_WINDOW_HOURS}h for ${FREE_LIMITS.swipesPer12Hours} fresh swipes.` : 'Check back later for new builders.'}
      </Text>
      <TouchableOpacity style={styles.resetBtn} onPress={resetDeck}>
        <Text style={styles.resetText}>
          {dailyLimitReachedRef.current ? 'TOMORROW' : 'REFRESH DISCOVERY'}
        </Text>
      </TouchableOpacity>
    </View>
  );

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
        key={`preview-${nextProfile.uid}`}
        pointerEvents="none"
        style={[
          styles.card,
          styles.deckCardLayer,
          styles.previewCard,
          liquidGlass(isDark, false),
          isWeb && (isCompactWeb ? styles.compactWebCard : styles.webCard),
          {
            opacity: nextCardOpacity,
            transform: [{ translateY: nextCardTranslateY }, { scale: nextCardScale }],
          },
        ]}
      >
        <Image source={{ uri: photos[0] || FALLBACK_PHOTO }} style={[styles.cardImg, styles.faceFocusedImg]} resizeMode="cover" fadeDuration={0} />
        <View style={styles.previewOverlay} pointerEvents="none" />
        <View style={styles.previewInfo}>
          <Text style={styles.previewEyebrow}>NEXT BUILDER</Text>
          <View style={styles.previewNameRow}>
            <Text style={styles.previewName} numberOfLines={1}>
              {displayNameFor(nextProfile)}{ageText}
            </Text>
            {!!nextProfile.isVerified && <VerifiedBadge size={24} />}
          </View>
          <Text style={styles.previewRole} numberOfLines={1}>{roleText}</Text>
        </View>
      </Animated.View>
    );
  };

  const renderCard = () => {
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
    const renderCardActions = () => (
      <View style={[styles.actionRow, isWideWeb && styles.webActionRow, isCompactWeb && styles.compactActionRow]}>
        <TouchableOpacity style={[styles.actionBtnSmall, isCompactWeb && styles.compactActionBtnSmall]} onPress={() => animateSwipeOut('left')}>
          <X size={24} color="#EF4444" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.contactActionBtn,
            isCompactWeb && styles.compactContactActionBtn,
            connectionRequest?.status === 'approved' && styles.contactApprovedBtn,
            connectionRequest?.status === 'pending' && styles.contactPendingBtn,
            connectionRequest?.status === 'rejected' && styles.contactRejectedBtn,
          ]}
          disabled={contactBusy || !topProfile || isSyntheticProfile(topProfile)}
          onPress={handleContactRequest}
        >
          <MessageSquare size={18} color="#000" />
          <Text style={styles.contactActionText}>
            {contactBusy
              ? '...'
              : connectionRequest?.status === 'approved'
                ? 'CHAT'
                : connectionRequest?.status === 'pending'
                  ? 'SENT'
                  : connectionRequest?.status === 'rejected'
                    ? 'NO'
                    : 'CONTACT'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtnLarge, isCompactWeb && styles.compactActionBtnLarge]} onPress={() => animateSwipeOut('right')}>
          <Heart size={32} color="#000" fill="#000" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtnSmall, isCompactWeb && styles.compactActionBtnSmall]} onPress={resetDeck}>
          <RotateCcw size={24} color="#888" />
        </TouchableOpacity>
      </View>
    );

    return (
      <Animated.View
        key={`top-${topProfile.uid}`}
        style={[
          styles.card,
          styles.deckCardLayer,
          liquidGlass(isDark, false),
          isWeb && (isCompactWeb ? styles.compactWebCard : styles.webCard),
          {
            opacity: topCardOpacity,
            transform: [
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
          <Text style={[styles.badgeText, { color: '#4ADE80' }]}>LIKE</Text>
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

        <Image source={{ uri: photos[safeIndex] || FALLBACK_PHOTO }} style={[styles.cardImg, styles.faceFocusedImg]} resizeMode="cover" fadeDuration={0} />
        <View style={[styles.cardOverlay, infoExpanded && styles.cardOverlayExpanded]} pointerEvents="none" />

        <View style={[styles.cardInfo, isCompactWeb && styles.compactCardInfo]}>
          <View style={styles.cardTopRow}>
            <View style={styles.topBadgeColumn}>
              <View style={styles.aiBadge}>
                <Zap size={11} color="#000" fill="#000" />
                <Text style={styles.aiBadgeText}>{compatibility}%</Text>
              </View>
            </View>
            {photos.length > 1 && (
              <View style={styles.photoThumbRow}>
                {photos.slice(0, 3).map((uri, idx) => (
                  <TouchableOpacity
                    key={`${topProfile.uid}-${idx}`}
                    activeOpacity={0.9}
                    onPress={() => setActivePhotoIndex(idx)}
                    style={[styles.photoThumbWrap, idx === safeIndex && styles.photoThumbWrapActive]}
                  >
                    <Image source={{ uri }} style={styles.photoThumbImg} fadeDuration={0} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <View style={[styles.compactMeta, isCompactWeb && styles.compactWebMeta]}>
            <View style={styles.nameRow}>
              <Text style={[styles.nameText, isCompactWeb && styles.compactNameText]}>{displayNameFor(topProfile)}{ageText}</Text>
              {topProfile.isVerified && <VerifiedBadge size={24} />}
              {topProfile.hasExit && (
                <View style={styles.exitBadge}>
                  <Target size={12} color="#000" />
                  <Text style={styles.exitText}>EXIT</Text>
                </View>
              )}
            </View>
            <View style={styles.metaLine}>
              <Briefcase size={13} color={COLORS.primary} />
              <Text style={styles.metaLineText} numberOfLines={1}>{roleText}</Text>
            </View>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{roleInfoFor((topProfile as any).occupation).badge}</Text>
            </View>
            <View style={styles.metaLine}>
              <MapPin size={13} color={COLORS.primary} />
              <Text style={styles.metaLineText} numberOfLines={1}>{locationText}</Text>
            </View>
            <View style={styles.aiReasonPill}>
              <SparkleDot />
              <Text style={styles.aiReasonText} numberOfLines={1}>{compatibilityReason}</Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.9}
              style={[styles.moreInfoBtn, isCompactWeb && styles.compactMoreInfoBtn, liquidGlass(isDark, false), { backgroundColor: COLORS.primary, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
              onPressIn={openInfoPanel}
              onPress={openInfoPanel}
            >
              <Text style={styles.moreInfoText}>MORE INFO ABOUT THIS PERSON</Text>
              <ChevronDown size={15} color="#000" />
            </TouchableOpacity>
          </View>

          {infoExpanded && (
            <ExpandedProfilePanel
              profile={topProfile}
              isDark={isDark}
              displayName={displayNameFor(topProfile)}
              ageText={ageText}
              roleText={roleText}
              locationText={locationText}
              bio={bio}
              compatibility={compatibility}
              compatibilityReason={compatibilityReason}
              skills={topProfile.skills || []}
              lookingFor={(topProfile as any).lookingFor || []}
              industries={(topProfile as any).industries || []}
              onClose={() => setInfoExpanded(false)}
            />
          )}
        </View>
        {!infoExpanded && renderCardActions()}
      </Animated.View>
    );
  };

  if (!user?.uid) {
    return (
      <ScreenRoot style={[styles.container, isWeb && styles.webRoot, appBackground(isDark)]}>
        <View style={styles.authGate}>
          <Zap size={44} color={COLORS.primary} fill={COLORS.primary} />
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
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScreenRoot style={[styles.container, isWeb && styles.webRoot, appBackground(isDark)]}>
      <View style={styles.scene} pointerEvents="none">
        <View style={[styles.scenePane, styles.scenePaneA, { backgroundColor: isDark ? 'rgba(0,194,255,0.1)' : 'rgba(0,194,255,0.14)' }]} />
        <View style={[styles.scenePane, styles.scenePaneB, { backgroundColor: isDark ? 'rgba(251,230,24,0.08)' : 'rgba(251,230,24,0.16)' }]} />
      </View>
      <View style={[styles.webStage, isWideWeb && styles.webStageDesktop, isCompactWeb && styles.webStageMobile]}>
        <View style={[styles.topBar, isWeb && { width: deckWidth, alignSelf: 'center' }, isCompactWeb && styles.compactTopBar]}>
          {navigation?.canGoBack() ? (
            <TouchableOpacity 
              onPress={() => navigation?.goBack?.()} 
              style={[
                styles.topBtn, 
                isCompactWeb && styles.compactTopBtn,
                { 
                  ...liquidGlass(isDark, false)
                }
              ]}
            >
              <ChevronLeft size={22} color={textColor(isDark)} />
            </TouchableOpacity>
          ) : (
            <View style={[styles.topBtn, styles.topBtnGhost, isCompactWeb && styles.compactTopBtn]} />
          )}
          <Text style={[
            styles.topTitle, 
            isCompactWeb && styles.compactTopTitle,
            {
              color: textColor(isDark),
              ...liquidGlass(isDark, false)
            }
          ]}>SWIPE MATCH</Text>
          <View style={[styles.topBtn, styles.topBtnGhost, isCompactWeb && styles.compactTopBtn]} />
        </View>

        <View style={[styles.stackArea, webDeckStyle, isCompactWeb && styles.compactStackArea]}>
          {renderPreviewCard()}
          {renderCard()}
        </View>
      </View>
      <PaywallModal
        visible={!!paywallFeature}
        feature={paywallFeature || PRO_FEATURES.swipeLimit}
        description={`Free Android accounts get ${FREE_LIMITS.swipesPer12Hours} builder swipes every ${SWIPE_USAGE_WINDOW_HOURS} hours. LINKUP PLUS unlocks unlimited discovery.`}
        onClose={closePaywallToHome}
        onUnlocked={() => setPaywallFeature('')}
        restoreDisabled
      />
    </ScreenRoot>
  );
}

const SparkleDot = () => <View style={styles.sparkleDot} />;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scene: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  scenePane: {
    position: 'absolute',
    width: 280,
    height: 130,
    borderRadius: 34,
  },
  scenePaneA: {
    top: 90,
    right: -120,
    transform: [{ rotate: '-16deg' }],
  },
  scenePaneB: {
    top: 330,
    left: -120,
    transform: [{ rotate: '16deg' }],
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
    top: 14,
    left: 0,
    right: 0,
    zIndex: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
  },
  topBtn: {
    width: 44,
    height: 44,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBtnGhost: {
    opacity: 0,
  },
  topTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingVertical: 8,
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
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
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
    borderRadius: 22,
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  previewEyebrow: {
    fontSize: 9,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 1.4,
  },
  previewName: {
    marginTop: 5,
    fontSize: 22,
    fontWeight: '900',
    color: '#FFF',
    fontStyle: 'italic',
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
    padding: 24,
    paddingTop: 84,
    paddingBottom: 128,
    justifyContent: 'space-between',
    zIndex: 20,
    elevation: 20,
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
    borderColor: COLORS.primary,
  },
  photoThumbImg: {
    width: '100%',
    height: '100%',
  },
  compactMeta: {
    borderRadius: 26,
    padding: 18,
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    zIndex: 30,
    elevation: 30,
  },
  compactWebMeta: {
    borderRadius: 22,
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
    fontSize: 11,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.8,
  },
  bottomMeta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '78%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    zIndex: 90,
    borderWidth: 2,
    borderColor: COLORS.primary,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -10 },
    elevation: 16,
  },
  compactBottomMeta: {
    maxHeight: '74%',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  bottomMetaContent: {
    padding: 22,
    paddingBottom: 42,
  },
  compactBottomMetaContent: {
    padding: 16,
    paddingBottom: 30,
  },
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    borderRadius: 20,
    padding: 14,
  },
  detailsTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  detailsSubtitle: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
  },
  closeInfoBtn: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: COLORS.primary,
  },
  closeInfoText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  expandedProfileHeader: {
    marginTop: 16,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
  },
  expandedName: {
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '900',
    fontStyle: 'italic',
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  expandedNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  expandedMetaText: {
    marginTop: 7,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
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
    fontStyle: 'italic',
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
    backgroundColor: 'rgba(251,230,24,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(251,230,24,0.26)',
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
    borderRadius: 20,
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
    borderRadius: 18,
    borderWidth: 1,
  },
  detailLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
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
    alignItems: 'center',
    justifyContent: 'center',
    gap: 25,
    paddingBottom: 0,
  },
  webActionRow: {
    paddingBottom: 0,
    bottom: 24,
  },
  compactActionRow: {
    gap: 14,
    paddingBottom: 0,
    bottom: 18,
  },
  actionBtnSmall: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  compactActionBtnSmall: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  contactActionBtn: {
    width: 76,
    height: 60,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.primaryStrong,
    gap: 3,
  },
  compactContactActionBtn: {
    width: 68,
    height: 54,
    borderRadius: 20,
  },
  contactApprovedBtn: {
    backgroundColor: COLORS.success,
    borderColor: '#16A34A',
  },
  contactPendingBtn: {
    backgroundColor: COLORS.warning,
    borderColor: '#EAB308',
    opacity: 0.86,
  },
  contactRejectedBtn: {
    backgroundColor: COLORS.danger,
    borderColor: '#EF4444',
    opacity: 0.7,
  },
  contactActionText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: '#000',
  },
  actionBtnLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 8,
  },
  compactActionBtnLarge: {
    width: 70,
    height: 70,
    borderRadius: 35,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
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
    fontStyle: 'italic',
    letterSpacing: 1.2,
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
    borderRadius: 18,
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
    fontStyle: 'italic',
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
    borderRadius: 20,
  },
  resetText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1,
  },
});
