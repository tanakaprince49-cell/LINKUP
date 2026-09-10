import crypto from 'node:crypto';
import { getDb } from './_firebaseAdmin.js';
import { compactProfile, geminiText, handleOptions, localRank, readJsonBody, sendError, setCors } from './_gemini.js';

const toMillis = (v) => (v?.toMillis ? v.toMillis() : typeof v === 'number' ? v : v ? Date.parse(v) || 0 : 0);

// Ranking a set of profiles is deterministic for a given (member, candidates)
// pair, so the verdict is cached in Firestore for a day. A revisit - or the
// same load on a remount - reuses it instead of spending another Gemini call.
// No staleness: the key is the hash of the exact profiles sent, so any edit to
// a profile produces a new key and a fresh ranking.
const dbSafe = () => { try { return getDb(); } catch { return null; } };

async function cachedRank(key, compute) {
  const db = dbSafe();
  if (!db) return { ranked: await compute(), cached: false };
  let ref;
  try {
    ref = db.collection('linkyCache').doc(key);
    const snap = await ref.get();
    if (snap && snap.exists && Date.now() - toMillis(snap.data().createdAt) < 24 * 3600000) {
      const ranked = snap.data().ranked;
      if (Array.isArray(ranked)) return { ranked, cached: true };
    }
  } catch { /* a cache miss is just a miss */ }
  const ranked = await compute();
  if (ref) await ref.set({ ranked, createdAt: Date.now() }).catch(() => {});
  return { ranked, cached: false };
}

function parseRankedJson(text, allowedIds, maxCandidates) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];

  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();

  return parsed
    .map((row) => ({
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

export default async function handler(req, res) {
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
      ? body.candidates.slice(0, 20).map((candidate) => compactProfile(candidate))
      : [];

    if (!me.uid || candidates.length === 0) {
      sendError(res, 400, 'Missing current profile or candidates.');
      return;
    }

    const local = localRank(me, candidates, maxCandidates);
    const allowedIds = new Set(candidates.map((candidate) => String(candidate.uid || '')).filter(Boolean));
    const cacheKey = `rank_${crypto.createHash('sha1').update(JSON.stringify([me, candidates, maxCandidates])).digest('hex').slice(0, 40)}`;

    const { ranked: rankedOut, cached } = await cachedRank(cacheKey, async () => {
      let ranked = local;
      try {
        const prompt = [
          'You are LINKUP AI matchmaking for startup builders.',
          'Rank candidates for the current user by useful collaboration potential, complementary skills, shared industries/goals, work style, commitment, and startup intent.',
          'Return STRICT JSON array only, no markdown, no prose.',
          'Schema: [{"uid":"candidate-id","score":88,"reason":"short reason under 14 words"}]',
          `Return at most ${maxCandidates} candidates.`,
          `Current user: ${JSON.stringify(me)}`,
          `Candidates: ${JSON.stringify(candidates)}`,
        ].join('\n');
        const text = await geminiText(prompt, {
          temperature: 0.0,
          maxOutputTokens: 500,
          responseMimeType: 'application/json',
        });
        const parsed = parseRankedJson(text, allowedIds, maxCandidates);
        if (parsed.length) ranked = parsed;
      } catch (error) {
        ranked = local;
      }
      return ranked;
    });

    setCors(res);
    res.status(200).json({
      ranked: rankedOut,
      meta: { source: cached ? 'cache' : (rankedOut === local ? 'local-fallback' : 'vercel-gemini'), shortlistSize: rankedOut.length, cached },
    });
  } catch (error) {
    sendError(res, 500, 'LINKUP AI ranking failed on Vercel.', error);
  }
}
