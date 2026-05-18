import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import { collection, query, where, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Match, UserProfile } from '../types';
import { MessageSquare, ChevronRight, Pin, Star } from 'lucide-react-native';

const formatTimeAgo = (timestamp: any) => {
  if (!timestamp) return '';
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffInSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (diffInSeconds < 60) return `${diffInSeconds}s`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h`;
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d`;
};

const ConversationItem = ({ match, navigation }: { match: Match, navigation: any }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [otherUser, setOtherUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    const otherId = match.userIds.find(id => id !== user?.uid);
    if (!otherId) return;

    const unsub = onSnapshot(doc(db, 'users', otherId), (snap) => {
      if (!snap.exists()) return;
      setOtherUser({ uid: otherId, ...(snap.data() as any) } as UserProfile);
    });

    return () => unsub();
  }, [match.userIds, user?.uid]);

  if (!otherUser) return null;
  const isOnline = !!otherUser.isOnline;
  const isPinned = Array.isArray((match as any).pinnedBy) && (match as any).pinnedBy.includes(user?.uid);
  const isImportant = Array.isArray((match as any).importantBy) && (match as any).importantBy.includes(user?.uid);

  return (
    <TouchableOpacity 
      style={[styles.chatItem, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}
      onPress={() => navigation.navigate('Chat', { matchId: match.id, otherUser })}
      onLongPress={() => {
        if (!user?.uid) return;
        Alert.alert('Delete chat', 'Remove this chat from your inbox?', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteDoc(doc(db, 'matches', match.id));
              } catch (e) {
                console.error('Delete chat error:', e);
                Alert.alert('Error', 'Could not delete chat.');
              }
            },
          },
        ]);
      }}
    >
      <View style={styles.avatarContainer}>
        <Image source={{ uri: otherUser.profilePic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' }} style={styles.avatar} />
        <View style={[styles.statusDot, { backgroundColor: isOnline ? '#22C55E' : '#666' }]} />
      </View>
      <View style={styles.chatInfo}>
        <View style={styles.chatHeader}>
          <Text style={[styles.chatName, { color: isDark ? '#FFF' : '#000' }]}>{otherUser.displayName}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {isPinned && <Pin size={12} color="#FBE618" />}
            {isImportant && <Star size={12} color="#FBE618" fill="#FBE618" />}
            <Text style={styles.chatTime}>{formatTimeAgo(match.lastMessageTime)}</Text>
          </View>
        </View>
        <Text style={styles.lastMessage} numberOfLines={1}>
          {match.lastMessage || `Start the conversation with ${(otherUser.displayName || 'Builder').split(' ')[0]}`}
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

  const demoOtherUser: UserProfile = {
    uid: 'demo_user',
    displayName: 'Demo Builder',
    profilePic: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200',
  } as any;

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'matches'), where('userIds', 'array-contains', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const raw = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any as Match));
      const visible = raw.filter((m: any) => !(Array.isArray(m.archivedBy) && m.archivedBy.includes(user.uid)));
      visible.sort((a: any, b: any) => {
        const ap = Array.isArray(a.pinnedBy) && a.pinnedBy.includes(user.uid);
        const bp = Array.isArray(b.pinnedBy) && b.pinnedBy.includes(user.uid);
        if (ap !== bp) return ap ? -1 : 1;
        const at = a.lastMessageTime?.toMillis ? a.lastMessageTime.toMillis() : (a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0);
        const bt = b.lastMessageTime?.toMillis ? b.lastMessageTime.toMillis() : (b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0);
        return bt - at;
      });
      setMatches(visible);
      setLoading(false);
    });
    
    return () => { unsub(); };
  }, [user]);

  const inboxItems = [
    { id: '__demo__', kind: 'demo' as const },
    ...matches.map((m) => ({ id: m.id, kind: 'match' as const, match: m })),
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      {loading ? (
        <ActivityIndicator color="#FBE618" style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={inboxItems}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            if (item.kind === 'demo') {
              return (
                <TouchableOpacity
                  style={[styles.chatItem, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}
                  onPress={() => navigation.navigate('Chat', { otherUser: demoOtherUser })}
                >
                  <View style={styles.avatarContainer}>
                    <Image source={{ uri: demoOtherUser.profilePic }} style={styles.avatar} />
                    <View style={[styles.statusDot, { backgroundColor: '#22C55E' }]} />
                  </View>
                  <View style={styles.chatInfo}>
                    <View style={styles.chatHeader}>
                      <Text style={[styles.chatName, { color: isDark ? '#FFF' : '#000' }]}>DEMO CHAT</Text>
                      <Text style={styles.chatTime}>NOW</Text>
                    </View>
                    <Text style={styles.lastMessage} numberOfLines={1}>
                      Tap to open a demo conversation
                    </Text>
                  </View>
                  <ChevronRight size={16} color="#666" />
                </TouchableOpacity>
              );
            }
            return <ConversationItem match={item.match} navigation={navigation} />;
          }}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingTop: 26,
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
    borderRadius: 27,
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
