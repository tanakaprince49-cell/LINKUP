// POST /api/paynowWebhook
// Paynow's "Result URL": a server-to-server POST with the final status of a
// transaction. This is what actually grants the entitlement.
//
// CRITICAL: every request is hash-verified with the Integration Key before we
// touch a single document. Without that check anyone could POST
// "reference=whatever&status=Paid" and grant themselves PLUS for free.
import { getDb, serverTimestamp } from './_firebaseAdmin.js';
import { extendFrom, generateHash, paynowConfig, parsePaynowResponse } from './_paynow.js';

/** Paynow posts form-encoded, so we read the raw body ourselves. */
function readRawBody(req) {
  return new Promise((resolve) => {
    if (req.body) {
      resolve(typeof req.body === 'string' ? req.body : '');
      return;
    }
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const { key } = paynowConfig();
  if (!key) {
    // 200 so Paynow stops retrying; the misconfiguration is ours to fix.
    console.error('[paynowWebhook] PAYNOW_INTEGRATION_KEY is not set');
    res.status(200).send('OK');
    return;
  }

  const raw = await readRawBody(req);
  const payload = parsePaynowResponse(raw);

  // Verify BEFORE any state change. Field order is the received order, which
  // is exactly how Paynow built the hash on its side.
  if (generateHash(payload, key) !== String(payload.hash || '')) {
    console.error('[paynowWebhook] hash mismatch — rejected', JSON.stringify(payload));
    res.status(200).send('OK');
    return;
  }

  const reference = String(payload.reference || '').trim();
  const status = String(payload.status || '').toLowerCase();
  if (!reference) {
    res.status(200).send('OK');
    return;
  }

  const db = getDb();
  const txRef = db.collection('paynowTransactions').doc(reference);

  try {
    const snap = await txRef.get();
    if (!snap.exists()) {
      console.error('[paynowWebhook] unknown reference', reference);
      res.status(200).send('OK');
      return;
    }
    const tx = snap.data();

    if (status === 'paid' || status === 'awaiting delivery') {
      // Idempotent: a retried webhook must not extend the term twice.
      if (tx.status === 'paid') {
        res.status(200).send('OK');
        return;
      }

      const now = new Date();
      const subRef = db.collection('webSubscriptions').doc(tx.uid);
      const subSnap = await subRef.get();
      const existing = subSnap.exists() ? subSnap.data() : null;

      const endsAt = extendFrom(existing?.endsAt, now, tx.months || 1);

      await db.runTransaction(async (t) => {
        const fresh = await t.get(txRef);
        if (fresh.data()?.status === 'paid') return; // another invocation won
        t.set(txRef, {
          status: 'paid',
          paynowReference: payload.paynowreference || tx.paynowReference || '',
          paidAmount: Number(payload.amount || tx.amount || 0),
          paymentMethod: payload.method || '',
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
            endsAt,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      });
    } else if (['cancelled', 'failed', 'disputed', 'refunded'].includes(status)) {
      await txRef.set({ status, updatedAt: serverTimestamp() }, { merge: true });
    }
  } catch (error) {
    console.error('[paynowWebhook] processing failed', error?.message || error);
  }

  // Always 200 — anything else makes Paynow retry a payment we may have
  // already granted, and there is nothing a retry can fix from their side.
  res.status(200).send('OK');
}
