import crypto from 'node:crypto';
import { DAY, id, clean, problem, validId, safeLink, stateOf, localTime } from './_builderCore.js';
import { CONTRIBUTION_POINTS, CONTRIBUTION_HISTORY_DAYS, contributionDay, contributionInsight } from '../shared/contributions.js';
import { habitSnapshot, habitState } from '../shared/build-habit.js';
import { publicEligible, projectProfile, profileUrl } from './_publicSeo.js';

const APP_ORIGIN = 'https://www.linkupbuild.com';
const API_ORIGIN = 'https://www.linkupbuild.com/api/linky';
const LINKY_AVATAR = 'https://www.linkupbuild.com/app/icons/linky-avatar.png';
const PLATFORM_BRIDGE_ALLOCATION_BPS = 250; // 2.50% automated Venture Bridge scout/platform allocation memo

// Capability lanes Linky inspects when reading project manifests & file trees
const LANE_CATALOG = {
  frontend: {
    label: 'Frontend & Web UI',
    role: 'Frontend / Product UI Engineer',
    markers: ['react', 'react-dom', 'next', 'vite', 'vue', 'svelte', 'astro', 'tailwindcss', 'shadcn', 'radix', 'framer-motion', 'tsx', 'jsx', 'css', 'html'],
    profileSkills: ['react', 'typescript', 'javascript', 'next.js', 'frontend', 'tailwind', 'vue', 'web', 'ui'],
  },
  mobile: {
    label: 'Mobile App Engineering',
    role: 'Mobile Engineer (React Native / iOS / Android)',
    markers: ['expo', 'react-native', 'android', 'ios', 'swift', 'kotlin', 'flutter', 'dart', 'pubspec.yaml', 'app.json'],
    profileSkills: ['react native', 'expo', 'ios', 'android', 'mobile', 'flutter', 'swift', 'kotlin'],
  },
  backend: {
    label: 'Backend, APIs & Cloud Infrastructure',
    role: 'Systems & Backend Architect',
    markers: ['express', 'fastify', 'nestjs', 'firebase-admin', 'supabase', 'prisma', 'pg', 'postgres', 'mongodb', 'redis', 'fastapi', 'django', 'flask', 'go.mod', 'cargo.toml', 'dockerfile', 'serverless', 'vercel.json', 'graphql', 'trpc'],
    profileSkills: ['node.js', 'python', 'backend', 'postgres', 'sql', 'go', 'rust', 'aws', 'cloud', 'firebase', 'api', 'devops'],
  },
  ai_data: {
    label: 'AI, Agents & Data Pipelines',
    role: 'AI / ML Engineer',
    markers: ['openai', '@google/genai', 'gemini', 'anthropic', 'langchain', 'llamaindex', 'torch', 'pytorch', 'tensorflow', 'transformers', 'pinecone', 'pgvector', 'numpy', 'pandas'],
    profileSkills: ['ai', 'machine learning', 'llm', 'python', 'agents', 'nlp', 'data science', 'ml'],
  },
  design_ux: {
    label: 'Product Design & Design Systems',
    role: 'Founding Product Designer (UI/UX)',
    markers: ['figma', 'storybook', 'lucide', 'design-tokens', 'lottie', 'svg', 'accessibility'],
    profileSkills: ['design', 'ui/ux', 'figma', 'product design', 'ux', 'branding', 'design systems', 'graphic design'],
  },
  gtm_monetization: {
    label: 'Monetization, Growth & GTM Distribution',
    role: 'Growth, Revenue & GTM Co-Founder',
    markers: ['stripe', 'payonify', 'lemonsqueezy', 'paddle', 'revenuecat', 'posthog', 'mixpanel', 'amplitude', 'resend', 'sendgrid', 'hubspot', 'seo', 'sitemap'],
    profileSkills: ['growth', 'sales', 'marketing', 'gtm', 'distribution', 'partnerships', 'fintech', 'business development', 'operations', 'product'],
  },
};

const TZ_OFFSETS = {
  utc: 0, gmt: 0, london: 0, uk: 0, dublin: 0, lisbon: 0, accra: 0, lagos: 1,
  harare: 2, johannesburg: 2, capetown: 2, cairo: 2, kigali: 2, lusaka: 2, berlin: 1, paris: 1, amsterdam: 1, madrid: 1,
  nairobi: 3, kampala: 3, addis: 3, riyadh: 3, dubai: 4,
  karachi: 5, mumbai: 5.5, bangalore: 5.5, bengaluru: 5.5, delhi: 5.5, india: 5.5,
  singapore: 8, hongkong: 8, manila: 8, perth: 8, tokyo: 9, seoul: 9, sydney: 10, melbourne: 10,
  newyork: -5, nyc: -5, toronto: -5, boston: -5, miami: -5, atlanta: -5,
  chicago: -6, austin: -6, dallas: -6, mexico: -6,
  denver: -7, phoenix: -7,
  sanfrancisco: -8, sf: -8, seattle: -8, losangeles: -8, la: -8, vancouver: -8,
  saopaulo: -3, brazil: -3, buenosaires: -3,
};

function engineSecret() {
  const raw = process.env.LINKY_CRON_SECRET || process.env.FIREBASE_SERVICE_ACCOUNT || 'linkup-venture-engine-v17';
  return crypto.createHash('sha256').update(`venture-engine:${raw}`).digest('hex');
}

export function webhookCredentials(uid) {
  if (!validId(uid)) throw problem('Valid user required.');
  const sig = crypto.createHmac('sha256', engineSecret()).update(`gh-hook:${uid}`).digest('hex').slice(0, 32);
  const secret = crypto.createHmac('sha256', engineSecret()).update(`gh-secret:${uid}`).digest('hex').slice(0, 40);
  const webhookUrl = `${API_ORIGIN}?action=githubWebhook&uid=${encodeURIComponent(uid)}&sig=${sig}`;
  const cursorHook = `curl -fsSL -X POST "${webhookUrl}" -H "Content-Type: application/json" -d "{\\"repository\\":{\\"full_name\\":\\"$(basename $(git rev-parse --show-toplevel))\\"},\\"head_commit\\":{\\"id\\":\\"$(git rev-parse HEAD)\\",\\"timestamp\\":\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\"}}" >/dev/null 2>&1 &`;
  return { sig, secret, webhookUrl, cursorHook };
}

export function verifyWebhookAuth({ uid, sig = '', rawBody = '', githubSignature256 = '' }) {
  if (!validId(uid)) return false;
  const creds = webhookCredentials(uid);
  if (sig && sig.length === creds.sig.length) {
    try {
      if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(creds.sig))) return true;
    } catch {}
  }
  if (githubSignature256 && githubSignature256.startsWith('sha256=') && rawBody) {
    const expected = 'sha256=' + crypto.createHmac('sha256', creds.secret).update(rawBody).digest('hex');
    if (expected.length === githubSignature256.length) {
      try {
        if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(githubSignature256))) return true;
      } catch {}
    }
  }
  return false;
}

export function parseGithubRepoInput(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const urlMatch = raw.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (urlMatch) {
    const owner = urlMatch[1];
    const repo = urlMatch[2].replace(/\.git$/i, '');
    return { owner, repo, fullName: `${owner}/${repo}` };
  }
  const slashMatch = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (slashMatch) {
    const owner = slashMatch[1];
    const repo = slashMatch[2].replace(/\.git$/i, '');
    return { owner, repo, fullName: `${owner}/${repo}` };
  }
  return null;
}

export function parseGithubHandle(input = '') {
  const raw = String(input || '').trim().replace(/^@/, '');
  if (!raw) return '';
  const urlMatch = raw.match(/github\.com\/([A-Za-z0-9-]+)\/?$/i);
  const candidate = urlMatch ? urlMatch[1] : raw;
  return /^[A-Za-z0-9-]{1,39}$/.test(candidate) ? candidate : '';
}

function estimateTzOffset(timezone = '', location = '') {
  const hay = `${timezone} ${location}`.toLowerCase().replace(/[^a-z/]/g, '');
  for (const [key, offset] of Object.entries(TZ_OFFSETS)) {
    if (hay.includes(key)) return offset;
  }
  if (hay.includes('africa/')) return 2;
  if (hay.includes('europe/')) return 1;
  if (hay.includes('america/los') || hay.includes('america/van')) return -8;
  if (hay.includes('america/chi')) return -6;
  if (hay.includes('america/')) return -5;
  if (hay.includes('asia/')) return 5.5;
  return 0;
}

function classifyCommitWindow(commitHoursUtc = []) {
  if (!commitHoursUtc.length) {
    return { label: 'Flexible Async Shipper', peakHourUtc: null };
  }
  const buckets = { morning: 0, daytime: 0, evening: 0, night: 0 };
  const counts = new Map();
  for (const h of commitHoursUtc) {
    if (!Number.isFinite(h)) continue;
    counts.set(h, (counts.get(h) || 0) + 1);
    if (h >= 5 && h < 12) buckets.morning++;
    else if (h >= 12 && h < 18) buckets.daytime++;
    else if (h >= 18 && h < 23) buckets.evening++;
    else buckets.night++;
  }
  const topHour = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 14;
  const topBucket = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0]?.[0] || 'daytime';
  const labels = {
    morning: 'Early-Sprint Builder (05:00–12:00 UTC)',
    daytime: 'Core-Hours Operator (12:00–18:00 UTC)',
    evening: 'Deep-Work Evening Shipper (18:00–23:00 UTC)',
    night: 'Night-Owl Systems Engineer (23:00–05:00 UTC)',
  };
  return { label: labels[topBucket], peakHourUtc: topHour };
}

// Safely reads ONLY project manifest metadata & structural skeleton (never private business logic)
export function analyzeCodebaseSignals({
  repoFullName = '',
  languages = {},
  rootFiles = [],
  packageDeps = [],
  manifestText = '',
  commits = [],
  now = Date.now(),
} = {}) {
  const tokens = new Set();
  const addToken = (t) => {
    const v = String(t || '').trim().toLowerCase();
    if (v) tokens.add(v);
  };
  Object.keys(languages || {}).forEach(addToken);
  (rootFiles || []).forEach(addToken);
  (packageDeps || []).forEach(addToken);

  if (manifestText) {
    const cleanManifest = String(manifestText).slice(0, 12000);
    try {
      const parsed = JSON.parse(cleanManifest);
      Object.keys(parsed.dependencies || {}).forEach(addToken);
      Object.keys(parsed.devDependencies || {}).forEach(addToken);
      if (parsed.expo) addToken('expo');
      if (parsed.scripts?.test) addToken('automated-tests');
    } catch {
      cleanManifest
        .toLowerCase()
        .split(/[\s,:"'[\]{}()>=<~^/\\]+/)
        .filter((x) => x.length >= 2 && x.length <= 40)
        .slice(0, 250)
        .forEach(addToken);
    }
  }

  const hay = [...tokens].join(' ');
  const coveredLanes = [];
  const missingLanes = [];
  const detectedStack = [];

  const stackRules = [
    ['Expo / React Native', /\b(expo|react-native)\b/],
    ['React / Next.js', /\b(react|next)\b/],
    ['TypeScript', /\b(typescript|tsconfig\.json|\.tsx?)\b/],
    ['Node.js', /\b(express|fastify|nestjs|firebase-admin|package\.json)\b/],
    ['Python', /\b(python|fastapi|django|flask|requirements\.txt|pyproject\.toml)\b/],
    ['Go', /\b(go|go\.mod)\b/],
    ['Rust', /\b(rust|cargo\.toml)\b/],
    ['Firebase / Firestore', /\b(firebase|firebase-admin|firestore\.rules)\b/],
    ['Supabase / Postgres', /\b(supabase|prisma|pg|postgres)\b/],
    ['AI / LLM SDKs', /\b(openai|@google\/genai|gemini|anthropic|langchain|torch|transformers)\b/],
    ['Payments & Billing', /\b(stripe|payonify|revenuecat|lemonsqueezy|paddle)\b/],
    ['Automated Tests & CI', /\b(\.github|vitest|jest|playwright|automated-tests|tests)\b/],
  ];
  for (const [label, regex] of stackRules) {
    if (regex.test(hay)) detectedStack.push(label);
  }

  for (const [laneKey, lane] of Object.entries(LANE_CATALOG)) {
    const hitCount = lane.markers.filter((m) => hay.includes(m.toLowerCase())).length;
    if (hitCount > 0) coveredLanes.push(laneKey);
    else missingLanes.push(laneKey);
  }

  // Prioritize the highest-leverage missing co-founder lanes for finishing & monetizing a company
  const priorityOrder = ['gtm_monetization', 'frontend', 'backend', 'mobile', 'design_ux', 'ai_data'];
  const prioritizedMissing = priorityOrder.filter((k) => missingLanes.includes(k));
  if (!prioritizedMissing.length) prioritizedMissing.push('gtm_monetization');

  const missingRoles = prioritizedMissing.slice(0, 3).map((k) => LANE_CATALOG[k].role);
  const missingSkills = [...new Set(prioritizedMissing.slice(0, 3).flatMap((k) => LANE_CATALOG[k].profileSkills.slice(0, 3)))];

  const validCommits = (Array.isArray(commits) ? commits : []).filter((c) => c && c.timestamp);
  const cutoff14d = now - 14 * DAY;
  const recent14d = validCommits.filter((c) => Date.parse(c.timestamp) >= cutoff14d);
  const activeCommitDays = [...new Set(validCommits.map((c) => String(c.timestamp).slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))];
  const commitHours = validCommits
    .map((c) => new Date(c.timestamp).getUTCHours())
    .filter((h) => Number.isFinite(h));
  const windowInfo = classifyCommitWindow(commitHours);

  const hasTestsOrCi = /\b(\.github|vitest|jest|playwright|automated-tests|tests)\b/.test(hay);
  const verifiedHighSpeedEngineer = recent14d.length >= 3 || activeCommitDays.length >= 2 || (detectedStack.length >= 3 && validCommits.length >= 1);

  const cadence = recent14d.length >= 8
    ? 'High-Velocity Daily Shipper'
    : recent14d.length >= 3
      ? 'Consistent Weekly Shipper'
      : detectedStack.length >= 2
        ? 'Architecture-Ready Builder'
        : 'Early Scaffold Stage';

  const coveredSummary = coveredLanes.length
    ? coveredLanes.map((k) => LANE_CATALOG[k].label).join(', ')
    : 'initial project scaffold';
  const primaryGapRole = missingRoles[0] || 'Growth, Revenue & GTM Co-Founder';
  const targetLabel = repoFullName || 'your project manifest';

  const linkyManagerMemo =
    `Linky inspected ${targetLabel} (${detectedStack.slice(0, 4).join(', ') || 'manifest structure'}) without reading private business logic. ` +
    `Your codebase already covers ${coveredSummary}${hasTestsOrCi ? ' with test/CI discipline' : ''}, ` +
    `leaving a clear gap in ${prioritizedMissing.slice(0, 2).map((k) => LANE_CATALOG[k].label).join(' + ')}. ` +
    `Next move: splice you with a verified ${primaryGapRole} to ship and monetize faster.`;

  return {
    repoFullName,
    detectedStack: detectedStack.slice(0, 8),
    coveredLanes,
    missingLanes: prioritizedMissing,
    missingRoles,
    missingSkills,
    hasTestsOrCi,
    commitsLast14d: recent14d.length,
    activeCommitDays: activeCommitDays.slice(-60),
    latestCommitAt: validCommits[0]?.timestamp || '',
    latestCommitSha: String(validCommits[0]?.sha || '').slice(0, 12),
    codingStyle: {
      cadence,
      peakWindowUtc: windowInfo.label,
      peakHourUtc: windowInfo.peakHourUtc,
      verifiedHighSpeedEngineer,
    },
    linkyManagerMemo,
    inspectedAt: now,
  };
}

export async function fetchGithubSkeleton({ githubRepo = '', githubHandle = '', fetchFn = globalThis.fetch } = {}) {
  const parsedRepo = parseGithubRepoInput(githubRepo);
  const handle = parseGithubHandle(githubHandle) || parsedRepo?.owner || '';
  if (!parsedRepo && !handle) {
    throw problem('Enter a GitHub repository (owner/repo) or GitHub username first.');
  }
  if (typeof fetchFn !== 'function') {
    throw problem('GitHub inspection is unavailable in this environment.', 503);
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'LINKUP-Venture-Engine/17.0',
  };
  if (process.env.GITHUB_PUBLIC_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_PUBLIC_TOKEN}`;
  }

  const safeJson = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const res = await fetchFn(url, { headers, signal: controller.signal });
      if (!res.ok) return { ok: false, status: res.status, data: null };
      return { ok: true, status: res.status, data: await res.json() };
    } catch {
      return { ok: false, status: 0, data: null };
    } finally {
      clearTimeout(timer);
    }
  };

  let targetRepo = parsedRepo;
  if (!targetRepo && handle) {
    const reposRes = await safeJson(`https://api.github.com/users/${encodeURIComponent(handle)}/repos?sort=pushed&per_page=3`);
    if (reposRes.ok && Array.isArray(reposRes.data) && reposRes.data.length > 0) {
      const top = reposRes.data[0];
      if (top?.owner?.login && top?.name) {
        targetRepo = { owner: top.owner.login, repo: top.name, fullName: `${top.owner.login}/${top.name}` };
      }
    }
  }

  let languages = {};
  let rootFiles = [];
  let manifestText = '';
  const commits = [];
  let repoReachable = false;

  if (targetRepo) {
    const base = `https://api.github.com/repos/${encodeURIComponent(targetRepo.owner)}/${encodeURIComponent(targetRepo.repo)}`;
    const [langRes, contentsRes, commitsRes] = await Promise.all([
      safeJson(`${base}/languages`),
      safeJson(`${base}/contents`),
      safeJson(`${base}/commits?per_page=15`),
    ]);

    if (langRes.ok && langRes.data && typeof langRes.data === 'object') {
      languages = langRes.data;
      repoReachable = true;
    }
    if (contentsRes.ok && Array.isArray(contentsRes.data)) {
      repoReachable = true;
      rootFiles = contentsRes.data.map((item) => String(item?.name || '')).filter(Boolean).slice(0, 60);
      const manifestCandidate = contentsRes.data.find((item) =>
        ['package.json', 'requirements.txt', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pubspec.yaml'].includes(item?.name)
      );
      if (manifestCandidate?.name) {
        const fileRes = await safeJson(`${base}/contents/${encodeURIComponent(manifestCandidate.name)}`);
        if (fileRes.ok && fileRes.data?.content && fileRes.data?.encoding === 'base64') {
          try {
            manifestText = Buffer.from(fileRes.data.content, 'base64').toString('utf8').slice(0, 12000);
          } catch {}
        }
      }
    }
    if (commitsRes.ok && Array.isArray(commitsRes.data)) {
      repoReachable = true;
      for (const item of commitsRes.data) {
        const ts = item?.commit?.author?.date || item?.commit?.committer?.date;
        if (ts) {
          commits.push({
            sha: String(item?.sha || '').slice(0, 12),
            timestamp: ts,
            message: clean(String(item?.commit?.message || '').split('\n')[0], 140),
          });
        }
      }
    }
  }

  if (handle && commits.length === 0) {
    const eventsRes = await safeJson(`https://api.github.com/users/${encodeURIComponent(handle)}/events/public?per_page=20`);
    if (eventsRes.ok && Array.isArray(eventsRes.data)) {
      for (const ev of eventsRes.data) {
        if (ev?.type === 'PushEvent' && ev?.created_at) {
          const sha = ev?.payload?.head || ev?.payload?.commits?.[0]?.sha || ev?.id;
          commits.push({
            sha: String(sha || '').slice(0, 12),
            timestamp: ev.created_at,
            repo: ev?.repo?.name || '',
            message: clean(String(ev?.payload?.commits?.[0]?.message || 'GitHub push event').split('\n')[0], 140),
          });
        }
      }
    }
  }

  return {
    handle,
    repoFullName: targetRepo?.fullName || '',
    repoReachable,
    languages,
    rootFiles,
    manifestText,
    commits,
  };
}

// Automatically credits Builder League + Ship Log + Streak when real code is pushed
export async function recordVerifiedCommitToLeague({
  db,
  uid,
  repoName = 'github-repo',
  commitSha = '',
  commitTimestamp = '',
  commitCount = 1,
  now = Date.now(),
}) {
  if (!validId(uid)) throw problem('Invalid builder uid.', 400);
  const tsMs = commitTimestamp && Number.isFinite(Date.parse(commitTimestamp)) ? Date.parse(commitTimestamp) : now;
  const today = contributionDay(now);
  const pushDay = contributionDay(tsMs);
  // Only count commits pushed today (or within the last 36h window) toward active live momentum
  const eligibleDay = pushDay === today || (now - tsMs >= 0 && now - tsMs <= 36 * 3600 * 1000) ? today : '';
  const shaShort = clean(commitSha || crypto.createHash('sha1').update(`${uid}:${repoName}:${today}`).digest('hex'), 12);
  const cr = db.collection('builderContributions').doc(uid);
  const sr = db.collection('builderStates').doc(uid);
  const ur = db.collection('users').doc(uid);
  const vr = db.collection('ventureProfiles').doc(uid);

  return db.runTransaction(async (tx) => {
    const [cd, sd, ud, vd] = await Promise.all([tx.get(cr), tx.get(sr), tx.get(ur), tx.get(vr)]);
    if (!ud.exists || ud.data()?.deleted || ud.data()?.banned) {
      throw problem('Builder profile is unavailable.', 403);
    }
    const c = cd.exists ? cd.data() : { days: [], updates: [], points: 0, totalUpdates: 0 };
    const v = vd.exists ? vd.data() : {};
    const seenShas = Array.isArray(v.recentCommitShas) ? v.recentCommitShas : [];
    const alreadyRecordedSha = shaShort && seenShas.includes(shaShort);

    let leaguePointsAdded = 0;
    let dayCredited = false;
    let nextContrib = c;

    if (eligibleDay && c.lastDay !== eligibleDay && !(c.days || []).includes(eligibleDay)) {
      const safeRepo = clean(repoName, 80) || 'connected repository';
      const text = clean(
        `Passive GitHub verification: pushed ${Math.max(1, Number(commitCount) || 1)} verified commit${Number(commitCount) === 1 ? '' : 's'} to ${safeRepo} (${shaShort || 'HEAD'}).`,
        180
      );
      const entry = {
        id: id(),
        key: `gh_${eligibleDay}_${shaShort || 'push'}`,
        text,
        link: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(safeRepo) ? `https://github.com/${safeRepo}` : '',
        createdAt: new Date(now).toISOString(),
        day: eligibleDay,
        source: 'github_webhook',
        pointsAwarded: CONTRIBUTION_POINTS,
        insight: contributionInsight(text),
      };
      const cutoff = contributionDay(now - (CONTRIBUTION_HISTORY_DAYS - 1) * DAY);
      const days = [...new Set([...(c.days || []).filter((d) => typeof d === 'string' && d >= cutoff && d <= eligibleDay), eligibleDay])]
        .sort()
        .slice(-CONTRIBUTION_HISTORY_DAYS);
      const githubVerifiedDays = [...new Set([...(c.githubVerifiedDays || []), eligibleDay])].sort().slice(-CONTRIBUTION_HISTORY_DAYS);
      const updates = [entry, ...(c.updates || [])].slice(0, 20);
      const points = (Number(c.points) || 0) + CONTRIBUTION_POINTS;
      const totalUpdates = (Number(c.totalUpdates) || 0) + 1;
      const habit = habitState(c);
      habit.rests = habit.rests.filter((r) => r.day !== eligibleDay);
      const state = stateOf(sd.data(), now);
      state.momentumDays = [...new Set([...state.momentumDays, localTime(now, state.prefs.timezone).day])].slice(-90);
      state.updatedAt = now;
      state.buildReminderCount = 0;

      nextContrib = {
        ...c,
        version: 1,
        days,
        githubVerifiedDays,
        verifiedCommitCount: (Number(c.verifiedCommitCount) || 0) + (alreadyRecordedSha ? 0 : Math.max(1, Number(commitCount) || 1)),
        updates,
        points,
        totalUpdates,
        lastDay: eligibleDay,
        habit,
        publicMomentum: c.publicMomentum === true,
        updatedAt: now,
      };
      tx.set(cr, nextContrib);
      tx.set(sr, state);
      leaguePointsAdded = CONTRIBUTION_POINTS;
      dayCredited = true;
    } else if (!alreadyRecordedSha) {
      const githubVerifiedDays = eligibleDay
        ? [...new Set([...(c.githubVerifiedDays || []), eligibleDay])].sort().slice(-CONTRIBUTION_HISTORY_DAYS)
        : c.githubVerifiedDays || [];
      nextContrib = {
        ...c,
        githubVerifiedDays,
        verifiedCommitCount: (Number(c.verifiedCommitCount) || 0) + Math.max(1, Number(commitCount) || 1),
        updatedAt: now,
      };
      tx.set(cr, nextContrib, { merge: true });
    }

    const updatedShas = shaShort ? [shaShort, ...seenShas.filter((x) => x !== shaShort)].slice(0, 40) : seenShas;
    tx.set(
      vr,
      {
        ...v,
        uid,
        githubVerified: true,
        lastPushAt: now,
        lastPushRepo: clean(repoName, 100),
        lastCommitSha: shaShort,
        recentCommitShas: updatedShas,
        totalVerifiedPushes: (Number(v.totalVerifiedPushes) || 0) + (alreadyRecordedSha ? 0 : 1),
        updatedAt: now,
      },
      { merge: true }
    );

    const snap = habitSnapshot(nextContrib, now, sd.data()?.prefs);
    return {
      ok: true,
      dayCredited,
      leaguePointsAdded,
      totalPoints: Number(nextContrib.points) || 0,
      currentStreak: snap.rhythm?.actualDays || 0,
      verifiedCommitCount: Number(nextContrib.verifiedCommitCount) || 0,
      day: eligibleDay || pushDay,
    };
  });
}

// Algorithmic Splicing Engine: pairs puzzle-piece builders by missing codebase lanes + timezone + verified velocity
export async function spliceComplementaryBuilders({ db, uid, limit = 5, now = Date.now() }) {
  const [meDoc, myStateDoc, myVentureDoc, myContribDoc, blockOut, blockIn] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('builderStates').doc(uid).get(),
    db.collection('ventureProfiles').doc(uid).get(),
    db.collection('builderContributions').doc(uid).get(),
    db.collection('blocks').where('blockedById', '==', uid).get(),
    db.collection('blocks').where('blockedUserId', '==', uid).get(),
  ]);
  if (!meDoc.exists) throw problem('Profile not found.', 404);
  const blockedIds = new Set([
    uid,
    ...blockOut.docs.map((d) => d.data().blockedUserId),
    ...blockIn.docs.map((d) => d.data().blockedById),
  ]);

  const me = meDoc.data() || {};
  const myState = stateOf(myStateDoc.data(), now);
  const myVenture = myVentureDoc.exists ? myVentureDoc.data() : {};
  const diagnosis = myVenture.codeDiagnosis || analyzeCodebaseSignals({
    packageDeps: [...(Array.isArray(me.skills) ? me.skills : []), myState.context?.skills || ''],
    manifestText: `${myState.context?.project || ''} ${myState.context?.needs || ''}`,
    now,
  });

  const myTz = estimateTzOffset(myState.prefs?.timezone || '', `${me.city || ''} ${me.country || ''}`);
  const missingLanes = Array.isArray(diagnosis.missingLanes) && diagnosis.missingLanes.length
    ? diagnosis.missingLanes
    : ['gtm_monetization', 'frontend'];

  const pubSnap = await db.collection('publicProfiles').orderBy('__name__').select().limit(80).get();
  const candidateIds = pubSnap.docs.map((d) => d.id).filter((cid) => !blockedIds.has(cid)).slice(0, 60);
  if (!candidateIds.length) {
    return { diagnosis, matches: [], scanned: 0 };
  }

  const [userDocs, contribDocs, ventureDocs] = await Promise.all([
    db.getAll(...candidateIds.map((cid) => db.collection('users').doc(cid))),
    db.getAll(...candidateIds.map((cid) => db.collection('builderContributions').doc(cid))),
    db.getAll(...candidateIds.map((cid) => db.collection('ventureProfiles').doc(cid))),
  ]);

  const contribByUid = new Map(contribDocs.map((d) => [d.id, d.exists ? d.data() : {}]));
  const ventureByUid = new Map(ventureDocs.map((d) => [d.id, d.exists ? d.data() : {}]));

  const scored = [];
  for (const doc of userDocs) {
    if (!doc.exists || !publicEligible(doc.data(), doc.id)) continue;
    const pub = projectProfile(doc.id, doc.data());
    const c = contribByUid.get(doc.id) || {};
    const v = ventureByUid.get(doc.id) || {};

    const candidateHay = [
      pub.occupation,
      pub.bio,
      ...(pub.skills || []),
      ...(pub.lookingFor || []),
      ...(pub.projects || []).map((p) => `${p.title} ${p.description}`),
      ...(v.codeDiagnosis?.detectedStack || []),
    ]
      .join(' ')
      .toLowerCase();

    // 1. Complementary Gap Score (0–52 pts)
    const filledLanes = [];
    const matchedKeywords = [];
    for (const laneKey of missingLanes) {
      const lane = LANE_CATALOG[laneKey];
      if (!lane) continue;
      const hits = lane.profileSkills.filter((sk) => candidateHay.includes(sk.toLowerCase()));
      const coveredInRepo = Array.isArray(v.codeDiagnosis?.coveredLanes) && v.codeDiagnosis.coveredLanes.includes(laneKey);
      if (hits.length > 0 || coveredInRepo) {
        filledLanes.push(lane);
        matchedKeywords.push(...hits.slice(0, 2));
      }
    }
    const gapScore = Math.min(52, filledLanes.length * 24 + Math.min(8, matchedKeywords.length * 3));

    // 2. Timezone & Rhythm Fit (0–23 pts)
    const theirTz = estimateTzOffset(v.timezone || '', pub.location || '');
    const tzDelta = Math.abs(myTz - theirTz);
    let tzScore = 12;
    let timezoneFit = 'Async global handoff';
    if (tzDelta <= 3) {
      tzScore = 23;
      timezoneFit = `Live pair-shipping window (${tzDelta === 0 ? 'same timezone' : `${tzDelta}h offset`})`;
    } else if (tzDelta <= 6) {
      tzScore = 19;
      timezoneFit = `Half-day overlap (${tzDelta}h offset)`;
    } else if (tzDelta <= 9) {
      tzScore = 16;
      timezoneFit = `24-hour relay build cycle (${tzDelta}h offset)`;
    }

    // 3. Verified Shipping Velocity (0–24 pts)
    const activeDays = Array.isArray(c.days) ? c.days.length : 0;
    const verifiedCommits = Number(c.verifiedCommitCount) || 0;
    const shippedProjects = Array.isArray(pub.projects) ? pub.projects.length : 0;
    const velocityScore = Math.min(
      24,
      Math.min(12, activeDays * 2) + (v.githubVerified ? 6 : 0) + Math.min(6, shippedProjects * 3 + Math.min(3, verifiedCommits))
    );

    const puzzleScore = Math.max(18, Math.min(99, gapScore + tzScore + velocityScore));
    if (filledLanes.length === 0 && activeDays === 0 && shippedProjects === 0) continue;

    const primaryRoleFilled = filledLanes[0]?.role || pub.occupation || 'Complementary Co-Founder';
    const whyPuzzleFit = [
      filledLanes.length
        ? `Fills your ${filledLanes.map((l) => l.label).slice(0, 2).join(' + ')} gap (${[...new Set(matchedKeywords)].slice(0, 4).join(', ') || 'repo-verified'})`
        : `Brings ${ (pub.skills || []).slice(0, 3).join(', ') || pub.occupation || 'execution depth' }`,
      timezoneFit,
      activeDays > 0
        ? `${activeDays} recorded ship day${activeDays === 1 ? '' : 's'}${v.githubVerified ? ' · GitHub verified' : ''}`
        : shippedProjects > 0
          ? `${shippedProjects} public shipped project${shippedProjects === 1 ? '' : 's'}`
          : 'Public LINKUP builder profile',
    ].join(' · ');

    scored.push({
      uid: doc.id,
      name: pub.name,
      headline: pub.occupation || 'Builder',
      location: pub.location || 'Remote',
      image: pub.image || '',
      verified: !!pub.verified || !!v.githubVerified,
      githubVerified: !!v.githubVerified,
      skills: (pub.skills || []).slice(0, 6),
      puzzleScore,
      fillsRole: primaryRoleFilled,
      filledLanes: filledLanes.map((l) => l.label),
      timezoneFit,
      verifiedShipDays: activeDays,
      whyPuzzleFit,
      profileUrl: profileUrl(doc.id),
    });
  }

  scored.sort((a, b) => b.puzzleScore - a.puzzleScore || b.verifiedShipDays - a.verifiedShipDays || a.name.localeCompare(b.name));
  const myContrib = myContribDoc.exists ? myContribDoc.data() : {};

  return {
    diagnosis,
    myVelocity: {
      shipDays: Array.isArray(myContrib.days) ? myContrib.days.length : 0,
      points: Number(myContrib.points) || 0,
      githubVerified: !!myVenture.githubVerified,
    },
    matches: scored.slice(0, Math.min(8, Math.max(1, Number(limit) || 5))),
    scanned: candidateIds.length,
  };
}

function slugifyVenture(raw) {
  const base = String(raw || 'venture-squad')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || 'venture-squad';
}

// Programmatic Day-1 Infrastructure Provisioning: spins up hosted Launchpad + shared Builder Room + scaffold blueprint
export async function provisionVentureWorkplace({
  db,
  founderUid,
  partnerUid,
  ventureName = '',
  problemStatement = '',
  triggerSource = 'manual_splice',
  now = Date.now(),
}) {
  if (!validId(founderUid) || !validId(partnerUid) || founderUid === partnerUid) {
    throw problem('Choose a valid co-founder to provision a shared venture workplace.');
  }
  const [fDoc, pDoc, b1, b2, fVenture, pVenture, fState] = await Promise.all([
    db.collection('users').doc(founderUid).get(),
    db.collection('users').doc(partnerUid).get(),
    db.collection('blocks').where('blockedById', '==', founderUid).where('blockedUserId', '==', partnerUid).get(),
    db.collection('blocks').where('blockedById', '==', partnerUid).where('blockedUserId', '==', founderUid).get(),
    db.collection('ventureProfiles').doc(founderUid).get(),
    db.collection('ventureProfiles').doc(partnerUid).get(),
    db.collection('builderStates').doc(founderUid).get(),
  ]);
  if (!fDoc.exists || !pDoc.exists || fDoc.data()?.deleted || pDoc.data()?.deleted || fDoc.data()?.banned || pDoc.data()?.banned) {
    throw problem('Both co-founders must have active LINKUP profiles.', 403);
  }
  if (!b1.empty || !b2.empty) {
    throw problem('Cannot provision a workplace with a blocked member.', 403);
  }

  const pairKey = [founderUid, partnerUid].sort().join('_');
  const existingLaunchpad = await db.collection('ventureLaunchpads').where('pairKey', '==', pairKey).limit(1).get();
  if (!existingLaunchpad.empty) {
    const doc = existingLaunchpad.docs[0];
    return { ...doc.data(), id: doc.id, alreadyProvisioned: true };
  }

  const founderName = clean(fDoc.data().displayName || fDoc.data().fullName || fDoc.data().name || 'Founder A', 80);
  const partnerName = clean(pDoc.data().displayName || pDoc.data().fullName || pDoc.data().name || 'Founder B', 80);
  const fDiag = fVenture.exists ? fVenture.data()?.codeDiagnosis : null;
  const pDiag = pVenture.exists ? pVenture.data()?.codeDiagnosis : null;
  const ctxProject = clean(ventureName || fState.data()?.context?.project || '', 80);

  const codename = ctxProject || `${founderName.split(' ')[0]} × ${partnerName.split(' ')[0]} Labs`;
  const slug = `${slugifyVenture(codename)}-${crypto.createHash('sha1').update(pairKey).digest('hex').slice(0, 6)}`;
  const roomId = `venture_${slug.replace(/[^a-z0-9_]/gi, '_')}`.slice(0, 64);

  const founderLane = fDiag?.detectedStack?.slice(0, 3).join(' · ') || clean((fDoc.data().skills || []).slice(0, 3).join(' · '), 80) || 'Product & Core Architecture';
  const partnerLane = fDiag?.missingRoles?.[0] || pDiag?.detectedStack?.slice(0, 3).join(' · ') || clean((pDoc.data().skills || []).slice(0, 3).join(' · '), 80) || 'Complementary Engineering & GTM';

  const launchpadUrl = `${APP_ORIGIN}/app/lvlup?launchpad=${encodeURIComponent(slug)}`;
  const reservedDomain = `${slug}.linkupbuild.com`;
  const sharedWebhook = webhookCredentials(founderUid).webhookUrl;

  const charterText = clean(
    `Day-1 Venture Workplace provisioned by Linky for ${codename}. ` +
      `${founderName} leads ${founderLane}. ${partnerName} leads ${partnerLane}. ` +
      `Live Launchpad: ${launchpadUrl}`,
    480
  );

  const starterFiles = [
    `workspaces/${slug}/README.md`,
    `workspaces/${slug}/package.json`,
    `workspaces/${slug}/.cursorrules`,
    `workspaces/${slug}/SHIP_MILESTONES.md`,
  ];

  const milestones = [
    { id: 'm1', title: 'Connect squad GitHub repository webhook for automatic Builder League velocity tracking', done: !!(fVenture.data()?.githubVerified || pVenture.data()?.githubVerified) },
    { id: 'm2', title: `Ship vertical MVP slice on ${reservedDomain} within 48 hours`, done: false },
    { id: 'm3', title: 'Hit 5+ verified squad ship days to unlock LvlUp Ventures $50K Fast-Track Alert', done: false },
  ];

  const launchpadRecord = {
    slug,
    pairKey,
    roomId,
    name: codename,
    thesis: clean(problemStatement || fState.data()?.context?.goal || `Co-building ${codename} with complementary engineering + GTM execution.`, 240),
    founderIds: [founderUid, partnerUid],
    founders: [
      { uid: founderUid, name: founderName, lane: founderLane },
      { uid: partnerUid, name: partnerName, lane: partnerLane },
    ],
    launchpadUrl,
    reservedDomain,
    sharedFolder: `workspaces/${slug}`,
    starterFiles,
    sharedWebhookUrl: sharedWebhook,
    milestones,
    triggerSource,
    publicShowcase: publicEligible(fDoc.data(), founderUid) && publicEligible(pDoc.data(), partnerUid),
    offerCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const kickoffMsgId = id();
  await db.runTransaction(async (tx) => {
    const roomRef = db.collection('builderRooms').doc(roomId);
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists) {
      tx.set(roomRef, {
        title: `${codename} · Venture Room`,
        description: clean(`Auto-provisioned Day-1 Venture Workplace · ${reservedDomain}`, 240),
        kind: 'group',
        ventureSlug: slug,
        creatorId: founderUid,
        creatorPlus: false,
        ownerId: founderUid,
        adminIds: [founderUid, partnerUid],
        bannedIds: [],
        rules: 'Ship daily via GitHub webhook. Keep customer & revenue proof in shared milestones.',
        photo: '',
        announcementsOnly: false,
        discoverable: false,
        preferences: {},
        memberIds: [founderUid, partnerUid],
        readAt: { [founderUid]: now },
        pinnedMessage: { id: kickoffMsgId, text: charterText, authorId: founderUid, at: now },
        lastMessage: { id: kickoffMsgId, text: charterText, authorId: founderUid, at: now },
        revision: 1,
        recentChanges: [{ id: kickoffMsgId, version: 1 }],
        createdAt: now,
        updatedAt: now,
        archived: false,
      });
      tx.set(roomRef.collection('messages').doc(kickoffMsgId), {
        authorId: founderUid,
        text: charterText,
        at: now,
        reactions: {},
      });
    }
    tx.set(db.collection('ventureLaunchpads').doc(slug), launchpadRecord);
  });

  // Notify partner inside LINKUP Alerts
  await db.collection('notifications').doc(`venture_${slug}_${partnerUid}`).set({
    userId: partnerUid,
    fromId: founderUid,
    fromName: 'Linky',
    fromPic: LINKY_AVATAR,
    type: 'builder',
    category: 'venture_provisioned',
    title: `${codename} workplace is live`,
    body: `${founderName} provisioned your Day-1 Venture Room & Launchpad (${reservedDomain}). Jump in and ship.`,
    content: `${founderName} provisioned your Day-1 Venture Room & Launchpad (${reservedDomain}).`,
    section: 'Groups',
    url: '/builder?section=Groups',
    isRead: false,
    timestamp: new Date(now),
  });

  return { ...launchpadRecord, alreadyProvisioned: false };
}

// Hook called automatically the instant a Linky intro is accepted
export async function autoProvisionOnIntroAccept({ db, introId, accepterUid, now = Date.now() }) {
  if (!validId(introId) || !validId(accepterUid)) return null;
  try {
    const snap = await db.collection('intros').doc(introId).get();
    if (!snap.exists) return null;
    const intro = snap.data() || {};
    if (intro.status !== 'accepted' || !intro.requesterId || !intro.targetId) return null;
    return await provisionVentureWorkplace({
      db,
      founderUid: intro.requesterId,
      partnerUid: intro.targetId,
      problemStatement: clean(intro.need || '', 220),
      triggerSource: 'auto_intro_accept',
      now,
    });
  } catch {
    return null;
  }
}

// Public VC Breakout Velocity Feed & Hosted Venture Launchpad reader (zero private leaks)
export async function serveLvlupBreakouts({ db, limit = 6, launchpadSlug = '', now = Date.now() }) {
  const maxItems = Math.min(12, Math.max(1, Number(limit) || 6));

  let featuredLaunchpad = null;
  if (launchpadSlug && /^[a-z0-9-]{3,60}$/.test(launchpadSlug)) {
    const lpDoc = await db.collection('ventureLaunchpads').doc(launchpadSlug).get();
    if (lpDoc.exists) {
      const lp = lpDoc.data() || {};
      const founderDocs = await db.getAll(...(lp.founderIds || []).map((uid) => db.collection('users').doc(uid)));
      const allPublic = founderDocs.length > 0 && founderDocs.every((d) => d.exists && publicEligible(d.data(), d.id));
      if (allPublic) {
        const contribDocs = await db.getAll(...(lp.founderIds || []).map((uid) => db.collection('builderContributions').doc(uid)));
        const combinedShipDays = contribDocs.reduce((sum, d) => sum + (Array.isArray(d.data()?.days) ? d.data().days.length : 0), 0);
        const combinedVerifiedCommits = contribDocs.reduce((sum, d) => sum + (Number(d.data()?.verifiedCommitCount) || 0), 0);
        featuredLaunchpad = {
          slug: lp.slug,
          name: lp.name,
          thesis: lp.thesis,
          reservedDomain: lp.reservedDomain,
          launchpadUrl: lp.launchpadUrl,
          sharedFolder: lp.sharedFolder,
          starterFiles: lp.starterFiles || [],
          milestones: lp.milestones || [],
          combinedShipDays,
          combinedVerifiedCommits,
          offerCount: Number(lp.offerCount) || 0,
          founders: founderDocs.map((d, idx) => {
            const p = projectProfile(d.id, d.data());
            return {
              uid: d.id,
              name: p.name,
              image: p.image,
              url: profileUrl(d.id),
              lane: lp.founders?.[idx]?.lane || p.occupation || 'Co-Founder',
            };
          }),
          createdAt: lp.createdAt || now,
        };
      }
    }
  }

  // Pull top shipping builders & squads from builderContributions + ventureLaunchpads
  const [contribSnap, launchpadSnap] = await Promise.all([
    db.collection('builderContributions').orderBy('points', 'desc').limit(30).get().catch(() => ({ docs: [] })),
    db.collection('ventureLaunchpads').orderBy('updatedAt', 'desc').limit(15).get().catch(() => ({ docs: [] })),
  ]);

  const breakoutSquads = [];
  const cutoff14d = contributionDay(now - 14 * DAY);

  // 1. Multi-founder provisioned squads first
  for (const doc of launchpadSnap.docs) {
    const lp = doc.data() || {};
    if (!Array.isArray(lp.founderIds) || lp.founderIds.length < 2) continue;
    const founderDocs = await db.getAll(...lp.founderIds.map((uid) => db.collection('users').doc(uid)));
    if (!founderDocs.every((d) => d.exists && publicEligible(d.data(), d.id))) continue;
    const contribDocs = await db.getAll(...lp.founderIds.map((uid) => db.collection('builderContributions').doc(uid)));
    const recent14d = contribDocs.reduce(
      (sum, d) => sum + ((d.data()?.days || []).filter((day) => day >= cutoff14d).length || 0),
      0
    );
    const totalShipDays = contribDocs.reduce((sum, d) => sum + ((d.data()?.days || []).length || 0), 0);
    const verifiedCommits = contribDocs.reduce((sum, d) => sum + (Number(d.data()?.verifiedCommitCount) || 0), 0);
    const velocityScore = Math.min(99, 64 + recent14d * 4 + Math.min(15, verifiedCommits * 2) + 8);

    breakoutSquads.push({
      id: `squad:${lp.slug}`,
      kind: 'squad',
      slug: lp.slug,
      name: lp.name,
      headline: lp.thesis,
      launchpadUrl: lp.launchpadUrl,
      reservedDomain: lp.reservedDomain,
      velocityScore,
      recentShipDays14d: recent14d,
      totalShipDays,
      verifiedCommits,
      githubVerified: verifiedCommits > 0,
      recommendedCheck: '$50,000',
      instrument: 'Post-Money SAFE · LvlUp First-Check Track',
      flashBanner: `${lp.name} is shipping together at top velocity (${Math.max(1, totalShipDays)} verified build days). Click below to send a $50,000 check offer right now.`,
      founders: founderDocs.map((d, idx) => {
        const p = projectProfile(d.id, d.data());
        return {
          uid: d.id,
          name: p.name,
          image: p.image,
          role: lp.founders?.[idx]?.lane || p.occupation || 'Co-Founder',
          url: profileUrl(d.id),
        };
      }),
    });
  }

  // 2. High-velocity solo / lead builders from live Builder League contributions
  const topBuilderIds = contribSnap.docs.map((d) => d.id).slice(0, 24);
  if (topBuilderIds.length) {
    const [uDocs, vDocs] = await Promise.all([
      db.getAll(...topBuilderIds.map((uid) => db.collection('users').doc(uid))),
      db.getAll(...topBuilderIds.map((uid) => db.collection('ventureProfiles').doc(uid))),
    ]);
    const userMap = new Map(uDocs.map((d) => [d.id, d]));
    const ventureMap = new Map(vDocs.map((d) => [d.id, d.exists ? d.data() : {}]));

    for (const cDoc of contribSnap.docs) {
      if (breakoutSquads.length >= maxItems) break;
      const uDoc = userMap.get(cDoc.id);
      if (!uDoc?.exists || !publicEligible(uDoc.data(), cDoc.id)) continue;
      if (breakoutSquads.some((s) => s.founders.some((f) => f.uid === cDoc.id))) continue;

      const c = cDoc.data() || {};
      const v = ventureMap.get(cDoc.id) || {};
      const pub = projectProfile(cDoc.id, uDoc.data());
      const days = Array.isArray(c.days) ? c.days : [];
      const recent14d = days.filter((d) => d >= cutoff14d).length;
      const totalShipDays = days.length;
      if (totalShipDays < 1) continue;

      const verifiedCommits = Number(c.verifiedCommitCount) || 0;
      const velocityScore = Math.min(99, 55 + recent14d * 5 + Math.min(18, totalShipDays * 2) + (v.githubVerified ? 8 : 0));
      const companyTitle = pub.company || pub.projects?.[0]?.title || `${pub.name} Venture`;

      breakoutSquads.push({
        id: `builder:${cDoc.id}`,
        kind: 'builder',
        slug: '',
        name: companyTitle,
        headline: pub.projects?.[0]?.description || pub.bio || pub.occupation || 'High-velocity LINKUP builder',
        launchpadUrl: profileUrl(cDoc.id),
        reservedDomain: '',
        velocityScore,
        recentShipDays14d: recent14d,
        totalShipDays,
        verifiedCommits,
        githubVerified: !!v.githubVerified || verifiedCommits > 0,
        recommendedCheck: '$50,000',
        instrument: 'Post-Money SAFE · LvlUp First-Check Track',
        flashBanner: `${companyTitle} is ranked on Builder League (${totalShipDays} verified ship day${totalShipDays === 1 ? '' : 's'}). Click to dispatch a $50,000 investment offer right now.`,
        founders: [
          {
            uid: cDoc.id,
            name: pub.name,
            image: pub.image,
            role: pub.occupation || 'Founder',
            url: profileUrl(cDoc.id),
          },
        ],
      });
    }
  }

  breakoutSquads.sort((a, b) => b.velocityScore - a.velocityScore || b.totalShipDays - a.totalShipDays);

  return {
    breakouts: breakoutSquads.slice(0, maxItems),
    featuredLaunchpad,
    bridgeTerms: {
      defaultCheckUsd: 50000,
      supportedChecksUsd: [50000, 100000, 250000],
      instrument: 'Standard Post-Money SAFE Term-Sheet Intent',
      platformAllocationBps: PLATFORM_BRIDGE_ALLOCATION_BPS,
      legalNotice:
        'Cryptographically timestamped non-binding SAFE term-sheet dispatch via LINKUP Venture Bridge; closing and any scout/platform fee remain subject to accredited investor verification and definitive legal execution.',
    },
    generatedAt: new Date(now).toISOString(),
  };
}

// Smart-Contract / Digital SAFE Venture Bridge: dispatches a verifiable $50K-$250K VC check intent to top squads
export async function dispatchVcInvestmentOffer({ db, input = {}, ipHash = 'anon', now = Date.now(), push = async () => ({ sent: 0 }) }) {
  const targetId = clean(input.targetId, 100);
  const partnerName = clean(input.partnerName, 80);
  const firmName = clean(input.firmName || 'LvlUp Ventures', 80);
  const partnerEmail = clean(input.partnerEmail, 120).toLowerCase();
  const note = clean(input.note || '', 500);
  const checkUsd = [50000, 100000, 250000].includes(Number(input.checkUsd)) ? Number(input.checkUsd) : 50000;
  const valuationCapUsd = Math.max(1000000, Math.min(50000000, Number(input.valuationCapUsd) || 5000000));

  if (!targetId || !/^(squad:[a-z0-9-]+|builder:[A-Za-z0-9_-]{2,128})$/.test(targetId)) {
    throw problem('Select a valid breakout squad or builder target.');
  }
  if (partnerName.length < 2) throw problem('Enter the VC partner name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(partnerEmail)) {
    throw problem('Enter a valid partner work email.');
  }

  // Rate limit per IP hash (max 6 offers/hour to prevent spam)
  const rateRef = db.collection('vcBridgeRates').doc(ipHash.slice(0, 48));
  await db.runTransaction(async (tx) => {
    const r = await tx.get(rateRef);
    const windowKey = Math.floor(now / 3600000);
    const count = r.exists && r.data()?.windowKey === windowKey ? Number(r.data().count) || 0 : 0;
    if (count >= 6) throw problem('Deal-dispatch rate limit reached. Try again next hour.', 429);
    tx.set(rateRef, { windowKey, count: count + 1, updatedAt: now });
  });

  let founderIds = [];
  let squadName = 'Breakout Squad';
  let launchpadSlug = '';

  if (targetId.startsWith('squad:')) {
    launchpadSlug = targetId.slice('squad:'.length);
    const lpSnap = await db.collection('ventureLaunchpads').doc(launchpadSlug).get();
    if (!lpSnap.exists) throw problem('Breakout squad launchpad not found.', 404);
    founderIds = (lpSnap.data()?.founderIds || []).filter(validId);
    squadName = clean(lpSnap.data()?.name || 'Breakout Squad', 80);
  } else {
    const builderUid = targetId.slice('builder:'.length);
    const uSnap = await db.collection('users').doc(builderUid).get();
    if (!uSnap.exists || !publicEligible(uSnap.data(), builderUid)) {
      throw problem('Builder is not available for public deal dispatch.', 404);
    }
    founderIds = [builderUid];
    squadName = clean(uSnap.data().company || uSnap.data().displayName || uSnap.data().fullName || 'LINKUP Builder', 80);
  }

  if (!founderIds.length) throw problem('No eligible founders on this squad.', 404);

  const platformFeeUsd = Math.round((checkUsd * PLATFORM_BRIDGE_ALLOCATION_BPS) / 10000);
  const canonicalPayload = JSON.stringify({
    version: 'LINKUP-SAFE-BRIDGE-V1',
    targetId,
    squadName,
    founderIds,
    firmName,
    partnerName,
    partnerEmail,
    checkUsd,
    valuationCapUsd,
    platformAllocationBps: PLATFORM_BRIDGE_ALLOCATION_BPS,
    issuedAtIso: new Date(now).toISOString(),
  });
  const contractHash = '0x' + crypto.createHash('sha256').update(canonicalPayload).digest('hex');
  const offerId = `safe_${contractHash.slice(2, 16)}`;

  await db.collection('vcDealOffers').doc(offerId).set({
    offerId,
    contractHash,
    targetId,
    launchpadSlug,
    squadName,
    founderIds,
    firmName,
    partnerName,
    partnerEmail,
    checkUsd,
    valuationCapUsd,
    platformAllocationBps: PLATFORM_BRIDGE_ALLOCATION_BPS,
    platformFeeMemoUsd: platformFeeUsd,
    note,
    status: 'dispatched_pending_acceptance',
    createdAt: now,
  });

  if (launchpadSlug) {
    const lpRef = db.collection('ventureLaunchpads').doc(launchpadSlug);
    await db.runTransaction(async (tx) => {
      const d = await tx.get(lpRef);
      if (d.exists) {
        tx.set(lpRef, { offerCount: (Number(d.data()?.offerCount) || 0) + 1, updatedAt: now }, { merge: true });
      }
    });
  }

  const checkFormatted = `$${checkUsd.toLocaleString('en-US')}`;
  for (const fUid of founderIds) {
    await db.collection('notifications').doc(`${offerId}_${fUid}`).set({
      userId: fUid,
      fromId: fUid,
      fromName: firmName,
      fromPic: LINKY_AVATAR,
      type: 'builder',
      category: 'vc_offer',
      campaign: 'champion_crown',
      title: `${checkFormatted} Venture Offer Intent from ${firmName}`,
      body: `${partnerName} (${firmName}) dispatched a ${checkFormatted} Post-Money SAFE review offer to ${squadName} (hash ${contractHash.slice(0, 12)}…). Open Workspace to review.`,
      content: `${partnerName} (${firmName}) dispatched a ${checkFormatted} SAFE review offer (${contractHash.slice(0, 12)}…).`,
      section: 'Today',
      url: '/builder?section=Today',
      isRead: false,
      timestamp: new Date(now),
    });
    try {
      await push(fUid, {
        title: `LINKUP · ${checkFormatted} VC Offer from ${firmName}`,
        body: `${partnerName} triggered a fast-track ${checkFormatted} SAFE offer for ${squadName}.`,
        url: '/builder?section=Today',
        campaign: 'champion_crown',
        category: 'vc_offer',
      });
    } catch {}
  }

  return {
    ok: true,
    offerId,
    contractHash,
    squadName,
    firmName,
    checkUsd,
    valuationCapUsd,
    platformAllocationBps: PLATFORM_BRIDGE_ALLOCATION_BPS,
    platformFeeMemoUsd: platformFeeUsd,
    status: 'dispatched_pending_acceptance',
    issuedAt: new Date(now).toISOString(),
  };
}

// Workspace service methods mounted onto api/_builder.js
export function createVentureWorkspaceOps({ db, now = Date.now, fetchFn = globalThis.fetch }) {
  async function status(uid) {
    const [vDoc, cDoc, sDoc, lpSnap, offersSnap] = await Promise.all([
      db.collection('ventureProfiles').doc(uid).get(),
      db.collection('builderContributions').doc(uid).get(),
      db.collection('builderStates').doc(uid).get(),
      db.collection('ventureLaunchpads').where('founderIds', 'array-contains', uid).limit(10).get().catch(() => ({ docs: [] })),
      db.collection('vcDealOffers').where('founderIds', 'array-contains', uid).limit(10).get().catch(() => ({ docs: [] })),
    ]);
    const v = vDoc.exists ? vDoc.data() : {};
    const c = cDoc.exists ? cDoc.data() : {};
    const s = stateOf(sDoc.data(), now());
    const creds = webhookCredentials(uid);

    return {
      githubHandle: v.githubHandle || '',
      githubRepo: v.githubRepo || '',
      githubVerified: !!v.githubVerified,
      lastPushAt: v.lastPushAt || 0,
      lastCommitSha: v.lastCommitSha || '',
      verifiedCommitCount: Number(c.verifiedCommitCount) || 0,
      leaguePoints: Number(c.points) || 0,
      shipDaysCount: Array.isArray(c.days) ? c.days.length : 0,
      webhookUrl: creds.webhookUrl,
      webhookSecret: creds.secret,
      cursorHook: creds.cursorHook,
      codeDiagnosis: v.codeDiagnosis || null,
      timezone: s.prefs?.timezone || 'UTC',
      launchpads: lpSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
      vcOffers: offersSnap.docs
        .map((d) => {
          const o = d.data() || {};
          return {
            offerId: o.offerId || d.id,
            contractHash: o.contractHash,
            firmName: o.firmName,
            partnerName: o.partnerName,
            partnerEmail: o.partnerEmail,
            squadName: o.squadName,
            checkUsd: o.checkUsd,
            valuationCapUsd: o.valuationCapUsd,
            status: o.status,
            createdAt: o.createdAt || 0,
          };
        })
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    };
  }

  async function connectAndAnalyze(uid, input = {}) {
    const githubRepo = clean(input.githubRepo || '', 140);
    const githubHandle = parseGithubHandle(input.githubHandle || '') || parseGithubRepoInput(githubRepo)?.owner || '';
    const manifestJson = typeof input.manifestJson === 'string' ? input.manifestJson.slice(0, 12000) : '';
    const fileTree = Array.isArray(input.fileTree)
      ? input.fileTree.map((x) => clean(x, 80)).filter(Boolean).slice(0, 60)
      : String(input.fileTree || '')
          .split(/[\n,]+/)
          .map((x) => clean(x, 80))
          .filter(Boolean)
          .slice(0, 60);

    let ghData = {
      handle: githubHandle,
      repoFullName: parseGithubRepoInput(githubRepo)?.fullName || '',
      repoReachable: false,
      languages: {},
      rootFiles: [],
      manifestText: '',
      commits: [],
    };

    if (githubRepo || githubHandle) {
      ghData = await fetchGithubSkeleton({ githubRepo, githubHandle, fetchFn });
    } else if (!manifestJson && !fileTree.length) {
      throw problem('Provide a GitHub repo (owner/repo), GitHub handle, or paste your package.json / project files.');
    }

    const codeDiagnosis = analyzeCodebaseSignals({
      repoFullName: ghData.repoFullName || clean(githubRepo, 100) || 'local-workspace',
      languages: ghData.languages,
      rootFiles: [...new Set([...ghData.rootFiles, ...fileTree])],
      manifestText: manifestJson || ghData.manifestText,
      commits: ghData.commits,
      now: now(),
    });

    const stateDoc = await db.collection('builderStates').doc(uid).get();
    const tz = stateOf(stateDoc.data(), now()).prefs?.timezone || 'UTC';

    await db.collection('ventureProfiles').doc(uid).set(
      {
        uid,
        githubHandle: ghData.handle || githubHandle,
        githubRepo: ghData.repoFullName || githubRepo,
        githubVerified: ghData.commits.length > 0 || !!ghData.repoReachable,
        codeDiagnosis,
        timezone: tz,
        updatedAt: now(),
      },
      { merge: true }
    );

    // If a real commit from today was found on GitHub, auto-credit Builder League right away!
    let autoLeagueSync = null;
    if (ghData.commits.length > 0) {
      const latest = ghData.commits[0];
      autoLeagueSync = await recordVerifiedCommitToLeague({
        db,
        uid,
        repoName: ghData.repoFullName || ghData.handle || 'github',
        commitSha: latest.sha,
        commitTimestamp: latest.timestamp,
        commitCount: ghData.commits.length,
        now: now(),
      });
    }

    return {
      ok: true,
      codeDiagnosis,
      githubVerified: ghData.commits.length > 0 || !!ghData.repoReachable,
      autoLeagueSync,
      ...(await status(uid)),
    };
  }

  async function syncGithub(uid) {
    const vDoc = await db.collection('ventureProfiles').doc(uid).get();
    const v = vDoc.exists ? vDoc.data() : {};
    if (!v.githubRepo && !v.githubHandle) {
      throw problem('Connect a GitHub repository or username first.');
    }
    return connectAndAnalyze(uid, { githubRepo: v.githubRepo, githubHandle: v.githubHandle });
  }

  async function splice(uid, input = {}) {
    return spliceComplementaryBuilders({ db, uid, limit: input.limit || 5, now: now() });
  }

  async function autoSpliceAndProvision(uid, input = {}) {
    let partnerUid = clean(input.partnerUid || '', 128);
    if (!partnerUid) {
      const spliced = await spliceComplementaryBuilders({ db, uid, limit: 1, now: now() });
      if (!spliced.matches.length) {
        throw problem('No eligible complementary builder found in the current pool yet.');
      }
      partnerUid = spliced.matches[0].uid;
    }
    const launchpad = await provisionVentureWorkplace({
      db,
      founderUid: uid,
      partnerUid,
      ventureName: input.ventureName || '',
      problemStatement: input.problemStatement || '',
      triggerSource: input.partnerUid ? 'selected_splice' : 'auto_top_splice',
      now: now(),
    });
    return { ok: true, launchpad };
  }

  return { status, connectAndAnalyze, syncGithub, splice, autoSpliceAndProvision };
}
