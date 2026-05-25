import React, { useMemo, useState, useEffect } from 'react';
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
  Pressable
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import * as Icons from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, deleteDoc, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { geminiProfileInsights } from '../lib/gemini';
import { trackProfileView } from '../lib/analytics';
import { analyzeStartupIdea } from '../lib/ai';
import { imageAssetToDataUri } from '../lib/imageUploadLimits';
import { ensureDirectMatch } from '../lib/chat';
import { blurActiveElementOnWeb } from '../lib/webFocus';
import { describeAIError, getLastAIDiagnostic } from '../lib/aiDiagnostics';
import { compatibilityForPair } from '../lib/matchmaking';

const { width } = Dimensions.get('window');

// ULTRA-SAFE ICON RENDERER
const SafeIcon = ({ name, size = 20, color = "#FBE618", fill = "transparent", style }: any) => {
  const IconComponent = (Icons as any)[name];
  if (!IconComponent) {
    return <View style={[{ width: size, height: size, backgroundColor: color + '20', borderRadius: 4 }, style]} />;
  }
  return <IconComponent size={size} color={color} fill={fill} style={style} />;
};

const Badge = ({ name, iconName, color = "#FBE618" }: { name: string, iconName: string, color?: string }) => {
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
  const responseRate = Number(profile?.reputationMetrics?.responseRate ?? 70);

  const profileQuality =
    (profile?.displayName ? 10 : 0) +
    (profile?.bio ? 12 : 0) +
    (profile?.profilePic ? 12 : 0) +
    (profile?.city && profile?.country ? 8 : 0) +
    Math.min(18, skills.length * 4) +
    Math.min(12, industries.length * 4) +
    Math.min(10, lookingFor.length * 5) +
    Math.min(8, photos.length * 3);

  const activity =
    Math.min(10, Number(profile?.streakCount || 0) * 2) +
    Math.min(8, projects.length * 4) +
    (profile?.isVerified ? 8 : 0) +
    (profile?.onboarded ? 6 : 0);

  const founderScore = clampScore(profileQuality + activity);
  return {
    reliability: clampScore(40 + profileQuality * 0.45 + activity * 0.6),
    responseRate: clampScore(responseRate),
    collaboration: clampScore(45 + Math.min(30, lookingFor.length * 8) + Math.min(25, skills.length * 3)),
    consistency: clampScore(35 + Math.min(35, Number(profile?.streakCount || 0) * 4) + (profile?.onboarded ? 20 : 0)),
    completion: clampScore(35 + Math.min(40, projects.length * 12) + (profile?.bio ? 15 : 0)),
    founderScore,
  };
};

const cleanUsername = (value: string) => value.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
const profileLinkFor = (profile: any) => profile?.profileLink || (profile?.uid ? `linkup://profile/${encodeURIComponent(profile.uid)}` : '');
const toTextValue = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
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
type PreferenceField = 'isStealthMode' | 'isVisible' | 'turboConnect' | 'hideOnlineStatus';

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
    <Text style={[styles.switchState, { color: value ? '#2563EB' : '#777' }]}>{value ? 'ON' : 'OFF'}</Text>
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={!!disabled}
      trackColor={{ false: isDark ? '#2A2A30' : '#D1D5DB', true: '#2563EB' }}
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
  } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  const [viewedProfile, setViewedProfile] = useState<any>(null);
  const [viewedLoading, setViewedLoading] = useState(false);
  const [viewedError, setViewedError] = useState('');
  const [startupIdeaText, setStartupIdeaText] = useState('');
  const [startupAnalysis, setStartupAnalysis] = useState<any>(null);
  const [startupAnalyzing, setStartupAnalyzing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [preferenceOverrides, setPreferenceOverrides] = useState<Partial<Record<PreferenceField, boolean>>>({});
  const [savingPreference, setSavingPreference] = useState<PreferenceField | null>(null);
  const [profileViewCount, setProfileViewCount] = useState(0);
  const [newAccountEmail, setNewAccountEmail] = useState('');
  const [accountActionBusy, setAccountActionBusy] = useState('');
  const [isProfileSaved, setIsProfileSaved] = useState(false);
  const [fullPhotoUri, setFullPhotoUri] = useState('');

  // If a userId param is passed and it's not the current user, fetch that profile
  const rawTargetUserId = route?.params?.userId;
  const routedCompatibilityScore = Number(route?.params?.compatibilityScore);
  const routedCompatibilityReason = String(route?.params?.compatibilityReason || '').trim();
  const targetUserId =
    typeof rawTargetUserId === 'string' && rawTargetUserId.trim() && rawTargetUserId !== 'undefined'
      ? rawTargetUserId.trim()
      : '';
  const isViewingOther = Boolean(targetUserId && targetUserId !== myProfile?.uid);
  const profile = isViewingOther ? viewedProfile : myProfile;

  const ownerIdentityPatch = () => {
    const currentDisplayName = String(myProfile?.displayName || '').trim();
    const fallbackName =
      currentDisplayName && currentDisplayName !== 'New Builder'
        ? currentDisplayName
        : String(user?.displayName || user?.email?.split('@')[0] || 'LINKUP Builder').trim();

    return {
      uid: myProfile?.uid,
      displayName: fallbackName || 'LINKUP Builder',
      profileLink: profileLinkFor({ uid: myProfile?.uid, profileLink: myProfile?.profileLink }),
    };
  };

  const updateOwnProfileDoc = async (patch: Record<string, unknown>) => {
    if (!myProfile?.uid) throw new Error('No signed-in profile found.');
    const profileRef = doc(db, 'users', myProfile.uid);
    try {
      await updateDoc(profileRef, patch);
    } catch (error: any) {
      if (String(error?.code || '').includes('permission-denied')) {
        await updateDoc(profileRef, { ...ownerIdentityPatch(), ...patch });
        return;
      }
      throw error;
    }
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
    if (!isViewingOther) return;
    setViewedLoading(true);
    setViewedError('');
    getDoc(doc(db, 'users', targetUserId)).then(snap => {
      if (snap.exists()) setViewedProfile({ ...snap.data(), uid: snap.id });
      else setViewedError('This profile is unavailable.');
      setViewedLoading(false);
    }).catch((err) => {
      console.error("Error fetching viewed profile:", err);
      setViewedError('This profile is unavailable or blocked you.');
      setViewedLoading(false);
    });
  }, [targetUserId]);

  useEffect(() => {
    if (!isViewingOther || !myProfile?.uid || !profile?.uid) return;
    trackProfileView({
      profileId: profile.uid,
      viewerId: myProfile.uid,
      viewerName: myProfile.displayName,
      viewerPic: myProfile.profilePic,
    });
  }, [isViewingOther, myProfile?.uid, (profile as any)?.uid]);

  useEffect(() => {
    if (isViewingOther || !myProfile?.uid) {
      setProfileViewCount(0);
      return;
    }

    const viewsQuery = query(collection(db, 'profileViews'), where('profileId', '==', myProfile.uid));
    const unsubscribe = onSnapshot(
      viewsQuery,
      (snapshot) => {
        setProfileViewCount(snapshot.docs.filter((viewDoc) => (viewDoc.data() as any).viewerId !== myProfile.uid).length);
      },
      (error) => {
        console.warn('Profile view count unavailable:', error);
        setProfileViewCount(Array.isArray(myProfile.viewedBy) ? myProfile.viewedBy.length : 0);
      }
    );

    return () => unsubscribe();
  }, [isViewingOther, myProfile?.uid, Array.isArray(myProfile?.viewedBy) ? myProfile.viewedBy.join('|') : '']);

  useEffect(() => {
    if (!isViewingOther || !myProfile?.uid || !targetUserId) {
      setIsProfileSaved(false);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'savedProfiles', `${myProfile.uid}_${targetUserId}`),
      (snapshot) => setIsProfileSaved(snapshot.exists()),
      (error) => {
        console.warn('Saved profile status unavailable:', error);
        setIsProfileSaved(false);
      }
    );

    return () => unsubscribe();
  }, [isViewingOther, myProfile?.uid, targetUserId]);

  // NOTE: do not early-return before hooks below (Rules of Hooks).
  const isBusy = !profile || viewedLoading;
  const safeProfile: any = profile || { uid: targetUserId || myProfile?.uid || '', displayName: 'Builder', skills: [] };

  const earnedRep = useMemo(() => earnedReputation(safeProfile), [safeProfile]);
  const founderScore = earnedRep.founderScore;
  const profileLink = useMemo(() => profileLinkFor(safeProfile), [safeProfile?.uid, safeProfile?.profileLink]);
  const visibleProfileViewCount = Math.max(profileViewCount, Array.isArray((profile as any)?.viewedBy) ? (profile as any).viewedBy.length : 0);

  const compatibility = useMemo(() => {
    if (!myProfile || !isViewingOther || !profile) return null;
    if (Number.isFinite(routedCompatibilityScore) && routedCompatibilityScore > 0) {
      return clampScore(routedCompatibilityScore);
    }
    return compatibilityForPair(myProfile, profile)?.score ?? null;
  }, [myProfile, profile, isViewingOther, routedCompatibilityScore]);

  const compatibilityReason = useMemo(() => {
    if (!myProfile || !isViewingOther || !profile) return '';
    if (routedCompatibilityReason) return routedCompatibilityReason;
    return compatibilityForPair(myProfile, profile)?.reason || '';
  }, [myProfile, profile, isViewingOther, routedCompatibilityReason]);

  if (viewedError && isViewingOther) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFF' }]}>
        <View style={styles.unavailableWrap}>
          <TouchableOpacity onPress={goBackOrHome} style={[styles.backPill, { backgroundColor: isDark ? '#16161A' : '#F5F5F5' }]}>
            <SafeIcon name="ChevronLeft" size={18} color={isDark ? '#FFF' : '#000'} />
            <Text style={[styles.backPillText, { color: isDark ? '#FFF' : '#000' }]}>BACK</Text>
          </TouchableOpacity>
          <SafeIcon name="ShieldAlert" size={42} color="#FBE618" />
          <Text style={[styles.unavailableTitle, { color: isDark ? '#FFF' : '#000' }]}>PROFILE UNAVAILABLE</Text>
          <Text style={styles.unavailableText}>{viewedError}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isBusy) {
    return (
      <View style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFF', justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color="#666" />
      </View>
    );
  }

  // From here onward, `profile` is guaranteed to exist.

  const startEditing = () => {
    const firstProject = Array.isArray((profile as any).projects) ? (profile as any).projects[0] : null;
    setEditData({ 
      ...profile,
      username: (profile as any).username || '',
      occupation: (profile as any).occupation || '',
      company: (profile as any).company || '',
      skills: Array.isArray(profile.skills) ? profile.skills.join(', ') : (profile.skills || ''),
      industries: Array.isArray((profile as any).industries) ? (profile as any).industries.join(', ') : '',
      lookingFor: Array.isArray((profile as any).lookingFor) ? (profile as any).lookingFor.join(', ') : '',
      startupStage: (profile as any).startupStage || '',
      fundingStage: (profile as any).fundingStage || '',
      availability: (profile as any).availability || '',
      workStyle: (profile as any).workStyle || '',
      networkingIntent: (profile as any).networkingIntent || '',
      isStealthMode: profile.isStealthMode || false,
      hideOnlineStatus: !!(profile as any).hideOnlineStatus,
      turboConnect: !!(profile as any).turboConnect,
      hasExit: profile.hasExit || false,
      photos: Array.isArray((profile as any).photos) ? (profile as any).photos.slice(0, 3) : [],
      projectTitle: firstProject?.title || '',
      projectDescription: firstProject?.description || '',
      projectStatus: firstProject?.status || (profile as any).startupStage || 'mvp',
    });
    setIsEditing(true);
  };

  const generateInsights = async () => {
    setIsSaving(true);
    const previousDiagnosticAt = getLastAIDiagnostic()?.timestamp || 0;
    try {
      const insight = await geminiProfileInsights(profile);
      await updateDoc(doc(db, 'users', profile.uid), { aiMatchInsights: insight });
      if (isViewingOther) {
        setViewedProfile((p: any) => ({ ...p, aiMatchInsights: insight }));
      }
      const diagnostic = getLastAIDiagnostic();
      if (diagnostic && !diagnostic.ok && diagnostic.timestamp > previousDiagnosticAt) {
        Alert.alert('AI Insight Fallback', `${diagnostic.message}\n\nI saved a local profile insight so the profile still works.`);
      }
    } catch (e: any) {
      console.error('Insights error:', e);
      Alert.alert('AI Insights Error', describeAIError(e));
    } finally {
      setIsSaving(false);
    }
  };

  const shareProfileLink = async () => {
    if (!profileLink) return;
    try {
      await Share.share({
        title: 'My LINKUP profile',
        message: `Connect with me on LINKUP: ${profileLink}`,
        url: profileLink,
      });
    } catch (e) {
      Alert.alert('Share failed', 'Could not open the share menu.');
    }
  };

  const pickGalleryPhoto = async (index: number) => {
    if (isViewingOther || !myProfile) return;
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
      quality: 0.06,
      base64: true,
    });

    if (result.canceled) return;
    const { dataUri, error } = await imageAssetToDataUri(result.assets?.[0], 260_000);
    if (!dataUri) {
      Alert.alert('Photo too large', error || 'Please choose a smaller photo.');
      return;
    }

    const current = Array.isArray(editData?.photos) ? [...editData.photos] : [];
    while (current.length < 3) current.push('');
    current[index] = dataUri;

    setEditData({ ...editData, photos: current.filter((p: string) => !!p).slice(0, 3) });
    setIsSaving(true);
    try {
      await updateOwnProfileDoc({ photos: current.filter((p) => !!p).slice(0, 3) });
    } catch (e: any) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${myProfile.uid}`);
      Alert.alert('Upload failed', e?.message || 'Failed to update photos.');
    } finally {
      setIsSaving(false);
    }
  };

  const pickProfilePic = async () => {
    if (isViewingOther || !myProfile) return;
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
      quality: 0.08,
      base64: true,
    });

    if (!result.canceled) {
      const { dataUri, error } = await imageAssetToDataUri(result.assets?.[0]);
      if (!dataUri) {
        Alert.alert('Photo too large', error || 'Please choose a smaller photo.');
        return;
      }
      setIsSaving(true);
      try {
        await updateOwnProfileDoc({ profilePic: dataUri });
        
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
    if (!myProfile || !targetUserId || !profile) return;
    setIsSaving(true);
    try {
      const matchId = await ensureDirectMatch(myProfile.uid, targetUserId);
      navigation.navigate('Chat', { matchId, otherUser: { ...profile, uid: targetUserId } });
    } catch (e) {
      console.error('openChat error:', e);
      Alert.alert('Error', 'Could not open chat. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSavedProfile = async () => {
    if (!myProfile?.uid || !targetUserId || !profile) return;
    setIsSaving(true);
    try {
      const saveRef = doc(db, 'savedProfiles', `${myProfile.uid}_${targetUserId}`);
      if (isProfileSaved) {
        await deleteDoc(saveRef);
        setIsProfileSaved(false);
        Alert.alert('Removed', 'Profile removed from your saved builders.');
        return;
      }

      await setDoc(saveRef, {
        ownerId: myProfile.uid,
        profileId: targetUserId,
        profileName: profile.displayName || 'Builder',
        profilePic: profile.profilePic || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
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
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists() && isViewingOther) {
        setViewedProfile({ ...snap.data(), uid: snap.id });
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
    setIsSaving(true);
    try {
      const skillsArray = typeof editData.skills === 'string' 
        ? editData.skills.split(',').map((s: string) => s.trim()).filter((s: string) => s !== '')
        : (Array.isArray(editData.skills) ? editData.skills : []);
      const existingProjects = Array.isArray((profile as any).projects) ? (profile as any).projects : [];
      const projectTitle = String(editData.projectTitle || '').trim();
      const projectDescription = String(editData.projectDescription || '').trim();
      const mainProject = projectTitle || projectDescription
        ? [{
            id: existingProjects[0]?.id || `project_${profile.uid}_main`,
            title: projectTitle || `${editData.company || editData.displayName || 'LINKUP'} project`,
            description: projectDescription || editData.bio || 'Ongoing project looking for relevant collaborators.',
            status: normalizeProjectStatus(editData.projectStatus),
            ...(existingProjects[0]?.link ? { link: existingProjects[0].link } : {}),
          }]
        : [];
      const nextProjects = [...mainProject, ...existingProjects.slice(1)].slice(0, 20);

      await updateDoc(doc(db, 'users', profile.uid), {
        displayName: editData.displayName || '',
        username: cleanUsername(editData.username || editData.displayName || ''),
        occupation: editData.occupation || '',
        company: editData.company || '',
        bio: editData.bio || '',
        city: editData.city || '',
        skills: skillsArray,
        industries: Array.isArray(editData.industries)
          ? editData.industries
          : (typeof editData.industries === 'string'
              ? editData.industries.split(',').map((s: string) => s.trim()).filter(Boolean)
              : []),
        lookingFor: Array.isArray(editData.lookingFor)
          ? editData.lookingFor
          : (typeof editData.lookingFor === 'string'
              ? editData.lookingFor.split(',').map((s: string) => s.trim()).filter(Boolean)
              : []),
        startupStage: editData.startupStage || '',
        fundingStage: editData.fundingStage || '',
        availability: editData.availability || '',
        workStyle: editData.workStyle || '',
        networkingIntent: editData.networkingIntent || '',
        socialLinks: editData.socialLinks || {},
        isStealthMode: !!editData.isStealthMode,
        hideOnlineStatus: !!editData.hideOnlineStatus,
        isVisible: editData.isVisible ?? true,
        turboConnect: !!editData.turboConnect,
        vibeMedia: editData.vibeMedia || '',
        photos: Array.isArray(editData.photos) ? editData.photos.filter((p: string) => !!p).slice(0, 3) : [],
        projects: nextProjects,
      });
      setIsEditing(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`);
      Alert.alert('Could not save profile', 'Please deploy the latest Firestore rules, then try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const updatePreference = async (patch: Record<string, any>) => {
    if (!profile?.uid) return false;
    try {
      await updateDoc(doc(db, 'users', profile.uid), patch as any);
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`);
      Alert.alert('Setting not saved', 'Please deploy the latest Firestore rules, then try again.');
      return false;
    }
  };

  const preferenceValue = (field: PreferenceField, fallback: boolean) => {
    if (Object.prototype.hasOwnProperty.call(preferenceOverrides, field)) {
      return !!preferenceOverrides[field];
    }
    return !!fallback;
  };

  const setPreference = async (field: PreferenceField, value: boolean) => {
    if (savingPreference) return;
    const previous = preferenceValue(field, !!(profile as any)?.[field]);
    setPreferenceOverrides((prev) => ({ ...prev, [field]: value }));
    setSavingPreference(field);
    const ok = await updatePreference({ [field]: value });
    if (!ok) {
      setPreferenceOverrides((prev) => ({ ...prev, [field]: previous }));
    }
    setSavingPreference(null);
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

    setStartupAnalyzing(true);
    const previousDiagnosticAt = getLastAIDiagnostic()?.timestamp || 0;
    try {
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

  const currentSkills = isEditing
    ? (typeof editData?.skills === 'string' ? editData.skills.split(',').map((s: string) => s.trim()).filter((s: string) => s !== '') : [])
    : (Array.isArray(profile.skills) ? profile.skills : []);

  const industries = (isEditing
    ? (typeof editData?.industries === 'string'
        ? editData.industries.split(',').map((s: string) => s.trim()).filter(Boolean)
        : (Array.isArray(editData?.industries) ? editData.industries : []))
    : (Array.isArray((profile as any).industries) ? (profile as any).industries : [])) as string[];

  const lookingFor = (isEditing
    ? (typeof editData?.lookingFor === 'string'
        ? editData.lookingFor.split(',').map((s: string) => s.trim()).filter(Boolean)
        : (Array.isArray(editData?.lookingFor) ? editData.lookingFor : []))
    : (Array.isArray((profile as any).lookingFor) ? (profile as any).lookingFor : [])) as string[];
  const projects = Array.isArray((profile as any).projects) ? (profile as any).projects : [];
  const stealthModeValue = isEditing
    ? !!(editData?.isStealthMode ?? false)
    : preferenceValue('isStealthMode', !!profile.isStealthMode);
  const publicDiscoveryValue = isEditing
    ? !!(editData?.isVisible ?? true)
    : preferenceValue('isVisible', profile.isVisible !== false);
  const turboConnectValue = isEditing
    ? !!(editData?.turboConnect ?? false)
    : preferenceValue('turboConnect', !!(profile as any).turboConnect);
  const hideOnlineStatusValue = isEditing
    ? !!(editData?.hideOnlineStatus ?? false)
    : preferenceValue('hideOnlineStatus', !!(profile as any).hideOnlineStatus);
  const editFieldStyle = {
    backgroundColor: isDark ? '#16161A' : '#F8F8F8',
    borderColor: isDark ? '#222226' : '#E5E7EB',
  };
  const heroProfilePic = (isEditing ? editData?.profilePic : profile.profilePic) || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400';
  const openFullPhoto = (uri: string) => {
    blurActiveElementOnWeb();
    setFullPhotoUri(uri);
  };
  const closeFullPhoto = () => {
    blurActiveElementOnWeb();
    setFullPhotoUri('');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshProfile}
            tintColor="#FBE618"
            colors={['#FBE618']}
          />
        }
      >
        
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goBackOrHome} style={styles.iconButton}>
            <SafeIcon name="ChevronLeft" size={20} color={isDark ? '#FFF' : '#000'} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: isDark ? '#FFF' : '#000' }]}>
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
                <ActivityIndicator size="small" color="#FBE618" />
              ) : (
                <SafeIcon name="RefreshCw" size={18} color={isDark ? '#CCC' : '#444'} />
              )}
            </TouchableOpacity>
            {!isViewingOther ? (
              <TouchableOpacity
                onPress={isEditing ? handleSave : startEditing}
                style={[styles.iconButton, isEditing && styles.saveProfileButton]}
                activeOpacity={0.85}
              >
                {isSaving ? <ActivityIndicator size="small" color={isEditing ? '#000' : '#444'} /> : isEditing ? (
                  <View style={styles.saveProfileContent}>
                    <SafeIcon name="CheckCircle2" size={17} color="#000" fill="#00000010" />
                    <Text style={styles.saveProfileText}>SAVE</Text>
                  </View>
                ) : (
                  <SafeIcon name="PenLine" size={20} color={isDark ? '#CCC' : '#444'} />
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* PROFILE HERO */}
        <View style={styles.heroSection}>
          <View style={styles.avatarContainer}>
            <TouchableOpacity activeOpacity={0.9} onPress={() => openFullPhoto(heroProfilePic)}>
              <Image
                source={{ uri: heroProfilePic }}
                style={styles.avatar}
              />
            </TouchableOpacity>
            {!isViewingOther && (
              <TouchableOpacity style={styles.cameraOverlay} onPress={pickProfilePic}>
                <SafeIcon name="Camera" size={20} color="#000" />
              </TouchableOpacity>
            )}
            <View style={styles.reputationFloating}>
              <SafeIcon name="Zap" size={10} color="#000" fill="#000" />
              <Text style={styles.reputationVal}>{founderScore} SCORE</Text>
            </View>
          </View>

          {!isViewingOther && (
            <View style={{ marginTop: 18 }}>
              <Text style={[styles.sectionHeader, { color: isDark ? '#FFF' : '#000' }]}>PHOTOS</Text>
              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 10 }}>
                {[0, 1, 2].map((idx) => {
                  const photos = (isEditing ? (editData?.photos || []) : ((profile as any).photos || [])) as string[];
                  const uri = photos[idx];
                  return (
                    <TouchableOpacity
                      key={idx}
                      activeOpacity={0.85}
                      onPress={() => (isEditing ? pickGalleryPhoto(idx) : startEditing())}
                      style={[styles.photoSlot, { borderColor: isDark ? '#222226' : '#EEEEEE', backgroundColor: isDark ? '#111115' : '#F8F8F8' }]}
                    >
                      {uri ? (
                        <Image source={{ uri }} style={styles.photoSlotImg} />
                      ) : (
                        <SafeIcon name="Plus" size={18} color={isDark ? '#CCC' : '#444'} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ marginTop: 8, fontSize: 10, color: '#666', fontWeight: '900', textAlign: 'center' }}>
                {isEditing ? 'Tap a slot to change it' : 'Tap to edit your 3 swipe photos'}
              </Text>
            </View>
          )}

          {isEditing ? (
            <View style={styles.editForm}>
              <TextInput 
                style={[styles.nameInput, styles.editTextBox, editFieldStyle, { color: isDark ? '#FFF' : '#000' }]}
                value={toTextValue(editData?.displayName)}
                onChangeText={(t: string) => setEditData({...editData, displayName: t})}
                placeholder="Full Name"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: isDark ? '#FFF' : '#000' }]}
                value={editData?.username ? `@${toTextValue(editData.username)}` : ''}
                onChangeText={(t: string) => setEditData({ ...editData, username: cleanUsername(t) })}
                placeholder="@username"
                placeholderTextColor="#666"
                autoCapitalize="none"
              />
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: isDark ? '#FFF' : '#000' }]}
                value={toTextValue(editData?.occupation)}
                onChangeText={(t: string) => setEditData({ ...editData, occupation: t })}
                placeholder="Occupation (e.g. Founder, AI Engineer)"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: isDark ? '#FFF' : '#000' }]}
                value={toTextValue(editData?.company)}
                onChangeText={(t: string) => setEditData({ ...editData, company: t })}
                placeholder="Company / Startup (optional)"
                placeholderTextColor="#666"
              />
              <TextInput 
                style={[styles.locationInput, styles.editTextBox, editFieldStyle, { color: '#FBE618' }]}
                value={toTextValue(editData?.city)}
                onChangeText={(t: string) => setEditData({...editData, city: t})}
                placeholder="City, Country"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: isDark ? '#FFF' : '#000' }]}
                value={toTextValue(editData?.availability)}
                onChangeText={(t: string) => setEditData({ ...editData, availability: t })}
                placeholder="Availability (e.g. Open, Weekends)"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: isDark ? '#FFF' : '#000' }]}
                value={toTextValue(editData?.startupStage)}
                onChangeText={(t: string) => setEditData({ ...editData, startupStage: t })}
                placeholder="Startup Stage (Idea, MVP, Revenue...)"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: isDark ? '#FFF' : '#000' }]}
                value={toTextValue(editData?.fundingStage)}
                onChangeText={(t: string) => setEditData({ ...editData, fundingStage: t })}
                placeholder="Funding (Bootstrapped, Raised, Pre-revenue...)"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: isDark ? '#FFF' : '#000' }]}
                value={toTextValue(editData?.lookingFor)}
                onChangeText={(t: string) => setEditData({ ...editData, lookingFor: t })}
                placeholder="Looking For (comma-separated)"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, editFieldStyle, { color: isDark ? '#FFF' : '#000' }]}
                value={toTextValue(editData?.industries)}
                onChangeText={(t: string) => setEditData({ ...editData, industries: t })}
                placeholder="Industries (comma-separated)"
                placeholderTextColor="#666"
              />
              <View style={[styles.projectEditCard, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#E5E7EB' }]}>
                <Text style={styles.projectEditLabel}>ONGOING PROJECT</Text>
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: isDark ? '#FFF' : '#000', marginTop: 10 }]}
                  value={toTextValue(editData?.projectTitle)}
                  onChangeText={(t: string) => setEditData({ ...editData, projectTitle: t })}
                  placeholder="Project title (e.g. AI founder marketplace)"
                  placeholderTextColor="#666"
                />
                <TextInput
                  multiline
                  style={[styles.bioInput, editFieldStyle, { color: isDark ? '#FFF' : '#000', marginTop: 10 }]}
                  value={toTextValue(editData?.projectDescription)}
                  onChangeText={(t: string) => setEditData({ ...editData, projectDescription: t })}
                  placeholder="What are you building, and who should LINKUP recommend it to?"
                  placeholderTextColor="#666"
                />
                <TextInput
                  style={[styles.metaInput, editFieldStyle, { color: isDark ? '#FFF' : '#000', marginTop: 10 }]}
                  value={toTextValue(editData?.projectStatus)}
                  onChangeText={(t: string) => setEditData({ ...editData, projectStatus: t })}
                  placeholder="Stage: idea, mvp, live"
                  placeholderTextColor="#666"
                />
                <Text style={styles.projectEditHelp}>
                  LINKUP recommends this project to people with matching skills, interests, roles, and goals.
                </Text>
              </View>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                <Text style={[styles.nameText, { color: isDark ? '#FFF' : '#000' }]}>{profile.displayName || 'Builder'}</Text>
                {profile.isVerified && (
                  <SafeIcon name="BadgeCheck" size={24} color="#FBE618" fill="#FBE618" />
                )}
              </View>
              <Text style={styles.handleText}>
                @{cleanUsername((profile as any).username || profile.displayName || 'builder')}
              </Text>
              <Text style={styles.roleTextLine} numberOfLines={1}>
                {[(profile as any).occupation, (profile as any).company ? `@ ${(profile as any).company}` : null].filter(Boolean).join(' ') || 'Builder'}
              </Text>
              <Text style={styles.locationText}>
                {[profile.city, profile.country].filter(Boolean).join(', ') || 'Remote'}
              </Text>

              {!isViewingOther && !!profileLink && (
                <TouchableOpacity
                  style={[styles.profileLinkCard, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE' }]}
                  onPress={shareProfileLink}
                  activeOpacity={0.85}
                >
                  <SafeIcon name="Link" size={18} color="#2563EB" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.profileLinkLabel}>YOUR LINKUP LINK</Text>
                    <Text style={[styles.profileLinkText, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
                      {profileLink}
                    </Text>
                  </View>
                  <Text style={styles.profileLinkAction}>SHARE</Text>
                </TouchableOpacity>
              )}
              
              {isViewingOther && (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                  <TouchableOpacity 
                    style={[styles.actionButton, { flex: 1, backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderWidth: 1, borderColor: '#2563EB' }]}
                    onPress={openChat}
                  >
                    <Text style={{ color: '#2563EB', fontWeight: 'bold' }}>Message</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: isProfileSaved ? '#111827' : '#FBE618', borderWidth: 1, borderColor: '#FBE618' }]}
                    onPress={toggleSavedProfile}
                    disabled={isSaving}
                  >
                    <Text style={{ color: isProfileSaved ? '#FBE618' : '#000', fontWeight: 'bold' }}>
                      {isProfileSaved ? 'Saved' : 'Save'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        {/* AI COMPATIBILITY */}
        {isViewingOther && compatibility !== null && (
          <View style={[styles.section, { marginTop: -8 }]}>
            <Text style={styles.sectionLabel}>AI COMPATIBILITY</Text>
            <View style={[styles.compatCard, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={[styles.compatPct, { color: isDark ? '#FFF' : '#000' }]}>{compatibility}%</Text>
                  <Text style={styles.compatSub}>Compatibility</Text>
                </View>
                <View style={styles.compatTagPill}>
                  <Text style={styles.compatTagText}>{(profile as any).workStyle || 'Execution-focused'}</Text>
                </View>
              </View>
              <Text style={[styles.compatHint, { color: isDark ? '#AAA' : '#444' }]}>
                {compatibilityReason || `Best match for: ${[(profile as any).occupation || 'Builders', industries[0] ? `${industries[0]} teams` : null, (profile as any).commitmentLevel ? `${(profile as any).commitmentLevel} builders` : null].filter(Boolean).slice(0, 3).join(' � ')}`}
              </Text>
            </View>
          </View>
        )}

        {/* LOOKING FOR */}
        {!!lookingFor.length && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>LOOKING FOR</Text>
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
          <Text style={styles.sectionLabel}>STARTUP STATUS</Text>
          <View style={styles.statusGrid}>
            <View style={[styles.statusTile, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
              <Text style={styles.statusLabel}>STAGE</Text>
              <Text style={[styles.statusValue, { color: isDark ? '#FFF' : '#000' }]}>{(profile as any).startupStage || '—'}</Text>
            </View>
            <View style={[styles.statusTile, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
              <Text style={styles.statusLabel}>FUNDING</Text>
              <Text style={[styles.statusValue, { color: isDark ? '#FFF' : '#000' }]}>{(profile as any).fundingStage || '—'}</Text>
            </View>
            <View style={[styles.statusTile, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
              <Text style={styles.statusLabel}>AVAILABILITY</Text>
              <Text style={[styles.statusValue, { color: isDark ? '#FFF' : '#000' }]}>{(profile as any).availability || 'Open'}</Text>
            </View>
            <View style={[styles.statusTile, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
              <Text style={styles.statusLabel}>INTENT</Text>
              <Text style={[styles.statusValue, { color: isDark ? '#FFF' : '#000' }]}>{(profile as any).networkingIntent || 'Builder'}</Text>
            </View>
          </View>
        </View>

        {!!projects.length && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ONGOING PROJECTS</Text>
            {projects.slice(0, 3).map((project: any, index: number) => (
              <View
                key={project?.id || `${profile.uid}-project-${index}`}
                style={[styles.projectCard, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE' }]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                  <Text style={[styles.projectTitle, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
                    {project?.title || 'Untitled project'}
                  </Text>
                  <View style={styles.projectStagePill}>
                    <Text style={styles.projectStageText}>{String(project?.status || 'mvp').toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.projectDescription}>
                  {project?.description || 'Ongoing project looking for relevant collaborators.'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* INDUSTRY INTERESTS */}
        {!!industries.length && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>INDUSTRY INTERESTS</Text>
            <View style={styles.chipsRow}>
              {industries.slice(0, 12).map((v, idx) => (
                <View key={idx} style={[styles.chip, { borderColor: '#FBE61830', backgroundColor: '#FBE61810' }]}>
                  <Text style={[styles.chipText, { color: '#FBE618' }]}>{String(v).toUpperCase()}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* FOUNDER REPUTATION */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>FOUNDER REPUTATION</Text>
          <View style={[styles.repCard, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
            {[
              ['Reliability', earnedRep.reliability],
              ['Response Rate', earnedRep.responseRate],
              ['Collaboration', earnedRep.collaboration],
              ['Consistency', earnedRep.consistency],
              ['Completion', earnedRep.completion],
            ].map(([label, val]: any) => (
              <View key={label} style={styles.repRow}>
                <Text style={styles.repLabel}>{String(label).toUpperCase()}</Text>
                <View style={styles.repBar}>
                  <View style={[styles.repFill, { width: `${Math.max(0, Math.min(100, Number(val)))}%` }]} />
                </View>
                <Text style={styles.repNum}>{Math.max(0, Math.min(100, Number(val)))}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.repHelp}>
            Earned from profile quality, skills, projects, verification, consistency, and activity.
          </Text>
        </View>

        {/* MATCH INSIGHTS */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>MATCH INSIGHTS (AI)</Text>
          <View style={[styles.insightCard, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
            <Text style={[styles.insightText, { color: isDark ? '#DDD' : '#333' }]}>
              {(profile as any).aiMatchInsights || 'Generate an AI insight for this profile.'}
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
              style={[styles.bioInput, editFieldStyle, { color: isDark ? '#FFF' : '#000' }]}
              value={toTextValue(editData?.vibeMedia)}
              onChangeText={(t: string) => setEditData({...editData, vibeMedia: t})}
              placeholder="Paste a link to your 15s audio/video intro..."
              placeholderTextColor="#444"
            />
          ) : (
            <TouchableOpacity 
              style={[styles.vibeCard, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}
              onPress={() => {
                if (profile.vibeMedia) {
                  Linking.openURL(profile.vibeMedia).catch(err => Alert.alert("Invalid Link", "Could not open vibe intro link."));
                } else {
                  Alert.alert("No Vibe", "This user hasn't set a vibe intro yet.");
                }
              }}
            >
              <SafeIcon name="Mic" size={20} color="#FBE618" />
              <Text style={[styles.vibeText, { color: isDark ? '#AAA' : '#444' }]}>
                {profile.vibeMedia ? "PLAY VIBE INTRO" : "NO VIBE INTRO SET"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* BIO SECTION */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>IDENTITY</Text>
          {isEditing ? (
            <TextInput
              multiline
              style={[styles.bioInput, editFieldStyle, { color: isDark ? '#FFF' : '#000' }]}
              value={toTextValue(editData?.bio)}
              onChangeText={(t: string) => setEditData({...editData, bio: t})}
              placeholder="Tell your story..."
              placeholderTextColor="#444"
            />
          ) : (
            <Text style={[styles.bioText, { color: isDark ? '#AAA' : '#444' }]}>
              "{profile.bio || 'No bio provided yet. Complete your identity to stand out.'}"
            </Text>
          )}
        </View>

        {/* SKILLS SECTION */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SKILLS & STACK</Text>
          <View style={styles.badgesGrid}>
            {currentSkills.map((skill: string, i: number) => (
              <Badge key={i} name={skill.toUpperCase()} iconName="Rocket" />
            ))}
          </View>
          {isEditing && (
            <TextInput 
              style={[styles.skillsInput, editFieldStyle, { color: isDark ? '#FFF' : '#000' }]}
              value={toTextValue(editData?.skills)}
              onChangeText={(t: string) => setEditData({...editData, skills: t})}
              placeholder="React, Node, AI..."
              placeholderTextColor="#444"
            />
          )}
        </View>

        {/* ANALYTICS */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ANALYTICS (PRO)</Text>
          <TouchableOpacity 
            style={[styles.prefRow, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}
            onPress={() => navigation.navigate('Viewers')}
          >
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="Eye" size={18} color="#FBE618" />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: isDark ? '#FFF' : '#000' }]}>Who viewed your profile</Text>
                <Text style={styles.prefHelp}>Shows recent people who opened your profile from swipe, search, or alerts.</Text>
              </View>
            </View>
            <Text style={styles.viewerCount}>{visibleProfileViewCount}</Text>
          </TouchableOpacity>
        </View>

        {!isViewingOther && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>STARTUP ANALYZER</Text>
            <View style={[styles.analyzerCard, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
              <Text style={[styles.analyzerTitle, { color: isDark ? '#FFF' : '#000' }]}>Test your startup idea</Text>
              <Text style={styles.analyzerHelp}>
                Get a fast AI score for market, competition, monetization, risks, and your next validation move.
              </Text>
              <TextInput
                multiline
                value={startupIdeaText}
                onChangeText={setStartupIdeaText}
                placeholder="Example: An AI assistant that helps student founders find technical cofounders in Africa..."
                placeholderTextColor="#666"
                style={[styles.analyzerInput, { color: isDark ? '#FFF' : '#000', backgroundColor: isDark ? '#0F0F12' : '#FFFFFF', borderColor: isDark ? '#222226' : '#E5E7EB' }]}
              />
              <TouchableOpacity
                disabled={startupAnalyzing}
                onPress={runStartupAnalyzer}
                style={[styles.analyzerButton, { opacity: startupAnalyzing ? 0.6 : 1 }]}
              >
                {startupAnalyzing ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.analyzerButtonText}>ANALYZE IDEA</Text>}
              </TouchableOpacity>

              {!!startupAnalysis && (
                <View style={styles.analysisResults}>
                  <View style={styles.analysisScoreRow}>
                    <Text style={styles.analysisScore}>{startupAnalysis.score ?? '--'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.analysisVerdict, { color: isDark ? '#FFF' : '#000' }]}>
                        {startupAnalysis.verdict || 'Startup snapshot'}
                      </Text>
                      <Text style={styles.analysisSmall}>Overall score / 100</Text>
                    </View>
                  </View>
                  {!!startupAnalysis.aiDiagnostic && (
                    <View style={styles.analysisDiagnostic}>
                      <Text style={styles.analysisDiagnosticText}>AI FALLBACK: {startupAnalysis.aiDiagnostic}</Text>
                    </View>
                  )}
                  {[
                    ['Market', startupAnalysis.marketPotential],
                    ['Customer', startupAnalysis.targetCustomer],
                    ['Competition', startupAnalysis.competition],
                    ['Monetization', startupAnalysis.monetization],
                    ['Risks', Array.isArray(startupAnalysis.keyRisks) ? startupAnalysis.keyRisks.join(' • ') : startupAnalysis.keyRisks],
                    ['Next Step', startupAnalysis.nextValidationStep],
                  ].filter(([, value]) => !!value).map(([label, value]) => (
                    <View key={label} style={styles.analysisItem}>
                      <Text style={styles.analysisLabel}>{label.toUpperCase()}</Text>
                      <Text style={[styles.analysisText, { color: isDark ? '#DDD' : '#333' }]}>{String(value)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}
        {/* SETTINGS - only shown on own profile */}
        {!isViewingOther && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SETTINGS & PREFERENCES</Text>
          <View style={[styles.prefRow, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="Ghost" size={18} color="#666" />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: isDark ? '#FFF' : '#000' }]}>Stealth Mode</Text>
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

          <View style={[styles.prefRow, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', marginTop: 12 }]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="Globe2" size={18} color="#2563EB" />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: isDark ? '#FFF' : '#000' }]}>Public Discovery</Text>
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

          <View style={[styles.prefRow, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', marginTop: 12 }]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="Rocket" size={18} color="#FBE618" />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: isDark ? '#FFF' : '#000' }]}>Turbo Connect</Text>
                <Text style={styles.prefHelp}>Boosts your profile priority in discovery and search ranking when public discovery is on.</Text>
              </View>
            </View>
            <PreferenceSwitch
              value={turboConnectValue}
              isDark={isDark}
              disabled={savingPreference === 'turboConnect'}
              onValueChange={(v) => isEditing ? setEditData({ ...editData, turboConnect: v }) : setPreference('turboConnect', v)}
            />
          </View>

          <View style={[styles.prefRow, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', marginTop: 12 }]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name={isDark ? "Moon" : "Sun"} size={18} color="#666" />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: isDark ? '#FFF' : '#000' }]}>Dark Mode</Text>
                <Text style={styles.prefHelp}>Switches LINKUP between clean light mode and premium dark mode.</Text>
              </View>
            </View>
            <PreferenceSwitch value={isDark} isDark={isDark} onValueChange={toggleTheme} />
          </View>

          <View style={[styles.prefRow, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', marginTop: 12 }]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="EyeOff" size={18} color="#22C55E" />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: isDark ? '#FFF' : '#000' }]}>Hide Online Status</Text>
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

          <View style={[styles.accountSecurityCard, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
            <View style={styles.accountSecurityHeader}>
              <SafeIcon name="MailCheck" size={19} color="#2563EB" />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: isDark ? '#FFF' : '#000' }]}>Email Security</Text>
                <Text style={styles.prefHelp}>
                  Verification, password reset, email change, and MFA notifications for this account.
                </Text>
              </View>
            </View>

            <View style={[styles.emailStatusPill, { backgroundColor: isDark ? '#0F0F12' : '#FFFFFF' }]}>
              <Text style={styles.emailStatusLabel}>CURRENT EMAIL</Text>
              <Text style={[styles.emailStatusValue, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
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
                  <Text style={styles.accountActionText}>VERIFY EMAIL</Text>
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
                  <Text style={styles.accountActionText}>RESET PASSWORD</Text>
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
                  color: isDark ? '#FFF' : '#000',
                  backgroundColor: isDark ? '#0F0F12' : '#FFFFFF',
                  borderColor: isDark ? '#26262C' : '#E5E7EB',
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
                <Text style={styles.emailChangeText}>SEND EMAIL CHANGE CONFIRMATION</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              disabled={!!accountActionBusy}
              onPress={() => runAccountAction('mfa-notice', showMfaEnrollmentNotice)}
              style={[styles.mfaNoticeBtn, { borderColor: isDark ? '#26262C' : '#E5E7EB' }]}
            >
              <SafeIcon name="ShieldCheck" size={16} color="#22C55E" />
              <Text style={[styles.mfaNoticeText, { color: isDark ? '#FFF' : '#000' }]}>MULTI-FACTOR ENROLLMENT NOTICE</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.prefRow, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', marginTop: 12 }]} onPress={handleLogout}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="LogOut" size={18} color="#EF4444" />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: '#EF4444' }]}>Logout</Text>
                <Text style={styles.prefHelp}>Signs you out of this device. Your profile and chats stay saved.</Text>
              </View>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.prefRow, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', marginTop: 12 }]} onPress={handleDeleteAccount}>
            <View style={styles.prefLabelContainer}>
                <SafeIcon name="Trash2" size={18} color="#FF4444" />
              <View style={styles.prefCopy}>
                <Text style={[styles.prefLabel, { color: '#FF4444' }]}>Delete Account Permanently</Text>
                <Text style={styles.prefHelp}>Deletes your profile document and Firebase Auth account. You may need to sign in again first.</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
        )}

        {isEditing && (
          <TouchableOpacity style={styles.cancelButton} onPress={() => setIsEditing(false)}>
            <Text style={styles.cancelText}>DISCARD CHANGES</Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
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
    letterSpacing: 2,
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
    backgroundColor: '#FBE61815',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FBE61830',
  },
  saveProfileButton: {
    width: 82,
    backgroundColor: '#FBE618',
    borderColor: '#FBE618',
    shadowColor: '#FBE618',
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
    letterSpacing: 1.2,
    color: '#000',
  },
  actionButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FBE618',
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  photoSlot: {
    width: 82,
    height: 82,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoSlotImg: {
    width: '100%',
    height: '100%',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 20,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#FBE618',
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
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullPhotoImage: {
    width: '100%',
    height: '82%',
    borderRadius: 22,
  },
  cameraOverlay: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 42,
    height: 42,
    backgroundColor: 'rgba(251, 230, 24, 0.4)',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FBE618',
  },
  reputationFloating: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#FBE618',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 5,
  },
  reputationVal: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
  },
  nameText: {
    fontSize: 28,
    fontWeight: '900',
    fontStyle: 'italic',
    textTransform: 'uppercase',
  },
  handleText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#666',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  roleTextLine: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FBE618',
    letterSpacing: 1,
    marginTop: 6,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  locationText: {
    fontSize: 12,
    color: '#FBE618',
    fontWeight: '900',
    marginTop: 4,
  },
  editForm: {
    alignItems: 'center',
    width: '100%',
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
    textAlign: 'center',
    marginTop: 4,
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
    marginBottom: 32,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: '#666',
    letterSpacing: 2,
    marginBottom: 16,
  },
  vibeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 20,
  },
  vibeText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  bioText: {
    fontSize: 15,
    lineHeight: 22,
    fontStyle: 'italic',
    fontWeight: '500',
  },
  bioInput: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 100,
    textAlignVertical: 'top',
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
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  compatCard: {
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FBE61830',
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
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  compatTagPill: {
    backgroundColor: '#FBE618',
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
    borderColor: '#222226',
    backgroundColor: '#16161A',
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
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: '#22222610',
  },
  statusLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
    color: '#666',
    textTransform: 'uppercase',
  },
  statusValue: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  repCard: {
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#22222610',
    gap: 10,
  },
  repRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  repLabel: {
    width: 110,
    fontSize: 9,
    fontWeight: '900',
    color: '#666',
    letterSpacing: 1,
  },
  repBar: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#0A0A0C',
    overflow: 'hidden',
  },
  repFill: {
    height: '100%',
    backgroundColor: '#FBE618',
  },
  repNum: {
    width: 28,
    textAlign: 'right',
    fontSize: 10,
    fontWeight: '900',
    color: '#FBE618',
  },
  insightCard: {
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#22222610',
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
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
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
    borderRadius: 18,
    backgroundColor: '#F8F8F810',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#22222610',
  },
  prefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
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
  accountSecurityCard: {
    marginTop: 12,
    padding: 16,
    borderRadius: 22,
  },
  accountSecurityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emailStatusPill: {
    marginTop: 14,
    padding: 12,
    borderRadius: 16,
  },
  emailStatusLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.4,
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
    letterSpacing: 1.2,
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
    backgroundColor: '#FBE618',
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
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  emailChangeText: {
    color: '#FFF',
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
    color: '#FBE618',
  },
  analyzerCard: {
    borderRadius: 22,
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
    borderRadius: 18,
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
    backgroundColor: '#FBE618',
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
    borderRadius: 20,
    backgroundColor: '#FBE618',
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
    borderColor: '#FBE618',
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
    letterSpacing: 1.5,
    color: '#2563EB',
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
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileLinkLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
    color: '#666',
  },
  profileLinkText: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '800',
  },
  profileLinkAction: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#2563EB',
  },
  repHelp: {
    marginTop: 10,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '800',
    color: '#777',
    textAlign: 'center',
  },
  projectEditCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 12,
    marginTop: 4,
  },
  projectEditLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
    color: '#2563EB',
  },
  projectEditHelp: {
    marginTop: 8,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 15,
    color: '#777',
  },
  projectCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    marginTop: 10,
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
    backgroundColor: '#FBE618',
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
    letterSpacing: 1.5,
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
