// Win notifications for the Builder League. A prize nobody hears about brings
// nobody back, so every granted title writes an inbox document AND attempts a
// native push. Wins bypass the retention preference gates: this is a prize,
// not a nudge. Deterministic document ids keep re-awards idempotent, and the
// inbox write lands before the push attempt so a push failure can never lose
// the win itself.
import { sendExpoPush } from './_expoPush.js';

export const leagueWinDocId = (kind, key) => `league_win_${kind}_${key}`;

export async function notifyLeagueWinner(db, { uid, kind, key, title, body, url, meta = {} }, { push = (u, m) => sendExpoPush(db, u, m) } = {}) {
  if (!uid || !kind || !key) return { notified: false };
  const ref = db.collection('notifications').doc(leagueWinDocId(kind, key));
  if ((await ref.get().catch(() => null))?.exists) return { notified: true, duplicate: true };
  const content = String(body).slice(0, 500);
  const doc = {
    userId: uid,
    fromId: 'linkup-league',
    fromName: 'Builder League',
    fromPic: '',
    type: 'league',
    category: 'champion',
    kind,
    title: String(title).slice(0, 100),
    body: content,
    content,
    url,
    targetUrl: url,
    ...meta,
    serverPushManaged: false,
    pushRequested: true,
    isRead: false,
    timestamp: new Date(),
  };
  await ref.set(doc);
  let sent = 0;
  try {
    const result = await push(uid, { title, body: content, url, campaign: 'league_win', category: 'champion', type: 'league' });
    sent = Number(result?.sent) || 0;
  } catch {
    sent = 0;
  }
  doc.serverPushManaged = sent > 0;
  doc.pushStatus = sent > 0 ? 'provider_accepted' : 'not_accepted';
  await ref.set(doc).catch(() => null);
  return { notified: true, pushSent: sent > 0 };
}
