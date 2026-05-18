import React, { useMemo, useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Image, 
  TouchableOpacity, 
  SafeAreaView, 
  ScrollView, 
  Switch, 
  TextInput, 
  ActivityIndicator, 
  Dimensions,
  Alert,
  Linking
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import * as Icons from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, updateDoc, getDoc, getDocs, query, where, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { geminiProfileInsights } from '../lib/gemini';
import { uploadImageToStorage } from '../lib/mediaUpload';

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

export default function ProfileScreen({ navigation, route }: any) {
  const { user, profile: myProfile, signUpWithEmail, signInWithEmail, logout, deleteAccount } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  const [viewedProfile, setViewedProfile] = useState<any>(null);
  const [viewedLoading, setViewedLoading] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');

  // If a userId param is passed and it's not the current user, fetch that profile
  const targetUserId = route?.params?.userId;
  const isViewingOther = targetUserId && targetUserId !== myProfile?.uid;
  const profile = isViewingOther ? viewedProfile : myProfile;

  useEffect(() => {
    if (!isViewingOther) return;
    setViewedLoading(true);
    getDoc(doc(db, 'users', targetUserId)).then(snap => {
      if (snap.exists()) setViewedProfile({ ...snap.data(), uid: snap.id });
      setViewedLoading(false);
    }).catch((err) => {
      console.error("Error fetching viewed profile:", err);
      setViewedLoading(false);
    });
  }, [targetUserId]);

  // NOTE: do not early-return before hooks below (Rules of Hooks).
  const isBusy = !profile || viewedLoading;
  const safeProfile: any = profile || { uid: targetUserId || myProfile?.uid || '', displayName: 'Builder', skills: [] };

  const founderScore = useMemo(() => {
    const base = typeof (safeProfile as any).founderScore === 'number' ? (safeProfile as any).founderScore : undefined;
    if (typeof base === 'number') return Math.max(0, Math.min(100, Math.round(base)));
    const rep = typeof (safeProfile as any).reputationScore === 'number' ? (safeProfile as any).reputationScore : 0;
    const streak = typeof (safeProfile as any).streakCount === 'number' ? (safeProfile as any).streakCount : 0;
    const score = 40 + Math.min(40, Math.round(rep / 25)) + Math.min(20, streak);
    return Math.max(0, Math.min(100, score));
  }, [(safeProfile as any)?.founderScore, (safeProfile as any)?.reputationScore, (safeProfile as any)?.streakCount]);

  const compatibility = useMemo(() => {
    if (!myProfile || !isViewingOther || !profile) return null;
    const mySkills = Array.isArray(myProfile.skills) ? myProfile.skills : [];
    const theirSkills = Array.isArray(profile.skills) ? profile.skills : [];
    const shared = mySkills.filter((s) =>
      theirSkills.map((t: any) => String(t).toLowerCase()).includes(String(s).toLowerCase())
    ).length;
    const skillScore = mySkills.length ? Math.min(1, shared / Math.max(3, Math.min(6, mySkills.length))) : 0;
    const myIndustries = Array.isArray((myProfile as any).industries) ? (myProfile as any).industries : [];
    const theirIndustries = Array.isArray((profile as any).industries) ? (profile as any).industries : [];
    const sharedInd = myIndustries.filter((s: string) =>
      theirIndustries.map((t: string) => String(t).toLowerCase()).includes(String(s).toLowerCase())
    ).length;
    const indScore = myIndustries.length ? Math.min(1, sharedInd / Math.max(1, myIndustries.length)) : 0;
    const commitmentScore =
      myProfile.commitmentLevel && (profile as any).commitmentLevel && myProfile.commitmentLevel === (profile as any).commitmentLevel ? 1 : 0.4;
    const ambitionScore =
      (myProfile as any).ambition && (profile as any).ambition && (myProfile as any).ambition === (profile as any).ambition ? 1 : 0.4;
    const total = skillScore * 0.55 + indScore * 0.20 + commitmentScore * 0.15 + ambitionScore * 0.10;
    return Math.round(Math.max(0, Math.min(1, total)) * 100);
  }, [myProfile?.uid, (profile as any)?.uid, isViewingOther]);

  if (isBusy) {
    return (
      <View style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFF', justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color="#666" />
      </View>
    );
  }

  // From here onward, `profile` is guaranteed to exist.

  const startEditing = () => {
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
      hasExit: profile.hasExit || false,
      photos: Array.isArray((profile as any).photos) ? (profile as any).photos.slice(0, 3) : []
    });
    setIsEditing(true);
  };

  const generateInsights = async () => {
    setIsSaving(true);
    try {
      const insight = await geminiProfileInsights(profile);
      await updateDoc(doc(db, 'users', profile.uid), { aiMatchInsights: insight });
      if (isViewingOther) {
        setViewedProfile((p: any) => ({ ...p, aiMatchInsights: insight }));
      }
    } catch (e: any) {
      console.error('Insights error:', e);
      Alert.alert('AI Insights Error', e?.message || 'Could not generate insights.');
    } finally {
      setIsSaving(false);
    }
  };

  const pickGalleryPhoto = async (index: number) => {
    if (isViewingOther || !myProfile) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need access to your photos to update your pictures.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (result.canceled) return;
    const uri = result.assets?.[0]?.uri;
    if (!uri) return;

    setIsSaving(true);
    let downloadUrl = uri;
    try {
      downloadUrl = await uploadImageToStorage({
        uri,
        path: `userPhotos/${myProfile.uid}/proof_${index + 1}_${Date.now()}`,
      });
    } catch (e) {
      console.error('Photo upload error:', e);
      Alert.alert('Error', 'Failed to upload photo.');
      setIsSaving(false);
      return;
    }

    const current = Array.isArray(editData?.photos) ? [...editData.photos] : [];
    while (current.length < 3) current.push('');
    current[index] = downloadUrl;

    setEditData({ ...editData, photos: current.filter((p: string) => !!p).slice(0, 3) });
    try {
      await updateDoc(doc(db, 'users', myProfile.uid), { photos: current.filter((p) => !!p).slice(0, 3) });
    } catch (e) {
      Alert.alert('Error', 'Failed to update photos.');
    } finally {
      setIsSaving(false);
    }
  };

  const pickProfilePic = async () => {
    if (isViewingOther || !myProfile) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need access to your photos to update your profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (!result.canceled) {
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;
      setIsSaving(true);
      try {
        const url = await uploadImageToStorage({
          uri,
          path: `userPhotos/${myProfile.uid}/profile_${Date.now()}`,
        });
        await updateDoc(doc(db, 'users', myProfile.uid), {
          profilePic: url
        });
        
        if (isEditing) {
          setEditData({ ...editData, profilePic: url });
        }
      } catch (e) {
        Alert.alert("Error", "Failed to update profile picture.");
      } finally {
        setIsSaving(false);
      }
    }
  };

  const openChat = async () => {
    if (!myProfile || !targetUserId || !profile) return;
    setIsSaving(true);
    try {
      const q = query(collection(db, 'matches'), where('userIds', 'array-contains', myProfile.uid));
      const snap = await getDocs(q);
      const existing = snap.docs.find((d) => {
        const data = d.data() as any;
        const ids = Array.isArray(data.userIds) ? data.userIds : [];
        return ids.includes(targetUserId);
      });

      let matchId = existing?.id;
      if (!matchId) {
        const ref = await addDoc(collection(db, 'matches'), {
          userIds: [myProfile.uid, targetUserId],
          timestamp: serverTimestamp(),
          lastMessage: '',
          lastMessageTime: serverTimestamp(),
        });
        matchId = ref.id;
      }

      navigation.navigate('Chat', { matchId, otherUser: { ...profile, uid: targetUserId } });
    } catch (e) {
      console.error('openChat error:', e);
      Alert.alert('Error', 'Could not open chat. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEmailCreate = async () => {
    await signUpWithEmail(authEmail, authPassword);
    setAuthPassword('');
  };

  const handleEmailSignIn = async () => {
    await signInWithEmail(authEmail, authPassword);
    setAuthPassword('');
  };
  const handleSave = async () => {
    if (!editData) return;
    setIsSaving(true);
    try {
      const skillsArray = typeof editData.skills === 'string' 
        ? editData.skills.split(',').map((s: string) => s.trim()).filter((s: string) => s !== '')
        : (Array.isArray(editData.skills) ? editData.skills : []);

      await updateDoc(doc(db, 'users', profile.uid), {
        displayName: editData.displayName || '',
        username: editData.username || '',
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
        isStealthMode: editData.isStealthMode || false,
        hasExit: editData.hasExit || false,
        vibeMedia: editData.vibeMedia || '',
        photos: Array.isArray(editData.photos) ? editData.photos.filter((p: string) => !!p).slice(0, 3) : []
      });
      setIsEditing(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to exit the realm?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: async () => {
        try {
          await logout();
        } catch (e: any) {
          console.error(e);
        }
      }}
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "DELETE ACCOUNT", 
      "This is permanent. Your founder profile and all network data will be wiped from existence. Proceed?", 
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "DELETE EVERYTHING", 
          style: "destructive", 
          onPress: async () => {
            try {
              setIsSaving(true);
              await deleteAccount();
            } catch (e: any) {
              Alert.alert("Error", e.message || "Failed to delete account. You may need to re-authenticate first.");
            } finally {
              setIsSaving(false);
            }
          } 
        }
      ]
    );
  };

  const currentSkills = isEditing 
    ? (typeof editData.skills === 'string' ? editData.skills.split(',').map((s: string) => s.trim()).filter((s: string) => s !== '') : [])
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation?.goBack()} style={styles.iconButton}>
            <SafeIcon name="ChevronLeft" size={20} color={isDark ? '#FFF' : '#000'} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: isDark ? '#FFF' : '#000' }]}>
            {isViewingOther ? 'PROFILE' : 'MY PROFILE'}
          </Text>
          {!isViewingOther ? (
            <TouchableOpacity onPress={isEditing ? handleSave : startEditing} style={styles.iconButton}>
              {isSaving ? <ActivityIndicator size="small" color="#444" /> : (
                <SafeIcon name={isEditing ? "Save" : "Pen"} size={20} color={isDark ? '#CCC' : '#444'} />
              )}
            </TouchableOpacity>
          ) : <View style={styles.iconButton} />}
        </View>

        {/* PROFILE HERO */}
        <View style={styles.heroSection}>
          <View style={styles.avatarContainer}>
            <Image 
              source={{ uri: (isEditing ? editData?.profilePic : profile.profilePic) || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400' }} 
              style={styles.avatar} 
            />
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
                style={[styles.nameInput, { color: isDark ? '#FFF' : '#000' }]}
                value={editData?.displayName}
                onChangeText={(t: string) => setEditData({...editData, displayName: t})}
                placeholder="Full Name"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, { color: isDark ? '#FFF' : '#000' }]}
                value={editData?.username}
                onChangeText={(t: string) => setEditData({ ...editData, username: t })}
                placeholder="Username (e.g. tanaka)"
                placeholderTextColor="#666"
                autoCapitalize="none"
              />
              <TextInput
                style={[styles.metaInput, { color: isDark ? '#FFF' : '#000' }]}
                value={editData?.occupation}
                onChangeText={(t: string) => setEditData({ ...editData, occupation: t })}
                placeholder="Occupation (e.g. Founder, AI Engineer)"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, { color: isDark ? '#FFF' : '#000' }]}
                value={editData?.company}
                onChangeText={(t: string) => setEditData({ ...editData, company: t })}
                placeholder="Company / Startup (optional)"
                placeholderTextColor="#666"
              />
              <TextInput 
                style={[styles.locationInput, { color: '#FBE618' }]}
                value={editData?.city}
                onChangeText={(t: string) => setEditData({...editData, city: t})}
                placeholder="City, Country"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, { color: isDark ? '#FFF' : '#000' }]}
                value={editData?.availability}
                onChangeText={(t: string) => setEditData({ ...editData, availability: t })}
                placeholder="Availability (e.g. Open, Weekends)"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, { color: isDark ? '#FFF' : '#000' }]}
                value={editData?.startupStage}
                onChangeText={(t: string) => setEditData({ ...editData, startupStage: t })}
                placeholder="Startup Stage (Idea, MVP, Revenue...)"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, { color: isDark ? '#FFF' : '#000' }]}
                value={editData?.fundingStage}
                onChangeText={(t: string) => setEditData({ ...editData, fundingStage: t })}
                placeholder="Funding (Bootstrapped, Raised, Pre-revenue...)"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, { color: isDark ? '#FFF' : '#000' }]}
                value={editData?.lookingFor}
                onChangeText={(t: string) => setEditData({ ...editData, lookingFor: t })}
                placeholder="Looking For (comma-separated)"
                placeholderTextColor="#666"
              />
              <TextInput
                style={[styles.metaInput, { color: isDark ? '#FFF' : '#000' }]}
                value={editData?.industries}
                onChangeText={(t: string) => setEditData({ ...editData, industries: t })}
                placeholder="Industries (comma-separated)"
                placeholderTextColor="#666"
              />
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
                @{(profile as any).username || (profile.displayName || 'builder').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14)}
              </Text>
              <Text style={styles.roleTextLine} numberOfLines={1}>
                {[(profile as any).occupation, (profile as any).company ? `@ ${(profile as any).company}` : null].filter(Boolean).join(' ') || 'Builder'}
              </Text>
              <Text style={styles.locationText}>
                {[profile.city, profile.country].filter(Boolean).join(', ') || 'Remote'}
              </Text>
              
              {isViewingOther && (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                  <TouchableOpacity 
                    style={[styles.actionButton, { flex: 1, backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderWidth: 1, borderColor: '#2563EB' }]}
                    onPress={openChat}
                  >
                    <Text style={{ color: '#2563EB', fontWeight: 'bold' }}>Message</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#FBE618', borderWidth: 1, borderColor: '#FBE618' }]}
                    onPress={() => Alert.alert('Saved', 'Profile saved.')}
                  >
                    <Text style={{ color: '#000', fontWeight: 'bold' }}>Save</Text>
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
                Best match for: {[(profile as any).occupation || 'Builders', industries[0] ? `${industries[0]} teams` : null, (profile as any).commitmentLevel ? `${(profile as any).commitmentLevel} builders` : null].filter(Boolean).slice(0, 3).join(' • ')}
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
              ['Reliability', (profile as any).reputationMetrics?.reliability ?? 70],
              ['Response Rate', (profile as any).reputationMetrics?.responseRate ?? 70],
              ['Collaboration', (profile as any).reputationMetrics?.collaboration ?? 70],
              ['Consistency', (profile as any).reputationMetrics?.consistency ?? 60],
              ['Completion', (profile as any).reputationMetrics?.completion ?? 60],
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
              style={[styles.bioInput, { color: isDark ? '#FFF' : '#000', backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}
              value={editData?.vibeMedia}
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
              style={[styles.bioInput, { color: isDark ? '#FFF' : '#000', backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}
              value={editData?.bio}
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
              style={[styles.skillsInput, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', color: isDark ? '#FFF' : '#000' }]}
              value={editData?.skills}
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
              <Text style={[styles.prefLabel, { color: isDark ? '#FFF' : '#000' }]}>Who viewed your profile</Text>
            </View>
            <Text style={styles.viewerCount}>{profile.viewedBy?.length || 0}</Text>
          </TouchableOpacity>
        </View>
        {/* SETTINGS - only shown on own profile */}
        {!isViewingOther && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SETTINGS & PREFERENCES</Text>
          <View style={[styles.prefRow, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="Ghost" size={18} color="#666" />
              <Text style={[styles.prefLabel, { color: isDark ? '#FFF' : '#000' }]}>Stealth Mode</Text>
            </View>
            <Switch 
              value={isEditing ? editData.isStealthMode : profile.isStealthMode} 
              onValueChange={(v) => isEditing ? setEditData({...editData, isStealthMode: v}) : updateDoc(doc(db, 'users', profile.uid), { isStealthMode: v })} 
              trackColor={{ true: '#2563EB' }} 
              thumbColor="#FFF" 
            />
          </View>

          <View style={[styles.prefRow, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', marginTop: 12 }]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="Zap" size={18} color="#2563EB" />
              <Text style={[styles.prefLabel, { color: isDark ? '#FFF' : '#000' }]}>Show Online Status</Text>
            </View>
            <Switch 
              value={isEditing ? editData.isVisible : profile.isVisible} 
              onValueChange={(v) => isEditing ? setEditData({...editData, isVisible: v}) : updateDoc(doc(db, 'users', profile.uid), { isVisible: v })} 
              trackColor={{ true: '#2563EB' }} 
              thumbColor="#FFF" 
            />
          </View>
          
          <View style={[styles.prefRow, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', marginTop: 12 }]}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name={isDark ? "Moon" : "Sun"} size={18} color="#666" />
              <Text style={[styles.prefLabel, { color: isDark ? '#FFF' : '#000' }]}>Dark Mode</Text>
            </View>
            <Switch value={isDark} onValueChange={toggleTheme} trackColor={{ true: '#2563EB' }} thumbColor="#FFF" />
          </View>

          <View style={[styles.authBox, { backgroundColor: isDark ? '#111115' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
            <Text style={[styles.authTitle, { color: isDark ? '#FFF' : '#000' }]}>
              {user?.isAnonymous ? 'CREATE A TEST ACCOUNT (UPGRADE)' : 'ACCOUNT'}
            </Text>
            <Text style={styles.authHint}>
              Use email/password so you can test across devices. Anonymous accounts can be upgraded here.
            </Text>
            <TextInput
              value={authEmail}
              onChangeText={setAuthEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Email"
              placeholderTextColor="#666"
              style={[styles.authInput, { color: isDark ? '#FFF' : '#000', borderColor: isDark ? '#222226' : '#EAEAEA' }]}
            />
            <TextInput
              value={authPassword}
              onChangeText={setAuthPassword}
              secureTextEntry
              placeholder="Password"
              placeholderTextColor="#666"
              style={[styles.authInput, { color: isDark ? '#FFF' : '#000', borderColor: isDark ? '#222226' : '#EAEAEA' }]}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={handleEmailCreate}
                style={[styles.authBtn, { backgroundColor: '#FBE618' }]}
              >
                <Text style={[styles.authBtnText, { color: '#000' }]}>CREATE</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleEmailSignIn}
                style={[styles.authBtn, { backgroundColor: isDark ? '#16161A' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EAEAEA', borderWidth: 1 }]}
              >
                <Text style={[styles.authBtnText, { color: isDark ? '#FFF' : '#000' }]}>SIGN IN</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={[styles.prefRow, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', marginTop: 12 }]} onPress={handleLogout}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="LogOut" size={18} color="#EF4444" />
              <Text style={[styles.prefLabel, { color: '#EF4444' }]}>Logout</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.prefRow, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', marginTop: 12 }]} onPress={handleDeleteAccount}>
            <View style={styles.prefLabelContainer}>
              <SafeIcon name="Trash2" size={18} color="#FF4444" />
              <Text style={[styles.prefLabel, { color: '#FF4444' }]}>Delete Account Permanently</Text>
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
    borderRadius: 50,
    borderWidth: 3,
    borderColor: '#FBE618',
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(251, 230, 24, 0.4)',
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
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
  locationInput: {
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 4,
    width: '100%',
  },
  metaInput: {
    marginTop: 10,
    backgroundColor: '#16161A',
    borderRadius: 16,
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
  },
  prefLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  viewerCount: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FBE618',
  },
  authBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: 22,
    borderWidth: 1,
  },
  authTitle: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  authHint: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
    color: '#666',
    lineHeight: 16,
  },
  authInput: {
    marginTop: 10,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
    fontWeight: '800',
    backgroundColor: 'transparent',
  },
  authBtn: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  authBtnText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
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
  }
});
