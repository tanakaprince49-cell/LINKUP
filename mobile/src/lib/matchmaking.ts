import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { UserProfile } from '../types';

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';

export type RankedCandidate = {
  uid: string;
  score: number;
  reason: string;
  cached: boolean;
};

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
  } catch {
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

const extractJsonArray = (text: string) => {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
};

async function directGeminiRank(me: UserProfile | null | undefined, candidates: UserProfile[], maxCandidates: number): Promise<RankedCandidate[]> {
  if (!GEMINI_API_KEY.trim() || !me || candidates.length === 0) return [];

  const localTop = localCommonalityRank(me, candidates, Math.min(maxCandidates, 20));
  const localOrder = new Map(localTop.map((rank, index) => [rank.uid, index]));
  const compactCandidates = [...candidates]
    .sort((left, right) => (localOrder.get(left.uid) ?? 999) - (localOrder.get(right.uid) ?? 999))
    .slice(0, Math.min(maxCandidates, 20))
    .map(compactProfile);

  const prompt = [
    'You are LINKUP AI matchmaking for startup builders.',
    'Rank candidates for the current user by useful collaboration potential, complementary skills, shared industries/goals, work style, commitment, and startup intent.',
    'Return JSON only, no markdown, as an array of objects: [{"uid":"string","score":1-100,"reason":"max 14 words"}].',
    `Return at most ${Math.min(maxCandidates, 20)} candidates.`,
    `Current user: ${JSON.stringify(compactProfile(me))}`,
    `Candidates: ${JSON.stringify(compactCandidates)}`,
  ].join('\n');

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': GEMINI_API_KEY.trim(),
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini ranking failed: ${response.status}${body ? ` ${body.slice(0, 120)}` : ''}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('').trim();
  const jsonText = extractJsonArray(String(text || '')) || String(text || '');
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) return [];

  const allowedIds = new Set(candidates.map((candidate) => candidate.uid));
  return parsed
    .map((rank: any) => ({
      uid: String(rank?.uid || ''),
      score: Math.max(1, Math.min(100, Math.round(Number(rank?.score || 0)))),
      reason: String(rank?.reason || 'AI-ranked startup fit').slice(0, 120),
      cached: false,
    }))
    .filter((rank: RankedCandidate) => allowedIds.has(rank.uid) && Number.isFinite(rank.score) && rank.reason)
    .sort((left: RankedCandidate, right: RankedCandidate) => right.score - left.score)
    .slice(0, maxCandidates);
}

export async function rankCandidatesHybrid(
  me: UserProfile | null | undefined,
  candidates: UserProfile[],
  maxCandidates = 20
): Promise<RankedCandidate[]> {
  const candidateIds = candidates.map((candidate) => candidate.uid).filter(Boolean).slice(0, Math.max(maxCandidates, 20));

  const functionRanked = await rankCandidatesWithAI(candidateIds, maxCandidates);
  if (functionRanked.length) return functionRanked;

  try {
    const geminiRanked = await directGeminiRank(me, candidates, maxCandidates);
    if (geminiRanked.length) return geminiRanked;
  } catch (error) {
    console.warn('Direct Gemini ranking unavailable:', error);
  }

  return localCommonalityRank(me, candidates, maxCandidates);
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

    const rawScore =
      sharedSkills * 12 +
      sharedIndustries * 8 +
      sharedGoals * 10 +
      sharedRoleSignals * 6 +
      sharedPersonality * 5 +
      sameWorkStyle * 6 +
      sameCommitment * 4 +
      sameStage * 3 +
      complementaryRole * 8 +
      sameRole * 3;
    const score = Math.max(1, Math.min(100, Math.round(rawScore)));

    const reasonParts: string[] = [];
    if (sharedSkills) reasonParts.push(`${sharedSkills} shared skill${sharedSkills === 1 ? '' : 's'}`);
    if (sharedIndustries) reasonParts.push(`${sharedIndustries} shared interest${sharedIndustries === 1 ? '' : 's'}`);
    if (sharedGoals) reasonParts.push(`${sharedGoals} shared goal${sharedGoals === 1 ? '' : 's'}`);
    if (sharedRoleSignals) reasonParts.push(`${sharedRoleSignals} role-fit signal${sharedRoleSignals === 1 ? '' : 's'}`);
    if (sharedPersonality) reasonParts.push(`${sharedPersonality} personality match${sharedPersonality === 1 ? '' : 'es'}`);
    if (sameWorkStyle) reasonParts.push('same work style');
    if (sameCommitment) reasonParts.push('same commitment level');
    if (complementaryRole) reasonParts.push('complementary roles');

    return {
      score,
      reason: reasonParts.slice(0, 3).join(' / ') || 'Promising builder match',
    };
  };

  return people
    .map((person) => ({ person, ...scorePerson(person) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limitCount)
    .map((entry) => ({ uid: entry.person.uid, score: entry.score, reason: entry.reason, cached: true as const }));
}
