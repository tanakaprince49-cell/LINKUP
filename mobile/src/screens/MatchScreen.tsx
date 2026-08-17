import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, ActivityIndicator, Dimensions, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { FieldPath, collection, query, onSnapshot, where, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Match, UserProfile } from '../types';
import { MessageSquare, User, Zap, Sparkles, ChevronRight, Briefcase } from 'lucide-react-native';
import { ensureDirectMatch } from '../lib/chat';
import VerifiedBadge from '../components/VerifiedBadge';
import { conversationAvatarUri, loadConversationProfile, normalizeConversationProfile } from '../lib/conversationProfiles';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';

const { width } = Dimensions.get('window');

const matchUserIds = (match: Match) =>
  Array.isArray(match.userIds) && match.userIds.length > 0
    ? match.userIds
    : Object.keys((match as any).participants || {}).filter((uid) => (match as any).participants?.[uid]);

const otherParticipantId = (match: Match, currentUid?: string) =>
  matchUserIds(match).find((id) => id && id !== currentUid) || '';

const MatchItem = React.memo(({ match, navigation }: { match: Match, navigation: any }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [otherUser, setOtherUser] = useState<UserProfile | null>(() => ({
    uid: '',
    displayName: 'Builder',
    profilePic: '',
  } as UserProfile));
  const otherId = otherParticipantId(match, user?.uid);

  useEffect(() => {
    if (!otherId) {
      setOtherUser(null);
      return;
    }

    let cancelled = false;
    const profileMap = (match as any).participantProfiles || (match as any).profiles || {};
    const fallback = normalizeConversationProfile(otherId, profileMap?.[otherId] || {});
    setOtherUser((current) => normalizeConversationProfile(otherId, current || {}, fallback));
    loadConversationProfile(otherId, fallback)
      .then((profile) => {
        if (!cancelled) setOtherUser((current) => ({ ...(current || {}), ...profile }));
      })
      .catch((error) => {
        if (!cancelled) console.warn('Connection profile unavailable:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [otherId, match]);

  if (!otherUser) return null;

  return (
    <View style={[styles.matchCard, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
      <View style={styles.cardMain}>
        <View style={styles.avatarContainer}>
          <Image source={{ uri: conversationAvatarUri(otherUser.profilePic) || 'https://ui-avatars.com/api/?name=+&background=E5E7EB&color=9CA3AF&size=256' }} style={styles.avatar} />
          <View style={styles.statusDot} />
        </View>
        
        <View style={styles.infoContainer}>
          <View style={styles.nameRow}>
            <Text style={[styles.nameText, { color: textColor(isDark) }]}>{otherUser.displayName}</Text>
            {!!otherUser.isVerified && <VerifiedBadge size={20} />}
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{otherUser.ambition?.toUpperCase() || 'FOUNDER'}</Text>
            </View>
          </View>
          <Text style={styles.lastMsg} numberOfLines={1}>{match.lastMessage || `You connected! Start the conversation.`}</Text>
          
          <View style={styles.aiReasonBox}>
            <Sparkles size={10} color={COLORS.primary} />
            <Text style={styles.aiReasonText}>SYNERGY: {otherUser.skills?.[0] || 'Innovation'} + {otherUser.skills?.[1] || 'Growth'}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.msgBtn,
            liquidGlass(isDark, false),
            { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder },
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
          <MessageSquare size={20} color={COLORS.primary} fill="transparent" />
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default function MatchScreen({ navigation }: any) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isFocused = useIsFocused();
  const isDark = theme === 'dark';
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    if (!isFocused) return;
    const q = query(collection(db, 'matches'), where(new FieldPath('participants', user.uid), '==', true), limit(80));
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
  }, [isFocused, user?.uid]);

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MatchItem match={item} navigation={navigation} />}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={80}
        windowSize={6}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 50 }} /> : (
            <View style={styles.emptyState}>
              <Zap size={48} color="#222" />
              <Text style={styles.emptyText}>No Active Connections</Text>
              <Text style={styles.emptySub}>Start Swiping to Build Your Network</Text>
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
    borderRadius: 16,
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
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(251,230,24,0.25)',
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
    flexShrink: 1,
  },
  verifiedMiniBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(251,230,24,0.09)',
  },
  roleText: {
    fontSize: 8,
    color: COLORS.primary,
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
    color: COLORS.primary,
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
    letterSpacing: -0.2,
  },
  emptySub: {
    fontSize: 10,
    color: '#222',
    fontWeight: '900',
  }
});
