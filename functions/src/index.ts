import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
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

  const base =
    skillScore * 0.45 +
    industryScore * 0.25 +
    commitmentScore * 0.15 +
    availabilityScore * 0.10 +
    lookingForBoost * 0.05;

  return Math.round(Math.max(0, Math.min(1, base)) * 100);
}

function sortedPairId(a: string, b: string) {
  return [a, b].sort().join('_');
}

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
