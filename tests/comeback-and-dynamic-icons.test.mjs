import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DAILY_COMEBACK_EMAIL_CAP,
  DAILY_EMAIL_HARD_CAP,
  buildPersonalBuilderBrief,
  comebackEmailMilestone,
  sanitizeEmailCopy,
  sendComebackEmail,
  sendHighSignalEmail,
  sendLinkyDirectEmail,
  unsubscribeUserEmail,
} from '../api/_emailNotify.js';
import { sanitizePrefs } from '../api/_builderCore.js';
import {
  ICON_VARIANTS,
  ICON_VARIANT_IDS,
  isValidIconMode,
  resolveAttentionAppearance,
} from '../shared/attention-state.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function memoryDb() {
  const store = new Map();
  return {
    store,
    collection(col) {
      return {
        doc(id) {
          const key = `${col}/${id}`;
          return {
            path: key,
            async get() {
              const v = store.get(key);
              return { exists: v !== undefined, data: () => (v ? structuredClone(v) : undefined) };
            },
            async set(data, opts) {
              const prev = opts?.merge && store.has(key) ? store.get(key) : {};
              store.set(key, structuredClone({ ...prev, ...data }));
            },
          };
        },
      };
    },
    async runTransaction(fn) {
      const writes = [];
      const result = await fn({
        async get(ref) {
          const v = store.get(ref.path);
          return { exists: v !== undefined, data: () => (v ? structuredClone(v) : undefined) };
        },
        set(ref, data, opts) {
          writes.push([ref.path, data, opts]);
        },
      });
      for (const [k, data, opts] of writes) {
        const prev = opts?.merge && store.has(k) ? store.get(k) : {};
        store.set(k, structuredClone({ ...prev, ...data }));
      }
      return result;
    },
  };
}

test('Part A: comeback emails enforce milestones (Day 3/7/14/30), sunset at >45d, opt-out, and daily Resend free-tier cap', async () => {
  assert.equal(comebackEmailMilestone(0), null);
  assert.equal(comebackEmailMilestone(2), null);
  assert.equal(comebackEmailMilestone(3), 'day3');
  assert.equal(comebackEmailMilestone(6), 'day3');
  assert.equal(comebackEmailMilestone(7), 'day7');
  assert.equal(comebackEmailMilestone(14), 'day14');
  assert.equal(comebackEmailMilestone(30), 'day30');
  assert.equal(comebackEmailMilestone(45), 'day30');
  assert.equal(comebackEmailMilestone(46), 'sunset');

  const db = memoryDb();
  await db.collection('users').doc('builder1').set({ email: 'builder1@example.com', displayName: 'Tana' });

  const sent = [];
  const env = { RESEND_API_KEY: 're_live_mock', EMAIL_FROM: 'LINKUP <notifications@linkupbuild.com>' };
  const fetcher = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200 };
  };
  const now = Date.parse('2026-11-01T10:00:00Z');
  const lastActive = Date.parse('2026-10-28T10:00:00Z');

  // Opt-out in workspace prefs blocks comeback emails
  const optedOut = await sendComebackEmail(
    db,
    'builder1',
    { daysSinceActive: 4, lastActiveAt: lastActive, prefs: { welcomeBack: false } },
    { env, fetcher, now },
  );
  assert.equal(optedOut.sent, false);
  assert.equal(optedOut.reason, 'welcome_back_opted_out');

  // Day 3 milestone sends once, then deduplicates on Day 5 in same inactivity stretch
  const d3 = await sendComebackEmail(
    db,
    'builder1',
    { daysSinceActive: 4, lastActiveAt: lastActive, headline: 'Your LinkUp seat is warm', prefs: { welcomeBack: true } },
    { env, fetcher, now },
  );
  assert.equal(d3.sent, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /LINKUP · Your LinkUp seat is warm/);
  assert.ok(sent[0].headers['List-Unsubscribe']);

  const d5Dup = await sendComebackEmail(
    db,
    'builder1',
    { daysSinceActive: 5, lastActiveAt: lastActive, headline: 'Still warm', prefs: { welcomeBack: true } },
    { env, fetcher, now },
  );
  assert.equal(d5Dup.sent, false);
  assert.equal(d5Dup.reason, 'duplicate');

  // Day 7 milestone advances (4 days later) and sends once; >45d sunsets automatically
  const d7 = await sendComebackEmail(
    db,
    'builder1',
    { daysSinceActive: 8, lastActiveAt: lastActive, headline: 'Quick LinkUp pulse check', prefs: { welcomeBack: true } },
    { env, fetcher, now: Date.parse('2026-11-05T10:00:00Z') },
  );
  assert.equal(d7.sent, true);

  const sunset = await sendComebackEmail(
    db,
    'builder1',
    { daysSinceActive: 50, lastActiveAt: lastActive, prefs: { welcomeBack: true } },
    { env, fetcher, now },
  );
  assert.equal(sunset.sent, false);
  assert.equal(sunset.reason, 'sunset_inactive');

  // Daily comeback cap leaves room for high-signal transactional emails (League wins)
  const dayKey = '2026-11-01';
  await db.collection('systemJobs').doc(`emailQuota_${dayKey}`).set({
    day: dayKey,
    total: DAILY_COMEBACK_EMAIL_CAP,
    comeback: DAILY_COMEBACK_EMAIL_CAP,
  });
  await db.collection('users').doc('builder2').set({ email: 'builder2@example.com' });

  const cappedComeback = await sendComebackEmail(
    db,
    'builder2',
    { daysSinceActive: 4, lastActiveAt: lastActive, prefs: { welcomeBack: true } },
    { env, fetcher, now },
  );
  assert.equal(cappedComeback.sent, false);
  assert.equal(cappedComeback.reason, 'daily_quota_reached');

  // High-signal transactional email (Builder League win) still succeeds within DAILY_EMAIL_HARD_CAP!
  const leagueWin = await sendHighSignalEmail(
    db,
    'builder2',
    { receiptKey: 'win_builder2', throttleMs: 0, subject: 'You won Builder League!' },
    { env, fetcher, now },
  );
  assert.equal(leagueWin.sent, true);
  assert.ok(DAILY_COMEBACK_EMAIL_CAP < DAILY_EMAIL_HARD_CAP);

  // One-click unsubscribe blocks comeback emails too
  await unsubscribeUserEmail(db, 'builder2');
  const unsubCheck = await sendComebackEmail(
    db,
    'builder2',
    { daysSinceActive: 15, lastActiveAt: lastActive, prefs: { welcomeBack: true } },
    { env, fetcher, now: Date.parse('2026-11-02T10:00:00Z') },
  );
  assert.equal(unsubCheck.sent, false);
  assert.equal(unsubCheck.reason, 'unsubscribed');

  // Direct Linky email falls back cleanly to onboarding@resend.dev if custom domain returns 403
  const attempts = [];
  const fallbackRes = await sendLinkyDirectEmail(
    db,
    { to: 'tanakaprince49@gmail.com', headline: 'Linky live check' },
    {
      env: { RESEND_API_KEY: 're_live_mock' },
      fetcher: async (_url, init) => {
        const body = JSON.parse(init.body);
        attempts.push(body.from);
        if (body.from.includes('linkupbuild.com')) {
          return {
            ok: false,
            status: 403,
            json: async () => ({ message: 'The linkupbuild.com domain is not verified.' }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 're_msg_999' }),
        };
      },
    },
  );
  assert.equal(fallbackRes.sent, true);
  assert.equal(fallbackRes.id, 're_msg_999');
  assert.equal(attempts.length, 2);
  assert.match(attempts[1], /onboarding@resend\.dev/);
});

test('Part B: all 11 bundled occasion icon assets, web favicons, and Expo native launcher aliases exist without version churn', () => {
  assert.equal(ICON_VARIANTS.length, 11);
  const expectedIds = [
    'default',
    'angry_1d',
    'sad_inactive',
    'ghost_abandoned',
    'unread_urgent',
    'streak_fire',
    'champion_crown',
    'on_fire_shipped',
    'milestone_party',
    'night_owl',
    'weekend_chill',
  ];
  assert.deepEqual([...ICON_VARIANT_IDS], expectedIds);

  for (const variant of ICON_VARIANTS) {
    assert.equal(isValidIconMode(variant.id), true);
    assert.ok(variant.triggerRule && variant.triggerRule.length > 15, `missing triggerRule on ${variant.id}`);
    assert.equal(sanitizePrefs({ iconMode: variant.id }).iconMode, variant.id);

    const mobileAsset = path.join(root, 'mobile', 'assets', variant.assetFile);
    const webIcon = path.join(root, 'mobile', 'public', 'icons', variant.webIconFile);
    assert.equal(fs.existsSync(mobileAsset), true, `missing mobile asset: ${variant.assetFile}`);
    assert.equal(fs.existsSync(webIcon), true, `missing web favicon: ${variant.webIconFile}`);

    // Verify valid PNG magic header
    const mobileHeader = fs.readFileSync(mobileAsset).subarray(0, 8);
    const webHeader = fs.readFileSync(webIcon).subarray(0, 8);
    assert.deepEqual([...mobileHeader], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.deepEqual([...webHeader], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  assert.equal(sanitizePrefs({ iconMode: 'auto' }).iconMode, 'auto');
  assert.equal(sanitizePrefs({ iconMode: 'classic' }).iconMode, 'classic');
  assert.throws(() => sanitizePrefs({ iconMode: 'nonexistent_variant' }));

  // Check app.json registers plugin and carries Version 17.0.0 / versionCode 46
  const appJson = JSON.parse(fs.readFileSync(path.join(root, 'mobile', 'app.json'), 'utf8')).expo;
  assert.equal(appJson.version, '17.0.0');
  assert.equal(appJson.android.versionCode, 46);
  assert.ok(appJson.plugins.includes('./plugins/withDynamicLauncherIcon'));

  // Verify serverless function count stays strictly <= 12 on Vercel Hobby
  const apiEntrypoints = fs
    .readdirSync(path.join(root, 'api'))
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'));
  assert.ok(apiEntrypoints.length <= 12, `too many Vercel functions: ${apiEntrypoints.length}`);
});

test('Part B: Duolingo-style appearance transitions across 1d angry, 3d sad, 7d cobweb, urgent, celebration occasions and reverts immediately on user action', () => {
  const normalHour = Date.parse('2026-11-03T14:00:00Z');

  // 1a. Not opened for 1–2 days -> angry_1d (Red Angry!)
  const angry1d = resolveAttentionAppearance({
    isAuthenticated: true,
    isForeground: false,
    daysSinceActive: 1,
    nowMs: normalHour,
  });
  assert.equal(angry1d.state, 'inactive');
  assert.equal(angry1d.variant, 'angry_1d');
  assert.match(angry1d.backgroundTitle, /1 day away/);

  // 1b. Inactive 3d -> sad_inactive; Inactive 7d -> ghost_abandoned
  const sad = resolveAttentionAppearance({
    isAuthenticated: true,
    isForeground: false,
    daysSinceActive: 4,
    nowMs: normalHour,
  });
  assert.equal(sad.state, 'inactive');
  assert.equal(sad.variant, 'sad_inactive');
  assert.match(sad.backgroundTitle, /seat is getting cold/);

  const ghost = resolveAttentionAppearance({
    isAuthenticated: true,
    isForeground: false,
    daysSinceActive: 9,
    nowMs: normalHour,
  });
  assert.equal(ghost.state, 'inactive');
  assert.equal(ghost.variant, 'ghost_abandoned');
  assert.match(ghost.backgroundTitle, /dusted off your desk/);

  // Immediate revert the instant user opens/focuses LINKUP!
  const revertedFromInactive = resolveAttentionAppearance({
    isAuthenticated: true,
    isForeground: true,
    daysSinceActive: 9,
    localHour: 14,
    nowMs: normalHour,
  });
  assert.equal(revertedFromInactive.state, 'normal');
  assert.equal(revertedFromInactive.variant, 'default');
  assert.equal(revertedFromInactive.backgroundTitle, null);

  // 2. Urgent unread messages/notifications -> unread_urgent, reverts immediately when read or acknowledged!
  const unreadBg = resolveAttentionAppearance({
    isAuthenticated: true,
    isForeground: false,
    unreadMessages: 2,
    unreadNotifications: 1,
    localHour: 14,
    nowMs: normalHour,
  });
  assert.equal(unreadBg.state, 'urgent');
  assert.equal(unreadBg.variant, 'unread_urgent');
  assert.equal(unreadBg.badgeCount, 3);
  assert.match(unreadBg.backgroundTitle, /\(3\).*Unread message/);

  const afterUserReads = resolveAttentionAppearance({
    isAuthenticated: true,
    isForeground: true,
    unreadMessages: 2,
    unreadNotifications: 1,
    unreadAcknowledged: true,
    userActedRecently: true,
    localHour: 14,
    nowMs: normalHour,
  });
  assert.equal(afterUserReads.state, 'normal');
  assert.equal(afterUserReads.variant, 'default');
  assert.equal(afterUserReads.badgeCount, 0);
  assert.equal(afterUserReads.backgroundTitle, null);

  // 3. Urgent evening streak at risk -> streak_fire, transforms immediately on shipping today's build!
  const streakRisk = resolveAttentionAppearance({
    isAuthenticated: true,
    isForeground: false,
    streakCount: 6,
    todayRecorded: false,
    localHour: 20,
    nowMs: normalHour,
  });
  assert.equal(streakRisk.state, 'urgent');
  assert.equal(streakRisk.variant, 'streak_fire');
  assert.match(streakRisk.backgroundTitle, /6-day build streak/);

  const shippedRegular = resolveAttentionAppearance({
    isAuthenticated: true,
    isForeground: true,
    streakCount: 6,
    todayRecorded: true,
    localHour: 20,
    nowMs: normalHour,
  });
  assert.equal(shippedRegular.state, 'celebration');
  assert.equal(shippedRegular.variant, 'on_fire_shipped');
  assert.equal(shippedRegular.backgroundTitle, null);

  // 4. Milestone streak day (Day 7) -> milestone_party!
  const milestone = resolveAttentionAppearance({
    isAuthenticated: true,
    isForeground: true,
    streakCount: 7,
    todayRecorded: true,
    localHour: 20,
    nowMs: normalHour,
  });
  assert.equal(milestone.variant, 'milestone_party');

  // 5. League champion -> champion_crown; Protected rest -> weekend_chill; Late night -> night_owl
  assert.equal(
    resolveAttentionAppearance({
      isAuthenticated: true,
      isLeagueChampion: true,
      localHour: 14,
      nowMs: normalHour,
    }).variant,
    'champion_crown',
  );
  assert.equal(
    resolveAttentionAppearance({
      isAuthenticated: true,
      protectedRestToday: true,
      localHour: 11,
      nowMs: normalHour,
    }).variant,
    'weekend_chill',
  );
  assert.equal(
    resolveAttentionAppearance({
      isAuthenticated: true,
      localHour: 23,
      nowMs: normalHour,
    }).variant,
    'night_owl',
  );

  // 6. Classic lock & manual pinned occasion override
  assert.equal(
    resolveAttentionAppearance({
      mode: 'classic',
      isAuthenticated: true,
      isForeground: false,
      daysSinceActive: 10,
      nowMs: normalHour,
    }).variant,
    'default',
  );
  assert.equal(
    resolveAttentionAppearance({
      mode: 'champion_crown',
      isAuthenticated: true,
      localHour: 14,
      nowMs: normalHour,
    }).variant,
    'champion_crown',
  );

  // 7. Navigation layout: Workspace on bottom nav bar, no Search screen (hosted on the public site), Your next move banners removed
  const appSrc = fs.readFileSync(path.join(root, 'mobile', 'App.tsx'), 'utf8');
  assert.match(appSrc, /<Tab\.Screen name="Workspace" component=\{BuilderWorkspaceScreen\}/);
  assert.doesNotMatch(appSrc, /<Tab\.Screen name="Search"/);
  assert.doesNotMatch(appSrc, /<Stack\.Screen name="Search"/);

  const homeSrc = fs.readFileSync(path.join(root, 'mobile', 'src', 'screens', 'DiscoveryDashboardScreen.tsx'), 'utf8');
  assert.doesNotMatch(homeSrc, /Your next move · Build with Linky/);
  const searchLinkSrc = fs.readFileSync(path.join(root, 'mobile', 'src', 'screens', 'ProfileScreen.tsx'), 'utf8');
  assert.match(searchLinkSrc, /https:\/\/www\.linkupbuild\.com\/search\//);

  const linkySrc = fs.readFileSync(path.join(root, 'mobile', 'src', 'screens', 'LinkyHomeScreen.tsx'), 'utf8');
  assert.doesNotMatch(linkySrc, /Your next move · progress & groups/);
});

test('Part D: emails are hyper-personalized to each recipient’s specific project, goals, and what they are looking for', async () => {
  const brief = buildPersonalBuilderBrief({
    user: {
      displayName: 'Tariro Moyo',
      occupation: 'AI Systems Engineer',
      skills: ['TypeScript', 'PyTorch', 'Postgres'],
      city: 'Harare',
      lookingFor: ['Growth & GTM Co-Founder', 'B2B Fintech Sales'],
    },
    state: {
      context: {
        project: 'PayPulse Africa',
        goal: 'Onboard first 30 paying merchants before demo day',
      },
      plan: [
        { id: 'p1', title: 'Done item', done: true },
        { id: 'p2', title: 'Ship automated WhatsApp invoice reminders', done: false },
      ],
    },
    venture: {
      githubRepo: 'tariro/paypulse',
      codeDiagnosis: { missingRoles: ['Growth, Revenue & GTM Co-Founder'] },
    },
  });

  assert.equal(brief.firstName, 'Tariro');
  assert.equal(brief.projectLabel, 'PayPulse Africa');
  assert.equal(brief.goalLabel, 'Onboard first 30 paying merchants before demo day');
  assert.equal(brief.openStep, 'Ship automated WhatsApp invoice reminders');
  assert.match(brief.lookingForLabel, /Growth & GTM Co-Founder/);
  assert.equal(brief.hasPersonalSignals, true);

  // Comeback email automatically pulls user + builderState + ventureProfile and renders tailored focus card
  const db = memoryDb();
  await db.collection('users').doc('tariro').set({
    email: 'tariro@example.com',
    displayName: 'Tariro Moyo',
    city: 'Harare',
    lookingFor: ['Growth & GTM Co-Founder', 'Seed Design Partner'],
  });
  await db.collection('builderStates').doc('tariro').set({
    context: {
      project: 'PayPulse Africa',
      goal: 'Onboard first 30 paying merchants before demo day',
    },
    plan: [{ id: '1', title: 'Launch self-serve onboarding', done: false }],
  });

  const captured = [];
  const res = await sendComebackEmail(
    db,
    'tariro',
    {
      daysSinceActive: 4,
      lastActiveAt: Date.parse('2026-10-28T10:00:00Z'),
      prefs: { welcomeBack: true },
    },
    {
      env: { RESEND_API_KEY: 're_live_mock', EMAIL_FROM: 'LINKUP <notifications@linkupbuild.com>' },
      now: Date.parse('2026-11-01T10:00:00Z'),
      fetcher: async (_url, init) => {
        captured.push(JSON.parse(init.body));
        return { ok: true, status: 200, json: async () => ({ id: 're_pers_1' }) };
      },
    },
  );
  assert.equal(res.sent, true);
  assert.equal(captured.length, 1);
  assert.match(captured[0].subject, /Tariro/);
  assert.match(captured[0].subject, /PayPulse Africa|Onboard first 30/);
  assert.match(captured[0].subject, /jealous|main character/i);
  assert.match(captured[0].html, /Tailored to Tariro&rsquo;s Goals &amp; Search/);
  assert.match(captured[0].html, /PayPulse Africa/);
  assert.match(captured[0].html, /Onboard first 30 paying merchants before demo day/);
  assert.match(captured[0].html, /Launch self-serve onboarding/);
  assert.match(captured[0].html, /Growth &amp; GTM Co-Founder/);
  assert.match(captured[0].html, /jealous/i);
  assert.match(captured[0].html, /main character/i);
  assert.match(captured[0].html, /revolves around you/i);
  assert.doesNotMatch(captured[0].html, /display:flex/);
  assert.doesNotMatch(captured[0].html, /duolingo/i);
  assert.match(captured[0].text, /Building: PayPulse Africa/);
  assert.match(captured[0].text, /Your Goal: Onboard first 30 paying merchants before demo day/);
  assert.match(captured[0].text, /Looking For: Growth & GTM Co-Founder & Seed Design Partner/);
  assert.match(captured[0].text, /jealous/i);
  assert.match(captured[0].text, /main character/i);
});

