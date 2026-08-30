// POST /api/paynowCheckout
// Starts a Paynow payment for a signed-in LINKUP web user and returns the URL
// to send the browser to.
//
// Body:    { "plan": "plus_1m" | "plus_3m" | "plus_12m" | "campaigns_1m" | "campaigns_12m" }
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { "redirectUrl": "https://www.paynow.co.zw/...", "reference": "...", "amount": 19.99 }
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import { getDb, serverTimestamp, verifyRequestUser } from './_firebaseAdmin.js';
import { initiateTransaction, paynowConfig, paynowPlans } from './_paynow.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);
  if (req.method !== 'POST') {
    sendError(res, 405, 'Use POST to start a Paynow checkout.');
    return;
  }

  const config = paynowConfig();
  if (!config.ready) {
    sendError(res, 500, 'Paynow is not configured on the server (missing PAYNOW_INTEGRATION_ID / KEY / RESULT_URL).');
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
  const plan = paynowPlans()[planKey];
  if (!plan) {
    sendError(res, 400, 'Unknown plan. Use plus_1m, plus_3m, plus_12m, campaigns_1m or campaigns_12m.');
    return;
  }

  const reference = `LKP-${user.uid.slice(0, 8)}-${Date.now()}`;
  const db = getDb();

  // Record intent BEFORE talking to Paynow, so a timeout can never leave us
  // with a payment we have no record of reconciling.
  await db.collection('paynowTransactions').doc(reference).set({
    uid: user.uid,
    email: user.email || '',
    planKey,
    tier: plan.tier,
    months: plan.months,
    amount: plan.amount,
    currency: 'USD',
    status: 'initiated',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  let response;
  try {
    response = await initiateTransaction({
      reference,
      amount: plan.amount,
      email: user.email || '',
      info: plan.label,
    });
  } catch (error) {
    await db
      .collection('paynowTransactions')
      .doc(reference)
      .set({ status: 'error', error: String(error?.message || error), updatedAt: serverTimestamp() }, { merge: true });
    sendError(res, 502, 'Could not reach Paynow. Try again in a moment.');
    return;
  }

  const status = String(response.status || '').toLowerCase();
  if (status !== 'ok' || !response.redirecturl) {
    await db
      .collection('paynowTransactions')
      .doc(reference)
      .set(
        { status: 'failed', error: response.error || 'Paynow rejected the transaction.', updatedAt: serverTimestamp() },
        { merge: true }
      );
    sendError(res, 502, response.error || 'Paynow rejected the transaction.');
    return;
  }

  // The poll URL is how we can still confirm payment if the webhook never lands.
  await db
    .collection('paynowTransactions')
    .doc(reference)
    .set({ status: 'pending', pollUrl: response.pollurl || '', paynowReference: response.paynowreference || '', updatedAt: serverTimestamp() }, { merge: true });

  res.status(200).json({
    redirectUrl: response.redirecturl,
    reference,
    amount: plan.amount,
    currency: 'USD',
    label: plan.label,
  });
}
