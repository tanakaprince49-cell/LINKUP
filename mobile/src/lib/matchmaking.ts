import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export type RankedCandidate = {
  uid: string;
  score: number;
  reason: string;
  cached: boolean;
};

export async function rankCandidatesWithAI(candidateIds: string[], maxCandidates = 20): Promise<RankedCandidate[]> {
  const callable = httpsCallable(functions, 'rankCandidates');
  const res = await callable({ candidateIds, maxCandidates });
  const ranked = (res.data as any)?.ranked;
  if (!Array.isArray(ranked)) return [];
  return ranked
    .map((r: any) => ({
      uid: String(r?.uid ?? ''),
      score: Number(r?.score ?? 0),
      reason: String(r?.reason ?? ''),
      cached: !!r?.cached,
    }))
    .filter((r: RankedCandidate) => r.uid && Number.isFinite(r.score) && r.reason);
}

