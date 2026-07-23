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
import { getBestOpportunityAlerts, OpportunityAlert } from '../lib/opportunityAlerts';
import { getBestProjectRecommendations, ProjectRecommendation } from '../lib/projectRecommendations';
import { Sparkles, TrendingUp, Users, ChevronRight, Briefcase, MapPin, Target, Search, BellRing, Rocket, Lightbulb } from 'lucide-react-native';
import VerifiedBadge from '../components/VerifiedBadge';
import { subscribeToDiscoveryProfiles } from '../lib/discoveryProfiles';
import { IS_LOW_END_ANDROID, MOBILE_HORIZONTAL_CARD_LIMIT, MOBILE_LIST_IMAGE_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';

const dashboardCacheKey = (uid: string) => `linkup:dashboard:v3:${uid}`;
const DASHBOARD_CACHE_LIMIT = IS_LOW_END_ANDROID ? 24 : 60;
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
const compactDashboardProfile = (profile: UserProfile) => ({
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
  startupStage: (profile as any).startupStage || '',
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
});
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
    await AsyncStorage.setItem(dashboardCacheKey(uid), JSON.stringify(people.slice(0, DASHBOARD_CACHE_LIMIT).map(compactDashboardProfile)));
  } catch {
    // Cache only makes the dashboard feel instant.
  }
};

export default function DiscoveryDashboardScreen({ navigation }: any) {
  const { user, profile: me } = useAuth();
  const { theme } = useTheme();
  const isFocused = useIsFocused();
  const isDark = theme === 'dark';
  const remoteRankTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState<UserProfile[]>([]);
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
        setPeople((current) => (list.length > 0 || current.length === 0 ? list : current));
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
    if (!user || !isFocused) return;
    if (people.length === 0) return;
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
        // Fallback: always provide recommendations even when Functions/ranking isn't available.
        if (!ranked.length) ranked = localRanked;
        if (cancelled) return;
        setAiRank(rankedCandidatesToMap(ranked));
      } catch (e: any) {
        if (!cancelled) {
          console.warn('dashboard ranking unavailable', e?.message || String(e));
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
    return list.filter((x) => x.s >= 0).slice(0, MOBILE_HORIZONTAL_CARD_LIMIT).map((x) => x.p);
  }, [people, aiRank, localRank]);

  const trending = useMemo(() => {
    const list = [...people];
    list.sort((a: any, b: any) => (earnedScore(b) + (b.turboConnect ? 8 : 0)) - (earnedScore(a) + (a.turboConnect ? 8 : 0)));
    return list.slice(0, MOBILE_HORIZONTAL_CARD_LIMIT);
  }, [people]);

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

  const Card = ({ item, showScore }: { item: UserProfile; showScore?: boolean }) => {
    const match = aiRank[item.uid] || localRank[item.uid];
    const score = match?.score;
    return (
      <TouchableOpacity
        onPress={() => navigation.navigate('Profile', { userId: item.uid, compatibilityScore: score, compatibilityReason: match?.reason })}
        style={[styles.card, liquidGlass(isDark, false)]}
      >
        <Image
          source={{ uri: safeProfileImageUri(item.profilePic, MOBILE_LIST_IMAGE_LIMIT) || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' }}
          style={styles.avatar}
        />
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: textColor(isDark) }]} numberOfLines={1}>
              {displayNameFor(item)}
            </Text>
            {item.isVerified && <VerifiedBadge size={20} />}
          </View>
          <Text style={styles.handle} numberOfLines={1}>{handleFor(item)}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {(item as any).occupation || 'Builder'} - {(item.city || item.country) ? [item.city, item.country].filter(Boolean).join(', ') : 'Remote'}
          </Text>
          {!!showScore && typeof score === 'number' && (
            <TouchableOpacity
              onPress={() => Alert.alert('Compatibility', `${score}%\n\n${match?.reason || ''}`)}
              style={styles.scorePill}
              activeOpacity={0.85}
            >
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
        style={[styles.opportunityCard, liquidGlass(isDark, false)]}
        activeOpacity={0.9}
      >
        <View style={styles.opportunityTop}>
          <Image
            source={{ uri: safeProfileImageUri(item.profilePic, MOBILE_LIST_IMAGE_LIMIT) || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' }}
            style={styles.smallAvatar}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.opportunityTitle, { color: textColor(isDark) }]} numberOfLines={1}>
              {details.title}
            </Text>
            <Text style={styles.handle} numberOfLines={1}>{handleFor(item)}</Text>
          </View>
          <View style={styles.livePill}>
            <Text style={styles.liveText}>ACTIVE</Text>
          </View>
        </View>

        <Text style={[styles.opportunitySummary, { color: textColor(isDark, 'secondary') }]} numberOfLines={3}>
          {details.summary}
        </Text>

        <View style={styles.opportunityMetaGrid}>
          <View style={styles.opportunityMeta}>
            <Target size={12} color={COLORS.primary} />
            <Text style={styles.opportunityMetaText} numberOfLines={1}>{details.roleNeed}</Text>
          </View>
          <View style={styles.opportunityMeta}>
            <Briefcase size={12} color={COLORS.primary} />
            <Text style={styles.opportunityMetaText} numberOfLines={1}>{details.stage}</Text>
          </View>
          <View style={styles.opportunityMeta}>
            <MapPin size={12} color="#4ADE80" />
            <Text style={styles.opportunityMetaText} numberOfLines={1}>{details.location}</Text>
          </View>
        </View>

        <View style={styles.tagsRow}>
          {details.tags.map((tag, index) => (
            <View key={`${item.uid}-${tag}-${index}`} style={[styles.tagChip, liquidGlass(isDark, false)]}>
              <Text style={[styles.tagText, { color: textColor(isDark) }]} numberOfLines={1}>{tag.toUpperCase()}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <TouchableOpacity onPress={() => navigation.navigate('Profile', { userId: item.uid })} style={[styles.opportunityBtn, { backgroundColor: COLORS.primary }]}>
            <Text style={[styles.opportunityBtnText, { color: '#000' }]}>VIEW PROFILE</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Search')} style={[styles.opportunityIconBtn, liquidGlass(isDark, false)]}>
            <Search size={16} color={textColor(isDark)} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const ProjectCard = ({ item }: { item: ProjectRecommendation }) => (
    <TouchableOpacity
      onPress={() => navigation.navigate('ActiveOpportunity', { userId: item.owner.uid, projectId: item.project.id })}
      style={[styles.projectCard, liquidGlass(isDark, false)]}
      activeOpacity={0.9}
    >
      <View style={styles.projectTop}>
        <View style={styles.projectIcon}>
          <Rocket size={17} color="#000" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.projectTitle, { color: textColor(isDark) }]} numberOfLines={1}>
            {item.project.title}
          </Text>
          <Text style={styles.handle} numberOfLines={1}>{handleFor(item.owner)}</Text>
        </View>
        <View style={styles.projectScore}>
          <Text style={styles.projectScoreText}>{item.score}%</Text>
        </View>
      </View>
      <Text style={[styles.projectSummary, { color: textColor(isDark, 'secondary') }]} numberOfLines={3}>
        {item.project.description}
      </Text>
      <View style={styles.projectSignalRow}>
        <Text style={styles.projectSignalLabel}>WHY YOU</Text>
        <Text style={[styles.projectReason, { color: textColor(isDark) }]} numberOfLines={1}>
          {item.reason}
        </Text>
      </View>
      <View style={styles.tagsRow}>
        {[item.roleNeed, item.project.status, ...item.matchingSignals].filter(Boolean).slice(0, 4).map((tag, index) => (
          <View key={`${item.id}-${tag}-${index}`} style={[styles.tagChip, liquidGlass(isDark, false)]}>
            <Text style={[styles.tagText, { color: textColor(isDark) }]} numberOfLines={1}>{String(tag).toUpperCase()}</Text>
          </View>
        ))}
      </View>
    </TouchableOpacity>
  );

  const Section = ({ title, icon, data, showScore, variant, onViewAll }: any) => (
    <View style={{ marginTop: 18 }}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onViewAll} activeOpacity={onViewAll ? 0.8 : 1}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon}
          <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>{title}</Text>
        </View>
        <ChevronRight size={18} color="#666" />
      </TouchableOpacity>
      <FlatList
        data={data}
        keyExtractor={(it) => it.uid}
        horizontal
        showsHorizontalScrollIndicator={false}
        initialNumToRender={IS_LOW_END_ANDROID ? 3 : 6}
        maxToRenderPerBatch={IS_LOW_END_ANDROID ? 3 : 6}
        windowSize={IS_LOW_END_ANDROID ? 3 : 5}
        removeClippedSubviews={Platform.OS !== 'web'}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6, gap: 12 }}
        ListEmptyComponent={
          <View style={[styles.emptyCard, liquidGlass(isDark, false)]}>
            <Text style={[styles.emptyTitle, { color: textColor(isDark) }]}>No active opportunities yet</Text>
            <Text style={styles.emptySub}>Use search to find builders by role, stage, or industry.</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Search')} style={styles.emptyBtn}>
              <Text style={styles.emptyBtnText}>OPEN SEARCH</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => variant === 'opportunity' ? <OpportunityCard item={item} /> : <Card item={item} showScore={showScore} />}
      />
    </View>
  );

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.container, appBackground(isDark)]}> 
      <View style={styles.scene} pointerEvents="none">
        <View style={[styles.scenePane, styles.scenePaneA, { backgroundColor: isDark ? 'rgba(0,194,255,0.1)' : 'rgba(0,194,255,0.14)' }]} />
        <View style={[styles.scenePane, styles.scenePaneB, { backgroundColor: isDark ? 'rgba(223,251,63,0.08)' : 'rgba(223,251,63,0.16)' }]} />
      </View>
      {loading && people.length === 0 ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
            <View style={[styles.hero, liquidGlass(isDark), { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightBgSec, borderColor: isDark ? COLORS.darkBorderActive : COLORS.lightBorderActive }]}> 
              <View style={[styles.heroAccent, { backgroundColor: isDark ? COLORS.primaryGlow : COLORS.secondary }]} />
              <Text style={[styles.heroKicker, { color: isDark ? COLORS.primary : '#000' }]}>TODAY'S SIGNAL</Text>
              <Text style={[styles.heroTitle, { color: textColor(isDark) }]}>Your builder graph is warming up.</Text>
              <Text style={[styles.heroSub, { color: textColor(isDark, 'secondary') }]}>
                Smart matches, live project opportunities, and founders worth meeting are ranked into one calm feed.
              </Text>

              <View style={styles.heroActions}>
                <TouchableOpacity
                  onPress={() => navigation.navigate('IdeaDeck')}
                  style={[styles.heroBtn, liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorderActive : COLORS.lightBorderActive }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Lightbulb size={15} color={textColor(isDark)} />
                    <Text style={[styles.heroBtnText, { color: textColor(isDark) }]}>IDEAS</Text>
                  </View>
                </TouchableOpacity>
              </View>

              <View style={styles.heroInfo}>
                <Text style={[styles.heroInfoText, { color: textColor(isDark, 'muted') }]}>{aiLoading ? 'UPDATING MATCHES...' : 'AI RECOMMENDATIONS READY'}</Text>
              </View>

              {topOpportunityAlert ? (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => navigation.navigate('ActiveOpportunity', { userId: topOpportunityAlert.profile.uid })}
                  style={[styles.radarCard, liquidGlass(isDark, false), { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightBgSec, borderColor: isDark ? COLORS.darkBorderActive : COLORS.lightBorderActive }]}
                >
                  <View style={styles.radarTop}>
                    <View style={[styles.radarIcon, { backgroundColor: COLORS.secondary }]}> 
                      <BellRing size={16} color="#05070D" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.radarTitle, { color: textColor(isDark) }]}>OPPORTUNITY RADAR</Text>
                      <Text style={styles.radarSub} numberOfLines={2}>
                        {displayNameFor(topOpportunityAlert.profile)} matches your interests: {topOpportunityAlert.reason}
                      </Text>
                    </View>
                    <View style={[styles.radarScore, { backgroundColor: COLORS.secondary }]}> 
                      <Text style={styles.radarScoreText}>{topOpportunityAlert.score}%</Text>
                    </View>
                  </View>
                  <Text style={[styles.radarSummary, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>
                    {topOpportunityAlert.summary}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.radarCard, liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorderActive : COLORS.lightBorderActive }]}> 
                  <Text style={[styles.radarTitle, { color: textColor(isDark) }]}>OPPORTUNITY RADAR</Text>
                  <Text style={styles.radarSub}>No strong opportunity yet. Add more skills/interests to sharpen alerts.</Text>
                </View>
              )}
            </View>
          </View>

          <Section
            title="Recommended Matches"
            icon={<Sparkles size={18} color={COLORS.primary} />}
            data={recommended}
            showScore
            onViewAll={() => navigation.navigate('RecommendedMatches')}
          />
          <View style={{ marginTop: 18 }}>
            <TouchableOpacity style={styles.sectionHeader} onPress={() => navigation.navigate('ActiveOpportunities')} activeOpacity={0.8}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Rocket size={18} color={COLORS.primary} />
                <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>Project Matches</Text>
              </View>
              <ChevronRight size={18} color="#666" />
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
                <View style={[styles.emptyCard, liquidGlass(isDark, false)]}>
                  <Text style={[styles.emptyTitle, { color: textColor(isDark) }]}>No project matches yet</Text>
                  <Text style={styles.emptySub}>Add skills and interests so LINKUP can match you with ongoing projects.</Text>
                </View>
              }
              renderItem={({ item }) => <ProjectCard item={item} />}
            />
          </View>
          <Section
            title="Trending Builders"
            icon={<TrendingUp size={18} color={COLORS.primary} />}
            data={trending}
            onViewAll={() => navigation.navigate('TrendingBuilders')}
          />
          <Section
            title="Active Opportunities"
            icon={<Users size={18} color="#4ADE80" />}
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
  container: { flex: 1, backgroundColor: 'transparent' },
  scrollArea: { flex: 1 },
  scene: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  scenePane: {
    position: 'absolute',
    width: 280,
    height: 130,
    borderRadius: 34,
  },
  scenePaneA: {
    top: 80,
    right: -120,
    transform: [{ rotate: '-18deg' }],
  },
  scenePaneB: {
    top: 260,
    left: -110,
    transform: [{ rotate: '16deg' }],
  },
  hero: {
    borderRadius: 28,
    padding: 18,
  },
  heroKicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.6,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 29,
  },
  heroSub: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
  },
  heroAccent: {
    width: 72,
    height: 4,
    borderRadius: 999,
    marginBottom: 14,
  },
  heroActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  heroInfo: {
    marginTop: 14,
  },
  heroInfoText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  heroBtn: {
    flex: 1,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBtnText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
  },
  radarCard: {
    marginTop: 14,
    borderRadius: 20,
    borderWidth: 1,
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
    borderRadius: 17,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarTitle: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  radarSub: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '800',
    color: '#666',
    lineHeight: 15,
  },
  radarScore: {
    height: 30,
    minWidth: 44,
    borderRadius: 15,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  radarScoreText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.6,
  },
  radarSummary: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  card: {
    width: 280,
    borderRadius: 22,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
  },
  avatar: { width: 52, height: 52, borderRadius: 18 },
  name: { fontSize: 14, fontWeight: '900', textTransform: 'uppercase', fontStyle: 'italic', flexShrink: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  verifiedMiniBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  handle: { marginTop: 2, fontSize: 10,     color: COLORS.primary, fontWeight: '900' },
  meta: { marginTop: 4, fontSize: 10, color: '#666', fontWeight: '900' },
  scorePill: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: { fontSize: 10, fontWeight: '900', color: '#000', letterSpacing: 1 },
  opportunityCard: {
    width: 330,
    borderRadius: 24,
    borderWidth: 1,
    padding: 14,
  },
  projectCard: {
    width: 330,
    borderRadius: 24,
    borderWidth: 1,
    padding: 14,
  },
  projectTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  projectIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  projectScore: {
    height: 30,
    minWidth: 46,
    borderRadius: 15,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  projectScoreText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.6,
  },
  projectSummary: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  projectSignalRow: {
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(251,230,24,0.08)',
    padding: 10,
  },
  projectSignalLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: '#8A7900',
  },
  projectReason: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  opportunityTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  smallAvatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
  },
  opportunityTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  livePill: {
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: '#4ADE8020',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#16A34A',
  },
  opportunitySummary: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  opportunityMetaGrid: {
    gap: 8,
    marginTop: 12,
  },
  opportunityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  opportunityMetaText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '900',
    color: '#666',
    textTransform: 'uppercase',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  tagChip: {
    maxWidth: 120,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  tagText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  opportunityBtn: {
    flex: 1,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opportunityIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opportunityBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  emptyCard: {
    width: 300,
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  emptySub: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
    color: '#666',
  },
  emptyBtn: {
    height: 40,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  emptyBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    color: '#000',
  },
});
