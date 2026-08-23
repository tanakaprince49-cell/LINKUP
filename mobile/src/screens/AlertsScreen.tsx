import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, query, where, onSnapshot, doc, updateDoc, limit } from 'firebase/firestore';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { db } from '../lib/firebase';
import { AppImage } from '../components/AppImage';
import { ikAvatar } from '../lib/ikImage';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { AppNotification } from '../types';
import { markUnreadNotificationsRead } from '../lib/notifications';
import { COLORS, appBackground, hairline, liquidGlass, textColor } from '../theme/theme';
import { respondToConnectionRequest } from '../lib/connectionRequests';
import { notifyUser } from '../lib/notify';
import { challengeId as makeChallengeId } from '../lib/gameChallenges';
import { MOBILE_LIST_IMAGE_LIMIT, MOBILE_NOTIFICATION_QUERY_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';
import { Bell, Eye, Heart, MessageSquare, UserPlus, Check, X } from 'lucide-react-native';
import ScreenHeader from '../components/ScreenHeader';

const formatTimeAgo = (timestamp: any) => {
  if (!timestamp) return 'Just now';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d ago`;
  return `${Math.floor(diffInDays / 7)}w ago`;
};

const timestampToMillis = (timestamp: AppNotification['timestamp']) => {
  if (!timestamp) return 0;
  if (typeof (timestamp as any)?.toDate === 'function') {
    return (timestamp as any).toDate().getTime();
  }
  const parsed = new Date(timestamp as any).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

type NotificationRow = AppNotification;

const NotificationItem = ({ notification, navigation }: { notification: NotificationRow; navigation: any }) => {
  const { theme } = useTheme();
  const { user, profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<'approved' | 'ignored' | null>(null);
  const isDark = theme === 'dark';
  const pic = safeProfileImageUri(notification.fromPic, MOBILE_LIST_IMAGE_LIMIT);
  const isRequest = notification.type === 'connection_request' && notification.requestId && notification.fromId && !resolved;

  const getIcon = () => {
    switch (notification.type) {
      case 'like':
        return <Heart size={16} color="#111" fill="#111" />;
      case 'match':
      case 'connection_approved':
        return <Check size={16} color="#111" />;
      case 'message':
        return <MessageSquare size={16} color="#111" />;
      case 'connection_request':
        return <UserPlus size={16} color="#111" />;
      case 'connection_rejected':
        return <X size={16} color="#111" />;
      case 'view':
        return <Eye size={16} color="#111" />;
      default:
        return <Bell size={16} color="#111" />;
    }
  };

  const markRead = async () => {
    if (!notification?.id || notification?.isRead !== false) return;
    await updateDoc(doc(db, 'notifications', notification.id), { isRead: true });
  };

  const respondToRequest = async (approved: boolean) => {
    if (!user?.uid || !notification.requestId || !notification.fromId || busy) return;
    setBusy(true);
    try {
      await markRead();
      const result = await respondToConnectionRequest({
        requestId: notification.requestId,
        responderId: user.uid,
        senderId: notification.fromId,
        approved,
        responderName: profile?.displayName || user.displayName || 'Someone',
        responderPic: safeProfileImageUri(profile?.profilePic || user.photoURL || '', MOBILE_LIST_IMAGE_LIMIT),
      });
      setResolved(approved ? 'approved' : 'ignored');
      if (approved && result.matchId) {
        navigation.navigate('Chat', {
          matchId: result.matchId,
          otherUser: {
            uid: notification.fromId,
            displayName: notification.fromName || 'Builder',
            profilePic: pic,
          },
        });
      }
    } catch (error) {
      console.warn('Connection request response failed:', error);
      notifyUser('Action failed', 'Could not answer this request. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.item, liquidGlass(isDark, false), notification.isRead === false && styles.itemUnread]}
      activeOpacity={0.88}
      onPress={async () => {
        try {
          await markRead();
        } catch {}
        if (isRequest) return;
        if (notification.matchId) {
          navigation.navigate('Chat', {
            matchId: notification.matchId,
            otherUser: notification.fromId
              ? { uid: notification.fromId, displayName: notification.fromName || 'Builder', profilePic: pic }
              : undefined,
          });
          return;
        }
        if (
          notification.type === 'system' &&
          (notification.content?.startsWith('Opportunity') || notification.content?.startsWith('Project Match')) &&
          notification.fromId
        ) {
          navigation.navigate('ActiveOpportunity', { userId: notification.fromId });
          return;
        }
        if (notification.type === 'game_challenge' && (notification as any).gameType && notification.fromId && user?.uid) {
          const screenMap: Record<string, string> = {
            founderflip: 'FounderFlip',
            pitchperfect: 'PitchPerfect',
            networkquiz: 'NetworkQuiz',
          };
          const screen = screenMap[(notification as any).gameType];
          if (screen) {
            navigation.navigate(screen, { challengeId: makeChallengeId(notification.fromId, user.uid) });
            return;
          }
        }
        if (notification.fromId) navigation.navigate('Profile', { userId: notification.fromId });
      }}
    >
      <View style={styles.avatarWrap}>
        {pic ? (
          <AppImage uri={ikAvatar(pic)} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarLetter}>{(notification.fromName || 'L').slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.iconBadge}>{getIcon()}</View>
      </View>
      <View style={styles.content}>
        <Text style={[styles.contentText, { color: textColor(isDark) }]}>
          <Text style={{ fontWeight: '800' }}>{notification.fromName || 'Someone'} </Text>
          {notification.content}
        </Text>
        <Text style={[styles.timeText, { color: textColor(isDark, 'muted') }]}>{formatTimeAgo(notification.timestamp)}</Text>
        {notification.note ? (
          <View style={[styles.noteBox, { backgroundColor: isDark ? 'rgba(17, 24, 39,0.08)' : '#FFF8C5' }]}>
            <Text style={[styles.noteText, { color: textColor(isDark) }]}>“{notification.note}”</Text>
          </View>
        ) : null}
        {isRequest ? (
          <View style={styles.requestActions}>
            <TouchableOpacity
              style={[styles.ignoreBtn, { borderColor: hairline(isDark) }]}
              disabled={busy}
              onPress={(event: any) => {
                event?.stopPropagation?.();
                void respondToRequest(false);
              }}
            >
              <X size={14} color={textColor(isDark)} />
              <Text style={[styles.ignoreText, { color: textColor(isDark) }]}>{busy ? '…' : 'Ignore'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.approveBtn}
              disabled={busy}
              onPress={(event: any) => {
                event?.stopPropagation?.();
                void respondToRequest(true);
              }}
            >
              {busy ? <ActivityIndicator color="#111" /> : <Text style={styles.approveText}>Approve</Text>}
            </TouchableOpacity>
          </View>
        ) : resolved ? (
          <Text style={[styles.resolved, { color: textColor(isDark, 'muted') }]}>
            {resolved === 'approved' ? 'Approved — you can chat now.' : 'Ignored.'}
          </Text>
        ) : null}
      </View>
      {notification.isRead === false ? <View style={styles.unreadDot} /> : null}
    </TouchableOpacity>
  );
};

export default function AlertsScreen({ navigation }: any) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isFocused = useIsFocused();
  const isDark = theme === 'dark';
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!user?.uid) return;
      markUnreadNotificationsRead(user.uid).catch(() => {});
    }, [user?.uid])
  );

  useEffect(() => {
    if (!user || !isFocused) return;
    const q = query(collection(db, 'notifications'), where('userId', '==', user.uid), limit(MOBILE_NOTIFICATION_QUERY_LIMIT));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as NotificationRow));
        rows.sort((a, b) => timestampToMillis(b.timestamp) - timestampToMillis(a.timestamp));
        setNotifications(rows.slice(0, 40));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [isFocused, user?.uid]);

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <ScreenHeader title="Notifications" subtitle="Requests, likes, and chat updates" onBack={() => navigation.goBack()} isDark={isDark} />
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <NotificationItem notification={item} navigation={navigation} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={COLORS.primaryStrong} style={{ marginTop: 50 }} />
          ) : (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIcon}>
                <Bell size={22} color="#111" />
              </View>
              <Text style={[styles.emptyText, { color: textColor(isDark) }]}>Inbox is quiet</Text>
              <Text style={[styles.emptySubText, { color: textColor(isDark, 'muted') }]}>
                When someone asks to connect, you can approve or ignore them here.
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingBottom: 40 },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    marginBottom: 10,
  },
  itemUnread: { borderColor: COLORS.lightBorderActive },
  avatarWrap: { width: 48, height: 48, marginRight: 12 },
  avatar: { width: 48, height: 48, borderRadius: 16 },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: 18, fontWeight: '800', color: '#111' },
  iconBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1 },
  contentText: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  timeText: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  noteBox: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8 },
  noteText: { fontSize: 13, fontWeight: '600', lineHeight: 18, fontStyle: 'italic' },
  requestActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  approveBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveText: { fontSize: 15, fontWeight: '800', color: '#111' },
  ignoreBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  ignoreText: { fontSize: 15, fontWeight: '800' },
  resolved: { marginTop: 8, fontSize: 13, fontWeight: '600' },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginLeft: 8,
    marginTop: 8,
  },
  emptyContainer: { alignItems: 'center', marginTop: 72, paddingHorizontal: 24 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyText: { fontSize: 20, fontWeight: '800' },
  emptySubText: { marginTop: 8, fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 20 },
});
