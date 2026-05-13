import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { collection, query, getDocs, where, limit, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Match, UserProfile } from '../types';
import { User, MessageSquare } from 'lucide-react-native';

const MatchItem = ({ match }: { match: Match }) => {
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
    <TouchableOpacity style={[styles.matchItem, { backgroundColor: isDark ? '#111111' : '#F8F8F8', borderColor: isDark ? '#222222' : '#EEEEEE' }]}>
      <View style={styles.avatarContainer}>
        {otherUser.profilePic ? (
          <Image source={{ uri: otherUser.profilePic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarPlaceholder, { backgroundColor: isDark ? '#222222' : '#EEEEEE' }]}>
            <User size={24} color={isDark ? '#444444' : '#CCCCCC'} />
          </View>
        )}
      </View>
      <View style={styles.matchInfo}>
        <Text style={[styles.matchName, { color: isDark ? '#FFFFFF' : '#000000' }]}>{otherUser.displayName}</Text>
        <Text style={styles.matchBio} numberOfLines={1}>{otherUser.bio}</Text>
      </View>
      <View style={styles.messageButton}>
        <MessageSquare size={20} color="#FBE618" />
      </View>
    </TouchableOpacity>
  );
};

export default function MatchScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: isDark ? '#050508' : '#FFFFFF', justifyContent: 'center' }]}>
        <ActivityIndicator color="#FBE618" />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#050508' : '#FFFFFF' }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
          Your<Text style={{ color: '#FBE618' }}>Matches</Text>
        </Text>
      </View>
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MatchItem match={item} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={{ color: isDark ? '#444444' : '#999999', fontWeight: '700' }}>No matches yet. Keep building!</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '900',
    fontStyle: 'italic',
    textTransform: 'uppercase',
  },
  listContent: {
    padding: 20,
  },
  matchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 24,
    marginBottom: 12,
    borderWidth: 1,
  },
  avatarContainer: {
    width: 60,
    height: 60,
    borderRadius: 20,
    overflow: 'hidden',
    marginRight: 16,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchInfo: {
    flex: 1,
  },
  matchName: {
    fontSize: 18,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  matchBio: {
    fontSize: 12,
    color: '#666666',
    marginTop: 4,
  },
  messageButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FBE61815',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    marginTop: 100,
  },
});
