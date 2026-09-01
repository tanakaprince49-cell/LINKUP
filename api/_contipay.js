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

/** ContiPay status codes we care about (from the webhook payload). */
export const CONTIPAY_STATUS = {
  PAID: 1,
  DECLINED: 4,
};

/**
 * Read config fresh on every call.
 *
 * Required in the host environment:
 *   CONTIPAY_API_KEY        — issued API key (Basic auth user)
 *   CONTIPAY_API_SECRET     — issued API secret (Basic auth password)
 *   CONTIPAY_MERCHANT_ID    — numeric merchant id, e.g. 1234
 *   CONTIPAY_WEBHOOK_URL    — absolute URL ContiPay POSTs payment updates to
 *
 * Optional:
 *   CONTIPAY_WEBHOOK_TOKEN  — shared secret appended to the webhook URL.
 *                             STRONGLY RECOMMENDED: ContiPay's webhook payload
 *                             carries no signature, so this token is the only
 *                             real authentication on that endpoint.
 *   CONTIPAY_SUCCESS_URL    — where ContiPay sends the browser on success
 *   CONTIPAY_CANCEL_URL     — where ContiPay sends the browser on cancel
 *   CONTIPAY_ENV            — 'sandbox' (default) | 'live'
 */
export function contipayConfig() {
  const apiKey = String(process.env.CONTIPAY_API_KEY || '').trim();
  const apiSecret = String(process.env.CONTIPAY_API_SECRET || '').trim();
  const merchantId = Number(String(process.env.CONTIPAY_MERCHANT_ID || '').trim());
  const webhookUrl = String(process.env.CONTIPAY_WEBHOOK_URL || '').trim();
  const successUrl = String(process.env.CONTIPAY_SUCCESS_URL || '').trim();
  const cancelUrl = String(process.env.CONTIPAY_CANCEL_URL || '').trim();
  const webhookToken = String(process.env.CONTIPAY_WEBHOOK_TOKEN || '').trim();
  const live = String(process.env.CONTIPAY_ENV || 'sandbox').toLowerCase() === 'live';

  return {
    apiKey,
    apiSecret,
    merchantId: Number.isFinite(merchantId) ? merchantId : 0,
    webhookUrl,
    successUrl,
    cancelUrl,
    webhookToken,
    live,
    baseUrl: live ? LIVE_BASE : SANDBOX_BASE,
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
 * The webhook URL ContiPay should call, with the shared secret attached.
 *
 * ContiPay's webhook body carries no signature — only a `clientKey`, which is
 * just our own API key echoed back. Anyone who observes one webhook could
 * otherwise replay it. Appending a secret token gives the endpoint something
 * genuinely unguessable to check.
 */
export function webhookUrlWithToken() {
  const { webhookUrl, webhookToken } = contipayConfig();
  if (!webhookUrl) return '';
  if (!webhookToken) return webhookUrl;
  const sep = webhookUrl.includes('?') ? '&' : '?';
  return `${webhookUrl}${sep}token=${encodeURIComponent(webhookToken)}`;
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
    webhookUrl: webhookUrlWithToken(),
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
 * Two independent checks, because the payload carries no signature:
 *   1. the shared secret token in the query string
 *   2. clientKey === our API key, and merchantId === ours
 *
 * Failing either is a hard reject — we never touch a document.
 */
export function verifyWebhook({ query, body }) {
  const cfg = contipayConfig();

  if (cfg.webhookToken) {
    if (!safeEqual(String(query?.token || ''), cfg.webhookToken)) {
      return { ok: false, reason: 'bad-token' };
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
