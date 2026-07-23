import * as admin from 'firebase-admin';
import { onCall, HttpsError, onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { beforeUserCreated } from 'firebase-functions/v2/identity';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import crypto from 'node:crypto';

if (!admin.apps.length) {
  admin.initializeApp();
}

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
const LINKUP_CORS_ORIGINS: (string | RegExp)[] = [
  'https://linkup-muqu.vercel.app',
  /^https:\/\/linkup-muqu(?:-[a-z0-9-]+)?\.vercel\.app$/,
  /^https:\/\/linkup-muqu-git-[a-z0-9-]+-[a-z0-9-]+\.vercel\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

type CompactProfile = {
  uid: string;
  displayName?: string;
  username?: string;
  occupation?: string;
  company?: string;
  skills?: string[];
  industries?: string[];
  lookingFor?: string[];
  availability?: string;
  commitmentLevel?: string;
  startupStage?: string;
  workStyle?: string;
  ambition?: string;
  ambitionScore?: number;
  communicationStyle?: string;
  personalityType?: string;
  personalityAnswers?: Record<string, string>;
  roleAnswers?: Record<string, string | string[]>;
  timezone?: string;
  country?: string;
  city?: string;
  isVerified?: boolean;
  founderScore?: number;
  reputationScore?: number;
};

type RankedCandidate = {
  uid: string;
  score: number;
  reason: string;
  cached: boolean;
};

type LinkupNotification = {
  userId?: string;
  fromId?: string;
  fromName?: string;
  fromPic?: string;
  type?: string;
  content?: string;
  matchId?: string;
};

function normalize(v: unknown) {
  return String(v ?? '').trim().toLowerCase();
}

function uniqSorted(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const items = list
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  return Array.from(new Set(items.map((v) => v.toLowerCase()))).sort();
}

function answerValues(answers: unknown): string[] {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return [];
  const values = Object.values(answers as Record<string, unknown>).flatMap((value) =>
    Array.isArray(value) ? value : [value]
  );
  return uniqSorted(values);
}

function pickForHash(p: CompactProfile) {
  return {
    uid: p.uid,
    occupation: p.occupation ?? '',
    company: p.company ?? '',
    skills: uniqSorted(p.skills),
    industries: uniqSorted(p.industries),
    lookingFor: uniqSorted(p.lookingFor),
    availability: p.availability ?? '',
    commitmentLevel: p.commitmentLevel ?? '',
    startupStage: p.startupStage ?? '',
    workStyle: p.workStyle ?? '',
    ambition: p.ambition ?? '',
    ambitionScore: typeof p.ambitionScore === 'number' ? p.ambitionScore : null,
    communicationStyle: p.communicationStyle ?? '',
    personalityType: p.personalityType ?? '',
    personalityAnswers: answerValues(p.personalityAnswers),
    roleAnswers: answerValues(p.roleAnswers),
    timezone: p.timezone ?? '',
    country: p.country ?? '',
    city: p.city ?? '',
    isVerified: !!p.isVerified,
    founderScore: typeof p.founderScore === 'number' ? p.founderScore : null,
    reputationScore: typeof p.reputationScore === 'number' ? p.reputationScore : null,
  };
}

function computeProfileHash(p: CompactProfile): string {
  const stable = JSON.stringify(pickForHash(p));
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function cheapPreScore(me: CompactProfile, them: CompactProfile): number {
  const mySkills = uniqSorted(me.skills);
  const theirSkills = uniqSorted(them.skills);
  const sharedSkills = theirSkills.filter((s) => mySkills.includes(s)).length;
  const skillScore = Math.min(1, sharedSkills / Math.max(3, Math.min(6, mySkills.length || 0) || 3));

  const myIndustries = uniqSorted(me.industries);
  const theirIndustries = uniqSorted(them.industries);
  const sharedIndustries = theirIndustries.filter((s) => myIndustries.includes(s)).length;
  const industryScore = myIndustries.length ? Math.min(1, sharedIndustries / myIndustries.length) : 0;

  const commitmentScore =
    me.commitmentLevel && them.commitmentLevel && normalize(me.commitmentLevel) === normalize(them.commitmentLevel) ? 1 : 0.5;

  const availabilityScore =
    me.availability && them.availability && normalize(me.availability) === normalize(them.availability) ? 1 : 0.6;

  const lookingForBoost = (() => {
    const myLookingFor = uniqSorted(me.lookingFor);
    const theirOccupation = normalize(them.occupation);
    if (!myLookingFor.length || !theirOccupation) return 0;
    return myLookingFor.some((want) => theirOccupation.includes(want)) ? 1 : 0;
  })();

  const myPersonality = answerValues(me.personalityAnswers);
  const theirPersonality = answerValues(them.personalityAnswers);
  const sharedPersonality = theirPersonality.filter((s) => myPersonality.includes(s)).length;
  const personalityScore = Math.min(1, sharedPersonality / Math.max(2, Math.min(4, myPersonality.length || 0) || 2));

  const myRoleAnswers = answerValues(me.roleAnswers);
  const theirRoleAnswers = answerValues(them.roleAnswers);
  const sharedRoleAnswers = theirRoleAnswers.filter((s) => myRoleAnswers.includes(s)).length;
  const roleAnswerScore = Math.min(1, sharedRoleAnswers / Math.max(2, Math.min(4, myRoleAnswers.length || 0) || 2));

  const base =
    skillScore * 0.35 +
    industryScore * 0.20 +
    commitmentScore * 0.12 +
    availabilityScore * 0.08 +
    lookingForBoost * 0.08 +
    personalityScore * 0.09 +
    roleAnswerScore * 0.08;

  return Math.round(Math.max(0, Math.min(1, base)) * 100);
}

function sortedPairId(a: string, b: string) {
  return [a, b].sort().join('_');
}

function notificationTitle(data: LinkupNotification) {
  return 'LINKUP';
}

function notificationBody(data: LinkupNotification) {
  const content = String(data.content || '').trim();
  if (data.type === 'message') return `${data.fromName || 'Someone'} ${content || 'sent you a message.'}`;
  if (data.type === 'like') return `${data.fromName || 'Someone'} ${content || 'liked your profile.'}`;
  if (data.type === 'view') return `${data.fromName || 'Someone'} viewed your profile.`;
  return content || 'Open LINKUP for the latest update.';
}

function notificationUrl(data: LinkupNotification) {
  if (data.matchId) return `/chat/${data.matchId}`;
  if (
    data.fromId &&
    (String(data.content || '').startsWith('AI Opportunity') ||
      String(data.content || '').startsWith('AI Project Match'))
  ) {
    return `/opportunity/${data.fromId}`;
  }
  if (data.fromId && ['like', 'view', 'match'].includes(String(data.type || ''))) {
    return `/profile/${data.fromId}`;
  }
  return '/alerts';
}

function isExpoPushToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    (token.startsWith('ExpoPushToken[') || token.startsWith('ExponentPushToken[')) &&
    token.endsWith(']')
  );
}

function clip(value: unknown, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function compactList(value: unknown, maxItems = 16, maxChars = 80) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => clip(entry, maxChars)).filter(Boolean).slice(0, maxItems);
}

function safePublicImage(value: unknown) {
  const uri = clip(value, 900000);
  if (!uri) return '';
  return uri.startsWith('data:') && uri.length > 120000 ? '' : uri.slice(0, 150000);
}

function compactPublicProject(project: any, index: number) {
  return {
    id: clip(project?.id || `project_${index}`, 100),
    title: clip(project?.title, 120),
    description: clip(project?.description, 300),
    status: clip(project?.status, 80),
    lookingFor: compactList(project?.lookingFor, 6, 80),
    tags: compactList(project?.tags, 6, 80),
  };
}

function compactPublicIdea(idea: any, index: number) {
  return {
    id: clip(idea?.id || `idea_${index}`, 100),
    title: clip(idea?.title, 120),
    description: clip(idea?.description, 300),
    stage: clip(idea?.stage, 80),
    lookingFor: compactList(idea?.lookingFor, 6, 80),
    tags: compactList(idea?.tags, 6, 80),
  };
}

function displayNameForIndex(data: any) {
  const direct = clip(data?.displayName || data?.fullName || data?.name, 100);
  if (direct && direct !== 'New Builder') return direct;
  const emailName = clip(String(data?.email || '').split('@')[0], 100);
  return emailName || 'LINKUP Builder';
}

function buildPublicProfileIndex(userId: string, data: any) {
  if (!data || data.deleted || data.isStealthMode === true || data.isVisible === false || data.onboarded === false) {
    return null;
  }

  return {
    uid: userId,
    displayName: displayNameForIndex(data),
    username: clip(data.username, 40),
    bio: clip(data.bio, 700),
    profilePic: safePublicImage(data.profilePic),
    occupation: clip(data.occupation, 100),
    company: clip(data.company, 120),
    country: clip(data.country, 80),
    city: clip(data.city, 80),
    age: Number(data.age || 0) || 0,
    skills: compactList(data.skills, 20, 80),
    interests: compactList(data.interests, 20, 80),
    industries: compactList(data.industries, 16, 80),
    lookingFor: compactList(data.lookingFor, 16, 80),
    goals: clip(data.goals, 420),
    experience: clip(data.experience, 80),
    personalityType: clip(data.personalityType, 80),
    commitmentLevel: clip(data.commitmentLevel, 80),
    startupStage: clip(data.startupStage, 80),
    fundingStage: clip(data.fundingStage, 80),
    availability: clip(data.availability, 80),
    timezone: clip(data.timezone, 80),
    languages: compactList(data.languages, 12, 80),
    workStyle: clip(data.workStyle, 80),
    education: clip(data.education, 80),
    networkingIntent: clip(data.networkingIntent, 120),
    ambition: clip(data.ambition, 120),
    remoteOnly: !!data.remoteOnly,
    willingToRelocate: !!data.willingToRelocate,
    teamSizePreference: clip(data.teamSizePreference, 80),
    projects: Array.isArray(data.projects) ? data.projects.slice(0, 5).map(compactPublicProject) : [],
    startupIdeas: Array.isArray(data.startupIdeas) ? data.startupIdeas.slice(0, 8).map(compactPublicIdea) : [],
    profileViews: Number(data.profileViews || 0) || 0,
    profileClicks: Number(data.profileClicks || data.clicks || 0) || 0,
    profileSaves: Number(data.profileSaves || data.saves || 0) || 0,
    responseRate: Number(data.responseRate || data.reputationMetrics?.responseRate || 0) || 0,
    isVisible: true,
    isStealthMode: false,
    turboConnect: !!data.turboConnect,
    hideOnlineStatus: !!data.hideOnlineStatus,
    isVerified: !!data.isVerified,
    verificationProgram: clip(data.verificationProgram, 80),
    isPro: !!data.isPro,
    plan: clip(data.plan, 40),
    subscriptionPlan: clip(data.subscriptionPlan, 40),
    subscriptionStatus: clip(data.subscriptionStatus, 40),
    onboarded: data.onboarded !== false,
    deleted: false,
    lastActiveAt: data.lastActiveAt || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

export const syncPublicProfileIndex = onDocumentWritten(
  { region: 'us-central1', document: 'users/{userId}' },
  async (event) => {
    const userId = String(event.params.userId || '');
    if (!userId) return;

    const publicRef = admin.firestore().collection('publicProfiles').doc(userId);
    const after = event.data?.after;
    if (!after?.exists) {
      await publicRef.delete().catch(() => {});
      return;
    }

    const index = buildPublicProfileIndex(userId, after.data());
    if (!index) {
      await publicRef.delete().catch(() => {});
      return;
    }

    await publicRef.set(index, { merge: true });
  }
);

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export const sendPushForNotification = onDocumentCreated(
  { region: 'us-central1', document: 'notifications/{notificationId}' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const notificationId = event.params.notificationId;
    const notification = snap.data() as LinkupNotification;
    const userId = String(notification.userId || '').trim();
    if (!userId) {
      logger.warn('Notification missing userId; push skipped.', { notificationId });
      return;
    }

    const privateSnap = await admin.firestore().collection('userPrivate').doc(userId).get();
    const tokens = Array.from(new Set((privateSnap.get('pushTokens') || []).filter(isExpoPushToken)));
    if (!tokens.length) {
      logger.info('No Expo push tokens for notification recipient.', { notificationId, userId });
      return;
    }

    const title = notificationTitle(notification);
    const body = notificationBody(notification).slice(0, 180);
    const url = notificationUrl(notification);
    const messages = tokens.map((to) => ({
      to,
      sound: 'default',
      title,
      body,
      priority: 'high',
      channelId: 'default',
      data: {
        notificationId,
        url,
        type: notification.type || 'system',
        matchId: notification.matchId || '',
        fromId: notification.fromId || '',
      },
    }));

    const invalidTokens: string[] = [];

    await Promise.all(
      chunk(messages, 100).map(async (messageChunk) => {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messageChunk),
        });

        const json = (await response.json().catch(() => null)) as any;
        if (!response.ok) {
          logger.error('Expo push API error.', {
            notificationId,
            status: response.status,
            response: JSON.stringify(json).slice(0, 1000),
          });
          return;
        }

        const tickets = Array.isArray(json?.data) ? json.data : [];
        tickets.forEach((ticket: any, index: number) => {
          if (ticket?.status === 'error') {
            const token = String(messageChunk[index]?.to || '');
            logger.warn('Expo push ticket error.', {
              notificationId,
              token,
              details: ticket?.details,
              message: ticket?.message,
            });
            if (ticket?.details?.error === 'DeviceNotRegistered' && token) {
              invalidTokens.push(token);
            }
          }
        });
      })
    );

    if (invalidTokens.length) {
      await admin
        .firestore()
        .collection('userPrivate')
        .doc(userId)
        .set(
          {
            pushTokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
    }
  }
);

async function geminiScorePair(me: CompactProfile, them: CompactProfile): Promise<{ score: number; reason: string }> {
  const apiKey = GEMINI_API_KEY.value();
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=` + encodeURIComponent(apiKey);

  const prompt = [
    'Return STRICT JSON only, no markdown.',
    'Task: score compatibility (1-100) for two startup builders.',
    'Rules:',
    '- Prefer complementary skills + aligned industries + aligned commitment.',
    '- Penalize mismatched availability/commitment.',
    '- Keep reason under 160 characters.',
    '',
    'UserA=' + JSON.stringify(pickForHash(me)),
    'UserB=' + JSON.stringify(pickForHash(them)),
    '',
    'Output format: {"score": number, "reason": string}',
  ].join('\n');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.0, maxOutputTokens: 120 },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const json: any = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty content.');

  const trimmed = text.trim();
  const maybeJson = (() => {
    // Sometimes models wrap JSON in text; try to extract first {...} block.
    const match = trimmed.match(/\{[\s\S]*\}/);
    return match ? match[0] : trimmed;
  })();

  let parsed: any;
  try {
    parsed = JSON.parse(maybeJson);
  } catch {
    throw new Error('Gemini returned non-JSON: ' + trimmed.slice(0, 200));
  }

  const score = Number(parsed?.score);
  const reason = String(parsed?.reason ?? '').trim();
  if (!Number.isFinite(score) || score < 1 || score > 100 || !reason) {
    throw new Error('Gemini JSON missing/invalid score or reason.');
  }
  return { score: Math.round(score), reason: reason.slice(0, 160) };
}

async function geminiText(prompt: string, opts?: { temperature?: number; maxOutputTokens?: number }) {
  const apiKey = GEMINI_API_KEY.value();
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=` + encodeURIComponent(apiKey);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts?.temperature ?? 0.25,
        maxOutputTokens: opts?.maxOutputTokens ?? 240,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpsError('internal', `Gemini HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json: any = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new HttpsError('internal', 'Gemini returned empty content.');
  return text.trim();
}

function clippedJson(value: unknown, max = 3500) {
  return JSON.stringify(value ?? {}).slice(0, max);
}

export const aiAssist = onCall({ region: 'us-central1', secrets: [GEMINI_API_KEY], cors: LINKUP_CORS_ORIGINS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');

  const task = String((request.data as any)?.task || '').trim();
  const payload = ((request.data as any)?.payload || {}) as Record<string, unknown>;

  let prompt = '';
  let maxOutputTokens = 240;
  let temperature = 0.3;

  if (task === 'startupAnalyzer') {
    const idea = String(payload.idea || '').trim().slice(0, 1500);
    if (!idea) throw new HttpsError('invalid-argument', 'Missing startup idea.');
    maxOutputTokens = 520;
    temperature = 0.25;
    prompt = [
      'You are LINKUP Startup Analyzer: a sharp startup operator, VC, and product strategist.',
      'Be critical, practical, and concise. Do not hype weak ideas.',
      'Respond ONLY with a valid JSON object and nothing else.',
      '',
      `Evaluate this startup idea: "${idea}"`,
      'Score from 1-100 based on urgency, market size, distribution, monetization, differentiation, and execution risk.',
      'Give concrete advice a founder can act on this week.',
      '',
      'Return format:',
      '{"score":72,"verdict":"Promising but needs sharper wedge","targetCustomer":"...","marketPotential":"...","competition":"...","differentiation":"...","monetization":"...","keyRisks":["...","..."],"nextValidationStep":"...","summary":"..."}',
    ].join('\n');
  } else if (task === 'searchFilters') {
    const input = String(payload.input || '').trim().slice(0, 500);
    if (!input) throw new HttpsError('invalid-argument', 'Missing search input.');
    maxOutputTokens = 220;
    temperature = 0.1;
    prompt = [
      'You convert natural-language people search into structured filters for the LINKUP app.',
      'Return ONLY a JSON object (no markdown, no prose).',
      'User can search founders/builders by: query text, location, skills, industry, experience, availability, timezone, lookingForCofounder.',
      'JSON schema: { "query": string, "location": string, "skills": string[], "industry": string, "experience": string, "availability": string, "timezone": string, "lookingForCofounder": boolean }',
      'Use short values and omit unknown fields.',
      `Input: ${input}`,
    ].join('\n');
  } else if (task === 'profileInsights') {
    maxOutputTokens = 140;
    temperature = 0.25;
    prompt = [
      'You generate short, punchy "Match Insights" for a founder profile in the LINKUP app.',
      'Return ONLY plain text (max 2 sentences). No quotes, no markdown.',
      'Focus on: work style, who they work best with, and what type of startup/team fits them.',
      'Profile JSON: ' + clippedJson(payload.profile, 2500),
    ].join('\n');
  } else if (task === 'warmIntro') {
    maxOutputTokens = 260;
    temperature = 0.55;
    prompt = [
      'You write excellent first messages for serious founders and builders.',
      'Draft a message from Me to Other.',
      'Make it specific to both profiles: mention 1-2 concrete overlaps, complementary skills, projects, industries, goals, or work style.',
      'Sound confident, warm, and natural. No generic networking fluff. No markdown. No subject line.',
      'Write 3-5 short sentences. End with one clear collaboration question.',
      'Me=' + clippedJson(payload.me, 1800),
      'Other=' + clippedJson(payload.other, 1800),
    ].join('\n');
  } else if (task === 'matchingExplanation') {
    maxOutputTokens = 220;
    prompt = [
      'You are a professional co-founder matchmaker.',
      'Write a concise, encouraging explanation (2-4 sentences).',
      'Focus on skills compatibility, goals alignment, and personality fit.',
      'FounderA=' + clippedJson(payload.user1, 1800),
      'FounderB=' + clippedJson(payload.user2, 1800),
    ].join('\n');
  } else if (task === 'aiComment') {
    maxOutputTokens = 120;
    temperature = 0.35;
    prompt = [
      'You are a supportive AI mentor for founders. Keep it short and punchy (1-2 sentences).',
      `Post: "${String(payload.postContent || '').slice(0, 1200)}"`,
    ].join('\n');
  } else if (task === 'buildFeedback') {
    maxOutputTokens = 220;
    temperature = 0.4;
    prompt = [
      "You are the 'Brutal Build Roaster'. Be raw but helpful. Be punchy (3-6 sentences).",
      'End with exactly 1 actionable improvement as a single bullet.',
      `Build update: "${String(payload.postContent || '').slice(0, 1200)}"`,
    ].join('\n');
  } else {
    throw new HttpsError('invalid-argument', 'Unsupported AI task.');
  }

  const text = await geminiText(prompt, { temperature, maxOutputTokens });
  return { text };
});

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length) as any;
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

export const rankCandidates = onCall({ region: 'us-central1', secrets: [GEMINI_API_KEY], cors: LINKUP_CORS_ORIGINS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');

  const candidateIds: unknown = (request.data as any)?.candidateIds;
  const maxCandidates = Number((request.data as any)?.maxCandidates ?? 20);

  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    throw new HttpsError('invalid-argument', 'candidateIds must be a non-empty array.');
  }

  const uniqueCandidates = Array.from(new Set(candidateIds.map((v) => String(v ?? '').trim()).filter(Boolean))).slice(0, 200);
  const shortlistSize = Math.max(1, Math.min(20, Math.floor(maxCandidates)));

  const db = admin.firestore();

  const meSnap = await db.collection('users').doc(uid).get();
  if (!meSnap.exists) throw new HttpsError('failed-precondition', 'User profile missing.');
  const me = meSnap.data() as CompactProfile;
  me.uid = uid;

  const meHash = computeProfileHash(me);
  if (meSnap.get('profileHash') !== meHash) {
    await db.collection('users').doc(uid).set({ profileHash: meHash, lastActiveAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }

  const theirRefs = uniqueCandidates.map((id) => db.collection('users').doc(id));
  const theirSnaps = await db.getAll(...theirRefs);

  const candidates: CompactProfile[] = [];
  for (const snap of theirSnaps) {
    if (!snap.exists) continue;
    const p = snap.data() as CompactProfile;
    p.uid = snap.id;
    candidates.push(p);

    const h = computeProfileHash(p);
    if (snap.get('profileHash') !== h) {
      // Keep hashes up to date so we can cache effectively.
      await db.collection('users').doc(snap.id).set({ profileHash: h }, { merge: true });
    }
  }

  // Cheap scoring + shortlist
  const scored = candidates
    .map((p) => ({ p, pre: cheapPreScore(me, p) }))
    .sort((a, b) => b.pre - a.pre)
    .slice(0, shortlistSize);

  const meProfileHash = meHash;

  const ranked = await mapLimit(scored, 2, async ({ p, pre }) => {
    const themHash = computeProfileHash(p);
    const pairId = sortedPairId(uid, p.uid);
    const matchRef = db.collection('aiMatches').doc(pairId);

    const matchSnap = await matchRef.get();
    if (matchSnap.exists) {
      const d = matchSnap.data() as any;
      if (d?.userHashA === meProfileHash && d?.userHashB === themHash && typeof d?.score === 'number' && typeof d?.reason === 'string') {
        return { uid: p.uid, score: Math.round(d.score), reason: String(d.reason), cached: true } satisfies RankedCandidate;
      }
    }

    try {
      const { score, reason } = await geminiScorePair(me, p);
      await matchRef.set(
        {
          u1: uid,
          u2: p.uid,
          score,
          reason,
          model: GEMINI_MODEL,
          userHashA: meProfileHash,
          userHashB: themHash,
          preScore: pre,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { uid: p.uid, score, reason, cached: false } satisfies RankedCandidate;
    } catch (err) {
      logger.warn('Gemini scoring failed; falling back to preScore', { uid, candidate: p.uid, error: String(err) });
      return { uid: p.uid, score: pre, reason: 'Ranked by fast match score (AI unavailable).', cached: true } satisfies RankedCandidate;
    }
  });

  ranked.sort((a, b) => b.score - a.score);

  return {
    ranked,
    meta: { shortlistSize: ranked.length },
  };
});

// ─── Auth Triggers ─────────────────────────────────────────────

export const authOnSignUp = beforeUserCreated(async (event) => {
  const user = event.data;
  if (!user?.uid || !user?.email) return;

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.collection('users').doc(user.uid).set({
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || user.email.split('@')[0],
    profilePic: user.photoURL || '',
    createdAt: now,
    lastActiveAt: now,
    onboarded: false,
    isVisible: true,
    isStealthMode: false,
    turboConnect: false,
    hideOnlineStatus: false,
    isVerified: false,
    isPro: false,
    roleAnswers: {},
    personalityAnswers: {},
    skills: [],
    industries: [],
    lookingFor: [],
  }, { merge: true });

  await db.collection('userPrivate').doc(user.uid).set({
    email: user.email,
    pushTokens: [],
    createdAt: now,
  }, { merge: true });

  logger.info('User initialized for', user.uid);
});

export const cleanupDeletedUser = onDocumentWritten(
  { region: 'us-central1', document: 'users/{userId}' },
  async (event) => {
    const userId = String(event.params.userId || '');
    if (!userId) return;

    const after = event.data?.after;
    if (after?.exists && after.get('deleted') !== true) return;

    const db = admin.firestore();
    const batch = db.batch();
    batch.delete(db.collection('userPrivate').doc(userId));
    batch.delete(db.collection('publicProfiles').doc(userId));

    const swipesFrom = await db.collection('swipes').where('fromId', '==', userId).get();
    swipesFrom.forEach((d) => batch.delete(d.ref));
    const swipesTo = await db.collection('swipes').where('toId', '==', userId).get();
    swipesTo.forEach((d) => batch.delete(d.ref));

    await batch.commit();
    logger.info('Cleanup complete for deleted user:', userId);
  }
);

// ─── Messaging Functions ───────────────────────────────────────

export const sendMessage = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');

  const data = request.data as any;
  const matchId = String(data?.matchId || '').trim();
  const text = String(data?.text || '').trim().slice(0, 2000);

  if (!matchId || !text) {
    throw new HttpsError('invalid-argument', 'matchId and text are required.');
  }

  const db = admin.firestore();

  const matchSnap = await db.collection('matches').doc(matchId).get();
  if (!matchSnap.exists) {
    throw new HttpsError('not-found', 'Match not found.');
  }
  const match = matchSnap.data() || {};
  if (match.u1 !== uid && match.u2 !== uid) {
    throw new HttpsError('permission-denied', 'Not a participant in this match.');
  }

  const msgRef = await db.collection('messages').add({
    matchId,
    senderId: uid,
    text,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    readBy: [uid],
  });

  const otherId = match.u1 === uid ? match.u2 : match.u1;
  await db.collection('matches').doc(matchId).set({
    lastMessage: text.slice(0, 120),
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSenderId: uid,
  }, { merge: true });

  await db.collection('notifications').add({
    userId: otherId,
    fromId: uid,
    type: 'message',
    content: text.slice(0, 180),
    matchId,
  });

  return { id: msgRef.id };
});

export const markMessagesRead = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');

  const data = request.data as any;
  const matchId = String(data?.matchId || '').trim();
  if (!matchId) throw new HttpsError('invalid-argument', 'matchId required.');

  const db = admin.firestore();
  const messagesSnap = await db.collection('messages')
    .where('matchId', '==', matchId)
    .where('senderId', '!=', uid)
    .get();

  const batch = db.batch();
  messagesSnap.docs.forEach((docSnap) => {
    const readBy = docSnap.data()?.readBy || [];
    if (!readBy.includes(uid)) {
      batch.update(docSnap.ref, {
        readBy: admin.firestore.FieldValue.arrayUnion(uid),
      });
    }
  });

  if (batch.commit) await batch.commit();
  return { marked: messagesSnap.size };
});

// ─── Search Functions ──────────────────────────────────────────

export const searchUsers = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');

  const data = request.data as any;
  const queryText = String(data?.query || '').trim().toLowerCase().slice(0, 100);
  const skillFilter = (data?.skills as string[])?.filter(Boolean).slice(0, 10) || [];
  const industryFilter = (data?.industries as string[])?.filter(Boolean).slice(0, 10) || [];
  const locationFilter = String(data?.location || '').trim().slice(0, 80);
  const maxResults = Math.min(Math.max(Number(data?.maxResults) || 20, 1), 50);

  const db = admin.firestore();
  let usersQuery: admin.firestore.Query = db.collection('publicProfiles').where('isVisible', '==', true);

  if (skillFilter.length > 0) {
    usersQuery = usersQuery.where('skills', 'array-contains-any', skillFilter.slice(0, 10));
  } else if (industryFilter.length > 0) {
    usersQuery = usersQuery.where('industries', 'array-contains-any', industryFilter.slice(0, 10));
  }

  const snap = await usersQuery.limit(maxResults * 2).get();
  let results = snap.docs.map((d) => ({ uid: d.id, ...d.data() })) as any[];

  if (queryText) {
    results = results.filter((p) => {
      const name = String(p.displayName || '').toLowerCase();
      const bio = String(p.bio || '').toLowerCase();
      const occupation = String(p.occupation || '').toLowerCase();
      const company = String(p.company || '').toLowerCase();
      const city = String(p.city || '').toLowerCase();
      return name.includes(queryText) || bio.includes(queryText) || occupation.includes(queryText) || company.includes(queryText) || city.includes(queryText);
    });
  }

  if (locationFilter) {
    results = results.filter((p) => {
      const city = String(p.city || '').toLowerCase();
      const country = String(p.country || '').toLowerCase();
      return city.includes(locationFilter) || country.includes(locationFilter);
    });
  }

  return { results: results.slice(0, maxResults), total: results.length };
});

// ─── Admin Functions ───────────────────────────────────────────

const ADMIN_EMAILS = new Set<string>([
  // Add admin emails here
]);

async function assertAdmin(uid: string): Promise<void> {
  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(uid).get();
  const email = String(userSnap.get('email') || '').toLowerCase();
  const isAdmin = ADMIN_EMAILS.has(email) || userSnap.get('role') === 'admin';
  if (!isAdmin) throw new HttpsError('permission-denied', 'Admin access required.');
}

export const adminAction = onCall({ region: 'us-central1', secrets: [GEMINI_API_KEY] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');
  await assertAdmin(uid);

  const data = request.data as any;
  const action = String(data?.action || '').trim();
  const targetUid = String(data?.targetUid || '').trim();

  const db = admin.firestore();

  if (action === 'ban') {
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');
    await db.collection('users').doc(targetUid).set({
      banned: true,
      bannedAt: admin.firestore.FieldValue.serverTimestamp(),
      bannedBy: uid,
      banReason: String(data?.reason || '').trim().slice(0, 500),
      isVisible: false,
      isStealthMode: true,
    }, { merge: true });
    await db.collection('publicProfiles').doc(targetUid).delete().catch(() => {});
    return { success: true, action: 'banned', targetUid };
  }

  if (action === 'unban') {
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');
    await db.collection('users').doc(targetUid).set({
      banned: false,
      bannedAt: admin.firestore.FieldValue.delete(),
      bannedBy: admin.firestore.FieldValue.delete(),
      banReason: admin.firestore.FieldValue.delete(),
    }, { merge: true });
    return { success: true, action: 'unbanned', targetUid };
  }

  if (action === 'deleteUserData') {
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');
    const batch = db.batch();
    batch.delete(db.collection('users').doc(targetUid));
    batch.delete(db.collection('userPrivate').doc(targetUid));
    batch.delete(db.collection('publicProfiles').doc(targetUid));
    const swipesSnap = await db.collection('swipes').where('fromId', '==', targetUid).get();
    swipesSnap.forEach((d) => batch.delete(d.ref));
    const swipesToSnap = await db.collection('swipes').where('toId', '==', targetUid).get();
    swipesToSnap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return { success: true, action: 'dataDeleted', targetUid };
  }

  if (action === 'stats') {
    const usersSnap = await db.collection('users').count().get();
    const publicSnap = await db.collection('publicProfiles').count().get();
    const matchesSnap = await db.collection('matches').count().get();
    const messagesSnap = await db.collection('messages').count().get();
    const swipesSnap = await db.collection('swipes').count().get();
    return {
      success: true,
      stats: {
        totalUsers: usersSnap.data()?.count || 0,
        publicProfiles: publicSnap.data()?.count || 0,
        matches: matchesSnap.data()?.count || 0,
        messages: messagesSnap.data()?.count || 0,
        swipes: swipesSnap.data()?.count || 0,
      },
    };
  }

  if (action === 'setRole') {
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');
    const role = String(data?.role || '').trim();
    if (!['admin', 'moderator', 'user'].includes(role)) {
      throw new HttpsError('invalid-argument', `Invalid role: ${role}`);
    }
    await db.collection('users').doc(targetUid).set({ role }, { merge: true });
    return { success: true, action: 'roleSet', targetUid, role };
  }

  throw new HttpsError('invalid-argument', `Unknown action: ${action}`);
});

// ─── Webhook Endpoints ─────────────────────────────────────────

export const webhookReceive = onRequest({ region: 'us-central1', cors: true }, async (req, res) => {
  const secret = String(req.query?.secret || req.headers['x-webhook-secret'] || '').trim();
  const expectedSecret = process.env.WEBHOOK_SECRET || '';
  if (expectedSecret && secret !== expectedSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const event = String(req.body?.event || req.body?.type || '').trim();
  const payload = req.body?.payload || req.body?.data || {};

  if (!event) {
    res.status(400).json({ error: 'Missing event type' });
    return;
  }

  const db = admin.firestore();
  await db.collection('webhookLogs').add({
    event,
    payload: JSON.stringify(payload).slice(0, 5000),
    headers: JSON.stringify(req.headers).slice(0, 2000),
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (event === 'waitlist.signup') {
    const email = String(payload?.email || '').trim();
    const name = String(payload?.name || '').trim().slice(0, 100);
    if (email) {
      await db.collection('waitlist').add({
        email,
        name,
        source: String(payload?.source || 'webhook').slice(0, 100),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  res.json({ received: true, event });
});
