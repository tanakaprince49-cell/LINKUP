import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, query, where, onSnapshot, doc, updateDoc, limit } from 'firebase/firestore';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { AppNotification } from '../types';
import { markUnreadNotificationsRead } from '../lib/notifications';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { respondToConnectionRequest } from '../lib/connectionRequests';
import { MOBILE_LIST_IMAGE_LIMIT, MOBILE_NOTIFICATION_QUERY_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';
import { Bell, Eye, Heart, MessageSquare, Sparkles, Zap } from 'lucide-react-native';

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

const NotificationItem = ({ notification, navigation }: { notification: NotificationRow, navigation: any }) => {
  const { theme } = useTheme();
  const { user, profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const isDark = theme === 'dark';

  const getIcon = () => {
    switch (notification.type) {
      case 'like': return <Heart size={18} color={COLORS.primary} fill={`${COLORS.primary}20`} />;
      case 'match': return <Zap size={18} color={COLORS.primary} fill={`${COLORS.primary}20`} />;
      case 'message': return <MessageSquare size={18} color={COLORS.secondary} />;
      case 'connection_request': return <MessageSquare size={18} color={COLORS.primary} />;
      case 'connection_approved': return <Zap size={18} color={COLORS.success} fill={`${COLORS.success}20`} />;
      case 'connection_rejected': return <MessageSquare size={18} color={COLORS.danger} />;
      case 'comment': return <MessageSquare size={18} color={COLORS.warning} />;
      case 'view': return <Eye size={18} color={COLORS.success} />;
      case 'system': return <Sparkles size={18} color={COLORS.primary} />;
      default: return <Bell size={18} color={COLORS.primary} />;
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

      if (approved && result.matchId) {
        navigation.navigate('Chat', {
          matchId: result.matchId,
          otherUser: {
            uid: notification.fromId,
            displayName: notification.fromName || 'Builder',
            profilePic: safeProfileImageUri(notification.fromPic, MOBILE_LIST_IMAGE_LIMIT),
          },
        });
      } else {
        Alert.alert('Request rejected', `${notification.fromName || 'This builder'} will be notified.`);
      }
    } catch (error) {
      console.warn('Connection request response failed:', error);
      Alert.alert('Action failed', 'Could not answer this request. Check Firebase rules and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity 
      style={[styles.item, liquidGlass(isDark, false), { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
      onPress={async () => {
        try {
          await markRead();
        } catch (e) {
          console.error('Mark notification read error:', e);
        }

        if (notification.matchId) {
          navigation.navigate('Chat', {
            matchId: notification.matchId,
            otherUser: notification.fromId
              ? {
                  uid: notification.fromId,
                  displayName: notification.fromName || 'Builder',
                  profilePic: safeProfileImageUri(notification.fromPic, MOBILE_LIST_IMAGE_LIMIT),
                }
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

        if (notification.fromId) {
          navigation.navigate('Profile', { userId: notification.fromId });
        }
      }}
    >
      <View style={[styles.iconContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.22)', borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}> 
        {safeProfileImageUri(notification.fromPic, MOBILE_LIST_IMAGE_LIMIT) ? (
          <Image source={{ uri: safeProfileImageUri(notification.fromPic, MOBILE_LIST_IMAGE_LIMIT) }} style={{ width: 44, height: 44, borderRadius: 22 }} />
        ) : getIcon()}
        
        {safeProfileImageUri(notification.fromPic, MOBILE_LIST_IMAGE_LIMIT) && (
          <View style={{ position: 'absolute', bottom: -4, right: -4, backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderRadius: 10, padding: 2 }}>
            {getIcon()}
          </View>
        )}
      </View>
      <View style={styles.content}>
        <Text style={[styles.contentText, { color: textColor(isDark) }]}>
          <Text style={{ fontWeight: '900', color: textColor(isDark) }}>{notification.fromName || 'Someone'} </Text>
          {notification.content}
        </Text>
        <Text style={styles.timeText}>{formatTimeAgo(notification.timestamp)}</Text>
        {notification.type === 'connection_request' && notification.requestId && notification.fromId && (
          <View style={styles.requestActions}>
            <TouchableOpacity
              style={[styles.requestActionBtn, styles.rejectBtn]}
              disabled={busy}
              onPress={(event: any) => {
                event?.stopPropagation?.();
                void respondToRequest(false);
              }}
            >
              <Text style={[styles.requestActionText, styles.rejectText]}>{busy ? '...' : 'REJECT'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.requestActionBtn, styles.approveBtn]}
              disabled={busy}
              onPress={(event: any) => {
                event?.stopPropagation?.();
                void respondToRequest(true);
              }}
            >
              <Text style={[styles.requestActionText, styles.approveText]}>{busy ? '...' : 'APPROVE'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {!notification.isRead && <View style={styles.unreadDot} />}
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
      markUnreadNotificationsRead(user.uid).catch((error) => {
        console.warn('Could not clear notification badge:', error);
      });
    }, [user?.uid])
  );

  useEffect(() => {
    if (!user || !isFocused) return;
    const q = query(
      collection(db, 'notifications'), 
      where('userId', '==', user.uid),
      limit(MOBILE_NOTIFICATION_QUERY_LIMIT)
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as NotificationRow));
      rows.sort((a, b) => timestampToMillis(b.timestamp) - timestampToMillis(a.timestamp));
      setNotifications(rows.slice(0, 30));
      setLoading(false);
    }, (err) => {
        console.warn("Notifications unavailable:", err);
        setLoading(false);
    });
    return () => unsub();
  }, [isFocused, user?.uid]);

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <NotificationItem notification={item} navigation={navigation} />}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={80}
        windowSize={6}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 50 }} /> : (
            <View style={styles.emptyContainer}>
              <Bell size={48} color={textColor(isDark, 'secondary')} />
              <Text style={[styles.emptyText, { color: textColor(isDark) }]}>NO NEW NOTIFICATIONS</Text>
              <Text style={[styles.emptySubText, { color: textColor(isDark, 'secondary') }]}>STAY ACTIVE TO RECEIVE UPDATES</Text>
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
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 24,
    marginBottom: 12,
    borderWidth: 1,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  content: {
    flex: 1,
  },
  contentText: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  timeText: {
    fontSize: 9,
    color: COLORS.primary,
    marginTop: 4,
    fontWeight: '900',
    letterSpacing: 1,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  requestActionBtn: {
    flex: 1,
    minHeight: 34,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  approveBtn: {
    backgroundColor: COLORS.primary,
    borderColor: 'transparent',
  },
  rejectBtn: {
    backgroundColor: COLORS.darkCard,
    borderColor: COLORS.darkBorder,
  },
  requestActionText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  approveText: {
    color: '#000',
  },
  rejectText: {
    color: COLORS.darkTextPrimary,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    marginLeft: 10,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 100,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 16,
  },
  emptySubText: {
    fontSize: 10,
    fontWeight: '900',
  }
});
