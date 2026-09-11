// POST /api/claimPlus
// Turns a verified Google Play purchase into the outward LINKUP PLUS identity
// (isPro / plan / isVerified / turboConnect) on users/{uid} and
// publicProfiles/{uid}, using the Admin SDK. The Firestore rules no longer let
// a client write those fields, so this endpoint is the ONLY path an Android
// buyer can take to unlock PLUS.
//
// Actions (body.action):
//   claim   — verify the Play purchase with the Google Play Developer API,
//             then grant PLUS. Requires the purchase token + product id.
//   revoke  — self-service cancel/lapse: clear the paid flags (harmless,
//             can only ever demote the caller's own account).
//   turbo   — set Turbo Connect on/off (on requires an active PLUS term).
//   status  — read back the caller's current outward PLUS identity.
//
// Body (claim): { action:'claim', productId, purchaseToken, orderId }
// Body (turbo): { action:'turbo', turboConnect: true|false }
// Headers: Authorization: Bearer <Firebase ID token>
//
// Env (Vercel) — required for `claim`:
//   PLAY_PACKAGE_NAME                     (default: com.tana.linkup)
//   PLAY_SERVICE_ACCOUNT_CLIENT_EMAIL     service account with Play Developer API access
//   PLAY_SERVICE_ACCOUNT_PRIVATE_KEY      PEM key (paste with \n escapes)
//
// Fail-closed: when the Play service account is not configured, `claim`
// returns 503 and grants nothing. The app keeps the local optimistic unlock
// for the buyer's own device and retries the claim on later launches.
import crypto from 'node:crypto';
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import { getDb, verifyRequestUser } from './_firebaseAdmin.js';
import { grantPlayPlus, revokePlusIdentity, setTurboConnect } from './_entitlements.js';

const PLAY_PACKAGE_NAME = 'com.tana.linkup';
const PLAY_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

const PLUS_SKUS = ['linkup_plus_monthly', 'linkup_plus_yearly_2'];

// Subscription states that still count as entitled.
const ENTITLED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_ON_HOLD',
  'SUBSCRIPTION_STATE_PAUSED',
]);

const playConfig = () => ({
  clientEmail: String(process.env.PLAY_SERVICE_ACCOUNT_CLIENT_EMAIL || '').trim(),
  privateKey: String(process.env.PLAY_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  packageName: String(process.env.PLAY_PACKAGE_NAME || PLAY_PACKAGE_NAME).trim(),
});

/** Mint a short-lived OAuth2 access token from the Play service account. */
async function playAccessToken() {
  const { clientEmail, privateKey } = playConfig();
  if (!clientEmail || !privateKey) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: clientEmail,
    scope: PLAY_SCOPE,
    aud: PLAY_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(claims)}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey).toString('base64url');
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch(PLAY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return typeof data.access_token === 'string' ? data.access_token : null;
}

/**
 * Verify a Google Play subscription purchase.
 * @returns {{ ok: true, orderId?: string, state?: string } | { ok: false, reason: string, status?: number }}
 */
async function verifyPlayPurchase(purchaseToken, productId) {
  const { clientEmail, privateKey, packageName } = playConfig();
  if (!clientEmail || !privateKey) {
    return {
      ok: false,
      status: 503,
      reason: 'Google Play verification is not configured on the server (PLAY_SERVICE_ACCOUNT_CLIENT_EMAIL / PLAY_SERVICE_ACCOUNT_PRIVATE_KEY).',
    };
  }
  if (!purchaseToken) return { ok: false, status: 400, reason: 'purchaseToken is required.' };

  const token = await playAccessToken();
  if (!token) return { ok: false, status: 502, reason: 'Could not obtain a Google Play API access token.' };

  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}` +
    `/purchases/subscriptionsv2/tokens/${encodeURIComponent(String(purchaseToken))}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) {
    return { ok: false, status: 400, reason: 'Google Play does not recognise that purchase token.' };
  }
  if (!res.ok) {
    return { ok: false, status: 502, reason: `Google Play verification failed (${res.status}).` };
  }

  const data = await res.json().catch(() => null);
  if (!data || typeof data !== 'object') {
    return { ok: false, status: 502, reason: 'Google Play returned an unreadable response.' };
  }

  const state = String(data.subscriptionState || '');
  if (!ENTITLED_STATES.has(state)) {
    return { ok: false, status: 409, reason: `This subscription is ${state || 'not active'} — no PLUS granted.` };
  }

  // If the response lists line items, none may be a different (non-PLUS) SKU.
  const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];
  const productIds = lineItems.map((li) => String(li?.productId || '')).filter(Boolean);
  if (productIds.length && !productIds.some((id) => PLUS_SKUS.includes(id))) {
    return { ok: false, status: 400, reason: 'Purchase product is not a LINKUP PLUS plan.' };
  }

  return {
    ok: true,
    orderId: String(data.latestOrderId || data.orderId || ''),
    state,
  };
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);
  if (req.method !== 'POST') {
    sendError(res, 405, 'Use POST to manage LINKUP PLUS.');
    return;
  }

  const user = await verifyRequestUser(req);
  if (!user?.uid) {
    sendError(res, 401, 'Sign in to manage LINKUP PLUS.');
    return;
  }

  const db = getDb();
  const body = readJsonBody(req);
  const action = String(body?.action || '').trim().toLowerCase();
  const uid = user.uid;

  if (action === 'claim') {
    const purchaseToken = String(body?.purchaseToken || '').trim();
    const productId = String(body?.productId || '').trim();
    const verification = await verifyPlayPurchase(purchaseToken, productId);
    if (!verification.ok) {
      sendError(res, verification.status || 500, verification.reason);
      return;
    }
    const granted = await grantPlayPlus(db, uid, {
      productId,
      transactionId: purchaseToken,
      orderId: verification.orderId || String(body?.orderId || '').trim(),
    }).catch(() => false);
    return res.status(200).json({
      ok: true,
      granted: !!granted,
      plus: true,
      flags: {
        isPro: true,
        isVerified: true,
        plan: 'plus',
        subscriptionPlan: 'plus',
        subscriptionStatus: 'active',
        turboConnect: true,
      },
    });
  }

  if (action === 'revoke') {
    const wrote = await revokePlusIdentity(db, uid).catch(() => false);
    return res.status(200).json({ ok: true, revoked: !!wrote, plus: false });
  }

  if (action === 'turbo') {
    const on = body?.turboConnect === true || body?.turboConnect === 'true';
    const set = await setTurboConnect(db, uid, on).catch(() => false);
    if (!set) {
      sendError(res, 403, 'Turbo Connect requires an active LINKUP PLUS plan.');
      return;
    }
    return res.status(200).json({ ok: true, turboConnect: on });
  }

  if (action === 'status') {
    const userSnap = await db.collection('users').doc(uid).get().catch(() => null);
    const u = userSnap && userSnap.exists ? userSnap.data() || {} : {};
    const plus =
      !!u.isPro ||
      ['pro', 'plus'].includes(String(u.plan || '').toLowerCase()) ||
      ['pro', 'plus'].includes(String(u.subscriptionPlan || '').toLowerCase());
    return res.status(200).json({
      ok: true,
      plus,
      flags: plus
        ? {
            isPro: true,
            isVerified: !!u.isVerified,
            plan: String(u.plan || 'plus'),
            subscriptionPlan: String(u.subscriptionPlan || 'plus'),
            subscriptionStatus: String(u.subscriptionStatus || 'active'),
            turboConnect: !!u.turboConnect,
          }
        : null,
    });
  }

  sendError(res, 400, 'Unknown action. Use claim, revoke, turbo or status.');
}
