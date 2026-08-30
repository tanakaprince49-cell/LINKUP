#!/usr/bin/env node
// Verify your Paynow credentials from your own machine.
//
//   node scripts/verify-paynow.mjs
//
// Reads PAYNOW_INTEGRATION_ID / PAYNOW_INTEGRATION_KEY from .env (or the
// environment) and initiates a real $0.01 transaction against Paynow.
// No money moves — nothing is charged unless a customer completes payment on
// the Paynow page. It only proves the ID + Key are accepted.
//
// This needs network access to www.paynow.co.zw, which some sandboxes and CI
// runners block. Run it locally.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Minimal .env loader so this script works without extra dependencies.
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const ID = String(process.env.PAYNOW_INTEGRATION_ID || '').trim();
const KEY = String(process.env.PAYNOW_INTEGRATION_KEY || '').trim();
const RESULT_URL = String(process.env.PAYNOW_RESULT_URL || 'https://linkup-muqu.vercel.app/api/paynowWebhook').trim();
const RETURN_URL = String(process.env.PAYNOW_RETURN_URL || 'https://linkup-muqu.vercel.app/paynow/return').trim();

if (!ID || !KEY) {
  console.error('Missing PAYNOW_INTEGRATION_ID or PAYNOW_INTEGRATION_KEY.');
  console.error('Put them in .env (gitignored) or export them in your shell.');
  process.exit(1);
}

function generateHash(values, integrationKey) {
  let str = '';
  for (const key of Object.keys(values)) {
    if (key === 'hash') continue;
    str += String(values[key] ?? '');
  }
  str += String(integrationKey || '').toLowerCase();
  return crypto.createHash('sha512').update(str, 'utf8').digest('hex').toUpperCase();
}

const reference = `LKP-CREDCHECK-${Date.now()}`;

// Field order IS the hash order.
const data = {
  resulturl: encodeURI(RESULT_URL),
  returnurl: encodeURI(RETURN_URL),
  reference: encodeURI(reference),
  amount: '0.01',
  id: encodeURI(ID),
  additionalinfo: encodeURI('LINKUP credential check'),
  authemail: '',
  status: 'Message',
};
data.hash = generateHash(data, KEY);

const body = Object.keys(data)
  .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(data[k])}`)
  .join('&');

console.log(`Integration ID : ${ID}`);
console.log(`Reference      : ${reference}`);
console.log(`Amount         : $0.01 (not charged unless you complete the payment)`);
console.log('Contacting Paynow...\n');

try {
  const res = await fetch('https://www.paynow.co.zw/interface/initiatetransaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  const parsed = Object.fromEntries(
    text.split('&').map((kv) => {
      const i = kv.indexOf('=');
      return [decodeURIComponent(kv.slice(0, i)), decodeURIComponent((kv.slice(i + 1) || '').replace(/\+/g, ' '))];
    })
  );

  console.log('HTTP', res.statusCode ?? res.status);
  console.log(JSON.stringify(parsed, null, 2));

  if (String(parsed.status || '').toLowerCase() === 'ok' && parsed.redirecturl) {
    console.log('\n✅ Credentials ACCEPTED. Paynow returned a payment page:');
    console.log(parsed.redirecturl);
    console.log('\nNext: deploy, set the same vars in Vercel, and run a real $0.01 end-to-end.');
  } else {
    console.log('\n❌ Paynow rejected the request.');
    console.log('   Most common cause: the account is still in SANDBOX (cards show as');
    console.log('   "inactive"). Email support@paynow.co.zw with your KYC documents.');
    if (parsed.error) console.log(`   Paynow says: ${parsed.error}`);
  }
} catch (error) {
  console.error('\n⚠️  Could not reach Paynow:', error.message);
  console.error('   This is usually blocked egress from this machine, not a bad key.');
  console.error('   Run this from your own machine or a network that can reach paynow.co.zw.');
  process.exit(2);
}
