import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, FlatList, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile } from '../types';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { localCommonalityRank, rankedCandidatesToMap, rankCandidatesHybrid } from '../lib/matchmaking';
import { activeOpportunityScore, displayNameFor, earnedScore, handleFor, isDiscoverableProfile, opportunityDetails } from '../lib/discovery';
import { rankLeague } from '../lib/builderLeague';
import { loadLeaguePool } from '../lib/leaguePool';
import { getBestOpportunityAlerts, OpportunityAlert } from '../lib/opportunityAlerts';
import { getBestProjectRecommendations, ProjectRecommendation } from '../lib/projectRecommendations';
import { TrendingUp, Users, ChevronRight, Briefcase, MapPin, Target, Search, BellRing, Rocket, Lightbulb, Zap, Star, Flame, ArrowLeftRight, UserCheck } from 'lucide-react-native';
import { shareLinkupInvite } from '../lib/activation';
import VerifiedBadge from '../components/VerifiedBadge';
import { subscribeToDiscoveryProfiles } from '../lib/discoveryProfiles';
import { IS_LOW_END_ANDROID, MOBILE_HORIZONTAL_CARD_LIMIT, MOBILE_LIST_IMAGE_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';

const dashboardCacheKey = (uid: string) => `linkup:dashboard:v3:${uid}`;
const DASHBOARD_CACHE_LIMIT = IS_LOW_END_ANDROID ? 24 : 60;

// HOME PALETTE (founder request): clean white + dark gold ONLY.
// No lime (#FBE618), no green, no tints of anything else on this screen.
const HOME_GOLD = '#C9A227'; // fills, buttons, icons
const HOME_GOLD_DEEP = '#8A6D1A'; // small text accents (readable on white)
const HOME_GOLD_TINT = 'rgba(201,162,39,0.12)'; // subtle chips/backdrops
const compactCachedImage = (value: unknown) => {
  return safeProfileImageUri(value, MOBILE_LIST_IMAGE_LIMIT);
};
const compactCachedProject = (project: any, index: number) => ({
  id: String(project?.id || `project_${index}`),
  title: String(project?.title || '').slice(0, 120),
  description: String(project?.description || '').slice(0, 240),
  status: String(project?.status || '').slice(0, 80),
  lookingFor: Array.isArray(project?.lookingFor) ? project.lookingFor.slice(0, 6) : [],
  tags: Array.isArray(project?.tags) ? project.tags.slice(0, 6) : [],
});
const compactDashboardProfile = (profile: UserProfile) => {
  if (!profile?.uid) return null;
  return {
    uid: profile.uid,
    displayName: displayNameFor(profile),
    username: (profile as any).username || '',
    bio: profile.bio || '',
    profilePic: compactCachedImage(profile.profilePic),
    occupation: (profile as any).occupation || '',
    company: (profile as any).company || '',
    city: profile.city || '',
    country: profile.country || '',
    age: Number(profile.age || 0),
    skills: Array.isArray(profile.skills) ? profile.skills.slice(0, 12) : [],
    industries: Array.isArray((profile as any).industries) ? (profile as any).industries.slice(0, 12) : [],
    lookingFor: Array.isArray((profile as any).lookingFor) ? (profile as any).lookingFor.slice(0, 12) : [],
    startupStage: (profile as any)?.startupStage || '',
    availability: (profile as any).availability || '',
    reputationScore: earnedScore(profile),
    turboConnect: !!(profile as any).turboConnect,
    isVisible: profile.isVisible !== false,
    isStealthMode: !!profile.isStealthMode,
    isVerified: !!profile.isVerified,
    isBot: !!(profile as any).isBot,
    onboarded: !!(profile as any).onboarded,
    projects: Array.isArray((profile as any).projects)
      ? (profile as any).projects.slice(0, 3).map(compactCachedProject)
      : [],
  };
};
const readCachedDashboardPeople = async (uid: string): Promise<UserProfile[]> => {
  try {
    const raw = await AsyncStorage.getItem(dashboardCacheKey(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((profile) => profile?.uid && isDiscoverableProfile(profile)).slice(0, DASHBOARD_CACHE_LIMIT) : [];
  } catch {
    return [];
  }
};
const writeCachedDashboardPeople = async (uid: string, people: UserProfile[]) => {
  try {
    await AsyncStorage.setItem(
      dashboardCacheKey(uid),
      JSON.stringify(people.slice(0, DASHBOARD_CACHE_LIMIT).map(compactDashboardProfile).filter(Boolean))
    );
  } catch {
    // Cache only makes the dashboard feel instant.
  }
};

function DiscoveryDashboardScreen({ navigation }: any) {
  const { user, profile: me } = useAuth();
  const { theme } = useTheme();
  const isFocused = useIsFocused();
  const isDark = theme === 'dark';
  const remoteRankTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peopleRankKeyRef = useRef<string>('');

  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [leaguePeople, setLeaguePeople] = useState<any[]>([]);
  const [aiRank, setAiRank] = useState<Record<string, { score: number; reason: string }>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [opportunityRadar, setOpportunityRadar] = useState<OpportunityAlert[]>([]);
  const localRank = useMemo(() => {
    const rankPool = IS_LOW_END_ANDROID ? people.slice(0, 10) : people;
    return rankedCandidatesToMap(localCommonalityRank(me, rankPool, Math.max(rankPool.length, 10)));
  }, [me, people]);

  useEffect(() => {
    if (!user || !isFocused) return;
    let isMounted = true;
    readCachedDashboardPeople(user.uid).then((cachedPeople) => {
      if (!isMounted) return;
      if (cachedPeople.length) {
        setPeople(cachedPeople);
        setLoading(false);
      }
    });
    const unsub = subscribeToDiscoveryProfiles({
      userId: user.uid,
      onData: (profiles) => {
        const list = profiles.filter((profile: any) => profile.uid !== user.uid && isDiscoverableProfile(profile));
        setPeople((current) => {
          if (list.length === 0 && current.length > 0) return current;
          if (current.length === list.length && current.every((p, i) => p.uid === list[i]?.uid)) return current;
          return list;
        });
        if (list.length > 0) writeCachedDashboardPeople(user.uid, list).catch(() => {});
        setLoading(false);
      },
      onError: (err) => {
        console.error('dashboard users error', err);
        setLoading(false);
      },
    });
    return () => {
      isMounted = false;
      unsub();
    };
  }, [isFocused, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !isFocused) return;
    let alive = true;
    loadLeaguePool()
      .then((rows) => {
        if (alive) setLeaguePeople(rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isFocused, user?.uid]);

  useEffect(() => {
    if (!user || !isFocused) return;
    if (people.length === 0) return;
    const peopleKey = people.map((p) => p.uid).sort().join('|');
    if (peopleKey === peopleRankKeyRef.current) return;
    peopleRankKeyRef.current = peopleKey;
    let cancelled = false;
    const localRanked = localCommonalityRank(me, people, 15);
    setAiRank(rankedCandidatesToMap(localRanked));

    if (remoteRankTimerRef.current) {
      clearTimeout(remoteRankTimerRef.current);
      remoteRankTimerRef.current = null;
    }

    if (Platform.OS !== 'web') {
      setAiLoading(false);
      return () => {
        cancelled = true;
      };
    }

    remoteRankTimerRef.current = setTimeout(() => void (async () => {
      try {
        setAiLoading(true);
        let ranked = await rankCandidatesHybrid(me, people.slice(0, 40), 15);
        if (!ranked.length) ranked = localRanked;
        if (cancelled) return;
        setAiRank(rankedCandidatesToMap(ranked));
      } catch (e: any) {
        if (!cancelled) {
          setAiRank(rankedCandidatesToMap(localRanked));
        }
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })(), 3500);
    return () => {
      cancelled = true;
      if (remoteRankTimerRef.current) {
        clearTimeout(remoteRankTimerRef.current);
        remoteRankTimerRef.current = null;
      }
    };
  }, [isFocused, user?.uid, me?.uid, people]);

  const recommended = useMemo(() => {
    const list = people.map((p) => ({ p, s: (aiRank[p.uid]?.score ?? localRank[p.uid]?.score ?? 1) + ((p as any).turboConnect ? 8 : 0) }));
    list.sort((a, b) => b.s - a.s);
    return list.filter((x) => x.s >= 0).slice(0, 2).map((x) => x.p);
  }, [people, aiRank, localRank]);

  // The Builder League preview uses the shared league pool + the exact same
  // ranker as the full league screen, so standings match on every device.
  const trending = useMemo(() => {
    const pool = leaguePeople.length > 0 ? leaguePeople : people;
    return rankLeague(pool as any, me).slice(0, MOBILE_HORIZONTAL_CARD_LIMIT);
  }, [leaguePeople, people, me]);

  const opportunities = useMemo(() => {
    const list = people
      .map((p: any) => ({ profile: p, weight: activeOpportunityScore(p) }))
      .filter((x) => x.weight > 0);
    list.sort((a, b) => b.weight - a.weight);
    return list.slice(0, MOBILE_HORIZONTAL_CARD_LIMIT).map((x) => x.profile);
  }, [people]);

  const projectRecommendations = useMemo(
    () => getBestProjectRecommendations(me, IS_LOW_END_ANDROID ? people.slice(0, 10) : people, IS_LOW_END_ANDROID ? 4 : 8),
    [me, people]
  );

  useEffect(() => {
    setOpportunityRadar(getBestOpportunityAlerts(me, IS_LOW_END_ANDROID ? people.slice(0, 10) : people, IS_LOW_END_ANDROID ? 1 : 3));
  }, [me, people]);

  const topOpportunityAlert = opportunityRadar[0];

  const Card = ({ item, showScore, rank }: { item: UserProfile; showScore?: boolean; rank?: number }) => {
    const localMatch = localRank[item.uid];
    const aiMatch = aiRank[item.uid];
    const match = localMatch || aiMatch;
    const score = match?.score ?? null;
    return (
      <TouchableOpacity
        onPress={() => navigation.navigate('Profile', { userId: item.uid, compatibilityScore: score, compatibilityReason: match?.reason || '' })}
        style={[styles.card, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#FFF' }]}
      >
        {typeof rank === 'number' ? (
          <View style={[styles.rankBadge, rank < 3 && { backgroundColor: HOME_GOLD }]}>
            <Text style={styles.rankBadgeText}>{rank === 0 ? '1ST' : rank === 1 ? '2ND' : rank === 2 ? '3RD' : `#${rank + 1}`}</Text>
          </View>
        ) : null}
        <Image
          source={{ uri: safeProfileImageUri(item.profilePic, MOBILE_LIST_IMAGE_LIMIT) || 'https://ui-avatars.com/api/?name=+&background=E5E7EB&color=9CA3AF&size=256' }}
          style={styles.avatar}
        />
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: textColor(isDark) }]} numberOfLines={1}>
              {displayNameFor(item)}
            </Text>
            {item.isVerified && <VerifiedBadge size={18} />}
          </View>
          <Text style={[styles.handle, { color: HOME_GOLD_DEEP }]} numberOfLines={1}>{handleFor(item)}</Text>
          <Text style={[styles.meta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
            {(item as any).occupation || 'Builder'} · {(item.city || item.country) ? [item.city, item.country].filter(Boolean).join(', ') : 'Remote'}
          </Text>
          {!!showScore && typeof score === 'number' && (
            <TouchableOpacity
              onPress={() => Alert.alert('Compatibility', `${score}%\n\n${match?.reason || ''}`)}
              style={styles.scorePill}
              activeOpacity={0.85}
            >
              <Zap size={10} color="#000" />
              <Text style={styles.scoreText}>{score}%</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const OpportunityCard = ({ item }: { item: UserProfile }) => {
    const details = opportunityDetails(item);
    return (
      <TouchableOpacity
        onPress={() => navigation.navigate('ActiveOpportunity', { userId: item.uid })}
        style={[styles.opportunityCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#FFF' }]}
        activeOpacity={0.9}
      >
        <View style={styles.opportunityTop}>
          <Image
            source={{ uri: safeProfileImageUri(item.profilePic, MOBILE_LIST_IMAGE_LIMIT) || 'https://ui-avatars.com/api/?name=+&background=E5E7EB&color=9CA3AF&size=256' }}
            style={styles.smallAvatar}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.opportunityTitle, { color: textColor(isDark) }]} numberOfLines={1}>
              {details.title}
            </Text>
            <Text style={[styles.handle, { color: HOME_GOLD_DEEP }]} numberOfLines={1}>{handleFor(item)}</Text>
          </View>
          <View style={[styles.livePill, { backgroundColor: isDark ? 'rgba(74,222,128,0.15)' : 'rgba(74,222,128,0.12)' }]}>
            <Text style={styles.liveText}>Active</Text>
          </View>
        </View>

        <Text style={[styles.opportunitySummary, { color: textColor(isDark, 'secondary') }]} numberOfLines={3}>
          {details.summary}
        </Text>

        <View style={styles.opportunityMetaGrid}>
          <View style={styles.opportunityMeta}>
            <Target size={11} color={HOME_GOLD} />
            <Text style={[styles.opportunityMetaText, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>{details.roleNeed}</Text>
          </View>
          <View style={styles.opportunityMeta}>
            <Briefcase size={11} color={HOME_GOLD} />
            <Text style={[styles.opportunityMetaText, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>{details.stage}</Text>
          </View>
          <View style={styles.opportunityMeta}>
            <MapPin size={11} color="#4ADE80" />
            <Text style={[styles.opportunityMetaText, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>{details.location}</Text>
          </View>
        </View>

        <View style={styles.tagsRow}>
          {details.tags.slice(0, 3).map((tag, index) => (
            <View key={`${item.uid}-${tag}-${index}`} style={[styles.tagChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
              <Text style={[styles.tagText, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>{tag.toUpperCase()}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <TouchableOpacity onPress={() => navigation.navigate('Profile', { userId: item.uid })} style={[styles.opportunityBtn, { backgroundColor: HOME_GOLD }]}>
            <Text style={styles.opportunityBtnText}>View Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Search')} style={[styles.opportunityIconBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
            <Search size={15} color={textColor(isDark)} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const ProjectCard = ({ item }: { item: ProjectRecommendation }) => (
    <TouchableOpacity
      onPress={() => navigation.navigate('ActiveOpportunity', { userId: item.owner.uid, projectId: item.project.id, matchScore: item.score })}
      style={[styles.projectCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#FFF' }]}
      activeOpacity={0.9}
    >
      <View style={styles.projectTop}>
        <View style={styles.projectIcon}>
          <Rocket size={16} color="#000" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.projectTitle, { color: textColor(isDark) }]} numberOfLines={1}>
            {item.project.title}
          </Text>
          <Text style={[styles.handle, { color: HOME_GOLD_DEEP }]} numberOfLines={1}>{handleFor(item.owner)}</Text>
        </View>
        <View style={styles.projectScore}>
          <Text style={styles.projectScoreText}>{item.score}%</Text>
        </View>
      </View>
      <Text style={[styles.projectSummary, { color: textColor(isDark, 'secondary') }]} numberOfLines={3}>
        {item.project.description}
      </Text>
      <View style={styles.projectSignalRow}>
        <Text style={[styles.projectSignalLabel, { color: isDark ? '#C6B100' : '#8A7900' }]}>Why You</Text>
        <Text style={[styles.projectReason, { color: textColor(isDark) }]} numberOfLines={1}>
          {item.reason}
        </Text>
      </View>
      <View style={styles.tagsRow}>
        {[item.roleNeed, item.project.status, ...item.matchingSignals].filter(Boolean).slice(0, 3).map((tag, index) => (
          <View key={`${item.id}-${tag}-${index}`} style={[styles.tagChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
            <Text style={[styles.tagText, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>{String(tag).toUpperCase()}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );

  const Section = ({ title, icon, data, showScore, variant, onViewAll, showRank }: any) => (
    <View style={{ marginTop: 24 }}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onViewAll} activeOpacity={onViewAll ? 0.8 : 1}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon}
          <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>{title}</Text>
        </View>
        <View style={styles.sectionChevron}>
          <ChevronRight size={16} color={textColor(isDark, 'muted')} />
        </View>
      </TouchableOpacity>
      <FlatList
        data={data}
        keyExtractor={(it: any) => it.uid || it.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        initialNumToRender={IS_LOW_END_ANDROID ? 3 : 6}
        maxToRenderPerBatch={IS_LOW_END_ANDROID ? 3 : 6}
        windowSize={IS_LOW_END_ANDROID ? 3 : 5}
        removeClippedSubviews={Platform.OS !== 'web'}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6, gap: 12 }}
        ListEmptyComponent={
          <View style={[styles.emptyCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#FFF' }]}>
            <Text style={[styles.emptyTitle, { color: textColor(isDark) }]}>Nobody here yet</Text>
            <Text style={[styles.emptySub, { color: textColor(isDark, 'muted') }]}>This list is empty because the network is still small. Invite 3 builders or search whoever is already on LINKUP.</Text>
            <TouchableOpacity onPress={() => void shareLinkupInvite()} style={styles.emptyBtn}>
              <Text style={styles.emptyBtnText}>Invite Builders</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item, index }: any) => variant === 'opportunity' ? <OpportunityCard item={item} /> : <Card item={item} showScore={showScore} rank={showRank ? index : undefined} />}
      />
    </View>
  );

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.container, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}>
      {loading && people.length === 0 ? (
        <ActivityIndicator color={HOME_GOLD} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <View style={[styles.heroCard, { backgroundColor: isDark ? COLORS.darkCard : '#FFF' }]}>
              <View style={styles.heroTop}>
                <View style={styles.heroIconRow}>
                  <View style={styles.heroBadge}>
                    <Text style={[styles.heroBadgeText, { color: HOME_GOLD_DEEP }]}>Today</Text>
                  </View>
                </View>
                <Text style={[styles.heroTitle, { color: textColor(isDark) }]}>
                  {people.length === 0 ? 'The room is still small.' : 'Your Daily 5 is ready.'}
                </Text>
                <Text style={[styles.heroSub, { color: textColor(isDark, 'muted') }]}>
                  {people.length === 0
                    ? `${people.length} discoverable builders loaded. Invite people you already trust, or talk to LINKUP concierge in Alerts.`
                    : 'Smart matches, live project opportunities, and founders worth meeting are ranked into one calm feed.'}
                </Text>
              </View>

              <View style={styles.heroActions}>
                <TouchableOpacity
                  onPress={() => navigation.navigate('DailyFive')}
                  style={[styles.heroBtn, { backgroundColor: HOME_GOLD }]}
                >
                  <Flame size={14} color="#000" />
                  <Text style={[styles.heroBtnText, { color: '#000' }]}>Daily 5</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => navigation.navigate('Swipe')}
                  style={[styles.heroBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
                >
                  <ArrowLeftRight size={14} color={textColor(isDark)} />
                  <Text style={[styles.heroBtnText, { color: textColor(isDark) }]}>Swipe</Text>
                </TouchableOpacity>
                <View style={[styles.heroStatus, { backgroundColor: isDark ? HOME_GOLD_TINT : HOME_GOLD_TINT }]}>
                  <Star size={12} color={HOME_GOLD} />
                  <Text style={styles.heroStatusText}>{aiLoading ? 'UPDATING...' : 'READY'}</Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => navigation.navigate('IdeaDeck')}
                activeOpacity={0.88}
                style={[styles.ideaDeckBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
              >
                <Lightbulb size={15} color={HOME_GOLD} />
                <Text style={[styles.ideaDeckBtnText, { color: textColor(isDark) }]}>Idea Deck — swipe startup ideas worth building</Text>
                <ChevronRight size={15} color={textColor(isDark, 'muted')} />
              </TouchableOpacity>

              {topOpportunityAlert ? (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => navigation.navigate('ActiveOpportunity', { userId: topOpportunityAlert.profile.uid, matchScore: topOpportunityAlert.score })}
                  style={[styles.radarCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#FFF' }]}
                >
                  <View style={styles.radarTop}>
                    <View style={[styles.radarIcon, { backgroundColor: HOME_GOLD }]}>
                      <BellRing size={15} color="#000" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.radarTitle, { color: textColor(isDark) }]}>Opportunity Radar</Text>
                      <Text style={[styles.radarSub, { color: textColor(isDark, 'muted') }]} numberOfLines={2}>
                        {displayNameFor(topOpportunityAlert.profile)} matches your interests: {topOpportunityAlert.reason}
                      </Text>
                    </View>
                    <View style={[styles.radarScore, { backgroundColor: HOME_GOLD }]}>
                      <Text style={styles.radarScoreText}>{topOpportunityAlert.score}%</Text>
                    </View>
                  </View>
                  <Text style={[styles.radarSummary, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>
                    {topOpportunityAlert.summary}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.radarCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F9FAFB' }]}>
                  <View style={styles.radarTop}>
                    <View style={[styles.radarIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                      <BellRing size={15} color={textColor(isDark, 'muted')} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.radarTitle, { color: textColor(isDark) }]}>Opportunity Radar</Text>
                      <Text style={[styles.radarSub, { color: textColor(isDark, 'muted') }]}>No strong opportunity yet. Add more skills/interests to sharpen alerts.</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Linky')}
            style={[styles.linkyCard, { backgroundColor: isDark ? 'rgba(34,197,94,0.08)' : '#F0FDF4' }]}
          >
            <View style={styles.linkyCardLeft}>
              <View style={styles.linkyCardAvatar}>
                <Text style={styles.linkyCardAvatarText}>AI</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.nameRow}>
                  <Text style={[styles.name, { color: textColor(isDark) }]}>Linky AI</Text>
                  <VerifiedBadge size={18} />
                </View>
                <Text style={[styles.handle, { color: HOME_GOLD_DEEP }]}>@linky</Text>
                <Text style={[styles.meta, { color: textColor(isDark, 'muted') }]}>AI Assistant</Text>
              </View>
            </View>
            <View style={[styles.linkyChip, { backgroundColor: HOME_GOLD }]}>
              <Text style={styles.linkyChipText}>Chat</Text>
            </View>
          </TouchableOpacity>

          <Section
            title="Today’s 2 picks"
            icon={<UserCheck size={17} color={HOME_GOLD} />}
            data={recommended}
            showScore
            onViewAll={() => navigation.navigate('RecommendedMatches')}
          />
          <View style={{ marginTop: 24 }}>
            <TouchableOpacity style={styles.sectionHeader} onPress={() => navigation.navigate('ActiveOpportunities')} activeOpacity={0.8}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Rocket size={17} color={HOME_GOLD} />
                <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>Project Matches</Text>
              </View>
              <View style={styles.sectionChevron}>
                <ChevronRight size={16} color={textColor(isDark, 'muted')} />
              </View>
            </TouchableOpacity>
            <FlatList
              data={projectRecommendations}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              initialNumToRender={IS_LOW_END_ANDROID ? 3 : 6}
              maxToRenderPerBatch={IS_LOW_END_ANDROID ? 3 : 6}
              windowSize={IS_LOW_END_ANDROID ? 3 : 5}
              removeClippedSubviews={Platform.OS !== 'web'}
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6, gap: 12 }}
              ListEmptyComponent={
                <View style={[styles.emptyCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#FFF' }]}>
                  <Text style={[styles.emptyTitle, { color: textColor(isDark) }]}>No project matches yet</Text>
                  <Text style={[styles.emptySub, { color: textColor(isDark, 'muted') }]}>Add skills and interests so LINKUP can match you with ongoing projects.</Text>
                </View>
              }
              renderItem={({ item }) => <ProjectCard item={item} />}
            />
          </View>
          <Section
            title="Builder League"
            icon={<TrendingUp size={17} color={HOME_GOLD} />}
            data={trending}
            showRank
            onViewAll={() => navigation.navigate('TrendingBuilders')}
          />
          <Section
            title="Active Opportunities"
            icon={<Users size={17} color="#4ADE80" />}
            data={opportunities}
            variant="opportunity"
            onViewAll={() => navigation.navigate('ActiveOpportunities')}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollArea: { flex: 1 },
  heroCard: {
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  heroTop: {
    gap: 8,
  },
  heroIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  heroIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: HOME_GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: HOME_GOLD_TINT,
  },
  heroBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
    lineHeight: 28,
  },
  heroSub: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
  },
  heroActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(119,119,119,0.1)',
  },
  heroBtn: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  heroBtnText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  heroStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  heroStatusText: {
    fontSize: 9,
    fontWeight: '900',
    color: HOME_GOLD_DEEP,
    letterSpacing: 1,
  },
  ideaDeckBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 16,
  },
  ideaDeckBtnText: { flex: 1, fontSize: 13, fontWeight: '800', letterSpacing: -0.2 },
  radarCard: {
    marginTop: 16,
    borderRadius: 16,
    padding: 14,
  },
  radarTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  radarIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarTitle: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
  },
  radarSub: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  radarScore: {
    height: 28,
    minWidth: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  radarScoreText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.5,
  },
  radarSummary: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionChevron: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(156,163,175,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  card: {
    width: 290,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  avatar: { width: 50, height: 50, borderRadius: 16 },
  name: { fontSize: 14, fontWeight: '900', flexShrink: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  handle: { marginTop: 2, fontSize: 10, fontWeight: '800' },
  meta: { marginTop: 3, fontSize: 10, fontWeight: '600' },
  scorePill: {
    marginTop: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 24,
    borderRadius: 12,
    backgroundColor: HOME_GOLD,
  },
  scoreText: { fontSize: 10, fontWeight: '900', color: '#000', letterSpacing: 0.5 },
  opportunityCard: {
    width: 320,
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  projectCard: {
    width: 320,
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  projectTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  projectIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: HOME_GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  projectScore: {
    height: 28,
    minWidth: 44,
    borderRadius: 8,
    backgroundColor: HOME_GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  projectScoreText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.5,
  },
  projectSummary: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  projectSignalRow: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: HOME_GOLD_TINT,
    padding: 10,
  },
  projectSignalLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  projectReason: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '800',
  },
  opportunityTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  smallAvatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
  },
  opportunityTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  livePill: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: 'HOME_GOLD_DEEP',
  },
  opportunitySummary: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  opportunityMetaGrid: {
    gap: 6,
    marginTop: 12,
  },
  opportunityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  opportunityMetaText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  tagChip: {
    maxWidth: 110,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tagText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  opportunityBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opportunityIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opportunityBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
    color: '#000',
  },
  emptyCard: {
    width: 290,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  emptyTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  emptySub: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  emptyBtn: {
    height: 38,
    borderRadius: 12,
    backgroundColor: HOME_GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  emptyBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
    color: '#000',
  },
  linkyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.2)',
    shadowColor: '#22C55E',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  linkyCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  linkyCardAvatar: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22C55E',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  linkyCardAvatarText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 1,
  },
  linkyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  linkyChipText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#000',
  },
});

export default DiscoveryDashboardScreen;
