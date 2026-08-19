import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, FlatList } from 'react-native';
import { notifyUser } from '../lib/notify';
import { ChevronLeft, Crown, Flame, Trophy, User } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile } from '../types';
import { handleFor } from '../lib/discovery';
import { leagueHeat, notifyLeaguePodium, rankLeague } from '../lib/builderLeague';
import { resolveConnectionGate, startTalkOrRequest } from '../lib/connectionRequests';
import { useConnectionNote } from '../components/ConnectionNoteModal';
import { displayNameFor } from '../lib/discovery';
import { MOBILE_LIST_IMAGE_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';
import VerifiedBadge from '../components/VerifiedBadge';
import { loadLeaguePool } from '../lib/leaguePool';
import { COLORS, textColor } from '../theme/theme';
import ProCrownBadge from '../components/ProCrownBadge';

const heatFor = (profile: any) => Math.max(1, Math.min(99, Math.round(leagueHeat(profile))));

const medal = (index: number) => {
  if (index === 0) return { bg: '#FBE618', fg: '#111', label: '1ST' };
  if (index === 1) return { bg: '#D7DCE3', fg: '#111', label: '2ND' };
  if (index === 2) return { bg: '#E08A3A', fg: '#111', label: '3RD' };
  return { bg: 'rgba(251,230,24,0.14)', fg: COLORS.primary, label: `#${index + 1}` };
};

export default function TrendingBuildersScreen({ navigation }: any) {
  const { user, profile: me } = useAuth();
  const { theme } = useTheme();
  const isFocused = useIsFocused();
  const isDark = theme === 'dark';
  const [builders, setBuilders] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const connectionNote = useConnectionNote();

  useEffect(() => {
    if (!user?.uid) {
      setBuilders([]);
      setLoading(false);
      return;
    }
    if (!isFocused) return;

    let alive = true;
    setLoading(true);
    loadLeaguePool()
      .then((rows) => {
        if (!alive) return;
        setBuilders(rows);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [isFocused, user?.uid]);

  const trending = useMemo(() => rankLeague(builders, me), [builders, me]);

  useEffect(() => {
    if (!user?.uid || trending.length < 1) return;
    const top = trending.slice(0, 3);
    void notifyLeaguePodium(top, user.uid);
  }, [user?.uid, trending.map((p) => p.uid).join('|')]);

  const podium = trending.slice(0, 3);
  const rest = trending.slice(3);
  const myRank = me?.uid ? trending.findIndex((p) => p.uid === me.uid) : -1;
  const boardSize = Math.max(trending.length, 1);

  const openChat = async (profile: UserProfile) => {
    if (!user?.uid) {
      notifyUser('Sign in first', 'Create or sign in to a LINKUP account to talk to #1.');
      navigation.navigate('EmailAuth');
      return;
    }
    if (!profile?.uid) {
      notifyUser('No #1 yet', 'The board is still filling. Try again in a moment.');
      return;
    }
    if (profile.uid === user.uid) {
      notifyUser('That’s you', 'You’re already #1 on the board.');
      return;
    }
    if (busyUserId) return;

    setBusyUserId(profile.uid);
    try {
      const gate = await resolveConnectionGate(user.uid, profile.uid);
      let note = '';
      if (gate.status === 'none') {
        const drafted = await connectionNote.ask(displayNameFor(profile));
        if (drafted === null) return;
        note = drafted;
      }
      const result = await startTalkOrRequest({
        senderId: user.uid,
        recipientId: profile.uid,
        senderName: displayNameFor(me || user),
        senderPic: safeProfileImageUri((me as any)?.profilePic, MOBILE_LIST_IMAGE_LIMIT),
        message: note,
      });
      if (result.action === 'chat' && result.matchId) {
        navigation.navigate('Chat', { matchId: result.matchId, otherUser: profile });
        return;
      }
      if (result.action === 'pending') {
        notifyUser('Request pending', `${displayNameFor(profile)} has not answered yet.`);
        return;
      }
      if (result.action === 'incoming') {
        notifyUser('They already asked', 'Approve their request in Notifications to start chatting.');
        navigation.navigate('Alerts');
        return;
      }
      if (result.action === 'rejected') {
        notifyUser('Not available', 'This builder declined your last request.');
        return;
      }
      notifyUser('Request sent', `${displayNameFor(profile)} can approve or ignore it. You can chat after they approve.`);
    } catch (error) {
      console.warn('Talk to #1 failed:', error);
      notifyUser('Could not send', 'Check your connection and try again.');
    } finally {
      setBusyUserId(null);
    }
  };

  const talkToFirst = () => {
    const first = podium[0];
    if (!first) {
      notifyUser('No #1 yet', 'When someone is trending, Talk to #1 opens a request.');
      return;
    }
    void openChat(first);
  };

  const renderRow = (item: UserProfile, index: number) => {
    const rank = index + 1;
    const chip = medal(index);
    const heat = heatFor(item);
    const location = [item.city, item.country].filter(Boolean).join(', ') || 'Remote';

    return (
      <TouchableOpacity
        key={item.uid}
        activeOpacity={0.88}
        onPress={() => navigation.navigate('Profile', { userId: item.uid })}
        style={[styles.row, { backgroundColor: isDark ? '#161616' : '#FFF', borderColor: index < 3 ? COLORS.primary : isDark ? '#2A2A2A' : '#EFEFEF' }]}
      >
        <View style={[styles.rankBox, { backgroundColor: chip.bg }]}>
          <Text style={[styles.rankText, { color: chip.fg }]}>{chip.label}</Text>
        </View>
        <Image
          source={{ uri: safeProfileImageUri(item.profilePic, MOBILE_LIST_IMAGE_LIMIT) || 'https://ui-avatars.com/api/?name=+&background=E5E7EB&color=9CA3AF&size=256' }}
          style={styles.avatar}
        />
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: textColor(isDark) }]} numberOfLines={1}>
              {item.uid === me?.uid ? 'You' : item.displayName || 'Builder'}
            </Text>
            {item.uid === me?.uid ? (
              <View style={styles.youPill}><Text style={styles.youPillText}>YOU</Text></View>
            ) : item.isVerified ? (
              <VerifiedBadge size={18} />
            ) : null}
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {(item.occupation || 'Builder')} · {location}
          </Text>
          <View style={styles.heatTrack}>
            <View style={[styles.heatFill, { width: `${heat}%` }]} />
          </View>
        </View>
        <View style={styles.heatCol}>
          <Flame size={14} color="#FF4D2E" />
          <Text style={styles.heatNum}>{heat}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: isDark ? '#0B0B0B' : '#F6F4EA' }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>BUILDER LEAGUE</Text>
        <ProCrownBadge />
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.arena}>
        <View style={styles.liveRow}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE BOARD</Text>
          <Trophy size={14} color="#111" />
        </View>
        <Text style={styles.arenaTitle}>Who’s winning LINKUP right now</Text>
        <Text style={styles.arenaSub}>
          Fair live top 3 — profile quality, views, and recent activity. No Plus boost. Podium people get a notification.
        </Text>
        <View style={styles.statRow}>
          <View style={styles.statChip}>
            <Crown size={13} color="#111" />
            <Text style={styles.statText}>{Math.min(3, boardSize)} trending now</Text>
          </View>
          <View style={styles.statChip}>
            <Flame size={13} color="#FF4D2E" />
            <Text style={styles.statText}>
              {myRank >= 0 ? (myRank < 3 ? `You’re #${myRank + 1}` : `You’re #${myRank + 1} — chase the podium`) : 'Heat updates live'}
            </Text>
          </View>
        </View>
      </View>

      {loading && builders.length === 0 ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(item) => item.uid}
          renderItem={({ item, index }) => renderRow(item, index + 3)}
          ListHeaderComponent={
            podium.length ? (
              <View style={styles.podiumWrap}>
                <Text style={[styles.podiumLabel, { color: textColor(isDark) }]}>THE PODIUM</Text>
                <View style={styles.podium}>
                  {[podium[1], podium[0], podium[2]].filter(Boolean).map((item) => {
                    const realIndex = trending.findIndex((p) => p.uid === item.uid);
                    const tall = realIndex === 0;
                    return (
                      <TouchableOpacity
                        key={item.uid}
                        style={[styles.podiumCard, tall && styles.podiumFirst, { backgroundColor: isDark ? '#161616' : '#FFF' }]}
                        onPress={() => navigation.navigate('Profile', { userId: item.uid })}
                        activeOpacity={0.9}
                      >
                        <View style={[styles.podiumRank, { backgroundColor: medal(realIndex).bg }]}>
                          <Text style={styles.podiumRankText}>{medal(realIndex).label}</Text>
                        </View>
                        <Image
                          source={{ uri: safeProfileImageUri(item.profilePic, MOBILE_LIST_IMAGE_LIMIT) || 'https://ui-avatars.com/api/?name=+&background=E5E7EB&color=9CA3AF&size=256' }}
                          style={[styles.podiumAvatar, tall && { width: 72, height: 72, borderRadius: 36 }]}
                        />
                        <Text style={[styles.podiumName, { color: textColor(isDark) }]} numberOfLines={1}>
                          {item.uid === me?.uid ? 'You' : item.displayName || 'Builder'}
                        </Text>
                        {item.uid === me?.uid ? <Text style={styles.youOnPodium}>YOU</Text> : null}
                        <Text style={styles.podiumHeat}>HEAT {heatFor(item)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={[styles.chaseLabel, { color: textColor(isDark) }]}>THE CHASE</Text>
              </View>
            ) : null
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            podium.length ? null : (
              <View style={styles.emptyCard}>
                <Text style={[styles.emptyTitle, { color: textColor(isDark) }]}>Board is empty</Text>
                <Text style={styles.emptySub}>When more builders go public, the league starts here.</Text>
              </View>
            )
          }
        />
      )}
      {connectionNote.modal}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 8,
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
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  headerSpacer: { width: 42, height: 42 },
  headerTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 2 },
  arena: {
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    padding: 18,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#111',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF3B30' },
  liveText: { color: '#FFF', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  arenaTitle: {
    marginTop: 14,
    fontSize: 26,
    fontWeight: '900',
    color: '#111',
    letterSpacing: -0.8,
    lineHeight: 30,
  },
  arenaSub: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '700',
    color: '#3A3A3A',
    lineHeight: 18,
  },
  statRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  statText: { fontSize: 11, fontWeight: '800', color: '#111' },
  podiumWrap: { paddingHorizontal: 2, paddingBottom: 8 },
  podiumLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6, marginBottom: 10 },
  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  podiumCard: {
    flex: 1,
    borderRadius: 18,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  podiumFirst: { paddingTop: 16, paddingBottom: 16, borderWidth: 2, borderColor: COLORS.primary },
  podiumRank: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 },
  podiumRankText: { fontSize: 9, fontWeight: '900', color: '#111' },
  podiumAvatar: { width: 54, height: 54, borderRadius: 27, borderWidth: 2, borderColor: COLORS.primary },
  podiumName: { marginTop: 8, fontSize: 11, fontWeight: '900', textAlign: 'center' },
  podiumHeat: { marginTop: 3, fontSize: 10, fontWeight: '900', color: '#FF4D2E' },
  challengeBtn: {
    marginTop: 12,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  challengeBtnBar: {
    marginHorizontal: 16,
    marginTop: 12,
    height: 50,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  youLeadBar: {
    marginHorizontal: 16,
    marginTop: 12,
    height: 50,
    borderRadius: 16,
    backgroundColor: '#111',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  challengeText: { fontSize: 13, fontWeight: '900', color: '#111' },
  youLead: {
    marginTop: 12,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#111',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  youLeadText: { fontSize: 13, fontWeight: '900', color: COLORS.primary },
  youPill: {
    backgroundColor: COLORS.primary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  youPillText: { fontSize: 9, fontWeight: '900', color: '#111' },
  youOnPodium: { marginTop: 2, fontSize: 9, fontWeight: '900', color: '#111' },
  chaseLabel: { marginTop: 22, marginBottom: 8, fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
  listContent: { padding: 16, paddingBottom: 120, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
  },
  rankBox: {
    minWidth: 46,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  rankText: { fontSize: 11, fontWeight: '900' },
  avatar: { width: 48, height: 48, borderRadius: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 14, fontWeight: '900', flexShrink: 1 },
  meta: { marginTop: 2, fontSize: 11, fontWeight: '700', color: '#777' },
  heatTrack: {
    marginTop: 8,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,77,46,0.12)',
    overflow: 'hidden',
  },
  heatFill: { height: '100%', backgroundColor: '#FF4D2E', borderRadius: 999 },
  heatCol: { alignItems: 'center', width: 34 },
  heatNum: { marginTop: 2, fontSize: 12, fontWeight: '900', color: '#FF4D2E' },
  emptyCard: { padding: 18 },
  emptyTitle: { fontSize: 14, fontWeight: '900' },
  emptySub: { marginTop: 6, fontSize: 12, fontWeight: '700', color: '#666' },
});
