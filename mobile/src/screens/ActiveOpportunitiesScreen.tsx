import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, FlatList } from 'react-native';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Briefcase, MapPin, Search, Target, Users } from 'lucide-react-native';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile } from '../types';
import { earnedScore, handleFor, isDiscoverableProfile, opportunityDetails } from '../lib/discovery';
import { getBestProjectRecommendations, scoreProjectFit } from '../lib/projectRecommendations';

export default function ActiveOpportunitiesScreen({ navigation }: any) {
  const { user, profile: me } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [builders, setBuilders] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) {
      setBuilders([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'users'),
      where('isVisible', '==', true),
      where('isStealthMode', '==', false),
      limit(80)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((docSnap) => ({ uid: docSnap.id, ...(docSnap.data() as any) } as UserProfile))
          .filter((profile: any) => profile.uid !== user.uid && isDiscoverableProfile(profile));
        setBuilders(list);
        setLoading(false);
      },
      (error) => {
        console.error('Active opportunities error:', error);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user?.uid]);

  const opportunities = useMemo(() => {
    const scored = builders
      .map((profile: any) => {
        const lookingFor = Array.isArray(profile.lookingFor) ? profile.lookingFor.map((item: any) => String(item).toLowerCase()) : [];
        const needsHelp = lookingFor.some((item: string) =>
          ['cofounder', 'technical cofounder', 'hiring', 'startup team', 'investment', 'mentorship', 'partnerships'].includes(item)
        );
        const hasProject = Array.isArray(profile.projects) && profile.projects.length > 0;
        const available = String(profile.availability || '').toLowerCase();
        const availabilityBoost = available.includes('open') || available.includes('available') ? 18 : 0;
        const weight = (needsHelp ? 42 : 0) + (hasProject ? 30 : 0) + availabilityBoost + (profile.turboConnect ? 10 : 0) + earnedScore(profile) * 0.15;
        return { profile, weight };
      })
      .filter((item) => item.weight > 0)
      .sort((left, right) => right.weight - left.weight);

    const recommendedOwners = getBestProjectRecommendations(me, builders, 40).map((item) => item.owner.uid);
    return scored
      .sort((left, right) => {
        const leftBoost = recommendedOwners.indexOf(left.profile.uid);
        const rightBoost = recommendedOwners.indexOf(right.profile.uid);
        const leftRank = leftBoost === -1 ? 999 : leftBoost;
        const rightRank = rightBoost === -1 ? 999 : rightBoost;
        return leftRank - rightRank || right.weight - left.weight;
      })
      .slice(0, 40)
      .map((item) => item.profile);
  }, [builders, me]);

  const renderItem = ({ item }: { item: UserProfile }) => {
    const details = opportunityDetails(item);
    const recommendedProject = Array.isArray(item.projects)
      ? item.projects.map((project) => scoreProjectFit(me, item, project)).filter(Boolean)[0]
      : null;
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => navigation.navigate('ActiveOpportunity', { userId: item.uid, projectId: recommendedProject?.project.id })}
        style={[styles.card, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}
      >
        <View style={styles.cardTop}>
          <Image
            source={{ uri: item.profilePic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' }}
            style={styles.avatar}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
              {details.title}
            </Text>
            <Text style={styles.handle} numberOfLines={1}>{handleFor(item)}</Text>
          </View>
          <View style={styles.livePill}>
            <Text style={styles.liveText}>{recommendedProject ? `${recommendedProject.score}% FIT` : 'ACTIVE'}</Text>
          </View>
        </View>

        <Text style={[styles.summary, { color: isDark ? '#CCC' : '#333' }]} numberOfLines={3}>
          {details.summary}
        </Text>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Target size={12} color="#FBE618" />
            <Text style={styles.metaText} numberOfLines={1}>{details.roleNeed}</Text>
          </View>
          <View style={styles.metaItem}>
            <Briefcase size={12} color="#2563EB" />
            <Text style={styles.metaText} numberOfLines={1}>{details.stage}</Text>
          </View>
          <View style={styles.metaItem}>
            <MapPin size={12} color="#4ADE80" />
            <Text style={styles.metaText} numberOfLines={1}>{details.location}</Text>
          </View>
        </View>

        <View style={styles.tagsRow}>
          {details.tags.slice(0, 4).map((tag) => (
            <View key={`${item.uid}-${tag}`} style={[styles.tagChip, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
              <Text style={[styles.tagText, { color: isDark ? '#FFF' : '#000' }]}>{String(tag).toUpperCase()}</Text>
            </View>
          ))}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backButton, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
          <ChevronLeft size={22} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: isDark ? '#FFF' : '#000' }]}>ACTIVE OPPORTUNITIES</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={[styles.heroCard, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
        <View style={styles.heroRow}>
          <Users size={20} color="#4ADE80" />
          <Text style={[styles.heroTitle, { color: isDark ? '#FFF' : '#000' }]}>Builders ready for action</Text>
        </View>
        <Text style={styles.heroSub}>
          Open opportunities from founders and builders actively looking for teammates, collaborators, and momentum.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#FBE618" style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={opportunities}
          keyExtractor={(item) => item.uid}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={[styles.emptyCard, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
              <Text style={[styles.emptyTitle, { color: isDark ? '#FFF' : '#000' }]}>No active opportunities yet</Text>
              <Text style={styles.emptySub}>Try search to find builders by role, stage, or industry.</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Search')} style={styles.emptyBtn}>
                <Search size={16} color="#000" />
                <Text style={styles.emptyBtnText}>OPEN SEARCH</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: { width: 42, height: 42 },
  headerTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 1.7 },
  heroCard: {
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  heroTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroSub: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    lineHeight: 18,
  },
  listContent: {
    padding: 16,
    paddingBottom: 120,
    gap: 14,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
  },
  title: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  handle: {
    marginTop: 2,
    fontSize: 10,
    color: '#2563EB',
    fontWeight: '900',
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
  summary: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  metaRow: {
    marginTop: 12,
    gap: 8,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '900',
    color: '#666',
    textTransform: 'uppercase',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  tagChip: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tagText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  emptyCard: {
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
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    lineHeight: 18,
  },
  emptyBtn: {
    marginTop: 14,
    height: 44,
    borderRadius: 16,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  emptyBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: '#000',
  },
});
