import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, query, where, onSnapshot, doc, updateDoc, orderBy, limit } from 'firebase/firestore';
import { useFocusEffect } from '@react-navigation/native';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { AppNotification } from '../types';
import { markUnreadNotificationsRead } from '../lib/notifications';
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
  const isDark = theme === 'dark';

  const getIcon = () => {
    switch (notification.type) {
      case 'like': return <Heart size={18} color="#FBE618" fill="#FBE61820" />;
      case 'match': return <Zap size={18} color="#FBE618" fill="#FBE61820" />;
      case 'message': return <MessageSquare size={18} color="#2563EB" />;
      case 'comment': return <MessageSquare size={18} color="#F97316" />;
      case 'view': return <Eye size={18} color="#22C55E" />;
      case 'system': return <Sparkles size={18} color="#FBE618" />;
      default: return <Bell size={18} color="#FBE618" />;
    }
  };

  return (
    <TouchableOpacity 
      style={[styles.item, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#E2E8F0', shadowColor: isDark ? '#000' : '#E2E8F0', shadowOpacity: isDark ? 0 : 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: isDark ? 0 : 2 }]}
      onPress={async () => {
        try {
          if (notification?.id && notification?.isRead === false) {
            await updateDoc(doc(db, 'notifications', notification.id), { isRead: true });
          }
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
                  profilePic: notification.fromPic || '',
                }
              : undefined,
          });
          return;
        }

        if (
          notification.type === 'system' &&
          (notification.content?.startsWith('AI Opportunity') || notification.content?.startsWith('AI Project Match')) &&
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
      <View style={styles.iconContainer}>
        {notification.fromPic ? (
          <Image source={{ uri: notification.fromPic }} style={{ width: 44, height: 44, borderRadius: 22 }} />
        ) : getIcon()}
        
        {notification.fromPic && (
          <View style={{ position: 'absolute', bottom: -4, right: -4, backgroundColor: isDark ? '#111115' : '#FFF', borderRadius: 10, padding: 2 }}>
            {getIcon()}
          </View>
        )}
      </View>
      <View style={styles.content}>
        <Text style={[styles.contentText, { color: isDark ? '#FFF' : '#334155' }]}>
          <Text style={{ fontWeight: 'bold', color: isDark ? '#FFF' : '#0F172A' }}>{notification.fromName || 'Someone'} </Text>
          {notification.content}
        </Text>
        <Text style={styles.timeText}>{formatTimeAgo(notification.timestamp)}</Text>
      </View>
      {!notification.isRead && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
};

export default function AlertsScreen({ navigation }: any) {
  const { user } = useAuth();
  const { theme } = useTheme();
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
    if (!user) return;
    const q = query(
      collection(db, 'notifications'), 
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc'),
      limit(75)
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
  }, [user]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#F8FAFC' }]}>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <NotificationItem notification={item} navigation={navigation} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? <ActivityIndicator color="#FBE618" style={{ marginTop: 50 }} /> : (
            <View style={styles.emptyContainer}>
              <Bell size={48} color="#222" />
              <Text style={styles.emptyText}>NO NEW NOTIFICATIONS</Text>
              <Text style={styles.emptySubText}>STAY ACTIVE TO RECEIVE UPDATES</Text>
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
    color: '#3B82F6',
    marginTop: 4,
    fontWeight: '900',
    letterSpacing: 1,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FBE618',
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
    color: '#444',
    letterSpacing: 2,
    marginTop: 16,
  },
  emptySubText: {
    fontSize: 10,
    color: '#222',
    fontWeight: '900',
  }
});
