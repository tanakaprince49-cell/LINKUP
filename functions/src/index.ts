import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import crypto from 'node:crypto';

if (!admin.apps.length) {
  admin.initializeApp();
}

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

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
  if (data.type === 'message') return `New message from ${data.fromName || 'LINKUP'}`;
  if (data.type === 'match') return 'New LINKUP match';
  if (data.type === 'like') return 'New profile like';
  if (data.type === 'view') return 'New profile view';
  if (data.type === 'comment') return 'New comment';
  if (String(data.content || '').startsWith('AI Project Match')) return 'AI Project Match found';
  if (String(data.content || '').startsWith('AI Opportunity')) return 'AI Opportunity found';
  return 'LINKUP notification';
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
    const body = String(notification.content || 'Open LINKUP for the latest update.').slice(0, 180);
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
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + encodeURIComponent(apiKey);

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
      generationConfig: { temperature: 0.2, maxOutputTokens: 120 },
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
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + encodeURIComponent(apiKey);

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

export const aiAssist = onCall({ region: 'us-central1', secrets: [GEMINI_API_KEY] }, async (request) => {
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
    maxOutputTokens = 220;
    temperature = 0.45;
    prompt = [
      'You are a professional co-founder matchmaker.',
      'Write a warm, enthusiastic opening message that feels human and specific.',
      'Write 4-6 sentences. End with 1 clear question.',
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

export const rankCandidates = onCall({ region: 'us-central1', secrets: [GEMINI_API_KEY] }, async (request) => {
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
          model: 'gemini-flash-latest',
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
