#!/usr/bin/env node
/**
 * Verify ContiPay sandbox credentials from your own machine — before you
 * deploy, before you touch the app.
 *
 * It sends a real (sandbox) payment request and prints the response, which
 * proves three things at once:
 *
 *   1. the Auth Key + Auth Secret are accepted (HTTP Basic)
 *   2. the merchant id is valid
 *   3. the payload shape is accepted
 *
 * No money moves. Nothing is charged unless someone completes payment on the
 * hosted page, and this is the sandbox, so no real funds exist.
 *
 * PowerShell (one line at a time — no &&):
 *
 *   $env:CONTIPAY_AUTH_KEY = "your_auth_key"
 *   $env:CONTIPAY_AUTH_SECRET = "your_auth_secret"
 *   $env:CONTIPAY_MERCHANT_ID = "1294"
 *   node scripts/verify-contipay.mjs
 *
 * Or put them in a .env file at the repo root (never committed) and just run:
 *
 *   node scripts/verify-contipay.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

// Minimal .env loader so this runs with no extra dependencies.
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const authKey = String(process.env.CONTIPAY_AUTH_KEY || process.env.CONTIPAY_API_KEY || '').trim();
const authSecret = String(process.env.CONTIPAY_AUTH_SECRET || process.env.CONTIPAY_API_SECRET || '').trim();
const merchantId = String(process.env.CONTIPAY_MERCHANT_ID || '').trim();
const baseUrl = String(process.env.CONTIPAY_BASE_URL || 'https://api-uat.contipay.net').trim().replace(/\/$/, '');
const webhookUrl = String(process.env.CONTIPAY_WEBHOOK_URL || '').trim();
const live = String(process.env.CONTIPAY_ENV || 'sandbox').toLowerCase() === 'live';

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!authKey || !authSecret) fail('CONTIPAY_AUTH_KEY and CONTIPAY_AUTH_SECRET must be set.');
if (!merchantId || !/^\d+$/.test(merchantId)) fail(`CONTIPAY_MERCHANT_ID must be numeric. Got: "${merchantId}"`);

const isLive = live || baseUrl.includes('api.contipay.net');
console.log(`\nContiPay credential check`);
console.log(`  base URL    : ${baseUrl}  ${isLive ? '(LIVE — real money)' : '(sandbox)'}`);
console.log(`  merchant id : ${merchantId}`);
console.log(`  auth key    : ${authKey.slice(0, 6)}…${authKey.slice(-4)}`);

if (isLive) {
  console.log('\n⚠️  You are pointed at the LIVE environment. Ctrl-C now if that is not intended.\n');
}

const reference = `TEST-${Date.now()}`;
const payload = {
  webhookUrl: webhookUrl || 'https://example.com/not-a-real-webhook',
  description: 'LINKUP credential check',
  amount: 1.0,
  reference,
  merchantId: Number(merchantId),
  currencyCode: 'USD',
  successUrl: 'https://example.com/success',
  cancelUrl: 'https://example.com/cancel',
  customer: {
    nationalId: '',
    surname: 'Test',
    firstName: 'Linkup',
    middleName: '',
    email: 'test@example.com',
    cell: '+263771234567',
    countryCode: 'ZW',
  },
};

console.log(`\nPUT ${baseUrl}/acquire/payment`);
console.log(`  reference   : ${reference}\n`);

let res;
let text;
try {
  res = await fetch(`${baseUrl}/acquire/payment`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${authKey}:${authSecret}`, 'utf8').toString('base64')}`,
    },
    body: JSON.stringify(payload),
  });
  text = await res.text();
} catch (error) {
  fail(`Network error: ${error?.message || error}\n  (ContiPay may be unreachable from here.)`);
}

let data = {};
try {
  data = JSON.parse(text);
} catch {
  /* not JSON */
}

console.log(`HTTP ${res.status}\n`);
console.log(text.slice(0, 1200));

if (res.status === 401 || res.status === 403) {
  fail('Credentials rejected. Check CONTIPAY_AUTH_KEY / CONTIPAY_AUTH_SECRET, and that you are\nusing the SANDBOX pair against the sandbox URL.');
}

if (!res.ok) {
  fail(
    `ContiPay returned HTTP ${res.status}.\n` +
      `  If it mentions the merchant, check CONTIPAY_MERCHANT_ID (${merchantId}).\n` +
      `  Otherwise the payload shape may differ from the published example.`
  );
}

if (!data.redirectUrl) {
  fail('No redirectUrl in the response — see the body above.');
}

console.log(`\n✓ Credentials and merchant id ${merchantId} are accepted.\n`);
console.log(`Open this to make a sandbox payment:\n  ${data.redirectUrl}\n`);
console.log(`Sandbox test numbers:`);
console.log(`  EcoCash   0771234567  success`);
console.log(`  EcoCash   0771234568  insufficient funds`);
console.log(`  EcoCash   0771234569  timeout`);
console.log(`  Omari     OTP 000000 success / 111111 insufficient / 222222 exceeds limit\n`);
console.log(
  webhookUrl
    ? `A webhook will be posted to: ${webhookUrl}`
    : `No CONTIPAY_WEBHOOK_URL set, so no webhook will arrive — set it to test the callback.`
);
