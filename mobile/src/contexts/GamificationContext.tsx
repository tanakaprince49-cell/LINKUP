import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Achievement, DailyMission, GamificationState, MissionType, WeeklyStats } from '../types';
import {
  generateWeeklyReport,
  loadGamificationState,
  processLoginStreak,
  saveGamificationState,
  trackAction as trackActionInState,
} from '../lib/gamification';

interface GamificationContextType {
  state: GamificationState;
  sparkPoints: number;
  streakCount: number;
  longestStreak: number;
  missions: DailyMission[];
  achievements: Achievement[];
  weeklyStats: WeeklyStats;
  weeklyReport: string | null;
  trackAction: (action: MissionType) => void;
  dismissWeeklyReport: () => void;
  loading: boolean;
}

const GamificationContext = createContext<GamificationContextType | undefined>(undefined);

export const GamificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<GamificationState | null>(null);
  const [weeklyReport, setWeeklyReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const stateRef = useRef(state);
  stateRef.current = state;

  const persist = useCallback(async (newState: GamificationState) => {
    setState(newState);
    await saveGamificationState(newState);
  }, []);

  useEffect(() => {
    (async () => {
      const loaded = await loadGamificationState();
      const afterStreak = processLoginStreak(loaded);
      await persist(afterStreak);
      const report = generateWeeklyReport(afterStreak);
      if (report) setWeeklyReport(report);
      setLoading(false);
    })();
  }, [persist]);

  useEffect(() => {
    const handleAppState = async (nextState: AppStateStatus) => {
      if (nextState === 'active' && stateRef.current) {
        const afterStreak = processLoginStreak(stateRef.current);
        await persist(afterStreak);
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [persist]);

  const trackAction = useCallback(async (action: MissionType) => {
    if (!stateRef.current) return;
    const newState = trackActionInState(stateRef.current, action);
    await persist(newState);
  }, [persist]);

  const dismissWeeklyReport = useCallback(() => {
    setWeeklyReport(null);
  }, []);

  if (!state) {
    return <>{children}</>;
  }

  return (
    <GamificationContext.Provider
      value={{
        state,
        sparkPoints: state.sparkPoints,
        streakCount: state.streakCount,
        longestStreak: state.longestStreak,
        missions: state.missions,
        achievements: state.achievements,
        weeklyStats: state.weeklyStats,
        weeklyReport,
        trackAction,
        dismissWeeklyReport,
        loading,
      }}
    >
      {children}
    </GamificationContext.Provider>
  );
};

export const useGamification = () => {
  const context = useContext(GamificationContext);
  if (!context) throw new Error('useGamification must be used within GamificationProvider');
  return context;
};