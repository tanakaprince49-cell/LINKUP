import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Image, ScrollView, Dimensions, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, doc, updateDoc, increment, query, where, getDocs, limit } from 'firebase/firestore';
import { uploadMedia } from '../lib/storage';
import { uploadImageToImageKit } from '../lib/imagekitUpload';
import { storedProfileImageUri } from '../lib/profilePerformance';
import { isDiscoverableProfile } from '../lib/discovery';
import * as ImagePicker from 'expo-image-picker';
import { X, Camera, Video, Send, Image as ImageIcon } from 'lucide-react-native';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';

const { width } = Dimensions.get('window');

export default function CreatePostScreen({ navigation }: any) {
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [media, setMedia] = useState<string[]>([]);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [suggestedUsers, setSuggestedUsers] = useState<any[]>([]);

  useEffect(() => {
    if (tagQuery.length > 0) {
      const fetchUsers = async () => {
        const q = query(
          collection(db, 'users'),
          where('displayName', '>=', tagQuery),
          limit(5)
        );
        const snap = await getDocs(q);
        setSuggestedUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isDiscoverableProfile));
      };
      fetchUsers();
    } else {
      setSuggestedUsers([]);
    }
  }, [tagQuery]);

  const handleTextChange = (text: string) => {
    setContent(text);
    const words = text.split(/\s/);
    const lastWord = words[words.length - 1];

    if (lastWord.startsWith('@')) {
      setShowTagMenu(true);
      setTagQuery(lastWord.slice(1));
    } else {
      setShowTagMenu(false);
    }
  };

  const insertTag = (username: string) => {
    const words = content.split(/\s/);
    words[words.length - 1] = `@${username} `;
    setContent(words.join(' '));
    setShowTagMenu(false);
  };

  const handlePost = async () => {
    if (!content.trim() || !user || isPosting) return;
    
    setIsPosting(true);
    try {
      const hashtags = content.match(/#[a-z0-9_]+/gi) || [];
      const tags = content.match(/@[a-z0-9_]+/gi) || [];

      // HARD RULE: base64 NEVER enters Firestore (it once made notifications
      // weigh 53MB). Every media item is pushed to the ImageKit CDN first —
      // uploads that fail (offline / missing server key) are dropped, the
      // text post still goes through.
      const stamp = Date.now();
      const hostedMedia = (
        await Promise.all(
          (media || []).map(async (item, index) => {
            if (typeof item !== 'string') return null;
            if (/^https?:\/\//i.test(item)) return item;
            if (item.startsWith('data:image')) {
              return uploadImageToImageKit(user.uid, item, {
                folder: '/linkup-posts',
                fileName: `${user.uid}-${stamp}-${index}.jpg`,
              });
            }
            return null; // base64 videos / anything else: never stored
          })
        )
      ).filter(Boolean) as string[];

      await addDoc(collection(db, 'posts'), {
        authorId: user.uid,
        authorName: profile?.displayName || user.displayName || 'Builder',
        authorPic: storedProfileImageUri((profile as any)?.profilePicUrl || profile?.profilePic),
        authorVerified: !!profile?.isVerified,
        content,
        timestamp: serverTimestamp(),
        likesCount: 0,
        commentsCount: 0,
        viewsCount: 0,
        likedBy: [],
        viewedBy: [],
        media: hostedMedia, // CDN URLs only — base64 never reaches Firestore
        hashtags,
        mentions: tags,
        type: 'update',
      });

      await updateDoc(doc(db, 'users', user.uid), {
        reputationScore: increment(10),
        lastActiveAt: serverTimestamp()
      });

      navigation.goBack();
    } catch (err) {
      console.error("Failed to post:", err);
      Alert.alert("Error", "Failed to upload media or post content.");
      setIsPosting(false);
    }
  };

  const pickMedia = async (type: 'image' | 'video') => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need access to your photos to post media.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: type === 'image' ? ['images'] : ['videos'],
      allowsMultipleSelection: true,
      quality: 0.3, // Heavily compressed to fit in Firestore
      base64: true,
    });

    if (!result.canceled) {
      const newMedia = result.assets.map(asset => {
        if (asset.base64) {
          return `data:image/jpeg;base64,${asset.base64}`;
        }
        return asset.uri;
      });
      setMedia(prev => [...prev, ...newMedia]);
    }
  };

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton}>
            <X size={20} color={textColor(isDark)} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>Post</Text>
          <TouchableOpacity 
            onPress={handlePost} 
            disabled={!content.trim() || isPosting}
            style={[styles.shipButton, { backgroundColor: COLORS.primary, opacity: content.trim() ? 1 : 0.5 }]}
          >
            {isPosting ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.shipText}>Post</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.contentArea} keyboardShouldPersistTaps="handled">
          <View style={styles.inputWrapper}>
            <Image source={{ uri: profile?.profilePic || 'https://ui-avatars.com/api/?name=+&background=E5E7EB&color=9CA3AF&size=256' }} style={styles.userThumb} />
            <TextInput
              autoFocus
              multiline
              placeholder="WHAT'S ON YOUR MIND?"
              placeholderTextColor="#666"
              style={[styles.input, { color: textColor(isDark) }]}
              value={content}
              onChangeText={handleTextChange}
            />
          </View>

          {media.length > 0 && (
            <ScrollView horizontal style={styles.mediaPreview} showsHorizontalScrollIndicator={false}>
              {media.map((uri, i) => (
                <View key={i} style={styles.mediaItem}>
                  <Image source={{ uri }} style={styles.mediaImg} />
                  <TouchableOpacity style={styles.removeMedia} onPress={() => setMedia(prev => prev.filter((_, idx) => idx !== i))}>
                    <X size={12} color="#FFF" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          {showTagMenu && suggestedUsers.length > 0 && (
            <View style={styles.tagMenu}>
              {suggestedUsers.map(u => (
                <TouchableOpacity key={u.id} style={styles.tagItem} onPress={() => insertTag(u.displayName)}>
                  <Image source={{ uri: u.profilePic }} style={styles.tagAvatar} />
                  <Text style={styles.tagName}>{u.displayName}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>

        <View style={[styles.toolbar, { borderTopColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
          <TouchableOpacity style={styles.toolBtn} onPress={() => pickMedia('image')}>
            <ImageIcon size={22} color={COLORS.primary} />
            <Text style={styles.toolText}>Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={() => pickMedia('video')}>
            <Video size={22} color={COLORS.primary} />
            <Text style={styles.toolText}>Video</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 10,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(251,230,24,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(251,230,24,0.19)',
  },
  shipButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 14,
  },
  shipText: {
    fontWeight: '900',
    fontSize: 12,
  },
  contentArea: { flex: 1, padding: 20 },
  inputWrapper: { flexDirection: 'row', gap: 16 },
  userThumb: { width: 44, height: 44, borderRadius: 15 },
  input: {
    flex: 1,
    fontSize: 18,
    fontWeight: '500',
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  mediaPreview: { marginTop: 24, flexDirection: 'row' },
  mediaItem: { position: 'relative', marginRight: 12 },
  mediaImg: { width: 150, height: 200, borderRadius: 16 },
  removeMedia: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    borderTopWidth: 1,
    gap: 20,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(251,230,24,0.06)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  toolText: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  tagMenu: {
    backgroundColor: '#16161A',
    borderRadius: 16,
    marginTop: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: '#222226',
  },
  tagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 10,
  },
  tagAvatar: { width: 30, height: 30, borderRadius: 10 },
  tagName: { color: '#FFF', fontWeight: '900', fontSize: 12 },
});
