import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { AppNotification } from '../types';
import { Bell, Heart, Zap, User } from 'lucide-react-native';

const NotificationItem = ({ notification }: { notification: AppNotification }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const getIcon = () => {
    switch (notification.type) {
      case 'like': return <Heart size={20} color="#FBE618" fill="#FBE618" />;
      case 'match': return <Zap size={20} color="#FBE618" fill="#FBE618" />;
      default: return <Bell size={20} color="#FBE618" />;
    }
  };

  return (
    <TouchableOpacity style={[styles.item, { backgroundColor: isDark ? '#111111' : '#F8F8F8', borderColor: isDark ? '#222222' : '#EEEEEE' }]}>
      <View style={styles.iconContainer}>
        {getIcon()}
      </View>
      <View style={styles.content}>
        <Text style={[styles.contentText, { color: isDark ? '#FFFFFF' : '#000000' }]}>{notification.content}</Text>
        <Text style={styles.timeText}>Just now</Text>
      </View>
      {!notification.isRead && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
};

export default function AlertsScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'notifications'), 
      where('userId', '==', user.uid),
      limit(20)
    );
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AppNotification));
      setNotifications(data);
      setLoading(false);
    }, (err) => {
        console.error("Notifications error:", err);
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
          Your<Text style={{ color: '#FBE618' }}>Alerts</Text>
        </Text>
      </View>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <NotificationItem notification={item} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={{ color: isDark ? '#444444' : '#999999', fontWeight: '700' }}>No notifications yet.</Text>
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
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 24,
    marginBottom: 12,
    borderWidth: 1,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FBE61810',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  content: {
    flex: 1,
  },
  contentText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  timeText: {
    fontSize: 10,
    color: '#666666',
    marginTop: 4,
    fontWeight: '600',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FBE618',
    marginLeft: 10,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    marginTop: 100,
  },
});
