// POST /api/contipayCheckout
// Starts a ContiPay payment for a signed-in LINKUP web user and returns the
// URL to send the browser to.
//
// Body:    { "plan": "plus_1m" | "plus_3m" | "plus_12m" | "campaigns_1m" | "campaigns_12m" }
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { "redirectUrl": "https://acquire-uat.contipay.net/payment/pay?token=...",
//            "reference": "LKP-...", "amount": 19.99, "currency": "USD", ... }
//
// Replaces the retired /api/paynowCheckout and /api/dodoCheckout.
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import { getDb, serverTimestamp, verifyRequestUser } from './_firebaseAdmin.js';
import { contipayConfig, initiatePayment, splitName, webhookUrl } from './_contipay.js';
import { CURRENCY, WEB_TERMS } from '../shared/pricing.js';

const TX = 'webTransactions';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);
  if (req.method !== 'POST') {
    sendError(res, 405, 'Use POST to start a ContiPay checkout.');
    return;
  }

  const config = contipayConfig();
  if (!config.ready) {
    sendError(
      res,
      500,
      'ContiPay is not configured on the server (missing CONTIPAY_AUTH_KEY / AUTH_SECRET / MERCHANT_ID / WEBHOOK_URL).'
    );
    return;
  }

  // Only the signed-in user may buy an entitlement for their own account.
  const user = await verifyRequestUser(req);
  if (!user?.uid) {
    sendError(res, 401, 'Sign in before starting a payment.');
    return;
  }

  const body = await readJsonBody(req);
  const planKey = String(body?.plan || '').trim();
  const plan = WEB_TERMS[planKey];
  if (!plan) {
    sendError(res, 400, 'Unknown plan. Use plus_1m, plus_3m, plus_12m, campaigns_1m or campaigns_12m.');
    return;
  }

  // ContiPay merchant references must be unique per attempt. The uid prefix
  // makes support lookups possible without exposing the whole uid.
  const reference = `LKP-${user.uid.slice(0, 8)}-${Date.now()}`;
  const db = getDb();

  // Record intent BEFORE talking to ContiPay, so a timeout can never leave us
  // with a payment we have no record of reconciling.
  await db
    .collection(TX)
    .doc(reference)
    .set({
      uid: user.uid,
      email: user.email || '',
      planKey,
      tier: plan.tier,
      months: plan.months,
      amount: plan.amount,
      currency: CURRENCY,
      gateway: 'contipay',
      status: 'initiated',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

  let response;
  try {
    response = await initiatePayment({
      reference,
      amount: plan.amount,
      description: plan.label,
      currencyCode: CURRENCY,
      customer: {
        ...splitName(user.name || user.displayName || '', user.email || ''),
        email: user.email || '',
        cell: '',
        countryCode: 'ZW',
      },
    });
  } catch (error) {
    await db
      .collection(TX)
      .doc(reference)
      .set(
        { status: 'error', error: String(error?.message || error), updatedAt: serverTimestamp() },
        { merge: true }
      );
    sendError(res, 502, 'Could not reach ContiPay. Try again in a moment.', String(error?.message || error));
    return;
  }

  // ContiPay answers 200 with status "Pending" and a hosted page to visit.
  if (!response.redirectUrl) {
    await db
      .collection(TX)
      .doc(reference)
      .set(
        {
          status: 'failed',
          error: response.message || 'ContiPay did not return a redirect URL.',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    sendError(res, 502, response.message || 'ContiPay did not return a redirect URL.');
    return;
  }

  await db
    .collection(TX)
    .doc(reference)
    .set({ status: 'pending', contipayStatus: response.status || '', updatedAt: serverTimestamp() }, { merge: true });

  res.status(200).json({
    redirectUrl: response.redirectUrl,
    reference,
    amount: plan.amount,
    currency: CURRENCY,
    label: plan.label,
    tier: plan.tier,
    months: plan.months,
  });
}
