// Shared Payonify helper for the LINKUP web checkout.
//
// Payonify is a ONE-TIME collection gateway — the checkout flow creates a
// session and redirects the browser to a hosted payment page. It has no
// recurring/subscription API, so web plans are sold as PREPAID TERMS
// (1 / 3 / 12 months) exactly as they were under ContiPay. See PAYONIFY_SETUP.md.
//
// Security: the secret key never leaves the server. It is read from
// env at CALL TIME (never module load), so it is never baked into a bundle,
// never logged as part of a config dump, and never sent to the client. The
// only thing the browser ever sees is the checkout URL Payonify hands back.

const SANDBOX_BASE = 'https://api.payonify.com';
const LIVE_BASE = 'https://api.payonify.com';

/**
 * Read config fresh on every call.
 *
 * Required in the host environment:
 *   PAYONIFY_PUBLISHABLE_KEY  — pk_test_... or pk_live_...
 *   PAYONIFY_SECRET_KEY       — sk_test_... or sk_live_... (SERVER ONLY)
 *
 * Optional:
 *   PAYONIFY_WEBHOOK_SECRET   — whsec_... for signature verification
 *   PAYONIFY_BASE_URL         — overrides the sandbox/live base URL
 *   PAYONIFY_ENV              — 'sandbox' (default) | 'live'
 *   PAYONIFY_SUCCESS_URL      — where Payonify sends the browser on success
 *   PAYONIFY_CANCEL_URL       — where Payonify sends the browser on cancel
 */
export function payonifyConfig() {
  const publishableKey = String(process.env.PAYONIFY_PUBLISHABLE_KEY || '').trim();
  const secretKey = String(process.env.PAYONIFY_SECRET_KEY || '').trim();
  const webhookSecret = String(process.env.PAYONIFY_WEBHOOK_SECRET || '').trim();
  const successUrl = String(process.env.PAYONIFY_SUCCESS_URL || '').trim();
  const cancelUrl = String(process.env.PAYONIFY_CANCEL_URL || '').trim();
  const live = String(process.env.PAYONIFY_ENV || 'sandbox').toLowerCase() === 'live';
  const override = String(process.env.PAYONIFY_BASE_URL || '').trim().replace(/\/$/, '');

  return {
    publishableKey,
    secretKey,
    webhookSecret,
    successUrl,
    cancelUrl,
    live,
    baseUrl: override || (live ? LIVE_BASE : SANDBOX_BASE),
    ready: !!publishableKey && !!secretKey,
  };
}

/** Payonify authenticates with Basic auth using publishable_key:secret_key. */
export function authHeader() {
  const { publishableKey, secretKey } = payonifyConfig();
  return `Basic ${Buffer.from(`${publishableKey}:${secretKey}`, 'utf8').toString('base64')}`;
}

/** Constant-time compare, so a timing oracle cannot walk the secret. */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry a network call with exponential backoff + jitter.
 *
 * Only transient failures are retried: connection resets, timeouts and 5xx.
 * A 4xx is Payonify telling us the request is wrong — retrying that just
 * burns quota and delays the error the caller needs to see.
 */
export async function withRetry(fn, opts = {}) {
  const attempts = Math.max(1, Number(opts.attempts || 3));
  const baseDelayMs = Math.max(50, Number(opts.baseDelayMs || 400));
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const transient =
        !status || status >= 500 || status === 429 || error?.code === 'ECONNRESET' || error?.name === 'AbortError';
      if (!transient || attempt === attempts - 1) break;
      const backoff = baseDelayMs * 2 ** attempt;
      await sleep(backoff / 2 + Math.random() * (backoff / 2));
    }
  }
  throw lastError;
}

/**
 * Verify a Payonify webhook signature.
 *
 * Payonify-Signature header format:
 *   t=1621267018,v1=5c52d36d49d6a2a243ca3dfe17fd9d4df3e04532d528528d46e13d0f2d2example
 *
 * @param {string} payload — raw request body string
 * @param {string} signatureHeader — the Payonify-Signature header value
 * @returns {{ ok: boolean, reason?: string, event?: object }}
 */
export function verifyWebhookSignature(payload, signatureHeader) {
  const cfg = payonifyConfig();
  if (!cfg.webhookSecret) {
    // No webhook secret configured — skip verification (dev mode only).
    return { ok: true, reason: 'no-secret-configured' };
  }

  if (!signatureHeader) {
    return { ok: false, reason: 'missing-signature' };
  }

  const { default: crypto } = await import('crypto');
  const parts = {};
  for (const part of String(signatureHeader).split(',')) {
    const [key, value] = part.split('=');
    if (key && value) parts[key] = value;
  }

  const timestamp = parseInt(parts.t, 10);
  const receivedSignature = parts.v1;

  if (!timestamp || !receivedSignature) {
    return { ok: false, reason: 'invalid-signature-format' };
  }

  // Check timestamp tolerance (5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return { ok: false, reason: 'timestamp-too-old' };
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', cfg.webhookSecret)
    .update(signedPayload)
    .digest('hex');

  // Timing-safe compare
  if (!crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(receivedSignature))) {
    return { ok: false, reason: 'invalid-signature' };
  }

  return { ok: true, reason: 'ok' };
}

/**
 * Classify a checkout session payment status.
 *
 * Payonify checkout.session events use payment_status:
 *   'paid'      → final success
 *   'failed'    → final failure
 *   anything else → not final
 */
export function classifyStatus(paymentStatus) {
  const status = String(paymentStatus || '').toLowerCase();
  if (status === 'paid' || status === 'succeeded') return 'paid';
  if (status === 'failed' || status === 'canceled' || status === 'expired') return 'failed';
  return 'delayed';
}

/**
 * Fields safe to log from a webhook event.
 * Never dump the raw body or signature header.
 */
export function redactWebhook(body) {
  const b = body || {};
  return {
    eventId: b.id ?? null,
    eventType: b.type ?? null,
    sessionId: b.data?.object?.id ?? null,
    paymentStatus: b.data?.object?.payment_status ?? null,
    status: b.data?.object?.status ?? null,
  };
}

/**
 * Retrieve a checkout session from Payonify's API.
 *
 * GET /v1/checkout/sessions/{sessionId}
 *
 * Returns null when the call fails — callers must treat null as "unknown".
 */
export async function retrieveCheckoutSession(sessionId) {
  const cfg = payonifyConfig();
  if (!sessionId || !cfg.secretKey) return null;

  try {
    const res = await withRetry(
      () =>
        fetch(`${cfg.baseUrl}/v1/checkout/sessions/${sessionId}`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: authHeader(),
          },
        }),
      { attempts: 2, baseDelayMs: 300 }
    );
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}
