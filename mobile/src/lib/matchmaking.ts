import { httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';
import { functions } from './firebase';
import { UserProfile } from '../types';
import { describeAIError, hasDirectAIKey, recordAIError, requestGeminiText } from './aiDiagnostics';

export type RankedCandidate = {
  uid: string;
  score: number;
  reason: string;
  cached: boolean;
};

export type MatchScoreMap = Record<string, RankedCandidate>;

export const rankedCandidatesToMap = (ranked: RankedCandidate[]): MatchScoreMap => {
  const map: MatchScoreMap = {};
  ranked.forEach((rank) => {
    if (rank.uid) map[rank.uid] = rank;
  });
  return map;
};

export const compatibilityForPair = (
  me: UserProfile | null | undefined,
  person: UserProfile | null | undefined
): RankedCandidate | null => {
  if (!person?.uid) return null;
  return (
    localCommonalityRank(me, [person], 1)[0] || {
      uid: person.uid,
      score: 1,
      reason: 'Promising builder match',
      cached: true,
    }
  );
};

const isCallableMissing = (error: unknown) => {
  const raw = String((error as any)?.code || (error as any)?.message || error || '').toLowerCase();
  return raw.includes('not-found') || raw.includes('404');
};

const directGeminiRankingEnabled = () =>
  String(process.env.EXPO_PUBLIC_ENABLE_DIRECT_GEMINI_RANKING || 'true').toLowerCase() !== 'false';

const serverAIRankingEnabled = () =>
  String(process.env.EXPO_PUBLIC_ENABLE_SERVER_AI || '').toLowerCase() === 'true';

export async function rankCandidatesWithAI(candidateIds: string[], maxCandidates = 20): Promise<RankedCandidate[]> {
  try {
    const callable = httpsCallable(functions, 'rankCandidates');
    const res = await callable({ candidateIds, maxCandidates });
    const ranked = (res.data as any)?.ranked;
    if (!Array.isArray(ranked)) return [];
    return ranked
      .map((r: any) => ({
        uid: String(r?.uid ?? ''),
        score: Math.max(1, Math.min(100, Math.round(Number(r?.score ?? 0)))),
        reason: String(r?.reason ?? ''),
        cached: !!r?.cached,
      }))
      .filter((r: RankedCandidate) => r.uid && Number.isFinite(r.score) && r.reason);
  } catch (error) {
    if (isCallableMissing(error)) {
      return [];
    }
    recordAIError(error, 'Cloud Functions ranking unavailable');
    return [];
  }
}

const compactProfile = (profile: Partial<UserProfile> | null | undefined) => ({
  uid: profile?.uid || '',
  role: profile?.occupation || '',
  goals: Array.isArray(profile?.lookingFor) ? profile?.lookingFor?.slice(0, 5) : profile?.goals || '',
  skills: Array.isArray(profile?.skills) ? profile.skills.slice(0, 8) : [],
  industries: Array.isArray(profile?.industries) ? profile.industries.slice(0, 6) : [],
  workStyle: profile?.workStyle || '',
  commitment: profile?.commitmentLevel || '',
  stage: profile?.startupStage || '',
  availability: profile?.availability || '',
  personality: profile?.personalityType || '',
  roleSignals: profile?.roleAnswers || {},
});

async function serverGeminiRank(me: UserProfile | null | undefined, candidates: UserProfile[], maxCandidates: number): Promise<RankedCandidate[]> {
  if (!serverAIRankingEnabled() || Platform.OS !== 'web' || typeof fetch !== 'function' || !me || candidates.length === 0) return [];

  const compactCandidates = candidates.slice(0, Math.min(maxCandidates, 20)).map(compactProfile);
  const response = await fetch('/api/rankCandidates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      me: compactProfile(me),
      candidates: compactCandidates,
      maxCandidates,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.technical || data?.error || `Smart ranking failed: ${response.status}`);
  }

  const ranked = data?.ranked;
  if (!Array.isArray(ranked)) return [];
  return ranked
    .map((r: any) => ({
      uid: String(r?.uid ?? ''),
      score: Math.max(1, Math.min(100, Math.round(Number(r?.score ?? 0)))),
      reason: String(r?.reason ?? ''),
      cached: !!r?.cached,
    }))
    .filter((r: RankedCandidate) => r.uid && Number.isFinite(r.score) && r.reason);
}

const parseRankedLines = (text: string, candidates: UserProfile[], maxCandidates: number): RankedCandidate[] => {
  const allowedIds = new Set(candidates.map((candidate) => candidate.uid));
  const rows: RankedCandidate[] = [];
  const seen = new Set<string>();

  text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```(?:json)?/g, '').replace(/```/g, ''))
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*\d.)\s]+/, ''))
    .filter(Boolean)
    .forEach((line) => {
      const columns = line.split(/\t+|\s*\|\s*/).map((column) => column.trim()).filter(Boolean);
      let uid = columns[0] || '';
      if (!allowedIds.has(uid)) {
        uid = Array.from(allowedIds).find((candidateId) => line.includes(candidateId)) || '';
      }
      if (!uid || seen.has(uid)) return;

      const scoreText = columns[1] || line.replace(uid, '').match(/\b(100|[1-9]?\d)\b/)?.[1] || '';
      const score = Math.max(1, Math.min(100, Math.round(Number(scoreText))));
      if (!Number.isFinite(score)) return;

      const reason =
        columns.slice(2).join(' ').trim() ||
        line
          .replace(uid, '')
          .replace(scoreText, '')
          .replace(/^[\s|:,-]+/, '')
          .trim() ||
        'Ranked startup fit';

      seen.add(uid);
      rows.push({
        uid,
        score,
        reason: reason.slice(0, 120),
        cached: false,
      });
    });

  return rows.sort((left, right) => right.score - left.score).slice(0, maxCandidates);
};

const parseRankedJsonQuietly = (text: string, candidates: UserProfile[], maxCandidates: number): RankedCandidate[] => {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    const allowedIds = new Set(candidates.map((candidate) => candidate.uid));
    return parsed
      .map((rank: any) => ({
        uid: String(rank?.uid || ''),
        score: Math.max(1, Math.min(100, Math.round(Number(rank?.score || 0)))),
        reason: String(rank?.reason || 'Ranked startup fit').slice(0, 120),
        cached: false,
      }))
      .filter((rank: RankedCandidate) => allowedIds.has(rank.uid) && Number.isFinite(rank.score) && rank.reason)
      .sort((left: RankedCandidate, right: RankedCandidate) => right.score - left.score)
      .slice(0, maxCandidates);
  } catch {
    return [];
  }
};

async function directGeminiRank(me: UserProfile | null | undefined, candidates: UserProfile[], maxCandidates: number): Promise<RankedCandidate[]> {
  if (Platform.OS === 'web' || !directGeminiRankingEnabled() || !hasDirectAIKey() || !me || candidates.length === 0) return [];

  const localTop = localCommonalityRank(me, candidates, Math.min(maxCandidates, 20));
  const localOrder = new Map(localTop.map((rank, index) => [rank.uid, index]));
  const compactCandidates = [...candidates]
    .sort((left, right) => (localOrder.get(left.uid) ?? 999) - (localOrder.get(right.uid) ?? 999))
    .slice(0, Math.min(maxCandidates, 20))
    .map(compactProfile);

  const prompt = [
    'You are LINKUP matchmaking for startup builders.',
    'Rank candidates for the current user by useful collaboration potential, complementary skills, shared industries/goals, work style, commitment, and startup intent.',
    'SCORES MUST BE REALISTIC: 10-40 for weak/single-dimension overlap, 41-70 for good multi-dimensional fit, 71-100 only for exceptional multi-dimensional alignment across 3+ areas.',
    'DO NOT inflate scores. A person sharing only 1 skill gets 15-25, not 90.',
    'Return STRICT JSON array only, no markdown, no prose.',
    'Schema: [{"uid":"candidate-id","score":45,"reason":"2 shared skills, complementary roles"}]',
    `Return at most ${Math.min(maxCandidates, 20)} candidates.`,
    `Current user: ${JSON.stringify(compactProfile(me))}`,
    `Candidates: ${JSON.stringify(compactCandidates)}`,
  ].join('\n');

  const text = await requestGeminiText(prompt, {
    temperature: 0.0,
    maxOutputTokens: 700,
    responseMimeType: 'application/json',
  });
  const jsonRanks = parseRankedJsonQuietly(String(text || ''), candidates, maxCandidates);
  if (jsonRanks.length) return jsonRanks;
  return parseRankedLines(String(text || ''), candidates, maxCandidates);
}

export async function rankCandidatesHybrid(
  me: UserProfile | null | undefined,
  candidates: UserProfile[],
  maxCandidates = 20
): Promise<RankedCandidate[]> {
  const candidateIds = candidates.map((candidate) => candidate.uid).filter(Boolean).slice(0, Math.max(maxCandidates, 20));

  // Always start with local ranking for consistency
  const localRanked = localCommonalityRank(me, candidates, maxCandidates);

  try {
    const geminiRanked = await directGeminiRank(me, candidates, maxCandidates);
    if (geminiRanked.length) return geminiRanked;
  } catch (error) {
    console.warn('Smart ranking unavailable:', describeAIError(error));
    recordAIError(error, 'Smart ranking unavailable');
  }

  try {
    const serverRanked = await serverGeminiRank(me, candidates, maxCandidates);
    if (serverRanked.length) return serverRanked;
  } catch (error) {
    recordAIError(error, 'Smart ranking unavailable');
  }

  const functionRanked = await rankCandidatesWithAI(candidateIds, maxCandidates);
  if (functionRanked.length) return functionRanked;

  return localRanked;
}

const normalizeText = (value: unknown) => String(value ?? '').trim().toLowerCase();

const toNormalizedArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((entry) => normalizeText(entry)).filter(Boolean);
  const normalized = normalizeText(value);
  return normalized ? [normalized] : [];
};

const countShared = (left: string[], right: string[]) => {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  return Array.from(new Set(left)).filter((entry) => rightSet.has(entry)).length;
};

const flattenAnswers = (answers?: Record<string, string | string[]>) =>
  Object.values(answers || {}).flatMap((value) => toNormalizedArray(value));

const complementaryRoles: Record<string, string[]> = {
  founder: ['developer', 'designer', 'marketer', 'operator', 'investor'],
  developer: ['founder', 'designer', 'operator', 'marketer'],
  designer: ['founder', 'developer', 'marketer'],
  investor: ['founder', 'operator'],
  marketer: ['founder', 'developer', 'designer', 'operator'],
  student: ['founder', 'developer', 'designer', 'marketer', 'investor', 'operator'],
  operator: ['founder', 'developer', 'marketer', 'investor'],
};

export function localCommonalityRank(me: UserProfile | null | undefined, people: UserProfile[], limitCount = 15) {
  const mySkills = toNormalizedArray(me?.skills);
  const myIndustries = toNormalizedArray(me?.industries);
  const myLookingFor = toNormalizedArray(me?.lookingFor);
  const myPersonality = toNormalizedArray(me?.personalityAnswers ? Object.values(me.personalityAnswers) : []);
  const myRoleAnswers = flattenAnswers(me?.roleAnswers);
  const myWorkStyle = normalizeText(me?.workStyle);
  const myCommitment = normalizeText(me?.commitmentLevel);
  const myStage = normalizeText(me?.startupStage);
  const myRole = normalizeText(me?.occupation);

  const scorePerson = (person: UserProfile) => {
    const skills = toNormalizedArray(person.skills);
    const industries = toNormalizedArray(person.industries);
    const lookingFor = toNormalizedArray(person.lookingFor);
    const personality = toNormalizedArray(person.personalityAnswers ? Object.values(person.personalityAnswers) : []);
    const roleSignals = flattenAnswers(person.roleAnswers);
    const workStyle = normalizeText(person.workStyle);
    const commitment = normalizeText(person.commitmentLevel);
    const stage = normalizeText(person.startupStage);
    const role = normalizeText(person.occupation);

    const sharedSkills = countShared(mySkills, skills);
    const sharedIndustries = countShared(myIndustries, industries);
    const sharedGoals = countShared(myLookingFor, lookingFor);
    const sharedPersonality = countShared(myPersonality, personality);
    const sharedRoleSignals = countShared(myRoleAnswers, roleSignals);
    const sameWorkStyle = myWorkStyle && workStyle && myWorkStyle === workStyle ? 1 : 0;
    const sameCommitment = myCommitment && commitment && myCommitment === commitment ? 1 : 0;
    const sameStage = myStage && stage && myStage === stage ? 1 : 0;
    const complementaryRole = myRole && role && complementaryRoles[myRole]?.includes(role) ? 1 : 0;
    const sameRole = myRole && role && myRole === role ? 1 : 0;

    const overlapDimensions = [sharedSkills, sharedIndustries, sharedGoals, sharedPersonality, sameWorkStyle, sameCommitment, complementaryRole].filter(Boolean).length;

    const rawScore =
      sharedSkills * 14 +
      sharedIndustries * 9 +
      sharedGoals * 12 +
      sharedRoleSignals * 7 +
      sharedPersonality * 6 +
      sameWorkStyle * 8 +
      sameCommitment * 5 +
      sameStage * 4 +
      complementaryRole * 10 +
      sameRole * 4;

    let score = Math.max(1, Math.min(100, Math.round(rawScore)));

    if (overlapDimensions < 2 && score > 20) {
      score = Math.min(score, 20);
    }

    const reasonParts: string[] = [];
    if (sharedSkills) reasonParts.push(`${sharedSkills} shared skill${sharedSkills === 1 ? '' : 's'}`);
    if (sharedIndustries) reasonParts.push(`${sharedIndustries} shared interest${sharedIndustries === 1 ? '' : 's'}`);
    if (sharedGoals) reasonParts.push(`${sharedGoals} shared goal${sharedGoals === 1 ? '' : 's'}`);
    if (sharedRoleSignals) reasonParts.push(`${sharedRoleSignals} matching signal${sharedRoleSignals === 1 ? '' : 's'}`);
    if (sharedPersonality) reasonParts.push(`${sharedPersonality} personality match${sharedPersonality === 1 ? '' : 'es'}`);
    if (sameWorkStyle) reasonParts.push('same work style');
    if (sameCommitment) reasonParts.push('same commitment level');
    if (complementaryRole) reasonParts.push('complementary role match');
    if (sameStage && !reasonParts.length) reasonParts.push('similar startup stage');

    return {
      score,
      reason: reasonParts.slice(0, 3).join(' · ') || 'Promising builder match',
    };
  };

  return people
    .map((person) => ({ person, ...scorePerson(person) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limitCount)
    .map((entry) => ({ uid: entry.person.uid, score: entry.score, reason: entry.reason, cached: true as const }));
}
