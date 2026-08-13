import React, { useMemo, useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Image, 
  TouchableOpacity, 
  ScrollView, 
  RefreshControl,
  Switch, 
  TextInput, 
  ActivityIndicator, 
  Dimensions,
  Alert,
  Linking,
  Platform,
  Share,
  Modal,
  Pressable,
  InteractionManager
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import * as Icons from 'lucide-react-native';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { deleteDoc, deleteField, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { trackProfileClick, trackProfileSave, trackProfileView } from '../lib/analytics';
import { resolveConnectionGate, startTalkOrRequest } from '../lib/connectionRequests';
import { useConnectionNote } from '../components/ConnectionNoteModal';
import { buildConversationProfileSnapshot } from '../lib/conversationProfiles';
import { syncOwnPublicProfileIndex } from '../lib/discoveryProfiles';
import { blurActiveElementOnWeb } from '../lib/webFocus';
import { describeAIError, getLastAIDiagnostic } from '../lib/aiDiagnostics';
import { normalizeIdeaDraft } from '../lib/ideas';
import { displayNameFor } from '../lib/discovery';
import { profileLinkFor } from '../lib/profileLinks';
import { LINKUP_ROLE_LABELS, roleInfoFor } from '../lib/roles';
import VerifiedBadge from '../components/VerifiedBadge';
import type { StartupResume, UserProfile } from '../types';
import PaywallModal from '../components/PaywallModal';
import {
  enableAppNotificationsAsync,
  getAppNotificationStatusAsync,
  openAppNotificationSettingsAsync,
} from '../lib/notifications';
import {
  buildLocalFreeEntitlement,
  clearLocalProEntitlement,
  consumeDailyUsage,
  FREE_LIMITS,
  GOOGLE_PLAY_SUBSCRIPTION_URL,
  hasLinkupPro,
  isAndroidProLocked,
  PRO_FEATURES,
} from '../lib/paywall';
import { MAX_FIRESTORE_IMAGE_CHARS } from '../lib/imageUploadLimits';
import { MOBILE_LIST_IMAGE_LIMIT, compactProfileForList, safeProfileImageUri } from '../lib/profilePerformance';

const { width } = Dimensions.get('window');
const isPermissionDenied = (error: any) => String(error?.code || '').includes('permission-denied');


// ULTRA-SAFE ICON RENDERER
const SafeIcon = ({ name, size = 20, color = COLORS.primary, fill = "transparent", style }: any) => {
  const IconComponent = (Icons as any)[name];
  if (!IconComponent) {
    return <View style={[{ width: size, height: size, backgroundColor: color + '20', borderRadius: 4 }, style]} />;
  }
  return <IconComponent size={size} color={color} fill={fill} style={style} />;
};

const Badge = ({ name, iconName, color = COLORS.primary }: { name: string, iconName: string, color?: string }) => {
  return (
    <View style={[styles.badgeItem, { backgroundColor: `${color}10`, borderColor: `${color}20` }]}>
      <SafeIcon name={iconName} size={12} color={color} />
      <Text style={[styles.badgeText, { color }]}>{name}</Text>
    </View>
  );
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const earnedReputation = (profile: any) => {
  const skills = Array.isArray(profile?.skills) ? profile.skills : [];
  const industries = Array.isArray(profile?.industries) ? profile.industries : [];
  const lookingFor = Array.isArray(profile?.lookingFor) ? profile.lookingFor : [];
  const photos = Array.isArray(profile?.photos) ? profile.photos : [];
  const projects = Array.isArray(profile?.projects) ? profile.projects : [];
  const resume = profile?.resume || {};
  const shippedProducts = Array.isArray(resume.shippedProducts) ? resume.shippedProducts.length : 0;
  const startupAttempts = Array.isArray(resume.startupAttempts) ? resume.startupAttempts.length : 0;
  const projectEvidence = projects.reduce((score: number, project: any) => {
    const status = String(project?.status || '').toLowerCase();
    return score + (project?.title ? 4 : 0) + (project?.description ? 5 : 0) + (status === 'live' ? 8 : status === 'mvp' ? 5 : 2);
  }, 0);
  const profileCompleteness = clampScore(
    (profile?.displayName ? 8 : 0) +
      (profile?.bio ? 10 : 0) +
      (profile?.profilePic ? 10 : 0) +
      (profile?.city && profile?.country ? 7 : 0) +
      Math.min(18, skills.length * 3) +
      Math.min(12, industries.length * 3) +
      Math.min(12, lookingFor.length * 4) +
      Math.min(8, photos.length * 2)
  );
  const responseRate = clampScore(Number(profile?.reputationMetrics?.responseRate ?? 0));
  const collaborationSignals = clampScore(
    Math.min(26, lookingFor.length * 6) +
      Math.min(22, skills.length * 3) +
      Math.min(12, industries.length * 3) +
      (profile?.availability ? 10 : 0) +
      (profile?.networkingIntent ? 10 : 0)
  );
  const consistencySignals = clampScore(
    Math.min(28, Number(profile?.streakCount || 0) * 5) +
      Math.min(24, Number(resume.buildStreaks || 0) * 6) +
      (profile?.lastActiveAt ? 10 : 0) +
      (profile?.onboarded ? 12 : 0)
  );
  const completionSignals = clampScore(
    Math.min(34, projectEvidence) +
      Math.min(18, shippedProducts * 9) +
      Math.min(14, startupAttempts * 7) +
      (profile?.hasExit ? 18 : 0) +
      (profile?.isVerified ? 10 : 0)
  );
  const reliability = clampScore(profileCompleteness * 0.55 + consistencySignals * 0.25 + responseRate * 0.2);
  const founderScore = clampScore(
    profileCompleteness * 0.35 +
      collaborationSignals * 0.2 +
      consistencySignals * 0.2 +
      completionSignals * 0.2 +
      (profile?.isVerified ? 5 : 0)
  );
  return {
    reliability,
    responseRate: clampScore(responseRate),
    collaboration: collaborationSignals,
    consistency: consistencySignals,
    completion: completionSignals,
    founderScore,
  };
};

const cleanUsername = (value: string) => value.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
const toTextValue = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const limitText = (value: unknown, maxSize: number) => String(value || '').trim().slice(0, maxSize);
const parseProfileList = (value: unknown) => {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/[,\n;]+/).map((entry) => entry.trim());

  return Array.from(
    new Map(
      items
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .map((entry) => [entry.toLowerCase(), entry])
    ).values()
  );
};
const cleanProfileList = (value: unknown, maxItems: number, maxEntrySize = 80) =>
  parseProfileList(value).map((entry) => entry.slice(0, maxEntrySize)).slice(0, maxItems);
const safeDisplayNameForSave = (value: unknown, fallback: unknown) => {
  const primary = String(value || '').trim();
  if (primary && primary !== 'New Builder') return primary.slice(0, 100);
  const backup = String(fallback || '').trim();
  if (backup && backup !== 'New Builder') return backup.slice(0, 100);
  return 'LINKUP Builder';
};
const webConfirm = (message: string) => {
  const confirmFn = (globalThis as any)?.confirm;
  if (Platform.OS !== 'web' || typeof confirmFn !== 'function') return null;
  return !!confirmFn(message);
};
const normalizeProjectStatus = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.includes('live') || normalized.includes('scal')) return 'live';
  if (normalized.includes('idea')) return 'idea';
  return 'mvp';
};
const normalizeProjectDraft = (project: any, uid: string, index: number) => ({
  id: String(project?.id || `project_${uid}_${index}_${Date.now()}`),
  title: String(project?.title || '').trim(),
  description: String(project?.description || '').trim(),
  status: normalizeProjectStatus(project?.status),
  ...(project?.link ? { link: String(project.link).trim() } : {}),
});
const resumeTextValue = (resume: any, field: keyof StartupResume) => {
  const value = resume?.[field];
  if (Array.isArray(value)) return value.join(', ');
  return field === 'buildStreaks' ? String(value || '') : '';
};
const normalizeResumeDraft = (resume: any) => ({
  shippedProducts: cleanProfileList(resume?.shippedProducts, 20, 100),
  sideProjects: cleanProfileList(resume?.sideProjects, 20, 100),
  startupAttempts: cleanProfileList(resume?.startupAttempts, 20, 100),
  hackathonWins: cleanProfileList(resume?.hackathonWins, 20, 100),
  buildStreaks: Math.max(0, Math.min(3650, Number.parseInt(String(resume?.buildStreaks || '0'), 10) || 0)),
});
const reputationProfileFromDraft = (baseProfile: any, draft: any, uid: string) => {
  const nextAge = Number.parseInt(String(draft?.age || baseProfile?.age || ''), 10);
  const projects = Array.isArray(draft?.projects)
    ? draft.projects.map((project: any, index: number) => normalizeProjectDraft(project, uid, index)).filter((project: any) => project.title || project.description)
    : Array.isArray(baseProfile?.projects) ? baseProfile.projects : [];

  return {
    ...baseProfile,
    ...draft,
    uid,
    displayName: safeDisplayNameForSave(draft?.displayName, baseProfile?.displayName),
    age: Number.isFinite(nextAge) ? Math.max(0, Math.min(120, nextAge)) : 0,
    skills: cleanProfileList(draft?.skills ?? baseProfile?.skills, 50),
    interests: cleanProfileList(draft?.interests ?? baseProfile?.interests, 50),
    industries: cleanProfileList(draft?.industries ?? baseProfile?.industries, 20),
    lookingFor: cleanProfileList(draft?.lookingFor ?? baseProfile?.lookingFor, 20),
    languages: cleanProfileList(draft?.languages ?? baseProfile?.languages, 20),
    resume: normalizeResumeDraft(draft?.resume || baseProfile?.resume || {}),
    photos: Array.isArray(draft?.photos) ? draft.photos.filter(Boolean).slice(0, 3) : Array.isArray(baseProfile?.photos) ? baseProfile.photos : [],
    projects,
  };
};
const reputationPatchForProfile = (profile: any) => {
  const reputation = earnedReputation(profile);
  return {
    founderScore: reputation.founderScore,
    reputationMetrics: {
      ...((profile?.reputationMetrics && typeof profile.reputationMetrics === 'object') ? profile.reputationMetrics : {}),
      reliability: reputation.reliability,
      responseRate: reputation.responseRate,
      collaboration: reputation.collaboration,
      consistency: reputation.consistency,
      completion: reputation.completion,
    },
  };
};
const STARTUP_STATUS_OPTIONS = [
  'Idea Stage',
  'Building MVP',
  'Early Users',
  'Revenue',
  'Scaling',
  'Fundraising',
  'Hiring',
  'Open to Collaboration',
];
const ROLE_OPTIONS = LINKUP_ROLE_LABELS;
const EXPERIENCE_OPTIONS = ['Beginner', 'Intermediate', 'Experienced', 'Senior', 'Exited Founder'];
const FUNDING_OPTIONS = ['Pre-revenue', 'Bootstrapped', 'Angel-backed', 'Raised Funding', 'Revenue Generating'];
const AVAILABILITY_OPTIONS = ['Available Now', 'Busy but Open', 'Hiring', 'Open to Networking', 'Not Available'];
const WORK_STYLE_OPTIONS = ['Fast-paced', 'Structured', 'Experimental', 'Analytical', 'Creative'];
const COMMITMENT_OPTIONS = ['Weekends Only', 'Part-time', 'Full-time', 'Actively Building'];
const INTENT_OPTIONS = ['Casual Networking', 'Serious Builder', 'Actively Hiring', 'Looking for Cofounder'];
const TEAM_SIZE_OPTIONS = ['Solo Founder', 'Small Team', 'Growing Team', 'Large Startup'];
const EDUCATION_OPTIONS = ['Student', 'Self-Taught', 'Bootcamp', 'University Graduate', 'PhD'];
const AMBITION_OPTIONS = ['Impact', 'High Growth', 'Revenue', 'Lifestyle', 'Learning'];
const INDUSTRY_SUGGESTIONS = ['Automation', 'SaaS', 'Fintech', 'Healthtech', 'Gaming', 'E-commerce', 'Crypto', 'Education', 'Media'];
const LOOKING_FOR_SUGGESTIONS = ['Cofounder', 'Technical Cofounder', 'Startup Team', 'Hiring', 'Investment', 'Mentorship', 'Networking'];
const SKILL_SUGGESTIONS = ['React', 'Node.js', 'Python', 'Machine Learning', 'UI/UX', 'Sales', 'Marketing', 'Figma', 'Flutter', 'Finance', 'Product', 'Automation', 'Backend', 'Frontend', 'Branding'];
type PreferenceField = 'isStealthMode' | 'isVisible' | 'turboConnect' | 'hideOnlineStatus';
type PreferenceState = Record<PreferenceField, boolean>;

const preferenceSnapshotFor = (profileData: any): PreferenceState => {
  const settings = profileData?.settings && typeof profileData.settings === 'object' ? profileData.settings : {};
  return {
    isVisible:
      typeof settings.publicDiscovery === 'boolean'
        ? settings.publicDiscovery
        : profileData?.isVisible !== false,
    isStealthMode:
      typeof settings.stealthMode === 'boolean'
        ? settings.stealthMode
        : !!profileData?.isStealthMode,
    turboConnect:
      typeof settings.turboConnect === 'boolean'
        ? settings.turboConnect
        : !!profileData?.turboConnect,
    hideOnlineStatus:
      typeof settings.hideOnlineStatus === 'boolean'
        ? settings.hideOnlineStatus
        : !!profileData?.hideOnlineStatus,
  };
};

const PreferenceSwitch = ({
  value,
  onValueChange,
  disabled,
  isDark,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  isDark: boolean;
}) => (
  <View style={[styles.switchWrap, disabled ? { opacity: 0.55 } : null]}>
    <Text style={[styles.switchState, { color: value ? COLORS.primary : '#777' }]}>{value ? 'ON' : 'OFF'}</Text>
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={!!disabled}
      trackColor={{ false: isDark ? '#2A2A30' : '#D1D5DB', true: COLORS.primary }}
      ios_backgroundColor={isDark ? '#2A2A30' : '#D1D5DB'}
      thumbColor="#FFF"
    />
  </View>
);

export default function ProfileScreen({ navigation, route }: any) {
  const {
    user,
    profile: myProfile,
    logout,
    deleteAccount,
    resetPassword,
    sendVerificationEmail,
    requestEmailChange,
    showMfaEnrollmentNotice,
    updateLocalProfile,
  } = useAuth();
  const { theme, setThemeMode } = useTheme();
  const isFocused = useIsFocused();
  const isDark = theme === 'dark';
  const [isEditing, setIsEditing] = useState(false);
  const [editFocus, setEditFocus] = useState<'all' | 'bio' | 'skills' | 'project' | 'idea' | 'photos'>('all');
  const [isSaving, setIsSaving] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  const [viewedProfile, setViewedProfile] = useState<any>(null);
  const [viewedLoading, setViewedLoading] = useState(false);
  const [viewedError, setViewedError] = useState('');
  const [startupIdeaText, setStartupIdeaText] = useState('');
  const [startupAnalysis, setStartupAnalysis] = useState<any>(null);
  const [startupAnalyzing, setStartupAnalyzing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [localPreferences, setLocalPreferences] = useState<PreferenceState>(() => preferenceSnapshotFor(null));
  const [savingPreference, setSavingPreference] = useState<PreferenceField | null>(null);
  const [profileViewCount, setProfileViewCount] = useState(0);
  const [profileClickCount, setProfileClickCount] = useState(0);
  const [profileSaveCount, setProfileSaveCount] = useState(0);
  const [profileResponseRate, setProfileResponseRate] = useState(0);
  const [newAccountEmail, setNewAccountEmail] = useState('');
  const [accountActionBusy, setAccountActionBusy] = useState('');
  const [subscriptionActionBusy, setSubscriptionActionBusy] = useState('');
  const [notificationActionBusy, setNotificationActionBusy] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState('checking');
  const [isProfileSaved, setIsProfileSaved] = useState(false);
  const [fullPhotoUri, setFullPhotoUri] = useState('');
  const [profileDetailsReady, setProfileDetailsReady] = useState(true);
  const [profileImagesReady, setProfileImagesReady] = useState(true);
  const [startupAnalyzerExpanded, setStartupAnalyzerExpanded] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState('');
  const connectionNote = useConnectionNote();

  // If a userId param is passed and it's not the current user, fetch that profile
  const rawTargetUserId = route?.params?.userId;
  const routedCompatibilityScore = Number(route?.params?.compatibilityScore);
  const routedCompatibilityReason = (typeof route?.params?.compatibilityReason === 'string' ? route.params.compatibilityReason : '').trim();
  const targetUserId =
    typeof rawTargetUserId === 'string' && rawTargetUserId.trim() && rawTargetUserId !== 'undefined'
      ? rawTargetUserId.trim()
      : '';
  const isViewingOther = Boolean(targetUserId && targetUserId !== myProfile?.uid);
  const profile = isViewingOther ? viewedProfile : myProfile;
  const proLocked = isAndroidProLocked(myProfile);
  const openPaywall = (feature: string) => setPaywallFeature(feature);

  useEffect(() => {
    if (!isFocused) return;

    if (Platform.OS === 'web') {
      setProfileDetailsReady(true);
      setProfileImagesReady(true);
      return;
    }

    let cancelled = false;
    const interaction = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      setProfileDetailsReady(true);
      requestAnimationFrame(() => {
        if (!cancelled) setProfileImagesReady(true);
      });
    });

    return () => {
      cancelled = true;
      interaction.cancel?.();
    };
  }, [isFocused, isViewingOther, myProfile?.uid, targetUserId]);

  useEffect(() => {
    if (!settingsExpanded || isViewingOther) return;
    let cancelled = false;
    getAppNotificationStatusAsync()
      .then((status) => {
        if (!cancelled) setNotificationStatus(String(status || 'unavailable'));
      })
      .catch(() => {
        if (!cancelled) setNotificationStatus('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [isViewingOther, settingsExpanded]);

  const ownerIdentityPatch = () => {
    const currentDisplayName = String(myProfile?.displayName || '').trim();
    const fallbackName =
      currentDisplayName && currentDisplayName !== 'New Builder'
        ? currentDisplayName
        : String(user?.displayName || user?.email?.split('@')[0] || 'LINKUP Builder').trim();
    const ownerUid = myProfile?.uid || user?.uid;

    return {
      uid: ownerUid,
      displayName: safeDisplayNameForSave(fallbackName, 'LINKUP Builder'),
      username: cleanUsername(String((myProfile as any)?.username || fallbackName || ownerUid || 'builder')) || `builder${String(ownerUid || '').slice(0, 5)}`,
      profileLink: profileLinkFor({ uid: ownerUid, profileLink: myProfile?.profileLink }),
    };
  };

  const updateOwnProfileDoc = async (patch: Record<string, unknown>) => {
    const ownerUid = myProfile?.uid || user?.uid;
    if (!ownerUid) throw new Error('No signed-in profile found.');
    const profileRef = doc(db, 'users', ownerUid);
    const identity = ownerIdentityPatch();
    const safePatch: Record<string, unknown> = { ...identity, ...patch, uid: ownerUid };

    safePatch.displayName = safeDisplayNameForSave(safePatch.displayName, identity.displayName);
    safePatch.username = cleanUsername(String(safePatch.username || safePatch.displayName || ownerUid.slice(0, 12))) || `builder${ownerUid.slice(0, 5)}`;
    safePatch.profileLink = profileLinkFor({ uid: ownerUid, profileLink: String(safePatch.profileLink || '') });

    await setDoc(profileRef, safePatch, { merge: true });
  };

  const profileCacheRef = useRef<Map<string, UserProfile>>(new Map());
  const pendingProfileFetches = useRef<Map<string, Promise<UserProfile | null>>>(new Map());
  const fetchVisibleProfileDoc = async (uid: string) => {
    const cached = profileCacheRef.current.get(uid);
    if (cached) return cached;

    const pending = pendingProfileFetches.current.get(uid);
    if (pending) return pending;

    const promise = (async () => {
      const [publicSnap] = await Promise.all([
        getDoc(doc(db, 'publicProfiles', uid)).catch(() => null),
      ]);

      if (publicSnap?.exists()) {
        const profile = compactProfileForList({ uid: publicSnap.id, ...(publicSnap.data() as any) });
        profileCacheRef.current.set(uid, profile);
        return profile;
      }

      return null;
    })();

    pendingProfileFetches.current.set(uid, promise);
    promise.finally(() => pendingProfileFetches.current.delete(uid));

    return promise;
  };

  const goBackOrHome = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    if (!user?.uid) {
      navigation?.reset?.({ index: 0, routes: [{ name: 'Landing' }] });
      return;
    }

    if (!myProfile?.onboarded) {
      navigation?.reset?.({ index: 0, routes: [{ name: 'Onboarding' }] });
      return;
    }

    navigation?.reset?.({ index: 0, routes: [{ name: 'Main' }] });
  };

  useEffect(() => {
    if (!isViewingOther || !isFocused) return;
    let cancelled = false;
    setViewedLoading(true);
    setViewedError('');
    fetchVisibleProfileDoc(targetUserId).then((profileDoc) => {
      if (cancelled) return;
      if (profileDoc) setViewedProfile(profileDoc);
      else setViewedError('This profile is unavailable.');
      setViewedLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      console.error("Error fetching viewed profile:", err);
      setViewedError('This profile is unavailable or blocked you.');
      setViewedLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isFocused, isViewingOther, targetUserId]);

  useEffect(() => {
    if (!isFocused || !isViewingOther || !myProfile?.uid || !profile?.uid) return;
    let cancelled = false;
    const interaction = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      trackProfileView({
        profileId: profile.uid,
        viewerId: myProfile.uid,
        viewerName: myProfile.displayName,
        viewerPic: myProfile.profilePic,
      }).catch((error) => console.warn('Profile view tracking skipped:', error));
      trackProfileClick({
        profileId: profile.uid,
        viewerId: myProfile.uid,
        viewerName: myProfile.displayName,
        viewerPic: myProfile.profilePic,
        action: 'profile',
      }).catch(() => {});
    });

    return () => {
      cancelled = true;
      interaction.cancel?.();
    };
  }, [isFocused, isViewingOther, myProfile?.uid, (profile as any)?.uid]);

  useEffect(() => {
    if (isViewingOther || !myProfile?.uid) {
      setProfileViewCount(0);
      return;
    }
    if (!isFocused) return;

    const fallbackCount = Math.max(
      Array.isArray(myProfile.viewedBy) ? myProfile.viewedBy.length : 0,
      Number((myProfile as any)?.profileViews || (myProfile as any)?.profileAnalytics?.views || 0) || 0
    );
    setProfileViewCount(fallbackCount);
  }, [isFocused, isViewingOther, myProfile?.uid, (myProfile as any)?.profileViews, Array.isArray(myProfile?.viewedBy) ? myProfile.viewedBy.length : 0]);

  useEffect(() => {
    if (isViewingOther || !myProfile?.uid) {
      setProfileClickCount(0);
      setProfileSaveCount(0);
      return;
    }
    if (!isFocused) return;

    const analytics = ((myProfile as any)?.profileAnalytics && typeof (myProfile as any).profileAnalytics === 'object')
      ? (myProfile as any).profileAnalytics
      : {};
    setProfileClickCount(Math.max(
      0,
      Number((myProfile as any)?.profileClicks || (myProfile as any)?.clicks || analytics.clicks || 0) || 0
    ));
    setProfileSaveCount(Math.max(
      0,
      Number((myProfile as any)?.profileSaves || (myProfile as any)?.saves || analytics.saves || 0) || 0
    ));
  }, [
    isFocused,
    isViewingOther,
    myProfile?.uid,
    (myProfile as any)?.profileClicks,
    (myProfile as any)?.profileSaves,
    (myProfile as any)?.profileAnalytics?.clicks,
    (myProfile as any)?.profileAnalytics?.saves,
  ]);

  useEffect(() => {
    if (!isFocused || !isViewingOther || !myProfile?.uid || !targetUserId) {
      setIsProfileSaved(false);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'savedProfiles', `${myProfile.uid}_${targetUserId}`),
      (snapshot) => setIsProfileSaved(snapshot.exists()),
      (error) => {
        if (!isPermissionDenied(error)) {
          console.warn('Saved profile status unavailable:', error);
        }
        setIsProfileSaved(false);
      }
    );

    return () => unsubscribe();
  }, [isFocused, isViewingOther, myProfile?.uid, targetUserId]);

  // NOTE: do not early-return before hooks below (Rules of Hooks).
  const isBusy = isViewingOther ? viewedLoading && !viewedProfile : !myProfile;
  const safeProfile: any = profile || myProfile || { uid: targetUserId || user?.uid || '', displayName: 'Builder', skills: [] };

  const reputationProfile = useMemo(() => {
    if (!isViewingOther && isEditing && editData) {
      return reputationProfileFromDraft(safeProfile, editData, safeProfile.uid || myProfile?.uid || user?.uid || '');
    }
    return safeProfile;
  }, [editData, isEditing, isViewingOther, myProfile?.uid, safeProfile, user?.uid]);
  const earnedRep = useMemo(() => earnedReputation(reputationProfile), [reputationProfile]);
  const profileLink = useMemo(() => profileLinkFor(safeProfile), [safeProfile?.uid, safeProfile?.profileLink]);
  const visibleProfileLink = useMemo(
    () => profileLink.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, ''),
    [profileLink]
  );
  const profileAnalytics = ((profile as any)?.profileAnalytics && typeof (profile as any)?.profileAnalytics === 'object')
    ? (profile as any)?.profileAnalytics
    : {};
  const visibleProfileViewCount = Math.max(
    profileViewCount,
    Array.isArray((profile as any)?.viewedBy) ? (profile as any)?.viewedBy.length : 0,
    Number((profile as any)?.profileViews || profileAnalytics.views || 0) || 0
  );
  const visibleProfileClickCount = Math.max(
    profileClickCount,
    Number((profile as any)?.profileClicks || (profile as any)?.clicks || profileAnalytics.clicks || 0) || 0
  );
  const visibleProfileSaveCount = Math.max(
    profileSaveCount,
    Number((profile as any)?.profileSaves || (profile as any)?.saves || profileAnalytics.saves || 0) || 0
  );
  const fallbackResponseRate = clampScore(Math.max(
    earnedRep.responseRate,
    Number((profile as any)?.responseRate || profileAnalytics.responseRate || 0) || 0
  ));
  const visibleResponseRate = clampScore(Math.max(profileResponseRate, fallbackResponseRate));
  const firestoreSettings = ((profile as any)?.settings && typeof (profile as any)?.settings === 'object') ? (profile as any)?.settings : {};

  useEffect(() => {
    if (isViewingOther || !myProfile?.uid) {
      setProfileResponseRate(0);
      return;
    }

    setProfileResponseRate(fallbackResponseRate);
  }, [isFocused, isViewingOther, myProfile?.uid, fallbackResponseRate]);

  useEffect(() => {
    if (!profile?.uid || isViewingOther || savingPreference) return;
    setLocalPreferences(preferenceSnapshotFor(profile));
  }, [
    profile?.uid,
    (profile as any)?.isVisible,
    (profile as any)?.isStealthMode,
    (profile as any)?.turboConnect,
    (profile as any)?.hideOnlineStatus,
    (profile as any)?.settings?.publicDiscovery,
    (profile as any)?.settings?.stealthMode,
    (profile as any)?.settings?.turboConnect,
    (profile as any)?.settings?.hideOnlineStatus,
    isViewingOther,
    savingPreference,
  ]);

  const compatibility = useMemo(() => {
    if (!isViewingOther || !profile) return null;
    if (Number.isFinite(routedCompatibilityScore) && routedCompatibilityScore > 0) {
      return clampScore(routedCompatibilityScore);
    }
    return null;
  }, [isViewingOther, routedCompatibilityScore]);

  const compatibilityReason = useMemo(() => {
    if (!isViewingOther || !profile) return '';
    return routedCompatibilityReason || '';
  }, [isViewingOther, routedCompatibilityReason]);

  const notificationStatusLabel = useMemo(() => {
    if (notificationStatus === 'granted') return 'ON';
    if (notificationStatus === 'denied') return 'BLOCKED';
    if (notificationStatus === 'undetermined') return 'ASK';
    if (notificationStatus === 'unavailable') return 'UNAVAILABLE';
    return 'CHECKING';
  }, [notificationStatus]);

  if (viewedError && isViewingOther) {
    return (
      <SafeAreaView style={[styles.container, appBackground(isDark)]}>
        <View style={styles.unavailableWrap}>
          <TouchableOpacity onPress={goBackOrHome} style={[styles.backPill, liquidGlass(isDark, false), { backgroundColor: isDark ? COLORS.darkGlassStrong : COLORS.lightGlassStrong }]}>
            <SafeIcon name="ChevronLeft" size={18} color={textColor(isDark)} />
            <Text style={[styles.backPillText, { color: textColor(isDark) }]}>Back</Text>
          </TouchableOpacity>
          <SafeIcon name="ShieldAlert" size={42} color={COLORS.primary} />
          <Text style={[styles.unavailableTitle, { color: textColor(isDark) }]}>Profile Unavailable</Text>
          <Text style={styles.unavailableText}>{viewedError}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isBusy) {
    return (
      <View style={[styles.container, appBackground(isDark), { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  // From here onward, `profile` is guaranteed to exist.

  const startEditing = (focus: 'all' | 'bio' | 'skills' | 'project' | 'idea' | 'photos' = 'all') => {
    if (!profile) return;
    const allowed = ['all', 'bio', 'skills', 'project', 'idea', 'photos'];
    const nextFocus = allowed.includes(String(focus)) ? (focus as typeof editFocus) : 'all';
    setEditFocus(nextFocus);
    const existingProjects = Array.isArray((profile as any)?.projects)
      ? (profile as any)?.projects.map((project: any, index: number) => normalizeProjectDraft(project, profile.uid, index))
      : [];
    const existingIdeas = Array.isArray((profile as any)?.startupIdeas)
      ? (profile as any)?.startupIdeas.map((idea: any, index: number) => normalizeIdeaDraft(idea, profile.uid, index))
      : [];
    setEditData({ 
      ...profile,
      username: (profile as any)?.username || '',
      occupation: (profile as any)?.occupation || '',
      company: (profile as any)?.company || '',
      age: (profile as any)?.age ? String((profile as any)?.age) : '',
      country: (profile as any)?.country || '',
      skills: Array.isArray(profile?.skills) ? profile.skills.join(', ') : (profile?.skills || ''),
      interests: Array.isArray((profile as any)?.interests) ? (profile as any)?.interests.join(', ') : '',
      industries: Array.isArray((profile as any)?.industries) ? (profile as any)?.industries.join(', ') : '',
      lookingFor: Array.isArray((profile as any)?.lookingFor) ? (profile as any)?.lookingFor.join(', ') : '',
      languages: Array.isArray((profile as any)?.languages) ? (profile as any)?.languages.join(', ') : '',
      personalityType: (profile as any)?.personalityType || '',
      roleSignals: Array.isArray((profile as any)?.roleAnswers?.manualSignals) ? (profile as any)?.roleAnswers.manualSignals.join(', ') : '',
      resume: {
        shippedProducts: resumeTextValue((profile as any)?.resume, 'shippedProducts'),
        sideProjects: resumeTextValue((profile as any)?.resume, 'sideProjects'),
        startupAttempts: resumeTextValue((profile as any)?.resume, 'startupAttempts'),
        hackathonWins: resumeTextValue((profile as any)?.resume, 'hackathonWins'),
        buildStreaks: resumeTextValue((profile as any)?.resume, 'buildStreaks'),
      },
      goals: (profile as any)?.goals || '',
      experience: (profile as any)?.experience || '',
      startupStage: (profile as any)?.startupStage || '',
      fundingStage: (profile as any)?.fundingStage || '',
      availability: (profile as any)?.availability || '',
      commitmentLevel: (profile as any)?.commitmentLevel || '',
      workStyle: (profile as any)?.workStyle || '',
      networkingIntent: (profile as any)?.networkingIntent || '',
      ambition: (profile as any)?.ambition || '',
      timezone: (profile as any)?.timezone || '',
      education: (profile as any)?.education || '',
      teamSizePreference: (profile as any)?.teamSizePreference || '',
      remoteOnly: !!(profile as any)?.remoteOnly,
      willingToRelocate: !!(profile as any)?.willingToRelocate,
      isStealthMode: profile?.isStealthMode || false,
      hideOnlineStatus: !!(profile as any)?.hideOnlineStatus,
      turboConnect: !!(profile as any)?.turboConnect,
      hasExit: profile?.hasExit || false,
      photos: Array.isArray((profile as any)?.photos) ? (profile as any)?.photos.slice(0, 3) : [],
      projects: existingProjects.length
        ? existingProjects
        : [{ id: `project_${profile.uid}_0`, title: '', description: '', status: normalizeProjectStatus((profile as any)?.startupStage || 'mvp') }],
      startupIdeas: existingIdeas.length
        ? existingIdeas
        : [{ id: `idea_${profile.uid}_0`, title: '', description: '', stage: 'Idea Stage', lookingFor: [], tags: [] }],
    });
    setIsEditing(true);
  };

  const generateInsights = async () => {
    if (!profile?.uid) {
      Alert.alert('Profile not ready', 'Wait for your profile to load, then try again.');
      return;
    }
    setIsSaving(true);
    const previousDiagnosticAt = getLastAIDiagnostic()?.timestamp || 0;
    try {
      const { geminiProfileInsights } = await import('../lib/gemini');
      const insight = await geminiProfileInsights(profile);
      await updateDoc(doc(db, 'users', profile.uid), { aiMatchInsights: insight });
      if (isViewingOther) {
        setViewedProfile((p: any) => (p ? { ...p, aiMatchInsights: insight } : p));
      }
      const diagnostic = getLastAIDiagnostic();
      if (diagnostic && !diagnostic.ok && diagnostic.timestamp > previousDiagnosticAt) {
        Alert.alert('Insight fallback', `${diagnostic.message}\n\nI saved a local profile insight so the profile still works.`);
      }
    } catch (e: any) {
      console.error('Insights error:', e);
      Alert.alert('Insights error', describeAIError(e));
    } finally {
      setIsSaving(false);
    }
  };

  const shareProfileLink = async () => {
    if (!profileLink) return;
    try {
      await Share.share({
        title: 'My LINKUP profile',
        message: `Connect with me on LINKUP:\n${profileLink}`,
        url: profileLink,
      });
    } catch (e) {
      Alert.alert('Share failed', 'Could not open the share menu.');
    }
  };

  const copyProfileLink = async () => {
    if (!profileLink) return;
    try {
      await Clipboard.setStringAsync(profileLink);
      Alert.alert('Copied', 'Your LINKUP profile link is ready to paste.');
    } catch (e) {
      Alert.alert('Copy failed', 'Could not copy your profile link.');
    }
  };

  const openProfileLink = async () => {
    if (!profileLink) return;
    try {
      await Linking.openURL(profileLink);
    } catch (e) {
      Alert.alert('Open failed', 'Could not open your profile link.');
    }
  };

  const pickGalleryPhoto = async (index: number) => {
    if (isViewingOther || !myProfile) return;
    const ImagePicker = await import('expo-image-picker');
    const { imageAssetToDataUri } = await import('../lib/imageUploadLimits');
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'We need access to your photos to update your pictures.');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: (ImagePicker as any).MediaType?.Images ? [(ImagePicker as any).MediaType.Images] : ['images'],
      allowsEditing: Platform.OS !== 'web',
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });

    if (result.canceled) return;
    const { dataUri, error } = await imageAssetToDataUri(result.assets?.[0]);
    if (!dataUri) {
      Alert.alert('Photo too large', error || 'Please choose a smaller photo.');
      return;
    }

    const current = Array.isArray(editData?.photos) ? [...editData.photos] : [];
    while (current.length < 3) current.push('');
    current[index] = dataUri;

    const nextPhotos = current.filter((p: string) => !!p).slice(0, 3);
    setEditData({ ...editData, photos: nextPhotos });
    setIsSaving(true);
    try {
      await updateOwnProfileDoc({ photos: nextPhotos });
      updateLocalProfile({ photos: nextPhotos });
      syncOwnPublicProfileIndex(myProfile.uid, { ...(profile || {}), photos: nextPhotos, uid: myProfile.uid }).catch(() => {});
    } catch (e: any) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${myProfile.uid}`);
      Alert.alert('Upload failed', e?.message || 'Failed to update photos.');
    } finally {
      setIsSaving(false);
    }
  };

  const removeGalleryPhoto = async (index: number) => {
    if (isViewingOther || !myProfile) return;
    const current = Array.isArray(editData?.photos) ? [...editData.photos] : [];
    const nextPhotos = current.filter((_photo: string, photoIndex: number) => photoIndex !== index).filter(Boolean).slice(0, 3);
    setEditData({ ...editData, photos: nextPhotos });
    setIsSaving(true);
    try {
      await updateOwnProfileDoc({ photos: nextPhotos });
      updateLocalProfile({ photos: nextPhotos });
      syncOwnPublicProfileIndex(myProfile.uid, { ...(profile || {}), photos: nextPhotos, uid: myProfile.uid }).catch(() => {});
    } catch (e: any) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${myProfile.uid}`);
      Alert.alert('Delete failed', e?.message || 'Failed to remove photo.');
    } finally {
      setIsSaving(false);
    }
  };

  const pickProfilePic = async () => {
    if (isViewingOther || !myProfile) return;
    const ImagePicker = await import('expo-image-picker');
    const { imageAssetToDataUri, MAX_FIRESTORE_IMAGE_CHARS } = await import('../lib/imageUploadLimits');
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'We need access to your photos to update your profile picture.');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: (ImagePicker as any).MediaType?.Images ? [(ImagePicker as any).MediaType.Images] : ['images'],
      allowsEditing: Platform.OS !== 'web',
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled) {
    const { dataUri, error } = await imageAssetToDataUri(result.assets?.[0], MAX_FIRESTORE_IMAGE_CHARS);
      if (!dataUri) {
        Alert.alert('Photo too large', error || 'Please choose a smaller photo.');
        return;
      }
      setIsSaving(true);
      try {
        await updateOwnProfileDoc({ profilePic: dataUri });
        updateLocalProfile({ profilePic: dataUri });
        syncOwnPublicProfileIndex(myProfile.uid, { ...(profile || {}), profilePic: dataUri, uid: myProfile.uid }).catch(() => {});
        
        if (isEditing) {
          setEditData({ ...editData, profilePic: dataUri });
        }
      } catch (e: any) {
        handleFirestoreError(e, OperationType.UPDATE, `users/${myProfile.uid}`);
        Alert.alert("Upload failed", e?.message || "Failed to update profile picture.");
      } finally {
        setIsSaving(false);
      }
    }
  };

  const openChat = async () => {
    if (!myProfile?.uid) {
      Alert.alert('Sign in to message', 'Create or sign in to a LINKUP account to message this builder.');
      navigation.navigate('EmailAuth');
      return;
    }
    if (!targetUserId || !profile) return;
    const gate = await resolveConnectionGate(myProfile.uid, targetUserId);
    let note = '';
    if (gate.status === 'none') {
      const drafted = await connectionNote.ask(displayNameFor(profile));
      if (drafted === null) return;
      note = drafted;
    }
    setIsSaving(true);
    try {
      trackProfileClick({
        profileId: targetUserId,
        viewerId: myProfile.uid,
        viewerName: myProfile.displayName,
        viewerPic: myProfile.profilePic,
        action: 'message',
      }).catch(() => {});
      const otherUserSnapshot = buildConversationProfileSnapshot(targetUserId, profile);
      const result = await startTalkOrRequest({
        senderId: myProfile.uid,
        recipientId: targetUserId,
        senderName: displayNameFor(myProfile),
        senderPic: safeProfileImageUri(myProfile.profilePic, MOBILE_LIST_IMAGE_LIMIT),
        message: note,
      });
      if (result.action === 'chat' && result.matchId) {
        navigation.navigate('Chat', { matchId: result.matchId, otherUser: otherUserSnapshot });
        return;
      }
      if (result.action === 'pending') {
        Alert.alert('Request pending', 'They have not answered yet. You can chat after they approve.');
        return;
      }
      if (result.action === 'incoming') {
        Alert.alert('They already asked', 'Approve their request in Notifications to start chatting.');
        navigation.navigate('Alerts');
        return;
      }
      if (result.action === 'rejected') {
        Alert.alert('Not available', 'This builder declined your last request.');
        return;
      }
      Alert.alert('Request sent', 'They can approve or ignore it. You cannot message until they approve.');
    } catch (e) {
      console.error('openChat error:', e);
      Alert.alert('Error', 'Could not open chat. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSavedProfile = async () => {
    if (!myProfile?.uid) {
      Alert.alert('Sign in to save', 'Create or sign in to a LINKUP account to save this profile.');
      navigation.navigate('EmailAuth');
      return;
    }
    if (!targetUserId || !profile) return;
    setIsSaving(true);
    try {
      const saveRef = doc(db, 'savedProfiles', `${myProfile.uid}_${targetUserId}`);
      if (isProfileSaved) {
        await deleteDoc(saveRef);
        setIsProfileSaved(false);
        trackProfileSave({ profileId: targetUserId, saved: false }).catch(() => {});
        Alert.alert('Removed', 'Profile removed from your saved builders.');
        return;
      }

      await setDoc(saveRef, {
        ownerId: myProfile.uid,
        profileId: targetUserId,
        ownerName: displayNameFor(myProfile),
        ownerPic: safeProfileImageUri(myProfile.profilePic),
        profileName: displayNameFor(profile),
        profilePic: profile?.profilePic || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      trackProfileSave({ profileId: targetUserId, saved: true }).catch(() => {});
      trackProfileClick({
        profileId: targetUserId,
        viewerId: myProfile.uid,
        viewerName: myProfile.displayName,
        viewerPic: myProfile.profilePic,
        action: 'save',
      }).catch(() => {});
      setIsProfileSaved(true);
      Alert.alert('Saved', 'Profile saved to your builders.');
    } catch (e) {
      console.error('save profile error:', e);
      Alert.alert('Save failed', 'Could not save this profile. Deploy the latest Firestore rules and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const refreshProfile = async () => {
    const uid = isViewingOther ? targetUserId : myProfile?.uid;
    if (!uid) return;
    setRefreshing(true);
    try {
      const profileDoc = await fetchVisibleProfileDoc(uid);
      if (profileDoc && isViewingOther) {
        setViewedProfile(profileDoc);
        setViewedError('');
      }
    } catch (e) {
      console.warn('Profile refresh failed:', e);
      if (isViewingOther) setViewedError('This profile is unavailable or blocked you.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleSave = async () => {
    if (!editData) return;
    const ownerUid = myProfile?.uid || user?.uid || profile?.uid;
    if (!ownerUid) {
      Alert.alert('Could not save profile', 'Sign in again, then try saving your profile.');
      return;
    }
    setIsSaving(true);
    try {
      const nextDisplayName = safeDisplayNameForSave(editData.displayName, profile?.displayName || user?.displayName || user?.email?.split('@')[0]);
      const skillsArray = cleanProfileList(editData.skills, 50);
      const interestsArray = cleanProfileList(editData.interests, 50);
      const industriesArray = cleanProfileList(editData.industries, 20);
      const lookingForArray = cleanProfileList(editData.lookingFor, 20);
      const languagesArray = cleanProfileList(editData.languages, 20);
      const roleSignalsArray = cleanProfileList(editData.roleSignals, 20);
      const nextRoleAnswers = {
        ...(((editData as any).roleAnswers && typeof (editData as any).roleAnswers === 'object') ? (editData as any).roleAnswers : {}),
        ...(roleSignalsArray.length ? { manualSignals: roleSignalsArray } : {}),
      };
      if (!roleSignalsArray.length) delete (nextRoleAnswers as any).manualSignals;
      const nextResume = normalizeResumeDraft(editData.resume || {});
      const nextAge = Number.parseInt(String(editData.age || ''), 10);
      const sourceProjects = Array.isArray(editData.projects) ? editData.projects : [];
      const nextProjects = sourceProjects
        .map((project: any, index: number) => normalizeProjectDraft(project, ownerUid, index))
        .filter((project: any) => project.title || project.description)
        .map((project: any, index: number) => ({
          ...project,
          title: limitText(project.title || `${editData.company || nextDisplayName || 'LINKUP'} project ${index + 1}`, 120),
          description: limitText(project.description || editData.bio || 'Ongoing project looking for relevant collaborators.', 700),
          link: project.link ? limitText(project.link, 240) : '',
        }))
        .slice(0, 10);
      const sourceIdeas = Array.isArray(editData.startupIdeas) ? editData.startupIdeas : [];
      const nextIdeas = sourceIdeas
        .map((idea: any, index: number) => normalizeIdeaDraft(idea, ownerUid, index))
        .filter((idea: any) => idea.title || idea.description)
        .map((idea: any, index: number) => ({
          ...idea,
          title: limitText(idea.title || `${editData.company || nextDisplayName || 'LINKUP'} idea ${index + 1}`, 120),
          description: limitText(idea.description || editData.bio || 'Idea looking for the right builders to make it real.', 700),
          stage: limitText(idea.stage || 'Idea Stage', 80),
          lookingFor: cleanProfileList(idea.lookingFor, 8),
          tags: cleanProfileList(idea.tags, 8),
        }))
        .slice(0, 20);
      const nextPreferences = {
        isVisible: editData.isVisible ?? true,
        isStealthMode: !!editData.isStealthMode,
        turboConnect: !!editData.turboConnect,
        hideOnlineStatus: !!editData.hideOnlineStatus,
      };
      const coreProfilePatch = {
        displayName: nextDisplayName,
        username: cleanUsername(editData.username || nextDisplayName || ''),
        profileLink: profileLinkFor({ uid: ownerUid }).slice(0, 180),
        occupation: limitText(editData.occupation, 80),
        company: limitText(editData.company, 120),
        bio: limitText(editData.bio, 2000),
        city: limitText(editData.city, 80),
        country: limitText(editData.country, 80),
        age: Number.isFinite(nextAge) ? Math.max(0, Math.min(120, nextAge)) : 0,
        skills: skillsArray,
        interests: interestsArray,
        industries: industriesArray,
        lookingFor: lookingForArray,
        languages: languagesArray,
        goals: limitText(editData.goals || lookingForArray.join(', '), 500),
        experience: limitText(editData.experience, 80),
        startupStage: limitText(editData.startupStage, 80),
        fundingStage: limitText(editData.fundingStage, 80),
        availability: limitText(editData.availability, 80),
        commitmentLevel: limitText(editData.commitmentLevel, 80),
        workStyle: limitText(editData.workStyle, 80),
        networkingIntent: limitText(editData.networkingIntent, 80),
        ambition: limitText(editData.ambition, 80),
        timezone: limitText(editData.timezone, 80),
        education: limitText(editData.education, 80),
        remoteOnly: !!editData.remoteOnly,
        willingToRelocate: !!editData.willingToRelocate,
        teamSizePreference: limitText(editData.teamSizePreference, 80),
        personalityType: limitText(editData.personalityType, 80),
        isStealthMode: nextPreferences.isStealthMode,
        hideOnlineStatus: nextPreferences.hideOnlineStatus,
        isVisible: nextPreferences.isVisible,
        turboConnect: nextPreferences.turboConnect,
      };
      const optionalProfilePatch = {
        roleAnswers: nextRoleAnswers,
        resume: nextResume,
        socialLinks: {
          portfolio: limitText(editData.socialLinks?.portfolio, 240),
          linkedin: limitText(editData.socialLinks?.linkedin, 240),
          github: limitText(editData.socialLinks?.github, 240),
          twitter: limitText(editData.socialLinks?.twitter, 240),
        },
        settings: {
          publicDiscovery: nextPreferences.isVisible,
          stealthMode: nextPreferences.isStealthMode,
          turboConnect: nextPreferences.turboConnect,
          hideOnlineStatus: nextPreferences.hideOnlineStatus,
          darkMode: typeof firestoreSettings.darkMode === 'boolean' ? firestoreSettings.darkMode : isDark,
        },
        vibeMedia: (() => {
          const value = String(editData.vibeMedia || '').trim();
          if (!value) return '';
          if (value.startsWith('data:') || value.length > 4000) return '';
          return limitText(value, 4000);
        })(),
        photos: Array.isArray(editData.photos)
          ? editData.photos
              .filter((p: string) => !!p)
              .map((p: string) => safeProfileImageUri(p, MAX_FIRESTORE_IMAGE_CHARS))
              .filter(Boolean)
              .slice(0, 3)
          : [],
        projects: nextProjects.slice(0, 10),
        startupIdeas: nextIdeas.slice(0, 20),
      };
      const reputationPatch = reputationPatchForProfile({
        ...(profile || {}),
        ...coreProfilePatch,
        ...optionalProfilePatch,
        uid: ownerUid,
      });
      await updateOwnProfileDoc({ ...coreProfilePatch, ...reputationPatch });
      try {
        await updateOwnProfileDoc(optionalProfilePatch);
      } catch (optionalError) {
        console.warn('Optional profile sections were not saved:', optionalError);
      }
      updateLocalProfile({ ...coreProfilePatch, ...optionalProfilePatch, ...reputationPatch });
      setLocalPreferences(nextPreferences);
      setIsEditing(false);
      setEditFocus('all');
      syncOwnPublicProfileIndex(ownerUid, {
        ...(profile || {}),
        ...coreProfilePatch,
        ...optionalProfilePatch,
        ...reputationPatch,
        uid: ownerUid,
      }).catch((indexError) => {
        console.warn('Public profile index sync skipped:', indexError);
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${ownerUid}`);
      const code = String((err as any)?.code || '');
      const message = String((err as any)?.message || '').toLowerCase();
      const friendlyMessage =
        code.includes('permission-denied') || message.includes('missing or insufficient permissions')
          ? 'Firestore blocked this profile save. The app needs the latest rules deployed.'
          : code.includes('resource-exhausted') || code.includes('invalid-argument') || code.includes('failed-precondition') || message.includes('document too large') || message.includes('too large')
            ? 'This profile still has too much image data for Firestore. Remove one photo or use a smaller image.'
            : code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('aborted') || message.includes('network')
              ? 'Firestore was temporarily unavailable. Please try again in a moment.'
              : 'Your changes were not saved. Firestore could not finish the write.';
      Alert.alert('Could not save profile', friendlyMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const updatePreference = async (patch: Record<string, any>) => {
    if (!profile?.uid) return false;
    try {
      await updateOwnProfileDoc(patch);
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`);
      Alert.alert('Setting not saved', 'Could not update this preference. Please try again.');
      return false;
    }
  };

  const setPreference = async (field: PreferenceField, value: boolean) => {
    if (savingPreference) return;
    const previous = localPreferences[field];
    const nextPreferences = { ...localPreferences, [field]: value };
    setLocalPreferences(nextPreferences);
    setSavingPreference(field);
    const settingKeyByField: Record<PreferenceField, string> = {
      isVisible: 'publicDiscovery',
      isStealthMode: 'stealthMode',
      turboConnect: 'turboConnect',
      hideOnlineStatus: 'hideOnlineStatus',
    };
    const ok = await updatePreference({
      [field]: value,
      settings: {
        darkMode: isDark,
        ...firestoreSettings,
        publicDiscovery: nextPreferences.isVisible,
        stealthMode: nextPreferences.isStealthMode,
        turboConnect: nextPreferences.turboConnect,
        hideOnlineStatus: nextPreferences.hideOnlineStatus,
        [settingKeyByField[field]]: value,
      },
    });
    if (!ok) {
      setLocalPreferences((prev) => ({ ...prev, [field]: previous }));
    }
    setSavingPreference(null);
  };

  const refreshNotificationStatus = async () => {
    const status = await getAppNotificationStatusAsync().catch(() => 'unavailable');
    setNotificationStatus(String(status || 'unavailable'));
    return String(status || 'unavailable');
  };

  const handleEnableNotifications = async () => {
    if (notificationActionBusy) return;
    if (!user?.uid) {
      Alert.alert('Sign in required', 'Sign in again, then turn notifications on.');
      return;
    }

    setNotificationActionBusy(true);
    try {
      const status = await enableAppNotificationsAsync(user.uid);
      setNotificationStatus(String(status || 'unavailable'));
      if (status === 'granted') {
        Alert.alert('Notifications on', 'LINKUP can now notify you about messages, matches, views, and opportunities.');
      } else {
        Alert.alert('Notifications blocked', 'Android did not grant notification permission for LINKUP.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open settings', onPress: openAppNotificationSettingsAsync },
        ]);
      }
    } catch (error) {
      console.warn('Notification permission error:', error);
      Alert.alert('Notifications unavailable', 'Could not turn notifications on. Rebuild the APK after this update, then try again.');
      await refreshNotificationStatus();
    } finally {
      setNotificationActionBusy(false);
    }
  };

  const openGooglePlaySubscriptionManager = async () => {
    if (subscriptionActionBusy) return;
    setSubscriptionActionBusy('manage');
    try {
      await Linking.openURL(GOOGLE_PLAY_SUBSCRIPTION_URL);
    } catch {
      Alert.alert('Could not open Google Play', 'Open Google Play > Payments & subscriptions > Subscriptions, then choose LINKUP PLUS.');
    } finally {
      setSubscriptionActionBusy('');
    }
  };

  const performCancelProPlan = async () => {
    const ownerUid = myProfile?.uid || user?.uid || profile?.uid;
    if (!ownerUid) {
      Alert.alert('Sign in required', 'Sign in again, then cancel your plan.');
      return;
    }

    const canceledAt = new Date().toISOString();
    const nextSettings = {
      ...firestoreSettings,
      publicDiscovery: localPreferences.isVisible,
      stealthMode: localPreferences.isStealthMode,
      turboConnect: false,
      hideOnlineStatus: localPreferences.hideOnlineStatus,
      darkMode: isDark,
    };
    const localFreePatch = {
      ...buildLocalFreeEntitlement(canceledAt),
      settings: nextSettings,
    };

    setSubscriptionActionBusy('cancel');
    await clearLocalProEntitlement(ownerUid).catch(() => {});
    updateLocalProfile(localFreePatch);
    setLocalPreferences((prev) => ({ ...prev, turboConnect: false }));

    try {
      await setDoc(
        doc(db, 'users', ownerUid),
        {
          uid: ownerUid,
          displayName: safeDisplayNameForSave(profile?.displayName || myProfile?.displayName, user?.displayName || user?.email?.split('@')[0]),
          profileLink: profileLinkFor({ uid: ownerUid, profileLink: (profile as any)?.profileLink || (myProfile as any)?.profileLink }),
          isPro: false,
          plan: 'free',
          subscriptionPlan: 'free',
          subscriptionStatus: 'canceled',
          subscriptionCanceledAt: serverTimestamp(),
          subscriptionUpdatedAt: serverTimestamp(),
          isVerified: false,
          verificationProgram: '',
          verifiedBy: '',
          verifiedAt: deleteField(),
          turboConnect: false,
          settings: nextSettings,
        },
        { merge: true }
      );
      Alert.alert('PLUS canceled', 'LINKUP PLUS perks are turned off for this account.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${ownerUid}`);
      Alert.alert('Canceled on this device', 'LINKUP PLUS is off locally. If you bought through Google Play, use Manage in Google Play to stop billing.');
    } finally {
      setSubscriptionActionBusy('');
    }
  };

  const handleCancelProPlan = () => {
    const message = 'Cancel LINKUP PLUS on this account? This removes PLUS perks, TurboConnect, analytics access, and the PLUS verification tick. If this is a real Google Play subscription, also use Manage in Google Play to stop billing.';
    const confirmed = webConfirm(message);
    if (confirmed !== null) {
      if (confirmed) performCancelProPlan();
      return;
    }

    Alert.alert('Cancel PLUS Plan', message, [
      { text: 'Keep PLUS', style: 'cancel' },
      { text: 'Cancel PLUS', style: 'destructive', onPress: performCancelProPlan },
    ]);
  };

  const performLogout = async () => {
    try {
      await logout();
    } catch (e: any) {
      console.error(e);
    }
  };

  const handleLogout = () => {
    const confirmed = webConfirm('Log out of LINKUP?');
    if (confirmed !== null) {
      if (confirmed) performLogout();
      return;
    }

    Alert.alert("Logout", "Are you sure you want to exit the realm?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: performLogout}
    ]);
  };

  const performDeleteAccount = async () => {
    try {
      setIsSaving(true);
      await deleteAccount();
    } catch (e: any) {
      const message = String(e?.code || e?.message || '');
      Alert.alert(
        "Error",
        message.includes('requires-recent-login')
          ? "For security, log out and sign in again, then delete your account."
          : e.message || "Failed to delete account. You may need to re-authenticate first."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = () => {
    const confirmed = webConfirm('Permanently delete your LINKUP account and profile? This cannot be undone.');
    if (confirmed !== null) {
      if (confirmed) performDeleteAccount();
      return;
    }

    Alert.alert(
      "DELETE ACCOUNT", 
      "This is permanent. Your founder profile and all network data will be wiped from existence. Proceed?", 
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "DELETE EVERYTHING", 
          style: "destructive", 
          onPress: performDeleteAccount
        }
      ]
    );
  };

  const runAccountAction = async (actionName: string, action: () => Promise<void>) => {
    if (accountActionBusy) return;
    setAccountActionBusy(actionName);
    try {
      await action();
    } finally {
      setAccountActionBusy('');
    }
  };

  const handleCurrentPasswordReset = () => {
    const email = user?.email || '';
    if (!email) {
      Alert.alert('No email found', 'This account does not have an email/password login attached yet.');
      return;
    }
    runAccountAction('reset-password', () => resetPassword(email));
  };

  const handleEmailChange = () => {
    runAccountAction('change-email', async () => {
      await requestEmailChange(newAccountEmail);
      setNewAccountEmail('');
    });
  };

  const runStartupAnalyzer = async () => {
    const idea = startupIdeaText.trim();
    if (idea.length < 12) {
      Alert.alert('Add more detail', 'Describe the customer, problem, and product in one or two sentences.');
      return;
    }

    if (proLocked) {
      const usage = await consumeDailyUsage(myProfile?.uid || user?.uid || 'anonymous', 'startup-analyzer', FREE_LIMITS.dailyStartupAnalyzer);
      if (!usage.allowed) {
        openPaywall(PRO_FEATURES.startupAnalyzer);
        return;
      }
    }

    setStartupAnalyzing(true);
    const previousDiagnosticAt = getLastAIDiagnostic()?.timestamp || 0;
    try {
      const { analyzeStartupIdea } = await import('../lib/ai');
      const result = await analyzeStartupIdea(idea);
      setStartupAnalysis(result);
      const diagnostic = getLastAIDiagnostic();
      if (diagnostic && !diagnostic.ok && diagnostic.timestamp > previousDiagnosticAt) {
        Alert.alert('Analyzer Fallback', `${diagnostic.message}\n\nI used the built-in startup analyzer so you still get feedback.`);
      }
    } catch (error: any) {
      Alert.alert('Analyzer error', describeAIError(error));
    } finally {
      setStartupAnalyzing(false);
    }
  };

  const currentSkills = isEditing ? parseProfileList(editData?.skills) : parseProfileList(profile?.skills ?? []);
  const organizedSkills = [...currentSkills].sort((a, b) => a.localeCompare(b)).slice(0, 50);

  const industries = (isEditing
    ? (typeof editData?.industries === 'string'
        ? editData.industries.split(',').map((s: string) => s.trim()).filter(Boolean)
        : (Array.isArray(editData?.industries) ? editData.industries : []))
    : (Array.isArray((profile as any)?.industries) ? (profile as any)?.industries : [])) as string[];

  const lookingFor = (isEditing
    ? (typeof editData?.lookingFor === 'string'
        ? editData.lookingFor.split(',').map((s: string) => s.trim()).filter(Boolean)
        : (Array.isArray(editData?.lookingFor) ? editData.lookingFor : []))
    : (Array.isArray((profile as any)?.lookingFor) ? (profile as any)?.lookingFor : [])) as string[];
  const projects = Array.isArray((profile as any)?.projects) ? (profile as any)?.projects : [];
  const visibleProjects = projects
    .filter((project: any) => String(project?.title || project?.description || '').trim())
    .slice(0, 10);
  const startupIdeas = Array.isArray((profile as any)?.startupIdeas) ? (profile as any)?.startupIdeas : [];
  const visibleStartupIdeas = startupIdeas
    .filter((idea: any) => String(idea?.title || idea?.description || '').trim())
    .slice(0, 20);
  const profileBio = String(profile?.bio || '').trim();
  const showHighVoiceNotice = isViewingOther && !!(profile as any)?.isVerified;
  const editedProjects = isEditing
    ? (Array.isArray(editData?.projects) && editData.projects.length
        ? editData.projects
        : [{ id: `project_${profile.uid}_0`, title: '', description: '', status: normalizeProjectStatus((profile as any)?.startupStage || 'mvp') }])
    : [];
  const updateEditedProject = (index: number, patch: Record<string, unknown>) => {
    const current = editedProjects.map((project: any, projectIndex: number) =>
      normalizeProjectDraft(project, profile.uid, projectIndex)
    );
    current[index] = { ...current[index], ...patch };
    setEditData({ ...editData, projects: current });
  };
  const addEditedProject = () => {
    if (editedProjects.length >= 10) {
      Alert.alert('Project limit', 'You can add up to 10 active projects.');
      return;
    }
    setEditData({
      ...editData,
      projects: [
        ...editedProjects,
        { id: `project_${profile.uid}_${editedProjects.length}_${Date.now()}`, title: '', description: '', status: 'idea' },
      ],
    });
  };
  const removeEditedProject = (index: number) => {
    const nextProjects = editedProjects.filter((_project: any, projectIndex: number) => projectIndex !== index);
    setEditData({
      ...editData,
      projects: nextProjects.length
        ? nextProjects
        : [{ id: `project_${profile.uid}_0`, title: '', description: '', status: normalizeProjectStatus((profile as any)?.startupStage || 'mvp') }],
    });
  };
  const editedIdeas = isEditing
    ? (Array.isArray(editData?.startupIdeas) && editData.startupIdeas.length
        ? editData.startupIdeas
        : [{ id: `idea_${profile.uid}_0`, title: '', description: '', stage: 'Idea Stage', lookingFor: [], tags: [] }])
    : [];
  const updateEditedIdea = (index: number, patch: Record<string, unknown>) => {
    const current = editedIdeas.map((idea: any, ideaIndex: number) => normalizeIdeaDraft(idea, profile.uid, ideaIndex));
    current[index] = { ...current[index], ...patch };
    setEditData({ ...editData, startupIdeas: current });
  };
  const addEditedIdea = () => {
    if (editedIdeas.length >= 20) {
      Alert.alert('Idea limit', 'You can add up to 20 ideas.');
      return;
    }
    setEditData({
      ...editData,
      startupIdeas: [
        ...editedIdeas,
        { id: `idea_${profile.uid}_${editedIdeas.length}_${Date.now()}`, title: '', description: '', stage: 'Idea Stage', lookingFor: [], tags: [] },
      ],
    });
  };
  const removeEditedIdea = (index: number) => {
    const nextIdeas = editedIdeas.filter((_idea: any, ideaIndex: number) => ideaIndex !== index);
    setEditData({
      ...editData,
      startupIdeas: nextIdeas.length
        ? nextIdeas
        : [{ id: `idea_${profile.uid}_0`, title: '', description: '', stage: 'Idea Stage', lookingFor: [], tags: [] }],
    });
  };
  const stealthModeValue = isEditing
    ? !!(editData?.isStealthMode ?? false)
    : localPreferences.isStealthMode;
  const publicDiscoveryValue = isEditing
    ? !!(editData?.isVisible ?? true)
    : localPreferences.isVisible;
  const isProPlanActive = hasLinkupPro(profile);
  const turboConnectValue = isEditing
    ? !!(editData?.turboConnect ?? false)
    : localPreferences.turboConnect;
  const hideOnlineStatusValue = isEditing
    ? !!(editData?.hideOnlineStatus ?? false)
    : localPreferences.hideOnlineStatus;
  const handleTurboConnectChange = (value: boolean) => {
    if (isEditing) {
      setEditData({ ...editData, turboConnect: value });
      return;
    }
    setPreference('turboConnect', value);
  };
  const editFieldStyle = {
    backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec,
    borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
  };
  const heroProfilePic =
    safeProfileImageUri(isEditing ? editData?.profilePic : profile?.profilePic, MOBILE_LIST_IMAGE_LIMIT) ||
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400';
  const shouldRenderProfileImages = profileImagesReady || isEditing;
  const profileInitial = (displayNameFor(profile).trim()[0] || 'L').toUpperCase();
  const openFullPhoto = (uri: string) => {
    blurActiveElementOnWeb();
    setFullPhotoUri(uri);
  };
  const closeFullPhoto = () => {
    blurActiveElementOnWeb();
    setFullPhotoUri('');
  };
  const searchSkill = (skill: string) => {
    const cleanSkill = String(skill || '').trim();
    if (!cleanSkill) return;
    navigation.navigate('Main', {
      screen: 'Search',
      params: {
        skill: cleanSkill,
        query: cleanSkill,
        searchToken: Date.now(),
      },
    });
  };
  const setEditField = (field: string, value: unknown) => {
    setEditData((current: any) => ({ ...(current || {}), [field]: value }));
  };
  const setSocialLinkField = (field: string, value: string) => {
    setEditData((current: any) => ({
      ...(current || {}),
      socialLinks: {
        ...((current || {}).socialLinks || {}),
        [field]: value,
      },
    }));
  };
  const toggleEditListValue = (field: string, value: string) => {
    const current = parseProfileList(editData?.[field]);
    const exists = current.some((entry) => entry.toLowerCase() === value.toLowerCase());
    const next = exists
      ? current.filter((entry) => entry.toLowerCase() !== value.toLowerCase())
      : [...current, value];
    setEditField(field, next.join(', '));
  };
  const renderChoiceGroup = (label: string, field: string, options: string[]) => (
    <View style={styles.choiceEditorBlock}>
      <Text style={styles.choiceEditorLabel}>{label}</Text>
      <View style={styles.statusOptionsRow}>
        {options.map((option) => {
          const selected = toTextValue(editData?.[field]).toLowerCase() === option.toLowerCase();
          return (
            <TouchableOpacity
              key={`${field}-${option}`}
              style={[
                styles.statusOptionChip,
                liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder },
                selected && styles.statusOptionChipActive,
              ]}
              onPress={() => setEditField(field, option)}
              activeOpacity={0.82}
            >
              <Text style={[styles.statusOptionText, selected && styles.statusOptionTextActive]}>{option.toUpperCase()}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
  const renderMultiChoiceGroup = (label: string, field: string, options: string[]) => (
    <View style={styles.choiceEditorBlock}>
      <Text style={styles.choiceEditorLabel}>{label}</Text>
      <View style={styles.statusOptionsRow}>
        {options.map((option) => {
          const selected = parseProfileList(editData?.[field]).some((entry) => entry.toLowerCase() === option.toLowerCase());
          return (
            <TouchableOpacity
              key={`${field}-${option}`}
              style={[
                styles.statusOptionChip,
                liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder },
                selected && styles.statusOptionChipActive,
              ]}
              onPress={() => toggleEditListValue(field, option)}
              activeOpacity={0.82}
            >
              <Text style={[styles.statusOptionText, selected && styles.statusOptionTextActive]}>{option.toUpperCase()}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
  const showEdit = (_section: typeof editFocus) => true;
  const renderStartEditButton = (label = 'EDIT PROFILE', _focus: typeof editFocus = 'all') =>
    !isViewingOther ? (
      <TouchableOpacity style={styles.inlineEditButton} onPress={() => startEditing('all')} activeOpacity={0.86}>
        <SafeIcon name="PenLine" size={13} color="#000" />
        <Text style={styles.inlineEditButtonText}>{label}</Text>
      </TouchableOpacity>
    ) : null;

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <View style={styles.scene} pointerEvents="none">
        <View style={[styles.scenePane, styles.scenePaneA, { backgroundColor: isDark ? 'rgba(0,194,255,0.1)' : 'rgba(0,194,255,0.14)' }]} />
        <View style={[styles.scenePane, styles.scenePaneB, { backgroundColor: isDark ? 'rgba(223,251,63,0.08)' : 'rgba(223,251,63,0.16)' }]} />
      </View>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={Platform.OS !== 'web'}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshProfile}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
      >
        
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goBackOrHome} style={styles.iconButton}>
            <SafeIcon name="ChevronLeft" size={20} color={textColor(isDark)} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>
            {isViewingOther ? 'PROFILE' : 'MY PROFILE'}
          </Text>
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={refreshProfile}
              style={styles.iconButton}
              activeOpacity={0.85}
              disabled={refreshing}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <SafeIcon name="RefreshCw" size={18} color={textColor(isDark, 'secondary')} />
              )}
            </TouchableOpacity>
            {!isViewingOther ? (
              <TouchableOpacity
                onPress={isEditing ? handleSave : () => startEditing('all')}
                style={[styles.iconButton, isEditing && styles.saveProfileButton]}
                activeOpacity={0.85}
                disabled={isSaving}
              >
                {isSaving ? <ActivityIndicator size="small" color={isEditing ? '#000' : '#444'} /> : isEditing ? (
                  <View style={styles.saveProfileContent}>
                    <SafeIcon name="CheckCircle2" size={17} color="#000" fill="#00000010" />
                    <Text style={styles.saveProfileText}>Save</Text>
                  </View>
                ) : (
                  <SafeIcon name="PenLine" size={20} color={textColor(isDark, 'secondary')} />
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* PROFILE HERO */}
        <View style={styles.heroSection}>
          <View style={styles.avatarContainer}>
            <TouchableOpacity activeOpacity={0.9} onPress={() => openFullPhoto(heroProfilePic)}>
              {shouldRenderProfileImages ? (
                <Image source={{ uri: heroProfilePic }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: isDark ? COLORS.darkBgSec : '#FFFCE7' }]}>
                  <Text style={[styles.avatarInitial, { color: textColor(isDark) }]}>{profileInitial}</Text>
                </View>
              )}
            </TouchableOpacity>
            {!isViewingOther && (
              <TouchableOpacity style={styles.cameraOverlay} onPress={pickProfilePic}>
                <SafeIcon name="Camera" size={20} color="#000" />
              </TouchableOpacity>
            )}
          </View>

          {!isViewingOther && (isEditing || profileDetailsReady) && showEdit('photos') && (
            <View style={{ marginTop: 18 }}>
              <Text style={[styles.sectionHeader, { color: textColor(isDark) }]}>Photos</Text>
              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 10 }}>
                {[0, 1, 2].map((idx) => {
                  const photos = (isEditing ? (editData?.photos || []) : ((profile as any)?.photos || [])) as string[];
                  const uri = safeProfileImageUri(photos[idx], MOBILE_LIST_IMAGE_LIMIT);
                  return (
                    <TouchableOpacity
                      key={idx}
                      activeOpacity={0.85}
                      onPress={() => (isEditing ? pickGalleryPhoto(idx) : startEditing('all'))}
                      style={[styles.photoSlot, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
                    >
                      {uri && shouldRenderProfileImages ? (
                        <>
                          <Image source={{ uri }} style={styles.photoSlotImg} />
                          {isEditing && (
                            <TouchableOpacity
                              style={styles.photoDeleteButton}
                              onPress={(event: any) => {
                                event?.stopPropagation?.();
                                removeGalleryPhoto(idx);
                              }}
                              activeOpacity={0.85}
                            >
                              <SafeIcon name="X" size={13} color="#FFF" />
                            </TouchableOpacity>
                          )}
                        </>
                      ) : (
                        <SafeIcon name="Plus" size={18} color={textColor(isDark, 'secondary')} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ marginTop: 8, fontSize: 10, color: '#666', fontWeight: '900', textAlign: 'center' }}>
                {isEditing ? 'Tap a slot to change it or X to delete it' : 'Tap to edit your swipe photos'}
              </Text>
            </View>
          )}

          {isEditing ? (
            <View style={styles.editForm}>
              <Text style={[styles.sectionHeader, { color: textColor(isDark), marginBottom: 12 }]}>
                {editFocus === 'bio' ? 'Add bio' : editFocus === 'skills' ? 'Add skills' : editFocus === 'project' ? 'Add project' : editFocus === 'idea' ? 'Add idea' : editFocus === 'photos' ? 'Add photos' : 'Edit profile'}
              </Text>
              {showEdit('all') ? (<>
              <TextInput 
                style={[styles.nameInput, styles.editTextBox, editFieldStyle, { color: textColor(isDark) }]}
                value={toTextValue(editData?.displayName)}
                onChangeText={(t: string) => setEditData({...editData, displayName: t})}
                placeholder="Full Name"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                value={editData?.username ? `@${toTextValue(editData.username)}` : ''}
                onChangeText={(t: string) => setEditData({ ...editData, username: cleanUsername(t) })}
                placeholder="@username"
                placeholderTextColor="#666"
                autoCapitalize="none"
              />
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                value={toTextValue(editData?.occupation)}
                onChangeText={(t: string) => setEditField('occupation', t)}
                placeholder="Occupation (e.g. Founder, ML Engineer)"
                placeholderTextColor="#666"
              />
              {renderChoiceGroup('ROLE / PROFESSION', 'occupation', ROLE_OPTIONS)}
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                value={toTextValue(editData?.company)}
                onChangeText={(t: string) => setEditField('company', t)}
                placeholder="Company / Startup (optional)"
                placeholderTextColor="#666"
              />
              <TextInput 
                style={[styles.locationInput, styles.editTextBox, editFieldStyle, { color: COLORS.primary }]}
                value={toTextValue(editData?.city)}
                onChangeText={(t: string) => setEditField('city', t)}
                placeholder="City"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                value={toTextValue(editData?.country)}
                onChangeText={(t: string) => setEditField('country', t)}
                placeholder="Country"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                value={toTextValue(editData?.age)}
                onChangeText={(t: string) => setEditField('age', t.replace(/[^0-9]/g, '').slice(0, 3))}
                placeholder="Age"
                placeholderTextColor="#666"
                keyboardType="number-pad"
              />
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                value={toTextValue(editData?.availability)}
                onChangeText={(t: string) => setEditField('availability', t)}
                placeholder="Availability (e.g. Open, Weekends)"
                placeholderTextColor="#666"
              />
              {renderChoiceGroup('AVAILABILITY', 'availability', AVAILABILITY_OPTIONS)}
              </>) : null}
              {showEdit('bio') ? (
              <TextInput
                multiline
                style={[styles.bioInput, editFieldStyle, { color: textColor(isDark) }]}
                value={toTextValue(editData?.bio)}
                onChangeText={(t: string) => setEditField('bio', t)}
                placeholder="Bio: who are you, what are you building, and what help do you want?"
                placeholderTextColor="#666"
              />
              ) : null}
              {showEdit('skills') ? (<>
              <TextInput
                multiline
                style={[styles.skillsInput, editFieldStyle, { color: textColor(isDark) }]}
                value={toTextValue(editData?.skills)}
                onChangeText={(t: string) => setEditField('skills', t)}
                placeholder="Skills & stack (comma, semicolon, or line separated): React, Automation, Sales..."
                placeholderTextColor="#666"
              />
              {renderMultiChoiceGroup('QUICK ADD SKILLS', 'skills', SKILL_SUGGESTIONS)}
              <TextInput
                multiline
                style={[styles.skillsInput, editFieldStyle, { color: textColor(isDark) }]}
                value={toTextValue(editData?.interests)}
                onChangeText={(t: string) => setEditField('interests', t)}
                placeholder="Interests (comma-separated): AI, marketplaces, student founders..."
                placeholderTextColor="#666"
              />
              <View style={[styles.statusEditorCard, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
                <Text style={styles.projectEditLabel}>Startup Status</Text>
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                  value={toTextValue(editData?.startupStage)}
                  onChangeText={(t: string) => setEditField('startupStage', t)}
                  placeholder="Startup Status (Idea Stage, Building MVP, Revenue...)"
                  placeholderTextColor="#666"
                />
                <View style={styles.statusOptionsRow}>
                  {STARTUP_STATUS_OPTIONS.map((status) => {
                    const isSelected = toTextValue(editData?.startupStage).toLowerCase() === status.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={status}
                        style={[
                          styles.statusOptionChip,
                          liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder },
                          isSelected && styles.statusOptionChipActive,
                        ]}
                        onPress={() => setEditField('startupStage', status)}
                        activeOpacity={0.82}
                      >
                        <Text style={[styles.statusOptionText, isSelected && styles.statusOptionTextActive]}>{status.toUpperCase()}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.projectEditHelp}>
                  This appears on your profile and helps builders understand what stage you are in.
                </Text>
              </View>
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                value={toTextValue(editData?.fundingStage)}
                onChangeText={(t: string) => setEditField('fundingStage', t)}
                placeholder="Funding (Bootstrapped, Raised, Pre-revenue...)"
                placeholderTextColor="#666"
              />
              {renderChoiceGroup('FUNDING STAGE', 'fundingStage', FUNDING_OPTIONS)}
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                value={toTextValue(editData?.lookingFor)}
                onChangeText={(t: string) => setEditField('lookingFor', t)}
                placeholder="Looking For (comma-separated)"
                placeholderTextColor="#666"
              />
              {renderMultiChoiceGroup('LOOKING FOR', 'lookingFor', LOOKING_FOR_SUGGESTIONS)}
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                value={toTextValue(editData?.industries)}
                onChangeText={(t: string) => setEditField('industries', t)}
                placeholder="Industries (comma-separated)"
                placeholderTextColor="#666"
              />
              {renderMultiChoiceGroup('INDUSTRIES', 'industries', INDUSTRY_SUGGESTIONS)}
              </>) : null}
              {isEditing ? (<>
              <View style={[styles.statusEditorCard, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
                <Text style={styles.projectEditLabel}>Matching Details</Text>
                <TextInput
                  multiline
                  style={[styles.bioInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                  value={toTextValue(editData?.goals)}
                  onChangeText={(t: string) => setEditField('goals', t)}
                  placeholder="Primary goal right now"
                  placeholderTextColor="#666"
                />
                {renderChoiceGroup('EXPERIENCE LEVEL', 'experience', EXPERIENCE_OPTIONS)}
                {renderChoiceGroup('COMMITMENT LEVEL', 'commitmentLevel', COMMITMENT_OPTIONS)}
                {renderChoiceGroup('WORK STYLE', 'workStyle', WORK_STYLE_OPTIONS)}
                {renderChoiceGroup('NETWORKING INTENT', 'networkingIntent', INTENT_OPTIONS)}
                {renderChoiceGroup('TEAM SIZE PREFERENCE', 'teamSizePreference', TEAM_SIZE_OPTIONS)}
                {renderChoiceGroup('EDUCATION / BACKGROUND', 'education', EDUCATION_OPTIONS)}
                {renderChoiceGroup('AMBITION', 'ambition', AMBITION_OPTIONS)}
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                  value={toTextValue(editData?.personalityType)}
                  onChangeText={(t: string) => setEditField('personalityType', t)}
                  placeholder="Personality / work signal (e.g. fast builder, analytical, creative)"
                  placeholderTextColor="#666"
                />
                <TextInput
                  multiline
                  style={[styles.bioInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                  value={toTextValue(editData?.roleSignals)}
                  onChangeText={(t: string) => setEditField('roleSignals', t)}
                  placeholder="Role signals (comma-separated): technical founder, growth, operations..."
                  placeholderTextColor="#666"
                />
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                  value={toTextValue(editData?.languages)}
                  onChangeText={(t: string) => setEditField('languages', t)}
                  placeholder="Languages (comma-separated)"
                  placeholderTextColor="#666"
                />
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                  value={toTextValue(editData?.timezone)}
                  onChangeText={(t: string) => setEditField('timezone', t)}
                  placeholder="Timezone (e.g. GMT+2, EST, CAT)"
                  placeholderTextColor="#666"
                />
                <View style={styles.switchEditorRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.choiceEditorLabel, { marginBottom: 2 }]}>Remote Only</Text>
                    <Text style={styles.choiceHelp}>Only show remote-friendly collaboration preference.</Text>
                  </View>
                  <Switch
                    value={!!editData?.remoteOnly}
                    onValueChange={(v) => setEditField('remoteOnly', v)}
                    trackColor={{ false: isDark ? '#2A2A30' : '#D1D5DB', true: COLORS.primary }}
                    thumbColor="#FFF"
                  />
                </View>
                <View style={styles.switchEditorRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.choiceEditorLabel, { marginBottom: 2 }]}>Willing to Relocate</Text>
                    <Text style={styles.choiceHelp}>Useful for local teams and investor-backed opportunities.</Text>
                  </View>
                  <Switch
                    value={!!editData?.willingToRelocate}
                    onValueChange={(v) => setEditField('willingToRelocate', v)}
                    trackColor={{ false: isDark ? '#2A2A30' : '#D1D5DB', true: COLORS.primary }}
                    thumbColor="#FFF"
                  />
                </View>
              </View>
              <View style={[styles.projectEditCard, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
                <Text style={styles.projectEditLabel}>Resume Signals</Text>
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                  value={toTextValue(editData?.resume?.shippedProducts)}
                  onChangeText={(t: string) => setEditField('resume', { ...(editData?.resume || {}), shippedProducts: t })}
                  placeholder="Shipped products (comma-separated)"
                  placeholderTextColor="#666"
                />
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                  value={toTextValue(editData?.resume?.sideProjects)}
                  onChangeText={(t: string) => setEditField('resume', { ...(editData?.resume || {}), sideProjects: t })}
                  placeholder="Side projects (comma-separated)"
                  placeholderTextColor="#666"
                />
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                  value={toTextValue(editData?.resume?.startupAttempts)}
                  onChangeText={(t: string) => setEditField('resume', { ...(editData?.resume || {}), startupAttempts: t })}
                  placeholder="Startup attempts (comma-separated)"
                  placeholderTextColor="#666"
                />
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                  value={toTextValue(editData?.resume?.hackathonWins)}
                  onChangeText={(t: string) => setEditField('resume', { ...(editData?.resume || {}), hackathonWins: t })}
                  placeholder="Hackathon wins / awards (comma-separated)"
                  placeholderTextColor="#666"
                />
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                  value={toTextValue(editData?.resume?.buildStreaks)}
                  onChangeText={(t: string) => setEditField('resume', { ...(editData?.resume || {}), buildStreaks: t.replace(/[^0-9]/g, '').slice(0, 4) })}
                  placeholder="Build streak days"
                  placeholderTextColor="#666"
                  keyboardType="number-pad"
                />
                <Text style={styles.projectEditHelp}>
                  These signals improve matching without needing formal verification.
                </Text>
              </View>
              <View style={[styles.statusEditorCard, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
                <Text style={styles.projectEditLabel}>Links</Text>
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                  value={toTextValue(editData?.socialLinks?.portfolio)}
                  onChangeText={(t: string) => setSocialLinkField('portfolio', t)}
                  placeholder="Portfolio / website"
                  placeholderTextColor="#666"
                  autoCapitalize="none"
                />
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                  value={toTextValue(editData?.socialLinks?.linkedin)}
                  onChangeText={(t: string) => setSocialLinkField('linkedin', t)}
                  placeholder="LinkedIn URL"
                  placeholderTextColor="#666"
                  autoCapitalize="none"
                />
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                  value={toTextValue(editData?.socialLinks?.github)}
                  onChangeText={(t: string) => setSocialLinkField('github', t)}
                  placeholder="GitHub URL"
                  placeholderTextColor="#666"
                  autoCapitalize="none"
                />
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: textColor(isDark) }]}
                  value={toTextValue(editData?.socialLinks?.twitter)}
                  onChangeText={(t: string) => setSocialLinkField('twitter', t)}
                  placeholder="X / Twitter URL"
                  placeholderTextColor="#666"
                  autoCapitalize="none"
                />
              </View>
              </>) : null}
              {showEdit('project') ? (
              <View style={[styles.projectEditCard, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
                <View style={styles.projectEditHeader}>
                  <Text style={styles.projectEditLabel}>Ongoing Projects</Text>
                  <TouchableOpacity style={styles.projectAddButton} onPress={addEditedProject} activeOpacity={0.85}>
                    <SafeIcon name="Plus" size={14} color="#000" />
                    <Text style={styles.projectAddText}>Add</Text>
                  </TouchableOpacity>
                </View>
                {editedProjects.map((project: any, index: number) => (
                  <View key={project?.id || `project-${index}`} style={[styles.projectDraftCard, { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
                    <View style={styles.projectDraftHeader}>
                      <Text style={styles.projectDraftLabel}>PROJECT {index + 1}</Text>
                      {editedProjects.length > 1 && (
                        <TouchableOpacity onPress={() => removeEditedProject(index)} style={styles.projectRemoveButton}>
                          <SafeIcon name="Trash2" size={13} color="#E30613" />
                        </TouchableOpacity>
                      )}
                    </View>
                    <TextInput
                      style={[styles.metaInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                      value={toTextValue(project?.title)}
                      onChangeText={(t: string) => updateEditedProject(index, { title: t })}
                      placeholder="Project title (e.g. founder marketplace)"
                      placeholderTextColor="#666"
                    />
                    <TextInput
                      multiline
                      style={[styles.bioInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                      value={toTextValue(project?.description)}
                      onChangeText={(t: string) => updateEditedProject(index, { description: t })}
                      placeholder="What are you building, and who should LINKUP recommend it to?"
                      placeholderTextColor="#666"
                    />
                    <TextInput
                      style={[styles.metaInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                      value={toTextValue(project?.status)}
                      onChangeText={(t: string) => updateEditedProject(index, { status: t })}
                      placeholder="Stage: idea, mvp, live"
                      placeholderTextColor="#666"
                    />
                    <TextInput
                      style={[styles.metaInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                      value={toTextValue(project?.link)}
                      onChangeText={(t: string) => updateEditedProject(index, { link: t })}
                      placeholder="Project link (optional)"
                      placeholderTextColor="#666"
                      autoCapitalize="none"
                    />
                  </View>
                ))}
                <Text style={styles.projectEditHelp}>
                  LINKUP recommends each project to people with matching skills, interests, roles, and goals.
                </Text>
              </View>
              ) : null}
              {showEdit('idea') ? (
              <View style={[styles.projectEditCard, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
                <View style={styles.projectEditHeader}>
                  <Text style={styles.projectEditLabel}>Ideas</Text>
                  <TouchableOpacity style={styles.projectAddButton} onPress={addEditedIdea} activeOpacity={0.85}>
                    <SafeIcon name="Plus" size={14} color="#000" />
                    <Text style={styles.projectAddText}>Add</Text>
                  </TouchableOpacity>
                </View>
                {editedIdeas.map((idea: any, index: number) => (
                  <View key={idea?.id || `idea-${index}`} style={[styles.projectDraftCard, { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
                    <View style={styles.projectDraftHeader}>
                      <Text style={styles.projectDraftLabel}>IDEA {index + 1}</Text>
                      {editedIdeas.length > 1 && (
                        <TouchableOpacity onPress={() => removeEditedIdea(index)} style={styles.projectRemoveButton}>
                          <SafeIcon name="Trash2" size={13} color="#E30613" />
                        </TouchableOpacity>
                      )}
                    </View>
                    <TextInput
                      style={[styles.metaInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                      value={toTextValue(idea?.title)}
                      onChangeText={(t: string) => updateEditedIdea(index, { title: t })}
                      placeholder="Idea title (e.g. marketplace for student founders)"
                      placeholderTextColor="#666"
                    />
                    <TextInput
                      multiline
                      style={[styles.bioInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                      value={toTextValue(idea?.description)}
                      onChangeText={(t: string) => updateEditedIdea(index, { description: t })}
                      placeholder="What is the idea, who is it for, and why should someone build it with you?"
                      placeholderTextColor="#666"
                    />
                    <TextInput
                      style={[styles.metaInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                      value={toTextValue(idea?.stage)}
                      onChangeText={(t: string) => updateEditedIdea(index, { stage: t })}
                      placeholder="Stage: Idea Stage, Research, MVP..."
                      placeholderTextColor="#666"
                    />
                    <TextInput
                      style={[styles.metaInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                      value={Array.isArray(idea?.lookingFor) ? idea.lookingFor.join(', ') : toTextValue(idea?.lookingFor)}
                      onChangeText={(t: string) => updateEditedIdea(index, { lookingFor: parseProfileList(t) })}
                      placeholder="Looking for: CTO, designer, marketer..."
                      placeholderTextColor="#666"
                    />
                    <TextInput
                      style={[styles.metaInput, editFieldStyle, { color: textColor(isDark), marginTop: 10 }]}
                      value={Array.isArray(idea?.tags) ? idea.tags.join(', ') : toTextValue(idea?.tags)}
                      onChangeText={(t: string) => updateEditedIdea(index, { tags: parseProfileList(t) })}
                      placeholder="Tags: fintech, SaaS, mobile, social..."
                      placeholderTextColor="#666"
                    />
                  </View>
                ))}
                <Text style={styles.projectEditHelp}>
                  Ideas appear in the Ideas deck. When two builders like the same idea, LINKUP opens a match.
                </Text>
              </View>
              ) : null}
            </View>
          ) : (
            <>
              <View style={styles.nameRowCentered}>
                <Text
                  style={[styles.nameText, { color: textColor(isDark) }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {displayNameFor(profile)}
                </Text>
                {profile?.isVerified && (
                  <VerifiedBadge size={30} style={styles.inlineVerifiedBadge} />
                )}
              </View>
              <Text style={styles.handleText}>
                @{cleanUsername((profile as any)?.username || displayNameFor(profile) || 'builder')}
              </Text>
              <View style={styles.profileRoleBadge}>
                <Text style={styles.profileRoleBadgeText}>{roleInfoFor((profile as any)?.occupation).badge}</Text>
              </View>
              <Text style={styles.roleTextLine} numberOfLines={1}>
                {[(profile as any)?.occupation, (profile as any)?.company ? `@ ${(profile as any)?.company}` : null].filter(Boolean).join(' ') || 'Builder'}
              </Text>
              <Text style={styles.locationText}>
                {[profile?.city, profile?.country].filter(Boolean).join(', ') || 'Remote'}
              </Text>

              {!isViewingOther && !!profileLink && (
                <View style={[styles.profileLinkCard, liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
                  <View style={styles.profileLinkHeader}>
                    <SafeIcon name="Link" size={18} color={COLORS.primary} />
                    <View style={styles.profileLinkCopy}>
                    <Text style={styles.profileLinkLabel}>Your LINKUP link</Text>
                    <Text
                      selectable
                      style={[styles.profileLinkText, { color: textColor(isDark) }]}
                      numberOfLines={2}
                      ellipsizeMode="middle"
                    >
                      {visibleProfileLink}
                    </Text>
                    </View>
                  </View>
                  <View style={styles.profileLinkActions}>
                    <TouchableOpacity onPress={copyProfileLink} style={[styles.profileLinkButton, { backgroundColor: COLORS.primary, borderWidth: 1, borderColor: COLORS.primary }]} activeOpacity={0.85}>
                      <Text style={[styles.profileLinkAction, { color: '#000' }]}>Copy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={shareProfileLink} style={[styles.profileLinkButton, { backgroundColor: COLORS.primary, borderWidth: 1, borderColor: COLORS.primary }]} activeOpacity={0.85}>
                      <Text style={[styles.profileLinkAction, { color: '#000' }]}>Share</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={openProfileLink} style={[styles.profileLinkButton, { backgroundColor: COLORS.primary, borderWidth: 1, borderColor: COLORS.primary }]} activeOpacity={0.85}>
                      <Text style={[styles.profileLinkAction, { color: '#000' }]}>Open</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              
              {isViewingOther && (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                  <TouchableOpacity 
                    style={[styles.actionButton, { flex: 1, backgroundColor: COLORS.primary, borderWidth: 1, borderColor: COLORS.primary }]}
                    onPress={openChat}
                  >
                    <Text style={{ color: '#000', fontWeight: '800' }}>Request to talk</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, {
                      backgroundColor: isProfileSaved ? (isDark ? COLORS.darkCard : COLORS.lightCard) : COLORS.primary,
                      borderWidth: 1,
                      borderColor: COLORS.primary,
                    }]}
                    onPress={toggleSavedProfile}
                    disabled={isSaving}
                  >
                    <Text style={{ color: isProfileSaved ? COLORS.primary : '#000', fontWeight: 'bold' }}>
                      {isProfileSaved ? 'Saved' : 'Save'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        {(!profileDetailsReady && !isEditing) || (isEditing && editFocus !== 'all') ? null : (
          <>
        {showHighVoiceNotice && (
          <View style={[styles.highVoiceCard, { backgroundColor: isDark ? COLORS.darkBgSec : '#FFFDF0', borderColor: COLORS.primary }]}>
            <VerifiedBadge size={46} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.highVoiceTitle, { color: textColor(isDark) }]}>LINKUP High Voice Program</Text>
              <Text style={styles.highVoiceText}>
                This verified builder has been marked by LINKUP as a trusted, high-signal voice in the network.
              </Text>
            </View>
          </View>
        )}

        {!isEditing && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>About</Text>
              <View style={[styles.profileStoryCard, liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
                <Text style={[styles.bioText, { color: textColor(isDark, 'secondary') }]}>
                  {profileBio || (isViewingOther
                    ? 'This builder has not added a bio yet.'
                    : 'Add your bio in Edit Profile so builders instantly understand who you are and what you need.')}
                </Text>
                {!isViewingOther && !profileBio ? renderStartEditButton('ADD BIO', 'bio') : null}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Skills & Stack</Text>
              {organizedSkills.length ? (
                <>
                  <View style={styles.organizedSkillsGrid}>
                    {organizedSkills.map((skill: string, index: number) => (
                      <TouchableOpacity
                        key={`${skill}-${index}`}
                        style={[styles.skillPill, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
                        onPress={() => searchSkill(skill)}
                        activeOpacity={0.82}
                      >
                        <View style={styles.skillDot} />
                        <Text style={[styles.skillPillText, { color: textColor(isDark) }]}>{skill.toUpperCase()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {renderStartEditButton('ADD / EDIT SKILLS', 'skills')}
                </>
              ) : (
                <View style={[styles.emptyProfileCard, liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
                  <Text style={[styles.emptyProfileText, { color: textColor(isDark, 'muted') }]}>
                    {isViewingOther ? 'No skills listed yet.' : 'Add your skills and stack so LINKUP can match you with the right builders.'}
                  </Text>
                  {renderStartEditButton('ADD SKILLS', 'skills')}
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Building Now</Text>
              {visibleProjects.length ? (
                visibleProjects.map((project: any, index: number) => (
                  <View
                    key={project?.id || `${profile.uid}-project-${index}`}
                    style={[styles.projectCard, liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                      <Text style={[styles.projectTitle, { color: textColor(isDark) }]} numberOfLines={1}>
                        {project?.title || 'Untitled project'}
                      </Text>
                      <View style={styles.projectStagePill}>
                        <Text style={styles.projectStageText}>{String(project?.status || 'mvp').toUpperCase()}</Text>
                      </View>
                    </View>
                    <Text style={styles.projectDescription}>
                      {proje        {renderStartEditButton('ADD PROJECT', 'project')}
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Ideas</Text>
              {visibleStartupIdeas.length ? (
                visibleStartupIdeas.map((idea: any, index: number) => (
                  <View
                    key={idea?.id || `${profile.uid}-idea-${index}`}
                    style={[styles.projectCard, liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                      <Text style={[styles.projectTitle, { color: textColor(isDark) }]} numberOfLines={1}>
                        {idea?.title || 'Untitled idea'}
                      </Text>
                      <View style={styles.projectStagePill}>
                        <Text style={styles.projectStageText}>{String(idea?.stage || 'idea').toUpperCase()}</Text>
                      </View>
                    </View>
                    <Text style={styles.projectDescription}>
                      {idea?.description || 'Idea looking for collaborators.'}
                    </Text>
                    <View style={styles.chipsRow}>
                      {[...(Array.isArray(idea?.lookingFor) ? idea.lookingFor : []), ...(Array.isArray(idea?.tags) ? idea.tags : [])]
                        .slice(0, 6)
                        .map((tag: string, tagIndex: number) => (
                          <View key={`${idea?.id || index}-${tag}-${tagIndex}`} style={[styles.chip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]}>
                            <Text style={[styles.chipText, { color: textColor(isDark) }]}>{String(tag).toUpperCase()}</Text>
                          </View>
                        ))}
                    </View>
                  </View>
                ))
              ) : (
                <View style={[styles.emptyProfileCard, liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
                  <Text style={[styles.emptyProfileText, { color: textColor(isDark, 'muted') }]}>
                    {isViewingOther ? 'This builder has not posted ideas yet.' : 'Add ideas in Edit Profile so builders can swipe into what you want to build.'}
                  </Text>
                  {renderStartEditButton('ADD IDEA', 'idea')}
                </View>
              )}
            </View>
          </>
        )}

        {/* COMPATIBILITY */}
        {isViewingOther && compatibility !== null && (
          <View style={[styles.section, { marginTop: -8 }]}>
            <Text style={styles.sectionLabel}>Compatibility</Text>
            <View style={[styles.compatCard, liquidGlass(isDark, false)]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={[styles.compatPct, { color: textColor(isDark) }]}>{compatibility}%</Text>
                  <Text style={styles.compatSub}>Compatibility</Text>
                </View>
                <View style={styles.compatTagPill}>
                  <Text style={styles.compatTagText}>{(profile as any)?.workStyle || 'Execution-focused'}</Text>
                </View>
              </View>
              <Text style={[styles.compatHint, { color: textColor(isDark, 'muted') }]}>
                {compatibilityReason || `Best match for: ${[(profile as any)?.occupation || 'Builders', industries[0] ? `${industries[0]} teams` : null, (profile as any)?.commitmentLevel ? `${(profile as any)?.commitmentLevel} builders` : null].filter(Boolean).slice(0, 3).join(' - ')}`}
              </Text>
            </View>
          </View>
        )}

        {/* LOOKING FOR */}
        {!!lookingFor.length && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Looking for</Text>
            <View style={styles.chipsRow}>
              {lookingFor.slice(0, 10).map((v, idx) => (
                <View key={idx} style={styles.chip}>
                  <Text style={styles.chipText}>{String(v).toUpperCase()}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* STARTUP STATUS */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Startup Status</Text>
          <View style={styles.statusGrid}>
            <View style={[styles.statusTile, liquidGlass(isDark, false)]}>
              <Text style={styles.statusLabel}>Stage</Text>
              <Text style={[styles.statusValue, { color: textColor(isDark) }]}>{(profile as any)?.startupStage || '-'}</Text>
            </View>
            <View style={[styles.statusTile, liquidGlass(isDark, false)]}>
              <Text style={styles.statusLabel}>Funding</Text>
              <Text style={[styles.statusValue, { color: textColor(isDark) }]}>{(profile as any)?.fundingStage || '-'}</Text>
            </View>
            <View style={[styles.statusTile, liquidGlass(isDark, false)]}>
              <Text style={styles.statusLabel}>Availability</Text>
              <Text style={[styles.statusValue, { color: textColor(isDark) }]}>{(profile as any)?.availability || 'Open'}</Text>
            </View>
            <View style={[styles.statusTile, liquidGlass(isDark, false)]}>
              <Text style={styles.statusLabel}>Intent</Text>
              <Text style={[styles.statusValue, { color: textColor(isDark) }]}>{(profile as any)?.networkingIntent || 'Builder'}</Text>
            </View>
          </View>
        </View>

        {/* INDUSTRY INTERESTS */}
        {!!industries.length && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Industry Interests</Text>
            <View style={styles.chipsRow}>
              {industries.slice(0, 12).map((v, idx) => (
                <View key={idx} style={[styles.chip, { borderColor: `${COLORS.primary}30`, backgroundColor: `${COLORS.primary}10` }]}>
                  <Text style={[styles.chipText, { color: COLORS.primary }]}>{String(v).toUpperCase()}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* MATCH INSIGHTS */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Match Insights</Text>
          <View style={[styles.insightCard, liquidGlass(isDark, false)]}>
            <Text style={[styles.insightText, { color: textColor(isDark, 'secondary') }]}>
              {(profile as any)?.aiMatchInsights || 'Generate a profile insight for this builder.'}
            </Text>
            {!isViewingOther && (
              <TouchableOpacity style={[styles.insightBtn, { opacity: isSaving ? 0.6 : 1 }]} disabled={isSaving} onPress={generateInsights}>
                <Text style={styles.insightBtnText}>{isSaving ? 'GENERATING...' : 'GENERATE INSIGHTS'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* VIBE INTRO */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>VIBE-CHECK (INTRO)</Text>
          {isEditing ? (
            <TextInput
              style={[styles.bioInput, editFieldStyle, { color: textColor(isDark) }]}
              value={toTextValue(editData?.vibeMedia)}
              onChangeText={(t: string) => setEditData({...editData, vibeMedia: t})}
              placeholder="Paste a link to your 15s audio/video intro..."
              placeholderTextColor="#444"
            />
          ) : (
            <TouchableOpacity 
              style={[styles.vibeCard, liquidGlass(isDark, false)]}
              onPress={() => {
                if (profile?.vibeMedia) {
                  Linking.openURL(profile.vibeMedia).catch(err => Alert.alert("Invalid Link", "Could not open vibe intro link."));
                } else {
                  Alert.alert("No Vibe", "This user hasn't set a vibe intro yet.");
                }
              }}
            >
              <SafeIcon name="Mic" size={20} color={COLORS.primary} />
              <Text style={[styles.vibeText, { color: textColor(isDark, 'muted') }]}>
                {profile?.vibeMedia ? "PLAY VIBE INTRO" : "NO VIBE INTRO SET"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {!isViewingOther && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Founder dashboard</Text>
            <View
              style={[
                styles.analyticsPanel,
                { backgroundColor: isDark ? COLORS.darkCard : '#FFF', borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder },
              ]}
            >
              <Text style={[styles.analyticsHelp, { color: textColor(isDark, 'muted') }]}>
                How people find and reply to you
              </Text>
              {[
                { icon: 'Eye', label: 'Profile views', value: visibleProfileViewCount, hint: 'Opens of your profile', mode: 'views' },
                { icon: 'MousePointerClick', label: 'Clicks', value: visibleProfileClickCount, hint: 'Taps on your actions', mode: 'clicks' },
                { icon: 'Bookmark', label: 'Saves', value: visibleProfileSaveCount, hint: 'People who bookmarked you', mode: 'saves' },
                { icon: 'MessageSquare', label: 'Response rate', value: `${visibleResponseRate}%`, hint: 'Chats you’ve answered', mode: 'response' },
              ].map((metric: any, index: number) => (
                <TouchableOpacity
                  key={String(metric.label)}
                  activeOpacity={0.82}
                  onPress={() => navigation.navigate('Viewers', { mode: metric.mode })}
                  style={[
                    styles.dashRow,
                    index > 0 && { borderTopColor: isDark ? COLORS.darkBorder : COLORS.lightBorder, borderTopWidth: 1 },
                  ]}
                >
                  <View style={styles.dashIcon}>
                    <SafeIcon name={String(metric.icon)} size={16} color="#111" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dashLabel, { color: textColor(isDark) }]}>{metric.label}</Text>
                    <Text style={[styles.dashHint, { color: textColor(isDark, 'muted') }]}>{metric.hint}</Text>
                  </View>
                  <Text style={[styles.dashValue, { color: textColor(isDark) }]}>{metric.value}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {!isViewingOther && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Startup Analyzer</Text>
            {!startupAnalyzerExpanded ? (
              <TouchableOpacity
                style={[styles.lazyPanelButton, liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
                onPress={() => setStartupAnalyzerExpanded(true)}
                activeOpacity={0.86}
              >
                <SafeIcon name="Gauge" size={18} color={COLORS.primary} />
                <Text style={[styles.lazyPanelText, { color: textColor(isDark) }]}>Open Startup Analyzer</Text>
              </TouchableOpacity>
            ) : (
              <View style={[styles.analyzerCard, liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
              <Text style={[styles.analyzerTitle, { color: textColor(isDark) }]}>Test your startup idea</Text>
              <Text style={styles.analyzerHelp}>
                Get a fast score for market, competition, monetization, risks, and your next validation move.
              </Text>
              <TextInput
                multiline
                value={startupIdeaText}
                onChangeText={setStartupIdeaText}
                placeholder="Example: A smart assistant that helps student founders find technical cofounders in Africa..."
                placeholderTextColor="#666"
                style={[styles.analyzerInput, { color: textColor(isDark), backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
              />
              <TouchableOpacity
                disabled={startupAnalyzing}
                onPress={runStartupAnalyzer}
                style={[styles.analyzerButton, { opacity: startupAnalyzing ? 0.6 : 1 }]}
              >
                {startupAnalyzing ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.analyzerButtonText}>Analyze Idea</Text>}
              </TouchableOpacity>

              {!!startupAnalysis && (
                <View style={styles.analysisResults}>
                  <View style={styles.analysisScoreRow}>
                    <Text style={styles.analysisScore}>{startupAnalysis.score ?? '--'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.analysisVerdict, { color: textColor(isDark) }]}>
                        {startupAnalysis.verdict || 'Startup snapshot'}
                      </Text>
                      <Text style={styles.analysisSmall}>Overall score / 100</Text>
                    </View>
                  </View>
                  {!!startupAnalysis.aiDiagnostic && (
                    <View style={styles.analysisDiagnostic}>
                      <Text style={styles.analysisDiagnosticText}>FALLBACK: {startupAnalysis.aiDiagnostic}</Text>
                    </View>
                  )}
                  {[
                    ['Market', startupAnalysis.marketPotential],
                    ['Customer', startupAnalysis.targetCustomer],
                    ['Competition', startupAnalysis.competition],
                    ['Monetization', startupAnalysis.monetization],
                    ['Risks', Array.isArray(startupAnalysis.keyRisks) ? startupAnalysis.keyRisks.join(' - ') : startupAnalysis.keyRisks],
                    ['Next Step', startupAnalysis.nextValidationStep],
                  ].filter(([, value]) => !!value).map(([label, value]) => (
                    <View key={label} style={styles.analysisItem}>
                      <Text style={styles.analysisLabel}>{label.toUpperCase()}</Text>
                      <Text style={[styles.analysisText, { color: textColor(isDark, 'secondary') }]}>{String(value)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
            )}
          </View>
        )}
        {/* SETTINGS - only shown on own profile */}
        {!isViewingOther && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Settings & Preferences</Text>
          {!settingsExpanded ? (
            <TouchableOpacity
              style={[styles.lazyPanelButton, liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
              onPress={() => setSettingsExpanded(true)}
              activeOpacity={0.86}
            >
              <SafeIcon name="Settings" size={18} color={COLORS.primary} />
              <Text style={[styles.lazyPanelText, { color: textColor(isDark) }]}>Open Settings</Text>
            </TouchableOpacity>
          ) : (
            <>
          <View style={[styles.prefRow, liquidGlass(isDark, false)]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="Ghost" size={18} color="#666" />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: textColor(isDark) }]}>Stealth Mode</Text>
                <Text style={styles.prefHelp}>Hides your profile from discovery/search while keeping your account active.</Text>
              </View>
            </View>
            <PreferenceSwitch
              value={stealthModeValue}
              isDark={isDark}
              disabled={savingPreference === 'isStealthMode'}
              onValueChange={(v) => isEditing ? setEditData({ ...editData, isStealthMode: v }) : setPreference('isStealthMode', v)}
            />
          </View>

          <View style={[styles.prefRow, liquidGlass(isDark, false), { marginTop: 12 }]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="Globe2" size={18} color={COLORS.primary} />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: textColor(isDark) }]}>Public Discovery</Text>
                <Text style={styles.prefHelp}>When on, your profile can appear in swipe, search, and active opportunity discovery.</Text>
              </View>
            </View>
            <PreferenceSwitch
              value={publicDiscoveryValue}
              isDark={isDark}
              disabled={savingPreference === 'isVisible'}
              onValueChange={(v) => isEditing ? setEditData({ ...editData, isVisible: v }) : setPreference('isVisible', v)}
            />
          </View>

          <View style={[styles.prefRow, liquidGlass(isDark, false), { marginTop: 12 }]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="Moon" size={18} color={COLORS.primary} />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: textColor(isDark) }]}>Appearance</Text>
                <Text style={styles.prefHelp}>Light or dark. Applies across LINKUP on this device.</Text>
              </View>
            </View>
          </View>
          <View style={styles.themePicker}>
            {(['light', 'dark'] as const).map((mode) => {
              const on = theme === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  onPress={() => void setThemeMode(mode)}
                  activeOpacity={0.88}
                  style={[
                    styles.themeOption,
                    {
                      borderColor: on ? COLORS.primary : (isDark ? COLORS.darkBorder : COLORS.lightBorder),
                      backgroundColor: on ? COLORS.primary : (isDark ? COLORS.darkCard : '#FFF'),
                    },
                  ]}
                >
                  <SafeIcon name={mode === 'dark' ? 'Moon' : 'Sun'} size={16} color="#111" />
                  <Text style={styles.themeOptionText}>{mode === 'dark' ? 'Dark' : 'Light'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={[styles.prefRow, liquidGlass(isDark, false), { marginTop: 12 }]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="Rocket" size={18} color={COLORS.primary} />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: textColor(isDark) }]}>Turbo Connect</Text>
                <Text style={styles.prefHelp}>
                  LINKUP Plus. Puts you higher in Discover and search when public discovery is on.
                </Text>
              </View>
            </View>
            {hasLinkupPro(myProfile) ? (
              <PreferenceSwitch
                value={turboConnectValue}
                isDark={isDark}
                disabled={savingPreference === 'turboConnect'}
                onValueChange={handleTurboConnectChange}
              />
            ) : (
              <TouchableOpacity onPress={() => openPaywall(PRO_FEATURES.turboConnect)} style={styles.plusChip} activeOpacity={0.88}>
                <Text style={styles.plusChipText}>Plus</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={[styles.prefRow, liquidGlass(isDark, false), { marginTop: 12 }]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="EyeOff" size={18} color="#22C55E" />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: textColor(isDark) }]}>Hide Online Status</Text>
                <Text style={styles.prefHelp}>When on, people will see you as offline/hidden even while you are using LINKUP.</Text>
              </View>
            </View>
            <PreferenceSwitch
              value={hideOnlineStatusValue}
              isDark={isDark}
              disabled={savingPreference === 'hideOnlineStatus'}
              onValueChange={(v) => isEditing ? setEditData({ ...editData, hideOnlineStatus: v }) : setPreference('hideOnlineStatus', v)}
            />
          </View>

          <View style={[styles.prefRow, liquidGlass(isDark, false), { marginTop: 12 }]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="BellRing" size={18} color={COLORS.primary} />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: textColor(isDark) }]}>Notifications</Text>
                <Text style={styles.prefHelp}>Messages, matches, profile views, and active opportunity alerts.</Text>
              </View>
            </View>
            <View style={styles.notificationActions}>
              <Text style={[styles.notificationStatusText, { color: notificationStatus === 'granted' ? '#22C55E' : '#777' }]}>
                {notificationStatusLabel}
              </Text>
              <TouchableOpacity
                disabled={notificationActionBusy}
                onPress={
                  notificationStatus === 'denied'
                    ? openAppNotificationSettingsAsync
                    : notificationStatus === 'granted'
                      ? refreshNotificationStatus
                      : handleEnableNotifications
                }
                style={[styles.notificationButton, { opacity: notificationActionBusy ? 0.6 : 1 }]}
                activeOpacity={0.84}
              >
                {notificationActionBusy ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.notificationButtonText}>
                    {notificationStatus === 'denied' ? 'SETTINGS' : notificationStatus === 'granted' ? 'CHECK' : 'ENABLE'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.subscriptionCard, liquidGlass(isDark, false)]}>
            <View style={styles.accountSecurityHeader}>
              <SafeIcon name={isProPlanActive ? 'Crown' : 'BadgeDollarSign'} size={19} color={COLORS.primary} fill={isProPlanActive ? COLORS.primary : 'transparent'} />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: textColor(isDark) }]}>LINKUP PLUS Plan</Text>
                <Text style={styles.prefHelp}>
                  {isProPlanActive
                    ? 'Manage billing or cancel PLUS from here.'
                    : 'You are on the free plan. Upgrade anytime to unlock PLUS perks.'}
                </Text>
              </View>
            </View>

            <View style={[styles.subscriptionStatusPill, { backgroundColor: isProPlanActive ? COLORS.primary : (isDark ? COLORS.darkBgSec : COLORS.lightBgSec) }]}>
              <Text style={[styles.subscriptionStatusText, { color: isProPlanActive ? '#000' : (textColor(isDark)) }]}>
                {isProPlanActive ? 'PLUS ACTIVE' : 'FREE PLAN'}
              </Text>
            </View>

            {isProPlanActive ? (
              <View style={styles.subscriptionActionGrid}>
                <TouchableOpacity
                  disabled={!!subscriptionActionBusy}
                  onPress={openGooglePlaySubscriptionManager}
                  style={[styles.subscriptionManageBtn, { opacity: subscriptionActionBusy ? 0.6 : 1 }]}
                  activeOpacity={0.84}
                >
                  {subscriptionActionBusy === 'manage' ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={styles.subscriptionManageText}>Manage In Google Play</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={!!subscriptionActionBusy}
                  onPress={handleCancelProPlan}
                  style={[styles.subscriptionCancelBtn, { opacity: subscriptionActionBusy ? 0.6 : 1 }]}
                  activeOpacity={0.84}
                >
                  {subscriptionActionBusy === 'cancel' ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text style={styles.subscriptionCancelText}>Cancel Plus Plan</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => openPaywall('LINKUP PLUS Plan')}
                style={styles.subscriptionManageBtn}
                activeOpacity={0.84}
              >
                <Text style={styles.subscriptionManageText}>Unlock LINKUP Plus</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={[styles.accountSecurityCard, liquidGlass(isDark, false)]}>
            <View style={styles.accountSecurityHeader}>
              <SafeIcon name="MailCheck" size={19} color={COLORS.primary} />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: textColor(isDark) }]}>Email Security</Text>
                <Text style={styles.prefHelp}>
                  Verification, password reset, email change, and MFA notifications for this account.
                </Text>
              </View>
            </View>

            <View style={[styles.emailStatusPill, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec }]}>
              <Text style={styles.emailStatusLabel}>Current Email</Text>
              <Text style={[styles.emailStatusValue, { color: textColor(isDark) }]} numberOfLines={1}>
                {user?.email || 'No email linked'}
              </Text>
              <Text style={[styles.emailVerifiedText, { color: user?.emailVerified ? '#22C55E' : '#F59E0B' }]}>
                {user?.emailVerified ? 'VERIFIED' : 'NOT VERIFIED'}
              </Text>
            </View>

            <View style={styles.accountActionGrid}>
              <TouchableOpacity
                disabled={!!accountActionBusy}
                onPress={() => runAccountAction('verify-email', sendVerificationEmail)}
                style={[styles.accountActionBtn, { opacity: accountActionBusy ? 0.6 : 1 }]}
              >
                {accountActionBusy === 'verify-email' ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.accountActionText}>Verify Email</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                disabled={!!accountActionBusy}
                onPress={handleCurrentPasswordReset}
                style={[styles.accountActionBtn, { opacity: accountActionBusy ? 0.6 : 1 }]}
              >
                {accountActionBusy === 'reset-password' ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.accountActionText}>Reset Password</Text>
                )}
              </TouchableOpacity>
            </View>

            <TextInput
              value={newAccountEmail}
              onChangeText={setNewAccountEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="New email address"
              placeholderTextColor="#777"
              style={[
                styles.emailChangeInput,
                {
                  color: textColor(isDark),
                  backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec,
                  borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
                },
              ]}
            />
            <TouchableOpacity
              disabled={!!accountActionBusy}
              onPress={handleEmailChange}
              style={[styles.emailChangeBtn, { opacity: accountActionBusy ? 0.6 : 1 }]}
            >
              {accountActionBusy === 'change-email' ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.emailChangeText}>Send Email Change Confirmation</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              disabled={!!accountActionBusy}
              onPress={() => runAccountAction('mfa-notice', showMfaEnrollmentNotice)}
              style={[styles.mfaNoticeBtn, { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
            >
              <SafeIcon name="ShieldCheck" size={16} color="#22C55E" />
              <Text style={[styles.mfaNoticeText, { color: textColor(isDark) }]}>Multi-factor Enrollment Notice</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.prefRow, liquidGlass(isDark, false), { marginTop: 12 }]} onPress={handleLogout}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="LogOut" size={18} color="#EF4444" />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: '#EF4444' }]}>Logout</Text>
                <Text style={styles.prefHelp}>Signs you out of this device. Your profile and chats stay saved.</Text>
              </View>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.prefRow, liquidGlass(isDark, false), { marginTop: 12 }]} onPress={handleDeleteAccount}>
            <View style={styles.prefLabelContainer}>
                <SafeIcon name="Trash2" size={18} color="#FF4444" />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: '#FF4444' }]}>Delete Account Permanently</Text>
                <Text style={styles.prefHelp}>Deletes your profile document and Firebase Auth account. You may need to sign in again first.</Text>
              </View>
            </View>
          </TouchableOpacity>
            </>
          )}
        </View>
        )}
          </>
        )}

        {isEditing && (
          <TouchableOpacity style={styles.cancelButton} onPress={() => { setIsEditing(false); setEditFocus('all'); }}>
            <Text style={styles.cancelText}>Discard Changes</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
      <Modal transparent visible={!!fullPhotoUri} animationType="fade" onRequestClose={closeFullPhoto}>
        <Pressable style={styles.photoModalBackdrop} onPress={closeFullPhoto}>
          <TouchableOpacity style={styles.photoModalClose} onPress={closeFullPhoto}>
            <SafeIcon name="X" size={22} color="#FFF" />
          </TouchableOpacity>
          <Image source={{ uri: fullPhotoUri }} style={styles.fullPhotoImage} resizeMode="contain" />
        </Pressable>
      </Modal>
      {connectionNote.modal}
      <PaywallModal
        visible={!!paywallFeature}
        feature={paywallFeature || PRO_FEATURES.startupAnalyzer}
        description={`LINKUP PLUS unlocks the startup analyzer, verified badge, warm intros, and Linky AI.`}
        onClose={() => setPaywallFeature('')}
      />
    </SafeAreaView>
  );
}

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
  scrollContent: {
    padding: 24,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: -0.2,
    textTransform: 'uppercase',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  saveProfileButton: {
    width: 82,
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  saveProfileContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  saveProfileText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
    color: '#000',
  },
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 32,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: -0.2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  photoSlot: {
    width: 82,
    height: 82,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  photoSlotImg: {
    width: '100%',
    height: '100%',
  },
  photoDeleteButton: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E30613',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 20,
    width: 132,
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: COLORS.primary,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 0,
  },
  photoModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  photoModalClose: {
    position: 'absolute',
    top: 46,
    right: 22,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullPhotoImage: {
    width: '100%',
    height: '82%',
    borderRadius: 16,
  },
  cameraOverlay: {
    position: 'absolute',
    right: 2,
    bottom: 14,
    width: 42,
    height: 42,
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
    zIndex: 8,
    elevation: 8,
  },
  nameText: {
    fontSize: 28,
    fontWeight: '900',
    textTransform: 'uppercase',
    textAlign: 'center',
    flexShrink: 1,
    maxWidth: '82%',
  },
  nameRowCentered: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    flexWrap: 'nowrap',
    maxWidth: '100%',
    alignSelf: 'center',
  },
  inlineVerifiedBadge: {
    flexShrink: 0,
  },
  verifiedNameBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  highVoiceCard: {
    marginTop: -8,
    marginBottom: 24,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 3,
  },
  highVoiceIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  highVoiceTitle: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  highVoiceText: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
    color: '#666',
  },
  handleText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#666',
    letterSpacing: -0.2,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  profileRoleBadge: {
    marginTop: 10,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#00000018',
  },
  profileRoleBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0,
  },
  roleTextLine: {
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 1,
    marginTop: 6,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  locationText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '900',
    marginTop: 4,
  },
  editForm: {
    alignItems: 'stretch',
    width: '100%',
    marginTop: 18,
  },
  nameInput: {
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    width: '100%',
  },
  editTextBox: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  locationInput: {
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'left',
    marginTop: 10,
    width: '100%',
  },
  metaInput: {
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontWeight: '700',
    width: '100%',
  },
  section: {
    width: '100%',
    marginBottom: 32,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: '#666',
    letterSpacing: -0.2,
    marginBottom: 16,
  },
  vibeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
  },
  vibeText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  bioText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  bioInput: {
    width: '100%',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  profileStoryCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  organizedSkillsGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '100%',
  },
  skillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
  },
  skillPillText: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  emptyProfileCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  profileLoadingCard: {
    width: '100%',
    minHeight: 74,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -8,
    marginBottom: 18,
  },
  lazyPanelButton: {
    width: '100%',
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  lazyPanelText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  emptyProfileText: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
  },
  inlineEditButton: {
    marginTop: 12,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineEditButtonText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  badgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badgeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '900',
  },
  skillsInput: {
    width: '100%',
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: '600',
    minHeight: 96,
    textAlignVertical: 'top',
  },
  compatCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: `${COLORS.primary}30`,
  },
  compatPct: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 1,
  },
  compatSub: {
    fontSize: 10,
    fontWeight: '900',
    color: '#666',
    letterSpacing: -0.2,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  compatTagPill: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  compatTagText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  compatHint: {
    marginTop: 10,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  chipText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#FFF',
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  statusTile: {
    width: (width - 24 * 2 - 10) / 2,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  statusLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: -0.2,
    color: '#666',
    textTransform: 'uppercase',
  },
  statusValue: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  insightCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    gap: 12,
  },
  insightText: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  insightBtn: {
    height: 44,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: -0.2,
    color: '#000',
    textTransform: 'uppercase',
  },
  socialsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  socialButton: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  prefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  prefLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  prefCopy: {
    flex: 1,
  },
  prefLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  prefHelp: {
    marginTop: 3,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '700',
    color: '#777',
  },
  notificationActions: {
    alignItems: 'flex-end',
    gap: 8,
    marginLeft: 10,
  },
  notificationStatusText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  notificationButton: {
    minWidth: 78,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationButtonText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  analyticsPanel: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
  },
  dashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  dashIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  dashHint: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  dashValue: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  themePicker: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  themeOption: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  themeOptionText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111',
  },
  plusChip: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  plusChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#111',
  },
  analyticsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  analyticsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  analyticsHeaderIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  analyticsTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  analyticsHelp: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  analyticsBadge: {
    height: 26,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
  },
  analyticsBadgeText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  analyticsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  analyticsTile: {
    width: (width - 24 * 2 - 18 * 2 - 10) / 2,
    minHeight: 96,
    borderRadius: 16,
    padding: 14,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  analyticsTileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  analyticsIconBubble: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  analyticsLockedChip: {
    backgroundColor: 'rgba(107,114,128,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  analyticsLockedChipText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#6B7280',
    letterSpacing: 0.5,
  },
  analyticsValue: {
    marginTop: 10,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  analyticsMetric: {
    marginTop: 2,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  analyticsFooterWrap: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(119,119,119,0.15)',
  },
  analyticsFooter: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '700',
  },
  accountSecurityCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  subscriptionCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  accountSecurityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  subscriptionStatusPill: {
    marginTop: 14,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#000',
  },
  subscriptionStatusText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  subscriptionActionGrid: {
    gap: 10,
    marginTop: 12,
  },
  subscriptionManageBtn: {
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginTop: 12,
  },
  subscriptionManageText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
  },
  subscriptionCancelBtn: {
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  subscriptionCancelText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
  },
  emailStatusPill: {
    marginTop: 14,
    padding: 12,
    borderRadius: 16,
  },
  emailStatusLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: -0.2,
    color: '#777',
  },
  emailStatusValue: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '900',
  },
  emailVerifiedText: {
    marginTop: 5,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
  },
  accountActionGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  accountActionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 15,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  accountActionText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
  },
  emailChangeInput: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 12,
    fontWeight: '800',
  },
  emailChangeBtn: {
    marginTop: 10,
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  emailChangeText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
  },
  mfaNoticeBtn: {
    marginTop: 10,
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  mfaNoticeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
  },
  switchWrap: {
    minWidth: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  switchState: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  viewerCount: {
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.primary,
  },
  analyzerCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  analyzerTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  analyzerHelp: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    color: '#777',
  },
  analyzerInput: {
    minHeight: 110,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
    fontSize: 13,
    fontWeight: '800',
    textAlignVertical: 'top',
  },
  analyzerButton: {
    height: 46,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  analyzerButtonText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.8,
    color: '#000',
  },
  analysisResults: {
    marginTop: 14,
    gap: 10,
  },
  analysisScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  analysisScore: {
    width: 58,
    height: 58,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    color: '#000',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 22,
    fontWeight: '900',
  },
  analysisVerdict: {
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  analysisSmall: {
    marginTop: 3,
    fontSize: 10,
    fontWeight: '800',
    color: '#777',
  },
  analysisDiagnostic: {
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#FFF4CC',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  analysisDiagnosticText: {
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 15,
    color: '#92400E',
  },
  analysisItem: {
    borderTopWidth: 1,
    borderTopColor: '#88888820',
    paddingTop: 10,
  },
  analysisLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: -0.2,
    color: COLORS.primary,
  },
  analysisText: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  profileLinkCard: {
    width: '100%',
    marginTop: 14,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  profileLinkHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  profileLinkCopy: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  profileLinkLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: -0.2,
    color: '#666',
  },
  profileLinkText: {
    marginTop: 3,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '800',
    maxWidth: '100%',
  },
  profileLinkActions: {
    flexDirection: 'row',
    gap: 6,
    width: '100%',
    marginTop: 10,
  },
  profileLinkButton: {
    flex: 1,
    minHeight: 30,
    borderRadius: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(251,230,24,0.08)',
  },
  profileLinkAction: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    color: COLORS.primary,
  },
  projectEditCard: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginTop: 14,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  projectEditHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  projectEditLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: -0.2,
    color: COLORS.primary,
  },
  projectAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  projectAddText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#000',
  },
  projectDraftCard: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 10,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  projectDraftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  projectDraftLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: -0.2,
    color: '#777',
  },
  projectRemoveButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E3061312',
  },
  projectEditHelp: {
    marginTop: 8,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 15,
    color: '#777',
  },
  statusEditorCard: {
    width: '100%',
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  statusOptionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  choiceEditorBlock: {
    width: '100%',
    marginTop: 12,
  },
  choiceEditorLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: -0.2,
    color: '#777',
    textTransform: 'uppercase',
  },
  choiceHelp: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
    color: '#777',
  },
  switchEditorRow: {
    width: '100%',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusOptionChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  statusOptionChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  statusOptionText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: '#666',
  },
  statusOptionTextActive: {
    color: '#000',
  },
  projectCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginTop: 10,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  projectTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  projectStagePill: {
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectStageText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#000',
  },
  projectDescription: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    color: '#777',
  },
  cancelButton: {
    marginTop: 10,
    alignItems: 'center',
    padding: 16,
  },
  cancelText: {
    color: '#FF4444',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  unavailableWrap: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  backPill: {
    position: 'absolute',
    top: 18,
    left: 18,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backPillText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  unavailableTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  unavailableText: {
    maxWidth: 280,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
    color: '#777',
  }
});
{
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  backPill: {
    position: 'absolute',
    top: 18,
    left: 18,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backPillText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  unavailableTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  unavailableText: {
    maxWidth: 280,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
    color: '#777',
  }
});
