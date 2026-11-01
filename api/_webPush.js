// Zero-dependency Web Push sender (RFC 8291 aes128gcm + RFC 8292 VAPID ES256).
// Uses Node 20's built-in crypto so Vercel deployments need no extra packages
// and zero Firebase Blaze spend. VAPID keys come from env when set, otherwise
// a P-256 keypair is generated once and persisted in Admin-only systemConfig.
import crypto from 'node:crypto';

const MAX_SUBS_PER_USER = 10;
let cachedVapid = null;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (str) => Buffer.from(String(str || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function isAllowedPushEndpoint(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '[::1]') return false;
    return h.includes('.');
  } catch {
    return false;
  }
}

export function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pubRaw = Buffer.concat([Buffer.from([0x04]), fromB64u(jwk.x), fromB64u(jwk.y)]);
  return {
    publicKey: b64u(pubRaw),
    privateJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d },
  };
}

function importVapidFromEnv() {
  const pub = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const priv = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!pub || !priv) return null;
  try {
    const pubBytes = fromB64u(pub);
    const privBytes = fromB64u(priv);
    if (pubBytes.length !== 65 || pubBytes[0] !== 0x04 || privBytes.length !== 32) return null;
    return {
      publicKey: b64u(pubBytes),
      privateJwk: {
        kty: 'EC',
        crv: 'P-256',
        x: b64u(pubBytes.subarray(1, 33)),
        y: b64u(pubBytes.subarray(33, 65)),
        d: b64u(privBytes),
      },
    };
  } catch {
    return null;
  }
}

export async function getVapidKeys(db) {
  const envKeys = importVapidFromEnv();
  if (envKeys) return envKeys;
  if (cachedVapid) return cachedVapid;
  if (db && typeof db.collection === 'function') {
    const ref = db.collection('systemConfig').doc('webPush');
    const snap = await ref.get().catch(() => null);
    if (snap?.exists && snap.data()?.publicKey && snap.data()?.privateJwk?.d) {
      cachedVapid = { publicKey: snap.data().publicKey, privateJwk: snap.data().privateJwk };
      return cachedVapid;
    }
    const generated = generateVapidKeys();
    await ref.set({ ...generated, createdAt: Date.now() }).catch(() => null);
    cachedVapid = generated;
    return cachedVapid;
  }
  cachedVapid = generateVapidKeys();
  return cachedVapid;
}

export function createVapidJwt(endpoint, vapid, nowSec = Math.floor(Date.now() / 1000)) {
  const aud = new URL(endpoint).origin;
  const sub = String(process.env.VAPID_SUBJECT || 'mailto:support@linkupbuild.com').trim();
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub }));
  const input = `${header}.${payload}`;
  const key = crypto.createPrivateKey({ key: vapid.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64u(sig)}`;
}

export function encryptWebPushPayload(plaintext, p256dh, auth) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('Invalid subscriber p256dh key.');
  if (authSecret.length < 16) throw new Error('Invalid subscriber auth secret.');

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'ascii'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'ascii'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'ascii'), 12));

  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8');
  const record = Buffer.concat([data, Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  const header = Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic]);
  return Buffer.concat([header, encrypted]);
}

export function sanitizeWebPushSubscription(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const endpoint = String(raw.endpoint || '').trim();
  const p256dh = String(raw.keys?.p256dh || '').trim();
  const auth = String(raw.keys?.auth || '').trim();
  if (!isAllowedPushEndpoint(endpoint) || endpoint.length > 2048) return null;
  try {
    const pub = fromB64u(p256dh);
    const sec = fromB64u(auth);
    if (pub.length !== 65 || pub[0] !== 0x04 || sec.length < 16 || sec.length > 64) return null;
    return { endpoint, keys: { p256dh: b64u(pub), auth: b64u(sec) } };
  } catch {
    return null;
  }
}

export async function saveWebPushSubscription(db, uid, rawSub) {
  const clean = sanitizeWebPushSubscription(rawSub);
  if (!clean) throw new Error('Invalid Web Push subscription.');
  const ref = db.collection('webPushDevices').doc(uid);
  const snap = await ref.get().catch(() => null);
  const existing = Array.isArray(snap?.exists ? snap.data()?.subscriptions : null) ? snap.data().subscriptions : [];
  const filtered = existing.filter((s) => s && s.endpoint && s.endpoint !== clean.endpoint);
  const next = [{ ...clean, updatedAt: Date.now() }, ...filtered].slice(0, MAX_SUBS_PER_USER);
  await ref.set({ subscriptions: next, updatedAt: Date.now() }, { merge: true });
  return { saved: true, count: next.length };
}

export async function sendWebPush(db, uid, { title, body, url = '', campaign = '', category = '', type = 'builder', icon = '', mood = '' } = {}, { fetcher = fetch } = {}) {
  if (!db || typeof db.collection !== 'function' || !uid) return { sent: 0, subscriptions: 0 };
  const ref = db.collection('webPushDevices').doc(uid);
  const snap = await ref.get().catch(() => null);
  const subs = (Array.isArray(snap?.exists ? snap.data()?.subscriptions : null) ? snap.data().subscriptions : [])
    .map(sanitizeWebPushSubscription)
    .filter(Boolean)
    .slice(0, MAX_SUBS_PER_USER);
  if (!subs.length) return { sent: 0, subscriptions: 0 };

  let vapid;
  try {
    vapid = await getVapidKeys(db);
  } catch {
    return { sent: 0, subscriptions: subs.length };
  }

  const MOOD_ICONS = {
    default: '/app/icons/linky-avatar.png',
    angry_1d: '/app/icons/icon-angry-red.png',
    sad_inactive: '/app/icons/icon-sad-inactive.png',
    ghost_abandoned: '/app/icons/icon-ghost-abandoned.png',
    unread_urgent: '/app/icons/icon-unread-urgent.png',
    streak_fire: '/app/icons/icon-streak-fire.png',
    champion_crown: '/app/icons/icon-champion-crown.png',
    on_fire_shipped: '/app/icons/icon-shipped.png',
    milestone_party: '/app/icons/icon-milestone-party.png',
    night_owl: '/app/icons/icon-night-owl.png',
    weekend_chill: '/app/icons/icon-weekend-chill.png',
  };
  const resolvedIcon = icon || MOOD_ICONS[mood] || '/app/icons/linky-avatar.png';

  const jsonPayload = JSON.stringify({
    title: String(title || 'LINKUP').slice(0, 100),
    body: String(body || '').slice(0, 180),
    url: url || '/alerts',
    icon: resolvedIcon,
    badge: '/app/icons/linky-avatar.png',
    type,
    campaign,
    category,
  });

  let sent = 0;
  const deadEndpoints = new Set();
  await Promise.all(subs.map(async (sub) => {
    try {
      const bodyBytes = encryptWebPushPayload(jsonPayload, sub.keys.p256dh, sub.keys.auth);
      const jwt = createVapidJwt(sub.endpoint, vapid);
      const res = await fetcher(sub.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          'Content-Length': String(bodyBytes.length),
          TTL: '86400',
          Urgency: 'high',
          Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
        },
        body: bodyBytes,
        signal: AbortSignal.timeout(8000),
      });
      if (res.status >= 200 && res.status < 300) sent += 1;
      else if (res.status === 404 || res.status === 410) deadEndpoints.add(sub.endpoint);
    } catch {
      // Network timeouts leave subscription intact for future retries.
    }
  }));

  if (deadEndpoints.size > 0) {
    const alive = subs.filter((s) => !deadEndpoints.has(s.endpoint));
    await ref.set({ subscriptions: alive, updatedAt: Date.now() }, { merge: true }).catch(() => null);
  }
  return { sent, subscriptions: subs.length };
}
