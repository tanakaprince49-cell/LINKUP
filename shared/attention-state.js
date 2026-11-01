// Duolingo-style dynamic visual appearance & multi-occasion icon resolver.
// Every bundled favicon / mobile launcher icon maps to a concrete, deterministic
// product reason across both Web and Mobile, and reverts immediately on user action.

export const MILESTONE_STREAK_DAYS = Object.freeze([1, 3, 7, 14, 30, 50, 100, 365]);

export const ICON_VARIANTS = Object.freeze([
  {
    id: 'default',
    label: 'Plugged In',
    occasion: 'Active · Caught up & building',
    triggerRule: 'Shown during normal active sessions when unread alerts are cleared.',
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
    id: 'angry_1d',
    label: 'Red Angry',
    occasion: 'Inactive · Not opened for 1 day',
    triggerRule: 'Automatically turns red angry when LINKUP has not been opened for 1–2 days.',
    subtitle: 'Furious crimson-red Linky glaring with an unplugged sparking cord after 24 hours away.',
    category: 'inactive',
    androidAlias: 'LauncherAngry1d',
    iosIconName: 'Angry1d',
    assetFile: 'icon-angry-red.png',
    webIconFile: 'icon-angry-red.png',
    themeColor: '#CA221F',
    tabPrefix: '😠 1 day away',
  },
  {
    id: 'sad_inactive',
    label: 'Missing You',
    occasion: 'Inactive · Not opened for 3–6 days',
    triggerRule: 'Automatically shown when LINKUP has not been opened for 3 to 6 days.',
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
    occasion: 'Inactive · Not opened for 7+ days',
    triggerRule: 'Automatically shown when LINKUP has not been opened for a full week or longer.',
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
    id: 'unread_urgent',
    label: 'Incoming Signal',
    occasion: 'Urgent · Unread messages or notifications',
    triggerRule: 'Shown across web & mobile whenever unread messages, matches, or alerts are waiting.',
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
    id: 'streak_fire',
    label: 'Streak on the Line',
    occasion: 'Urgent · Evening streak at risk (after 6 PM)',
    triggerRule: 'Shown after 6:00 PM when an active 2+ day streak still needs today’s build update.',
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
    id: 'champion_crown',
    label: 'League Champion',
    occasion: 'Occasion · Builder League winner & PLUS',
    triggerRule: 'Shown when you hold a Builder League win, reward campaign, or PLUS crown.',
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
    triggerRule: 'Shown throughout the rest of the day right after you log your daily build step.',
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
    occasion: 'Occasion · Streak milestone & New Year',
    triggerRule: 'Shown on Day 1, 3, 7, 14, 30, 50, 100, or 365 build streaks and New Year’s.',
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
    triggerRule: 'Shown automatically during late-night building sessions between 10 PM and 4 AM.',
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
    triggerRule: 'Shown on your protected weekly rest day or Sunday streak-safe recharge.',
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
 * Every variant maps to a specific reason across Web & Mobile:
 * - Not opened for 7+ days -> `ghost_abandoned` (Cobweb Mode)
 * - Not opened for 3–6 days -> `sad_inactive` (Missing You)
 * - Not opened for 1–2 days -> `angry_1d` (Red Angry)
 *   (All 3 inactivity states revert immediately the instant the user opens/focuses LINKUP!)
 * - Unread messages or notifications -> `unread_urgent` (reverts immediately on opening Messages/Alerts or reading)
 * - Active 2+ day streak unlogged after 6 PM -> `streak_fire` (transforms immediately on logging today's build)
 * - Milestone streak / League Champion / Shipped Today / Protected Rest / Night Owl -> matching occasion icon!
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

  // 1. INACTIVE STATES (7d+ cobweb, 3–6d sad, 1–2d red angry) — reverts immediately on open/focus!
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
  if (inactiveDays >= 1) {
    return {
      state: 'inactive',
      variant: 'angry_1d',
      meta: ICON_VARIANT_MAP.angry_1d,
      badgeCount: Math.max(1, effectiveUnread),
      backgroundTitle: '😠 1 day away — Linky is waiting · LINKUP',
      reason: 'inactive_1d',
    };
  }

  // 2. URGENT STATES — shown live across web & mobile for their exact reason,
  // and revert immediately when the user reads messages/alerts or logs today's build!
  const streak = Math.max(0, Math.floor(Number(streakCount) || 0));
  const hour = ((Math.floor(Number(localHour) || 0) % 24) + 24) % 24;

  if (effectiveUnread > 0) {
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

  const streakAtRisk = streak >= 2 && !todayRecorded && !protectedRestToday && hour >= 18;
  if (streakAtRisk) {
    return {
      state: 'urgent',
      variant: 'streak_fire',
      meta: ICON_VARIANT_MAP.streak_fire,
      badgeCount: 1,
      backgroundTitle: !isForeground
        ? `🔥 Keep your ${streak}-day build streak alive · LINKUP`
        : null,
      reason: 'streak_at_risk',
    };
  }

  // 3. CELEBRATION & OCCASION VARIANTS (each shown for its real product occasion!)
  const milestoneToday = todayRecorded && MILESTONE_STREAK_DAYS.includes(streak);
  if (milestoneToday || isNewYearCelebration(nowMs)) {
    return {
      state: 'celebration',
      variant: 'milestone_party',
      meta: ICON_VARIANT_MAP.milestone_party,
      badgeCount: 0,
      backgroundTitle: null,
      reason: milestoneToday ? 'streak_milestone' : 'new_year',
    };
  }

  if (todayRecorded && isLeagueChampion) {
    return {
      state: 'celebration',
      variant: 'champion_crown',
      meta: ICON_VARIANT_MAP.champion_crown,
      badgeCount: 0,
      backgroundTitle: null,
      reason: 'champion_shipped',
    };
  }

  if (todayRecorded) {
    return {
      state: 'celebration',
      variant: 'on_fire_shipped',
      meta: ICON_VARIANT_MAP.on_fire_shipped,
      badgeCount: 0,
      backgroundTitle: null,
      reason: 'shipped_today',
    };
  }

  if (isLeagueChampion) {
    return {
      state: 'celebration',
      variant: 'champion_crown',
      meta: ICON_VARIANT_MAP.champion_crown,
      badgeCount: 0,
      backgroundTitle: null,
      reason: 'league_champion',
    };
  }

  if (protectedRestToday) {
    return {
      state: 'normal',
      variant: 'weekend_chill',
      meta: ICON_VARIANT_MAP.weekend_chill,
      badgeCount: 0,
      backgroundTitle: null,
      reason: 'protected_rest',
    };
  }

  if (hour >= 22 || hour < 4) {
    return {
      state: 'normal',
      variant: 'night_owl',
      meta: ICON_VARIANT_MAP.night_owl,
      badgeCount: 0,
      backgroundTitle: null,
      reason: 'night_owl_window',
    };
  }

  // 4. DEFAULT NORMAL STATE
  return {
    state: 'normal',
    variant: 'default',
    meta: ICON_VARIANT_MAP.default,
    badgeCount: 0,
    backgroundTitle: null,
    reason: 'normal_active',
  };
}
