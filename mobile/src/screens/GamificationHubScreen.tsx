import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGamification } from '../contexts/GamificationContext';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { subscribeToChallenges, GameChallenge, respondToChallenge, GameType } from '../lib/gameChallenges';
import { SponsoredSlot } from '../components/SponsoredCard';
import { hasLinkupPro } from '../lib/paywall';
import GameChallengeModal from '../components/GameChallengeModal';
import {
  Flame, Zap, Trophy, Target, TrendingUp,
  CheckCircle2, Lock, Layers, Lightbulb, Brain, ChevronRight, Swords,
} from 'lucide-react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface GameEntry {
  key: string;
  title: string;
  subtitle: string;
  emoji: string;
  bgColor: string;
  screen: string;
}

const GAMES: GameEntry[] = [
  { key: 'flip', title: 'Founder Flip', subtitle: 'Match the pairs', emoji: '🃏', bgColor: '#7C3AED', screen: 'FounderFlip' },
  { key: 'pitch', title: 'Pitch Perfect', subtitle: 'Generate startup ideas', emoji: '💡', bgColor: '#059669', screen: 'PitchPerfect' },
  { key: 'quiz', title: 'Network Quiz', subtitle: 'Test your founder IQ', emoji: '🧠', bgColor: '#2563EB', screen: 'NetworkQuiz' },
];

const PLAY_ICONS: Record<string, { active: string; inactive: string }> = {
  flip: { active: 'Layers', inactive: 'Layers' },
  pitch: { active: 'Lightbulb', inactive: 'Lightbulb' },
  quiz: { active: 'Brain', inactive: 'Brain' },
};

const GamificationHubScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { user, profile } = useAuth();
  const { sparkPoints, streakCount, longestStreak, missions, achievements, weeklyStats } = useGamification();
  const [challenges, setChallenges] = useState<GameChallenge[]>([]);
  const [challengeGame, setChallengeGame] = useState<GameEntry | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeToChallenges(user.uid, setChallenges);
    return unsub;
  }, [user?.uid]);

  const weekProgress = Math.min(
    100,
    ((weeklyStats.swipes + weeklyStats.likes * 2 + weeklyStats.connections * 5 + weeklyStats.messages * 2) / 50) * 100
  );

  const unlockedAchievements = achievements.filter((a) => (a.progress ?? 0) >= a.target);
  const lockedAchievements = achievements.filter((a) => (a.progress ?? 0) < a.target);

  const handleChallengeResponse = async (id: string, status: 'accepted' | 'declined', gameType?: GameType) => {
    if (status === 'accepted' && gameType) {
      const screenMap: Record<GameType, string> = {
        founderflip: 'FounderFlip',
        pitchperfect: 'PitchPerfect',
        networkquiz: 'NetworkQuiz',
      };
      const screen = screenMap[gameType];
      if (screen) {
        navigation.navigate(screen, { challengeId: id });
      }
    }
    await respondToChallenge(id, status);
    setChallenges((prev) => prev.filter((c) => c.id !== id));
  };

  const openGame = (game: GameEntry) => {
    navigation.navigate(game.screen);
  };

  const gameLabel = (type: GameType) => {
    const map: Record<GameType, string> = {
      founderflip: 'Founder Flip',
      pitchperfect: 'Pitch Perfect',
      networkquiz: 'Network Quiz',
    };
    return map[type] || type;
  };

  return (
    <SafeAreaView style={[styles.root, appBackground(isDark)]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: textColor(isDark) }]}>Play</Text>
            <Text style={[styles.subtitle, { color: textColor(isDark, 'muted') }]}>Mini-games & challenges</Text>
          </View>
          <TouchableOpacity style={[styles.sparkPill, { backgroundColor: COLORS.primary }]}>
            <Zap size={14} color="#000" fill="#000" />
            <Text style={styles.sparkCount}>{sparkPoints}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.streakStrip, { backgroundColor: streakCount > 0 ? 'rgba(17, 24, 39,0.1)' : 'transparent', borderColor: streakCount > 0 ? 'rgba(17, 24, 39,0.2)' : 'transparent' }]}>
          <Flame size={18} color={streakCount > 0 ? COLORS.primary : textColor(isDark, 'muted')} fill={streakCount > 0 ? COLORS.primary : 'transparent'} />
          <Text style={[styles.streakText, { color: streakCount > 0 ? COLORS.primary : textColor(isDark, 'muted') }]}>
            {streakCount > 0 ? `Day ${streakCount} 🔥 Best: ${longestStreak}` : 'Start your streak!'}
          </Text>
        </View>

        <View style={styles.loopRow}>
          <TouchableOpacity onPress={() => navigation.navigate('DailyFive')} style={[styles.loopBtn, { backgroundColor: COLORS.primary }]}>
            <Text style={styles.loopBtnText}>DAILY 5</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('ShipLog')} style={[styles.loopBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <Text style={[styles.loopBtnText, { color: textColor(isDark) }]}>SHIP</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('CityLeague')} style={[styles.loopBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <Text style={[styles.loopBtnText, { color: textColor(isDark) }]}>LEAGUE</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('IdeaDeck')} style={[styles.loopBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <Text style={[styles.loopBtnText, { color: textColor(isDark) }]}>IDEAS</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.repLine, { color: textColor(isDark, 'muted') }]}>
          REP {Number(profile?.reputationScore || 0)} · decays if you go quiet · ship 3 days to verify
        </Text>

        {/* One sponsored card at a time; hidden for PLUS members. */}
        <SponsoredSlot placement="play" viewerUid={user?.uid} enabled={!hasLinkupPro(profile)} />

        <Text style={[styles.sectionLabel, { color: textColor(isDark) }]}>GAMES</Text>

        <View style={styles.gamesGrid}>
          {GAMES.map((game) => (
            <TouchableOpacity
              key={game.key}
              style={[styles.gameCard, { backgroundColor: game.bgColor }]}
              onPress={() => openGame(game)}
              activeOpacity={0.85}
            >
              <View style={styles.gameCardTop}>
                <Text style={styles.gameEmoji}>{game.emoji}</Text>
                <TouchableOpacity onPress={() => setChallengeGame(game)} style={styles.gameChallengeTag}>
                  <Swords size={10} color="#000" />
                  <Text style={styles.gameChallengeTagText}>Challenge</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.gameTitle}>{game.title}</Text>
              <Text style={styles.gameSubtitle}>{game.subtitle}</Text>
              <View style={styles.gamePlayRow}>
                <Swords size={12} color="rgba(255,255,255,0.7)" />
                <Text style={styles.gamePlayText}>Play</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {challenges.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: textColor(isDark) }]}>CHALLENGES</Text>
            {challenges.map((c) => (
              <View key={c.id} style={[styles.challengeCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                <View style={styles.challengeTop}>
                  <View style={styles.challengeInfo}>
                    <Text style={[styles.challengeTitle, { color: textColor(isDark) }]}>
                      {c.senderName}
                    </Text>
                    <Text style={[styles.challengeBody, { color: textColor(isDark, 'secondary') }]}>
                      challenged you to {gameLabel(c.gameType)}
                    </Text>
                  </View>
                </View>
                <View style={styles.challengeActions}>
                  <TouchableOpacity
                    style={[styles.challengeBtn, styles.challengeAccept]}
                    onPress={() => handleChallengeResponse(c.id, 'accepted', c.gameType)}
                  >
                    <Text style={styles.challengeAcceptText}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.challengeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }]}
                    onPress={() => handleChallengeResponse(c.id, 'declined')}
                  >
                    <Text style={[styles.challengeDeclineText, { color: textColor(isDark, 'muted') }]}>Pass</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        )}

        {unlockedAchievements.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: textColor(isDark) }]}>UNLOCKED</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgeRow}>
              {unlockedAchievements.map((a) => (
                <View key={a.id} style={[styles.badgeCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                  <Text style={styles.badgeIcon}>{a.icon}</Text>
                  <Text style={[styles.badgeLabel, { color: textColor(isDark) }]}>{a.label}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: textColor(isDark) }]}>MISSIONS</Text>
          <View style={[styles.card, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }]}>
            {missions.map((mission) => {
              const pct = Math.min(1, mission.progress / mission.target);
              return (
                <View key={mission.id} style={[styles.missionRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]}>
                  <View style={[styles.missionIcon, { backgroundColor: mission.completed ? 'rgba(40,231,168,0.15)' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                    {mission.completed ? <CheckCircle2 size={16} color={COLORS.success} /> : <Target size={14} color={textColor(isDark, 'muted')} />}
                  </View>
                  <View style={styles.missionContent}>
                    <Text style={[styles.missionLabel, { color: textColor(isDark), textDecorationLine: mission.completed ? 'line-through' : 'none' }]}>{mission.label}</Text>
                    <View style={[styles.missionBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
                      <View style={[styles.missionBarFill, { width: `${pct * 100}%`, backgroundColor: mission.completed ? COLORS.success : COLORS.primary }]} />
                    </View>
                  </View>
                  <View style={[styles.missionPts, { backgroundColor: mission.completed ? 'rgba(40,231,168,0.12)' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                    <Zap size={9} color={mission.completed ? COLORS.success : textColor(isDark, 'muted')} />
                    <Text style={[styles.missionPtsText, { color: mission.completed ? COLORS.success : textColor(isDark, 'muted') }]}>+{mission.points}</Text>
                  </View>
                </View>
              );
            })}
            {missions.length === 0 && (
              <Text style={[styles.emptyText, { color: textColor(isDark, 'muted') }]}>Come back tomorrow for new missions</Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: textColor(isDark) }]}>ACHIEVEMENTS</Text>
          <View style={[styles.card, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }]}>
            {lockedAchievements.slice(0, 5).map((a) => {
              const pct = Math.min(1, (a.progress ?? 0) / a.target);
              return (
                <View key={a.id} style={[styles.achieveRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]}>
                  <Text style={styles.achieveIcon}>{a.icon}</Text>
                  <View style={styles.achieveContent}>
                    <Text style={[styles.achieveLabel, { color: textColor(isDark) }]}>{a.label}</Text>
                    <View style={[styles.achieveBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
                      <View style={[styles.achieveBarFill, { width: `${pct * 100}%`, backgroundColor: pct >= 1 ? COLORS.success : COLORS.primary }]} />
                    </View>
                    <Text style={[styles.achieveProgress, { color: textColor(isDark, 'muted') }]}>
                      {Math.min(a.progress ?? 0, a.target)}/{a.target}
                    </Text>
                  </View>
                  {pct >= 1 ? <CheckCircle2 size={18} color={COLORS.success} /> : <Lock size={14} color={textColor(isDark, 'muted')} />}
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: textColor(isDark) }]}>WEEKLY</Text>
          <View style={[styles.card, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }]}>
            <View style={styles.weeklyRow}>
              <TrendingUp size={14} color={COLORS.primaryStrong} />
              <Text style={[styles.weeklyLabel, { color: textColor(isDark) }]}>Activity</Text>
            </View>
            <View style={styles.weeklyGrid}>
              <View style={styles.weeklyStat}>
                <Text style={[styles.weeklyNum, { color: textColor(isDark) }]}>{weeklyStats.swipes}</Text>
                <Text style={[styles.weeklyStatLabel, { color: textColor(isDark, 'muted') }]}>Swipes</Text>
              </View>
              <View style={styles.weeklyStat}>
                <Text style={[styles.weeklyNum, { color: textColor(isDark) }]}>{weeklyStats.likes}</Text>
                <Text style={[styles.weeklyStatLabel, { color: textColor(isDark, 'muted') }]}>Likes</Text>
              </View>
              <View style={styles.weeklyStat}>
                <Text style={[styles.weeklyNum, { color: textColor(isDark) }]}>{weeklyStats.connections}</Text>
                <Text style={[styles.weeklyStatLabel, { color: textColor(isDark, 'muted') }]}>Connects</Text>
              </View>
              <View style={styles.weeklyStat}>
                <Text style={[styles.weeklyNum, { color: textColor(isDark) }]}>{weeklyStats.messages}</Text>
                <Text style={[styles.weeklyStatLabel, { color: textColor(isDark, 'muted') }]}>Messages</Text>
              </View>
            </View>
            <View style={[styles.weeklyBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
              <View style={[styles.weeklyBarFill, { width: `${Math.min(weekProgress, 100)}%`, backgroundColor: COLORS.primary }]} />
            </View>
            <Text style={[styles.weeklyPct, { color: textColor(isDark, 'muted') }]}>{Math.round(weekProgress)}% of weekly goal</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {challengeGame && (
        <GameChallengeModal
          visible={!!challengeGame}
          gameType={challengeGame.key === 'flip' ? 'founderflip' : challengeGame.key === 'pitch' ? 'pitchperfect' : 'networkquiz'}
          gameLabel={challengeGame.title}
          onClose={() => setChallengeGame(null)}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontSize: 30, fontWeight: '900', letterSpacing: -1 },
  subtitle: { fontSize: 11, fontWeight: '700', marginTop: 2, letterSpacing: 0.3 },
  sparkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  sparkCount: { fontSize: 13, fontWeight: '900', color: '#000' },
  streakStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 24,
  },
  streakText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  loopRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  loopBtn: { flex: 1, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  loopBtnText: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: '#000' },
  repLine: { fontSize: 11, fontWeight: '700', marginBottom: 18 },
  sectionLabel: { fontSize: 11, fontWeight: '900', letterSpacing: -0.2, marginBottom: 12 },
  gamesGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  gameCard: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    gap: 6,
    minHeight: 140,
  },
  gameCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  gameEmoji: { fontSize: 24 },
  gameChallengeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
  },
  gameChallengeTagText: { fontSize: 9, fontWeight: '900', color: '#000' },
  gameTitle: { fontSize: 13, fontWeight: '900', color: '#FFF', letterSpacing: -0.3 },
  gameSubtitle: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.7)', lineHeight: 12 },
  gamePlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 'auto',
  },
  gamePlayText: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.7)', letterSpacing: 0.5 },
  challengeCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    gap: 12,
  },
  challengeTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  challengeInfo: { flex: 1 },
  challengeTitle: { fontSize: 15, fontWeight: '900' },
  challengeBody: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  challengeActions: { flexDirection: 'row', gap: 8 },
  challengeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  challengeAccept: { backgroundColor: COLORS.primary },
  challengeAcceptText: { fontSize: 12, fontWeight: '900', color: '#000' },
  challengeDeclineText: { fontSize: 12, fontWeight: '800' },
  section: { marginBottom: 20 },
  badgeRow: { gap: 10, paddingRight: 20 },
  badgeCard: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: 'center',
    gap: 4,
  },
  badgeIcon: { fontSize: 24 },
  badgeLabel: { fontSize: 10, fontWeight: '800' },
  card: { borderRadius: 16, overflow: 'hidden' },
  missionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
    borderBottomWidth: 1,
  },
  missionIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missionContent: { flex: 1, gap: 3 },
  missionLabel: { fontSize: 12, fontWeight: '700' },
  missionBar: { height: 3, borderRadius: 2, overflow: 'hidden' },
  missionBarFill: { height: '100%', borderRadius: 2 },
  missionPts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 8,
  },
  missionPtsText: { fontSize: 9, fontWeight: '900' },
  emptyText: { fontSize: 12, fontWeight: '600', padding: 16, textAlign: 'center' },
  achieveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
    borderBottomWidth: 1,
  },
  achieveIcon: { fontSize: 24, width: 32, textAlign: 'center' },
  achieveContent: { flex: 1, gap: 2 },
  achieveLabel: { fontSize: 12, fontWeight: '800' },
  achieveBar: { height: 3, borderRadius: 2, overflow: 'hidden' },
  achieveBarFill: { height: '100%', borderRadius: 2 },
  achieveProgress: { fontSize: 9, fontWeight: '600' },
  weeklyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 14, paddingBottom: 0 },
  weeklyLabel: { fontSize: 14, fontWeight: '800' },
  weeklyGrid: { flexDirection: 'row', justifyContent: 'space-around', padding: 14, paddingBottom: 0 },
  weeklyStat: { alignItems: 'center', gap: 2 },
  weeklyNum: { fontSize: 20, fontWeight: '900' },
  weeklyStatLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  weeklyBar: { height: 5, borderRadius: 3, marginHorizontal: 14, marginTop: 10, overflow: 'hidden' },
  weeklyBarFill: { height: '100%', borderRadius: 3 },
  weeklyPct: { fontSize: 10, fontWeight: '600', textAlign: 'center', padding: 10, paddingBottom: 14 },
});

export default GamificationHubScreen;