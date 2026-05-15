import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, SafeAreaView, ActivityIndicator, TextInput, Dimensions, ScrollView } from 'react-native';
import { collection, query, where, onSnapshot, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Match, UserProfile } from '../types';
import { Search, User, MessageSquare, ChevronRight, Zap, Plus, X, Eye, Heart } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { uploadMedia } from '../lib/storage';

const { width } = Dimensions.get('window');

const ConversationItem = ({ match, navigation }: { match: Match, navigation: any }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [otherUser, setOtherUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    const otherId = match.userIds.find(id => id !== user?.uid);
    if (!otherId) return;

    const fetchOtherUser = async () => {
      const snap = await getDoc(doc(db, 'users', otherId));
      if (snap.exists()) setOtherUser(snap.data() as UserProfile);
    };
    fetchOtherUser();
  }, [match.userIds, user?.uid]);

  if (!otherUser) return null;

  return (
    <TouchableOpacity 
      style={[styles.chatItem, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}
      onPress={() => navigation.navigate('Chat', { matchId: match.id, otherUser })}
    >
      <View style={styles.avatarContainer}>
        <Image source={{ uri: otherUser.profilePic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' }} style={styles.avatar} />
        <View style={styles.statusDot} />
      </View>
      <View style={styles.chatInfo}>
        <View style={styles.chatHeader}>
          <Text style={[styles.chatName, { color: isDark ? '#FFF' : '#000' }]}>{otherUser.displayName}</Text>
          <Text style={styles.chatTime}>MOMENTS_AGO</Text>
        </View>
        <Text style={styles.lastMessage} numberOfLines={1}>
          {match.lastMessage || `Start the conversation with ${otherUser.displayName.split(' ')[0]}`}
        </Text>
      </View>
      <ChevronRight size={16} color="#666" />
    </TouchableOpacity>
  );
};

export default function MessagesScreen({ navigation }: any) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stories, setStories] = useState<any[]>([]);
  const [activeStory, setActiveStory] = useState<any | null>(null);

  useEffect(() => {
    if (!user) return;
    const now = new Date();
    // In a real app, query where expiresAt > now. But for simple demo, fetch all recent stories and filter client-side
    const sq = query(collection(db, 'stories'), orderBy('createdAt', 'desc'), limit(20));
    const unsubStories = onSnapshot(sq, (snap) => {
      const validStories = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter((s: any) => {
        const expires = s.expiresAt?.toDate ? s.expiresAt.toDate() : new Date(s.expiresAt);
        return expires > new Date();
      });
      setStories(validStories);
    });

    const q = query(collection(db, 'matches'), where('userIds', 'array-contains', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      setMatches(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Match)));
      setLoading(false);
    });
    
    return () => { unsub(); unsubStories(); };
  }, [user]);

  const handleAddStory = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      try {
        const base64Data = `data:image/jpeg;base64,${result.assets[0].base64}`;
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours

        await addDoc(collection(db, 'stories'), {
          authorId: user?.uid,
          authorName: profile?.displayName,
          authorPic: profile?.profilePic,
          mediaUrl: base64Data,
          type: 'image',
          viewers: [],
          likes: [],
          createdAt: new Date(),
          expiresAt: expiresAt
        });
      } catch (e) {
        console.error("Error adding story", e);
      }
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <View style={styles.searchArea}>
        <View style={[styles.searchBar, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
          <Search size={18} color="#666" />
          <TextInput
            placeholder="SEARCH CONNECTIONS..."
            placeholderTextColor="#444"
            style={[styles.searchInput, { color: isDark ? '#FFF' : '#000' }]}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      <View style={styles.activeNodes}>
        <Text style={styles.sectionTitle}>STORIES</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeNodesScroll}>
          <TouchableOpacity style={styles.addStoryItem} onPress={handleAddStory}>
            <View style={[styles.activeAvatarWrapper, { borderColor: '#FBE618', borderWidth: 2 }]}>
              <Image source={{ uri: profile?.profilePic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100' }} style={styles.activeAvatar} />
              <View style={{ position: 'absolute', bottom: 0, right: 0, backgroundColor: '#2563EB', borderRadius: 10, padding: 2 }}>
                <Plus size={12} color="#FFF" />
              </View>
            </View>
            <Text style={[styles.storyName, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>Add Story</Text>
          </TouchableOpacity>
          
          {stories.map((s) => (
            <TouchableOpacity key={s.id} style={styles.activeNodeItem} onPress={() => setActiveStory(s)}>
              <View style={[styles.activeAvatarWrapper, { borderColor: s.viewers.includes(user?.uid) ? '#666' : '#2563EB', borderWidth: 2 }]}>
                <Image source={{ uri: s.authorPic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100' }} style={styles.activeAvatar} />
              </View>
              <Text style={[styles.storyName, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>{s.authorName.split(' ')[0]}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <ActivityIndicator color="#FBE618" style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ConversationItem match={item} navigation={navigation} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MessageSquare size={48} color="#222" />
              <Text style={styles.emptyText}>NO CONVERSATIONS YET</Text>
            </View>
          }
        />
      )}

      {activeStory && (
        <View style={StyleSheet.absoluteFillObject}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            <Image source={{ uri: activeStory.mediaUrl }} style={{ flex: 1 }} resizeMode="contain" />
            <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Image source={{ uri: activeStory.authorPic }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                <Text style={{ color: '#FFF', fontWeight: 'bold' }}>{activeStory.authorName}</Text>
              </View>
              <TouchableOpacity onPress={() => setActiveStory(null)}>
                <X size={28} color="#FFF" />
              </TouchableOpacity>
            </SafeAreaView>
            <SafeAreaView style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <TouchableOpacity onPress={async () => {
                  // Like logic
                }}>
                  <Heart size={28} color="#FFF" />
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Eye size={20} color="#FFF" />
                <Text style={{ color: '#FFF', fontWeight: 'bold' }}>{activeStory.viewers?.length || 0}</Text>
              </View>
            </SafeAreaView>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchArea: {
    padding: 24,
    paddingTop: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 54,
    borderRadius: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: '#22222610',
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  activeNodes: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FBE618',
    letterSpacing: 2,
    marginBottom: 16,
  },
  activeNodesScroll: {
    gap: 15,
  },
  activeNodeItem: {
    alignItems: 'center',
    width: 60,
  },
  addStoryItem: {
    alignItems: 'center',
    width: 60,
  },
  storyName: {
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 6,
  },
  activeAvatarWrapper: {
    position: 'relative',
  },
  activeAvatar: {
    width: 54,
    height: 54,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FBE618',
  },
  activeStatus: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#4ADE80',
    borderWidth: 3,
    borderColor: '#0A0A0C',
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 24,
    marginBottom: 12,
    borderWidth: 1,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 18,
  },
  statusDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FBE618',
    borderWidth: 2,
    borderColor: '#111',
  },
  chatInfo: {
    flex: 1,
    marginLeft: 16,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatName: {
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
    fontStyle: 'italic',
  },
  chatTime: {
    fontSize: 10,
    color: '#666',
    fontWeight: '900',
  },
  lastMessage: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 60,
    gap: 16,
  },
  emptyText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#444',
    letterSpacing: 2,
  },
});
