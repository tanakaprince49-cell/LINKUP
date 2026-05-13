import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, SafeAreaView, ActivityIndicator, TextInput } from 'react-native';
import { collection, query, where, onSnapshot, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Match, UserProfile } from '../types';
import { Search, User, MessageSquare } from 'lucide-react-native';

const ConversationItem = ({ match }: { match: Match }) => {
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
    <TouchableOpacity style={[styles.chatItem, { backgroundColor: isDark ? '#111111' : '#F8F8F8', borderColor: isDark ? '#222222' : '#EEEEEE' }]}>
      <View style={styles.avatarContainer}>
        {otherUser.profilePic ? (
          <Image source={{ uri: otherUser.profilePic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarPlaceholder, { backgroundColor: isDark ? '#222222' : '#EEEEEE' }]}>
            <User size={24} color={isDark ? '#444444' : '#CCCCCC'} />
          </View>
        )}
        <View style={styles.onlineBadge} />
      </View>
      <View style={styles.chatInfo}>
        <View style={styles.chatHeader}>
          <Text style={[styles.chatName, { color: isDark ? '#FFFFFF' : '#000000' }]}>{otherUser.displayName}</Text>
          <Text style={styles.chatTime}>12:45</Text>
        </View>
        <Text style={styles.lastMessage} numberOfLines={1}>
          {match.lastMessage || `Start a collaboration with ${otherUser.displayName.split(' ')[0]}...`}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

export default function MessagesScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'matches'), where('userIds', 'array-contains', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Match));
      setMatches(data);
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#050508' : '#FFFFFF' }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
          Direct<Text style={{ color: '#FBE618' }}>Messages</Text>
        </Text>
      </View>

      <View style={styles.searchContainer}>
        <View style={[styles.searchBar, { backgroundColor: isDark ? '#111111' : '#F8F8F8' }]}>
          <Search size={18} color={isDark ? '#444444' : '#999999'} />
          <TextInput
            placeholder="Search collaborators..."
            placeholderTextColor={isDark ? '#444444' : '#999999'}
            style={[styles.searchInput, { color: isDark ? '#FFFFFF' : '#000000' }]}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color="#FBE618" style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ConversationItem match={item} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MessageSquare size={48} color={isDark ? '#222222' : '#EEEEEE'} />
              <Text style={{ color: isDark ? '#444444' : '#999999', marginTop: 20, fontWeight: '700' }}>No conversations yet.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '900',
    fontStyle: 'italic',
    textTransform: 'uppercase',
  },
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 50,
    borderRadius: 15,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 20,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
  },
  avatarContainer: {
    width: 60,
    height: 60,
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
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
    fontSize: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  chatTime: {
    fontSize: 10,
    color: '#666666',
    fontWeight: '700',
  },
  lastMessage: {
    fontSize: 12,
    color: '#666666',
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 100,
  },
});
