import React, { useState, useEffect } from 'react';
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
  Alert
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import * as Icons from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { uploadMedia } from '../lib/storage';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, updateDoc, getDoc } from 'firebase/firestore';

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
  const { profile: myProfile, logout, deleteAccount } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  const [viewedProfile, setViewedProfile] = useState<any>(null);
  const [viewedLoading, setViewedLoading] = useState(false);

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

  if (!profile || viewedLoading) return (
    <View style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFF', justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator color="#666" />
    </View>
  );

  const startEditing = () => {
    setEditData({ 
      ...profile,
      skills: Array.isArray(profile.skills) ? profile.skills.join(', ') : (profile.skills || ''),
      isStealthMode: profile.isStealthMode || false,
      hasExit: profile.hasExit || false
    });
    setIsEditing(true);
  };

  const pickProfilePic = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need access to your photos to update your profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.2, // Small for profile
      base64: true,
    });

    if (!result.canceled) {
      const base64Data = `data:image/jpeg;base64,${result.assets[0].base64}`;
      setIsSaving(true);
      try {
        await updateDoc(doc(db, 'users', profile.uid), {
          profilePic: base64Data
        });
        
        if (isEditing) {
          setEditData({ ...editData, profilePic: base64Data });
        }
      } catch (e) {
        Alert.alert("Error", "Failed to update profile picture.");
      } finally {
        setIsSaving(false);
      }
    }
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
        bio: editData.bio || '',
        city: editData.city || '',
        skills: skillsArray,
        socialLinks: editData.socialLinks || {},
        isStealthMode: editData.isStealthMode || false,
        hasExit: editData.hasExit || false,
        vibeMedia: editData.vibeMedia || ''
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
        } catch (e) {
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
            {(isEditing || true) && (
              <TouchableOpacity style={styles.cameraOverlay} onPress={pickProfilePic}>
                <SafeIcon name="Camera" size={20} color="#000" />
              </TouchableOpacity>
            )}
            <View style={styles.reputationFloating}>
              <SafeIcon name="Zap" size={10} color="#000" fill="#000" />
              <Text style={styles.reputationVal}>{profile.reputationScore || 500}</Text>
            </View>
          </View>

          {isEditing ? (
            <View style={styles.editForm}>
              <TextInput 
                style={[styles.nameInput, { color: isDark ? '#FFF' : '#000' }]}
                value={editData?.displayName}
                onChangeText={(t) => setEditData({...editData, displayName: t})}
                placeholder="Full Name"
                placeholderTextColor="#666"
              />
              <TextInput 
                style={[styles.locationInput, { color: '#FBE618' }]}
                value={editData?.city}
                onChangeText={(t) => setEditData({...editData, city: t})}
                placeholder="City, Country"
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
              <Text style={styles.locationText}>{profile.city || 'Digital Nomad'}</Text>
            </>
          )}
        </View>

        {/* VIBE INTRO */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>VIBE-CHECK (INTRO)</Text>
          {isEditing ? (
            <TextInput
              style={[styles.bioInput, { color: isDark ? '#FFF' : '#000', backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}
              value={editData?.vibeMedia}
              onChangeText={(t) => setEditData({...editData, vibeMedia: t})}
              placeholder="Paste a link to your 15s audio/video intro..."
              placeholderTextColor="#444"
            />
          ) : (
            <TouchableOpacity style={[styles.vibeCard, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
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
              onChangeText={(t) => setEditData({...editData, bio: t})}
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
            {currentSkills.map((skill, i) => (
              <Badge key={i} name={skill.toUpperCase()} iconName="Rocket" />
            ))}
          </View>
          {isEditing && (
            <TextInput 
              style={[styles.skillsInput, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', color: isDark ? '#FFF' : '#000' }]}
              value={editData?.skills}
              onChangeText={(t) => setEditData({...editData, skills: t})}
              placeholder="React, Node, AI..."
              placeholderTextColor="#444"
            />
          )}
        </View>

        {/* CHANNELS */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CHANNELS</Text>
          <View style={styles.socialsRow}>
            <TouchableOpacity style={styles.socialButton}>
              <SafeIcon name="Github" size={20} color={isDark ? '#FFF' : '#000'} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.socialButton}>
              <SafeIcon name="Twitter" size={20} color="#1DA1F2" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.socialButton}>
              <SafeIcon name="Linkedin" size={20} color="#0A66C2" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.socialButton}>
              <SafeIcon name="Link" size={20} color="#FBE618" />
            </TouchableOpacity>
          </View>
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
              <SafeIcon name="Target" size={18} color="#666" />
              <Text style={[styles.prefLabel, { color: isDark ? '#FFF' : '#000' }]}>Verified Exit</Text>
            </View>
            <Switch 
              value={isEditing ? editData.hasExit : profile.hasExit} 
              onValueChange={(v) => isEditing ? setEditData({...editData, hasExit: v}) : updateDoc(doc(db, 'users', profile.uid), { hasExit: v })} 
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
  heroSection: {
    alignItems: 'center',
    marginBottom: 32,
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
    position: 'absolute',
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
