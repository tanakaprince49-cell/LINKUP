// POST /api/contipayWebhook
// ContiPay's webhook: a server-to-server POST with the final status of a
// payment. This is what actually grants the entitlement.
//
// Replaces the retired /api/paynowWebhook.
//
// ⚠️ SECURITY — read before editing.
// ContiPay authenticate webhook delivery with a token they send in the
// Authorization header:
//
//     Authorization: Bearer <CONTIPAY_WEBHOOK_TOKEN>
//
// The JSON body carries NO signature. `clientKey` in the body is just our own
// Auth Key echoed back, so it is corroboration, never proof. So:
//
//   1. the Bearer token is checked first, before the body is even parsed
//   2. clientKey + merchantId must match ours
//   3. the merchantRef must already exist in webTransactions, created by a
//      signed-in user at checkout — a forged webhook cannot invent one
//   4. amount AND currency must match what we recorded
//
// Their guidance is explicit that the token must never go in the webhook URL,
// so it is not — see webhookUrl() in _contipay.js.
//
// Never log the raw body (it contains clientKey = our Auth Key) or the
// Authorization header. Use redactWebhook().
import { getDb, serverTimestamp } from './_firebaseAdmin.js';
import {
  classifyStatus,
  contipayConfig,
  redactWebhook,
  verifyWebhook,
} from './_contipay.js';
import { grantWebEntitlement } from './_entitlements.js';

const TX = 'webTransactions';
const EVENTS = 'contipayWebhookEvents';

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

/**
 * Idempotency guard keyed on contiPayRef, which is ContiPay's own unique id
 * for the payment and therefore the right dedupe key for a re-delivered
 * webhook. Returns true if this is the first time we have seen it.
 */
async function claimEvent(db, contiPayRef, reference) {
  const id = String(contiPayRef || '').trim();
  if (!id) return true; // nothing to dedupe on — fall through to tx-level guard
  const ref = db.collection(EVENTS).doc(id);
  try {
    const created = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (snap.exists) return false;
      t.set(ref, { contiPayRef: id, merchantRef: String(reference || ''), receivedAt: serverTimestamp() });
      return true;
    });
    return created;
  } catch {
    // If the claim itself fails, do not silently drop the payment — let the
    // transaction-level guard in grantWebEntitlement catch a duplicate.
    return true;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const cfg = contipayConfig();
  if (!cfg.apiKey || !cfg.apiSecret) {
    // 200 so ContiPay stops retrying; the misconfiguration is ours to fix.
    console.error('[contipayWebhook] CONTIPAY_AUTH_KEY / CONTIPAY_AUTH_SECRET are not set');
    res.status(200).send('OK');
    return;
  }

  const body = await readJson(req);

  // Verify BEFORE any state change, and before touching the database.
  const check = verifyWebhook({ headers: req.headers || {}, body });
  if (!check.ok) {
    console.error('[contipayWebhook] rejected:', check.reason, JSON.stringify(redactWebhook(body)));
    res.status(200).send('OK');
    return;
  }

  const reference = String(body.merchantRef || '').trim();
  if (!reference) {
    console.error('[contipayWebhook] no merchantRef', JSON.stringify(redactWebhook(body)));
    res.status(200).send('OK');
    return;
  }

  const verdict = classifyStatus(body.statusCode, body.status);
  const db = getDb();
  const txRef = db.collection(TX).doc(reference);
  const safe = redactWebhook(body);

  try {
    const snap = await txRef.get();
    if (!snap.exists) {
      console.error('[contipayWebhook] unknown reference', JSON.stringify(safe));
      res.status(200).send('OK');
      return;
    }
    const tx = snap.data();

    // Record the update, but never let a non-final status settle the order.
    if (verdict === 'delayed' || verdict === 'review') {
      await txRef.set(
        { status: String(body.status || 'pending').toLowerCase(), statusCode: Number(body.statusCode ?? -1), updatedAt: serverTimestamp() },
        { merge: true }
      );
      console.log('[contipayWebhook] not final, waiting:', verdict, JSON.stringify(safe));
      res.status(200).send('OK');
      return;
    }

    // Currency guard next: a USD price paid in something else is not a match.
    const paidCurrency = String(body.currencyCode || '').toUpperCase();
    if (tx.currency && paidCurrency && paidCurrency !== String(tx.currency).toUpperCase()) {
      console.error('[contipayWebhook] currency mismatch', reference, paidCurrency, 'vs', tx.currency);
      await txRef.set({ status: 'currency_mismatch', paidCurrency, updatedAt: serverTimestamp() }, { merge: true });
      res.status(200).send('OK');
      return;
    }

    if (verdict === 'paid') {
      // Amount guard: never grant a 12-month term off a $1 payment.
      const paidAmount = Number(body.amount);
      if (Number.isFinite(paidAmount) && tx.amount && paidAmount + 0.01 < Number(tx.amount)) {
        console.error('[contipayWebhook] amount mismatch', reference, paidAmount, 'vs', tx.amount);
        await txRef.set({ status: 'amount_mismatch', paidAmount, updatedAt: serverTimestamp() }, { merge: true });
        res.status(200).send('OK');
        return;
      }

      // ContiPay retries up to 10 times over ~24h. Dedupe on contiPayRef first,
      // then let the transaction-level guard catch anything that slips past.
      const fresh = await claimEvent(db, body.contiPayRef, reference);
      if (!fresh) {
        console.log('[contipayWebhook] duplicate contiPayRef, acknowledged', JSON.stringify(safe));
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
          paidCurrency: paidCurrency || tx.currency || '',
          paymentMethod: body.providerName || body.methodCode || '',
          providerCode: body.providerCode || '',
          correlator: body.correlator || '',
          webhookStatus: String(body.status || String(body.statusCode ?? '')),
        },
      });

      if (!result?.granted) {
        // Already paid — grantWebEntitlement re-reads the transaction inside its
        // own Firestore transaction, so a retry can never extend the term twice.
        console.log('[contipayWebhook] already granted, ignored', JSON.stringify(safe));
      } else {
        console.log('[contipayWebhook] granted', JSON.stringify(safe));
      }
    } else {
      // verdict === 'failed' — final.
      await txRef.set(
        {
          status: String(body.status || 'failed').toLowerCase(),
          statusCode: Number(body.statusCode ?? -1),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      console.log('[contipayWebhook] final failure', JSON.stringify(safe));
    }
  } catch (error) {
    console.error('[contipayWebhook] processing failed', error?.message || error, JSON.stringify(safe));
  }

  // Always 200 within 10s — anything else makes ContiPay retry a payment we may
  // have already granted, and there is nothing a retry can fix from their side.
  res.status(200).send('OK');
}
