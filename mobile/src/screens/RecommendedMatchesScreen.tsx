import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, FlatList, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { ChevronLeft, MessageSquare, Search, Sparkles, Target, User, Zap } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile } from '../types';
import { handleFor, isDiscoverableProfile } from '../lib/discovery';
import { localCommonalityRank, rankedCandidatesToMap, rankCandidatesHybrid } from '../lib/matchmaking';
import { ensureDirectMatch } from '../lib/chat';
import VerifiedBadge from '../components/VerifiedBadge';
import { subscribeToDiscoveryProfiles } from '../lib/discoveryProfiles';
import { consumeDailyUsage, FREE_LIMITS, getDailyUsage } from '../lib/paywall';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';

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
  const isFocused = useIsFocused();
  const isDark = theme === 'dark';
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [scores, setScores] = useState<Record<string, MatchScore>>({});
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [dailyRecommendationsUsed, setDailyRecommendationsUsed] = useState(0);
  const [lastRecommendationDate, setLastRecommendationDate] = useState<string | null>(null);
  const [lastRankedProfileIds, setLastRankedProfileIds] = useState<string[]>([]);

  const localScores = useMemo(() => {
    return rankedCandidatesToMap(localCommonalityRank(me, people, Math.max(people.length, 30)));
  }, [me, people]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    if (!user?.uid) return;

    const loadDailyUsage = async () => {
      const used = await getDailyUsage(user.uid, 'dailyRecommendations');
      setDailyRecommendationsUsed(used);
      const lastDate = await AsyncStorage.getItem(`linkup:last-recommendation-date:${user.uid}`);
      setLastRecommendationDate(lastDate);

      const lastNotifiedDate = await AsyncStorage.getItem(`linkup:last-notified-date:${user.uid}`);
      if (lastDate !== today && lastNotifiedDate !== today) {
        Alert.alert(
          'New Daily Recommendations!',
          `You have ${FREE_LIMITS.dailyRecommendations} fresh recommendations waiting for you today!`,
          [{ text: 'OK', onPress: () => AsyncStorage.setItem(`linkup:last-notified-date:${user.uid}`, today) }]
        );
      }
    };

    loadDailyUsage();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setPeople([]);
      setLoading(false);
      return;
    }
    if (!isFocused) return;

    const unsubscribe = subscribeToDiscoveryProfiles({
      userId: user.uid,
      onData: (profiles) => {
        const list = profiles.filter((profile: any) => profile.uid !== user.uid && isDiscoverableProfile(profile));
        setPeople((current) => (list.length > 0 || current.length === 0 ? list : current));
        setLoading(false);
      },
      onError: (error) => {
        console.error('Recommended matches error:', error);
        setLoading(false);
      },
    });

    return () => unsubscribe();
  }, [isFocused, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !isFocused || !people.length) {
      setScores({});
      setAiLoading(false);
      return;
    }

    const currentProfileIds = people.map(p => p.uid).sort().join(',');
    if (currentProfileIds === lastRankedProfileIds.join(',')) {
      return;
    }

    let cancelled = false;
    let debounceTimer: NodeJS.Timeout;

    const runRanking = async () => {
      setAiLoading(true);
      try {
        const ranked = await rankCandidatesHybrid(me, people.slice(0, 40), 30);
        if (cancelled) return;
        setScores(rankedCandidatesToMap(ranked));
        setLastRankedProfileIds(people.map(p => p.uid));
      } catch (error) {
        if (cancelled) return;
        const localRanked = localCommonalityRank(me, people, 30);
        setScores(rankedCandidatesToMap(localRanked));
        setLastRankedProfileIds(people.map(p => p.uid));
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    };

    debounceTimer = setTimeout(() => {
      runRanking();
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
    };
  }, [isFocused, user?.uid, me?.uid, people.length, lastRankedProfileIds]);

  const recommended = useMemo(() => {
    const limit = lastRecommendationDate === today ? Math.max(0, FREE_LIMITS.dailyRecommendations - dailyRecommendationsUsed) : FREE_LIMITS.dailyRecommendations;
    return people
      .map((person) => {
        const score = scores[person.uid]?.score ?? localScores[person.uid]?.score ?? 1;
        const boost = (person as any).turboConnect ? 8 : 0;
        return { person, score, weight: score + boost };
      })
      .filter((entry) => entry.weight > 0)
      .sort((left, right) => right.weight - left.weight)
      .slice(0, limit)
      .map((entry) => entry.person);
  }, [people, scores, localScores, dailyRecommendationsUsed, lastRecommendationDate, today]);

  const openChat = async (profile: UserProfile) => {
    if (!user?.uid || !profile?.uid) return;

    const usage = await consumeDailyUsage(user.uid, 'dailyRecommendations', FREE_LIMITS.dailyRecommendations);
    if (!usage.allowed && lastRecommendationDate === today) {
      Alert.alert('Daily limit reached', `You've used your ${FREE_LIMITS.dailyRecommendations} daily recommendations. Come back tomorrow for more!`);
      return;
    }

    setBusyUserId(profile.uid);
    try {
      const matchId = await ensureDirectMatch(user.uid, profile.uid);
      await AsyncStorage.setItem(`linkup:last-recommendation-date:${user.uid}`, today);
      setLastRecommendationDate(today);
      setDailyRecommendationsUsed(usage.used + 1);
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
      <View style={[styles.card, liquidGlass(isDark)]}>
        <View style={styles.cardTop}>
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
              <Text style={[styles.name, { color: textColor(isDark) }]} numberOfLines={1}>
                {item.displayName || 'Builder'}
              </Text>
              {item.isVerified && <VerifiedBadge size={22} />}
            </View>
            <Text style={styles.handle} numberOfLines={1}>{handleFor(item)}</Text>
            <Text style={styles.meta} numberOfLines={2}>
              {(item.occupation || 'Builder')} - {location}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={[styles.reasonBox, liquidGlass(isDark, false)]}>
          <Zap size={14} color={COLORS.primary} />
          <Text style={[styles.reasonText, { color: textColor(isDark, 'secondary') }]} numberOfLines={3}>
            {match.reason}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Target size={12} color={COLORS.primary} />
            <Text style={styles.infoText} numberOfLines={1}>
              {asList((item as any).lookingFor).slice(0, 2).join(', ') || 'Networking'}
            </Text>
          </View>
          <View style={styles.infoItem}>
            <Search size={12} color={COLORS.primary} />
            <Text style={styles.infoText} numberOfLines={1}>
              {(item as any).startupStage || 'Exploring'}
            </Text>
          </View>
        </View>

        <View style={styles.tagsRow}>
          {tags.length ? tags.map((tag, index) => (
            <View
              key={`${item.uid}-${tag}-${index}`}
              style={[styles.tagChip, liquidGlass(isDark, false)]}
            >
              <Text style={[styles.tagText, { color: textColor(isDark) }]} numberOfLines={1}>
                {String(tag).toUpperCase()}
              </Text>
            </View>
          )) : (
            <View style={[styles.tagChip, liquidGlass(isDark, false)]}>
              <Text style={[styles.tagText, { color: textColor(isDark) }]}>PROMISING MATCH</Text>
            </View>
          )}
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, liquidGlass(isDark, false)]}
            onPress={() => navigation.navigate('Profile', { userId: item.uid, compatibilityScore: match.score, compatibilityReason: match.reason })}
          >
            <User size={16} color={textColor(isDark)} />
            <Text style={[styles.actionText, { color: textColor(isDark) }]}>PROFILE</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}
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
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backButton, liquidGlass(isDark, false)]}>
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>RECOMMENDED MATCHES</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={[styles.heroCard, liquidGlass(isDark)]}>
        <View style={styles.heroRow}>
          <Sparkles size={20} color={COLORS.primary} />
          <Text style={[styles.heroTitle, { color: textColor(isDark) }]}>Recommended people for you</Text>
        </View>
        <Text style={styles.heroSub}>
          Ranked by shared skills, industries, goals, work style, and compatibility so you can find useful people faster.
        </Text>
        <Text style={styles.heroSub}>
          {lastRecommendationDate === today
            ? `${dailyRecommendationsUsed}/${FREE_LIMITS.dailyRecommendations} daily recommendations used`
            : `${FREE_LIMITS.dailyRecommendations} daily recommendations available`}
        </Text>
        <Text style={styles.aiStatus}>{aiLoading ? 'RANKING...' : 'MATCHES READY'}</Text>
      </View>

      {loading && people.length === 0 ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={recommended}
          keyExtractor={(item) => item.uid}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={80}
          windowSize={6}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={[styles.emptyCard, liquidGlass(isDark)]}>
              <Text style={[styles.emptyTitle, { color: textColor(isDark) }]}>No recommendations yet</Text>
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
  scorePill: {
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.primary,
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
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  handle: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '900',
    color: COLORS.primary,
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
    backgroundColor: COLORS.primary,
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
