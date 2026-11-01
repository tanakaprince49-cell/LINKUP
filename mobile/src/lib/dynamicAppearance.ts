import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ICON_VARIANTS,
  ICON_VARIANT_MAP,
  isValidIconMode,
  resolveAttentionAppearance,
  type AttentionFactsInput,
  type IconVariantMeta,
  type ResolvedAttentionAppearance,
} from '../../../shared/attention-state';
import { applyWebDynamicTabAppearance } from './webMetadata';

export { ICON_VARIANTS, ICON_VARIANT_MAP, isValidIconMode, resolveAttentionAppearance };
export type { AttentionFactsInput, IconVariantMeta, ResolvedAttentionAppearance };

export const ICON_MODE_STORAGE_KEY = '@linkup/iconAppearanceMode';
export const LAST_ACTION_STORAGE_KEY = '@linkup/lastUserActionAt';

export const ICON_VARIANT_IMAGES: Record<string, any> = {
  default: require('../../assets/icon-padded.png'),
  streak_fire: require('../../assets/icon-streak-fire.png'),
  unread_urgent: require('../../assets/icon-unread-urgent.png'),
  sad_inactive: require('../../assets/icon-sad-inactive.png'),
  ghost_abandoned: require('../../assets/icon-ghost-abandoned.png'),
  champion_crown: require('../../assets/icon-champion-crown.png'),
  on_fire_shipped: require('../../assets/icon-shipped.png'),
  milestone_party: require('../../assets/icon-milestone-party.png'),
  night_owl: require('../../assets/icon-night-owl.png'),
  weekend_chill: require('../../assets/icon-weekend-chill.png'),
};

type Listener = () => void;
const listeners = new Set<Listener>();

let cachedMode = 'auto';
let modeHydrated = false;
let lastUserActionAt = Date.now();
let unreadAckCount = -1;
let latestResolved: ResolvedAttentionAppearance = resolveAttentionAppearance();
let lastAppliedNativeVariant = '';
let lastAppliedBadgeCount = -1;

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

export function subscribeDynamicAppearance(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getLatestResolvedAppearance(): ResolvedAttentionAppearance {
  return latestResolved;
}

export function getCurrentIconModeSync(): string {
  return cachedMode;
}

export async function loadSavedIconMode(): Promise<string> {
  if (modeHydrated) return cachedMode;
  try {
    const raw = await AsyncStorage.getItem(ICON_MODE_STORAGE_KEY);
    if (raw && isValidIconMode(raw)) {
      cachedMode = raw;
    }
  } catch {}
  modeHydrated = true;
  return cachedMode;
}

export async function setSavedIconMode(nextMode: string): Promise<string> {
  const safe = isValidIconMode(nextMode) ? nextMode : 'auto';
  cachedMode = safe;
  modeHydrated = true;
  try {
    await AsyncStorage.setItem(ICON_MODE_STORAGE_KEY, safe);
  } catch {}
  emit();
  return safe;
}

export function syncIconModeFromServerPrefs(serverMode?: unknown) {
  if (typeof serverMode === 'string' && isValidIconMode(serverMode) && serverMode !== cachedMode) {
    cachedMode = serverMode;
    modeHydrated = true;
    AsyncStorage.setItem(ICON_MODE_STORAGE_KEY, serverMode).catch(() => {});
    emit();
  }
}

export function recordUserActionForAppearance(
  kind: 'focus' | 'interact' | 'read_alerts' | 'read_messages' | 'shipped' | 'route' = 'interact',
  currentTotalUnread = 0,
) {
  lastUserActionAt = Date.now();
  if (kind === 'read_alerts' || kind === 'read_messages') {
    unreadAckCount = Math.max(0, currentTotalUnread);
  }
  AsyncStorage.setItem(LAST_ACTION_STORAGE_KEY, String(lastUserActionAt)).catch(() => {});
  emit();
}

export function getActionSnapshot(currentTotalUnread: number, nowMs = Date.now()) {
  if (currentTotalUnread > unreadAckCount && unreadAckCount >= 0) {
    // A brand-new unread message/notification arrived since the user last acknowledged
    unreadAckCount = -1;
  }
  if (currentTotalUnread === 0) {
    unreadAckCount = -1;
  }
  const userActedRecently = nowMs - lastUserActionAt < 8_000;
  const unreadAcknowledged = unreadAckCount >= 0 && currentTotalUnread <= unreadAckCount;
  return { userActedRecently, unreadAcknowledged, lastUserActionAt };
}

async function applyNativeMobileAppearance(resolved: ResolvedAttentionAppearance) {
  if (Platform.OS === 'web') return;

  // 1. Switch Android activity-alias / iOS alternate icon via native module when available
  if (resolved.variant !== lastAppliedNativeVariant) {
    lastAppliedNativeVariant = resolved.variant;
    try {
      const mod = (NativeModules as Record<string, any>)?.LinkupDynamicIcon;
      if (mod && typeof mod.setAlternateIcon === 'function') {
        const arg = Platform.OS === 'ios' ? resolved.meta.iosIconName : resolved.variant;
        await mod.setAlternateIcon(arg ?? 'default');
      }
    } catch {}
  }

  // 2. Sync OS launcher badge count (reverts immediately to 0 when normal / read)
  if (resolved.badgeCount !== lastAppliedBadgeCount) {
    lastAppliedBadgeCount = resolved.badgeCount;
    try {
      const Notifications = await import('expo-notifications');
      if (typeof Notifications.setBadgeCountAsync === 'function') {
        await Notifications.setBadgeCountAsync(resolved.badgeCount);
      }
    } catch {}
  }
}

export function applyResolvedAppearance(resolved: ResolvedAttentionAppearance) {
  latestResolved = resolved;
  if (Platform.OS === 'web') {
    applyWebDynamicTabAppearance({
      variant: resolved.variant,
      webIconFile: resolved.meta.webIconFile,
      themeColor: resolved.meta.themeColor,
      badgeCount: resolved.badgeCount,
      backgroundTitle: resolved.backgroundTitle,
    });
  } else {
    void applyNativeMobileAppearance(resolved);
  }
}
