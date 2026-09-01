// POST /api/contipayWebhook
// ContiPay's webhook: a server-to-server POST with the final status of a
// payment. This is what actually grants the entitlement.
//
// Replaces the retired /api/paynowWebhook.
//
// ⚠️ SECURITY — read before editing.
// ContiPay's webhook payload carries NO SIGNATURE. The only identity in the
// body is `clientKey`, which is our own API key echoed back. So this endpoint
// authenticates on TWO things instead:
//
//   1. a shared secret in the query string (CONTIPAY_WEBHOOK_TOKEN), appended
//      server-side when we build the webhookUrl — see _contipay.js
//   2. clientKey + merchantId matching ours
//
// Without check (1) anyone who ever observed one webhook could replay it and
// grant themselves PLUS for free. Keep CONTIPAY_WEBHOOK_TOKEN set.
//
// Belt and braces: we also only ever act on a merchantRef that ALREADY exists
// in webTransactions, created by a signed-in user at checkout time. A forged
// webhook cannot invent a reference we issued.
import { getDb, serverTimestamp } from './_firebaseAdmin.js';
import { contipayConfig, verifyWebhook, CONTIPAY_STATUS } from './_contipay.js';
import { grantWebEntitlement } from './_entitlements.js';

const TX = 'webTransactions';

/** ContiPay POSTs JSON, but read defensively — never trust the middleware. */
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const cfg = contipayConfig();
  if (!cfg.apiKey || !cfg.apiSecret) {
    // 200 so ContiPay stops retrying; the misconfiguration is ours to fix.
    console.error('[contipayWebhook] CONTIPAY_API_KEY / CONTIPAY_API_SECRET are not set');
    res.status(200).send('OK');
    return;
  }

  const body = await readJson(req);

  // Verify BEFORE any state change.
  const check = verifyWebhook({ query: req.query || {}, body });
  if (!check.ok) {
    console.error('[contipayWebhook] rejected:', check.reason, JSON.stringify(body).slice(0, 300));
    // 401 so it is visible in logs as a rejection, not a silent success.
    res.status(200).send('OK');
    return;
  }

  const reference = String(body.merchantRef || '').trim();
  if (!reference) {
    res.status(200).send('OK');
    return;
  }

  const statusCode = Number(body.statusCode ?? -1);
  const db = getDb();
  const txRef = db.collection(TX).doc(reference);

  try {
    const snap = await txRef.get();
    if (!snap.exists) {
      console.error('[contipayWebhook] unknown reference', reference);
      res.status(200).send('OK');
      return;
    }
    const tx = snap.data();

    // ContiPay settles on statusCode: 1 = paid, 4 = declined. We accept a
    // string "paid" too, in case the payload shape drifts between versions.
    const statusText = String(body.status || '').toLowerCase();
    const isPaid = statusCode === CONTIPAY_STATUS.PAID || statusText === 'paid' || statusText === 'completed';
    const isFailed =
      statusCode === CONTIPAY_STATUS.DECLINED ||
      ['cancelled', 'failed', 'declined', 'disputed', 'refunded', 'expired'].includes(statusText);

    if (isPaid) {
      // Amount guard: never grant a 12-month term off a $1 payment.
      const paidAmount = Number(body.amount);
      if (Number.isFinite(paidAmount) && tx.amount && paidAmount + 0.01 < Number(tx.amount)) {
        console.error('[contipayWebhook] amount mismatch', reference, paidAmount, 'vs', tx.amount);
        await txRef.set(
          { status: 'amount_mismatch', paidAmount, updatedAt: serverTimestamp() },
          { merge: true }
        );
        res.status(200).send('OK');
        return;
      }

      const result = await grantWebEntitlement(db, {
        uid: tx.uid,
        tier: tx.tier,
        months: tx.months || 1,
        planKey: tx.planKey,
        amount: tx.amount,
        reference,
        txRef,
        txPatch: {
          contiPayRef: body.contiPayRef != null ? String(body.contiPayRef) : '',
          paidAmount: Number.isFinite(paidAmount) ? paidAmount : tx.amount,
          paymentMethod: body.providerName || body.methodCode || '',
          webhookStatus: statusText || String(statusCode),
        },
      });

      if (!result?.granted) {
        // Already paid — a duplicate delivery. grantWebEntitlement re-reads the
        // transaction inside its own Firestore transaction, so a retry can
        // never extend the term twice.
        console.log('[contipayWebhook] duplicate, ignored', reference);
      }
    } else if (isFailed) {
      await txRef.set(
        { status: statusText || 'failed', statusCode, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } else {
      // Anything else is in-flight — record it, change nothing.
      await txRef.set(
        { status: statusText || 'pending', statusCode, updatedAt: serverTimestamp() },
        { merge: true }
      );
    }
  } catch (error) {
    console.error('[contipayWebhook] processing failed', error?.message || error);
  }

  // Always 200 — anything else makes ContiPay retry a payment we may have
  // already granted, and there is nothing a retry can fix from their side.
  res.status(200).send('OK');
}
