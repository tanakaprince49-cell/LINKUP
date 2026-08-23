import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FieldPath, collection, query, where, onSnapshot, doc, updateDoc, arrayUnion, getDoc, getDocs, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Match, UserProfile } from '../types';
import { MessageSquare, Pin, Star, Archive, ChevronLeft } from 'lucide-react-native';
import VerifiedBadge from '../components/VerifiedBadge';
import { buildConversationProfileSnapshot, conversationAvatarUri, loadConversationProfile, normalizeConversationProfile } from '../lib/conversationProfiles';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { shareLinkupInvite } from '../lib/activation';
import { notifyUser } from '../lib/notify';
import ProCrownBadge from '../components/ProCrownBadge';

const isPermissionDenied = (error: any) => String(error?.code || '').includes('permission-denied');

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

const isPresenceOnline = (presence: any) => {
  if (!presence?.isOnline || !presence?.lastActiveAt) return false;
  const date = presence.lastActiveAt?.toDate ? presence.lastActiveAt.toDate() : new Date(presence.lastActiveAt);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() < 2 * 60 * 1000;
};

const formatLastSeen = (timestamp: any) => {
  const ago = formatTimeAgo(timestamp);
  return ago ? `Last seen ${ago} ago` : 'Offline';
};

const matchUserIds = (match: Match) =>
  Array.isArray(match.userIds) && match.userIds.length > 0
    ? match.userIds
    : Object.keys((match as any).participants || {}).filter((uid) => (match as any).participants?.[uid]);

const otherParticipantId = (match: Match, currentUid?: string) =>
  matchUserIds(match).find((id) => id && id !== currentUid) || '';

const fallbackConversationUser = (match: Match, otherId?: string): UserProfile | null => {
  if (!otherId) return null;
  const profileMap = (match as any).participantProfiles || (match as any).profiles || {};
  const profile = profileMap?.[otherId] || {};
  return normalizeConversationProfile(otherId, profile);
};

const ConversationItem = React.memo(({ match, navigation }: { match: Match, navigation: any }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const otherId = otherParticipantId(match, user?.uid);
  const [otherUser, setOtherUser] = useState<UserProfile | null>(() => fallbackConversationUser(match, otherId));

  useEffect(() => {
    if (!otherId) {
      setOtherUser(null);
      return;
    }

    let cancelled = false;
    const fallback = fallbackConversationUser(match, otherId);
    setOtherUser((current) => normalizeConversationProfile(otherId, current || {}, fallback));

    loadConversationProfile(otherId, fallback)
      .then((profile) => {
        if (!cancelled) setOtherUser((current) => ({ ...(current || {}), ...profile }));
      })
      .catch((error) => {
        if (!cancelled && !isPermissionDenied(error)) console.warn('Conversation profile unavailable:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [otherId, match]);

  useEffect(() => {
    if (!otherId || !otherUser) return;
    if ((otherUser as any)?.hideOnlineStatus) {
      setOtherUser((prev) => (prev ? ({ ...prev, isOnline: false, lastActiveAt: null } as any) : prev));
      return;
    }

    let cancelled = false;
    getDoc(doc(db, 'presence', otherId))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setOtherUser((prev) => (prev ? ({ ...prev, isOnline: false } as any) : prev));
          return;
        }
        const p = snap.data() as any;
        setOtherUser((prev) => (prev ? ({ ...prev, isOnline: isPresenceOnline(p), lastActiveAt: p.lastActiveAt } as any) : prev));
      })
      .catch((err) => {
        if (cancelled) return;
        if (!isPermissionDenied(err)) {
          console.warn('Conversation presence unavailable:', err);
        }
        setOtherUser((prev) => (prev ? ({ ...prev, isOnline: false } as any) : prev));
      });

    return () => {
      cancelled = true;
    };
  }, [otherId, (otherUser as any)?.hideOnlineStatus]);

  if (!otherUser) return null;
  const isOnline = isPresenceOnline(otherUser);
  const isPinned = Array.isArray((match as any).pinnedBy) && (match as any).pinnedBy.includes(user?.uid);
  const isImportant = Array.isArray((match as any).importantBy) && (match as any).importantBy.includes(user?.uid);
  const unreadCount = Math.max(0, Number((match as any).unreadBy?.[user?.uid || ''] || 0));
  const avatarUri = conversationAvatarUri(otherUser.profilePic);
  const avatarInitial = String(otherUser.displayName || 'L').trim().charAt(0).toUpperCase() || 'L';
  const chatUserSnapshot = buildConversationProfileSnapshot(otherId, otherUser);

  return (
    <TouchableOpacity 
      style={[styles.chatItem, liquidGlass(isDark, false)]}
      onPress={() => navigation.navigate('Chat', { matchId: match.id, otherUser: chatUserSnapshot })}
      onLongPress={() => {
        if (!user?.uid) return;
        notifyUser('Delete chat', 'Remove this chat from your inbox?', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await updateDoc(doc(db, 'matches', match.id), { deletedBy: arrayUnion(user.uid) } as any);
              } catch (e) {
                console.error('Delete chat error:', e);
                notifyUser('Error', 'Could not delete chat.');
              }
            },
          },
        ]);
      }}
    >
      <View style={styles.avatarContainer}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: isDark ? '#181818' : '#FFF8B8' }]}>
            <Text style={styles.avatarFallbackText}>{avatarInitial}</Text>
          </View>
        )}
        {isOnline ? <View style={styles.statusDot} /> : null}
      </View>
      <View style={styles.chatInfo}>
        <View style={styles.chatHeader}>
          <View style={styles.chatNameRow}>
            <Text style={[styles.chatName, { color: textColor(isDark) }]} numberOfLines={1}>{otherUser.displayName}</Text>
            {!!otherUser.isVerified && <VerifiedBadge size={20} />}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {isPinned && <Pin size={12} color={COLORS.primary} />}
            {isImportant && <Star size={12} color={COLORS.primary} fill={COLORS.primary} />}
            <Text style={[styles.chatTime, { color: textColor(isDark, 'muted') }]}>{formatTimeAgo(match.lastMessageTime)}</Text>
          </View>
        </View>
        <Text style={[styles.lastMessage, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>
          {match.lastMessage || `Start the conversation with ${(otherUser.displayName || 'Builder').split(' ')[0]}`}
        </Text>
      </View>
      {unreadCount > 0 && (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : String(unreadCount)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

export default function MessagesScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const archivedOnly = !!route?.params?.archivedOnly;
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'matches'), where(new FieldPath('participants', user.uid), '==', true), limit(80));

    const handleSnap = (snap: any) => {
        const raw = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as any as Match));
        const visible = raw.filter((m: any) => {
          const archived = Array.isArray(m.archivedBy) && m.archivedBy.includes(user.uid);
          const deleted = Array.isArray(m.deletedBy) && m.deletedBy.includes(user.uid);
          if (deleted) return false;
          return archivedOnly ? archived : !archived;
        });
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

        // Warm every conversation profile in parallel the moment the inbox
        // lands, so rows never wait for a per-mount fetch — when each row
        // mounts, its profile is already an instant cache hit (deduped in
        // conversationProfiles, so this costs one round-trip per person max).
        visible.forEach((m: any) => {
          const otherId = otherParticipantId(m, user.uid);
          if (!otherId) return;
          void loadConversationProfile(otherId, fallbackConversationUser(m, otherId)).catch(() => {});
        });
    };

    // Watchdog: if the live listener neither delivers nor errors within 8s
    // (silent stream hang on hostile networks), serve a one-shot read so the
    // inbox can never sit empty/spinning forever.
    let delivered = false;
    const watchdog = setTimeout(() => {
      if (delivered) return;
      getDocs(q).then(handleSnap).catch(() => {});
    }, 8000);

    const unsub = onSnapshot(
      q,
      (snap) => {
        delivered = true;
        clearTimeout(watchdog);
        handleSnap(snap);
      },
      (err) => {
        delivered = true;
        clearTimeout(watchdog);
        console.warn('Messages list unavailable:', err);
        setMatches([]);
        setLoading(false);
      }
    );

    return () => { clearTimeout(watchdog); unsub(); };
  }, [user, archivedOnly]);

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <View style={styles.scene} pointerEvents="none">
        <View style={[styles.scenePane, styles.scenePaneA, { backgroundColor: isDark ? 'rgba(0,194,255,0.1)' : 'rgba(0,194,255,0.14)' }]} />
        <View style={[styles.scenePane, styles.scenePaneB, { backgroundColor: isDark ? 'rgba(223,251,63,0.08)' : 'rgba(223,251,63,0.16)' }]} />
      </View>
      <View style={[styles.topBar, liquidGlass(isDark, false)]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
          {(archivedOnly || navigation.canGoBack?.()) && (
            <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backBtn, liquidGlass(isDark, false)]}>
              <ChevronLeft size={20} color={textColor(isDark)} />
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.screenTitle, { color: textColor(isDark) }]}>
              {archivedOnly ? 'Archived chats' : 'Messages'}
            </Text>
            <Text style={styles.screenSub}>
              {archivedOnly ? 'Hidden conversations you can still reopen.' : 'Your founder conversations and team threads.'}
            </Text>
          </View>
        </View>
        <ProCrownBadge />
        {!archivedOnly && (
          <TouchableOpacity
            onPress={() => navigation.navigate('ArchivedChats', { archivedOnly: true })}
            style={[styles.archiveBtn, liquidGlass(isDark, false)]}
          >
            <Archive size={17} color={textColor(isDark)} />
            <Text style={[styles.archiveBtnText, { color: textColor(isDark) }]}>Archive</Text>
          </TouchableOpacity>
        )}
      </View>
      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ConversationItem match={item} navigation={navigation} />}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={80}
          windowSize={6}
          removeClippedSubviews
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MessageSquare size={48} color="#222" />
              <Text style={styles.emptyText}>{archivedOnly ? 'NO ARCHIVED CHATS' : 'NO CONVERSATIONS YET'}</Text>
              {!archivedOnly ? (
                <>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#777', textAlign: 'center', lineHeight: 18 }}>
                    Chat stays empty until someone matches you. Swipe, search, or invite 3 builders you already know.
                  </Text>
                  <TouchableOpacity onPress={() => navigation.navigate('Swipe')} style={{ backgroundColor: COLORS.primary, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 16 }}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: '#000', letterSpacing: 1 }}>OPEN DISCOVER</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => void shareLinkupInvite()}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: COLORS.primary, letterSpacing: 1 }}>INVITE BUILDERS</Text>
                  </TouchableOpacity>
                </>
              ) : null}
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
  scene: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  scenePane: {
    position: 'absolute',
    width: 280,
    height: 130,
    borderRadius: 34,
  },
  scenePaneA: {
    top: 90,
    right: -120,
    transform: [{ rotate: '-16deg' }],
  },
  scenePaneB: {
    top: 330,
    left: -120,
    transform: [{ rotate: '16deg' }],
  },
  topBar: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0,
  },
  screenSub: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '800',
    color: '#777',
    lineHeight: 15,
  },
  archiveBtn: {
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  archiveBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 100,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
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
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  avatarFallbackText: {
    color: '#000',
    fontSize: 20,
    fontWeight: '900',
    },
  statusDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
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
    fontWeight: '800',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  chatNameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingRight: 10,
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
  chatTime: {
    fontSize: 11,
    fontWeight: '700',
  },
  lastMessage: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  presenceText: {
    marginTop: 3,
    color: '#888',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  unreadBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 7,
    borderRadius: 14,
    backgroundColor: '#E30613',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  unreadBadgeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '900',
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
    letterSpacing: -0.2,
  },
});
