// Shared ContiPay (Zimbabwe) helper for the LINKUP web checkout.
//
// ContiPay is a ONE-TIME collection gateway — the documented redirect flow
// takes a merchant reference and returns a hosted payment page. It has no
// recurring/subscription API, so web plans are sold as PREPAID TERMS
// (1 / 3 / 12 months) exactly as they were under Paynow. See CONTIPAY_SETUP.md.
//
// Security: the API key and secret never leave the server. They are read from
// env at CALL TIME (never module load), so they are never baked into a bundle,
// never logged as part of a config dump, and never sent to the client. The
// only thing the browser ever sees is the redirectUrl ContiPay hands back.

const SANDBOX_BASE = 'https://api-uat.contipay.net';
const LIVE_BASE = 'https://api.contipay.net';

/**
 * ContiPay status codes.
 *
 *   1        PAID              final success
 *   3, 4     ERROR / DECLINED  final failure
 *   0, 6     PENDING / QUEUED  delayed — not final, keep the order open
 */
export const CONTIPAY_STATUS = {
  PENDING: 0,
  PAID: 1,
  ERROR: 3,
  DECLINED: 4,
  QUEUED: 6,
};

/**
 * Read config fresh on every call.
 *
 * Required in the host environment:
 *   CONTIPAY_AUTH_KEY        — issued Auth Key (Basic auth user)
 *   CONTIPAY_AUTH_SECRET     — issued Auth Secret (Basic auth password)
 *   CONTIPAY_MERCHANT_ID     — numeric merchant id, e.g. 1234
 *   CONTIPAY_WEBHOOK_URL     — absolute URL ContiPay POSTs payment updates to
 *
 * Optional:
 *   CONTIPAY_WEBHOOK_TOKEN   — webhook auth token. ContiPay sends it as
 *                              `Authorization: Bearer <token>`. Configure it in
 *                              the ContiPay workspace, NOT in the URL — their
 *                              guidance is explicit that secrets must never
 *                              ride in a webhook URL.
 *   CONTIPAY_BASE_URL        — overrides the sandbox/live base URL
 *   CONTIPAY_SUCCESS_URL     — where ContiPay sends the browser on success
 *   CONTIPAY_CANCEL_URL      — where ContiPay sends the browser on cancel
 *   CONTIPAY_ENV             — 'sandbox' (default) | 'live'
 *
 * The legacy CONTIPAY_API_KEY / CONTIPAY_API_SECRET names are still accepted so
 * an existing Vercel project does not break on deploy.
 */
export function contipayConfig() {
  const apiKey = (
    String(process.env.CONTIPAY_AUTH_KEY || process.env.CONTIPAY_API_KEY || '')
  ).trim();
  const apiSecret = (
    String(process.env.CONTIPAY_AUTH_SECRET || process.env.CONTIPAY_API_SECRET || '')
  ).trim();
  const merchantId = Number(String(process.env.CONTIPAY_MERCHANT_ID || '').trim());
  const webhookUrl = String(process.env.CONTIPAY_WEBHOOK_URL || '').trim();
  const successUrl = String(process.env.CONTIPAY_SUCCESS_URL || '').trim();
  const cancelUrl = String(process.env.CONTIPAY_CANCEL_URL || '').trim();
  const webhookToken = String(process.env.CONTIPAY_WEBHOOK_TOKEN || '').trim();
  const live = String(process.env.CONTIPAY_ENV || 'sandbox').toLowerCase() === 'live';
  const override = String(process.env.CONTIPAY_BASE_URL || '').trim().replace(/\/$/, '');

  return {
    apiKey,
    apiSecret,
    merchantId: Number.isFinite(merchantId) ? merchantId : 0,
    webhookUrl,
    successUrl,
    cancelUrl,
    webhookToken,
    live,
    baseUrl: override || (live ? LIVE_BASE : SANDBOX_BASE),
    ready: !!apiKey && !!apiSecret && !!merchantId && !!webhookUrl,
  };
}

/** ContiPay authenticates with HTTP Basic over `key:secret`. */
export function basicAuthHeader() {
  const { apiKey, apiSecret } = contipayConfig();
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`, 'utf8').toString('base64')}`;
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
 * A 4xx is ContiPay telling us the request is wrong — retrying that just
 * burns quota and delays the error the caller needs to see.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, baseDelayMs?: number }} [opts]
 * @returns {Promise<T>}
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
      // Full jitter: avoids a thundering herd when ContiPay recovers.
      const backoff = baseDelayMs * 2 ** attempt;
      await sleep(backoff / 2 + Math.random() * (backoff / 2));
    }
  }
  throw lastError;
}

/**
 * The webhook URL ContiPay should call.
 *
 * Deliberately carries NO secret. ContiPay authenticate webhook delivery with
 * a token they send in the `Authorization: Bearer` header, and their guidance
 * is explicit: never put tokens, passwords or API keys in the webhook URL.
 * URLs end up in logs, proxy headers and referrers.
 */
export function webhookUrl() {
  return contipayConfig().webhookUrl;
}

/** Pull the token out of an `Authorization: Bearer <token>` header. */
export function bearerToken(header) {
  const raw = String(header || header?.authorization || '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match ? match[1].trim() : '';
}

/**
 * Classify a webhook status using ContiPay's published codes.
 *
 *   1        PAID              final success
 *   3, 4     ERROR / DECLINED  final failure
 *   0, 6     PENDING / QUEUED  delayed — keep the order open
 *   anything else               review — treat as not final
 *
 * Only 'paid' and 'failed' are FINAL. Never settle on a delayed or review
 * status; wait for the callback or use the status inquiry endpoint.
 */
export function classifyStatus(statusCode, statusText) {
  const code = Number(statusCode);
  if (code === 1) return 'paid';
  if (code === 3 || code === 4) return 'failed';
  if (code === 0 || code === 6) return 'delayed';
  const text = String(statusText || '').toLowerCase();
  if (['paid', 'completed', 'success', 'successful'].includes(text)) return 'paid';
  if (['declined', 'error', 'failed', 'cancelled', 'refunded', 'expired'].includes(text)) return 'failed';
  if (['pending', 'queued', 'submitted', 'processing', 'in_progress'].includes(text)) return 'delayed';
  return 'review';
}

/**
 * Fields safe to log.
 *
 * The webhook body carries `clientKey`, which is our own Auth Key echoed back,
 * and customer names/email/cell. Never dump the raw body or the Authorization
 * header into a log.
 */
export function redactWebhook(body) {
  const b = body || {};
  return {
    contiPayRef: b.contiPayRef ?? null,
    merchantRef: b.merchantRef ?? null,
    correlator: b.correlator ?? null,
    statusCode: b.statusCode ?? null,
    status: b.status ?? null,
    amount: b.amount ?? null,
    currencyCode: b.currencyCode ?? null,
  };
}

/**
 * Ask ContiPay for the status of a transaction.
 *
 * Their docs reference a "transaction status inquiry endpoint" for delayed
 * webhooks and reconciliation, but do not publish its path in the guides we
 * have. Rather than invent a URL that would 404 in production, this stays
 * dormant until you set CONTIPAY_STATUS_PATH (e.g. "/acquire/status").
 *
 * Returns null when it is not configured or the call fails — callers must treat
 * null as "unknown", never as "not paid".
 */
export async function inquireTransaction(reference) {
  const cfg = contipayConfig();
  const path = String(process.env.CONTIPAY_STATUS_PATH || '').trim();
  if (!path || !reference || !cfg.apiKey) return null;

  try {
    const res = await withRetry(
      () =>
        fetch(`${cfg.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: basicAuthHeader(),
          },
          body: JSON.stringify({ merchantId: cfg.merchantId, reference: String(reference) }),
        }),
      { attempts: 2, baseDelayMs: 300 }
    );
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

/**
 * Split a display name into the parts ContiPay's customer object wants.
 * ContiPay expects firstName / surname; we only ever hold one string.
 */
export function splitName(displayName, email) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    const local = String(email || '').split('@')[0] || 'Customer';
    return { firstName: local, surname: local };
  }
  if (parts.length === 1) return { firstName: parts[0], surname: parts[0] };
  return { firstName: parts[0], surname: parts.slice(1).join(' ') };
}

/**
 * Initiate a redirect payment.
 *
 * PUT {baseUrl}/acquire/payment
 *
 * @returns {Promise<{ status: string, statusCode: number, message: string,
 *   redirectUrl: string, mode?: string, raw: object }>}
 */
export async function initiatePayment({ reference, amount, description, customer, currencyCode = 'USD' }) {
  const cfg = contipayConfig();
  if (!cfg.ready) {
    const error = new Error('ContiPay is not configured on the server.');
    error.status = 500;
    throw error;
  }

  const payload = {
    webhookUrl: webhookUrl(),
    description: String(description || 'LINKUP').slice(0, 120),
    amount: Number(Number(amount).toFixed(2)),
    reference: String(reference),
    merchantId: cfg.merchantId,
    currencyCode: String(currencyCode || 'USD').toUpperCase(),
    // ContiPay sends the browser back to these; entitlement is granted by the
    // webhook, never by the browser landing on successUrl.
    successUrl: cfg.successUrl || undefined,
    cancelUrl: cfg.cancelUrl || undefined,
    customer: {
      nationalId: '',
      surname: customer?.surname || 'Customer',
      firstName: customer?.firstName || 'Customer',
      middleName: '',
      email: customer?.email || '',
      cell: customer?.cell || '',
      countryCode: customer?.countryCode || 'ZW',
    },
  };

  const res = await withRetry(
    () =>
      fetch(`${cfg.baseUrl}/acquire/payment`, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: basicAuthHeader(),
        },
        body: JSON.stringify(payload),
      }),
    { attempts: 3, baseDelayMs: 400 }
  );

  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (!res.ok) {
    const error = new Error(data?.message || `ContiPay returned HTTP ${res.status}`);
    error.status = res.status;
    error.body = text.slice(0, 500);
    throw error;
  }

  return {
    status: String(data.status || ''),
    statusCode: Number(data.statusCode ?? -1),
    message: String(data.message || ''),
    redirectUrl: String(data.redirectUrl || ''),
    mode: data.mode ? String(data.mode) : undefined,
    raw: data,
  };
}

/**
 * Is this webhook from ContiPay, for us?
 *
 * ContiPay sends the configured webhook token as `Authorization: Bearer <t>`.
 * That header is the primary authentication; the body is only corroboration,
 * because `clientKey` is simply our own Auth Key echoed back.
 *
 * Failing the header check is a hard reject — we never touch a document.
 */
export function verifyWebhook({ headers, body }) {
  const cfg = contipayConfig();

  if (cfg.webhookToken) {
    const presented = bearerToken(headers?.authorization || headers?.Authorization);
    if (!safeEqual(presented, cfg.webhookToken)) {
      return { ok: false, reason: 'bad-bearer-token' };
    }
  }

  if (cfg.apiKey && body?.clientKey) {
    if (!safeEqual(String(body.clientKey), cfg.apiKey)) {
      return { ok: false, reason: 'bad-client-key' };
    }
  }

  if (cfg.merchantId && body?.merchantId != null) {
    if (Number(body.merchantId) !== Number(cfg.merchantId)) {
      return { ok: false, reason: 'bad-merchant-id' };
    }
  }

  return { ok: true, reason: 'ok' };
}
