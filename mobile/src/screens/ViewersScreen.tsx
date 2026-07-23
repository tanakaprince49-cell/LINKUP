import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, doc, FieldPath, getDoc, limit, onSnapshot, query, where } from 'firebase/firestore';
import { Bookmark, ChevronLeft, Eye, Gauge, MessageSquare, MousePointerClick, UserPlus } from 'lucide-react-native';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile } from '../types';
import VerifiedBadge from '../components/VerifiedBadge';
import PaywallModal from '../components/PaywallModal';
import { isAndroidProLocked, PRO_FEATURES } from '../lib/paywall';
import { compactProfileForList, safeProfileImageUri } from '../lib/profilePerformance';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';

type AnalyticsMode = 'views' | 'clicks' | 'saves' | 'response';

type AnalyticsEventRow = {
  viewerId: string;
  viewerName?: string;
  viewerPic?: string;
  eventTime?: any;
  action?: string;
  eventLabel?: string;
  matchId?: string;
};

type ViewerProfile = UserProfile & {
  analyticsMode?: AnalyticsMode;
  eventTime?: any;
  eventLabel?: string;
  action?: string;
  matchId?: string;
};

const ANALYTICS_LIST_LIMIT = 75;
const FALLBACK_AVATAR = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100';
const isPermissionDenied = (error: any) => String(error?.code || '').includes('permission-denied');

const MODE_META: Record<AnalyticsMode, any> = {
  views: {
    label: 'Views',
    title: 'WHO VIEWED YOU',
    subtitle: 'Live profile viewers',
    empty: 'NO RECENT VIEWERS',
    emptySub: 'Profile views will appear here in real time.',
    Icon: Eye,
  },
  clicks: {
    label: 'Clicks',
    title: 'PROFILE CLICKS',
    subtitle: 'Builders tapping your profile actions',
    empty: 'NO RECENT CLICKS',
    emptySub: 'Profile taps, message taps, and save taps will appear here.',
    Icon: MousePointerClick,
  },
  saves: {
    label: 'Saves',
    title: 'PROFILE SAVES',
    subtitle: 'Builders who saved you',
    empty: 'NO RECENT SAVES',
    emptySub: 'When someone saves your profile, they show up here.',
    Icon: Bookmark,
  },
  response: {
    label: 'Response',
    title: 'RESPONSE RATE',
    subtitle: 'Message threads counted live',
    empty: 'NO ACTIVE THREADS',
    emptySub: 'Your response analytics appear once conversations start.',
    Icon: Gauge,
  },
};

const sanitizeMode = (value: any): AnalyticsMode => {
  if (value === 'clicks' || value === 'saves' || value === 'response') return value;
  return 'views';
};

const timeValue = (timestamp: any) => {
  if (!timestamp) return 0;
  if (timestamp?.toMillis) return timestamp.toMillis();
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const value = date.getTime();
  return Number.isFinite(value) ? value : 0;
};

const formatTimeAgo = (timestamp: any) => {
  const time = timeValue(timestamp);
  if (!time) return 'Recently';
  const diff = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const actionLabel = (action?: string) => {
  switch (String(action || '').toLowerCase()) {
    case 'message':
      return 'Tapped message';
    case 'save':
      return 'Tapped save';
    case 'profile':
      return 'Opened your profile';
    default:
      return 'Clicked your profile';
  }
};

const eventLabelFor = (mode: AnalyticsMode, row: AnalyticsEventRow) => {
  if (row.eventLabel) return row.eventLabel;
  if (mode === 'clicks') return actionLabel(row.action);
  if (mode === 'saves') return 'Saved your profile';
  if (mode === 'response') return 'Conversation thread';
  return 'Viewed your profile';
};

const sortRows = (rows: AnalyticsEventRow[]) =>
  [...rows].sort((a, b) => timeValue(b.eventTime) - timeValue(a.eventTime));

const profileFromEvent = (row: AnalyticsEventRow, mode: AnalyticsMode): ViewerProfile => ({
  uid: row.viewerId,
  displayName: row.viewerName || '@builder',
  username: '',
  bio: eventLabelFor(mode, row),
  profilePic: safeProfileImageUri(row.viewerPic) || '',
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
  lastActiveAt: row.eventTime,
  createdAt: row.eventTime,
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
  analyticsMode: mode,
  eventTime: row.eventTime,
  eventLabel: eventLabelFor(mode, row),
  action: row.action,
  matchId: row.matchId,
} as unknown as ViewerProfile);

export default function ViewersScreen({ navigation, route }: any) {
  const { profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const requestedMode = sanitizeMode(route?.params?.mode);
  const [mode, setMode] = useState<AnalyticsMode>(requestedMode);
  const [rows, setRows] = useState<ViewerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const proLocked = isAndroidProLocked(profile);
  const analyticsLocked = proLocked && mode !== 'views';
  const meta = MODE_META[mode];
  const HeaderIcon = meta.Icon;

  useEffect(() => {
    setMode(requestedMode);
  }, [requestedMode]);

  const responseRate = useMemo(() => {
    if (mode !== 'response' || rows.length === 0) return null;
    const handled = rows.filter((row) => !String(row.eventLabel || '').toLowerCase().includes('awaiting')).length;
    return Math.round((handled / rows.length) * 100);
  }, [mode, rows]);

  useEffect(() => {
    if (analyticsLocked || !profile?.uid) {
      setRows([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadProfiles = async (eventRows: AnalyticsEventRow[]) => {
      const visibleRows = sortRows(eventRows.filter((row) => row.viewerId && row.viewerId !== profile.uid)).slice(0, 50);
      if (visibleRows.length === 0) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }

      try {
        const nextRows = await Promise.all(
          visibleRows.map(async (row) => {
            try {
              const snap = await getDoc(doc(db, 'users', row.viewerId));
              if (snap.exists()) {
                const compact = compactProfileForList({ uid: snap.id, ...(snap.data() as any) });
                return {
                  ...compact,
                  analyticsMode: mode,
                  eventTime: row.eventTime,
                  eventLabel: eventLabelFor(mode, row),
                  action: row.action,
                  matchId: row.matchId,
                } as ViewerProfile;
              }
            } catch (error) {
              if (!isPermissionDenied(error)) {
                console.warn('Analytics profile unavailable, using event fallback:', error);
              }
            }
            return profileFromEvent(row, mode);
          })
        );
        if (!cancelled) {
          setRows(nextRows);
          setLoading(false);
        }
      } catch (error) {
        console.warn('Could not load profile analytics rows:', error);
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
      }
    };

    setLoading(true);

    if (mode === 'views') {
      const viewsQuery = query(collection(db, 'profileViews'), where('profileId', '==', profile.uid), limit(ANALYTICS_LIST_LIMIT));
      const unsubscribe = onSnapshot(
        viewsQuery,
        (snap) => {
          const viewRows = snap.docs.map((d) => {
            const data = d.data() as any;
            return {
              viewerId: data.viewerId,
              viewerName: data.viewerName,
              viewerPic: data.viewerPic,
              eventTime: data.lastViewedAt || data.createdAt,
            };
          });
          const eventIds = viewRows.map((row) => row.viewerId);
          const fallbackRows = (Array.isArray(profile.viewedBy) ? profile.viewedBy : [])
            .filter((uid) => uid !== profile.uid && !eventIds.includes(uid))
            .map((uid) => ({ viewerId: uid, eventLabel: 'Viewed your profile' }));
          loadProfiles([...viewRows, ...fallbackRows]);
        },
        (error) => {
          if (!isPermissionDenied(error)) console.warn('Profile viewers unavailable:', error);
          const fallbackRows = (Array.isArray(profile.viewedBy) ? profile.viewedBy : [])
            .filter((uid) => uid !== profile.uid)
            .map((uid) => ({ viewerId: uid, eventLabel: 'Viewed your profile' }));
          loadProfiles(fallbackRows);
        }
      );
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }

    if (mode === 'clicks') {
      const clicksQuery = query(collection(db, 'profileClicks'), where('profileId', '==', profile.uid), limit(ANALYTICS_LIST_LIMIT));
      const unsubscribe = onSnapshot(
        clicksQuery,
        (snap) => {
          const clickRows = snap.docs.map((d) => {
            const data = d.data() as any;
            return {
              viewerId: data.viewerId,
              viewerName: data.viewerName,
              viewerPic: data.viewerPic,
              action: data.action,
              eventTime: data.lastClickedAt || data.createdAt,
            };
          });
          loadProfiles(clickRows);
        },
        (error) => {
          if (!isPermissionDenied(error)) console.warn('Profile clicks unavailable:', error);
          loadProfiles([]);
        }
      );
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }

    if (mode === 'saves') {
      const savesQuery = query(collection(db, 'savedProfiles'), where('profileId', '==', profile.uid), limit(ANALYTICS_LIST_LIMIT));
      const unsubscribe = onSnapshot(
        savesQuery,
        (snap) => {
          const saveRows = snap.docs.map((d) => {
            const data = d.data() as any;
            return {
              viewerId: data.ownerId,
              viewerName: data.ownerName,
              viewerPic: data.ownerPic,
              eventTime: data.updatedAt || data.createdAt,
              eventLabel: 'Saved your profile',
            };
          });
          loadProfiles(saveRows);
        },
        (error) => {
          if (!isPermissionDenied(error)) console.warn('Profile saves unavailable:', error);
          loadProfiles([]);
        }
      );
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }

    const matchesQuery = query(
      collection(db, 'matches'),
      where(new FieldPath('participants', profile.uid), '==', true),
      limit(ANALYTICS_LIST_LIMIT)
    );
    const unsubscribe = onSnapshot(
      matchesQuery,
      (snap) => {
        const responseRows = snap.docs
          .map((matchDoc) => {
            const data = matchDoc.data() as any;
            if (!data.lastMessage && !data.lastMessageTime) return null;
            const userIds = Array.isArray(data.userIds)
              ? data.userIds
              : Object.keys(data.participants || {}).filter((uid) => data.participants?.[uid]);
            const otherId = userIds.find((uid: string) => uid && uid !== profile.uid);
            if (!otherId) return null;
            const unread = Number(data.unreadBy?.[profile.uid] || 0);
            return {
              viewerId: otherId,
              eventTime: data.lastMessageTime || data.updatedAt || data.createdAt,
              eventLabel: unread > 0 ? `Awaiting your reply: ${unread} unread` : 'Handled conversation',
              matchId: matchDoc.id,
            } as AnalyticsEventRow;
          })
          .filter(Boolean) as AnalyticsEventRow[];
        loadProfiles(responseRows);
      },
      (error) => {
        if (!isPermissionDenied(error)) console.warn('Response analytics unavailable:', error);
        loadProfiles([]);
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [mode, analyticsLocked, profile?.uid, Array.isArray(profile?.viewedBy) ? profile.viewedBy.join('|') : '']);

  const openRow = (item: ViewerProfile) => {
    if (item.analyticsMode === 'response' && item.matchId) {
      navigation.navigate('Chat', { matchId: item.matchId, otherUser: item });
      return;
    }
    navigation.navigate('Profile', { userId: item.uid });
  };

  const renderViewer = ({ item }: { item: ViewerProfile }) => {
    const RowIcon = item.analyticsMode === 'response' ? MessageSquare : UserPlus;
    return (
      <TouchableOpacity
        style={[styles.viewerCard, liquidGlass(isDark, false)]}
        onPress={() => openRow(item)}
        activeOpacity={0.84}
      >
        <Image source={{ uri: safeProfileImageUri(item.profilePic) || FALLBACK_AVATAR }} style={styles.avatar} />
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: textColor(isDark) }]} numberOfLines={1}>
              {item.displayName || '@builder'}
            </Text>
            {!!item.isVerified && <VerifiedBadge size={20} />}
          </View>
          <Text style={styles.bio} numberOfLines={1}>{item.eventLabel || item.bio || 'Building the future'}</Text>
          <Text style={styles.timeText}>{formatTimeAgo(item.eventTime)}</Text>
        </View>
        <RowIcon size={20} color={COLORS.primary} />
      </TouchableOpacity>
    );
  };

  if (analyticsLocked) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}>
        <PaywallModal
          visible
          feature={PRO_FEATURES.profileViewers}
          description="Who viewed your profile is free. LINKUP PLUS unlocks clicks, saves, and response analytics."
          onClose={() => navigation.goBack()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.8}>
          <ChevronLeft size={24} color={textColor(isDark)} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: textColor(isDark) }]}>{meta.title}</Text>
          <Text style={styles.subtitle}>
            {responseRate === null ? meta.subtitle : `${responseRate}% response rate across active threads`}
          </Text>
        </View>
        <View style={styles.headerBadge}>
          <HeaderIcon size={17} color="#000" />
        </View>
      </View>

      <View style={styles.tabs}>
        {(Object.keys(MODE_META) as AnalyticsMode[]).map((tabMode) => {
          const tab = MODE_META[tabMode];
          const TabIcon = tab.Icon;
          const active = tabMode === mode;
          return (
            <TouchableOpacity
              key={tabMode}
              style={[styles.tab, active && styles.tabActive, { borderColor: active ? '#000' : (isDark ? COLORS.darkBorder : COLORS.lightBorder) }]}
              onPress={() => setMode(tabMode)}
              activeOpacity={0.82}
            >
              <TabIcon size={14} color={active ? '#000' : '#777'} />
              <Text style={[styles.tabText, { color: active ? '#000' : '#777' }]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={rows}
          renderItem={renderViewer}
          keyExtractor={(item, index) => `${item.analyticsMode || mode}-${item.uid}-${timeValue(item.eventTime)}-${index}`}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <HeaderIcon size={48} color={textColor(isDark, 'secondary')} />
              <Text style={[styles.emptyText, { color: textColor(isDark) }]}>{meta.empty}</Text>
              <Text style={styles.emptySub}>{meta.emptySub}</Text>
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
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    gap: 14,
  },
  backBtn: {
    padding: 4,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 15,
    color: '#777',
    fontWeight: '800',
  },
  headerBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabActive: {
    backgroundColor: COLORS.primary,
  },
  tabText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  list: {
    padding: 20,
    paddingTop: 6,
  },
  viewerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    gap: 16,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
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
  bio: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  timeText: {
    fontSize: 10,
    color: COLORS.primary,
    fontWeight: '900',
    marginTop: 4,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  empty: {
    alignItems: 'center',
    marginTop: 100,
    gap: 16,
    paddingHorizontal: 20,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.4,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 11,
    lineHeight: 16,
    color: '#666',
    fontWeight: '800',
    textAlign: 'center',
  },
});
