// POST /api/contipayStatus
// What the client asks after the browser comes back from ContiPay's hosted
// page: did the payment land, and what do I now have?
//
// Replaces the retired /api/paynowStatus.
//
// NOTE ON POLLING: Paynow handed us a pollUrl so we could confirm a payment
// even when its webhook never arrived. ContiPay's documented flow has no
// equivalent lookup endpoint, so this route reports OUR state — which the
// webhook writes — rather than guessing at an undocumented API. If ContiPay
// publish a transaction-lookup route, add it to _contipay.js and call it from
// the `pending` branch below; do not invent a URL here.
//
// Body:    { "reference": "LKP-..." }
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { "status": "paid" | "pending" | "failed" | ..., "entitlement": {...} | null }
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import { getDb, verifyRequestUser } from './_firebaseAdmin.js';
import { readWebEntitlement } from './_entitlements.js';

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

  // Per-tier, so the client can tell PLUS from Campaigns on the same account.
  const entitlement = await readWebEntitlement(db, user.uid);

  res.status(200).json({
    reference,
    status: String(tx.status || 'pending').toLowerCase(),
    entitlement,
  });
}
