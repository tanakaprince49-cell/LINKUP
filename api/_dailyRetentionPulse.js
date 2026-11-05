// Randomized daily retention pulse engine (1 Email/day + randomized Native/Web Push + In-App).
// Every reachable LINKUP member gets at most ONE expressive email per day at a
// pseudo-random local hour & minute, plus spaced mobile/browser push check-ins
// (>=4h apart, never on :00, never two emails in the same day).
import crypto from 'node:crypto';
import { sendExpoPush } from './_expoPush.js';
import {
  COMEBACK_SUNSET_DAYS,
  LINKY_AVATAR_URL,
  buildPersonalBuilderBrief,
  sendRetentionPulseEmail,
} from './_emailNotify.js';

const DAY_MS = 86_400_000;
const MIN_PULSE_GAP_MS = 4 * 60 * 60 * 1000;

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
  // Pick ONE random slot per day for the member's single daily email
  const emailSlot = digest[6] % 2 === 0 ? 'pulse1' : 'pulse2';

  return {
    pulse1Hour,
    pulse1Minute,
    pulse2Hour,
    pulse2Minute,
    emailSlot,
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
}) {
  if (localHour < 8 || localHour > 21) return null;

  // Minimum 4h spacing between daily pulses
  const recentPulseAt = Number(pulse1At) || 0;
  if (recentPulseAt > 0 && nowMs - recentPulseAt < MIN_PULSE_GAP_MS) {
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
    if (recentPulseAt > 0 && jitter.scheduledMs - recentPulseAt < MIN_PULSE_GAP_MS) {
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

function clipPhrase(str = '', max = 52) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 16 ? cut.slice(0, sp) : cut).replace(/[.,;:\s]+$/, '')}…`;
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
  personal = null,
  projectLabel: rawProject = '',
  goalLabel: rawGoal = '',
  lookingForLabel: rawLooking = '',
  openStep: rawStep = '',
  roleLabel: rawRole = '',
} = {}) {
  const p = personal && typeof personal === 'object' ? personal : {};
  const resolvedName = String(firstName || p.firstName || '').trim();
  const project = String(rawProject || p.projectLabel || '').trim();
  const goal = String(rawGoal || p.goalLabel || '').trim();
  const lookingFor = String(rawLooking || p.lookingForLabel || '').trim();
  const openStep = String(rawStep || p.openStep || '').trim();
  const role = String(rawRole || p.roleLabel || '').trim();

  const shortProject = clipPhrase(project, 34);
  const shortGoal = clipPhrase(goal || openStep, 52);
  const shortLooking = clipPhrase(lookingFor, 44);

  const namePrefix = resolvedName ? `${resolvedName}, ` : '';
  const nameHey = resolvedName ? `Hey ${resolvedName} — ` : 'Hey builder — ';
  const subjName = resolvedName ? `${resolvedName}, ` : '';
  const isEveningSlot = slot === 'pulse2';
  const pick = (arr) => arr[Math.abs(Number(seedByte) || 0) % arr.length];

  const focusTail = (() => {
    if (project && goal && lookingFor) {
      return `You’re building ${project} toward "${goal}" and looking for ${lookingFor} — don’t carry the whole build solo when compatible co-founders and collaborators are active on LINKUP right now.`;
    }
    if (goal && lookingFor) {
      return `Your goal on LINKUP is "${goal}" and you’re looking for ${lookingFor}. Log one concrete move or review vetted ${shortLooking} matches today.`;
    }
    if (project && goal) {
      return `Every visible update on ${project} moves "${goal}" closer and puts your proof in front of serious co-founders.`;
    }
    if (goal) {
      return `Keep "${goal}" moving today — even one 60-second update compounds your momentum and attracts the right co-founder.`;
    }
    if (project && lookingFor) {
      return `You’re building ${project} and looking for ${lookingFor} — vetted builders in that exact lane are active on LINKUP today.`;
    }
    if (lookingFor) {
      return `Builders matching what you’re looking for (${lookingFor}) are active on LINKUP right now — don’t build alone when your missing half could already be online.`;
    }
    if (role) {
      return `Founders and teams looking for a sharp ${role} check active builders first on LINKUP.`;
    }
    return '';
  })();

  // 1. Real unread messages / pending intros come first
  if (unreadCount > 0) {
    const noun = unreadCount === 1 ? '1 builder signal' : `${unreadCount} builder signals`;
    const unreadTail = lookingFor
      ? ` Could be the ${shortLooking} match${project ? ` for ${shortProject}` : ''} you’ve been looking for.`
      : (goal ? ` Could help accelerate "${shortGoal}".` : '');
    return {
      mood: 'unread_urgent',
      subject: isEveningSlot
        ? `LINKUP · ${subjName}${noun} still waiting${shortLooking ? ` (${shortLooking})` : ' for your reply'}`
        : `LINKUP · ${subjName}someone reached out — ${noun} waiting`,
      headline: isEveningSlot
        ? `${nameHey}don’t leave a warm builder intro hanging tonight`
        : `${nameHey}${noun} landed in your LINKUP inbox`,
      body: (isEveningSlot
        ? 'Fast replies turn warm intros into real co-founder partnerships. Take 60 seconds to check who reached out before calling it a day.'
        : 'Another builder on LINKUP is waiting to hear back from you. Open your alerts now while momentum is warm.') + unreadTail,
      ctaLabel: 'Check your waiting messages',
      ctaUrl: '/alerts',
      pushTitle: `LINKUP · ${noun} waiting`,
      pushBody: `${namePrefix}open LINKUP to reply while the intro is warm.`,
    };
  }

  // 2. Milestone celebration when shipped today on a milestone day
  if (shippedToday && [7, 14, 30, 50, 100].includes(Number(streakDays))) {
    const milestoneGoal = goal
      ? ` pushing toward "${shortGoal}"`
      : (project ? ` shipping ${shortProject}` : '');
    const milestoneMatch = lookingFor
      ? ` Use that verified ${streakDays}-day proof to pull in ${lookingFor} right now.`
      : ' Share what you shipped or scout a co-founder who matches your pace.';
    return {
      mood: 'milestone_party',
      subject: `LINKUP · ${subjName}Day ${streakDays} milestone unlocked${shortProject ? ` on ${shortProject}` : ''}!`,
      headline: `${nameHey}Linky is throwing confetti for Day ${streakDays}${milestoneGoal}!`,
      body: `Showing up ${streakDays} days in a row puts you among the most consistent builders on LINKUP.${milestoneMatch}`,
      ctaLabel: lookingFor ? `Find ${ clipPhrase(lookingFor, 26) } matches` : 'Celebrate on LINKUP',
      ctaUrl: lookingFor ? '/linky' : '/trending-builders',
      pushTitle: `Day ${streakDays} milestone on LINKUP!`,
      pushBody: `${namePrefix}Linky is celebrating your ${streakDays}-day streak — see who noticed.`,
    };
  }

  // 3. Shipped today -> proud cool-sunglasses Linky
  if (shippedToday) {
    const shipSubject = shortGoal
      ? `LINKUP · ${subjName}today’s step toward "${ clipPhrase(shortGoal, 36) }" is locked in`
      : (shortProject ? `LINKUP · ${subjName}today’s ${shortProject} build is locked in` : 'LINKUP · Today’s build is locked in — see who else shipped');
    const shipBody = lookingFor
      ? `Linky has the sunglasses on because your build${project ? ` on ${project}` : ''} is logged${goal ? ` toward "${goal}"` : ''}. Now turn today’s proof into distribution — ask Linky for vetted ${lookingFor} matches while your streak badge is glowing.`
      : (focusTail || 'Linky has the sunglasses on because your daily build is already logged. Take two minutes to check fresh builds in your lane and spark one high-signal connection.');
    return isEveningSlot
      ? {
          mood: 'on_fire_shipped',
          subject: shipSubject,
          headline: `${nameHey}your proof${shortProject ? ` on ${shortProject}` : ''} is on the board today`,
          body: shipBody,
          ctaLabel: lookingFor ? `Scout ${clipPhrase(lookingFor, 26)} matches` : 'See today’s top builders',
          ctaUrl: lookingFor ? '/linky' : '/trending-builders',
          pushTitle: 'LINKUP · Today’s build is locked in',
          pushBody: `${namePrefix}check what other builders shipped alongside you today.`,
        }
      : {
          mood: 'on_fire_shipped',
          subject: shortProject ? `LINKUP · ${subjName}early ${shortProject} ship logged — ride that momentum` : 'LINKUP · Early ship logged — ride that momentum',
          headline: `${nameHey}shipping early${shortGoal ? ` toward "${shortGoal}"` : ''} sets the pace`,
          body: shipBody,
          ctaLabel: lookingFor ? `Find ${clipPhrase(lookingFor, 26)} on LINKUP` : 'Browse builders in your lane',
          ctaUrl: lookingFor ? '/linky' : '/feed',
          pushTitle: 'LINKUP · Momentum locked in',
          pushBody: `${namePrefix}your ship is live — see who is building in your lane right now.`,
        };
  }

  // 4. Holding a Builder League podium spot
  if (isLeagueTop3) {
    return {
      mood: 'champion_crown',
      subject: isEveningSlot
        ? `LINKUP · ${subjName}defend your Builder League crown${shortProject ? ` with ${shortProject}` : ''} tonight`
        : `LINKUP · ${subjName}you’re on the Builder League podium`,
      headline: `${nameHey}builders are chasing your League spot`,
      body: `You’re sitting near the very top of the Builder League standings.${goal ? ` Log one concrete step on "${goal}" today so nobody slips past you.` : ' Post one quick proof update today so nobody slips past your spot before the week closes.'}${lookingFor ? ` Podium builders get 3x faster replies from ${lookingFor} candidates.` : ''}`,
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
      subject: shortGoal
        ? `LINKUP · ${subjName}keep your ${streakDays}-day streak alive on "${clipPhrase(shortGoal, 34)}"`
        : `LINKUP · Keep your ${streakDays}-day build streak alive tonight`,
      headline: `${nameHey}your ${streakDays}-day streak${shortProject ? ` on ${shortProject}` : ''} is still open today`,
      body: `Linky is holding the plug by the socket so your ${streakDays}-day streak doesn’t reset at midnight.${goal ? ` Two honest lines on how you moved "${goal}" forward today locks in Day ${streakDays + 1}.` : ` Even two sentences on what moved forward today locks in Day ${streakDays + 1}.`}${lookingFor ? ` Serious ${lookingFor} matches look at live streaks first.` : ''}`,
      ctaLabel: `Lock in Day ${streakDays + 1}`,
      ctaUrl: '/ship',
      pushTitle: `Save your ${streakDays}-day LINKUP streak`,
      pushBody: `${namePrefix}log 60 seconds of progress before midnight to hit Day ${streakDays + 1}.`,
    };
  }

  // 6. Away for 1–2 days -> Fiery Angry Red Linky!
  if (daysSinceActive >= 1 && daysSinceActive < 3) {
    const angryDetail = focusTail
      || (isEveningSlot
        ? 'One missed day turns into a dead week if you let it slide. Plug back into LINKUP for two minutes tonight and put one honest build note on the board.'
        : 'You haven’t opened LINKUP in over a day while builders in your lane kept shipping. Jump back in right now — even a tiny ship turns Linky bright yellow again.');
    return isEveningSlot
      ? {
          mood: 'angry_1d',
          subject: shortGoal
            ? `LINKUP · ${subjName}Linky turned red — "${clipPhrase(shortGoal, 38)}" needs today’s move!`
            : (shortLooking
                ? `LINKUP · ${subjName}Linky turned red while ${clipPhrase(shortLooking, 34)} matches shipped!`
                : 'LINKUP · Linky turned red waiting on your update!'),
          headline: shortProject
            ? `${nameHey}you skipped yesterday while ${shortProject} is waiting on you!`
            : `${nameHey}you skipped yesterday and Linky noticed!`,
          body: angryDetail,
          ctaLabel: shortGoal ? 'Log progress & calm Linky down' : 'Calm Linky down & log progress',
          ctaUrl: '/ship?comeback=1d',
          pushTitle: 'Linky noticed you missed yesterday!',
          pushBody: `${namePrefix}plug back into LINKUP for 2 minutes and put a win on the board.`,
        }
      : {
          mood: 'angry_1d',
          subject: shortProject
            ? `LINKUP · ${subjName}don’t let ${shortProject} stall for a 2nd day`
            : 'LINKUP · Don’t let 1 missed day turn into 2',
          headline: shortGoal
            ? `${nameHey}Linky is grumpy — "${shortGoal}" didn’t move yesterday`
            : `${nameHey}Linky is standing by the wall socket looking grumpy`,
          body: angryDetail,
          ctaLabel: lookingFor ? `Plug in & see ${clipPhrase(lookingFor, 24)} matches` : 'Plug back into LINKUP',
          ctaUrl: '/ship?comeback=1d',
          pushTitle: 'Don’t let 1 missed day become 2',
          pushBody: `${namePrefix}Linky turned fiery red — open LINKUP to plug back in.`,
        };
  }

  // 7. Away for 3–6 days -> Sad Rainy Linky!
  if (daysSinceActive >= 3 && daysSinceActive < 7) {
    const daysFloor = Math.floor(daysSinceActive);
    const sadBody = (goal || lookingFor || project)
      ? `${project ? `It’s been ${daysFloor} days since you updated ${project}. ` : `It’s been ${daysFloor} days since you plugged in. `}${goal ? `Your goal ("${goal}") is still within reach, ` : ''}${lookingFor ? `and vetted builders matching ${lookingFor} were active while you were away.` : 'and fresh founders & engineers joined your lane while you were away.'} Take two minutes to jump back in so you aren’t building in isolation.`
      : (isEveningSlot
          ? 'Linky has been sitting beside an unplugged socket while new founders, engineers, and designers joined your lane. Come say hi and share one sentence on what you’re working on.'
          : 'No pressure to write an essay — just open LINKUP for two minutes, check fresh profiles on the homescreen search, or log one small thing you built this week.');
    return isEveningSlot
      ? {
          mood: 'sad_inactive',
          subject: shortProject
            ? `LINKUP · ${subjName}Linky misses seeing updates on ${shortProject}`
            : (shortLooking
                ? `LINKUP · ${subjName}${clipPhrase(shortLooking, 38)} builders were active while you were away`
                : `LINKUP · Linky misses seeing what you’re building`),
          headline: shortGoal
            ? `${nameHey}${daysFloor} days quiet — how is "${shortGoal}" going?`
            : `${nameHey}it’s been ${daysFloor} days since you plugged in`,
          body: sadBody,
          ctaLabel: lookingFor ? `Review ${clipPhrase(lookingFor, 26)} matches` : 'Plug Linky back in',
          ctaUrl: lookingFor ? '/linky?comeback=sad' : '/ship?comeback=sad',
          pushTitle: 'Linky misses you on LINKUP',
          pushBody: `${namePrefix}it’s been ${daysFloor} days — drop one quick update tonight.`,
        }
      : {
          mood: 'sad_inactive',
          subject: shortGoal
            ? `LINKUP · ${subjName}still pushing toward "${clipPhrase(shortGoal, 40)}"?`
            : 'LINKUP · Your builder seat is getting cold',
          headline: lookingFor
            ? `${nameHey}${shortLooking} builders kept moving while you were away`
            : `${nameHey}builders in your lane kept moving while you were away`,
          body: sadBody,
          ctaLabel: lookingFor ? `See ${clipPhrase(lookingFor, 26)} profiles` : 'Return to LINKUP',
          ctaUrl: lookingFor ? '/linky?comeback=sad' : '/feed',
          pushTitle: 'Your LINKUP seat is waiting',
          pushBody: `${namePrefix}see who joined your lane while you were away.`,
        };
  }

  // 8. Away for 7+ days -> Dusty Cobwebs Linky!
  if (daysSinceActive >= 7) {
    const ghostBody = (goal || lookingFor || project)
      ? `${project ? `Cobwebs are gathering on your ${project} workspace. ` : ''}${goal ? `Whether you’re still chasing "${goal}" or pivoted to a sharper target, ` : 'Whether you pivoted or shipped quietly, '}${lookingFor ? `builders matching what you’re looking for (${lookingFor}) are actively teaming up on LINKUP right now.` : 'one fresh update puts you right back in front of vetted co-founders on LINKUP.'}`
      : (isEveningSlot
          ? 'A lot has changed since you last stopped by — fresh builders, active Builder League standings, and direct search right on the homescreen. Tap back in whenever you have two spare minutes.'
          : 'Whether you pivoted, shipped quietly, or took a breather, one fresh update puts you right back in front of collaborators on LINKUP.');
    return isEveningSlot
      ? {
          mood: 'ghost_abandoned',
          subject: shortProject
            ? `LINKUP · ${subjName}cobwebs are forming on ${shortProject}`
            : 'LINKUP · Cobwebs are forming on your builder workspace',
          headline: shortLooking
            ? `${nameHey}don’t hunt for ${shortLooking} alone — shake off the dust`
            : `${nameHey}shake the dust off your LINKUP profile tonight`,
          body: ghostBody,
          ctaLabel: lookingFor ? `Find ${clipPhrase(lookingFor, 26)} on LINKUP` : 'Brush off the cobwebs',
          ctaUrl: lookingFor ? '/linky?comeback=7d' : '/feed',
          pushTitle: 'Cobwebs on your LINKUP workspace',
          pushBody: `${namePrefix}fresh builders joined your lane — tap to jump back in.`,
        }
      : {
          mood: 'ghost_abandoned',
          subject: shortGoal
            ? `LINKUP · ${subjName}still aiming for "${clipPhrase(shortGoal, 40)}"?`
            : 'LINKUP · Still building? Linky kept your spot warm',
          headline: shortProject
            ? `${nameHey}your ${shortProject} workspace is right where you left it`
            : `${nameHey}your workspace is still right where you left it`,
          body: ghostBody,
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
      subject: shortProject
        ? `LINKUP · ${subjName}calm weekend check-in on ${shortProject}`
        : (shortLooking ? `LINKUP · ${subjName}weekend ${clipPhrase(shortLooking, 36)} scout` : 'LINKUP · Easy weekend builder check-in'),
      headline: shortGoal
        ? `${nameHey}grab a coffee and pick one calm weekend win toward "${shortGoal}"`
        : `${nameHey}grab a coffee and see what builders are tinkering on`,
      body: focusTail || 'Weekends are when the best side-projects and co-founder conversations spark. Browse fresh builders from Search or jot down one calm weekend note in your Workspace.',
      ctaLabel: lookingFor ? `Scout ${clipPhrase(lookingFor, 26)} matches` : 'Explore weekend builders',
      ctaUrl: lookingFor ? '/linky' : '/feed',
      pushTitle: 'LINKUP · Weekend coffee check-in',
      pushBody: `${namePrefix}see what builders are tinkering on this weekend.`,
    };
  }

  // 10. Late evening night-owl vibe
  if (localHour >= 20) {
    return {
      mood: 'night_owl',
      subject: shortGoal
        ? `LINKUP · ${subjName}late-night check-in on "${clipPhrase(shortGoal, 40)}"`
        : 'LINKUP · Late-night builder check-in from Linky',
      headline: shortProject
        ? `${nameHey}before you close ${shortProject} for the night, log today’s win`
        : `${nameHey}quiet hours are where real builders pull ahead`,
      body: focusTail || 'Before you close your tabs for the night, log what moved forward today or bookmark one sharp collaborator from LINKUP Search.',
      ctaLabel: 'Log tonight’s progress',
      ctaUrl: '/ship',
      pushTitle: 'LINKUP · Night-owl builder check-in',
      pushBody: `${namePrefix}drop one quick note on today’s progress before wrapping up.`,
    };
  }

  // 11. Default energized yellow plugged-in Linky — tailored to their exact goals & what they are looking for!
  if (goal || lookingFor || project) {
    const personalizedMorning = [
      {
        subject: shortGoal
          ? `LINKUP · ${subjName}today’s 1 move toward "${clipPhrase(shortGoal, 42)}"`
          : `LINKUP · ${subjName}what moves ${shortProject || 'your build'} forward today?`,
        headline: shortGoal
          ? `${nameHey}what’s the #1 step moving${shortProject ? ` ${shortProject}` : ''} closer to "${shortGoal}" today?`
          : `${nameHey}let’s push ${shortProject || 'your startup'} forward${shortLooking ? ` & find ${shortLooking}` : ''}`,
        body: focusTail,
        ctaLabel: openStep ? `Tackle: ${clipPhrase(openStep, 28)}` : (shortProject ? `Advance ${shortProject}` : 'Start today’s move on LINKUP'),
        ctaUrl: '/builder',
        pushTitle: shortGoal ? `Today’s move: ${clipPhrase(shortGoal, 36)}` : 'LINKUP · What’s today’s move?',
        pushBody: `${namePrefix}${shortGoal ? `log 1 concrete step toward "${clipPhrase(shortGoal, 42)}".` : 'plug in for 2 minutes and set today’s builder momentum.'}`,
      },
      {
        subject: shortLooking
          ? `LINKUP · ${subjName}vetted ${clipPhrase(shortLooking, 38)} builders are active today`
          : `LINKUP · ${subjName}put ${shortProject || 'your goal'} in front of active co-founders`,
        headline: shortLooking
          ? `${nameHey}don’t build${shortProject ? ` ${shortProject}` : ''} alone — scout ${shortLooking} today`
          : `${nameHey}builders who match "${shortGoal || shortProject}" are active right now`,
        body: focusTail,
        ctaLabel: shortLooking ? `Find ${clipPhrase(shortLooking, 26)} matches` : 'Open LINKUP',
        ctaUrl: shortLooking ? '/linky' : '/feed',
        pushTitle: shortLooking ? `${clipPhrase(shortLooking, 34)} active on LINKUP` : 'Fresh builders active on LINKUP',
        pushBody: `${namePrefix}${shortLooking ? `review compatible ${clipPhrase(shortLooking, 34)} profiles today.` : 'see who is shipping in your lane today.'}`,
      },
    ];

    const personalizedEvening = [
      {
        subject: shortGoal
          ? `LINKUP · ${subjName}60s check-in on "${clipPhrase(shortGoal, 42)}"`
          : `LINKUP · ${subjName}put today’s ${shortProject || 'build'} progress on the board`,
        headline: shortGoal
          ? `${nameHey}did "${shortGoal}" move an inch forward today?`
          : `${nameHey}don’t let today’s work${shortProject ? ` on ${shortProject}` : ''} stay invisible`,
        body: focusTail,
        ctaLabel: shortProject ? `Log today’s ${clipPhrase(shortProject, 22)} progress` : 'Post a 60-second Ship Log',
        ctaUrl: '/ship',
        pushTitle: shortProject ? `Log today’s ${shortProject} win` : 'Put today’s build on LINKUP',
        pushBody: `${namePrefix}60 seconds in Ship Log turns today’s work into visible co-founder proof.`,
      },
      {
        subject: shortLooking
          ? `LINKUP · ${subjName}who can cover ${clipPhrase(shortLooking, 36)} with you this week?`
          : `LINKUP · ${subjName}who could unblock "${clipPhrase(shortGoal || shortProject, 38)}" faster?`,
        headline: shortLooking
          ? `${nameHey}let Linky pull ${shortLooking} matches${shortProject ? ` for ${shortProject}` : ''}`
          : `${nameHey}who could help you hit "${shortGoal || shortProject}" twice as fast?`,
        body: focusTail,
        ctaLabel: shortLooking ? `Ask Linky for ${clipPhrase(shortLooking, 22)}` : 'Find a co-founder on LINKUP',
        ctaUrl: '/linky',
        pushTitle: 'LINKUP · Tailored co-founder pulse',
        pushBody: `${namePrefix}${shortLooking ? `let Linky surface ${clipPhrase(shortLooking, 32)} matches.` : 'check new builder matches or log today’s step.'}`,
      },
    ];

    return {
      mood: 'default',
      ...pick(isEveningSlot ? personalizedEvening : personalizedMorning),
    };
  }

  const morningOptions = [
    {
      subject: 'LINKUP · What’s the one thing you’re shipping today?',
      headline: `${nameHey}Linky is plugged in — what’s today’s main move?`,
      body: focusTail || 'Pick one concrete deliverable today, search for a collaborator right from the homescreen, or check who climbed the Builder League overnight.',
      ctaLabel: 'Start today’s move on LINKUP',
      ctaUrl: '/builder',
      pushTitle: 'LINKUP · What’s today’s move?',
      pushBody: `${namePrefix}plug in for 2 minutes and set today’s builder momentum.`,
    },
    {
      subject: 'LINKUP · Fresh founders & builders are active right now',
      headline: `${nameHey}new proof just hit the LINKUP feed`,
      body: focusTail || 'Builders who show up daily get spotted first for paid projects, co-founder roles, and warm intros. Jump in and make one visible move.',
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
      body: focusTail || 'Even a two-line Ship Log update compounds your proof on LINKUP and keeps your Builder League momentum climbing.',
      ctaLabel: 'Post a 60-second Ship Log',
      ctaUrl: '/ship',
      pushTitle: 'Put today’s build on LINKUP',
      pushBody: `${namePrefix}60 seconds in Ship Log turns today’s work into visible proof.`,
    },
    {
      subject: 'LINKUP · Quick afternoon pulse from Linky ⚡',
      headline: `${nameHey}who could unblock your build faster this week?`,
      body: focusTail || 'Use the homescreen search or ask Linky for a cited builder match — the right engineer, designer, or founder might already be online.',
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

    const [stateSnap, contribSnap, emailPrefSnap, ventureSnap] = await Promise.all([
      db.collection('builderStates').doc(uid).get().catch(() => null),
      db.collection('builderContributions').doc(uid).get().catch(() => null),
      db.collection('emailPrefs').doc(uid).get().catch(() => null),
      db.collection('ventureProfiles').doc(uid).get().catch(() => null),
    ]);
    const state = stateSnap?.exists ? stateSnap.data() || {} : {};
    const contrib = contribSnap?.exists ? contribSnap.data() || {} : {};
    const emailPref = emailPrefSnap?.exists ? emailPrefSnap.data() || {} : {};
    const venture = ventureSnap?.exists ? ventureSnap.data() || {} : {};
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
    const personal = buildPersonalBuilderBrief({ user: u, state, venture });

    const copy = selectExpressivePulse({
      firstName: personal.firstName || firstName,
      slot: due.slot,
      localHour,
      localWeekday,
      daysSinceActive,
      streakDays,
      shippedToday,
      unreadCount,
      isLeagueTop3,
      seedByte: due.seedByte,
      personal,
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

    // 3. Expressive Full-Bleed Email: STRICTLY 1 EMAIL PER DAY at a random local minute!
    let emailSent = false;
    const alreadyEmailedToday =
      Boolean(pulseState.emailSentToday) ||
      String(emailPref.lastEmailDay || '') === localDateKey;
    const shouldSendDailyEmailNow =
      !alreadyEmailedToday &&
      (due.slot === due.schedule.emailSlot || due.slot === 'pulse2');

    if (prefs.emailDaily !== false && shouldSendDailyEmailNow) {
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
          personal,
        },
        { ...emailOpts, now: nowMs },
      ).catch(() => ({ sent: false }));
      emailSent = Boolean(eRes?.sent);
      if (emailSent) {
        await pulseDocRef.set(
          { emailSentToday: true, emailSentSlot: due.slot, updatedAt: nowMs },
          { merge: true },
        ).catch(() => null);
      }
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
