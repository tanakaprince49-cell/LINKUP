// POST /api/contipayStatus
// What the client asks after the browser comes back from ContiPay's hosted
// page: did the payment land, and what do I now have?
//
// Replaces the retired /api/paynowStatus.
//
// NOTE ON RECONCILIATION: ContiPay retry webhooks up to 10 times over ~24h,
// but a webhook can still be delayed. Their docs point at a "transaction status
// inquiry endpoint" for exactly this; they do not publish its path in the
// guides we have, so it is wired through CONTIPAY_STATUS_PATH and stays dormant
// until that is set. See inquireTransaction() in _contipay.js — it returns null
// when unconfigured, and null means UNKNOWN, never "not paid".
//
// Body:    { "reference": "LKP-..." }
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { "status": "paid" | "pending" | "failed" | ..., "entitlement": {...} | null }
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import { getDb, verifyRequestUser } from './_firebaseAdmin.js';
import { readWebEntitlement } from './_entitlements.js';
import { classifyStatus, inquireTransaction } from './_contipay.js';

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

  // Still not final on our side? Try the status inquiry endpoint, if configured.
  // This is what catches a payment whose webhook is late or was lost.
  if (!['paid', 'failed', 'declined', 'cancelled', 'expired'].includes(status)) {
    const inquired = await inquireTransaction(reference);
    const verdict = inquired ? classifyStatus(inquired.statusCode ?? inquired.status, inquired.status) : null;
    if (verdict === 'paid' || verdict === 'failed') {
      // Deliberately conservative: we only ever record what ContiPay says here.
      // Granting is the webhook's job, so a lost webhook is escalated rather
      // than silently settled from an unverified shape.
      await db.collection(TX).doc(reference).set(
        { status: verdict, inquiredAt: new Date(), updatedAt: new Date() },
        { merge: true }
      );
      status = verdict;
    }
  }

  // Per-tier, so the client can tell PLUS from Campaigns on the same account.
  const entitlement = await readWebEntitlement(db, user.uid);

  res.status(200).json({ reference, status, entitlement });
}
