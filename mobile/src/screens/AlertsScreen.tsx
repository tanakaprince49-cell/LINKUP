import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
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
import { Bell, Eye, Heart, MessageSquare, UserPlus, Check, X, Sparkles } from 'lucide-react-native';
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
type ListRow = NotificationRow | { id: string; header: string };

const isHeaderRow = (row: ListRow): row is { id: string; header: string } =>
  typeof (row as any)?.header === 'string';

const NotificationItem = ({ notification, navigation }: { notification: NotificationRow; navigation: any }) => {
  const { theme } = useTheme();
  const { user, profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<'approved' | 'ignored' | null>(null);
  const isDark = theme === 'dark';
  const pic = safeProfileImageUri(notification.fromPic, MOBILE_LIST_IMAGE_LIMIT);
  const isRequest = notification.type === 'connection_request' && notification.requestId && notification.fromId && !resolved;
  const unread = notification.isRead === false;

  // Type-tinted icons: instant scannability — likes are warm, matches are
  // green, requests carry the brand accent, views are calm violet.
  const iconMeta = (() => {
    switch (notification.type) {
      case 'like':
        return { Icon: Heart, color: '#E11D48', bg: 'rgba(225,29,72,0.14)', fill: '#E11D48' };
      case 'match':
      case 'connection_approved':
        return { Icon: Check, color: '#16A34A', bg: 'rgba(22,163,74,0.14)', fill: 'transparent' };
      case 'message':
        return { Icon: MessageSquare, color: '#2563EB', bg: 'rgba(37,99,235,0.12)', fill: 'transparent' };
      case 'connection_request':
        return { Icon: UserPlus, color: COLORS.primaryStrong, bg: COLORS.primary + '26', fill: 'transparent' };
      case 'connection_rejected':
        return { Icon: X, color: '#EF4444', bg: 'rgba(239,68,68,0.12)', fill: 'transparent' };
      case 'view':
        return { Icon: Eye, color: '#7C3AED', bg: 'rgba(124,58,237,0.12)', fill: 'transparent' };
      default:
        return { Icon: Bell, color: textColor(isDark, 'muted'), bg: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', fill: 'transparent' };
    }
  })();

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
      style={[
        styles.item,
        liquidGlass(isDark, false),
        unread && [styles.itemUnread, { borderLeftColor: COLORS.primaryStrong }],
      ]}
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
          <View style={[styles.avatarFallback, { backgroundColor: iconMeta.bg }]}>
            <Text style={[styles.avatarLetter, { color: iconMeta.color }]}>{(notification.fromName || 'L').slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={[styles.iconBadge, { backgroundColor: iconMeta.bg, borderColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}>
          <iconMeta.Icon size={13} color={iconMeta.color} fill={iconMeta.fill} />
        </View>
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={[styles.fromName, { color: textColor(isDark) }]} numberOfLines={1}>
            {notification.fromName || 'Someone'}
          </Text>
          <Text style={[styles.timeText, { color: textColor(isDark, 'muted') }]}>{formatTimeAgo(notification.timestamp)}</Text>
        </View>
        <Text style={[styles.contentText, { color: textColor(isDark, 'secondary') }]} numberOfLines={3}>
          {notification.content}
        </Text>
        {notification.note ? (
          <View style={[styles.noteBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(251,230,24,0.16)' }]}>
            <Text style={[styles.noteText, { color: textColor(isDark) }]}>“{notification.note}”</Text>
          </View>
        ) : null}
        {isRequest ? (
          <View style={styles.requestActions}>
            <TouchableOpacity
              style={styles.approveBtn}
              disabled={busy}
              activeOpacity={0.9}
              onPress={(event: any) => {
                event?.stopPropagation?.();
                void respondToRequest(true);
              }}
            >
              {busy ? <ActivityIndicator color="#111" /> : <Text style={styles.approveText}>Approve</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.ignoreBtn, { borderColor: hairline(isDark) }]}
              disabled={busy}
              activeOpacity={0.85}
              onPress={(event: any) => {
                event?.stopPropagation?.();
                void respondToRequest(false);
              }}
            >
              <Text style={[styles.ignoreText, { color: textColor(isDark) }]}>{busy ? '…' : 'Ignore'}</Text>
            </TouchableOpacity>
          </View>
        ) : resolved ? (
          <View style={styles.resolvedRow}>
            <Check size={13} color={resolved === 'approved' ? '#16A34A' : textColor(isDark, 'muted')} />
            <Text style={[styles.resolved, { color: textColor(isDark, 'muted') }]}>
              {resolved === 'approved' ? 'Approved — you can chat now.' : 'Ignored.'}
            </Text>
          </View>
        ) : null}
      </View>
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

  // Requests get their own pinned section — they're the only items that need
  // a decision, so they never drown in likes/views noise.
  const requestRows = notifications.filter((n) => n.type === 'connection_request' && n.requestId && n.fromId);
  const activityRows = notifications.filter((n) => !requestRows.includes(n));
  const listData: ListRow[] = [
    ...(requestRows.length ? [{ id: 'hdr-requests', header: 'CONNECTION REQUESTS' } as ListRow] : []),
    ...requestRows,
    ...(activityRows.length ? [{ id: 'hdr-activity', header: 'ACTIVITY' } as ListRow] : []),
    ...activityRows,
  ];

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <ScreenHeader title="Notifications" subtitle="Requests, matches and momentum" onBack={() => navigation.goBack()} isDark={isDark} />
      <FlatList
        data={listData}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) =>
          isHeaderRow(item) ? (
            <Text style={[styles.sectionLabel, { color: textColor(isDark, 'muted') }]}>{item.header}</Text>
          ) : (
            <NotificationItem notification={item} navigation={navigation} />
          )
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={COLORS.primaryStrong} style={{ marginTop: 50 }} />
          ) : (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIcon, { backgroundColor: COLORS.primary + '1F' }]}>
                <Bell size={26} color={COLORS.primaryStrong} />
              </View>
              <Text style={[styles.emptyText, { color: textColor(isDark) }]}>Inbox is quiet</Text>
              <Text style={[styles.emptySubText, { color: textColor(isDark, 'muted') }]}>
                When someone asks to connect, likes you, or checks you out, it lands here. Go swipe a few builders.
              </Text>
              <View style={[styles.emptyHint, liquidGlass(isDark, false)]}>
                <Sparkles size={13} color={COLORS.primaryStrong} />
                <Text style={[styles.emptyHintText, { color: textColor(isDark, 'secondary') }]}>
                  Tip: build-log posts and full profiles get you noticed faster.
                </Text>
              </View>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginTop: 18,
    marginBottom: 8,
    marginLeft: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    marginBottom: 10,
    borderRadius: 18,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  itemUnread: {
    borderLeftWidth: 3,
  },
  avatarWrap: { width: 52, height: 52, marginRight: 12 },
  avatar: { width: 52, height: 52, borderRadius: 18 },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: 20, fontWeight: '900' },
  iconBadge: {
    position: 'absolute',
    right: -5,
    bottom: -5,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  content: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  fromName: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  contentText: { fontSize: 13.5, fontWeight: '600', lineHeight: 19, marginTop: 2 },
  timeText: { fontSize: 11.5, fontWeight: '700' },
  noteBox: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginTop: 9 },
  noteText: { fontSize: 13, fontWeight: '600', lineHeight: 18, fontStyle: 'italic' },
  requestActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  approveBtn: {
    flex: 1.2,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveText: { fontSize: 14, fontWeight: '900', color: '#111' },
  ignoreBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ignoreText: { fontSize: 14, fontWeight: '800' },
  resolvedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 9 },
  resolved: { fontSize: 12.5, fontWeight: '700' },
  emptyContainer: { alignItems: 'center', marginTop: 72, paddingHorizontal: 28 },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyText: { fontSize: 20, fontWeight: '900' },
  emptySubText: { marginTop: 8, fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 20 },
  emptyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  emptyHintText: { fontSize: 12.5, fontWeight: '700' },
});
