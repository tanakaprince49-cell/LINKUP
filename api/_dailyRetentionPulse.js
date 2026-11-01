// Randomized 2x/day retention pulse engine (Email + Native Push + Web Push + In-App).
// Every reachable LINKUP member gets two daily pulses at pseudo-random local
// daytime/evening hours AND distinct random minutes (>=4h 11m apart, never on :00,
// never two emails at the same time), with Linky's emotion dynamically matched
// to their live builder state.
import crypto from 'node:crypto';
import { sendExpoPush } from './_expoPush.js';
import {
  COMEBACK_SUNSET_DAYS,
  LINKY_AVATAR_URL,
  MIN_USER_EMAIL_GAP_MS,
  sendRetentionPulseEmail,
} from './_emailNotify.js';

const DAY_MS = 86_400_000;

function localClock(nowMs, timeZone = 'UTC') {
  const safeZone = (() => {
    try {
      Intl.DateTimeFormat('en-US', { timeZone: String(timeZone || 'UTC') });
      return String(timeZone || 'UTC');
    } catch {
      return 'UTC';
    }
  })();

  const d = new Date(nowMs);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(d);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const localDateKey = `${map.year}-${map.month}-${map.day}`;
  const localHour = Number(map.hour || 0);
  const localMinute = Number(map.minute || 0);
  const wkMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const localWeekday = wkMap[map.weekday] ?? d.getUTCDay();
  return { localDateKey, localHour, localMinute, localWeekday, timeZone: safeZone };
}

export function randomPulseScheduleForDay(uid, localDateKey) {
  const digest = crypto
    .createHash('sha256')
    .update(`linkup-pulse-v2:${uid}:${localDateKey}`)
    .digest();

  // Morning / midday slot: 08..12 local time (5 distinct hours) + random minute 04..53
  const pulse1Hour = 8 + (digest[0] % 5);
  const pulse1Minute = 4 + (digest[2] % 50);

  // Afternoon / evening slot: at least 5 calendar hours after pulse1Hour (15..20 local time)
  // so even 12:53 -> 17:04 is >= 4h 11m apart! Plus a guaranteed different minute (04..53).
  const minPulse2 = Math.max(15, pulse1Hour + 5);
  const span2 = Math.max(1, 20 - minPulse2 + 1);
  const pulse2Hour = minPulse2 + (digest[1] % span2);
  const rawMin2 = 4 + (digest[3] % 49);
  const pulse2Minute = rawMin2 >= pulse1Minute ? rawMin2 + 1 : rawMin2;

  return {
    pulse1Hour,
    pulse1Minute,
    pulse2Hour,
    pulse2Minute,
    seedA: digest[4],
    seedB: digest[5],
  };
}

export function computeScheduledEmailIso(nowMs, localMinute, targetMinute, fallbackSeed = 0) {
  // Schedule inside the current hour at the user's unique random minute (never :00)
  let offsetMinutes = targetMinute - localMinute;
  if (offsetMinutes < 2) {
    offsetMinutes = 3 + (Math.abs(Number(fallbackSeed) || 0) % 26); // 3..28m future jitter
  }
  const clampedMinutes = Math.min(54, Math.max(2, offsetMinutes));
  const scheduledMs = nowMs + clampedMinutes * 60_000;
  return { scheduledMs, scheduledIso: new Date(scheduledMs).toISOString(), offsetMinutes: clampedMinutes };
}

export function duePulseSlot({
  uid,
  localDateKey,
  localHour,
  localMinute = 0,
  nowMs = Date.now(),
  sentPulse1 = false,
  sentPulse2 = false,
  pulse1At = 0,
  lastEmailAt = 0,
}) {
  if (localHour < 8 || localHour > 21) return null;

  // Global spacing guard: defer (do NOT burn slot) if any email/pulse went out <4h ago
  const recentAnchor = Math.max(Number(pulse1At) || 0, Number(lastEmailAt) || 0);
  if (recentAnchor > 0 && nowMs - recentAnchor < MIN_USER_EMAIL_GAP_MS) {
    return null;
  }

  const schedule = randomPulseScheduleForDay(uid, localDateKey);
  if (!sentPulse1 && localHour >= schedule.pulse1Hour && (localHour < schedule.pulse2Hour || localHour <= 16)) {
    const jitter = computeScheduledEmailIso(nowMs, localMinute, schedule.pulse1Minute, schedule.seedA);
    return {
      slot: 'pulse1',
      schedule,
      seedByte: schedule.seedA,
      targetMinute: schedule.pulse1Minute,
      ...jitter,
    };
  }
  if (!sentPulse2 && localHour >= schedule.pulse2Hour) {
    const jitter = computeScheduledEmailIso(nowMs, localMinute, schedule.pulse2Minute, schedule.seedB);
    if (recentAnchor > 0 && jitter.scheduledMs - recentAnchor < MIN_USER_EMAIL_GAP_MS) {
      return null;
    }
    return {
      slot: 'pulse2',
      schedule,
      seedByte: schedule.seedB,
      targetMinute: schedule.pulse2Minute,
      ...jitter,
    };
  }
  return null;
}

export function selectExpressivePulse({
  firstName = '',
  slot = 'pulse1',
  localHour = 10,
  localWeekday = 2,
  daysSinceActive = 0,
  streakDays = 0,
  shippedToday = false,
  unreadCount = 0,
  isLeagueTop3 = false,
  seedByte = 0,
} = {}) {
  const namePrefix = firstName ? `${firstName}, ` : '';
  const nameHey = firstName ? `Hey ${firstName} — ` : 'Hey builder — ';
  const isEveningSlot = slot === 'pulse2';
  const pick = (arr) => arr[Math.abs(Number(seedByte) || 0) % arr.length];

  // 1. Real unread messages / pending intros come first
  if (unreadCount > 0) {
    const noun = unreadCount === 1 ? '1 builder signal' : `${unreadCount} builder signals`;
    return {
      mood: 'unread_urgent',
      subject: isEveningSlot
        ? `LINKUP · ${noun} still waiting for your reply`
        : `LINKUP · Someone reached out — ${noun} waiting`,
      headline: isEveningSlot
        ? `${nameHey}don’t leave a warm builder intro hanging tonight`
        : `${nameHey}${noun} landed in your LINKUP inbox`,
      body: isEveningSlot
        ? 'Fast replies turn warm intros into real collaborations. Take 60 seconds to check who reached out before calling it a day.'
        : 'Another builder on LINKUP is waiting to hear back from you. Open your alerts now while momentum is warm.',
      ctaLabel: 'Check your waiting messages',
      ctaUrl: '/alerts',
      pushTitle: `LINKUP · ${noun} waiting`,
      pushBody: `${namePrefix}open LINKUP to reply while the intro is warm.`,
    };
  }

  // 2. Milestone celebration when shipped today on a milestone day
  if (shippedToday && [7, 14, 30, 50, 100].includes(Number(streakDays))) {
    return {
      mood: 'milestone_party',
      subject: `LINKUP · Day ${streakDays} build milestone unlocked!`,
      headline: `${nameHey}Linky is throwing confetti for Day ${streakDays}!`,
      body: `Showing up ${streakDays} days in a row puts you among the most consistent builders on LINKUP. Share what you shipped or scout a collaborator who matches your pace.`,
      ctaLabel: 'Celebrate on LINKUP',
      ctaUrl: '/trending-builders',
      pushTitle: `Day ${streakDays} milestone on LINKUP!`,
      pushBody: `${namePrefix}Linky is celebrating your ${streakDays}-day streak — see who noticed.`,
    };
  }

  // 3. Shipped today -> proud cool-sunglasses Linky
  if (shippedToday) {
    return isEveningSlot
      ? {
          mood: 'on_fire_shipped',
          subject: 'LINKUP · Today’s build is locked in — see who else shipped',
          headline: `${nameHey}your proof is on the board today`,
          body: 'Linky has the sunglasses on because your daily build is already logged. Take two minutes tonight to check fresh builds in your lane and spark one high-signal connection.',
          ctaLabel: 'See today’s top builders',
          ctaUrl: '/trending-builders',
          pushTitle: 'LINKUP · Today’s build is locked in',
          pushBody: `${namePrefix}check what other builders shipped alongside you today.`,
        }
      : {
          mood: 'on_fire_shipped',
          subject: 'LINKUP · Early ship logged — ride that momentum',
          headline: `${nameHey}shipping early sets the pace for the whole network`,
          body: 'Your update is live on LINKUP. Builders browsing the feed right now can see your proof — drop into Search or Workspace to turn today’s win into a warm intro.',
          ctaLabel: 'Browse builders in your lane',
          ctaUrl: '/feed',
          pushTitle: 'LINKUP · Momentum locked in',
          pushBody: `${namePrefix}your ship is live — see who is building in your lane right now.`,
        };
  }

  // 4. Holding a Builder League podium spot
  if (isLeagueTop3) {
    return {
      mood: 'champion_crown',
      subject: isEveningSlot
        ? 'LINKUP · Defend your Builder League crown tonight'
        : 'LINKUP · You’re on the Builder League podium',
      headline: `${nameHey}builders are chasing your League spot`,
      body: 'You’re sitting near the very top of the Builder League standings. Post one quick proof update today so nobody slips past your spot before the week closes.',
      ctaLabel: 'Defend your League rank',
      ctaUrl: '/trending-builders',
      pushTitle: 'LINKUP · Defend your League podium',
      pushBody: `${namePrefix}log one quick build update to hold your Builder League spot.`,
    };
  }

  // 5. Active streak at risk in afternoon/evening slot
  if (streakDays >= 2 && isEveningSlot) {
    return {
      mood: 'streak_fire',
      subject: `LINKUP · Keep your ${streakDays}-day build streak alive tonight`,
      headline: `${nameHey}your ${streakDays}-day streak is still open today`,
      body: `Linky is holding the plug by the socket so your ${streakDays}-day streak doesn’t reset at midnight. Even two sentences on what moved forward today locks in Day ${streakDays + 1}.`,
      ctaLabel: `Lock in Day ${streakDays + 1}`,
      ctaUrl: '/ship',
      pushTitle: `Save your ${streakDays}-day LINKUP streak`,
      pushBody: `${namePrefix}log 60 seconds of progress before midnight to hit Day ${streakDays + 1}.`,
    };
  }

  // 6. Away for 1–2 days -> Fiery Angry Red Linky!
  if (daysSinceActive >= 1 && daysSinceActive < 3) {
    return isEveningSlot
      ? {
          mood: 'angry_1d',
          subject: 'LINKUP · Linky turned red waiting on your update!',
          headline: `${nameHey}you skipped yesterday and Linky noticed!`,
          body: 'One missed day turns into a dead week if you let it slide. Plug back into LINKUP for two minutes tonight and put one honest build note on the board.',
          ctaLabel: 'Calm Linky down & log progress',
          ctaUrl: '/ship?comeback=1d',
          pushTitle: 'Linky noticed you missed yesterday!',
          pushBody: `${namePrefix}plug back into LINKUP for 2 minutes and put a win on the board.`,
        }
      : {
          mood: 'angry_1d',
          subject: 'LINKUP · Don’t let 1 missed day turn into 2',
          headline: `${nameHey}Linky is standing by the wall socket looking grumpy`,
          body: 'You haven’t opened LINKUP in over a day while builders in your lane kept shipping. Jump back in right now — even a tiny ship turns Linky bright yellow again.',
          ctaLabel: 'Plug back into LINKUP',
          ctaUrl: '/ship?comeback=1d',
          pushTitle: 'Don’t let 1 missed day become 2',
          pushBody: `${namePrefix}Linky turned fiery red — open LINKUP to plug back in.`,
        };
  }

  // 7. Away for 3–6 days -> Sad Rainy Linky!
  if (daysSinceActive >= 3 && daysSinceActive < 7) {
    return isEveningSlot
      ? {
          mood: 'sad_inactive',
          subject: `LINKUP · Linky misses seeing what you’re building`,
          headline: `${nameHey}it’s been ${Math.floor(daysSinceActive)} days since you plugged in`,
          body: 'Linky has been sitting beside an unplugged socket while new founders, engineers, and designers joined your lane. Come say hi and share one sentence on what you’re working on.',
          ctaLabel: 'Plug Linky back in',
          ctaUrl: '/ship?comeback=sad',
          pushTitle: 'Linky misses you on LINKUP',
          pushBody: `${namePrefix}it’s been ${Math.floor(daysSinceActive)} days — drop one quick update tonight.`,
        }
      : {
          mood: 'sad_inactive',
          subject: 'LINKUP · Your builder seat is getting cold',
          headline: `${nameHey}builders in your lane kept moving while you were away`,
          body: 'No pressure to write an essay — just open LINKUP for two minutes, check fresh profiles on the homescreen search, or log one small thing you built this week.',
          ctaLabel: 'Return to LINKUP',
          ctaUrl: '/feed',
          pushTitle: 'Your LINKUP seat is waiting',
          pushBody: `${namePrefix}see who joined your lane while you were away.`,
        };
  }

  // 8. Away for 7+ days -> Dusty Cobwebs Linky!
  if (daysSinceActive >= 7) {
    return isEveningSlot
      ? {
          mood: 'ghost_abandoned',
          subject: 'LINKUP · Cobwebs are forming on your builder workspace',
          headline: `${nameHey}shake the dust off your LINKUP profile tonight`,
          body: 'A lot has changed since you last stopped by — fresh builders, active Builder League standings, and direct search right on the homescreen. Tap back in whenever you have two spare minutes.',
          ctaLabel: 'Brush off the cobwebs',
          ctaUrl: '/feed',
          pushTitle: 'Cobwebs on your LINKUP workspace',
          pushBody: `${namePrefix}fresh builders joined your lane — tap to jump back in.`,
        }
      : {
          mood: 'ghost_abandoned',
          subject: 'LINKUP · Still building? Linky kept your spot warm',
          headline: `${nameHey}your workspace is still right where you left it`,
          body: 'Whether you pivoted, shipped quietly, or took a breather, one fresh update puts you right back in front of collaborators on LINKUP.',
          ctaLabel: 'Open LINKUP',
          ctaUrl: '/ship?comeback=7d',
          pushTitle: 'Linky kept your spot on LINKUP',
          pushBody: `${namePrefix}jump back in and show everyone what you’re building now.`,
        };
  }

  // 9. Weekend chill morning check-in
  if ((localWeekday === 0 || localWeekday === 6) && !isEveningSlot) {
    return {
      mood: 'weekend_chill',
      subject: 'LINKUP · Easy weekend builder check-in',
      headline: `${nameHey}grab a coffee and see what builders are tinkering on`,
      body: 'Weekends are when the best side-projects and founder conversations spark. Browse fresh builders from Search or jot down one calm weekend note in your Workspace.',
      ctaLabel: 'Explore weekend builders',
      ctaUrl: '/feed',
      pushTitle: 'LINKUP · Weekend coffee check-in',
      pushBody: `${namePrefix}see what builders are tinkering on this weekend.`,
    };
  }

  // 10. Late evening night-owl vibe
  if (localHour >= 20) {
    return {
      mood: 'night_owl',
      subject: 'LINKUP · Late-night builder check-in from Linky',
      headline: `${nameHey}quiet hours are where real builders pull ahead`,
      body: 'Before you close your tabs for the night, log what moved forward today or bookmark one sharp collaborator from LINKUP Search.',
      ctaLabel: 'Log tonight’s progress',
      ctaUrl: '/ship',
      pushTitle: 'LINKUP · Night-owl builder check-in',
      pushBody: `${namePrefix}drop one quick note on today’s progress before wrapping up.`,
    };
  }

  // 11. Default energized yellow plugged-in Linky (varied across days & slots!)
  const morningOptions = [
    {
      subject: 'LINKUP · What’s the one thing you’re shipping today?',
      headline: `${nameHey}Linky is plugged in — what’s today’s main move?`,
      body: 'Pick one concrete deliverable today, search for a collaborator right from the homescreen, or check who climbed the Builder League overnight.',
      ctaLabel: 'Start today’s move on LINKUP',
      ctaUrl: '/builder',
      pushTitle: 'LINKUP · What’s today’s move?',
      pushBody: `${namePrefix}plug in for 2 minutes and set today’s builder momentum.`,
    },
    {
      subject: 'LINKUP · Fresh founders & builders are active right now',
      headline: `${nameHey}new proof just hit the LINKUP feed`,
      body: 'Builders who show up daily get spotted first for paid projects, co-founder roles, and warm intros. Jump in and make one visible move.',
      ctaLabel: 'Open LINKUP',
      ctaUrl: '/feed',
      pushTitle: 'Fresh builders active on LINKUP',
      pushBody: `${namePrefix}see who is shipping in your lane today.`,
    },
  ];

  const eveningOptions = [
    {
      subject: 'LINKUP · Put today’s progress on the board in 60 seconds',
      headline: `${nameHey}don’t let today’s work stay invisible`,
      body: 'Even a two-line Ship Log update compounds your proof on LINKUP and keeps your Builder League momentum climbing.',
      ctaLabel: 'Post a 60-second Ship Log',
      ctaUrl: '/ship',
      pushTitle: 'Put today’s build on LINKUP',
      pushBody: `${namePrefix}60 seconds in Ship Log turns today’s work into visible proof.`,
    },
    {
      subject: 'LINKUP · Quick afternoon pulse from Linky ⚡',
      headline: `${nameHey}who could unblock your build faster this week?`,
      body: 'Use the homescreen search or ask Linky for a cited builder match — the right engineer, designer, or founder might already be online.',
      ctaLabel: 'Find a collaborator on LINKUP',
      ctaUrl: '/linky',
      pushTitle: 'LINKUP · Afternoon builder pulse',
      pushBody: `${namePrefix}check new builder updates or log what you moved forward today.`,
    },
  ];

  const chosen = pick(isEveningSlot ? eveningOptions : morningOptions);
  return {
    mood: 'default',
    ...chosen,
  };
}

function parseTimestampMs(val) {
  if (!val) return 0;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val?.toMillis === 'function') return val.toMillis();
  if (typeof val?._seconds === 'number') return val._seconds * 1000;
  const parsed = Date.parse(String(val));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function runDailyRetentionPulsePage(
  db,
  {
    after = '',
    limit = 30,
    now = Date.now(),
    push = (uid, payload) => sendExpoPush(db, uid, payload),
    emailOpts = {},
  } = {},
) {
  if (!db || typeof db.collection !== 'function') {
    return { scanned: 0, pulsed: 0, emailsSent: 0, pushesSent: 0, nextCursor: '' };
  }
  const nowMs = typeof now === 'function' ? now() : Number(now) || Date.now();
  let query = db.collection('users').orderBy('__name__').limit(Math.max(1, Math.min(50, Number(limit) || 30)));
  if (after) query = query.startAfter(after);

  const snap = await query.get();
  const docs = snap?.docs || [];
  if (!docs.length) {
    return { scanned: 0, pulsed: 0, emailsSent: 0, pushesSent: 0, nextCursor: '' };
  }

  let pulsed = 0;
  let emailsSent = 0;
  let pushesSent = 0;

  for (const userDoc of docs) {
    const uid = userDoc.id;
    const u = userDoc.data() || {};
    if (u.deleted || u.banned) continue;

    const [stateSnap, contribSnap, emailPrefSnap] = await Promise.all([
      db.collection('builderStates').doc(uid).get().catch(() => null),
      db.collection('builderContributions').doc(uid).get().catch(() => null),
      db.collection('emailPrefs').doc(uid).get().catch(() => null),
    ]);
    const state = stateSnap?.exists ? stateSnap.data() || {} : {};
    const contrib = contribSnap?.exists ? contribSnap.data() || {} : {};
    const emailPref = emailPrefSnap?.exists ? emailPrefSnap.data() || {} : {};
    const prefs = state.prefs || {};
    const tz = prefs.timezone || u.timezone || 'UTC';
    const { localDateKey, localHour, localMinute, localWeekday } = localClock(nowMs, tz);

    const pulseDocRef = db.collection('retentionPulses').doc(`${uid}_${localDateKey}`);
    const pulseSnap = await pulseDocRef.get().catch(() => null);
    const pulseState = pulseSnap?.exists ? pulseSnap.data() || {} : {};

    const due = duePulseSlot({
      uid,
      localDateKey,
      localHour,
      localMinute,
      nowMs,
      sentPulse1: Boolean(pulseState.pulse1At),
      sentPulse2: Boolean(pulseState.pulse2At),
      pulse1At: Number(pulseState.pulse1EffectiveAt || pulseState.pulse1At || 0),
      lastEmailAt: Number(emailPref.lastEmailAt || 0),
    });
    if (!due) continue;

    const lastActiveMs = Math.max(
      parseTimestampMs(u.lastActiveAt),
      parseTimestampMs(u.lastSeen),
      parseTimestampMs(u.updatedAt),
      parseTimestampMs(state.updatedAt),
      parseTimestampMs(contrib.updatedAt),
    );
    const daysSinceActive = lastActiveMs > 0 ? Math.max(0, (nowMs - lastActiveMs) / DAY_MS) : 0;
    if (daysSinceActive > COMEBACK_SUNSET_DAYS) continue;

    const habit = contrib.habit || {};
    const streakDays = Number(habit.currentStreak || u.streakCount || 0) || 0;
    const shippedToday = String(habit.lastActiveDate || '') === localDateKey;
    const unreadCount = Number(u.unreadCount || 0) || 0;
    const isLeagueTop3 = Number(u.leagueRank || 0) >= 1 && Number(u.leagueRank || 0) <= 3;
    const rawName = String(u.displayName || u.fullName || u.name || '').trim();
    const firstName = rawName ? rawName.split(/\s+/)[0].slice(0, 24) : '';

    const copy = selectExpressivePulse({
      firstName,
      slot: due.slot,
      localHour,
      localWeekday,
      daysSinceActive,
      streakDays,
      shippedToday,
      unreadCount,
      isLeagueTop3,
      seedByte: due.seedByte,
    });

    // Claim slot with both cron fire time and jittered scheduled delivery timestamp
    await pulseDocRef.set(
      {
        uid,
        localDateKey,
        schedule: {
          pulse1: `${String(due.schedule.pulse1Hour).padStart(2, '0')}:${String(due.schedule.pulse1Minute).padStart(2, '0')}`,
          pulse2: `${String(due.schedule.pulse2Hour).padStart(2, '0')}:${String(due.schedule.pulse2Minute).padStart(2, '0')}`,
        },
        [`${due.slot}At`]: nowMs,
        [`${due.slot}EffectiveAt`]: due.scheduledMs,
        [`${due.slot}Mood`]: copy.mood,
        updatedAt: nowMs,
      },
      { merge: true },
    );

    // 1. In-app Linky notification with LINKUP Cat Logo profile pic (`fromPic`)
    if (prefs.inApp !== false) {
      const notifRef = db.collection('notifications').doc(`pulse_${uid}_${localDateKey}_${due.slot}`);
      await notifRef.set({
        userId: uid,
        fromId: 'linky-ai',
        fromName: 'Linky',
        fromPic: LINKY_AVATAR_URL,
        type: 'builder',
        category: 'daily_pulse',
        slot: due.slot,
        mood: copy.mood,
        title: copy.pushTitle,
        body: copy.pushBody,
        content: copy.pushBody,
        url: copy.ctaUrl,
        targetUrl: copy.ctaUrl,
        serverPushManaged: true,
        pushRequested: prefs.push !== false,
        isRead: false,
        timestamp: new Date(nowMs),
      }).catch(() => null);
    }

    // 2. Native Push (Expo) + Browser Web Push (VAPID)
    let pushAccepted = 0;
    if (prefs.push !== false) {
      try {
        const pRes = await push(uid, {
          title: copy.pushTitle,
          body: copy.pushBody,
          url: copy.ctaUrl,
          mood: copy.mood,
          campaign: `daily_pulse_${due.slot}`,
          category: 'daily_pulse',
          type: 'builder',
        });
        pushAccepted = Number(pRes?.sent || 0);
      } catch {
        pushAccepted = 0;
      }
    }

    // 3. Expressive Full-Bleed Email scheduled at the user's unique random minute (never colliding!)
    let emailSent = false;
    if (prefs.emailDaily !== false) {
      const eRes = await sendRetentionPulseEmail(
        db,
        uid,
        {
          localDateKey,
          slot: due.slot,
          mood: copy.mood,
          scheduledAt: due.scheduledIso,
          subject: copy.subject,
          headline: copy.headline,
          body: copy.body,
          ctaLabel: copy.ctaLabel,
          ctaUrl: copy.ctaUrl,
          daysSinceActive,
        },
        { ...emailOpts, now: nowMs },
      ).catch(() => ({ sent: false }));
      emailSent = Boolean(eRes?.sent);
    }

    pulsed += 1;
    if (emailSent) emailsSent += 1;
    if (pushAccepted > 0) pushesSent += 1;
  }

  const nextCursor = docs.length >= limit ? docs[docs.length - 1].id : '';
  return {
    scanned: docs.length,
    pulsed,
    emailsSent,
    pushesSent,
    nextCursor,
  };
}
