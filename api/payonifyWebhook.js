// POST /api/payonifyWebhook
// Payonify's webhook: a server-to-server POST with the final status of a
// checkout session. This is what actually grants the entitlement.
//
// SECURITY — read before editing.
// Payonify signs webhook payloads with HMAC-SHA256 using your webhook secret.
// The signature is sent in the Payonify-Signature header:
//
//   Payonify-Signature: t=1234567890,v1=abc123...
//
// Verification steps:
//   1. Extract timestamp (t) and signature (v1) from the header
//   2. Concatenate: {timestamp}.{raw_request_body}
//   3. Compute HMAC-SHA256 using PAYONIFY_WEBHOOK_SECRET
//   4. Compare with received signature (timing-safe)
//   5. Verify timestamp is within 5 minutes
//
// Never log the raw body or the signature header.
import { getDb, serverTimestamp } from './_firebaseAdmin.js';
import {
  classifyStatus,
  payonifyConfig,
  redactWebhook,
  retrieveCheckoutSession,
  verifyWebhookSignature,
} from './_payonify.js';
import { grantWebEntitlement } from './_entitlements.js';

const TX = 'webTransactions';
const EVENTS = 'payonifyWebhookEvents';

/** Payonify POSTs JSON, but read defensively — never trust the middleware. */
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
 * Read the raw body for signature verification. Payonify needs the exact
 * bytes that were signed, so we must capture them before JSON parsing.
 */
function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(data || '{}'));
    req.on('error', () => resolve('{}'));
  });
}

/**
 * Idempotency guard keyed on Payonify's event ID.
 * Returns true if this is the first time we have seen it.
 */
async function claimEvent(db, eventId, reference) {
  const id = String(eventId || '').trim();
  if (!id) return true;
  const ref = db.collection(EVENTS).doc(id);
  try {
    const created = await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (snap.exists) return false;
      t.set(ref, { eventId: id, merchantRef: String(reference || ''), receivedAt: serverTimestamp() });
      return true;
    });
    return created;
  } catch {
    return true;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const cfg = payonifyConfig();
  if (!cfg.secretKey) {
    console.error('[payonifyWebhook] PAYONIFY_SECRET_KEY is not set');
    res.status(200).send('OK');
    return;
  }

  // Read raw body first for signature verification.
  const rawBody = await readRawBody(req);

  // Verify webhook signature BEFORE any state change.
  const signature = req.headers?.['payonify-signature'] || req.headers?.['Payonify-Signature'] || '';
  const sigCheck = await verifyWebhookSignature(rawBody, signature);
  if (!sigCheck.ok && sigCheck.reason !== 'no-secret-configured') {
    console.error('[payonifyWebhook] signature verification failed:', sigCheck.reason);
    res.status(200).send('OK');
    return;
  }

  const body = await readJson(req);
  const eventType = String(body?.type || '');

  // Payonify's event names (docs.payonify.com/webhooks):
  //   checkout.succeeded / checkout.failed   - hosted checkout session
  //   charge.succeeded  / charge.failed      - the underlying charge
  // This used to filter on `checkout.session.*`, which Payonify never sends,
  // so every real event was acknowledged with 200 and dropped - the customer
  // paid, Payonify showed "successful", and nothing was ever granted.
  // Accept both spellings plus the Stripe-style one in case it ever appears.
  if (!/^(checkout|charge)(\.session)?\.(succeeded|failed|completed|expired|cancelled|canceled)$/.test(eventType)) {
    console.log('[payonifyWebhook] ignoring event type', eventType);
    res.status(200).send('OK');
    return;
  }

  let session = body?.data?.object;
  if (!session) {
    console.error('[payonifyWebhook] no object in event');
    res.status(200).send('OK');
    return;
  }

  // Our reference lives in the checkout session's metadata. A charge event
  // carries the charge, not the session, and its metadata may be empty - so
  // if the reference is missing, resolve the session from whatever id we have
  // (checkout session id, or the charge's checkout reference) and read it
  // from there.
  let reference = String(session?.metadata?.reference || '').trim();
  if (!reference) {
    const sessionId = String(
      (String(session?.id || '').startsWith('cs_') ? session.id : '') ||
      session?.checkout_session ||
      session?.checkout_session_id ||
      session?.checkout_reference ||
      ''
    ).trim();
    const retrieved = sessionId ? await retrieveCheckoutSession(sessionId) : null;
    if (retrieved?.metadata?.reference) {
      session = { ...retrieved, ...session, metadata: retrieved.metadata, payment_status: retrieved.payment_status || session.payment_status };
      reference = String(retrieved.metadata.reference).trim();
    }
  }
  if (!reference) {
    // Last resort: client_reference_id is set to our reference at creation.
    reference = String(session?.client_reference_id || '').trim();
  }
  if (!reference) {
    console.error('[payonifyWebhook] no reference in event', JSON.stringify(redactWebhook(body)));
    res.status(200).send('OK');
    return;
  }

  // A *.succeeded / *.failed event type is itself the verdict; the object's
  // payment_status is the tie-breaker when the type is neutral.
  const typeVerdict = /\.succeeded$|\.completed$/.test(eventType)
    ? 'succeeded'
    : /\.failed$|\.expired$|\.cancell?ed$/.test(eventType)
      ? 'failed'
      : '';
  const paymentStatus = String(session?.payment_status || typeVerdict || session?.status || '');
  const verdict = classifyStatus(paymentStatus) === 'delayed' && typeVerdict
    ? classifyStatus(typeVerdict)
    : classifyStatus(paymentStatus);
  const db = getDb();
  const txRef = db.collection(TX).doc(reference);
  const safe = redactWebhook(body);

  try {
    const snap = await txRef.get();
    if (!snap.exists) {
      console.error('[payonifyWebhook] unknown reference', JSON.stringify(safe));
      res.status(200).send('OK');
      return;
    }
    const tx = snap.data();

    // Record the update, but never let a non-final status settle the order.
    if (verdict === 'delayed') {
      await txRef.set(
        { status: 'pending', payonifyStatus: paymentStatus, updatedAt: serverTimestamp() },
        { merge: true }
      );
      console.log('[payonifyWebhook] not final, waiting:', verdict, JSON.stringify(safe));
      res.status(200).send('OK');
      return;
    }

    if (verdict === 'paid') {
      // Retrieve full session from Payonify to get metadata (uid, planKey, etc.)
      // The webhook event may not include all metadata fields.
      let fullSession = session;
      if (!session?.metadata?.uid) {
        const retrieved = await retrieveCheckoutSession(session.id);
        if (retrieved?.metadata) {
          fullSession = retrieved;
        }
      }

      const txUid = fullSession?.metadata?.uid || tx.uid;
      const txPlanKey = fullSession?.metadata?.planKey || tx.planKey;
      const txTier = fullSession?.metadata?.tier || tx.tier;
      const txMonths = Number(fullSession?.metadata?.months) || tx.months || 1;

      // Currency guard
      const paidCurrency = String(
        session?.currency || (typeof session?.amount === 'object' ? session?.amount?.currency : '') || tx.currency || ''
      ).toUpperCase();
      if (tx.currency && paidCurrency && paidCurrency !== String(tx.currency).toUpperCase()) {
        console.error('[payonifyWebhook] currency mismatch', reference, paidCurrency, 'vs', tx.currency);
        await txRef.set({ status: 'currency_mismatch', paidCurrency, updatedAt: serverTimestamp() }, { merge: true });
        res.status(200).send('OK');
        return;
      }

      // Amount guard: never grant a 12-month term off a $1 payment.
      // Sessions carry amount_total (cents); charges carry amount.value (cents).
      const rawAmount =
        session?.amount_total ??
        (typeof session?.amount === 'object' ? session?.amount?.value : session?.amount);
      const paidAmount = Number(rawAmount) / 100;
      if (Number.isFinite(paidAmount) && tx.amount && paidAmount + 0.01 < Number(tx.amount)) {
        console.error('[payonifyWebhook] amount mismatch', reference, paidAmount, 'vs', tx.amount);
        await txRef.set({ status: 'amount_mismatch', paidAmount, updatedAt: serverTimestamp() }, { merge: true });
        res.status(200).send('OK');
        return;
      }

      // Idempotency guard
      const fresh = await claimEvent(db, body.id, reference);
      if (!fresh) {
        console.log('[payonifyWebhook] duplicate event, acknowledged', JSON.stringify(safe));
        res.status(200).send('OK');
        return;
      }

      const result = await grantWebEntitlement(db, {
        uid: txUid,
        tier: txTier,
        months: txMonths,
        planKey: txPlanKey,
        amount: tx.amount,
        reference,
        txRef,
        txPatch: {
          // Keep the checkout session id (cs_...); a charge event's object id
          // is the charge (ch_...), which the status endpoint cannot retrieve.
          payonifySessionId: String(session?.id || '').startsWith('cs_') ? session.id : tx.payonifySessionId || '',
          payonifyChargeId: String(session?.id || '').startsWith('ch_') ? session.id : tx.payonifyChargeId || '',
          paidAmount: Number.isFinite(paidAmount) ? paidAmount : tx.amount,
          paidCurrency: paidCurrency || tx.currency || '',
          paymentMethod: session?.payment_method || '',
          webhookStatus: paymentStatus,
        },
      });

      if (!result?.granted) {
        console.log('[payonifyWebhook] already granted, ignored', JSON.stringify(safe));
      } else {
        console.log('[payonifyWebhook] granted', JSON.stringify(safe));
      }
    } else {
      // verdict === 'failed' — final.
      await txRef.set(
        {
          status: 'failed',
          payonifyStatus: paymentStatus,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      console.log('[payonifyWebhook] final failure', JSON.stringify(safe));
    }
  } catch (error) {
    console.error('[payonifyWebhook] processing failed', error?.message || error, JSON.stringify(safe));
  }

  // Always 200 — anything else makes Payonify retry.
  res.status(200).send('OK');
}
