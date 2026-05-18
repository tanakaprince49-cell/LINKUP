import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity, Image, ActivityIndicator, FlatList, Alert } from 'react-native';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { UserProfile } from '../types';
import { rankCandidatesWithAI } from '../lib/matchmaking';
import { Sparkles, TrendingUp, Users, ChevronRight } from 'lucide-react-native';

export default function DiscoveryDashboardScreen({ navigation }: any) {
  const { user, profile: me } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [aiRank, setAiRank] = useState<Record<string, { score: number; reason: string }>>({});
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users'), where('uid', '!=', user.uid), limit(60));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as UserProfile).filter((p) => !(p as any).isStealthMode);
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
        const ranked = await rankCandidatesWithAI(
          people.map((p) => p.uid).filter(Boolean).slice(0, 40),
          15
        );
        if (cancelled) return;
        const next: Record<string, { score: number; reason: string }> = {};
        ranked.forEach((r) => {
          next[r.uid] = { score: r.score, reason: r.reason };
        });
        setAiRank(next);
      } catch (e: any) {
        if (!cancelled) console.warn('dashboard AI ranking unavailable', e?.message || String(e));
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, people.length]);

  const recommended = useMemo(() => {
    const list = people.map((p) => ({ p, s: aiRank[p.uid]?.score ?? -1 }));
    list.sort((a, b) => b.s - a.s);
    return list.filter((x) => x.s >= 0).slice(0, 12).map((x) => x.p);
  }, [people, aiRank]);

  const trending = useMemo(() => {
    const list = [...people];
    list.sort((a: any, b: any) => (Number(b.founderScore || 0) + Number(b.reputationScore || 0)) - (Number(a.founderScore || 0) + Number(a.reputationScore || 0)));
    return list.slice(0, 12);
  }, [people]);

  const opportunities = useMemo(() => {
    const list = people.filter((p: any) => {
      const lf = Array.isArray(p.lookingFor) ? p.lookingFor.map((x: any) => String(x).toLowerCase()) : [];
      const wantsTeam = lf.some((x: string) => ['hiring', 'startup team', 'cofounder', 'investment', 'mentorship'].includes(x));
      const hasProjects = Array.isArray(p.projects) && p.projects.length > 0;
      const avail = String((p as any).availability || '').toLowerCase();
      const available = avail.includes('open') || avail.includes('available');
      return wantsTeam || hasProjects || available;
    });
    return list.slice(0, 12);
  }, [people]);

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

  const Section = ({ title, icon, data, showScore }: any) => (
    <View style={{ marginTop: 18 }}>
      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon}
          <Text style={[styles.sectionTitle, { color: isDark ? '#FFF' : '#000' }]}>{title}</Text>
        </View>
        <ChevronRight size={18} color="#666" />
      </View>
      <FlatList
        data={data}
        keyExtractor={(it) => it.uid}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6, gap: 12 }}
        renderItem={({ item }) => <Card item={item} showScore={showScore} />}
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
                <TouchableOpacity
                  onPress={() => navigation.navigate('Onboarding')}
                  style={[styles.heroBtn, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE', borderWidth: 1 }]}
                >
                  <Text style={[styles.heroBtnText, { color: isDark ? '#FFF' : '#000' }]}>ONBOARD</Text>
                </TouchableOpacity>
              </View>

              <View style={{ marginTop: 10 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 2, color: '#666' }}>
                  {aiLoading ? 'AI RANKING…' : 'AI RANKING READY'}
                </Text>
              </View>
            </View>
          </View>

          <Section
            title="Recommended Matches"
            icon={<Sparkles size={18} color="#FBE618" />}
            data={recommended}
            showScore
          />
          <Section title="Trending Builders" icon={<TrendingUp size={18} color="#2563EB" />} data={trending} />
          <Section title="Active Opportunities" icon={<Users size={18} color="#4ADE80" />} data={opportunities} />
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
});
