import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, ActivityIndicator, Dimensions, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FieldPath, collection, query, onSnapshot, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Match, UserProfile } from '../types';
import { BadgeCheck, MessageSquare, User, Zap, Sparkles, ChevronRight, Briefcase } from 'lucide-react-native';
import { ensureDirectMatch } from '../lib/chat';

const { width } = Dimensions.get('window');

const MatchItem = ({ match, navigation }: { match: Match, navigation: any }) => {
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
    <View style={[styles.matchCard, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
      <View style={styles.cardMain}>
        <View style={styles.avatarContainer}>
          <Image source={{ uri: otherUser.profilePic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' }} style={styles.avatar} />
          <View style={styles.statusDot} />
        </View>
        
        <View style={styles.infoContainer}>
          <View style={styles.nameRow}>
            <Text style={[styles.nameText, { color: isDark ? '#FFF' : '#000' }]}>{otherUser.displayName}</Text>
            {!!otherUser.isVerified && (
              <View style={styles.verifiedMiniBadge}>
                <BadgeCheck size={12} color="#000" fill="#FBE618" />
              </View>
            )}
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{otherUser.ambition?.toUpperCase() || 'FOUNDER'}</Text>
            </View>
          </View>
          <Text style={styles.lastMsg} numberOfLines={1}>{match.lastMessage || `You connected! Start the conversation.`}</Text>
          
          <View style={styles.aiReasonBox}>
            <Sparkles size={10} color="#FBE618" />
            <Text style={styles.aiReasonText}>SYNERGY: {otherUser.skills?.[0] || 'Innovation'} + {otherUser.skills?.[1] || 'Growth'}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.msgBtn,
            { backgroundColor: isDark ? '#16161A' : '#FBE61815', borderColor: isDark ? '#222226' : '#FBE61830' },
          ]}
          onPress={async () => {
            if (!user?.uid || !otherUser?.uid) return;
            try {
              const matchId = await ensureDirectMatch(user.uid, otherUser.uid);
              navigation.navigate('Chat', { matchId, otherUser });
            } catch (e) {
              console.error('Open chat error:', e);
              Alert.alert('Error', 'Could not open chat.');
            }
          }}
        >
          <MessageSquare size={20} color={isDark ? '#FBE618' : '#2563EB'} fill="transparent" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default function MatchScreen({ navigation }: any) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'matches'), where(new FieldPath('participants', user.uid), '==', true));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMatches(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Match)));
        setLoading(false);
      },
      (err) => {
        console.warn('Connections unavailable:', err);
        setMatches([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MatchItem match={item} navigation={navigation} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? <ActivityIndicator color="#FBE618" style={{ marginTop: 50 }} /> : (
            <View style={styles.emptyState}>
              <Zap size={48} color="#222" />
              <Text style={styles.emptyText}>NO ACTIVE CONNECTIONS</Text>
              <Text style={styles.emptySub}>START SWIPING TO BUILD YOUR NETWORK</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 24,
    paddingTop: 10,
    paddingBottom: 100,
  },
  matchCard: {
    padding: 16,
    borderRadius: 24,
    marginBottom: 12,
    borderWidth: 1,
  },
  cardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#FBE61840',
  },
  statusDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#4ADE80',
    borderWidth: 3,
    borderColor: '#111',
  },
  infoContainer: {
    flex: 1,
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameText: {
    fontSize: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
    fontStyle: 'italic',
    flexShrink: 1,
  },
  verifiedMiniBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#FBE61815',
  },
  roleText: {
    fontSize: 8,
    color: '#FBE618',
    fontWeight: '900',
  },
  lastMsg: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  aiReasonBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  aiReasonText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FBE618',
    letterSpacing: 0.5,
  },
  msgBtn: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: '#16161A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#222226',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 100,
    gap: 16,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#444',
    letterSpacing: 2,
  },
  emptySub: {
    fontSize: 10,
    color: '#222',
    fontWeight: '900',
  }
});
