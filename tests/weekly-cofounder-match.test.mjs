import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assignWeeklyCofounderPairs,
  cofounderWeekWindow,
  scoreMutualCofounderPair,
  selectWeeklyCofounderForViewer,
} from '../shared/linkup-match.js';
import {
  expressWeeklyCofounderInterest,
  getOrAssignWeeklyCofounder,
  runWeeklyCofounderCron,
} from '../api/_weeklyCofounder.js';

const root = process.cwd();

function memoryDb() {
  const store = new Map();
  const docKey = (col, id) => `${col}/${id}`;
  const getDocRef = (col, id) => ({
    id,
    async get() {
      const k = docKey(col, id);
      const val = store.get(k);
      return {
        id,
        exists: val !== undefined,
        data: () => (val ? structuredClone(val) : undefined),
      };
    },
    async set(data, opts = {}) {
      const k = docKey(col, id);
      if (opts?.merge && store.has(k)) {
        store.set(k, { ...store.get(k), ...structuredClone(data) });
      } else {
        store.set(k, structuredClone(data));
      }
    },
  });

  return {
    store,
    collection(col) {
      return {
        doc(id) {
          return getDocRef(col, id);
        },
        limit() {
          return {
            async get() {
              const docs = [];
              for (const [k, v] of store.entries()) {
                if (k.startsWith(`${col}/`)) {
                  const id = k.slice(col.length + 1);
                  docs.push({
                    id,
                    exists: true,
                    data: () => structuredClone(v),
                  });
                }
              }
              return { docs };
            },
          };
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data, opts) {
          return ref.set(data, opts);
        },
      };
      return fn(tx);
    },
  };
}

const PROFILES = [
  {
    uid: 'tariro',
    email: 'tariro@example.com',
    displayName: 'Tariro Moyo',
    username: 'tariro',
    occupation: 'AI & Backend Engineer',
    company: 'PayPulse Africa',
    city: 'Harare',
    country: 'Zimbabwe',
    bio: 'Building instant merchant settlement rails and automated WhatsApp invoicing for African SMEs.',
    goals: 'Launch self-serve onboarding and sign first 50 paying merchants.',
    skills: ['TypeScript', 'Python', 'Postgres', 'Payments', 'Backend', 'AI'],
    industries: ['Fintech', 'Payments', 'B2B SaaS'],
    lookingFor: ['Growth & GTM Co-Founder', 'B2B Sales', 'Operations'],
    startupStage: 'MVP',
    commitmentLevel: 'all in',
    onboarded: true,
    isVisible: true,
  },
  {
    uid: 'kuda',
    email: 'kuda@example.com',
    displayName: 'Kuda Chipo',
    username: 'kuda',
    occupation: 'Growth & GTM Lead',
    company: 'MerchantScale',
    city: 'Harare',
    country: 'Zimbabwe',
    bio: 'Scaled B2B fintech merchant distribution across Southern Africa; looking for a technical co-founder.',
    goals: 'Partner with a strong backend/AI engineer to scale SME payment infrastructure.',
    skills: ['Growth', 'Sales', 'Distribution', 'Partnerships', 'Fintech GTM'],
    industries: ['Fintech', 'Payments', 'B2B SaaS'],
    lookingFor: ['Technical Co-Founder', 'Backend Engineer', 'AI Builder'],
    startupStage: 'MVP',
    commitmentLevel: 'all in',
    onboarded: true,
    isVisible: true,
  },
  {
    uid: 'amara',
    email: 'amara@example.com',
    displayName: 'Amara Okafor',
    username: 'amara',
    occupation: 'Climate Hardware Engineer',
    company: 'SolarGrid',
    city: 'Lagos',
    country: 'Nigeria',
    bio: 'Designing distributed solar microgrid controllers and battery telemetry firmware.',
    goals: 'Deploy 20 pilot microgrids with commercial cold-storage operators.',
    skills: ['Embedded C', 'Hardware', 'IoT', 'Energy Systems'],
    industries: ['Climate', 'Clean Energy', 'Hardware'],
    lookingFor: ['Operations Co-Founder', 'Project Finance', 'Enterprise Sales'],
    startupStage: 'Prototype',
    commitmentLevel: 'all in',
    onboarded: true,
    isVisible: true,
  },
  {
    uid: 'tunde',
    email: 'tunde@example.com',
    displayName: 'Tunde Balogun',
    username: 'tunde',
    occupation: 'Clean Energy Operations & Finance',
    company: 'GridBridge',
    city: 'Lagos',
    country: 'Nigeria',
    bio: 'Structuring commercial solar deployments and enterprise B2B sales across West Africa.',
    goals: 'Co-found a clean-energy hardware + software company with an embedded systems builder.',
    skills: ['Operations', 'Enterprise Sales', 'Project Finance', 'Clean Energy'],
    industries: ['Climate', 'Clean Energy', 'Hardware'],
    lookingFor: ['Hardware Co-Founder', 'Embedded Engineer', 'IoT Builder'],
    startupStage: 'Prototype',
    commitmentLevel: 'all in',
    onboarded: true,
    isVisible: true,
  },
];

test('Opportunity Radar is removed and DiscoveryDashboardScreen shows one weekly potential co-founder below the home hero', () => {
  const dashboardSrc = fs.readFileSync(
    path.join(root, 'mobile', 'src', 'screens', 'DiscoveryDashboardScreen.tsx'),
    'utf8'
  );
  const appSrc = fs.readFileSync(path.join(root, 'mobile', 'App.tsx'), 'utf8');

  // The home hero is a product promise, so it lives in the shared voice module
  // and the weekly person is rendered directly beneath it.
  const voiceSrc = fs.readFileSync(path.join(root, 'mobile', 'src', 'lib', 'brandVoice.ts'), 'utf8');
  assert.match(voiceSrc, /lead: "We've been looking\. And we found some A-PLAYERS\."/);
  // The hero (greeting → A-PLAYERS → bold promise → "Ready to meet your
  // people?") is its own component, rendered directly above the weekly card.
  const heroSrc = fs.readFileSync(path.join(root, 'mobile', 'src', 'components', 'HomeHero.tsx'), 'utf8');
  assert.match(heroSrc, /\{hero\.leadLine1\}/);
  assert.match(heroSrc, /\{hero\.promise\}/);
  assert.match(heroSrc, /\{hero\.cta\}/);
  assert.match(dashboardSrc, /<HomeHero profile=\{me as any\} hasMatch=\{!!weeklyMatch\}/);
  assert.ok(
    dashboardSrc.indexOf('<HomeHero') < dashboardSrc.indexOf('<WeeklyCofounderCard'),
    'the hero sits above the weekly person',
  );
  assert.doesNotMatch(dashboardSrc, /Opportunity Radar/);
  assert.doesNotMatch(dashboardSrc, /Project Matches/);
  assert.doesNotMatch(dashboardSrc, /title="Active Opportunities"/);
  assert.match(dashboardSrc, /1-OF-1 WEEKLY POTENTIAL CO-FOUNDER/);
  assert.match(dashboardSrc, /WeeklyCofounderCard/);
  assert.match(dashboardSrc, /MemberBadges userId=\{item\.uid\}/);
  assert.doesNotMatch(appSrc, /<OpportunityRadar/);
});

test('Weekly co-founder algorithm pairs builders 1-to-1 with strict symmetry and accurate domain/role complementarity', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const window = cofounderWeekWindow(now);
  assert.match(window.key, /^2026-W\d{2}$/);

  const assigned = assignWeeklyCofounderPairs(PROFILES, { now });
  assert.equal(assigned.pairs.length, 2);

  // Tariro (Fintech AI/Backend) <-> Kuda (Fintech Growth/GTM)
  // Amara (Climate Hardware) <-> Tunde (Climate Operations/Finance)
  assert.equal(assigned.byUid.tariro.partnerUid, 'kuda');
  assert.equal(assigned.byUid.kuda.partnerUid, 'tariro');
  assert.equal(assigned.byUid.amara.partnerUid, 'tunde');
  assert.equal(assigned.byUid.tunde.partnerUid, 'amara');

  // Strict symmetry from each viewer's perspective regardless of candidate array order
  for (const viewer of PROFILES) {
    const others = PROFILES.filter((p) => p.uid !== viewer.uid);
    const myMatch = selectWeeklyCofounderForViewer(viewer, others, { now });
    assert.ok(myMatch, `Expected a match for ${viewer.uid}`);
    const partner = PROFILES.find((p) => p.uid === myMatch.partnerUid);
    const partnerOthers = PROFILES.filter((p) => p.uid !== partner.uid);
    const partnerMatch = selectWeeklyCofounderForViewer(partner, partnerOthers, { now });
    assert.equal(
      partnerMatch?.partnerUid,
      viewer.uid,
      `Symmetry violated: ${viewer.uid} got ${partner.uid}, but ${partner.uid} got ${partnerMatch?.partnerUid}`
    );
  }

  // Ineligible / stealth / deleted profiles are never matched
  const badCheck = scoreMutualCofounderPair(PROFILES[0], { ...PROFILES[1], isStealthMode: true }, { now });
  assert.equal(badCheck.eligible, false);
});

test('Server weekly co-founder flow locks symmetric 1:1 pair, emails both people introducing both profiles, and unlocks meeting when both are interested', async () => {
  const db = memoryDb();
  const now = Date.parse('2026-11-07T12:00:00Z');
  for (const profile of PROFILES) {
    await db.collection('users').doc(profile.uid).set(profile);
    await db.collection('publicProfiles').doc(profile.uid).set(profile);
  }

  const capturedEmails = [];
  const fakeFetcher = async (_url, init) => {
    const payload = JSON.parse(init.body);
    capturedEmails.push(payload);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: `email_${capturedEmails.length}` }),
    };
  };
  const fakeEnv = {
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM_EMAIL: 'Linky <linky@linkupbuild.com>',
  };

  // 1. Tariro loads her weekly co-founder match
  const tariroRes = await getOrAssignWeeklyCofounder(db, 'tariro', {
    now,
    fetcher: fakeFetcher,
    env: fakeEnv,
    aiText: async () =>
      JSON.stringify({
        headline: 'Fintech AI Systems × Merchant GTM Distribution',
        whyForA: 'Kuda brings merchant GTM distribution in Harare while you build the settlement backend.',
        whyForB: 'Tariro builds the AI settlement backend in Harare while you lead merchant GTM.',
        firstSprint: 'Map the first 10 Harare merchant pilot accounts in 20 minutes.',
      }),
  });

  assert.ok(tariroRes.match);
  assert.equal(tariroRes.match.partnerUid, 'kuda');
  assert.equal(tariroRes.match.symmetryVerified, true);
  assert.equal(tariroRes.match.bothEmailsSent, true);

  // 2. When Kuda loads his weekly co-founder match, he is guaranteed to see Tariro
  const kudaRes = await getOrAssignWeeklyCofounder(db, 'kuda', {
    now,
    fetcher: fakeFetcher,
    env: fakeEnv,
  });
  assert.ok(kudaRes.match);
  assert.equal(kudaRes.match.partnerUid, 'tariro');

  // 3. Both Tariro and Kuda received an email introducing BOTH profiles
  assert.equal(capturedEmails.length, 2);
  const emailToTariro = capturedEmails.find((e) => e.to.includes('tariro@example.com'));
  const emailToKuda = capturedEmails.find((e) => e.to.includes('kuda@example.com'));
  assert.ok(emailToTariro);
  assert.ok(emailToKuda);

  assert.match(emailToTariro.subject, /Tariro × Kuda/);
  assert.match(emailToTariro.html, /Tariro Moyo/);
  assert.match(emailToTariro.html, /Kuda Chipo/);
  assert.match(emailToTariro.html, /YOUR PROFILE/);
  assert.match(emailToTariro.html, /YOUR 1-OF-1 POTENTIAL CO-FOUNDER/);
  assert.match(emailToTariro.html, /jealous/i);

  assert.match(emailToKuda.subject, /Kuda × Tariro/);
  assert.match(emailToKuda.html, /Kuda Chipo/);
  assert.match(emailToKuda.html, /Tariro Moyo/);
  assert.match(emailToKuda.html, /YOUR PROFILE/);
  assert.match(emailToKuda.html, /YOUR 1-OF-1 POTENTIAL CO-FOUNDER/);
  assert.match(emailToKuda.html, /jealous/i);

  // 4. Tariro taps Interested -> pending until Kuda also taps Interested
  const interest1 = await expressWeeklyCofounderInterest(
    db,
    'tariro',
    { partnerUid: 'kuda', weekKey: tariroRes.weekKey },
    { now }
  );
  assert.equal(interest1.ok, true);
  assert.equal(interest1.viewerInterested, true);
  assert.equal(interest1.partnerInterested, false);
  assert.equal(interest1.mutualInterest, false);

  // 5. Kuda also taps Interested -> BOTH are interested -> mutual match & direct chat room unlocked!
  const interest2 = await expressWeeklyCofounderInterest(
    db,
    'kuda',
    { partnerUid: 'tariro', weekKey: tariroRes.weekKey },
    { now }
  );
  assert.equal(interest2.ok, true);
  assert.equal(interest2.viewerInterested, true);
  assert.equal(interest2.partnerInterested, true);
  assert.equal(interest2.mutualInterest, true);
  assert.equal(interest2.matchId, 'kuda_tariro');

  const matchSnap = await db.collection('matches').doc('kuda_tariro').get();
  assert.equal(matchSnap.exists, true);
  assert.deepEqual(matchSnap.data().users, ['kuda', 'tariro']);

  // 6. Cron pairs remaining unpaired builders (Amara <-> Tunde) and emails both
  const cronRes = await runWeeklyCofounderCron(db, now, {
    fetcher: fakeFetcher,
    env: fakeEnv,
  });
  assert.equal(cronRes.ok, true);
  assert.equal(cronRes.pairsCreated, 1);
  assert.equal(capturedEmails.length, 4);
});
