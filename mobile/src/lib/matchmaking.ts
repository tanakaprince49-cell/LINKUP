import { webAppPath } from './webPaths';
import { builderCall } from './builder';
import { httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';
import { auth, functions } from './firebase';
import { UserProfile } from '../types';
import { describeAIError, hasDirectAIKey, recordAIError, requestGeminiText } from './aiDiagnostics';
import {
  MODEL_VERSION,
  bandOf,
  applyBandedOrder as applySharedBandedOrder,
  composeCard,
  composePortfolio,
  rankPool,
  type MatchCard,
  type PairScore,
} from '../../../shared/linkup-match';

/**
 * A ranked candidate, as the rest of the app consumes it.
 *
 * `score` is a 0–100 number that exists for sorting and for the debug payload.
 * It is NEVER rendered as a percentage: members see `band`, two reasons and one
 * thing to do (docs/LINKUP_ALGORITHM_DESIGN.md §3 L5, §22).
 */
export type RankedCandidate = {
  uid: string;
  score: number;
  band: { id: string; min: number; label: string; line: string };
  reason: string;
  why: { shared: string; complement: string };
  opener: string;
  tinyTask: string;
  slot: 'mirror' | 'complement' | 'wildcard';
  agenda: string[];
  tempoNote: string | null;
  repair: string | null;
  cites: string[];
  modelVersion: string;
  cached: boolean;
};

export type MatchScoreMap = Record<string, RankedCandidate>;

/** Bands for any 0–100 surface score. The number never reaches the screen. */
export const bandForScore = (score: number) =>
  bandOf(Math.max(0, Math.min(100, Number(score) || 0)) / 100);

/** Single-word band chips for compact pills. */
export const BAND_SHORT: Record<string, string> = {
  strong: 'STRONG',
  good: 'GOOD',
  worth_a_look: 'LOOK',
  hidden: 'THIN',
};

/** What an LLM is allowed to return: a uid, a nudge, and a reason to validate. */
type RankProposal = { uid: string; score: number; reason: string; cached: boolean };

export const rankedCandidatesToMap = (ranked: RankedCandidate[]): MatchScoreMap => {
  const map: MatchScoreMap = {};
  ranked.forEach((rank) => {
    if (rank.uid) map[rank.uid] = rank;
  });
  return map;
};

const cardFor = (score: PairScore) => composeCard(score);

/**
 * One pair, scored the same way the rail scores it: numeric score kept for
 * sorting, band and reasons for the human reading it.
 */
export const toRankedCandidate = (score: PairScore): RankedCandidate => {
  const card: MatchCard = cardFor(score);
  const reason = [card.why.shared, card.why.complement].filter(Boolean).join(' ');
  return {
    uid: score.uid,
    score: Math.max(1, Math.min(100, Math.round(score.display * 100))),
    band: score.band,
    reason,
    why: card.why,
    opener: card.opener,
    tinyTask: card.tiny_task,
    slot: card.slot,
    agenda: card.agenda,
    tempoNote: card.tempo_note,
    repair: card.repair,
    cites: card.cites,
    modelVersion: score.modelVersion || MODEL_VERSION,
    cached: true,
  };
};

export const compatibilityForPair = (
  me: UserProfile | null | undefined,
  person: UserProfile | null | undefined
): RankedCandidate | null => {
  if (!person?.uid) return null;
  return localCommonalityRank(me, [person], 1)[0] || null;
};

const isCallableMissing = (error: unknown) => {
  const raw = String((error as any)?.code || (error as any)?.message || error || '').toLowerCase();
  return raw.includes('not-found') || raw.includes('404');
};

// Direct device-to-Gemini ranking is OFF by default: it re-ranked the same
// 40 people on every screen load, uncached, straight off the device. Native
// now uses local ranking; web goes through the (cached) Vercel route.
const directGeminiRankingEnabled = () =>
  String(process.env.EXPO_PUBLIC_ENABLE_DIRECT_GEMINI_RANKING || 'false').toLowerCase() !== 'false';

/**
 * The Vercel route (/api/rankCandidates) is the server ranker on web. It is
 * on by default: it used to hide behind EXPO_PUBLIC_ENABLE_SERVER_AI, which
 * was never set, so web skipped a working endpoint and fell through to the
 * Firebase callable below - which is not deployed (the project is not on
 * Blaze) and answers 404 with no CORS headers, spraying a red
 * "blocked by CORS policy" error on every Home load.
 */
const serverAIRankingEnabled = () =>
  String(process.env.EXPO_PUBLIC_ENABLE_SERVER_AI || 'true').toLowerCase() !== 'false';

/**
 * The Firebase callable is opt-in. It only exists once functions/ is
 * deployed (Blaze plan); until then calling it is guaranteed to fail and,
 * on web, guaranteed to log a CORS error the browser will not let us catch.
 */
const cloudFunctionRankingEnabled = () =>
  String(process.env.EXPO_PUBLIC_ENABLE_CLOUD_FUNCTIONS || '').toLowerCase() === 'true';

export async function rankCandidatesWithAI(candidateIds: string[], maxCandidates = 20): Promise<RankProposal[]> {
  if (!cloudFunctionRankingEnabled()) return [];
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
      .filter((r: RankProposal) => r.uid && Number.isFinite(r.score) && r.reason);
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
  displayName: profile?.displayName || '',
  occupation: profile?.occupation || '',
  company: profile?.company || '',
  bio: String(profile?.bio || '').slice(0, 700),
  goals: String(profile?.goals || '').slice(0, 420),
  lookingFor: Array.isArray(profile?.lookingFor) ? profile.lookingFor.slice(0, 8) : [],
  skills: Array.isArray(profile?.skills) ? profile.skills.slice(0, 12) : [],
  interests: Array.isArray(profile?.interests) ? profile.interests.slice(0, 12) : [],
  industries: Array.isArray(profile?.industries) ? profile.industries.slice(0, 10) : [],
  city: profile?.city || '',
  country: profile?.country || '',
  timezone: profile?.timezone || '',
  remoteOnly: profile?.remoteOnly === true,
  willingToRelocate: profile?.willingToRelocate === true,
  workStyle: profile?.workStyle || '',
  commitmentLevel: profile?.commitmentLevel || '',
  availability: profile?.availability || '',
  startupStage: profile?.startupStage || '',
  fundingStage: profile?.fundingStage || '',
  ambition: profile?.ambition || '',
  personalityType: profile?.personalityType || '',
  roleAnswers: profile?.roleAnswers || {},
  projects: Array.isArray(profile?.projects) ? profile.projects.slice(0, 3).map((project: any) => ({
    title: String(project?.title || '').slice(0, 100),
    description: String(project?.description || '').slice(0, 240),
    tags: Array.isArray(project?.tags) ? project.tags.slice(0, 6) : [],
  })) : [],
});

async function serverGeminiRank(me: UserProfile | null | undefined, candidates: UserProfile[], maxCandidates: number): Promise<RankProposal[]> {
  if (!serverAIRankingEnabled() || Platform.OS !== 'web' || typeof fetch !== 'function' || !me || candidates.length === 0) return [];

  const compactCandidates = candidates.slice(0, 40).map(compactProfile);
  const token = await auth.currentUser?.getIdToken().catch(() => '');
  const response = await fetch(webAppPath('/api/rankCandidates'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
    .filter((r: RankProposal) => r.uid && Number.isFinite(r.score) && r.reason);
}

const parseRankedLines = (text: string, candidates: UserProfile[], maxCandidates: number): RankProposal[] => {
  const allowedIds = new Set(candidates.map((candidate) => candidate.uid));
  const rows: RankProposal[] = [];
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

const parseRankedJsonQuietly = (text: string, candidates: UserProfile[], maxCandidates: number): RankProposal[] => {
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
      .filter((rank: RankProposal) => allowedIds.has(rank.uid) && Number.isFinite(rank.score) && rank.reason)
      .sort((left: RankProposal, right: RankProposal) => right.score - left.score)
      .slice(0, maxCandidates);
  } catch {
    return [];
  }
};

async function directGeminiRank(me: UserProfile | null | undefined, candidates: UserProfile[], maxCandidates: number): Promise<RankProposal[]> {
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

const normalizeText = (value: unknown) => String(value ?? '').trim().toLowerCase();

/**
 * Local, deterministic ranking — the real ranker.
 *
 * Everything below `rankPool` is the engine in shared/linkup-match.js: nine fit
 * families, seven chemistry axes, the harmonic reciprocity guard, gating and
 * bands. No model, no network, no randomness, so the same two profiles always
 * produce the same card.
 */
export function localCommonalityRank(
  me: UserProfile | null | undefined,
  people: UserProfile[],
  limitCount = 15,
  feedback: Record<string, { status: 'relevant' | 'not_relevant' | 'contacted'; at?: number }> = {}
): RankedCandidate[] {
  if (!me?.uid || !Array.isArray(people) || people.length === 0) return [];

  const out = rankPool(me as unknown as Record<string, unknown>, people as unknown as Record<string, unknown>[], {
    limit: Math.max(limitCount, people.length),
    feedback,
  });

  return out.ranked.slice(0, limitCount).map(toRankedCandidate);
}

/** Score every candidate and keep the pair scores, for callers that need the axes. */
export function scorePool(me: UserProfile | null | undefined, people: UserProfile[]): PairScore[] {
  if (!me?.uid || !Array.isArray(people) || people.length === 0) return [];
  return rankPool(me as unknown as Record<string, unknown>, people as unknown as Record<string, unknown>[], {
    limit: Math.max(people.length, 1),
  }).scored;
}

/**
 * The portfolio rail (§24): Mirror, Complement, Wildcard. Three different
 * reasons rather than three near-copies, and it degrades to two honest cards
 * under ~30 eligible members instead of padding a wildcard.
 */
export function composeMatchPortfolio(
  me: UserProfile | null | undefined,
  people: UserProfile[],
  k = 3
): RankedCandidate[] {
  if (!me?.uid || !Array.isArray(people) || people.length === 0) return [];
  const out = rankPool(me as unknown as Record<string, unknown>, people as unknown as Record<string, unknown>[], {
    limit: Math.max(people.length, 1),
  });
  const slots = composePortfolio(out.scored, { k, poolSize: out.poolSize });
  return slots.map((score) => ({ ...toRankedCandidate(score), slot: score.slot as RankedCandidate['slot'] }));
}

/**
 * Band-limited tie-break (§3 L4b), applied on the client too: a model may only
 * reorder people whose scores are within `band` points of each other.
 */
export function applyBandedReorder(
  ranked: RankedCandidate[],
  proposedOrder: string[],
  band = 6
): RankedCandidate[] {
  if (!ranked.length || !proposedOrder.length) return ranked;
  const withDisplay = ranked.map((entry) => ({ ...entry, display: entry.score }));
  return applySharedBandedOrder(withDisplay, proposedOrder, band).map(({ display: _display, ...entry }) => entry);
}

/** A reason survives only if it cites something in the pair's own ledger. */
export function reasonCitesEvidence(reason: string, candidate: RankedCandidate): boolean {
  const text = normalizeText(reason);
  if (!text || text.length < 12) return false;
  const banned = ['%', 'match', 'perfect', 'soulmate', 'synergy', 'chemistry', 'vibes', 'destined', 'compatible', 'astrology'];
  if (banned.some((token) => text.includes(token))) return false;

  const evidence = normalizeText(`${candidate.why.shared} ${candidate.why.complement}`)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 4);
  const reasonWords = new Set(text.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  return evidence.some((word) => reasonWords.has(word));
}

let recommendationFeedbackCache: { uid: string; expiresAt: number; feedback: Record<string, any> } | null = null;

async function loadRecommendationFeedback(uid: string) {
  if (recommendationFeedbackCache?.uid === uid && recommendationFeedbackCache.expiresAt > Date.now()) {
    return recommendationFeedbackCache.feedback;
  }
  try {
    const result = await builderCall<{ feedback?: Record<string, any> }>('recommendationFeedbackRead');
    const cutoff = Date.now() - 90 * 86400000;
    const feedback = Object.fromEntries(Object.entries(result.feedback || {}).filter(([, row]) =>
      row && Number(row.at) >= cutoff && ['relevant', 'not_relevant', 'contacted'].includes(row.status)
    ));
    recommendationFeedbackCache = { uid, expiresAt: Date.now() + 30 * 1000, feedback };
    return feedback;
  } catch {
    return {};
  }
}

export async function rankCandidatesHybrid(
  me: UserProfile | null | undefined,
  candidates: UserProfile[],
  maxCandidates = 20
): Promise<RankedCandidate[]> {
  // The deterministic engine always produces the order and the reasons. The
  // model below sees only its shortlist, never an arbitrary prefix of the pool.
  const feedbackCached = !!me?.uid && recommendationFeedbackCache?.uid === me.uid && recommendationFeedbackCache.expiresAt > Date.now();
  const feedback = feedbackCached ? recommendationFeedbackCache!.feedback : {};
  if (me?.uid && !feedbackCached) void loadRecommendationFeedback(me.uid);
  const localRanked = localCommonalityRank(me, candidates, maxCandidates, feedback);
  if (!localRanked.length) return [];
  const profilesByUid = new Map(candidates.map((candidate) => [candidate.uid, candidate]));
  const modelCandidates = localRanked.slice(0, 40).map((row) => profilesByUid.get(row.uid)).filter(Boolean) as UserProfile[];
  const candidateIds = modelCandidates.map((candidate) => candidate.uid).filter(Boolean);

  let proposed: RankProposal[] = [];
  try {
    proposed = await directGeminiRank(me, modelCandidates, maxCandidates);
  } catch (error) {
    recordAIError(error, 'Smart ranking unavailable');
  }

  if (!proposed.length) {
    try {
      proposed = await serverGeminiRank(me, modelCandidates, maxCandidates);
    } catch (error) {
      recordAIError(error, 'Smart ranking unavailable');
    }
  }

  if (!proposed.length) {
    proposed = await rankCandidatesWithAI(candidateIds, maxCandidates);
  }

  if (!proposed.length) return localRanked;

  // Keep only proposals we can defend: same set of people, reasons that cite
  // evidence the pair actually has. Everything else falls back to the engine.
  const rankedByUid = new Map(localRanked.map((entry) => [entry.uid, entry]));
  const order: string[] = [];
  for (const proposal of proposed) {
    const local = rankedByUid.get(proposal.uid);
    if (!local) continue;
    if (!order.includes(proposal.uid)) order.push(proposal.uid);
    if (reasonCitesEvidence(proposal.reason, local)) {
      local.reason = proposal.reason.slice(0, 160);
    }
  }

  return applyBandedReorder(localRanked, order, 6);
}
