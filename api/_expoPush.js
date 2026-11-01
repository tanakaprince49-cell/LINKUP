// Shared push sender: fans out to Expo Push (native iOS/Android) AND Web Push
// (PWA / Chrome / Android web via VAPID + RFC 8291 aes128gcm). Never throws:
// missing tokens or a failed POST simply report {sent: 0}.
import { sendWebPush } from './_webPush.js';

const TOKEN_RX = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

export async function expoPushTokens(db, uid) {
  const snap = await db.collection('userPrivate').doc(uid).get().catch(() => null);
  const raw = snap?.exists ? snap.data().pushTokens : [];
  return [...new Set(Array.isArray(raw) ? raw : [])]
    .filter((t) => typeof t === 'string' && TOKEN_RX.test(t))
    .slice(0, 20);
}

async function sendNativeExpo(db, uid, { title, body, url = '', campaign = '', category = '', type = 'builder', extraData = null } = {}) {
  const tokens = await expoPushTokens(db, uid);
  if (!tokens.length) return { sent: 0, tokens: 0 };
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: 'Bearer ' + process.env.EXPO_ACCESS_TOKEN } : {}),
      },
      body: JSON.stringify(tokens.map((to) => ({
        to,
        title: String(title).slice(0, 100),
        body: String(body).slice(0, 180),
        data: { url, targetUrl: url, type, campaign, category, ...(extraData && typeof extraData === 'object' ? extraData : {}) },
        sound: 'default',
        priority:'high',
        channelId: 'default',
      }))),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json().catch(() => null);
    const sent = response.ok && Array.isArray(result?.data) ? result.data.filter((t) => t.status === 'ok').length : 0;
    return { sent, tokens: tokens.length };
  } catch {
    return { sent: 0, tokens: tokens.length };
  }
}

export async function sendExpoPush(db, uid, opts = {}) {
  const [nativeRes, webRes] = await Promise.all([
    sendNativeExpo(db, uid, opts),
    sendWebPush(db, uid, opts).catch(() => ({ sent: 0, subscriptions: 0 })),
  ]);
  return {
    sent: (Number(nativeRes?.sent) || 0) + (Number(webRes?.sent) || 0),
    tokens: (Number(nativeRes?.tokens) || 0) + (Number(webRes?.subscriptions) || 0),
    nativeSent: Number(nativeRes?.sent) || 0,
    webSent: Number(webRes?.sent) || 0,
  };
}
