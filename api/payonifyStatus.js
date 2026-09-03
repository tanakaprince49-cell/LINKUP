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
import { grantWebEntitlement } from './_entitlements.js';

const TX = 'webTransactions';


/**
 * Ask Payonify for the session behind a transaction that is not final on our
 * side and settle it. This is the safety net for a webhook that was delayed,
 * lost, or - as happened in Sep 2026 - silently dropped by our own event-type
 * filter. Payonify itself is the source of truth (server-to-server, Basic
 * auth with the secret key), so a confirmed `succeeded` is as trustworthy as
 * the webhook and we GRANT from it, with the same amount/currency guards.
 *
 * Returns the new status ('paid' | 'failed' | 'amount_mismatch' |
 * 'currency_mismatch') or null when nothing changed.
 */
async function reconcileTransaction(db, reference, tx) {
  const sessionId = String(tx?.payonifySessionId || '').trim();
  if (!sessionId) return null;
  const session = await retrieveCheckoutSession(sessionId);
  if (!session?.payment_status) return null;
  const verdict = classifyStatus(session.payment_status);
  const txRef = db.collection(TX).doc(reference);

  if (verdict === 'failed') {
    await txRef.set({ status: 'failed', payonifyStatus: session.payment_status, updatedAt: new Date() }, { merge: true });
    return 'failed';
  }
  if (verdict !== 'paid') return null;

  const paidAmount = Number(session?.amount_total ?? session?.amount?.value) / 100;
  const paidCurrency = String(session?.currency || session?.amount?.currency || tx.currency || '').toUpperCase();
  const amountOk = !Number.isFinite(paidAmount) || !tx.amount || paidAmount + 0.01 >= Number(tx.amount);
  const currencyOk = !tx.currency || !paidCurrency || paidCurrency === String(tx.currency).toUpperCase();
  if (!amountOk || !currencyOk) {
    const status = amountOk ? 'currency_mismatch' : 'amount_mismatch';
    await txRef.set({ status, paidAmount, paidCurrency, updatedAt: new Date() }, { merge: true });
    return status;
  }

  const meta = session?.metadata || {};
  await grantWebEntitlement(db, {
    uid: tx.uid,
    tier: meta.tier || tx.tier,
    months: Number(meta.months) || tx.months || 1,
    planKey: meta.planKey || tx.planKey,
    amount: tx.amount,
    reference,
    txRef,
    txPatch: {
      payonifyStatus: session.payment_status,
      paidAmount: Number.isFinite(paidAmount) ? paidAmount : tx.amount,
      paidCurrency,
      paymentMethod: session?.payment_method || '',
      grantedVia: 'status-poll',
    },
  });
  return 'paid';
}

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
  const db = getDb();
  let reference = String(body?.reference || '').trim();

  // No reference (the "Restore purchases" button, or a return trip whose
  // sessionStorage was already consumed): reconcile the caller's own recent
  // payments that never reached a final state, newest first. Scoped to the
  // signed-in uid, so nobody can probe anyone else's transactions.
  if (!reference) {
    // Single equality filter only - needs no composite index. References are
    // 'LKP-<uid8>-<epoch ms>', so sorting by id descending is newest first.
    const recent = await db.collection(TX).where('uid', '==', user.uid).limit(50).get().catch(() => null);
    const candidates = (recent?.docs || [])
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((t) => String(t.gateway || '') === 'payonify')
      .filter((t) => !['paid', 'failed', 'declined', 'cancelled', 'expired', 'amount_mismatch', 'currency_mismatch'].includes(String(t.status || '').toLowerCase()))
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, 5);
    let reconciled = null;
    for (const t of candidates) {
      const outcome = await reconcileTransaction(db, t.id, t);
      if (outcome === 'paid') { reconciled = { reference: t.id, status: 'paid' }; break; }
    }
    const entitlement = await readWebEntitlement(db, user.uid);
    res.status(200).json({
      reference: reconciled?.reference || null,
      status: reconciled?.status || (candidates.length ? 'pending' : 'none'),
      checked: candidates.length,
      entitlement,
    });
    return;
  }

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

  if (!['paid', 'failed', 'declined', 'cancelled', 'expired'].includes(status)) {
    const outcome = await reconcileTransaction(db, reference, tx);
    if (outcome) status = outcome;
  }

  // Per-tier, so the client can tell PLUS from Campaigns on the same account.
  const entitlement = await readWebEntitlement(db, user.uid);

  res.status(200).json({ reference, status, entitlement });
}
