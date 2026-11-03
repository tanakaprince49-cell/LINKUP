import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  webhookCredentials,
  verifyWebhookAuth,
  analyzeCodebaseSignals,
  recordVerifiedCommitToLeague,
  spliceComplementaryBuilders,
  provisionVentureWorkplace,
  autoProvisionOnIntroAccept,
  serveLvlupBreakouts,
  dispatchVcInvestmentOffer,
  sweepConnectedGithubCommits,
  createVentureWorkspaceOps,
} from '../api/_ventureEngine.js';
import { createPublicSeoHandler } from '../api/publicSeo.js';
import { habitSnapshot } from '../shared/build-habit.js';

function createMockDb(initial = {}) {
  const store = new Map();
  for (const [col, docs] of Object.entries(initial)) {
    const colMap = new Map();
    for (const [id, val] of Object.entries(docs)) {
      colMap.set(id, structuredClone(val));
    }
    store.set(col, colMap);
  }
  const ensureCol = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };
  const makeDocSnapshot = (colName, id) => {
    const col = ensureCol(colName);
    const exists = col.has(id);
    const val = exists ? structuredClone(col.get(id)) : undefined;
    return {
      id,
      exists,
      data: () => (val ? structuredClone(val) : undefined),
      ref: makeDocRef(colName, id),
    };
  };
  const makeDocRef = (colName, id) => ({
    id,
    _col: colName,
    get: async () => makeDocSnapshot(colName, id),
    set: async (data, opts = {}) => {
      const col = ensureCol(colName);
      if (opts?.merge && col.has(id)) {
        col.set(id, { ...structuredClone(col.get(id)), ...structuredClone(data) });
      } else {
        col.set(id, structuredClone(data));
      }
    },
    delete: async () => {
      ensureCol(colName).delete(id);
    },
    collection: (subName) => makeCollection(`${colName}/${id}/${subName}`),
  });
  const makeQuery = (colName, filters = [], sortField = null, sortDir = 'asc', max = null) => ({
    where: (field, op, value) => makeQuery(colName, [...filters, { field, op, value }], sortField, sortDir, max),
    orderBy: (field, dir = 'asc') => makeQuery(colName, filters, field, dir, max),
    select: () => makeQuery(colName, filters, sortField, sortDir, max),
    limit: (n) => makeQuery(colName, filters, sortField, sortDir, n),
    get: async () => {
      const col = ensureCol(colName);
      let entries = [...col.entries()].map(([id, val]) => ({ id, val: structuredClone(val) }));
      for (const f of filters) {
        entries = entries.filter((e) => {
          const v = e.val?.[f.field];
          if (f.op === '==') return v === f.value;
          if (f.op === 'array-contains') return Array.isArray(v) && v.includes(f.value);
          return true;
        });
      }
      if (sortField) {
        entries.sort((a, b) => {
          const av = sortField === '__name__' ? a.id : a.val?.[sortField] ?? 0;
          const bv = sortField === '__name__' ? b.id : b.val?.[sortField] ?? 0;
          if (av < bv) return sortDir === 'desc' ? 1 : -1;
          if (av > bv) return sortDir === 'desc' ? -1 : 1;
          return 0;
        });
      }
      if (max !== null) entries = entries.slice(0, max);
      const docs = entries.map((e) => ({
        id: e.id,
        exists: true,
        data: () => structuredClone(e.val),
        ref: makeDocRef(colName, e.id),
      }));
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  });
  const makeCollection = (colName) => ({
    doc: (id) => makeDocRef(colName, id),
    where: (field, op, value) => makeQuery(colName, [{ field, op, value }]),
    orderBy: (field, dir = 'asc') => makeQuery(colName, [], field, dir),
  });

  return {
    collection: (name) => makeCollection(name),
    getAll: async (...refs) => {
      const cleanRefs = refs.filter((r) => r && typeof r.get === 'function');
      return Promise.all(cleanRefs.map((r) => r.get()));
    },
    runTransaction: async (fn) => {
      const tx = {
        get: async (target) => target.get(),
        set: (ref, data, opts) => void ref.set(data, opts),
      };
      return fn(tx);
    },
    _dump: (col) => ensureCol(col),
  };
}

test('Linky codebase manager inspects manifests without source theft and diagnoses missing co-founder lanes', () => {
  const now = Date.parse('2026-11-02T19:00:00Z');
  const diag = analyzeCodebaseSignals({
    repoFullName: 'tanaka/agent-api',
    languages: { Python: 48000, Dockerfile: 1200 },
    rootFiles: ['requirements.txt', 'Dockerfile', '.github', 'tests'],
    manifestText: 'fastapi==0.115.0\nopenai==1.52.0\nsupabase==2.9.0\npytest==8.3.0',
    commits: [
      { sha: 'a1b2c3d4e5f6', timestamp: '2026-11-02T20:15:00Z' },
      { sha: 'b2c3d4e5f6a1', timestamp: '2026-11-01T21:05:00Z' },
      { sha: 'c3d4e5f6a1b2', timestamp: '2026-10-31T19:45:00Z' },
    ],
    now,
  });

  assert.ok(diag.detectedStack.includes('Python'));
  assert.ok(diag.detectedStack.includes('AI / LLM SDKs'));
  assert.ok(diag.coveredLanes.includes('backend'));
  assert.ok(diag.coveredLanes.includes('ai_data'));
  assert.ok(diag.missingLanes.includes('gtm_monetization'));
  assert.ok(diag.missingLanes.includes('frontend'));
  assert.equal(diag.codingStyle.verifiedHighSpeedEngineer, true);
  assert.match(diag.codingStyle.peakWindowUtc, /Evening Shipper/);
  assert.match(diag.linkyManagerMemo, /without reading private business logic/);
});

test('Passive GitHub webhook verifies HMAC signature, auto-credits Builder League, and breaks streak when commits stop', async () => {
  const uid = 'founder_alpha';
  const creds = webhookCredentials(uid);
  const rawBody = JSON.stringify({
    repository: { full_name: 'tanaka/linkup-core' },
    head_commit: { id: '9f8e7d6c5b4a', timestamp: '2026-11-02T14:00:00Z' },
  });
  const ghHmac = 'sha256=' + crypto.createHmac('sha256', creds.secret).update(rawBody).digest('hex');

  assert.equal(verifyWebhookAuth({ uid, sig: creds.sig }), true);
  assert.equal(verifyWebhookAuth({ uid, githubSignature256: ghHmac, rawBody }), true);
  assert.equal(verifyWebhookAuth({ uid, sig: 'forged_sig' }), false);

  const db = createMockDb({
    users: { [uid]: { displayName: 'Tanaka Founder', onboarded: true, isVisible: true } },
    builderStates: { [uid]: { prefs: { timezone: 'Africa/Harare' }, momentumDays: [] } },
  });

  const day1 = Date.parse('2026-11-01T12:00:00Z');
  const firstPush = await recordVerifiedCommitToLeague({
    db,
    uid,
    repoName: 'tanaka/linkup-core',
    commitSha: '111122223333',
    commitTimestamp: '2026-11-01T11:55:00Z',
    commitCount: 2,
    now: day1,
  });
  assert.equal(firstPush.dayCredited, true);
  assert.equal(firstPush.leaguePointsAdded, 10);
  assert.equal(firstPush.totalPoints, 10);

  // Second push on the same UTC day increments commit count without double-minting daily League points
  const sameDayPush = await recordVerifiedCommitToLeague({
    db,
    uid,
    repoName: 'tanaka/linkup-core',
    commitSha: '444455556666',
    commitTimestamp: '2026-11-01T16:10:00Z',
    commitCount: 1,
    now: day1 + 4 * 3600 * 1000,
  });
  assert.equal(sameDayPush.dayCredited, false);
  assert.equal(sameDayPush.totalPoints, 10);
  assert.equal(sameDayPush.verifiedCommitCount, 3);

  // Next consecutive day push raises Builder League points to 20 and streak to 2
  const day2 = Date.parse('2026-11-02T12:00:00Z');
  const nextDayPush = await recordVerifiedCommitToLeague({
    db,
    uid,
    repoName: 'tanaka/linkup-core',
    commitSha: '777788889999',
    commitTimestamp: '2026-11-02T11:50:00Z',
    commitCount: 1,
    now: day2,
  });
  assert.equal(nextDayPush.dayCredited, true);
  assert.equal(nextDayPush.totalPoints, 20);
  assert.equal(nextDayPush.currentStreak, 2);

  // Fast-forward 3 days with ZERO commits -> streak automatically breaks to 0!
  const contribData = (await db.collection('builderContributions').doc(uid).get()).data();
  const brokenSnap = habitSnapshot(contribData, day2 + 3 * 86400000, { timezone: 'Africa/Harare' });
  assert.equal(brokenSnap.rhythm.actualDays, 0);
});

test('Algorithmic Splicing Engine ranks puzzle-piece co-founders above same-skill clones and respects blocks', async () => {
  const now = Date.parse('2026-11-02T15:00:00Z');
  const db = createMockDb({
    users: {
      alice: { displayName: 'Alice Backend', city: 'Harare', country: 'Zimbabwe', skills: ['Python', 'Postgres', 'FastAPI'], onboarded: true, isVisible: true },
      tariro: { displayName: 'Tariro Growth UI', occupation: 'Growth & Frontend Co-Founder', bio: 'Scaling SaaS distribution and React web apps.', city: 'Harare', country: 'Zimbabwe', skills: ['Growth', 'Sales', 'React', 'Figma', 'Marketing'], projects: [{ title: 'PayScale', description: 'B2B growth engine' }], onboarded: true, isVisible: true },
      clone_dev: { displayName: 'Clone Backend', occupation: 'Backend Developer', bio: 'Python APIs.', city: 'San Francisco', country: 'USA', skills: ['Python'], projects: [{ title: 'Script', description: 'CLI' }], onboarded: true, isVisible: true },
      blocked_user: { displayName: 'Blocked GTM', occupation: 'Growth Lead', skills: ['Growth', 'Sales', 'React'], onboarded: true, isVisible: true },
    },
    publicProfiles: {
      tariro: {},
      clone_dev: {},
      blocked_user: {},
    },
    blocks: {
      b1: { blockedById: 'alice', blockedUserId: 'blocked_user' },
    },
    builderStates: {
      alice: { prefs: { timezone: 'Africa/Harare' } },
    },
    ventureProfiles: {
      alice: {
        githubVerified: true,
        codeDiagnosis: analyzeCodebaseSignals({
          repoFullName: 'alice/core-engine',
          languages: { Python: 30000 },
          manifestText: 'fastapi\nsupabase',
          commits: [{ sha: 'abc12345', timestamp: '2026-11-02T10:00:00Z' }],
          now,
        }),
      },
      tariro: { githubVerified: true, timezone: 'Africa/Harare' },
    },
    builderContributions: {
      tariro: { days: ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'], points: 40, verifiedCommitCount: 6 },
      clone_dev: { days: ['2026-11-01'], points: 10 },
    },
  });

  const spliced = await spliceComplementaryBuilders({ db, uid: 'alice', limit: 5, now });
  assert.ok(spliced.matches.length >= 2);
  assert.equal(spliced.matches.some((m) => m.uid === 'blocked_user'), false);
  assert.equal(spliced.matches[0].uid, 'tariro');
  assert.ok(spliced.matches[0].puzzleScore > spliced.matches[1].puzzleScore);
  assert.match(spliced.matches[0].whyPuzzleFit, /Fills your/);
});

test('Programmatic Workplace Provisioning spins up shared Builder Room, Launchpad domain, and auto-triggers on intro accept', async () => {
  const now = Date.parse('2026-11-02T16:00:00Z');
  const db = createMockDb({
    users: {
      alice: { displayName: 'Alice Chikwanda', skills: ['Python', 'AI'], onboarded: true, isVisible: true, email: 'alice@private.example' },
      tariro: { displayName: 'Tariro Moyo', skills: ['Growth', 'React'], onboarded: true, isVisible: true, email: 'tariro@private.example' },
    },
    publicProfiles: { alice: {}, tariro: {} },
    intros: {
      intro_99: {
        requesterId: 'alice',
        targetId: 'tariro',
        need: 'GTM & React co-founder for PayPulse AI',
        status: 'accepted',
      },
    },
    builderContributions: {
      alice: { days: ['2026-11-01', '2026-11-02'], points: 20, verifiedCommitCount: 4 },
      tariro: { days: ['2026-11-02'], points: 10, verifiedCommitCount: 2 },
    },
  });

  const launchpad = await autoProvisionOnIntroAccept({
    db,
    introId: 'intro_99',
    accepterUid: 'tariro',
    now,
  });

  assert.ok(launchpad);
  assert.match(launchpad.reservedDomain, /\.linkupbuild\.com$/);
  assert.match(launchpad.launchpadUrl, /https:\/\/www\.linkupbuild\.com\/app\/lvlup\?launchpad=/);
  assert.equal(launchpad.founderIds.length, 2);
  assert.equal(launchpad.starterFiles.length, 4);

  const roomSnap = await db.collection('builderRooms').doc(launchpad.roomId).get();
  assert.equal(roomSnap.exists, true);
  assert.deepEqual(roomSnap.data().memberIds, ['alice', 'tariro']);

  // Idempotent on second call for the same co-founder pair
  const replay = await provisionVentureWorkplace({
    db,
    founderUid: 'alice',
    partnerUid: 'tariro',
    now: now + 1000,
  });
  assert.equal(replay.alreadyProvisioned, true);
  assert.equal(replay.slug, launchpad.slug);

  // Public Breakout Velocity feed & Hosted Launchpad endpoint expose zero private fields
  const seoHandler = createPublicSeoHandler(() => db);
  let statusCode = 0;
  let rawJson = '';
  await seoHandler(
    { method: 'GET', query: { mode: 'lvlupBreakouts', launchpad: launchpad.slug } },
    {
      setHeader() {},
      status(code) { statusCode = code; return this; },
      send(body) { rawJson = body; },
      end(body) { if (body !== undefined) rawJson = String(body); },
    }
  );
  assert.equal(statusCode, 200);
  assert.equal(rawJson.includes('private.example'), false);
  const parsed = JSON.parse(rawJson);
  assert.equal(parsed.featuredLaunchpad.slug, launchpad.slug);
  assert.ok(parsed.breakouts.length >= 1);
  assert.match(parsed.breakouts[0].flashBanner, /\$50,000/);

  // VC Partner dispatches a $50,000 Smart-Contract SAFE Offer Intent
  const offer = await dispatchVcInvestmentOffer({
    db,
    input: {
      targetId: `squad:${launchpad.slug}`,
      partnerName: 'Brandon Maier',
      firmName: 'LvlUp Ventures',
      partnerEmail: 'brandon@lvlup.vc',
      checkUsd: 50000,
      valuationCapUsd: 5000000,
    },
    ipHash: 'lvlup_partner_ip',
    now: now + 5000,
  });

  assert.equal(offer.ok, true);
  assert.equal(offer.checkUsd, 50000);
  assert.equal(offer.platformAllocationBps, 250);
  assert.equal(offer.platformFeeMemoUsd, 1250);
  assert.match(offer.contractHash, /^0x[a-f0-9]{64}$/);

  // Both founders receive Gold-Crown notifications in LINKUP
  const aliceNotif = await db.collection('notifications').doc(`${offer.offerId}_alice`).get();
  const tariroNotif = await db.collection('notifications').doc(`${offer.offerId}_tariro`).get();
  assert.equal(aliceNotif.exists, true);
  assert.equal(tariroNotif.exists, true);
  assert.equal(aliceNotif.data().campaign, 'champion_crown');

  // Workspace ventureStatus surfaces the live VC offer & launchpad to the founder
  const ops = createVentureWorkspaceOps({ db, now: () => now + 6000 });
  const wsStatus = await ops.status('alice');
  assert.equal(wsStatus.launchpads.length, 1);
  assert.equal(wsStatus.vcOffers.length, 1);
  assert.equal(wsStatus.vcOffers[0].contractHash, offer.contractHash);
});

test('Linky Codebase Manager & Passive GitHub League records and returns the exact commits Linky looked at', async () => {
  const now = Date.parse('2026-11-03T15:00:00Z');
  const db = createMockDb({
    users: {
      tanaka: { displayName: 'Tanaka Founder', onboarded: true, isVisible: true },
    },
    builderStates: {
      tanaka: { prefs: { timezone: 'Africa/Harare' }, momentumDays: [] },
    },
  });

  const mockFetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/languages')) {
      return { ok: true, status: 200, json: async () => ({ TypeScript: 92000, JavaScript: 18000 }) };
    }
    if (u.endsWith('/contents')) {
      return { ok: true, status: 200, json: async () => [{ name: 'package.json' }, { name: 'tests' }] };
    }
    if (u.endsWith('/contents/package.json')) {
      const b64 = Buffer.from(JSON.stringify({ dependencies: { react: '19.0.0', expo: '57.0.0' } })).toString('base64');
      return { ok: true, status: 200, json: async () => ({ content: b64, encoding: 'base64' }) };
    }
    if (u.includes('/commits?per_page=15')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            sha: 'de59952a1b2c3d4e5f6000111222333444555666',
            html_url: 'https://github.com/tanakaprince49-cell/LINKUP/commit/de59952a1b2c3d4e5f6000111222333444555666',
            author: { login: 'tanakaprince49-cell' },
            commit: {
              message: 'feat(blogs): author-only views & clicks analytics\n\nDetailed body',
              author: { name: 'Tanaka Prince', date: '2026-11-03T14:30:00Z' },
            },
          },
          {
            sha: '78d97cc99887766554433221100ffeeddccbbaa1',
            html_url: 'https://github.com/tanakaprince49-cell/LINKUP/commit/78d97cc99887766554433221100ffeeddccbbaa1',
            author: { login: 'tanakaprince49-cell' },
            commit: {
              message: 'feat(blogs): interactive 16:9 cover cropper',
              author: { name: 'Tanaka Prince', date: '2026-11-02T19:10:00Z' },
            },
          },
        ],
      };
    }
    return { ok: false, status: 404, json: async () => null };
  };

  const ops = createVentureWorkspaceOps({ db, now: () => now, fetchFn: mockFetch });
  const connected = await ops.connectAndAnalyze('tanaka', {
    githubRepo: 'tanakaprince49-cell/LINKUP',
  });

  assert.equal(connected.ok, true);
  assert.equal(connected.inspectedCommits.length, 2);
  assert.equal(connected.inspectedCommits[0].shortSha, 'de59952');
  assert.equal(connected.inspectedCommits[0].message, 'feat(blogs): author-only views & clicks analytics');
  assert.equal(connected.inspectedCommits[0].author, 'tanakaprince49-cell');
  assert.match(connected.inspectedCommits[0].url, /github\.com\/tanakaprince49-cell\/LINKUP\/commit\/de59952/);
  assert.equal(connected.inspectedCommits[0].leagueCredited, true);

  // Passive GitHub / Cursor Webhook push adds its commit into the same inspectedCommits feed
  await recordVerifiedCommitToLeague({
    db,
    uid: 'tanaka',
    repoName: 'tanakaprince49-cell/LINKUP',
    commitSha: '99887766554433221100abcdef1234567890abcd',
    commitMessage: 'chore(engine): ship passive webhook commit preview',
    commitAuthor: 'tanakaprince49-cell',
    commitTimestamp: '2026-11-03T14:55:00Z',
    source: 'passive_webhook',
    now: now + 10000,
  });

  const latestStatus = await ops.status('tanaka');
  assert.equal(latestStatus.inspectedCommits.length, 3);
  assert.equal(latestStatus.inspectedCommits[0].shortSha, '9988776');
  assert.equal(latestStatus.inspectedCommits[0].source, 'passive_webhook');
  assert.equal(latestStatus.inspectedCommits[0].message, 'chore(engine): ship passive webhook commit preview');

  const panelUi = fs.readFileSync(
    new URL('../mobile/src/components/VentureEnginePanel.tsx', import.meta.url),
    'utf8'
  );
  assert.match(panelUi, /Commits Linky Looked At/);
  assert.match(panelUi, /Passive Webhook/);
  assert.match(panelUi, /Auto-Recorded/);
  assert.match(panelUi, /AUTO-RECORDING ON/);
  assert.match(panelUi, /Codebase Scan/);
});

test('Autonomous GitHub Commit Watcher records commits automatically while the builder is offline and honors ETag 304 caching', async () => {
  const day1 = Date.parse('2026-11-02T14:00:00Z');
  const day2 = Date.parse('2026-11-03T16:00:00Z');

  const db = createMockDb({
    users: {
      offline_founder: {
        displayName: 'Offline Founder',
        onboarded: true,
        isVisible: true,
        socialLinks: { github: 'https://github.com/offline-dev/stealth-saas' },
      },
    },
    builderStates: {
      offline_founder: { prefs: { timezone: 'Africa/Harare' }, momentumDays: [] },
    },
  });

  let remoteHeadSha = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
  let remoteHeadMsg = 'chore: initial repo setup';
  let remoteHeadTs = '2026-11-02T13:30:00Z';
  let currentEtag = '"etag-v1"';
  let branchPushEvents = [];

  const mockFetch = async (url, init = {}) => {
    const u = String(url);
    const ifNoneMatch = init?.headers?.['If-None-Match'] || '';
    if (u.endsWith('/languages')) {
      return { ok: true, status: 200, json: async () => ({ TypeScript: 45000 }) };
    }
    if (u.endsWith('/contents')) {
      return { ok: true, status: 200, json: async () => [{ name: 'package.json' }] };
    }
    if (u.endsWith('/contents/package.json')) {
      const b64 = Buffer.from(JSON.stringify({ dependencies: { next: '15.0.0' } })).toString('base64');
      return { ok: true, status: 200, json: async () => ({ content: b64, encoding: 'base64' }) };
    }
    if (u.includes('/commits?per_page=')) {
      if (ifNoneMatch && ifNoneMatch === currentEtag) {
        return { ok: true, status: 304, headers: new Map([['etag', currentEtag]]), json: async () => null };
      }
      return {
        ok: true,
        status: 200,
        headers: new Map([['etag', currentEtag]]),
        json: async () => [
          {
            sha: remoteHeadSha,
            html_url: `https://github.com/offline-dev/stealth-saas/commit/${remoteHeadSha}`,
            author: { login: 'offline-dev' },
            commit: {
              message: remoteHeadMsg,
              author: { name: 'Offline Founder', date: remoteHeadTs },
            },
          },
        ],
      };
    }
    if (u.includes('/events?per_page=')) {
      if (ifNoneMatch && ifNoneMatch === currentEtag) {
        return { ok: true, status: 304, headers: new Map([['etag', currentEtag]]), json: async () => null };
      }
      return {
        ok: true,
        status: 200,
        headers: new Map([['etag', currentEtag]]),
        json: async () => branchPushEvents,
      };
    }
    return { ok: false, status: 404, json: async () => null };
  };

  // Day 1: Auto-discovers the founder's GitHub from their LINKUP profile without them even clicking Connect
  const initialSweep = await sweepConnectedGithubCommits({
    db,
    fetchFn: mockFetch,
    discoverFromProfiles: true,
    write: true,
    now: day1,
  });
  assert.equal(initialSweep.discoveredProfiles, 1);

  // Day 2: Founder is completely offline (not on LINKUP) and pushes 2 commits (1 on main, 1 on feat/billing)
  remoteHeadSha = 'ffff9999eeee8888dddd7777cccc6666bbbb5555';
  remoteHeadMsg = 'feat(api): ship autonomous background sync';
  remoteHeadTs = '2026-11-03T15:50:00Z';
  currentEtag = '"etag-v2"';
  branchPushEvents = [
    {
      type: 'PushEvent',
      created_at: '2026-11-03T15:54:00Z',
      repo: { name: 'offline-dev/stealth-saas' },
      actor: { login: 'offline-dev' },
      payload: {
        commits: [
          {
            sha: '77776666555544443333222211110000abcdef12',
            author: { name: 'Offline Founder' },
            message: 'feat(billing): add Payonify subscription webhook on feature branch',
          },
        ],
      },
    },
  ];

  const pushedCalls = [];
  const mockPush = async (_db, uid, payload) => {
    pushedCalls.push({ uid, ...payload });
    return { sent: 1, tokens: 1 };
  };

  const autoSweep = await sweepConnectedGithubCommits({
    db,
    fetchFn: mockFetch,
    pushFn: mockPush,
    githubToken: 'ghs_test_token',
    discoverFromProfiles: false,
    write: true,
    now: day2,
  });

  assert.equal(autoSweep.ok, true);
  assert.equal(autoSweep.usersWithNewCommits, 1);
  assert.equal(autoSweep.commitsRecorded, 2);
  assert.equal(autoSweep.leagueDaysCredited, 1);
  assert.equal(autoSweep.notificationsSent, 1);

  // Verify Linky sent BOTH an in-app notification AND a native/web push notification!
  assert.equal(pushedCalls.length, 1);
  assert.equal(pushedCalls[0].uid, 'offline_founder');
  assert.equal(pushedCalls[0].url, '/builder?section=Today');
  assert.equal(pushedCalls[0].category, 'shipped');
  assert.match(pushedCalls[0].title, /Linky recorded 2 commits · \+10 League pts/);
  assert.match(pushedCalls[0].body, /7777666 · feat\(billing\): add Payonify subscription webhook/);

  const inAppNotif = await db.collection('notifications').doc('commit_offline_founder_7777666').get();
  assert.equal(inAppNotif.exists, true);
  assert.equal(inAppNotif.data().userId, 'offline_founder');
  assert.equal(inAppNotif.data().fromName, 'Linky');
  assert.equal(inAppNotif.data().type, 'builder');
  assert.equal(inAppNotif.data().category, 'github_commit_recorded');
  assert.equal(inAppNotif.data().isRead, false);
  assert.match(inAppNotif.data().note, /7777666 · feat\(billing\)/);

  // Verify both commits are recorded automatically in Builder League + Commits Linky Looked At
  const ops = createVentureWorkspaceOps({ db, now: () => day2 + 5000, fetchFn: mockFetch });
  const status = await ops.status('offline_founder');
  assert.equal(status.autoWatchActive, true);
  assert.equal(status.leaguePoints, 20); // Day 1 (+10) + Day 2 (+10)
  assert.equal(status.inspectedCommits.length, 3);
  assert.equal(status.inspectedCommits[0].shortSha, '7777666');
  assert.equal(status.inspectedCommits[0].source, 'auto_watcher');
  assert.match(status.inspectedCommits[0].message, /Payonify subscription webhook/);
  assert.equal(status.inspectedCommits[1].shortSha, 'ffff999');
  assert.equal(status.inspectedCommits[1].source, 'auto_watcher');

  // Next 10-minute background tick hits ETag 304 Not Modified -> 0 duplicate commits & 0 duplicate notifications!
  const idleSweep = await sweepConnectedGithubCommits({
    db,
    fetchFn: mockFetch,
    pushFn: mockPush,
    write: true,
    now: day2 + 600000,
  });
  assert.equal(idleSweep.notModified, 1);
  assert.equal(idleSweep.commitsRecorded, 0);
  assert.equal(idleSweep.notificationsSent, 0);
  assert.equal(pushedCalls.length, 1);
});
