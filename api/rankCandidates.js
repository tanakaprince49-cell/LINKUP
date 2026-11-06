import crypto from 'node:crypto';
import { getDb, verifyRequestUser } from './_firebaseAdmin.js';
import { geminiText, handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import {
  TIE_BREAK_BAND,
  applyBandedOrder,
  buildCorpus,
  composeCard,
  parseModelAnswer,
  scorePair,
} from '../shared/linkup-match.js';

/**
 * The server ranker, rebuilt to the design in docs/LINKUP_ALGORITHM_DESIGN.md §3.
 *
 * The deterministic engine in shared/linkup-match.js decides the order and the
 * band. Gemini has exactly two jobs, and both are bounded:
 *
 *   (a) tie-break — it may reorder only people whose scores are within
 *       6 points of each other, and one such hop at a time;
 *   (b) explain — it may only cite atoms that exist in that pair's evidence
 *       ledger, which was built before the call from the profiles themselves.
 *
 * If the model is slow, missing, rate-limited, or wrong, this route still
 * answers, from the engine alone. The app must never be blocked on a model.
 */

const MAX_TIE_CANDIDATES = 12;

const toMillis = (value) => (value?.toMillis ? value.toMillis() : typeof value === 'number' ? value : value ? Date.parse(value) || 0 : 0);

const dbSafe = () => {
  try {
    return getDb();
  } catch {
    return null;
  }
};

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
  } catch {
    /* a cache miss is just a miss */
  }
  const ranked = await compute();
  if (ref) await ref.set({ ranked, createdAt: Date.now() }).catch(() => {});
  return { ranked, cached: false };
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') {
    sendError(res, 405, 'Use POST for LINKUP introduction ranking.');
    return;
  }

  const user = await verifyRequestUser(req);
  if (!user?.uid) {
    sendError(res, 401, 'Sign in to rank introductions.');
    return;
  }

  try {
    const body = readJsonBody(req);
    const maxCandidates = Math.max(1, Math.min(20, Math.floor(Number(body.maxCandidates || 20))));
    const me = body.me || {};
    const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 40) : [];

    if (!me.uid || candidates.length === 0) {
      sendError(res, 400, 'Missing current profile or candidates.');
      return;
    }

    const cacheKey = `rank2_${crypto
      .createHash('sha1')
      .update(JSON.stringify([me, candidates, maxCandidates]))
      .digest('hex')
      .slice(0, 40)}`;

    const { ranked: rankedOut, cached } = await cachedRank(cacheKey, async () => {
      // L2 — deterministic scoring. This is the ranker.
      const corpus = buildCorpus([me, ...candidates]);
      const scored = candidates
        .map((candidate) => {
          const score = scorePair(me, candidate, { corpus });
          const card = composeCard(score);
          return {
            uid: score.uid,
            display: Math.round(score.display * 100),
            band: score.band,
            fit: score.fit,
            utility: score.utility,
            why: card.why,
            opener: card.opener,
            tiny_task: card.tiny_task,
            slot: card.slot,
            ledger: (score.ledger || []).filter((atom) => atom.kind === 'shared' || atom.kind === 'complement'),
            gated: score.gated,
            veto: score.veto,
          };
        })
        .filter((row) => !row.gated && row.veto === null && row.band.id !== 'hidden')
        .sort((left, right) => right.utility - left.utility)
        .slice(0, maxCandidates);

      const rows = scored;

      // L4 — the only model job. Bounded, validated, and optional.
      let final = rows;
      if (rows.length > 1) {
        const tieCandidates = rows.slice(0, MAX_TIE_CANDIDATES).map((row) => ({
          uid: row.uid,
          band: row.band.label,
          must_cite: row.ledger.slice(0, 3).map((atom) => String(atom.value)),
          shared: row.why.shared,
          complement: row.why.complement,
        }));

        try {
          const prompt = [
            'You are the explanation layer of LINKUP, a network where builders meet builders.',
            'You do NOT decide who is a good fit. A deterministic engine already scored these pairs.',
            'Your two jobs:',
            '1. Reorder ONLY people whose fit band is identical, and only when one specific piece of evidence makes the difference. Never move anyone more than one place.',
            '2. Write one reason per person, under 18 words, that uses ONLY the words in that person\'s must_cite list. No adjectives that are not evidenced. No claims about competence, money, health, family or appearance. No promises.',
            'Forbidden words: match, %, perfect, soulmate, synergy, chemistry, vibes, destined, compatible.',
            'Return STRICT JSON only, no markdown, no prose.',
            'Schema: {"order":["uid",...],"reasons":{"uid":"reason under 18 words"}}',
            `Candidates: ${JSON.stringify(tieCandidates)}`,
          ].join('\n');

          const text = await geminiText(prompt, {
            temperature: 0,
            maxOutputTokens: 700,
            responseMimeType: 'application/json',
          });

          const answer = parseModelAnswer(text, rows);
          if (answer) {
            if (answer.order.length) final = applyBandedOrder(rows, answer.order);
            final = final.map((row) =>
              answer.reasons[row.uid] ? { ...row, reason: answer.reasons[row.uid], reasonSource: 'model' } : { ...row, reasonSource: 'engine' }
            );
          }
        } catch {
          final = rows.map((row) => ({ ...row, reasonSource: 'engine' }));
        }
      }

      return final.map((row) => ({
        uid: row.uid,
        score: row.display,
        band: row.band,
        reason: row.reason || `${row.why.shared} ${row.why.complement}`.trim(),
        reasonSource: row.reasonSource || 'engine',
        why: row.why,
        opener: row.opener,
        tiny_task: row.tiny_task,
        slot: row.slot,
        cached: false,
      }));
    });

    setCors(res);
    res.status(200).json({
      ranked: rankedOut,
      meta: {
        engine: 'linkup-match',
        source: cached ? 'cache' : 'engine+model',
        tieBreakBand: TIE_BREAK_BAND,
        shortlistSize: rankedOut.length,
        cached,
      },
    });
  } catch (error) {
    sendError(res, 500, 'LINKUP ranking failed on Vercel.', error);
  }
}
