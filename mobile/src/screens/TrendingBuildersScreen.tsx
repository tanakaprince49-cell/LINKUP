import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, FlatList } from 'react-native';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';
import { ChevronLeft, MessageSquare, Sparkles, TrendingUp, User } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile } from '../types';
import { earnedScore, handleFor, isDiscoverableProfile } from '../lib/discovery';
import { ensureDirectMatch } from '../lib/chat';

export default function TrendingBuildersScreen({ navigation }: any) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [builders, setBuilders] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

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
        console.error('Trending builders error:', error);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user?.uid]);

  const trending = useMemo(() => {
    return [...builders]
      .sort((a: any, b: any) => {
        const left = earnedScore(b) + (b.turboConnect ? 8 : 0) + (Number(b.viewedBy?.length || 0) * 0.3);
        const right = earnedScore(a) + (a.turboConnect ? 8 : 0) + (Number(a.viewedBy?.length || 0) * 0.3);
        return left - right;
      })
      .slice(0, 30);
  }, [builders]);

  const openChat = async (profile: UserProfile) => {
    if (!user?.uid || !profile?.uid) return;
    setBusyUserId(profile.uid);
    try {
      const matchId = await ensureDirectMatch(user.uid, profile.uid);
      navigation.navigate('Chat', { matchId, otherUser: profile });
    } catch (error) {
      console.error('Trending builders chat error:', error);
    } finally {
      setBusyUserId(null);
    }
  };

  const renderItem = ({ item, index }: { item: UserProfile; index: number }) => {
    const score = earnedScore(item);
    const location = [item.city, item.country].filter(Boolean).join(', ') || 'Remote';
    const highlights = [
      ...(Array.isArray(item.lookingFor) ? item.lookingFor : []),
      ...(Array.isArray(item.skills) ? item.skills : []),
    ].slice(0, 4);

    return (
      <View style={[styles.card, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
        <View style={styles.cardTop}>
          <View style={styles.rankPill}>
            <Text style={styles.rankText}>#{index + 1}</Text>
          </View>
          <View style={styles.scorePill}>
            <Sparkles size={12} color="#000" />
            <Text style={styles.scoreText}>{score}</Text>
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => navigation.navigate('Profile', { userId: item.uid })}
          style={styles.profileRow}
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
            <Text style={styles.meta} numberOfLines={2}>
              {(item.occupation || 'Builder')} • {location}
            </Text>
          </View>
        </TouchableOpacity>

        {!!item.bio && (
          <Text style={[styles.bio, { color: isDark ? '#CCC' : '#444' }]} numberOfLines={3}>
            {item.bio}
          </Text>
        )}

        <View style={styles.tagsRow}>
          {highlights.length ? highlights.map((tag) => (
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
              <Text style={[styles.tagText, { color: isDark ? '#FFF' : '#000' }]}>OPEN TO NETWORKING</Text>
            </View>
          )}
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE' }]}
            onPress={() => navigation.navigate('Profile', { userId: item.uid })}
          >
            <User size={16} color={isDark ? '#FFF' : '#000'} />
            <Text style={[styles.actionText, { color: isDark ? '#FFF' : '#000' }]}>PROFILE</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#FBE618', borderColor: '#FBE618' }]}
            onPress={() => openChat(item)}
            disabled={busyUserId === item.uid}
          >
            {busyUserId === item.uid ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <MessageSquare size={16} color="#000" />
            )}
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
        <Text style={[styles.headerTitle, { color: isDark ? '#FFF' : '#000' }]}>TRENDING BUILDERS</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={[styles.heroCard, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
        <View style={styles.heroRow}>
          <TrendingUp size={20} color="#2563EB" />
          <Text style={[styles.heroTitle, { color: isDark ? '#FFF' : '#000' }]}>Top builders in your network</Text>
        </View>
        <Text style={styles.heroSub}>
          Ranked by profile strength, activity signals, visibility, and momentum so you can find serious people faster.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#FBE618" style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={trending}
          keyExtractor={(item) => item.uid}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={[styles.emptyCard, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
              <Text style={[styles.emptyTitle, { color: isDark ? '#FFF' : '#000' }]}>No trending builders yet</Text>
              <Text style={styles.emptySub}>Once more discoverable profiles join, they’ll show up here.</Text>
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
  headerSpacer: {
    width: 42,
    height: 42,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.8,
  },
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
  bio: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
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
});
