// POST /api/payonifyStatus
// What the client asks after the browser comes back from Payonify's hosted
// page: did the payment land, and what do I now have?
//
// This is a safety net for late/lost webhooks — the server checks the stored
// transaction status and optionally retrieves the session from Payonify's API.
//
// Body:    { "reference": "LKP-..." }
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { "status": "paid" | "pending" | "failed" | ..., "entitlement": {...} | null }
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import { getDb, verifyRequestUser } from './_firebaseAdmin.js';
import { readWebEntitlement } from './_entitlements.js';
import { classifyStatus, retrieveCheckoutSession } from './_payonify.js';

const TX = 'webTransactions';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);
  if (req.method !== 'POST') {
    sendError(res, 405, 'Use POST to check a payment status.');
    return;
  }

  const user = await verifyRequestUser(req);
  if (!user?.uid) {
    sendError(res, 401, 'Sign in to check a payment.');
    return;
  }

  const body = await readJsonBody(req);
  const reference = String(body?.reference || '').trim();
  if (!reference) {
    sendError(res, 400, 'Missing reference.');
    return;
  }

  const db = getDb();
  const snap = await db.collection(TX).doc(reference).get();
  if (!snap.exists) {
    sendError(res, 404, 'Unknown payment reference.');
    return;
  }
  const tx = snap.data();

  // Nobody may read someone else's payment.
  if (tx.uid !== user.uid) {
    sendError(res, 403, 'This payment belongs to another account.');
    return;
  }

  let status = String(tx.status || 'pending').toLowerCase();

  // Still not final on our side? Try retrieving the session from Payonify.
  // This catches a payment whose webhook is delayed or was lost.
  if (!['paid', 'failed', 'declined', 'cancelled', 'expired'].includes(status)) {
    const sessionId = String(tx.payonifySessionId || '').trim();
    if (sessionId) {
      const session = await retrieveCheckoutSession(sessionId);
      if (session?.payment_status) {
        const verdict = classifyStatus(session.payment_status);
        if (verdict === 'paid' || verdict === 'failed') {
          await db.collection(TX).doc(reference).set(
            { status: verdict, payonifyStatus: session.payment_status, updatedAt: new Date() },
            { merge: true }
          );
          status = verdict;
        }
      }
    }
  }

  // Per-tier, so the client can tell PLUS from Campaigns on the same account.
  const entitlement = await readWebEntitlement(db, user.uid);

  res.status(200).json({ reference, status, entitlement });
}
