# Payonify Checkout — 502 Error Debug Doc

## Error Summary

Every call to `POST /api/payonifyCheckout` returns **502 Bad Gateway** or **500 Internal Server Error**. The function crashes before any business logic runs.

## Vercel Function Logs

```
Sep 02 10:06:02.86  POST  502  /api/payonifyCheckout  (no error message)
Sep 02 09:46:51.88  POST  500  /api/payonifyCheckout  SyntaxError: Unexpected reserved word
Sep 02 09:46:31.99  POST  500  /api/payonifyCheckout  SyntaxError: Unexpected reserved word
Sep 02 09:21:58.51  POST  502  /api/payonifyCheckout
Sep 02 09:19:18.41  POST  502  /api/payonifyCheckout
Sep 02 09:18:53.20  POST  502  /api/payonifyCheckout
Sep 02 09:08:01.60  POST  502  /api/payonifyCheckout
```

The `SyntaxError: Unexpected reserved word` was caused by `await import('crypto')` inside a non-async function. That was fixed — the latest deployment (10:06) now shows **502 with no error message**, meaning the function crashes at module load time before any console.error runs.

## What Was Tried

1. **Original approach**: `import crypto from 'crypto'` at top of `_payonify.js` → 502
2. **Named import**: `import { createHmac, timingSafeEqual } from 'crypto'` → 502
3. **Dynamic import inside sync function**: `const crypto = await import('crypto')` → 500 SyntaxError (can't await in non-async)
4. **Made function async + dynamic import**: `export async function verifyWebhookSignature` + `await import('crypto')` → 502 (module still crashes at load)
5. **Removed crypto from `_payonify.js` entirely**: Made `verifyWebhookSignature` a pure data-returning sync function → 502
6. **Inlined everything into `payonifyCheckout.js`**: Removed all imports from `_payonify.js` → still 502

## Current File: `api/payonifyCheckout.js`

```js
// POST /api/payonifyCheckout
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import { getDb, serverTimestamp, verifyRequestUser } from './_firebaseAdmin.js';
import { CURRENCY, WEB_TERMS } from '../shared/pricing.js';

const TX = 'webTransactions';
const BASE_URL = 'https://api.payonify.com';

function getConfig() {
  const publishableKey = String(process.env.PAYONIFY_PUBLISHABLE_KEY || '').trim();
  const secretKey = String(process.env.PAYONIFY_SECRET_KEY || '').trim();
  const successUrl = String(process.env.PAYONIFY_SUCCESS_URL || '').trim();
  const cancelUrl = String(process.env.PAYONIFY_CANCEL_URL || '').trim();
  return {
    publishableKey, secretKey, successUrl, cancelUrl,
    ready: !!publishableKey && !!secretKey,
  };
}

function getAuthHeader() {
  const cfg = getConfig();
  return 'Basic ' + Buffer.from(cfg.publishableKey + ':' + cfg.secretKey, 'utf8').toString('base64');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, attempts) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(400 * 2 ** i);
    }
  }
  throw lastError;
}

export default async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    setCors(res);
    if (req.method !== 'POST') { sendError(res, 405, 'Use POST.'); return; }

    const config = getConfig();
    if (!config.ready) { sendError(res, 500, 'Payonify is not configured.'); return; }

    const user = await verifyRequestUser(req);
    if (!user?.uid) { sendError(res, 401, 'Sign in.'); return; }

    const body = await readJsonBody(req);
    const planKey = String(body?.plan || '').trim();
    const plan = WEB_TERMS[planKey];
    if (!plan) { sendError(res, 400, 'Unknown plan.'); return; }

    const reference = 'LKP-' + user.uid.slice(0, 8) + '-' + Date.now();
    const db = getDb();

    await db.collection(TX).doc(reference).set({
      uid: user.uid, email: user.email || '', planKey, tier: plan.tier,
      months: plan.months, amount: plan.amount, currency: CURRENCY,
      gateway: 'payonify', status: 'initiated',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
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
        { status: 'error', error: session?.message || 'HTTP ' + sessionRes.status, updatedAt: serverTimestamp() },
        { merge: true }
      );
      sendError(res, 502, session?.message || 'Could not create checkout session.');
      return;
    }

    await db.collection(TX).doc(reference).set(
      { status: 'pending', payonifySessionId: session.id || '', updatedAt: serverTimestamp() },
      { merge: true }
    );

    res.status(200).json({
      checkoutUrl: session.url, sessionId: session.id || '', reference,
      amount: plan.amount, currency: CURRENCY, label: plan.label,
      tier: plan.tier, months: plan.months,
    });
  } catch (err) {
    console.error('[payonifyCheckout]', err?.message || err);
    try { res.status(500).json({ error: 'Internal server error' }); } catch {}
  }
}
```

## Other API files that work (for reference)

These files use the same imports (`_gemini.js`, `_firebaseAdmin.js`, `shared/pricing.js`) and work fine on Vercel:

- `api/contipayCheckout.js` — the OLD checkout, works perfectly (same import pattern)
- `api/news.js` — works fine
- `api/_gemini.js` — shared CORS/error helper, no issues
- `api/_firebaseAdmin.js` — Firebase Admin init, no issues

## Key observations

1. The OLD `api/contipayCheckout.js` uses the **exact same imports** (`_gemini.js`, `_firebaseAdmin.js`, `shared/pricing.js`) and works fine
2. `api/payonifyCheckout.js` uses the same imports plus one more from `_payonify.js` (or now inlined, no extra imports)
3. The function crashes at **module load time** — before any `console.error` runs — meaning it's a syntax/import error, not a runtime error
4. Vercel logs show **no error message** for the 502s, which typically means the Node.js process exited with status 1 during module loading
5. `"type": "module"` is set in `package.json` (ESM mode)

## Environment Variables (confirmed set in Vercel)

```
PAYONIFY_PUBLISHABLE_KEY    pk_test_...    Production
PAYONIFY_SECRET_KEY         sk_test_...    Production
PAYONIFY_WEBHOOK_SECRET     whsec_...      Production
PAYONIFY_SUCCESS_URL        https://linkup-muqu.vercel.app/paynow/return    Production
PAYONIFY_CANCEL_URL         https://linkup-muqu.vercel.app/paynow/cancel   Production
```

## Vercel Config (`vercel.json`)

```json
{
  "framework": null,
  "installCommand": "npm ci --no-audit --no-fund && cd mobile && npm ci",
  "buildCommand": "cd mobile && npm run build:web",
  "outputDirectory": "mobile/dist",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

## What to investigate

1. **Why does `payonifyCheckout.js` crash at module load when it uses the same imports as `contipayCheckout.js` which works?**
2. Could there be a Vercel build cache issue where an old version of the file is being deployed?
3. Is there something in `_payonify.js` that poisons the module graph even though `payonifyCheckout.js` no longer imports it? (Other files still import it)
4. Could the `shared/pricing.js` import be failing because `_payonify.js` also imports it and has some issue?
5. Should we try renaming `payonifyCheckout.js` to something else to rule out caching?

## Git history (recent)

```
0461e81 fix: inline all payonify logic into checkout handler, remove _payonify.js dependency
9e65a7d fix: make verifyWebhookSignature async so await import(crypto) works
9dfc386 fix: lazy-import crypto only in webhook verifier, not at module top level
e638ed9 fix: wrap payonifyCheckout in top-level try/catch for better error visibility
239b213 fix: use crypto.createHmac and crypto.timingSafeEqual with default import
4f71d86 fix: use ES module import for crypto instead of require()
5e7e497 fix: Payonify uses Basic auth (pk:sk), not Bearer token
fece84e feat: replace Contipay with Payonify for web checkout
```
