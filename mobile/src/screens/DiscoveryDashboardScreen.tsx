import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { UserProfile } from '../types';
import { localCommonalityRank, rankCandidatesWithAI } from '../lib/matchmaking';
import { earnedScore, handleFor, isDiscoverableProfile, opportunityDetails } from '../lib/discovery';
import { getBestOpportunityAlerts, OpportunityAlert } from '../lib/opportunityAlerts';
import { Sparkles, TrendingUp, Users, ChevronRight, Briefcase, MapPin, Target, Search, BellRing } from 'lucide-react-native';

export default function DiscoveryDashboardScreen({ navigation }: any) {
  const { user, profile: me } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [aiRank, setAiRank] = useState<Record<string, { score: number; reason: string }>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [opportunityRadar, setOpportunityRadar] = useState<OpportunityAlert[]>([]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'users'),
      where('isVisible', '==', true),
      where('isStealthMode', '==', false),
      limit(60)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as UserProfile)
          .filter((profile: any) => profile.uid !== user.uid && isDiscoverableProfile(profile));
        setPeople(list);
        setLoading(false);
      },
      (err) => {
        console.error('dashboard users error', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    if (people.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        setAiLoading(true);
        let ranked = await rankCandidatesWithAI(people.map((p) => p.uid).filter(Boolean).slice(0, 40), 15);
        // Fallback: always provide recommendations even when Functions/AI isn't available.
        if (!ranked.length) ranked = localCommonalityRank(me, people, 15);
        if (cancelled) return;
        const next: Record<string, { score: number; reason: string }> = {};
        ranked.forEach((r) => {
          next[r.uid] = { score: r.score, reason: r.reason };
        });
        setAiRank(next);
      } catch (e: any) {
        if (!cancelled) {
          console.warn('dashboard AI ranking unavailable', e?.message || String(e));
          const ranked = localCommonalityRank(me, people, 15);
          const next: Record<string, { score: number; reason: string }> = {};
          ranked.forEach((r) => {
            next[r.uid] = { score: r.score, reason: r.reason };
          });
          setAiRank(next);
        }
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, people.length]);

  const recommended = useMemo(() => {
    const list = people.map((p) => ({ p, s: (aiRank[p.uid]?.score ?? -1) + ((p as any).turboConnect ? 8 : 0) }));
    list.sort((a, b) => b.s - a.s);
    return list.filter((x) => x.s >= 0).slice(0, 12).map((x) => x.p);
  }, [people, aiRank]);

  const trending = useMemo(() => {
    const list = [...people];
    list.sort((a: any, b: any) => (earnedScore(b) + (b.turboConnect ? 8 : 0)) - (earnedScore(a) + (a.turboConnect ? 8 : 0)));
    return list.slice(0, 12);
  }, [people]);

  const opportunities = useMemo(() => {
    const list = people.map((p: any) => {
      const lf = Array.isArray(p.lookingFor) ? p.lookingFor.map((x: any) => String(x).toLowerCase()) : [];
      const wantsTeam = lf.some((x: string) => ['hiring', 'startup team', 'cofounder', 'investment', 'mentorship'].includes(x));
      const hasProjects = Array.isArray(p.projects) && p.projects.length > 0;
      const avail = String((p as any).availability || '').toLowerCase();
      const available = avail.includes('open') || avail.includes('available');
      const weight = (wantsTeam ? 40 : 0) + (hasProjects ? 35 : 0) + (available ? 20 : 0) + ((p as any).turboConnect ? 12 : 0) + earnedScore(p) * 0.1;
      return { profile: p, weight };
    }).filter((x) => x.weight > 0);
    list.sort((a, b) => b.weight - a.weight);
    return list.slice(0, 12).map((x) => x.profile);
  }, [people]);

  useEffect(() => {
    setOpportunityRadar(getBestOpportunityAlerts(me, people, 3));
  }, [me, people]);

  const topOpportunityAlert = opportunityRadar[0];

  const Card = ({ item, showScore }: { item: UserProfile; showScore?: boolean }) => {
    const score = aiRank[item.uid]?.score;
    return (
      <TouchableOpacity
        onPress={() => navigation.navigate('Profile', { userId: item.uid })}
        style={[styles.card, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}
      >
        <Image
          source={{ uri: item.profilePic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' }}
          style={styles.avatar}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
            {item.displayName || 'Builder'}
          </Text>
          <Text style={styles.handle} numberOfLines={1}>{handleFor(item)}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {(item as any).occupation || 'Builder'} • {(item.city || item.country) ? [item.city, item.country].filter(Boolean).join(', ') : 'Remote'}
          </Text>
          {!!showScore && typeof score === 'number' && (
            <TouchableOpacity
              onPress={() => Alert.alert('AI Compatibility', `${score}%\n\n${aiRank[item.uid]?.reason || ''}`)}
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
        style={[styles.opportunityCard, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}
        activeOpacity={0.9}
      >
        <View style={styles.opportunityTop}>
          <Image
            source={{ uri: item.profilePic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' }}
            style={styles.smallAvatar}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.opportunityTitle, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
              {details.title}
            </Text>
            <Text style={styles.handle} numberOfLines={1}>{handleFor(item)}</Text>
          </View>
          <View style={styles.livePill}>
            <Text style={styles.liveText}>ACTIVE</Text>
          </View>
        </View>

        <Text style={[styles.opportunitySummary, { color: isDark ? '#CCC' : '#333' }]} numberOfLines={3}>
          {details.summary}
        </Text>

        <View style={styles.opportunityMetaGrid}>
          <View style={styles.opportunityMeta}>
            <Target size={12} color="#FBE618" />
            <Text style={styles.opportunityMetaText} numberOfLines={1}>{details.roleNeed}</Text>
          </View>
          <View style={styles.opportunityMeta}>
            <Briefcase size={12} color="#2563EB" />
            <Text style={styles.opportunityMetaText} numberOfLines={1}>{details.stage}</Text>
          </View>
          <View style={styles.opportunityMeta}>
            <MapPin size={12} color="#4ADE80" />
            <Text style={styles.opportunityMetaText} numberOfLines={1}>{details.location}</Text>
          </View>
        </View>

        <View style={styles.tagsRow}>
          {details.tags.map((tag) => (
            <View key={tag} style={[styles.tagChip, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
              <Text style={[styles.tagText, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>{tag.toUpperCase()}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <TouchableOpacity onPress={() => navigation.navigate('Profile', { userId: item.uid })} style={[styles.opportunityBtn, { backgroundColor: '#FBE618' }]}>
            <Text style={[styles.opportunityBtnText, { color: '#000' }]}>VIEW PROFILE</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Search')} style={[styles.opportunityIconBtn, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
            <Search size={16} color={isDark ? '#FFF' : '#000'} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const Section = ({ title, icon, data, showScore, variant, onViewAll }: any) => (
    <View style={{ marginTop: 18 }}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onViewAll} activeOpacity={onViewAll ? 0.8 : 1}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon}
          <Text style={[styles.sectionTitle, { color: isDark ? '#FFF' : '#000' }]}>{title}</Text>
        </View>
        <ChevronRight size={18} color="#666" />
      </TouchableOpacity>
      <FlatList
        data={data}
        keyExtractor={(it) => it.uid}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6, gap: 12 }}
        ListEmptyComponent={
          <View style={[styles.emptyCard, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
            <Text style={[styles.emptyTitle, { color: isDark ? '#FFF' : '#000' }]}>No active opportunities yet</Text>
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
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      {loading ? (
        <ActivityIndicator color="#FBE618" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
            <View style={[styles.hero, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
              <Text style={[styles.heroTitle, { color: isDark ? '#FFF' : '#000' }]}>DISCOVERY DASHBOARD</Text>
              <Text style={styles.heroSub}>
                Recommended matches, trending builders, and active opportunities.
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity
                  onPress={() => navigation.navigate('SwipeDeck')}
                  style={[styles.heroBtn, { backgroundColor: '#FBE618' }]}
                >
                  <Text style={[styles.heroBtnText, { color: '#000' }]}>OPEN SWIPE</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => navigation.navigate('Search')}
                  style={[styles.heroBtn, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE', borderWidth: 1 }]}
                >
                  <Text style={[styles.heroBtnText, { color: isDark ? '#FFF' : '#000' }]}>SEARCH</Text>
                </TouchableOpacity>
              </View>

              <View style={{ marginTop: 10 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 2, color: '#666' }}>
                  {aiLoading ? 'AI RANKING…' : 'AI RANKING READY'}
                </Text>
              </View>

              {topOpportunityAlert ? (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => navigation.navigate('ActiveOpportunity', { userId: topOpportunityAlert.profile.uid })}
                  style={[styles.radarCard, { backgroundColor: isDark ? '#16161A' : '#FFFCE6', borderColor: '#FBE61855' }]}
                >
                  <View style={styles.radarTop}>
                    <View style={styles.radarIcon}>
                      <BellRing size={16} color="#000" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.radarTitle, { color: isDark ? '#FFF' : '#000' }]}>AI OPPORTUNITY RADAR</Text>
                      <Text style={styles.radarSub} numberOfLines={2}>
                        {topOpportunityAlert.profile.displayName || 'A builder'} matches your interests: {topOpportunityAlert.reason}
                      </Text>
                    </View>
                    <View style={styles.radarScore}>
                      <Text style={styles.radarScoreText}>{topOpportunityAlert.score}%</Text>
                    </View>
                  </View>
                  <Text style={[styles.radarSummary, { color: isDark ? '#DDD' : '#222' }]} numberOfLines={2}>
                    {topOpportunityAlert.summary}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.radarCard, { backgroundColor: isDark ? '#16161A' : '#F8FAFC', borderColor: isDark ? '#222226' : '#E2E8F0' }]}>
                  <Text style={[styles.radarTitle, { color: isDark ? '#FFF' : '#000' }]}>AI OPPORTUNITY RADAR</Text>
                  <Text style={styles.radarSub}>No strong opportunity yet. Add more skills/interests to sharpen alerts.</Text>
                </View>
              )}
            </View>
          </View>

          <Section
            title="Recommended Matches"
            icon={<Sparkles size={18} color="#FBE618" />}
            data={recommended}
            showScore
            onViewAll={() => navigation.navigate('RecommendedMatches')}
          />
          <Section
            title="Trending Builders"
            icon={<TrendingUp size={18} color="#2563EB" />}
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
  container: { flex: 1 },
  hero: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
  },
  heroTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
  },
  heroSub: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    lineHeight: 18,
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
    backgroundColor: '#FBE618',
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
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  radarScoreText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFF',
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
  name: { fontSize: 14, fontWeight: '900', textTransform: 'uppercase', fontStyle: 'italic' },
  handle: { marginTop: 2, fontSize: 10, color: '#2563EB', fontWeight: '900' },
  meta: { marginTop: 4, fontSize: 10, color: '#666', fontWeight: '900' },
  scorePill: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FBE618',
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
    backgroundColor: '#FBE618',
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
