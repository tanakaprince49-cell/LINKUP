import AsyncStorage from '@react-native-async-storage/async-storage';
import { Achievement, DailyMission, GamificationState, MissionType, WeeklyStats } from '../types';

const GAMIFICATION_KEY = 'linkup:gamification:v1';

const MISSION_POOL: { type: MissionType; label: string; target: number; points: number }[] = [
  { type: 'swipe', label: 'Swipe 10 profiles', target: 10, points: 15 },
  { type: 'like', label: 'Like 3 profiles', target: 3, points: 10 },
  { type: 'connect', label: 'Connect with 1 founder', target: 1, points: 20 },
  { type: 'view_profile', label: 'View 5 profiles', target: 5, points: 10 },
  { type: 'message', label: 'Send 3 messages', target: 3, points: 15 },
  { type: 'daily_login', label: 'Open the app', target: 1, points: 5 },
];

export const ACHIEVEMENT_DEFS = [
  { id: 'first_spark', label: 'First Spark', description: 'Earn 100 Spark Points', icon: '⚡', target: 100 },
  { id: 'social_butterfly', label: 'Social Butterfly', description: 'Make 10 connections', icon: '🦋', target: 10 },
  { id: 'explorer', label: 'Explorer', description: 'Swipe 100 profiles', icon: '🧭', target: 100 },
  { id: 'streak_7', label: 'On Fire', description: '7-day streak', icon: '🔥', target: 7 },
  { id: 'streak_30', label: 'Unstoppable', description: '30-day streak', icon: '💪', target: 30 },
  { id: 'chatterbox', label: 'Chatterbox', description: 'Send 50 messages', icon: '💬', target: 50 },
  { id: 'networker', label: 'Networker', description: 'Get 5 approved connections', icon: '🤝', target: 5 },
  { id: 'mission_crushed', label: 'Mission Crushed', description: 'Complete 30 daily missions', icon: '🎯', target: 30 },
];

const defaultWeeklyStats = (): WeeklyStats => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff)).toISOString().split('T')[0];
  return { weekStart: monday, swipes: 0, likes: 0, connections: 0, messages: 0, profileViews: 0, pointsEarned: 0 };
};

const defaultAchievements = (): Achievement[] =>
  ACHIEVEMENT_DEFS.map((a) => ({ ...a, progress: 0 }));

const defaultState = (): GamificationState => ({
  streakCount: 0,
  longestStreak: 0,
  lastActiveDate: '',
  sparkPoints: 0,
  totalEarned: 0,
  missions: [],
  missionsDate: '',
  achievements: defaultAchievements(),
  weeklyStats: defaultWeeklyStats(),
  lastWeeklyReportDate: '',
});

export const loadGamificationState = async (): Promise<GamificationState> => {
  try {
    const raw = await AsyncStorage.getItem(GAMIFICATION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GamificationState;
      if (parsed.achievements.length === 0) parsed.achievements = defaultAchievements();
      return parsed;
    }
  } catch {}
  return defaultState();
};

export const saveGamificationState = async (state: GamificationState): Promise<void> => {
  try {
    await AsyncStorage.setItem(GAMIFICATION_KEY, JSON.stringify(state));
  } catch {}
};

const pickDailyMissions = (): DailyMission[] => {
  const shuffled = [...MISSION_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3).map((m, i) => ({
    id: `mission_${i}`,
    type: m.type,
    label: m.label,
    target: m.target,
    progress: 0,
    completed: false,
    points: m.points,
  }));
};

const checkNewWeek = (state: GamificationState): GamificationState => {
  const currentWeekStart = defaultWeeklyStats().weekStart;
  if (state.weeklyStats.weekStart !== currentWeekStart) {
    return { ...state, weeklyStats: defaultWeeklyStats(), lastWeeklyReportDate: '' };
  }
  return state;
};

const checkAchievements = (state: GamificationState): Achievement[] => {
  return state.achievements.map((a) => {
    let progress = a.progress;
    if (a.id === 'first_spark') progress = Math.min(state.totalEarned, a.target);
    else if (a.id === 'social_butterfly') {
      const sbProgress = state.achievements.find(x => x.id === 'social_butterfly')?.progress ?? 0;
      progress = Math.min(state.weeklyStats.connections + sbProgress, a.target);
    }
    else if (a.id === 'explorer') progress = Math.min(state.weeklyStats.swipes, a.target);
    else if (a.id === 'streak_7' || a.id === 'streak_30') progress = Math.min(state.longestStreak, a.target);
    else if (a.id === 'chatterbox') progress = Math.min(state.weeklyStats.messages, a.target);
    else if (a.id === 'networker') progress = Math.min(state.weeklyStats.connections, a.target);
    else if (a.id === 'mission_crushed') {
      const mcProgress = state.achievements.find(x => x.id === 'mission_crushed')?.progress ?? 0;
      progress = Math.min(mcProgress, a.target);
    }
    return { ...a, progress, unlockedAt: a.unlockedAt || (progress >= a.target ? new Date().toISOString() : undefined) };
  });
};

export const processLoginStreak = (state: GamificationState): GamificationState => {
  const today = new Date().toISOString().split('T')[0];
  if (state.lastActiveDate === today) return state;

  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const isConsecutive = state.lastActiveDate === yesterday || state.lastActiveDate === '';
  const newStreak = isConsecutive ? state.streakCount + 1 : 1;
  const longestStreak = Math.max(state.longestStreak, newStreak);
  const streakPoints = newStreak * 5;

  let newState: GamificationState = {
    ...state,
    streakCount: newStreak,
    longestStreak,
    lastActiveDate: today,
    sparkPoints: state.sparkPoints + streakPoints,
    totalEarned: state.totalEarned + streakPoints,
  };

  newState = checkNewWeek(newState);
  newState = refreshDailyMissions(newState);
  newState = trackAction(newState, 'daily_login');
  newState = { ...newState, achievements: checkAchievements(newState) };
  return newState;
};

export const refreshDailyMissions = (state: GamificationState): GamificationState => {
  const today = new Date().toISOString().split('T')[0];
  if (state.missionsDate === today) return state;
  return { ...state, missions: pickDailyMissions(), missionsDate: today };
};

export const trackAction = (state: GamificationState, action: MissionType): GamificationState => {
  let newState = { ...state };
  const now = new Date().toISOString();

  newState.missions = newState.missions.map((m) => {
    if (m.completed || m.type !== action) return m;
    const newProgress = Math.min(m.progress + 1, m.target);
    const justCompleted = newProgress >= m.target && !m.completed;
    const earned = justCompleted ? m.points : 0;
    if (justCompleted) {
      newState.sparkPoints += earned;
      newState.totalEarned += earned;
    }
    return { ...m, progress: newProgress, completed: newProgress >= m.target };
  });

  const weekly = { ...newState.weeklyStats };
  if (action === 'swipe') weekly.swipes++;
  else if (action === 'like') weekly.likes++;
  else if (action === 'connect') weekly.connections++;
  else if (action === 'message') weekly.messages++;
  else if (action === 'view_profile') weekly.profileViews++;
  if (action !== 'daily_login') weekly.pointsEarned += action === 'connect' ? 10 : action === 'like' ? 2 : action === 'swipe' ? 1 : action === 'message' ? 3 : 0;
  if (action === 'swipe') newState.sparkPoints += 1;
  else if (action === 'like') newState.sparkPoints += 2;
  else if (action === 'connect') newState.sparkPoints += 10;
  else if (action === 'message') newState.sparkPoints += 3;
  else if (action === 'view_profile') newState.sparkPoints += 1;
  if (action !== 'daily_login') {
    newState.totalEarned += newState.sparkPoints - state.sparkPoints;
  }
  newState.weeklyStats = weekly;
  newState.achievements = checkAchievements(newState);
  return newState;
};

export const generateWeeklyReport = (state: GamificationState): string | null => {
  const today = new Date().toISOString().split('T')[0];
  if (state.lastWeeklyReportDate === today) return null;
  const { weeklyStats } = state;
  return `📊 Weekly Match Report\n${weeklyStats.swipes} swipes · ${weeklyStats.likes} likes · ${weeklyStats.connections} connections · ${weeklyStats.messages} messages · ${weeklyStats.pointsEarned} Spark Points earned`;
};

export const POINTS_PER_ACTION: Record<string, number> = {
  swipe: 1,
  like: 2,
  connect: 10,
  message: 3,
  view_profile: 1,
};