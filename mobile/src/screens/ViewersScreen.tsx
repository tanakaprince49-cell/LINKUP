import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, query, where, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile } from '../types';
import { BadgeCheck, ChevronLeft, Eye, UserPlus } from 'lucide-react-native';

type ProfileViewRow = {
  viewerId: string;
  viewerName?: string;
  viewerPic?: string;
  lastViewedAt?: any;
};

type ViewerProfile = UserProfile & { lastViewedAt?: any };

const formatTimeAgo = (timestamp: any) => {
  if (!timestamp) return 'Recently';
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export default function ViewersScreen({ navigation }: any) {
  const { profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [viewers, setViewers] = useState<ViewerProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.uid) {
      setLoading(false);
      return;
    }

    const loadViewerProfiles = async (viewRows: ProfileViewRow[]) => {
      try {
        const viewerProfiles = await Promise.all(
          viewRows.slice(0, 50).map(async (row) => {
            try {
              const snap = await getDoc(doc(db, 'users', row.viewerId));
              if (snap.exists()) {
                return {
                  uid: snap.id,
                  ...(snap.data() as any),
                  lastViewedAt: row.lastViewedAt,
                } as ViewerProfile;
              }
            } catch (error) {
              console.warn('Viewer profile unavailable, using view event fallback:', error);
            }

            return {
              uid: row.viewerId,
              displayName: row.viewerName || '@builder',
              username: '',
              bio: 'Viewed your profile',
              profilePic: row.viewerPic || '',
              city: '',
              country: '',
              age: 0,
              skills: [],
              interests: [],
              goals: '',
              experience: '',
              personalityType: '',
              commitmentLevel: '',
              industries: [],
              ambition: '',
              reputationScore: 0,
              streakCount: 0,
              onboarded: true,
              isVisible: true,
              isBot: false,
              lastActiveAt: row.lastViewedAt,
              createdAt: row.lastViewedAt,
              socialLinks: {},
              resume: {
                shippedProducts: [],
                sideProjects: [],
                startupAttempts: [],
                hackathonWins: [],
                buildStreaks: 0,
              },
              badges: [],
              projects: [],
              viewedBy: [],
              isStealthMode: false,
              hasExit: false,
              lastViewedAt: row.lastViewedAt,
            } as ViewerProfile;
          })
        );
        setViewers(viewerProfiles);
      } catch (e) {
        console.warn('Could not load viewer profiles:', e);
        setViewers([]);
      } finally {
        setLoading(false);
      }
    };

    setLoading(true);
    const viewsQuery = query(collection(db, 'profileViews'), where('profileId', '==', profile.uid));
    const unsub = onSnapshot(
      viewsQuery,
      (snap) => {
        const viewRows = snap.docs
          .map((d) => d.data() as ProfileViewRow)
          .filter((row) => row.viewerId && row.viewerId !== profile.uid);
        viewRows.sort((a, b) => {
          const left = a.lastViewedAt?.toMillis ? a.lastViewedAt.toMillis() : new Date(a.lastViewedAt || 0).getTime();
          const right = b.lastViewedAt?.toMillis ? b.lastViewedAt.toMillis() : new Date(b.lastViewedAt || 0).getTime();
          return right - left;
        });
        const eventIds = viewRows.map((row) => row.viewerId);
        const fallbackRows = (Array.isArray(profile.viewedBy) ? profile.viewedBy : [])
          .filter((uid) => uid !== profile.uid && !eventIds.includes(uid))
          .map((uid) => ({ viewerId: uid } as ProfileViewRow));
        const rows = [...viewRows, ...fallbackRows];
        if (rows.length === 0) {
          setViewers([]);
          setLoading(false);
          return;
        }
        loadViewerProfiles(rows);
      },
      (error) => {
        console.warn('Profile analytics events unavailable:', error);
        const fallbackRows = (Array.isArray(profile.viewedBy) ? profile.viewedBy : [])
          .filter((uid) => uid !== profile.uid)
          .map((uid) => ({ viewerId: uid } as ProfileViewRow));
        if (fallbackRows.length === 0) {
          setViewers([]);
          setLoading(false);
          return;
        }
        loadViewerProfiles(fallbackRows);
      }
    );

    return () => unsub();
  }, [profile?.uid, Array.isArray(profile?.viewedBy) ? profile.viewedBy.join('|') : '']);

  const renderViewer = ({ item }: { item: ViewerProfile }) => (
    <TouchableOpacity 
      style={[styles.viewerCard, { backgroundColor: isDark ? '#111115' : '#F8F8F8' }]}
      onPress={() => navigation.navigate('Profile', { userId: item.uid })}
    >
      <Image source={{ uri: item.profilePic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100' }} style={styles.avatar} />
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>{item.displayName}</Text>
          {!!item.isVerified && (
            <View style={styles.verifiedMiniBadge}>
              <BadgeCheck size={12} color="#000" fill="#FBE618" />
            </View>
          )}
        </View>
        <Text style={styles.bio} numberOfLines={1}>{item.bio || 'Building the future'}</Text>
        <Text style={styles.timeText}>{formatTimeAgo(item.lastViewedAt)}</Text>
      </View>
      <UserPlus size={20} color="#FBE618" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft size={24} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: isDark ? '#FFF' : '#000' }]}>WHO VIEWED YOU</Text>
      </View>

      {loading ? <ActivityIndicator color="#FBE618" style={{ marginTop: 50 }} /> : (
        <FlatList
          data={viewers}
          renderItem={renderViewer}
          keyExtractor={item => item.uid}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Eye size={48} color="#222" />
              <Text style={styles.emptyText}>NO RECENT VIEWERS</Text>
              <Text style={styles.emptySub}>START POSTING TO GET NOTICED</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  backBtn: {
    padding: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
  },
  list: {
    padding: 20,
  },
  viewerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    marginBottom: 12,
    gap: 16,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 18,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
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
  bio: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  timeText: {
    fontSize: 10,
    color: '#2563EB',
    fontWeight: '900',
    marginTop: 4,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  empty: {
    alignItems: 'center',
    marginTop: 100,
    gap: 16,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#222',
    letterSpacing: 2,
  },
  emptySub: {
    fontSize: 10,
    color: '#666',
    fontWeight: '900',
  }
});
