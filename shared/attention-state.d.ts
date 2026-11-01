export interface IconVariantMeta {
  readonly id: string;
  readonly label: string;
  readonly occasion: string;
  readonly triggerRule: string;
  readonly subtitle: string;
  readonly category: 'normal' | 'urgent' | 'inactive' | 'celebration' | 'occasion';
  readonly androidAlias: string;
  readonly iosIconName: string | null;
  readonly assetFile: string;
  readonly webIconFile: string;
  readonly themeColor: string;
  readonly tabPrefix: string;
}

export interface AttentionFactsInput {
  mode?: string;
  isAuthenticated?: boolean;
  isForeground?: boolean;
  userActedRecently?: boolean;
  unreadAcknowledged?: boolean;
  unreadMessages?: number;
  unreadNotifications?: number;
  daysSinceActive?: number;
  streakCount?: number;
  todayRecorded?: boolean;
  protectedRestToday?: boolean;
  isLeagueChampion?: boolean;
  localHour?: number;
  nowMs?: number;
}

export interface ResolvedAttentionAppearance {
  state: 'normal' | 'urgent' | 'inactive' | 'celebration' | 'pinned';
  variant: string;
  meta: IconVariantMeta;
  badgeCount: number;
  backgroundTitle: string | null;
  reason: string;
}

export const MILESTONE_STREAK_DAYS: readonly number[];
export const ICON_VARIANTS: readonly IconVariantMeta[];
export const ICON_VARIANT_MAP: Readonly<Record<string, IconVariantMeta>>;
export const ICON_VARIANT_IDS: readonly string[];

export function isValidIconMode(mode: unknown): boolean;
export function getIconVariant(variantId: string): IconVariantMeta;
export function isNewYearCelebration(nowMs?: number): boolean;
export function resolveAttentionAppearance(input?: AttentionFactsInput): ResolvedAttentionAppearance;
