// POST /api/payonifyCheckout
// Starts a Payonify checkout for a signed-in LINKUP web user and returns the
// URL to send the browser to.
//
// Body:    { "plan": "plus_1m" | "plus_3m" | "plus_12m" | "campaigns_1m" | "campaigns_12m" }
// Headers: Authorization: Bearer <Firebase ID token>
// Returns: { "checkoutUrl": "https://checkout.payonify.com/c/...",
//            "sessionId": "cs_...", "amount": 19.99, "currency": "USD", ... }
//
// WHAT WAS ACTUALLY WRONG (Sep 2026, the "502" saga):
//
// The function never crashed at module load. Every api/*.js file imports
// cleanly under Node ESM, OPTIONS returns 204 and an unauthenticated POST
// returns our own 401 - the module was always fine. The 502 was OUR OWN
// `sendError(res, 502, ...)` after Payonify answered 422 to the session
// request, and the handler threw Payonify's error body away, so the log line
// read "502 (no error message)" and the debugging chased a phantom import
// bug for eight commits.
//
// Two things made Payonify reject the request:
//   1. success_url / cancel_url are REQUIRED by the API (docs: "string · uri
//      · required"). When either env var was blank the code sent `undefined`,
//      which JSON.stringify drops, so the field was simply missing -> 422.
//   2. The retry helper retried a 4xx (the response was never inspected), so
//      one bad request became three identical bad requests before failing.
//
// Now: both URLs always have a value (env, else derived from the request's
// own origin), the request follows the documented schema (client_reference_id,
// customer_email, source, expand), 4xx is never retried, and the exact
// Payonify error code + message is stored on the transaction and returned to
// the client so the next failure is readable in one place.
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import { getDb, serverTimestamp, verifyRequestUser } from './_firebaseAdmin.js';
import { CURRENCY, WEB_TERMS } from '../shared/pricing.js';

const TX = 'webTransactions';
const BASE_URL = 'https://api.payonify.com';
const DEFAULT_SITE = 'https://linkup-muqu.vercel.app';

function getConfig() {
  const publishableKey = String(process.env.PAYONIFY_PUBLISHABLE_KEY || '').trim();
  const secretKey = String(process.env.PAYONIFY_SECRET_KEY || '').trim();
  const successUrl = String(process.env.PAYONIFY_SUCCESS_URL || '').trim();
  const cancelUrl = String(process.env.PAYONIFY_CANCEL_URL || '').trim();
  const baseUrl = String(process.env.PAYONIFY_BASE_URL || '').trim().replace(/\/$/, '') || BASE_URL;
  return { publishableKey, secretKey, successUrl, cancelUrl, baseUrl, ready: !!publishableKey && !!secretKey };
}

function getAuthHeader(cfg) {
  return 'Basic ' + Buffer.from(cfg.publishableKey + ':' + cfg.secretKey, 'utf8').toString('base64');
}

/**
 * The site the browser came from, so the return URLs always point somewhere
 * real even when PAYONIFY_SUCCESS_URL / PAYONIFY_CANCEL_URL are unset.
 * Only https origins are trusted; anything else falls back to the known site.
 */
function siteOrigin(req) {
  const fromOrigin = String(req.headers.origin || '').trim();
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(fromOrigin)) return fromOrigin;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  if (host && !/localhost|127\.0\.0\.1/.test(host)) return `https://${host}`;
  return DEFAULT_SITE;
}

/**
 * Only ever put a real, plain absolute URL in the request; Payonify validates
 * it strictly. Anything with a query string, fragment, whitespace or braces
 * is normalised down to its origin + path so it cannot be rejected.
 */
function absoluteUrl(candidate, fallback) {
  const value = String(candidate || '').trim();
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return fallback;
    return u.origin + u.pathname.replace(/\/+$/, '') || fallback;
  } catch {
    return fallback;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry ONLY transient failures: network errors, 429 and 5xx.
 * A 4xx is Payonify telling us the request is wrong; retrying it just delays
 * the error the caller needs to read.
 */
async function fetchWithRetry(url, init, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      lastError = new Error('Payonify HTTP ' + res.status);
      if (i === attempts - 1) return res;
    } catch (err) {
      lastError = err;
      if (i === attempts - 1) throw err;
    }
    await sleep(400 * 2 ** i);
  }
  throw lastError;
}

/** Payonify error envelope: { error: { code, message, type, param, doc_url } } */
function describePayonifyError(status, body) {
  const e = body && typeof body === 'object' ? body.error || body : {};
  const code = String(e?.code || '').trim();
  const message = String(e?.message || body?.message || '').trim();
  const param = String(e?.param || '').trim();
  const head = 'Payonify HTTP ' + status + (code ? ' ' + code : '');
  const tail = [message, param ? '(param: ' + param + ')' : ''].filter(Boolean).join(' ');
  return { code, message, param, summary: tail ? head + ': ' + tail : head };
}

export default async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    setCors(res);
    if (req.method !== 'POST') {
      sendError(res, 405, 'Use POST to start a Payonify checkout.');
      return;
    }

    const config = getConfig();
    if (!config.ready) {
      sendError(res, 500, 'Payonify is not configured on the server.', 'PAYONIFY_PUBLISHABLE_KEY / PAYONIFY_SECRET_KEY missing');
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

    // Both return URLs are REQUIRED by Payonify. Never send undefined.
    //
    // Sent as PLAIN URLs. Payonify's validator rejected the query-string form
    // (`?session_id={CHECKOUT_SESSION_ID}&reference=...`) with
    // `422 parameter_invalid: success URL is invalid` - the braces in the
    // placeholder do not survive their URI check. Nothing needs the query
    // anyway: the client parks the reference in sessionStorage before it
    // leaves for Payonify and reads it back on return (webCheckout.ts), and
    // the webhook carries the reference in session.metadata.
    const origin = siteOrigin(req);
    const successUrl = absoluteUrl(config.successUrl, origin + '/paynow/return');
    const cancelUrl = absoluteUrl(config.cancelUrl, origin + '/paynow/cancel');

    const amountInCents = Math.round(plan.amount * 100);
    const payload = {
      line_items: [{ unit_amount: amountInCents, name: plan.label, quantity: 1 }],
      mode: 'payment',
      currency: CURRENCY.toLowerCase(),
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: reference,
      source: 'web',
      // Max 5 keys, key <= 40 chars, value <= 500 chars. The webhook and the
      // status endpoint read `reference` and `uid` from here.
      metadata: { reference, uid: user.uid, planKey, tier: plan.tier, months: String(plan.months) },
      expand: ['line_items'],
    };
    if (user.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
      payload.customer_email = user.email;
    }

    let sessionRes;
    try {
      sessionRes = await fetchWithRetry(config.baseUrl + '/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: getAuthHeader(config),
        },
        body: JSON.stringify(payload),
      });
    } catch (netErr) {
      const detail = 'Payonify unreachable: ' + (netErr?.message || String(netErr));
      console.error('[payonifyCheckout]', reference, detail);
      await db.collection(TX).doc(reference).set(
        { status: 'error', error: detail.slice(0, 500), updatedAt: serverTimestamp() },
        { merge: true }
      );
      sendError(res, 502, 'Could not reach Payonify. Please try again.', detail);
      return;
    }

    const text = await sessionRes.text();
    let session = {};
    try { session = JSON.parse(text); } catch { session = {}; }

    if (!sessionRes.ok || !session?.url) {
      const info = sessionRes.ok
        ? { code: 'no_url', message: 'Payonify returned no checkout url', summary: 'Payonify HTTP 200 without url' }
        : describePayonifyError(sessionRes.status, session);
      // Log the WHOLE story once: status, code, message, and what we sent
      // (minus nothing secret - the payload holds no keys).
      console.error('[payonifyCheckout]', reference, info.summary, 'payload=' + JSON.stringify(payload), 'body=' + text.slice(0, 600));
      await db.collection(TX).doc(reference).set(
        {
          status: 'error',
          error: info.summary.slice(0, 500),
          payonifyErrorCode: info.code || '',
          payonifyHttpStatus: sessionRes.status,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      // Auth / config problems are ours (500); anything else is the gateway
      // rejecting the request (502). Either way the client sees the reason.
      const authProblem = sessionRes.status === 401 || sessionRes.status === 403;
      sendError(
        res,
        authProblem ? 500 : 502,
        authProblem
          ? 'Payonify rejected the server API keys. Check PAYONIFY_PUBLISHABLE_KEY / PAYONIFY_SECRET_KEY in Vercel.'
          : 'Payonify could not create the checkout: ' + (info.message || info.summary),
        info.summary
      );
      return;
    }

    await db.collection(TX).doc(reference).set(
      {
        status: 'pending',
        payonifySessionId: session.id || '',
        payonifyChargeReference: session.charge_reference || '',
        checkoutUrl: session.url,
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
    console.error('[payonifyCheckout] unhandled', err?.stack || err?.message || err);
    try {
      sendError(res, 500, 'Internal server error', String(err?.message || err));
    } catch {}
  }
}
