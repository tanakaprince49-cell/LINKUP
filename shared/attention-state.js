// Duolingo-style dynamic visual appearance & multi-occasion icon resolver.
// Shared across Web (favicon, tab title, PWA badge) and Mobile (Android
// activity-alias launcher icons, iOS CFBundleAlternateIcons, OS app badge).

export const MILESTONE_STREAK_DAYS = Object.freeze([1, 3, 7, 14, 30, 50, 100, 365]);

export const ICON_VARIANTS = Object.freeze([
  {
    id: 'default',
    label: 'Plugged In',
    occasion: 'Default',
    subtitle: 'Classic LINKUP black cat plugging in on signature yellow.',
    category: 'normal',
    androidAlias: 'LauncherDefault',
    iosIconName: null,
    assetFile: 'icon-padded.png',
    webIconFile: 'icon-default.png',
    themeColor: '#FBE618',
    tabPrefix: '',
  },
  {
    id: 'streak_fire',
    label: 'Streak on the Line',
    occasion: 'Urgent · Evening streak risk',
    subtitle: 'Flaming ethernet plug when an active streak needs today’s build before midnight.',
    category: 'urgent',
    androidAlias: 'LauncherStreakFire',
    iosIconName: 'StreakFire',
    assetFile: 'icon-streak-fire.png',
    webIconFile: 'icon-streak-fire.png',
    themeColor: '#FF4D00',
    tabPrefix: '🔥 Streak at risk',
  },
  {
    id: 'unread_urgent',
    label: 'Incoming Signal',
    occasion: 'Urgent · Unread messages or requests',
    subtitle: 'Buzzing red alert socket when a builder message or match is waiting.',
    category: 'urgent',
    androidAlias: 'LauncherUnreadUrgent',
    iosIconName: 'UnreadUrgent',
    assetFile: 'icon-unread-urgent.png',
    webIconFile: 'icon-unread-urgent.png',
    themeColor: '#FBE618',
    tabPrefix: '⚡ New signal',
  },
  {
    id: 'sad_inactive',
    label: 'Missing You',
    occasion: 'Inactive · 3–6 days away',
    subtitle: 'Rainy unplugged Linky cat waiting to hear what you are building.',
    category: 'inactive',
    androidAlias: 'LauncherSadInactive',
    iosIconName: 'SadInactive',
    assetFile: 'icon-sad-inactive.png',
    webIconFile: 'icon-sad-inactive.png',
    themeColor: '#3B4D6B',
    tabPrefix: '😿 Linky misses you',
  },
  {
    id: 'ghost_abandoned',
    label: 'Cobweb Mode',
    occasion: 'Inactive · 7+ days away',
    subtitle: 'Dusty cobwebs over the ethernet socket when your workspace goes quiet.',
    category: 'inactive',
    androidAlias: 'LauncherGhostAbandoned',
    iosIconName: 'GhostAbandoned',
    assetFile: 'icon-ghost-abandoned.png',
    webIconFile: 'icon-ghost-abandoned.png',
    themeColor: '#1F2029',
    tabPrefix: '🕸️ Unplugged',
  },
  {
    id: 'champion_crown',
    label: 'League Champion',
    occasion: 'Occasion · Builder League winner & PLUS',
    subtitle: 'Royal gold crown Linky for Builder League podium winners and champions.',
    category: 'celebration',
    androidAlias: 'LauncherChampionCrown',
    iosIconName: 'ChampionCrown',
    assetFile: 'icon-champion-crown.png',
    webIconFile: 'icon-champion-crown.png',
    themeColor: '#FBE618',
    tabPrefix: '👑 Champion',
  },
  {
    id: 'on_fire_shipped',
    label: 'Shipped Today',
    occasion: 'Occasion · Daily build logged',
    subtitle: 'Cool sunglasses + green check once today’s build square is lit.',
    category: 'celebration',
    androidAlias: 'LauncherOnFireShipped',
    iosIconName: 'OnFireShipped',
    assetFile: 'icon-shipped.png',
    webIconFile: 'icon-shipped.png',
    themeColor: '#22C55E',
    tabPrefix: '✅ Shipped',
  },
  {
    id: 'milestone_party',
    label: 'Milestone Party',
    occasion: 'Occasion · Streak milestone & launch days',
    subtitle: 'Confetti party hat on Day 1, 3, 7, 14, 30, 50, 100, 365 & New Year.',
    category: 'celebration',
    androidAlias: 'LauncherMilestoneParty',
    iosIconName: 'MilestoneParty',
    assetFile: 'icon-milestone-party.png',
    webIconFile: 'icon-milestone-party.png',
    themeColor: '#FBE618',
    tabPrefix: '🎉 Milestone',
  },
  {
    id: 'night_owl',
    label: 'Night Owl',
    occasion: 'Occasion · Late-night builder (10 PM – 4 AM)',
    subtitle: 'Stealth obsidian dark icon with glowing neon yellow Linky under the moon.',
    category: 'occasion',
    androidAlias: 'LauncherNightOwl',
    iosIconName: 'NightOwl',
    assetFile: 'icon-night-owl.png',
    webIconFile: 'icon-night-owl.png',
    themeColor: '#0A0B0D',
    tabPrefix: '🌙 Night build',
  },
  {
    id: 'weekend_chill',
    label: 'Weekend Recharge',
    occasion: 'Occasion · Protected rest day',
    subtitle: 'Warm sunset Linky with a coffee mug for protected Sunday rest days.',
    category: 'occasion',
    androidAlias: 'LauncherWeekendChill',
    iosIconName: 'WeekendChill',
    assetFile: 'icon-weekend-chill.png',
    webIconFile: 'icon-weekend-chill.png',
    themeColor: '#FFB84D',
    tabPrefix: '☕ Recharge',
  },
]);

export const ICON_VARIANT_MAP = Object.freeze(
  Object.fromEntries(ICON_VARIANTS.map((v) => [v.id, v])),
);

export const ICON_VARIANT_IDS = Object.freeze(ICON_VARIANTS.map((v) => v.id));

export function isValidIconMode(mode) {
  return mode === 'auto' || mode === 'classic' || Boolean(ICON_VARIANT_MAP[mode]);
}

export function getIconVariant(variantId) {
  return ICON_VARIANT_MAP[variantId] || ICON_VARIANT_MAP.default;
}

export function isNewYearCelebration(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  return (m === 11 && day === 31) || (m === 0 && day <= 2);
}

/**
 * Pure deterministic resolver for LINKUP's dynamic visual appearance.
 * Guarantees immediate revert from 'urgent' / 'inactive' upon user action:
 * - Focusing/opening the app (`isForeground === true` or `userActedRecently === true`)
 *   immediately clears `inactive` states (`sad_inactive`, `ghost_abandoned`) and
 *   suppresses background tab nagging titles so SEO route titles stay clean.
 * - Reading messages/notifications (`unreadMessages + unreadNotifications === 0` or
 *   `unreadAcknowledged === true`) immediately exits `unread_urgent`.
 * - Recording today's build (`todayRecorded === true`) immediately exits `streak_fire`.
 */
export function resolveAttentionAppearance({
  mode = 'auto',
  isAuthenticated = false,
  isForeground = true,
  userActedRecently = false,
  unreadAcknowledged = false,
  unreadMessages = 0,
  unreadNotifications = 0,
  daysSinceActive = 0,
  streakCount = 0,
  todayRecorded = false,
  protectedRestToday = false,
  isLeagueChampion = false,
  localHour = 12,
  nowMs = Date.now(),
} = {}) {
  const safeMode = isValidIconMode(mode) ? mode : 'auto';
  const msgCount = Math.max(0, Math.floor(Number(unreadMessages) || 0));
  const notifCount = Math.max(0, Math.floor(Number(unreadNotifications) || 0));
  const rawUnread = isAuthenticated ? msgCount + notifCount : 0;
  const effectiveUnread = unreadAcknowledged ? 0 : rawUnread;

  if (!isAuthenticated) {
    return {
      state: 'normal',
      variant: 'default',
      meta: ICON_VARIANT_MAP.default,
      badgeCount: 0,
      backgroundTitle: null,
      reason: 'signed_out',
    };
  }

  // Classic lock: always default launcher/favicon, only standard numeric OS badge if unread.
  if (safeMode === 'classic') {
    return {
      state: 'normal',
      variant: 'default',
      meta: ICON_VARIANT_MAP.default,
      badgeCount: effectiveUnread,
      backgroundTitle: null,
      reason: 'classic_locked',
    };
  }

  // Pinned custom occasion variant selected in Workspace -> Settings.
  if (safeMode !== 'auto' && ICON_VARIANT_MAP[safeMode]) {
    const chosen = ICON_VARIANT_MAP[safeMode];
    return {
      state: 'pinned',
      variant: chosen.id,
      meta: chosen,
      badgeCount: effectiveUnread,
      backgroundTitle: !isForeground && effectiveUnread > 0
        ? `(${effectiveUnread > 99 ? '99+' : effectiveUnread}) ${msgCount > 0 ? 'Unread message on LINKUP' : 'New activity on LINKUP'}`
        : null,
      reason: 'manual_pin',
    };
  }

  const inactiveDays = (isForeground || userActedRecently)
    ? 0
    : Math.max(0, Math.floor(Number(daysSinceActive) || 0));

  // 1. INACTIVE STATES (3+ days sad cat, 7+ days cobweb cat) — reverts immediately on open/focus!
  if (inactiveDays >= 7) {
    return {
      state: 'inactive',
      variant: 'ghost_abandoned',
      meta: ICON_VARIANT_MAP.ghost_abandoned,
      badgeCount: Math.max(1, effectiveUnread),
      backgroundTitle: '🕸️ Linky dusted off your desk · LINKUP',
      reason: 'inactive_7d',
    };
  }
  if (inactiveDays >= 3) {
    return {
      state: 'inactive',
      variant: 'sad_inactive',
      meta: ICON_VARIANT_MAP.sad_inactive,
      badgeCount: Math.max(1, effectiveUnread),
      backgroundTitle: '😿 Your LinkUp seat is getting cold · LINKUP',
      reason: 'inactive_3d',
    };
  }

  // 2. URGENT STATES — reverts immediately when user reads alerts/messages, focuses/acts, or logs build!
  const streak = Math.max(0, Math.floor(Number(streakCount) || 0));
  const hour = ((Math.floor(Number(localHour) || 0) % 24) + 24) % 24;

  if (effectiveUnread > 0 && !userActedRecently) {
    const countLabel = effectiveUnread > 99 ? '99+' : String(effectiveUnread);
    return {
      state: 'urgent',
      variant: 'unread_urgent',
      meta: ICON_VARIANT_MAP.unread_urgent,
      badgeCount: effectiveUnread,
      backgroundTitle: !isForeground
        ? `(${countLabel}) ⚡ ${msgCount > 0 ? 'Unread message on LINKUP' : 'New activity on LINKUP'}`
        : null,
      reason: msgCount > 0 ? 'unread_messages' : 'unread_notifications',
    };
  }

  const streakAtRisk = streak >= 2 && !todayRecorded && !protectedRestToday && hour >= 18 && !userActedRecently;
  if (streakAtRisk) {
    return {
      state: 'urgent',
      variant: 'streak_fire',
      meta: ICON_VARIANT_MAP.streak_fire,
      badgeCount: Math.max(1, effectiveUnread),
      backgroundTitle: !isForeground
        ? `🔥 Keep your ${streak}-day build streak alive · LINKUP`
        : null,
      reason: 'streak_at_risk',
    };
  }

  // 3. CELEBRATION & OCCASION VARIANTS (when healthy & caught up!)
  const milestoneToday = todayRecorded && MILESTONE_STREAK_DAYS.includes(streak);
  if (milestoneToday || isNewYearCelebration(nowMs)) {
    return {
      state: 'celebration',
      variant: 'milestone_party',
      meta: ICON_VARIANT_MAP.milestone_party,
      badgeCount: effectiveUnread,
      backgroundTitle: null,
      reason: milestoneToday ? 'streak_milestone' : 'new_year',
    };
  }

  if (todayRecorded && isLeagueChampion) {
    return {
      state: 'celebration',
      variant: 'champion_crown',
      meta: ICON_VARIANT_MAP.champion_crown,
      badgeCount: effectiveUnread,
      backgroundTitle: null,
      reason: 'champion_shipped',
    };
  }

  if (todayRecorded) {
    return {
      state: 'celebration',
      variant: 'on_fire_shipped',
      meta: ICON_VARIANT_MAP.on_fire_shipped,
      badgeCount: effectiveUnread,
      backgroundTitle: null,
      reason: 'shipped_today',
    };
  }

  if (isLeagueChampion) {
    return {
      state: 'celebration',
      variant: 'champion_crown',
      meta: ICON_VARIANT_MAP.champion_crown,
      badgeCount: effectiveUnread,
      backgroundTitle: null,
      reason: 'league_champion',
    };
  }

  if (protectedRestToday) {
    return {
      state: 'normal',
      variant: 'weekend_chill',
      meta: ICON_VARIANT_MAP.weekend_chill,
      badgeCount: effectiveUnread,
      backgroundTitle: null,
      reason: 'protected_rest',
    };
  }

  if (hour >= 22 || hour < 4) {
    return {
      state: 'normal',
      variant: 'night_owl',
      meta: ICON_VARIANT_MAP.night_owl,
      badgeCount: effectiveUnread,
      backgroundTitle: null,
      reason: 'night_owl_window',
    };
  }

  // 4. DEFAULT NORMAL STATE
  return {
    state: 'normal',
    variant: 'default',
    meta: ICON_VARIANT_MAP.default,
    badgeCount: effectiveUnread,
    backgroundTitle: null,
    reason: 'normal_active',
  };
}
