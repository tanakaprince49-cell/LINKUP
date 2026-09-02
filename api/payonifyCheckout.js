// POST /api/payonifyCheckout
// Starts a Payonify checkout for a signed-in LINKUP web user and returns the
// URL to send the browser to.
//
// Body:    { "plan": "plus_1m" | "plus_3m" | "plus_12m" | "campaigns_1m" | "campaigns_12m" }
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { "checkoutUrl": "https://checkout.payonify.com/c/...",
//            "sessionId": "cs_...", "amount": 19.99, "currency": "USD", ... }

console.log('[payonifyCheckout] Starting module load');

import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
console.log('[payonifyCheckout] Imported _gemini');

import { getDb, serverTimestamp, verifyRequestUser } from './_firebaseAdmin.js';
console.log('[payonifyCheckout] Imported _firebaseAdmin');

import { CURRENCY, WEB_TERMS } from '../shared/pricing.js';
console.log('[payonifyCheckout] Imported pricing');

const TX = 'webTransactions';
const BASE_URL = 'https://api.payonify.com';

console.log('[payonifyCheckout] Constants defined');

function getConfig() {
  console.log('[payonifyCheckout] getConfig called');
  const publishableKey = String(process.env.PAYONIFY_PUBLISHABLE_KEY || '').trim();
  const secretKey = String(process.env.PAYONIFY_SECRET_KEY || '').trim();
  const successUrl = String(process.env.PAYONIFY_SUCCESS_URL || '').trim();
  const cancelUrl = String(process.env.PAYONIFY_CANCEL_URL || '').trim();
  return {
    publishableKey,
    secretKey,
    successUrl,
    cancelUrl,
    ready: !!publishableKey && !!secretKey,
  };
}

function getAuthHeader() {
  console.log('[payonifyCheckout] getAuthHeader called');
  const cfg = getConfig();
  return 'Basic ' + Buffer.from(cfg.publishableKey + ':' + cfg.secretKey, 'utf8').toString('base64');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('[payonifyCheckout] Helper functions defined');

async function withRetry(fn, attempts) {
  console.log('[payonifyCheckout] withRetry called');
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(400 * 2 ** i);
    }
  }
  throw lastError;
}

console.log('[payonifyCheckout] Handler function defined');

export default async function handler(req, res) {
  console.log('[payonifyCheckout] Handler called');
  try {
    if (handleOptions(req, res)) return;
    setCors(res);
    if (req.method !== 'POST') {
      sendError(res, 405, 'Use POST to start a Payonify checkout.');
      return;
    }

    const config = getConfig();
    if (!config.ready) {
      sendError(res, 500, 'Payonify is not configured on the server.');
      return;
    }

    const user = await verifyRequestUser(req);
    if (!user?.uid) {
      sendError(res, 401, 'Sign in before starting a payment.');
      return;
    }

    const body = await readJsonBody(req);
    const planKey = String(body?.plan || '').trim();
    const plan = WEB_TERMS[planKey];
    if (!plan) {
      sendError(res, 400, 'Unknown plan.');
      return;
    }

    const reference = 'LKP-' + user.uid.slice(0, 8) + '-' + Date.now();
    const db = getDb();

    await db.collection(TX).doc(reference).set({
      uid: user.uid,
      email: user.email || '',
      planKey,
      tier: plan.tier,
      months: plan.months,
      amount: plan.amount,
      currency: CURRENCY,
      gateway: 'payonify',
      status: 'initiated',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const amountInCents = Math.round(plan.amount * 100);
    const sessionRes = await withRetry(() =>
      fetch(BASE_URL + '/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: getAuthHeader(),
        },
        body: JSON.stringify({
          line_items: [{ unit_amount: amountInCents, name: plan.label, quantity: 1 }],
          mode: 'payment',
          currency: CURRENCY.toLowerCase(),
          success_url: config.successUrl
            ? config.successUrl + '?session_id={CHECKOUT_SESSION_ID}&reference=' + reference
            : undefined,
          cancel_url: config.cancelUrl || undefined,
          metadata: { reference, uid: user.uid, planKey, tier: plan.tier, months: String(plan.months) },
        }),
      })
    , 3);

    const text = await sessionRes.text();
    let session;
    try { session = JSON.parse(text); } catch { session = {}; }

    if (!sessionRes.ok || !session?.url) {
      await db.collection(TX).doc(reference).set(
        { status: 'error', error: session?.message || 'Payonify returned HTTP ' + sessionRes.status, updatedAt: serverTimestamp() },
        { merge: true }
      );
      sendError(res, 502, session?.message || 'Could not create Payonify checkout session.');
      return;
    }

    await db.collection(TX).doc(reference).set(
      { status: 'pending', payonifySessionId: session.id || '', updatedAt: serverTimestamp() },
      { merge: true }
    );

    res.status(200).json({
      checkoutUrl: session.url,
      sessionId: session.id || '',
      reference,
      amount: plan.amount,
      currency: CURRENCY,
      label: plan.label,
      tier: plan.tier,
      months: plan.months,
    });
  } catch (err) {
    console.error('[payonifyCheckout]', err?.message || err);
    try { res.status(500).json({ error: 'Internal server error' }); } catch {}
  }
}
