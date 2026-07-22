import { compactProfile, geminiText, handleOptions, localRank, readJsonBody, sendError, setCors } from './_gemini';

function parseRankedJson(text: string, allowedIds: Set<string>, maxCandidates: number) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];

  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();

  return parsed
    .map((row: any) => ({
      uid: String(row?.uid || '').trim(),
      score: Math.max(1, Math.min(100, Math.round(Number(row?.score || 0)))),
      reason: String(row?.reason || 'AI-ranked startup fit').trim().slice(0, 140),
      cached: false,
    }))
    .filter((row) => {
      if (!row.uid || seen.has(row.uid) || !allowedIds.has(row.uid) || !Number.isFinite(row.score)) return false;
      seen.add(row.uid);
      return true;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, maxCandidates);
}

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') {
    sendError(res, 405, 'Use POST for LINKUP AI ranking.');
    return;
  }

  try {
    const body = readJsonBody(req);
    const maxCandidates = Math.max(1, Math.min(20, Math.floor(Number(body.maxCandidates || 20))));
    const me = compactProfile(body.me || {});
    const candidates = Array.isArray(body.candidates)
      ? body.candidates.slice(0, 20).map((candidate: unknown) => compactProfile(candidate))
      : [];

    if (!me.uid || candidates.length === 0) {
      sendError(res, 400, 'Missing current profile or candidates.');
      return;
    }

    const local = localRank(me, candidates, maxCandidates);
    const allowedIds = new Set<string>(candidates.map((candidate) => String(candidate.uid || '')).filter(Boolean));

    const prompt = [
      'You are LINKUP AI matchmaking for startup builders.',
      'Rank candidates for the current user by useful collaboration potential, complementary skills, shared industries/goals, work style, commitment, and startup intent.',
      'Return STRICT JSON array only, no markdown, no prose.',
      'Schema: [{"uid":"candidate-id","score":88,"reason":"short reason under 14 words"}]',
      `Return at most ${maxCandidates} candidates.`,
      `Current user: ${JSON.stringify(me)}`,
      `Candidates: ${JSON.stringify(candidates)}`,
    ].join('\n');

    let ranked = local;
    try {
      const text = await geminiText(prompt, {
        temperature: 0.0,
        maxOutputTokens: 700,
        responseMimeType: 'application/json',
      });
      const parsed = parseRankedJson(text, allowedIds, maxCandidates);
      if (parsed.length) ranked = parsed;
    } catch (error) {
      ranked = local;
    }

    setCors(res);
    res.status(200).json({
      ranked,
      meta: { source: ranked === local ? 'local-fallback' : 'vercel-gemini', shortlistSize: ranked.length },
    });
  } catch (error) {
    sendError(res, 500, 'LINKUP AI ranking failed on Vercel.', error);
  }
}
