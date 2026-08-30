// Shared Paynow (Zimbabwe) helper for the LINKUP web checkout.
//
// Paynow is a ONE-TIME payment gateway — it has no recurring/subscription API.
// So web plans are sold as PREPAID TERMS (1 / 3 / 12 months) rather than
// auto-renewing subscriptions. See PAYNOW_SETUP.md.
//
// Security: the Integration Key never leaves the server. It is read from env
// at call time so it is never logged into a bundle or sent to the client.

const INITIATE_URL = 'https://www.paynow.co.zw/interface/initiatetransaction';

export function paynowConfig() {
  const id = String(process.env.PAYNOW_INTEGRATION_ID || '').trim();
  const key = String(process.env.PAYNOW_INTEGRATION_KEY || '').trim();
  const resultUrl = String(process.env.PAYNOW_RESULT_URL || '').trim();
  const returnUrl = String(process.env.PAYNOW_RETURN_URL || '').trim();
  return {
    id,
    key,
    resultUrl,
    returnUrl,
    ready: !!id && !!key && !!resultUrl,
  };
}

/**
 * Paynow's hash: SHA512 over every field value (excluding `hash` itself),
 * concatenated in insertion order, with the LOWERCASED integration key
 * appended, hex digest UPPERCASED.
 *
 * Values must be in the same encoded form as they are transmitted — the
 * official SDK URL-encodes with encodeURI before hashing, so we do too.
 *
 * Verified byte-identical to the official `paynow` npm SDK across multiple
 * payloads (see scripts/verify-paynow.mjs).
 *
 * NB: do NOT "fix" this by copying the SDK's `additionalinfo`. The SDK builds
 * that field by concatenating "title, " per cart item and then calling
 * substr(0, len - 3) — 3 instead of 2 — which silently chops the last
 * character off the description ("LINKUP PLUS - 1 month" -> "...1 mont").
 * That is a bug in the SDK, not a Paynow API limit. We send the full string.
 */
export function generateHash(values, integrationKey) {
  const crypto = require('crypto');
  let str = '';
  for (const key of Object.keys(values)) {
    if (key === 'hash') continue;
    str += String(values[key] ?? '');
  }
  str += String(integrationKey || '').toLowerCase();
  return crypto.createHash('sha512').update(str, 'utf8').digest('hex').toUpperCase();
}

/** Constant-time-ish compare so a timing oracle cannot probe the key. */
export function verifyHash(values, integrationKey) {
  const received = String(values?.hash || '');
  if (!received) return false;
  const expected = generateHash(values, integrationKey);
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Web plans. Paynow cannot auto-renew, so each entry is a fixed prepaid term.
 * `months` drives the entitlement window written at payment time.
 */
export function paynowPlans() {
  return {
    plus_1m: { label: 'LINKUP PLUS — 1 month', amount: 19.99, months: 1, tier: 'plus' },
    plus_3m: { label: 'LINKUP PLUS — 3 months', amount: 49.99, months: 3, tier: 'plus' },
    plus_12m: { label: 'LINKUP PLUS — 12 months', amount: 149.99, months: 12, tier: 'plus' },
    campaigns_1m: { label: 'LINKUP Campaigns — 1 month', amount: 29.99, months: 1, tier: 'campaigns' },
    campaigns_12m: { label: 'LINKUP Campaigns — 12 months', amount: 249.99, months: 12, tier: 'campaigns' },
  };
}

/** Add whole months to a date, clamping the day (31 Jan + 1 month -> 28/29 Feb). */
export function addMonths(from, months) {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Number(months || 0));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** Extend an existing paid-through date so topping up stacks instead of resetting. */
export function extendFrom(currentEndsAt, now, months) {
  const baseMs = currentEndsAt?.toMillis ? currentEndsAt.toMillis() : Number(currentEndsAt || 0);
  const base = baseMs && baseMs > now.getTime() ? new Date(baseMs) : now;
  return addMonths(base, months);
}

/** Initiate a Paynow web transaction. Returns the parsed key/value response. */
export async function initiateTransaction({ reference, amount, email, info }) {
  const { id, key, resultUrl, returnUrl } = paynowConfig();
  if (!id || !key) throw new Error('Paynow is not configured on the server.');

  // Field order IS the hash order — do not reorder.
  const data = {
    resulturl: encodeURI(resultUrl),
    returnurl: encodeURI(returnUrl),
    reference: encodeURI(reference),
    amount: Number(amount).toFixed(2),
    id: encodeURI(id),
    additionalinfo: encodeURI(String(info || 'LINKUP')),
    authemail: encodeURI(String(email || '')),
    status: 'Message',
  };
  data.hash = generateHash(data, key);

  const body = Object.keys(data)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(data[k])}`)
    .join('&');

  const res = await fetch(INITIATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  return parsePaynowResponse(text);
}

/** Paynow replies as a URL-encoded key=value string, not JSON. */
export function parsePaynowResponse(text) {
  const out = {};
  for (const pair of String(text || '').split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const k = i < 0 ? pair : pair.slice(0, i);
    const v = i < 0 ? '' : pair.slice(i + 1);
    out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}

/** Ask Paynow directly whether a transaction was paid (fallback to the webhook). */
export async function pollTransaction(pollUrl) {
  if (!pollUrl || !String(pollUrl).startsWith('https://www.paynow.co.zw/')) return null;
  const res = await fetch(pollUrl, { method: 'POST' });
  return parsePaynowResponse(await res.text());
}
