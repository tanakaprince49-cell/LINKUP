import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGamification } from '../contexts/GamificationContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { Flame, Zap, Trophy, Target, Calendar, TrendingUp, CheckCircle2, Lock, ChevronRight, Sparkles } from 'lucide-react-native';
import { Achievement, DailyMission } from '../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 12;
const SIDE_PAD = 16;

const GamificationHubScreen: React.FC = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { sparkPoints, streakCount, longestStreak, missions, achievements, weeklyStats, trackAction } = useGamification();

  const weekProgress = Math.min(
    100,
    ((weeklyStats.swipes + weeklyStats.likes * 2 + weeklyStats.connections * 5 + weeklyStats.messages * 2) / 50) * 100
  );

  const unlockedAchievements = achievements.filter((a) => (a.progress ?? 0) >= a.target);
  const lockedAchievements = achievements.filter((a) => (a.progress ?? 0) < a.target);

  return (
    <SafeAreaView style={[styles.root, appBackground(isDark)]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: textColor(isDark) }]}>Hub</Text>
          <TouchableOpacity style={[styles.sparkPill, { backgroundColor: COLORS.primary }]}>
            <Zap size={14} color="#000" fill="#000" />
            <Text style={styles.sparkCount}>{sparkPoints}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.streakBanner, liquidGlass(isDark, false)]}>
          <View style={[styles.streakIconWrap, { backgroundColor: streakCount > 0 ? 'rgba(251,230,24,0.15)' : 'rgba(255,255,255,0.05)' }]}>
            <Flame size={32} color={streakCount > 0 ? COLORS.primary : textColor(isDark, 'muted')} />
          </View>
          <View style={styles.streakInfo}>
            <Text style={[styles.streakCountText, { color: streakCount > 0 ? COLORS.primary : textColor(isDark, 'muted') }]}>
              {streakCount > 0 ? `Day ${streakCount}` : 'Start your streak!'}
            </Text>
            <Text style={[styles.streakSubtext, { color: textColor(isDark, 'secondary') }]}>
              {streakCount > 0 ? `${streakCount}-day streak · Best: ${longestStreak}` : 'Open the app daily to build your streak'}
            </Text>
          </View>
          {streakCount > 0 && (
            <View style={styles.streakBadge}>
              <Text style={styles.streakBadgeText}>🔥</Text>
            </View>
          )}
        </View>

        {unlockedAchievements.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>ACHIEVEMENTS UNLOCKED</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgeRow}>
              {unlockedAchievements.map((a) => (
                <View key={a.id} style={[styles.badgeCard, { borderColor: COLORS.primary }]}>
                  <Text style={styles.badgeIcon}>{a.icon}</Text>
                  <Text style={styles.badgeLabel}>{a.label}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>DAILY MISSIONS</Text>
          <View style={[styles.missionsCard, liquidGlass(isDark, false)]}>
            {missions.map((mission) => (
              <MissionRow key={mission.id} mission={mission} isDark={isDark} />
            ))}
            {missions.length === 0 && (
              <Text style={[styles.emptyText, { color: textColor(isDark, 'muted') }]}>Come back tomorrow for new missions</Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>ACHIEVEMENTS</Text>
          <View style={[styles.achievementsCard, liquidGlass(isDark, false)]}>
            {lockedAchievements.map((a) => (
              <AchievementRow key={a.id} achievement={a} isDark={isDark} />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>THIS WEEK</Text>
          <View style={[styles.weeklyCard, liquidGlass(isDark, false)]}>
            <View style={styles.weeklyHeader}>
              <TrendingUp size={16} color={COLORS.primary} />
              <Text style={[styles.weeklyTitle, { color: textColor(isDark) }]}>Weekly Activity</Text>
            </View>
            <View style={styles.weeklyGrid}>
              <WeeklyStat label="Swipes" value={weeklyStats.swipes} isDark={isDark} />
              <WeeklyStat label="Likes" value={weeklyStats.likes} isDark={isDark} />
              <WeeklyStat label="Connections" value={weeklyStats.connections} isDark={isDark} />
              <WeeklyStat label="Messages" value={weeklyStats.messages} isDark={isDark} />
            </View>
            <View style={[styles.weeklyBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
              <View style={[styles.weeklyBarFill, { width: `${Math.min(weekProgress, 100)}%`, backgroundColor: COLORS.primary }]} />
            </View>
            <Text style={[styles.weeklyFooter, { color: textColor(isDark, 'secondary') }]}>
              {Math.round(weekProgress)}% of weekly goal
            </Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const MissionRow: React.FC<{ mission: DailyMission; isDark: boolean }> = ({ mission, isDark }) => {
  const pct = Math.min(1, mission.progress / mission.target);
  return (
    <View style={[styles.missionRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]}>
      <View style={[styles.missionIconWrap, { backgroundColor: mission.completed ? 'rgba(40,231,168,0.15)' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
        {mission.completed ? (
          <CheckCircle2 size={18} color={COLORS.success} />
        ) : (
          <Target size={16} color={textColor(isDark, 'secondary')} />
        )}
      </View>
      <View style={styles.missionContent}>
        <Text style={[styles.missionLabel, { color: textColor(isDark), textDecorationLine: mission.completed ? 'line-through' : 'none' }]}>
          {mission.label}
        </Text>
        <View style={[styles.missionBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
          <View style={[styles.missionBarFill, { width: `${pct * 100}%`, backgroundColor: mission.completed ? COLORS.success : COLORS.primary }]} />
        </View>
        <Text style={[styles.missionProgress, { color: textColor(isDark, 'muted') }]}>
          {mission.progress}/{mission.target}
        </Text>
      </View>
      <View style={[styles.missionPoints, { backgroundColor: mission.completed ? 'rgba(40,231,168,0.12)' : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
        <Zap size={10} color={mission.completed ? COLORS.success : textColor(isDark, 'muted')} />
        <Text style={[styles.missionPointsText, { color: mission.completed ? COLORS.success : textColor(isDark, 'muted') }]}>
          +{mission.points}
        </Text>
      </View>
    </View>
  );
};

const AchievementRow: React.FC<{ achievement: Achievement; isDark: boolean }> = ({ achievement, isDark }) => {
  const pct = Math.min(1, (achievement.progress ?? 0) / achievement.target);
  return (
    <View style={[styles.achievementRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]}>
      <Text style={styles.achievementIcon}>{achievement.icon}</Text>
      <View style={styles.achievementContent}>
        <Text style={[styles.achievementLabel, { color: textColor(isDark) }]}>{achievement.label}</Text>
        <Text style={[styles.achievementDesc, { color: textColor(isDark, 'secondary') }]}>{achievement.description}</Text>
        <View style={[styles.achievementBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
          <View style={[styles.achievementBarFill, { width: `${pct * 100}%`, backgroundColor: pct >= 1 ? COLORS.success : COLORS.primary }]} />
        </View>
        <Text style={[styles.achievementProgress, { color: textColor(isDark, 'muted') }]}>
          {Math.min(achievement.progress ?? 0, achievement.target)}/{achievement.target}
        </Text>
      </View>
      {pct >= 1 ? (
        <CheckCircle2 size={20} color={COLORS.success} />
      ) : (
        <Lock size={16} color={textColor(isDark, 'muted')} />
      )}
    </View>
  );
};

const WeeklyStat: React.FC<{ label: string; value: number; isDark: boolean }> = ({ label, value, isDark }) => (
  <View style={styles.weeklyStat}>
    <Text style={[styles.weeklyStatValue, { color: textColor(isDark) }]}>{value}</Text>
    <Text style={[styles.weeklyStatLabel, { color: textColor(isDark, 'muted') }]}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: SIDE_PAD, paddingTop: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: { fontSize: 28, fontWeight: '900', fontStyle: 'italic', letterSpacing: -0.5 },
  sparkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  sparkCount: { fontSize: 14, fontWeight: '900', color: '#000' },
  streakBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    gap: 14,
    marginBottom: 20,
  },
  streakIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakInfo: { flex: 1 },
  streakCountText: { fontSize: 20, fontWeight: '900', fontStyle: 'italic' },
  streakSubtext: { fontSize: 12, marginTop: 2, fontWeight: '600' },
  streakBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(251,230,24,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakBadgeText: { fontSize: 18 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 2, marginBottom: 10 },
  badgeRow: { gap: 10, paddingRight: 20 },
  badgeCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(251,230,24,0.06)',
  },
  badgeIcon: { fontSize: 28 },
  badgeLabel: { fontSize: 11, fontWeight: '800', color: '#FFF' },
  missionsCard: { borderRadius: 20, overflow: 'hidden' },
  missionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
    borderBottomWidth: 1,
  },
  missionIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missionContent: { flex: 1, gap: 4 },
  missionLabel: { fontSize: 13, fontWeight: '700' },
  missionBar: { height: 4, borderRadius: 2, overflow: 'hidden' },
  missionBarFill: { height: '100%', borderRadius: 2 },
  missionProgress: { fontSize: 10, fontWeight: '600' },
  missionPoints: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
  },
  missionPointsText: { fontSize: 10, fontWeight: '900' },
  achievementsCard: { borderRadius: 20, overflow: 'hidden' },
  achievementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
    borderBottomWidth: 1,
  },
  achievementIcon: { fontSize: 28, width: 36, textAlign: 'center' },
  achievementContent: { flex: 1, gap: 3 },
  achievementLabel: { fontSize: 13, fontWeight: '800' },
  achievementDesc: { fontSize: 11, fontWeight: '600' },
  achievementBar: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  achievementBarFill: { height: '100%', borderRadius: 2 },
  achievementProgress: { fontSize: 10, fontWeight: '600', marginTop: 1 },
  weeklyCard: { borderRadius: 20, padding: 16, gap: 14 },
  weeklyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weeklyTitle: { fontSize: 15, fontWeight: '800' },
  weeklyGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  weeklyStat: { alignItems: 'center', gap: 2 },
  weeklyStatValue: { fontSize: 22, fontWeight: '900' },
  weeklyStatLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  weeklyBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  weeklyBarFill: { height: '100%', borderRadius: 3 },
  weeklyFooter: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  emptyText: { fontSize: 13, fontWeight: '600', padding: 20, textAlign: 'center' },
});

export default GamificationHubScreen;