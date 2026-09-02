// POST /api/payonifyCheckout
// Starts a Payonify checkout for a signed-in LINKUP web user and returns the
// URL to send the browser to.
//
// Body:    { "plan": "plus_1m" | "plus_3m" | "plus_12m" | "campaigns_1m" | "campaigns_12m" }
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { "checkoutUrl": "https://checkout.payonify.com/c/...",
//            "sessionId": "cs_...", "amount": 19.99, "currency": "USD", ... }
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import { getDb, serverTimestamp, verifyRequestUser } from './_firebaseAdmin.js';
import { payonifyConfig, authHeader, withRetry } from './_payonify.js';
import { CURRENCY, WEB_TERMS } from '../shared/pricing.js';

const TX = 'webTransactions';

export default async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    setCors(res);
    if (req.method !== 'POST') {
      sendError(res, 405, 'Use POST to start a Payonify checkout.');
      return;
    }

    const config = payonifyConfig();
    if (!config.ready) {
      sendError(
        res,
        500,
        'Payonify is not configured on the server (missing PAYONIFY_PUBLISHABLE_KEY / SECRET_KEY).'
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

    // Merchant reference for our own tracking. Payonify sessions have their own
    // IDs, but we keep our reference for webTransactions lookup.
    const reference = `LKP-${user.uid.slice(0, 8)}-${Date.now()}`;
    const db = getDb();

    // Record intent BEFORE talking to Payonify, so a timeout can never leave us
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
        gateway: 'payonify',
        status: 'initiated',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

    // Create a Payonify checkout session.
    const amountInCents = Math.round(plan.amount * 100);

    let session;
    try {
      const res2 = await withRetry(
        () =>
          fetch(`${config.baseUrl}/v1/checkout/sessions`, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: authHeader(),
            },
            body: JSON.stringify({
              line_items: [
                {
                  unit_amount: amountInCents,
                  name: plan.label,
                  quantity: 1,
                },
              ],
              mode: 'payment',
              currency: CURRENCY.toLowerCase(),
              success_url: config.successUrl
                ? `${config.successUrl}?session_id={CHECKOUT_SESSION_ID}&reference=${reference}`
                : undefined,
              cancel_url: config.cancelUrl || undefined,
              metadata: {
                reference,
                uid: user.uid,
                planKey,
                tier: plan.tier,
                months: String(plan.months),
              },
            }),
          }),
        { attempts: 3, baseDelayMs: 400 }
      );

      const text = await res2.text();
      try {
        session = JSON.parse(text);
      } catch {
        session = {};
      }

      if (!res2.ok || !session?.url) {
        await db
          .collection(TX)
          .doc(reference)
          .set(
            { status: 'error', error: session?.message || `Payonify returned HTTP ${res2.status}`, updatedAt: serverTimestamp() },
            { merge: true }
          );
        sendError(res, 502, session?.message || 'Could not create Payonify checkout session.');
        return;
      }
    } catch (error) {
      await db
        .collection(TX)
        .doc(reference)
        .set(
          { status: 'error', error: String(error?.message || error), updatedAt: serverTimestamp() },
          { merge: true }
        );
      sendError(res, 502, 'Could not reach Payonify. Try again in a moment.', String(error?.message || error));
      return;
    }

    // Store the Payonify session ID on the transaction for later lookup.
    await db
      .collection(TX)
      .doc(reference)
      .set(
        {
          status: 'pending',
          payonifySessionId: session.id || '',
          updatedAt: serverTimestamp(),
        },
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
    console.error('[payonifyCheckout] unhandled error', err?.message || err);
    try { res.status(500).json({ error: 'Internal server error' }); } catch {}
  }
}
