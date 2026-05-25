import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, FlatList, Alert } from 'react-native';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BadgeCheck, ChevronLeft, MessageSquare, Search, Sparkles, Target, User, Zap } from 'lucide-react-native';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile } from '../types';
import { handleFor, isDiscoverableProfile } from '../lib/discovery';
import { localCommonalityRank, rankedCandidatesToMap, rankCandidatesHybrid } from '../lib/matchmaking';
import { ensureDirectMatch } from '../lib/chat';

type MatchScore = {
  score: number;
  reason: string;
  cached?: boolean;
};

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();
const asList = (value: unknown) => (Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []);

const sharedSignalsFor = (me: UserProfile | null | undefined, person: UserProfile) => {
  const mySkills = new Set(asList(me?.skills).map(normalize));
  const myIndustries = new Set(asList((me as any)?.industries).map(normalize));
  const myLookingFor = new Set(asList((me as any)?.lookingFor).map(normalize));
  const skills = asList(person.skills).filter((skill) => mySkills.has(normalize(skill)));
  const industries = asList((person as any).industries).filter((industry) => myIndustries.has(normalize(industry)));
  const lookingFor = asList((person as any).lookingFor).filter((goal) => myLookingFor.has(normalize(goal)));
  return [...skills, ...industries, ...lookingFor].slice(0, 5);
};

export default function RecommendedMatchesScreen({ navigation }: any) {
  const { user, profile: me } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [scores, setScores] = useState<Record<string, MatchScore>>({});
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const localScores = useMemo(() => {
    return rankedCandidatesToMap(localCommonalityRank(me, people, Math.max(people.length, 30)));
  }, [me, people]);

  useEffect(() => {
    if (!user?.uid) {
      setPeople([]);
      setLoading(false);
      return;
    }

    const usersQuery = query(
      collection(db, 'users'),
      where('isVisible', '==', true),
      where('isStealthMode', '==', false),
      limit(80)
    );

    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const list = snapshot.docs
          .map((docSnap) => ({ uid: docSnap.id, ...(docSnap.data() as any) } as UserProfile))
          .filter((profile: any) => profile.uid !== user.uid && isDiscoverableProfile(profile));
        setPeople(list);
        setLoading(false);
      },
      (error) => {
        console.error('Recommended matches error:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || !people.length) {
      setScores({});
      return;
    }

    let cancelled = false;
    const localRanked = localCommonalityRank(me, people, 30);
    setScores(rankedCandidatesToMap(localRanked));

    (async () => {
      setAiLoading(true);
      try {
        let ranked = await rankCandidatesHybrid(me, people.slice(0, 40), 30);
        if (!ranked.length) ranked = localRanked;
        if (cancelled) return;

        setScores(rankedCandidatesToMap(ranked));
      } catch (error) {
        if (cancelled) return;
        setScores(rankedCandidatesToMap(localRanked));
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.uid, me?.uid, people]);

  const recommended = useMemo(() => {
    return people
      .map((person) => {
        const score = scores[person.uid]?.score ?? localScores[person.uid]?.score ?? 1;
        const boost = (person as any).turboConnect ? 8 : 0;
        return { person, weight: score + boost };
      })
      .filter((entry) => entry.weight > 0)
      .sort((left, right) => right.weight - left.weight)
      .slice(0, 40)
      .map((entry) => entry.person);
  }, [people, scores, localScores]);

  const openChat = async (profile: UserProfile) => {
    if (!user?.uid || !profile?.uid) return;
    setBusyUserId(profile.uid);
    try {
      const matchId = await ensureDirectMatch(user.uid, profile.uid);
      navigation.navigate('Chat', { matchId, otherUser: profile });
    } catch (error) {
      console.error('Recommended match chat error:', error);
      Alert.alert('Chat unavailable', 'Could not open this conversation right now.');
    } finally {
      setBusyUserId(null);
    }
  };

  const renderItem = ({ item, index }: { item: UserProfile; index: number }) => {
    const match = scores[item.uid] || localScores[item.uid] || { score: 1, reason: 'Promising builder match' };
    const location = [item.city, item.country].filter(Boolean).join(', ') || 'Remote';
    const signals = sharedSignalsFor(me, item);
    const tags = signals.length
      ? signals
      : [...asList((item as any).lookingFor), ...asList(item.skills), ...asList((item as any).industries)].slice(0, 5);

    return (
      <View style={[styles.card, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
        <View style={styles.cardTop}>
          <View style={styles.rankPill}>
            <Text style={styles.rankText}>MATCH #{index + 1}</Text>
          </View>
          <TouchableOpacity
            style={styles.scorePill}
            onPress={() => Alert.alert('Compatibility', `${match.score}%\n\n${match.reason}`)}
            activeOpacity={0.85}
          >
            <Sparkles size={12} color="#000" />
            <Text style={styles.scoreText}>{match.score}%</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => navigation.navigate('Profile', { userId: item.uid, compatibilityScore: match.score, compatibilityReason: match.reason })}
          style={styles.profileRow}
        >
          <Image
            source={{ uri: item.profilePic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' }}
            style={styles.avatar}
          />
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
                {item.displayName || 'Builder'}
              </Text>
              {item.isVerified && (
                <View style={styles.verifiedMiniBadge}>
                  <BadgeCheck size={13} color="#000" fill="#FBE618" />
                </View>
              )}
            </View>
            <Text style={styles.handle} numberOfLines={1}>{handleFor(item)}</Text>
            <Text style={styles.meta} numberOfLines={2}>
              {(item.occupation || 'Builder')} • {location}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={[styles.reasonBox, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
          <Zap size={14} color="#FBE618" />
          <Text style={[styles.reasonText, { color: isDark ? '#DDD' : '#333' }]} numberOfLines={3}>
            {match.reason}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Target size={12} color="#FBE618" />
            <Text style={styles.infoText} numberOfLines={1}>
              {asList((item as any).lookingFor).slice(0, 2).join(', ') || 'Networking'}
            </Text>
          </View>
          <View style={styles.infoItem}>
            <Search size={12} color="#2563EB" />
            <Text style={styles.infoText} numberOfLines={1}>
              {(item as any).startupStage || 'Exploring'}
            </Text>
          </View>
        </View>

        <View style={styles.tagsRow}>
          {tags.length ? tags.map((tag) => (
            <View
              key={`${item.uid}-${tag}`}
              style={[styles.tagChip, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE' }]}
            >
              <Text style={[styles.tagText, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
                {String(tag).toUpperCase()}
              </Text>
            </View>
          )) : (
            <View style={[styles.tagChip, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
              <Text style={[styles.tagText, { color: isDark ? '#FFF' : '#000' }]}>PROMISING MATCH</Text>
            </View>
          )}
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE' }]}
            onPress={() => navigation.navigate('Profile', { userId: item.uid, compatibilityScore: match.score, compatibilityReason: match.reason })}
          >
            <User size={16} color={isDark ? '#FFF' : '#000'} />
            <Text style={[styles.actionText, { color: isDark ? '#FFF' : '#000' }]}>PROFILE</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#FBE618', borderColor: '#FBE618' }]}
            onPress={() => openChat(item)}
            disabled={busyUserId === item.uid}
          >
            {busyUserId === item.uid ? <ActivityIndicator size="small" color="#000" /> : <MessageSquare size={16} color="#000" />}
            <Text style={[styles.actionText, { color: '#000' }]}>MESSAGE</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backButton, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
          <ChevronLeft size={22} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: isDark ? '#FFF' : '#000' }]}>RECOMMENDED MATCHES</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={[styles.heroCard, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
        <View style={styles.heroRow}>
          <Sparkles size={20} color="#FBE618" />
          <Text style={[styles.heroTitle, { color: isDark ? '#FFF' : '#000' }]}>Recommended people for you</Text>
        </View>
        <Text style={styles.heroSub}>
          Ranked by shared skills, industries, goals, work style, and compatibility so you can find useful people faster.
        </Text>
        <Text style={styles.aiStatus}>{aiLoading ? 'RANKING…' : 'MATCHES READY'}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#FBE618" style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={recommended}
          keyExtractor={(item) => item.uid}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={[styles.emptyCard, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
              <Text style={[styles.emptyTitle, { color: isDark ? '#FFF' : '#000' }]}>No recommendations yet</Text>
              <Text style={styles.emptySub}>Complete your profile or use search filters while LINKUP learns your matching signals.</Text>
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
  headerTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
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
  aiStatus: {
    marginTop: 12,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    color: '#666',
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
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  rankPill: {
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2563EB20',
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#2563EB',
  },
  scorePill: {
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FBE618',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  scoreText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#000',
  },
  profileRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 20,
  },
  name: {
    fontSize: 15,
    fontWeight: '900',
    textTransform: 'uppercase',
    fontStyle: 'italic',
    flexShrink: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  verifiedMiniBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  handle: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '900',
    color: '#2563EB',
  },
  meta: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '800',
    color: '#666',
    lineHeight: 16,
  },
  reasonBox: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    gap: 8,
  },
  reasonText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  infoRow: {
    gap: 8,
    marginTop: 12,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoText: {
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
    maxWidth: '48%',
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tagText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  actionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.6,
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
