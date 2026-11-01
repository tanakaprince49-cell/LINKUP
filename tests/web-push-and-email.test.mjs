import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  generateVapidKeys,
  createVapidJwt,
  encryptWebPushPayload,
  sanitizeWebPushSubscription,
  saveWebPushSubscription,
  sendWebPush,
} from '../api/_webPush.js';
import {
  emailStatus,
  signEmailUnsubscribe,
  verifyEmailUnsubscribe,
  sendHighSignalEmail,
  unsubscribeUserEmail,
} from '../api/_emailNotify.js';
import { shouldRunDailyJob, markDailyJobRan } from '../functions/_dailyGate.mjs';

function memoryDb() {
  const store = new Map();
  return {
    collection(col) {
      return {
        doc(id) {
          const key = `${col}/${id}`;
          return {
            async get() {
              const v = store.get(key);
              return { exists: v !== undefined, data: () => v };
            },
            async set(data, opts) {
              const prev = opts?.merge && store.has(key) ? store.get(key) : {};
              store.set(key, { ...prev, ...data });
            },
          };
        },
      };
    },
  };
}

test('Web Push RFC 8291 aes128gcm encryption round-trips cleanly and VAPID ES256 verifies', () => {
  const subscriber = crypto.createECDH('prime256v1');
  subscriber.generateKeys();
  const uaPublic = subscriber.getPublicKey();
  const authSecret = crypto.randomBytes(16);

  const plaintext = JSON.stringify({ title: 'New match!', body: 'Ada is ready to talk.', url: '/alerts' });
  const encrypted = encryptWebPushPayload(
    plaintext,
    uaPublic.toString('base64url'),
    authSecret.toString('base64url'),
  );

  // Parse RFC 8188 header: 16B salt | 4B rs | 1B idlen | 65B asPublic | ciphertext+tag
  const salt = encrypted.subarray(0, 16);
  const rs = encrypted.readUInt32BE(16);
  const idlen = encrypted[20];
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);
  const asPublic = encrypted.subarray(21, 21 + idlen);
  const body = encrypted.subarray(21 + idlen);
  const ciphertext = body.subarray(0, body.length - 16);
  const tag = body.subarray(body.length - 16);

  // Subscriber derives CEK + nonce and decrypts
  const shared = subscriber.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'ascii'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'ascii'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'ascii'), 12));
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const record = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  assert.equal(record.at(-1), 0x02);
  assert.equal(record.subarray(0, -1).toString('utf8'), plaintext);

  // VAPID ES256 signature verifies with exported public key
  const vapid = generateVapidKeys();
  const jwt = createVapidJwt('https://fcm.googleapis.com/fcm/send/abc', vapid, 1700000000);
  const [h, p, sig] = jwt.split('.');
  const pubKeyObj = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: vapid.privateJwk.x, y: vapid.privateJwk.y },
    format: 'jwk',
  });
  assert.equal(
    crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pubKeyObj, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')),
    true,
  );
});

test('Web Push rejects private/insecure endpoints and prunes 410 Gone subscriptions', async () => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const p256dh = ecdh.getPublicKey().toString('base64url');
  const auth = crypto.randomBytes(16).toString('base64url');

  assert.equal(sanitizeWebPushSubscription({ endpoint: 'http://fcm.googleapis.com/send/1', keys: { p256dh, auth } }), null);
  assert.equal(sanitizeWebPushSubscription({ endpoint: 'https://127.0.0.1/send/1', keys: { p256dh, auth } }), null);
  assert.equal(sanitizeWebPushSubscription({ endpoint: 'https://localhost/send/1', keys: { p256dh, auth } }), null);

  const db = memoryDb();
  await saveWebPushSubscription(db, 'alice', { endpoint: 'https://fcm.googleapis.com/fcm/send/live', keys: { p256dh, auth } });
  await saveWebPushSubscription(db, 'alice', { endpoint: 'https://fcm.googleapis.com/fcm/send/dead', keys: { p256dh, auth } });

  const res = await sendWebPush(db, 'alice', { title: 'Win!', body: 'You won', url: '/campaigns' }, {
    fetcher: async (url) => ({ status: url.endsWith('/dead') ? 410 : 201 }),
  });
  assert.equal(res.sent, 1);
  const saved = (await db.collection('webPushDevices').doc('alice').get()).data().subscriptions;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].endpoint, 'https://fcm.googleapis.com/fcm/send/live');
});

test('High-signal email enforces RESEND_API_KEY, throttling, and signed one-click unsubscribe', async () => {
  const db = memoryDb();
  await db.collection('users').doc('alice').set({ email: 'alice@example.com', displayName: 'Alice' });

  assert.equal(emailStatus({}).available, false);
  const disabled = await sendHighSignalEmail(db, 'alice', { subject: 'Hi' }, { env: {} });
  assert.equal(disabled.sent, false);

  let sentPayloads = [];
  const env = { RESEND_API_KEY: 're_test_123', EMAIL_FROM: 'LINKUP <alerts@linkupbuild.com>' };
  const fetcher = async (_url, init) => {
    sentPayloads.push(JSON.parse(init.body));
    return { ok: true, status: 200 };
  };

  const first = await sendHighSignalEmail(db, 'alice', {
    receiptKey: 'league_win_week_2026-W44',
    throttleMs: 0,
    subject: 'You won the Builder League!',
    headline: 'You won!',
    body: 'Claim your campaign.',
    ctaUrl: '/campaigns',
  }, { env, fetcher });
  assert.equal(first.sent, true);
  assert.equal(sentPayloads.length, 1);
  assert.ok(sentPayloads[0].headers['List-Unsubscribe']);

  // Deterministic duplicate win receipt never emails twice
  const dup = await sendHighSignalEmail(db, 'alice', {
    receiptKey: 'league_win_week_2026-W44',
    throttleMs: 0,
    subject: 'You won the Builder League!',
  }, { env, fetcher });
  assert.equal(dup.sent, false);
  assert.equal(dup.reason, 'duplicate');

  // Signed unsubscribe link verifies and suppresses future emails
  const sig = signEmailUnsubscribe('alice');
  assert.equal(verifyEmailUnsubscribe('alice', sig), true);
  assert.equal(verifyEmailUnsubscribe('bob', sig), false);
  await unsubscribeUserEmail(db, 'alice');
  const blocked = await sendHighSignalEmail(db, 'alice', { receiptKey: 'other_event' }, { env, fetcher });
  assert.equal(blocked.sent, false);
  assert.equal(blocked.reason, 'unsubscribed');
});

test('Firestore daily cron gate runs once per UTC day regardless of dispatch hour', async () => {
  const db = memoryDb();
  const morning = new Date('2026-11-01T07:15:00Z');
  const afternoon = new Date('2026-11-01T14:40:00Z');
  const tomorrow = new Date('2026-11-02T01:05:00Z');

  assert.equal(await shouldRunDailyJob(db, 'backfill-public-profiles', { daily: true, now: morning }), true);
  await markDailyJobRan(db, 'backfill-public-profiles', { daily: true, write: true, now: morning });
  assert.equal(await shouldRunDailyJob(db, 'backfill-public-profiles', { daily: true, now: afternoon }), false);
  assert.equal(await shouldRunDailyJob(db, 'backfill-public-profiles', { daily: false, now: afternoon }), true);
  assert.equal(await shouldRunDailyJob(db, 'backfill-public-profiles', { daily: true, now: tomorrow }), true);
});
