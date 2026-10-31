// Shared Expo push sender. Reads the member's registered tokens from
// userPrivate and delivers through the Expo push API. Never throws: a
// missing token list or a failed POST just reports {sent: 0}.
const TOKEN_RX = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

export async function expoPushTokens(db, uid) {
  const snap = await db.collection('userPrivate').doc(uid).get().catch(() => null);
  const raw = snap?.exists ? snap.data().pushTokens : [];
  return [...new Set(Array.isArray(raw) ? raw : [])]
    .filter((t) => typeof t === 'string' && TOKEN_RX.test(t))
    .slice(0, 20);
}

export async function sendExpoPush(db, uid, { title, body, url = '', campaign = '', category = '', type = 'builder' } = {}) {
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
        data: { url, targetUrl: url, type, campaign, category },
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
