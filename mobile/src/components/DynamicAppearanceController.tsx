import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../contexts/GamificationContext';
import { subscribeToUnreadNotificationsCount } from '../lib/notifications';
import { subscribeToUnreadMessagesCount } from '../lib/chat';
import { hasLinkupPro } from '../lib/paywall';
import {
  applyResolvedAppearance,
  getActionSnapshot,
  getCurrentIconModeSync,
  loadPersistedLastOpenedAt,
  loadSavedIconMode,
  recordUserActionForAppearance,
  resolveAttentionAppearance,
  savePersistedLastOpenedAt,
  subscribeDynamicAppearance,
} from '../lib/dynamicAppearance';

const DAY_MS = 86_400_000;

function todayUtcIso(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export default function DynamicAppearanceController({ currentRoute }: { currentRoute?: string }) {
  const { user, profile } = useAuth();
  const { streakCount } = useGamification();

  const [iconMode, setIconMode] = useState<string>(() => getCurrentIconModeSync());
  const [isForeground, setIsForeground] = useState<boolean>(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      return document.visibilityState !== 'hidden';
    }
    return AppState.currentState === 'active';
  });
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [contribDays, setContribDays] = useState<string[]>([]);
  const [restDay, setRestDay] = useState<string>('');
  const [tick, setTick] = useState(0);
  const lastForegroundAtRef = useRef<number>(Date.now());

  // Hydrate persisted icon mode + persisted lastOpenedAt (for session-restored background tabs!)
  useEffect(() => {
    let alive = true;
    loadSavedIconMode().then((saved) => {
      if (alive) setIconMode(saved);
    });
    loadPersistedLastOpenedAt().then((ts) => {
      if (!alive) return;
      const visibleNow = Platform.OS === 'web' && typeof document !== 'undefined'
        ? document.visibilityState !== 'hidden'
        : AppState.currentState === 'active';
      if (visibleNow) {
        lastForegroundAtRef.current = Date.now();
        savePersistedLastOpenedAt(lastForegroundAtRef.current);
      } else {
        lastForegroundAtRef.current = ts;
        setTick((t) => t + 1);
      }
    });
    const unsub = subscribeDynamicAppearance(() => {
      setIconMode(getCurrentIconModeSync());
      setTick((t) => t + 1);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  // Track foreground / background transitions + immediate user-action revert on focus/click/key
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined' && typeof window !== 'undefined') {
      let lastInputNote = 0;
      const onVisible = () => {
        const visible = document.visibilityState !== 'hidden';
        setIsForeground(visible);
        if (visible) {
          lastForegroundAtRef.current = Date.now();
          recordUserActionForAppearance('focus');
        }
      };
      const onFocus = () => {
        setIsForeground(true);
        lastForegroundAtRef.current = Date.now();
        recordUserActionForAppearance('focus');
      };
      const onBlur = () => {
        setIsForeground(false);
        setTick((t) => t + 1);
      };
      const onUserInteract = () => {
        const now = Date.now();
        lastForegroundAtRef.current = now;
        setIsForeground(true);
        if (now - lastInputNote > 4_000) {
          lastInputNote = now;
          recordUserActionForAppearance('interact');
        }
      };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      window.addEventListener('pointerdown', onUserInteract, { passive: true });
      window.addEventListener('keydown', onUserInteract, { passive: true });
      const timer = setInterval(() => setTick((t) => t + 1), 60_000);
      return () => {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('pointerdown', onUserInteract);
        window.removeEventListener('keydown', onUserInteract);
        clearInterval(timer);
      };
    }

    const sub = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      setIsForeground(active);
      if (active) {
        lastForegroundAtRef.current = Date.now();
        recordUserActionForAppearance('focus');
      } else {
        setTick((t) => t + 1);
      }
    });
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  // Immediate revert when user opens Alerts, Inbox, Messages, Chat, or ShipLog
  useEffect(() => {
    if (!currentRoute) return;
    const totalUnread = unreadMessages + unreadNotifications;
    if (currentRoute === 'Alerts') {
      recordUserActionForAppearance('read_alerts', totalUnread);
    } else if (currentRoute === 'Inbox' || currentRoute === 'Messages' || currentRoute === 'Chat') {
      recordUserActionForAppearance('read_messages', totalUnread);
    } else if (currentRoute === 'ShipLog') {
      recordUserActionForAppearance('shipped', totalUnread);
    }
  }, [currentRoute, unreadMessages, unreadNotifications]);

  // Live unread counts + builder contribution days for signed-in user
  useEffect(() => {
    if (!user?.uid) {
      setUnreadNotifications(0);
      setUnreadMessages(0);
      setContribDays([]);
      setRestDay('');
      return;
    }
    let unsubNotifs: (() => void) | undefined;
    let unsubMsgs: (() => void) | undefined;
    let unsubContrib: (() => void) | undefined;
    let cancelled = false;

    const timer = setTimeout(() => {
      if (cancelled) return;
      unsubNotifs = subscribeToUnreadNotificationsCount(user.uid, setUnreadNotifications);
      unsubMsgs = subscribeToUnreadMessagesCount(user.uid, setUnreadMessages);
      if (db) {
        try {
          unsubContrib = onSnapshot(
            doc(db, 'builderContributions', user.uid),
            (snap) => {
              const data = snap.exists() ? snap.data() : null;
              const days = Array.isArray(data?.days)
                ? data.days.filter((d: unknown): d is string => typeof d === 'string')
                : [];
              setContribDays(days);
              setRestDay(typeof data?.habit?.restDay === 'string' ? data.habit.restDay : '');
            },
            () => {},
          );
        } catch {}
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubNotifs?.();
      unsubMsgs?.();
      unsubContrib?.();
    };
  }, [user?.uid]);

  // Compute and apply appearance immediately on any state or action change
  useEffect(() => {
    const nowMs = Date.now();
    const totalUnread = unreadMessages + unreadNotifications;
    const { userActedRecently, unreadAcknowledged } = getActionSnapshot(totalUnread, nowMs);

    const profileLastActive = Number((profile as any)?.lastActive?.toMillis?.() || (profile as any)?.lastActiveAt || 0);
    const baselineActiveAt = Math.max(lastForegroundAtRef.current, profileLastActive);
    const daysSinceActive = isForeground
      ? 0
      : Math.max(0, Math.floor((nowMs - baselineActiveAt) / DAY_MS));

    const todayIso = todayUtcIso(nowMs);
    const todayRecorded = contribDays.includes(todayIso);
    const weekdayShort = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(nowMs);
    const protectedRestToday = Boolean(restDay && restDay === weekdayShort) || (!restDay && weekdayShort === 'Sun' && !todayRecorded && streakCount > 0);
    const isLeagueChampion = Boolean(
      hasLinkupPro(profile) || (profile as any)?.leagueWinner || (profile as any)?.campaignRewardEligible,
    );

    const resolved = resolveAttentionAppearance({
      mode: iconMode,
      isAuthenticated: Boolean(user?.uid),
      isForeground,
      userActedRecently,
      unreadAcknowledged,
      unreadMessages,
      unreadNotifications,
      daysSinceActive,
      streakCount,
      todayRecorded,
      protectedRestToday,
      isLeagueChampion,
      localHour: new Date(nowMs).getHours(),
      nowMs,
    });

    applyResolvedAppearance(resolved);
  }, [
    user?.uid,
    profile,
    iconMode,
    isForeground,
    unreadMessages,
    unreadNotifications,
    contribDays,
    restDay,
    streakCount,
    tick,
  ]);

  return null;
}
