import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, ActivityIndicator, Dimensions } from 'react-native';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { AppNotification } from '../types';
import { Bell, Heart, Zap, User, Sparkles, MessageSquare, Shield } from 'lucide-react-native';

const { width } = Dimensions.get('window');

const NotificationItem = ({ notification, index }: { notification: AppNotification, index: number }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const getIcon = () => {
    switch (notification.type) {
      case 'like': return <Heart size={18} color="#FBE618" fill="#FBE61820" />;
      case 'match': return <Zap size={18} color="#FBE618" fill="#FBE61820" />;
      case 'system': return <Sparkles size={18} color="#FBE618" />;
      default: return <Bell size={18} color="#FBE618" />;
    }
  };

  return (
    <View style={[styles.item, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
      <View style={styles.iconContainer}>
        {getIcon()}
      </View>
      <View style={styles.content}>
        <Text style={[styles.contentText, { color: isDark ? '#FFF' : '#000' }]}>{notification.content}</Text>
        <Text style={styles.timeText}>MOMENTS AGO</Text>
      </View>
      {!notification.isRead && <View style={styles.unreadDot} />}
    </View>
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
      setNotifications(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AppNotification)));
      setLoading(false);
    }, (err) => {
        console.error("Notifications error:", err);
        setLoading(false);
    });
    return () => unsub();
  }, [user]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => <NotificationItem notification={item} index={index} />}
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
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: '#FBE61810',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
    borderWidth: 1,
    borderColor: '#FBE61820',
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
    color: '#666',
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
    shadowColor: '#FBE618',
    shadowOpacity: 0.5,
    shadowRadius: 5,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 100,
    gap: 16,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#444',
    letterSpacing: 2,
  },
  emptySubText: {
    fontSize: 10,
    color: '#222',
    fontWeight: '900',
  }
});
