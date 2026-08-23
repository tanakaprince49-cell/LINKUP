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

import { compactProfileForList, safeProfileImageUri } from '../lib/profilePerformance';
import { AppImage } from '../components/AppImage';
import { ikAvatar } from '../lib/ikImage';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import ProCrownBadge from '../components/ProCrownBadge';

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
const FALLBACK_AVATAR = 'https://ui-avatars.com/api/?name=+&background=E5E7EB&color=9CA3AF&size=256';
const isPermissionDenied = (error: any) => String(error?.code || '').includes('permission-denied');

const MODE_META: Record<AnalyticsMode, any> = {
  views: {
    label: 'Views',
    title: 'Profile Views',
    subtitle: 'Everyone who viewed your profile',
    empty: 'No viewers yet',
    emptySub: 'Profile views will appear here in real time.',
    Icon: Eye,
  },
  clicks: {
    label: 'Clicks',
    title: 'Profile Clicks',
    subtitle: 'Builders who tapped your actions',
    empty: 'No clicks yet',
    emptySub: 'Profile taps, message taps, and save taps show up here.',
    Icon: MousePointerClick,
  },
  saves: {
    label: 'Saves',
    title: 'Profile Saves',
    subtitle: 'Builders who saved your profile',
    empty: 'No saves yet',
    emptySub: 'When someone saves your profile, they appear here.',
    Icon: Bookmark,
  },
  response: {
    label: 'Response',
    title: 'Response Rate',
    subtitle: 'Your conversation response activity',
    empty: 'No active threads',
    emptySub: 'Response analytics appear once conversations start.',
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

// Compact `publicProfiles` docs are far smaller than full `users` docs
// (trimmed fields, bounded image payloads), so try the index first and only
// fall back to the heavy `users` read when the index entry is missing.
const loadViewerProfileSnap = async (uid: string) => {
  const publicSnap = await getDoc(doc(db, 'publicProfiles', uid)).catch(() => null);
  if (publicSnap?.exists()) return publicSnap;
  return getDoc(doc(db, 'users', uid));
};

function ViewersScreen({ navigation, route }: any) {
  const { profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const requestedMode = sanitizeMode(route?.params?.mode);
  const [mode, setMode] = useState<AnalyticsMode>(requestedMode);
  const [rows, setRows] = useState<ViewerProfile[]>([]);
  const [loading, setLoading] = useState(true);
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
    if (!profile?.uid) {
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
              const snap = await loadViewerProfileSnap(row.viewerId);
              if (snap?.exists()) {
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
  }, [mode, profile?.uid, Array.isArray(profile?.viewedBy) ? profile.viewedBy.join('|') : '']);

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
        style={[styles.viewerCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#FFF' }]}
        onPress={() => openRow(item)}
        activeOpacity={0.84}
      >
        <View style={styles.viewerCardLeft}>
          <AppImage uri={ikAvatar(safeProfileImageUri(item.profilePic)) || FALLBACK_AVATAR} style={styles.avatar} />
          <View style={styles.viewerCardMeta}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: textColor(isDark) }]} numberOfLines={1}>
                {item.displayName || '@builder'}
              </Text>
              {!!item.isVerified && <VerifiedBadge size={16} />}
            </View>
            <Text style={[styles.viewerEvent, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
              {item.eventLabel || item.bio || 'Building the future'}
            </Text>
            <Text style={styles.viewerTime}>{formatTimeAgo(item.eventTime)}</Text>
          </View>
        </View>
        <View style={styles.viewerCardAction}>
          <RowIcon size={18} color={COLORS.primaryStrong} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.8}>
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerIconWrap}>
            <HeaderIcon size={14} color="#000" />
          </View>
          <View style={styles.headerTextWrap}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.title, { color: textColor(isDark) }]}>{meta.title}</Text>
              <ProCrownBadge />
            </View>
            <Text style={[styles.subtitle, { color: textColor(isDark, 'muted') }]}>
              {responseRate === null ? meta.subtitle : `${responseRate}% response rate`}
            </Text>
          </View>
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
              style={[
                styles.tab,
                active && styles.tabActive,
              ]}
              onPress={() => setMode(tabMode)}
              activeOpacity={0.82}
            >
              <TabIcon size={13} color={active ? '#000' : (isDark ? '#6B7280' : '#9CA3AF')} />
              <Text style={[styles.tabText, { color: active ? '#000' : (isDark ? '#6B7280' : '#9CA3AF') }]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator color={COLORS.primaryStrong} size="small" />
        </View>
      ) : (
        <FlatList
          data={rows}
          renderItem={renderViewer}
          keyExtractor={(item, index) => `${item.analyticsMode || mode}-${item.uid}-${timeValue(item.eventTime)}-${index}`}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <HeaderIcon size={36} color={COLORS.primaryStrong} />
              </View>
              <Text style={[styles.emptyText, { color: textColor(isDark) }]}>{meta.empty}</Text>
              <Text style={[styles.emptySub, { color: textColor(isDark, 'muted') }]}>{meta.emptySub}</Text>
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
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 10,
  },
  backBtn: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  subtitle: {
    marginTop: 1,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  tab: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(156,163,175,0.1)',
  },
  tabActive: {
    backgroundColor: COLORS.primary,
  },
  tabText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 20,
  },
  separator: {
    height: 10,
  },
  viewerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  viewerCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
  },
  viewerCardMeta: {
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '900',
    flexShrink: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  viewerEvent: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  viewerTime: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.primaryStrong,
    marginTop: 3,
    letterSpacing: 0.5,
  },
  viewerCardAction: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(17, 24, 39,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  empty: {
    alignItems: 'center',
    marginTop: 80,
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: 'rgba(17, 24, 39,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    textAlign: 'center',
    maxWidth: 260,
  },
});

export default ViewersScreen;
