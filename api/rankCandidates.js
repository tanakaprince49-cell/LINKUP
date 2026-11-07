import crypto from 'node:crypto';
import { getDb, verifyRequestUser } from './_firebaseAdmin.js';
import { geminiText, handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import {
  MODEL_VERSION,
  TIE_BREAK_BAND,
  applyBandedOrder,
  buildCorpus,
  composeCard,
  eligibility,
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
    if (snap && snap.exists && Date.now() - toMillis(snap.data().createdAt) < 60 * 60 * 1000) {
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
    const submittedMe = body.me || {};
    const submitted = Array.isArray(body.candidates) ? body.candidates.slice(0, 40) : [];

    if (!submittedMe.uid || String(submittedMe.uid) !== String(user.uid) || submitted.length === 0) {
      sendError(res, 400, 'Missing current profile or candidates.');
      return;
    }

    const db = dbSafe();
    if (!db) {
      sendError(res, 503, 'Trusted profile data is unavailable.');
      return;
    }
    const candidateIds = [...new Set(submitted.map((row) => String(row?.uid || '')).filter((uid) => /^[A-Za-z0-9_-]{1,128}$/.test(uid) && uid !== user.uid))];
    if (!candidateIds.length) {
      sendError(res, 400, 'No eligible candidates were supplied.');
      return;
    }
    const userRefs = [db.collection('users').doc(user.uid), ...candidateIds.map((uid) => db.collection('users').doc(uid))];
    const publicRefs = candidateIds.map((uid) => db.collection('publicProfiles').doc(uid));
    const blockRefs = candidateIds.flatMap((uid) => [
      db.collection('blocks').doc(`${user.uid}_${uid}`),
      db.collection('blocks').doc(`${uid}_${user.uid}`),
    ]);
    const [userSnapshots, publicSnapshots, blockSnapshots] = await Promise.all([
      db.getAll(...userRefs),
      db.getAll(...publicRefs),
      db.getAll(...blockRefs),
    ]);
    const viewerUser = userSnapshots[0]?.exists ? { uid: user.uid, ...userSnapshots[0].data() } : null;
    if (!viewerUser || viewerUser.deleted || viewerUser.banned || viewerUser.onboarded !== true) {
      sendError(res, 403, 'Your profile is not eligible for introduction ranking.');
      return;
    }
    const blocked = new Set();
    for (let index = 0; index < candidateIds.length; index += 1) {
      if (blockSnapshots[index * 2]?.exists || blockSnapshots[index * 2 + 1]?.exists) blocked.add(candidateIds[index]);
    }
    const canonicalCandidates = [];
    for (let index = 0; index < candidateIds.length; index += 1) {
      const uid = candidateIds[index];
      const userSnap = userSnapshots[index + 1];
      const publicSnap = publicSnapshots[index];
      if (!userSnap?.exists || !publicSnap?.exists || blocked.has(uid)) continue;
      const candidate = { ...publicSnap.data(), uid, ...((({ banned, deleted, onboarded, isVisible, isStealthMode, settings }) => ({ banned, deleted, onboarded, isVisible, isStealthMode, settings }))(userSnap.data())) };
      if (!eligibility(viewerUser, candidate).eligible) continue;
      // Score only canonical public profile fields. Client payload is used to
      // identify candidates, never as authority for another member's profile.
      canonicalCandidates.push(candidate);
    }
    if (!canonicalCandidates.length) {
      setCors(res);
      res.status(200).json({ ranked: [], meta: { engine: 'linkup-match', source: 'engine', shortlistSize: 0, cached: false } });
      return;
    }
    const me = viewerUser;
    const candidates = canonicalCandidates;
    const feedbackSnapshot = await db.collection('builderStates').doc(user.uid).get().catch(() => null);
    const rawFeedback = feedbackSnapshot?.exists ? feedbackSnapshot.data()?.feedback || {} : {};
    const feedback = Object.fromEntries(Object.entries(rawFeedback).filter(([, entry]) => {
      const at = toMillis(entry?.at);
      return at && Date.now() - at <= 90 * 86400000 && ['relevant', 'not_relevant', 'contacted'].includes(entry?.status);
    }));

    const cacheKey = `rank3_${crypto
      .createHash('sha1')
      .update(JSON.stringify([user.uid, me, candidates, maxCandidates, feedback, MODEL_VERSION]))
      .digest('hex')
      .slice(0, 40)}`;

    const { ranked: rankedOut, cached } = await cachedRank(cacheKey, async () => {
      // L2 — deterministic scoring. One clock snapshot keeps recency features stable.
      const rankingNow = Date.now();
      const corpus = buildCorpus([me, ...candidates], { now: rankingNow });
      const scored = candidates
        .map((candidate) => {
          const score = scorePair(me, candidate, { corpus, now: rankingNow, feedback: feedback[candidate.uid] || null });
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
        const tieRows = rows.slice(0, MAX_TIE_CANDIDATES);
        const tieCandidates = tieRows.map((row) => ({
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
            '1. Return every uid exactly once. Reorder only adjacent people in the SAME band, never more than one position, and only when cited evidence makes the difference.',
            '2. Write one reason per person, under 18 words, grounded in that person\'s must_cite list. No unsupported adjectives or claims about competence, money, health, family or appearance. No promises.',
            'Forbidden words: match, %, perfect, soulmate, synergy, chemistry, vibes, destined, compatible.',
            'Return STRICT JSON only, no markdown, no prose.',
            'Schema: {"order":["uid",...],"reasons":{"uid":"reason under 18 words"}}',
            `Candidates: ${JSON.stringify(tieCandidates)}`,
          ].join('\n');

          const text = await geminiText(prompt, {
            temperature: 0,
            maxOutputTokens: 700,
            responseMimeType: 'application/json',
            timeoutMs: 2500,
            disableProviderFailover: true,
            disableCapacityRetry: true,
            singleModel: true,
          });

          const answer = parseModelAnswer(text, tieRows);
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
        modelVersion: MODEL_VERSION,
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
