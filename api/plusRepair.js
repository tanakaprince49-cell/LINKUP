// POST /api/plusRepair
// Repairs the outward PLUS identity on users/{uid} (and publicProfiles/{uid})
// for a member with an active web PLUS term, and returns the public identity
// flags so a viewer can render the verified check / crown immediately.
//
// Server-trusted and additive: it can only ever write flags that are backed
// by an active webSubscriptions/{uid} PLUS term, so a signed-in caller naming
// any uid can neither grant nor revoke anything that isn't already paid for.
//
// Body:    { "uid": "<optional target>" }   (defaults to the caller)
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { ok, repaired, plus, flags: { isPro, isVerified, plan, ... } | null }
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import { getDb, verifyRequestUser } from './_firebaseAdmin.js';
import { repairWebIdentityFlags } from './_entitlements.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);
  if (req.method !== 'POST') {
    sendError(res, 405, 'Use POST to check PLUS identity.');
    return;
  }

  const user = await verifyRequestUser(req);
  if (!user?.uid) {
    sendError(res, 401, 'Sign in to check PLUS identity.');
    return;
  }

  const db = getDb();
  const body = readJsonBody(req);
  const uid = String(body?.uid || '').trim() || user.uid;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) {
    sendError(res, 400, 'Bad user id.');
    return;
  }

  const repaired = await repairWebIdentityFlags(db, uid).catch(() => false);

  // Return only the public identity fields — never the subscription internals
  // (planKey, references, amounts) that live in webSubscriptions.
  const userSnap = await db.collection('users').doc(uid).get().catch(() => null);
  const u = userSnap && userSnap.exists ? userSnap.data() || {} : {};
  const plus =
    !!u.isPro ||
    ['pro', 'plus'].includes(String(u.plan || '').toLowerCase()) ||
    ['pro', 'plus'].includes(String(u.subscriptionPlan || '').toLowerCase());

  res.status(200).json({
    ok: true,
    repaired: !!repaired,
    plus,
    flags: plus
      ? {
          isPro: true,
          isVerified: !!u.isVerified,
          plan: String(u.plan || 'plus'),
          subscriptionPlan: String(u.subscriptionPlan || 'plus'),
          subscriptionStatus: String(u.subscriptionStatus || 'active'),
          turboConnect: !!u.turboConnect,
        }
      : null,
  });
}
