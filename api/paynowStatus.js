// POST /api/paynowStatus
// The safety net. Paynow's webhook is not always delivered, so the client
// calls this after returning from the Paynow page: if we have not marked the
// transaction paid yet, we ask Paynow directly via the poll URL, then grant.
//
// Body:    { "reference": "LKP-..." }
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { "status": "paid" | "pending" | "failed" | ..., "entitlement": {...} | null }
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import { getDb, serverTimestamp, verifyRequestUser } from './_firebaseAdmin.js';
import { extendFrom, paynowConfig, pollTransaction } from './_paynow.js';

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
  const txRef = db.collection('paynowTransactions').doc(reference);
  const snap = await txRef.get();
  if (!snap.exists()) {
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

  // Still unpaid on our side? Ask Paynow.
  if (status !== 'paid' && tx.pollUrl) {
    const polled = await pollTransaction(tx.pollUrl).catch(() => null);
    const paynowStatus = String(polled?.status || '').toLowerCase();
    if (polled && ['paid', 'awaiting delivery', 'cancelled', 'failed'].includes(paynowStatus)) {
      const isPaid = paynowStatus === 'paid' || paynowStatus === 'awaiting delivery';
      if (isPaid) {
        const now = new Date();
        const subRef = db.collection('webSubscriptions').doc(tx.uid);
        const subSnap = await subRef.get();
        const existing = subSnap.exists() ? subSnap.data() : null;

        await db.runTransaction(async (t) => {
          const fresh = await t.get(txRef);
          if (fresh.data()?.status === 'paid') return;
          t.set(txRef, {
            status: 'paid',
            paynowReference: polled.paynowreference || tx.paynowReference || '',
            paidAmount: Number(polled.amount || tx.amount || 0),
            paidAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          t.set(
            subRef,
            {
              uid: tx.uid,
              tier: tx.tier,
              status: 'active',
              lastPlanKey: tx.planKey,
              lastReference: reference,
              lastAmount: tx.amount,
              startedAt: existing?.startedAt || serverTimestamp(),
              endsAt: extendFrom(existing?.endsAt, now, tx.months || 1),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        });
        status = 'paid';
      } else {
        await txRef.set({ status: paynowStatus, updatedAt: serverTimestamp() }, { merge: true });
        status = paynowStatus;
      }
    }
  }

  let entitlement = null;
  if (status === 'paid') {
    const subSnap = await db.collection('webSubscriptions').doc(user.uid).get();
    if (subSnap.exists()) {
      const sub = subSnap.data();
      const endsMs = sub.endsAt?.toMillis ? sub.endsAt.toMillis() : Number(sub.endsAt || 0);
      entitlement = {
        tier: sub.tier,
        status: endsMs > Date.now() ? 'active' : 'expired',
        endsAt: endsMs || null,
      };
    }
  }

  res.status(200).json({ reference, status, entitlement });
}
