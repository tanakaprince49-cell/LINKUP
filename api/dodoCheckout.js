// POST /api/dodoCheckout
// Creates a hosted Dodo Payments checkout session for a signed-in LINKUP user
// and returns the URL to redirect the browser to.
//
// Body:    { "plan": "plus_monthly" | "plus_yearly" | "pro_monthly" | "founding_yearly" }
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { "checkoutUrl": "https://checkout.dodopayments.com/...", "sessionId": "..." }
import { handleOptions, sendError, setCors } from './_gemini.js';
import { verifyRequestUser } from './_firebaseAdmin.js';

const DODO_API_BASE = (process.env.DODO_API_BASE || 'https://live.dodopayments.com').replace(/\/$/, '');
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

// Plan key → Dodo product id (from Dodo dashboard → Products) + entitlement tier.
// Product ids come from env so live/test can be swapped without code changes.
function plans() {
  return {
    plus_monthly:    { productId: process.env.DODO_PRODUCT_PLUS_MONTHLY || '',    tier: 'plus' },
    plus_yearly:     { productId: process.env.DODO_PRODUCT_PLUS_YEARLY || '',     tier: 'plus' },
    pro_monthly:     { productId: process.env.DODO_PRODUCT_PRO_MONTHLY || '',     tier: 'pro'  },
    pro_yearly:      { productId: process.env.DODO_PRODUCT_PRO_YEARLY || '',      tier: 'pro'  },
    founding_yearly: { productId: process.env.DODO_PRODUCT_FOUNDING_YEARLY || '', tier: 'pro'  },
  };
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') {
    sendError(res, 405, 'Use POST to create a checkout session.');
    return;
  }

  const apiKey = String(process.env.DODO_PAYMENTS_API_KEY || '').trim();
  if (!apiKey) {
    sendError(res, 500, 'Billing is not configured on the server (missing DODO_PAYMENTS_API_KEY).');
    return;
  }

  // Only the signed-in user may buy a subscription for their own account.
  const user = await verifyRequestUser(req);
  if (!user?.uid) {
    sendError(res, 401, 'Sign in to upgrade. (missing or invalid auth token)');
    return;
  }

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const planKey = String(body.plan || 'plus_monthly');
  const plan = plans()[planKey];
  if (!plan || !plan.productId) {
    sendError(res, 400, `Unknown or unconfigured plan "${planKey}".`);
    return;
  }

  const returnUrl = APP_BASE_URL
    ? `${APP_BASE_URL}/?billing=success&plan=${encodeURIComponent(planKey)}`
    : undefined;

  try {
    const upstream = await fetch(`${DODO_API_BASE}/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_cart: [{ product_id: plan.productId, quantity: 1 }],
        customer: {
          email: user.email || undefined,
          name: user.name || undefined,
        },
        // metadata rides through to every webhook event for this subscription —
        // the webhook binds the payment to this exact Firebase user via uid.
        metadata: { uid: user.uid, plan: planKey, tier: plan.tier },
        ...(returnUrl ? { return_url: returnUrl } : {}),
        customization: { theme: 'dark', show_order_details: true },
      }),
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      sendError(res, 502, 'Dodo Payments rejected the checkout session.', JSON.stringify(data));
      return;
    }

    setCors(res);
    res.status(200).json({
      checkoutUrl: data.checkout_url || null,
      sessionId: data.session_id || null,
    });
  } catch (error) {
    sendError(res, 500, 'Failed to create checkout session.', error);
  }
}
