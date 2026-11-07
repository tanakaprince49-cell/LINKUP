// One-time recognition deliveries for Builder League/Founder Spotlight awards.
// Inbox is written before push/email attempts so an external provider outage
// cannot erase the in-app record. The award key makes retrying idempotent.
import { sendExpoPush } from './_expoPush.js';
import { sendHighSignalEmail } from './_emailNotify.js';

export const leagueWinDocId = (kind, key) => `league_win_${kind}_${key}`;

export async function notifyLeagueWinner(db, {
  uid, kind, key, title, body, url, meta = {},
  notificationType = 'league', fromName = 'Builder League',
  email = {},
}, { push = (u, m) => sendExpoPush(db, u, m) } = {}) {
  if (!uid || !kind || !key) return { notified: false };
  const docId = leagueWinDocId(kind, key);
  const ref = db.collection('notifications').doc(docId);
  if ((await ref.get().catch(() => null))?.exists) return { notified: true, duplicate: true };
  const content = String(body).slice(0, 500);
  const doc = {
    userId: uid,
    fromId: 'linkup-league',
    fromName: String(fromName).slice(0, 80),
    fromPic: 'https://www.linkupbuild.com/app/icons/linky-avatar.png',
    type: notificationType,
    category: notificationType === 'founder_spotlight' ? 'founder_spotlight' : 'champion',
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
    const result = await push(uid, {
      title,
      body: content,
      url,
      campaign: notificationType === 'founder_spotlight' ? 'founder_spotlight' : 'league_win',
      category: doc.category,
      type: notificationType,
    });
    sent = Number(result?.sent) || 0;
  } catch {
    sent = 0;
  }
  await sendHighSignalEmail(db, uid, {
    receiptKey: docId,
    throttleMs: 0,
    minUserGapMs: email.minUserGapMs,
    mood: 'champion_crown',
    subject: String(email.subject || title).slice(0, 100),
    headline: String(email.headline || title).slice(0, 100),
    body: String(email.body || content).slice(0, 1200),
    ctaLabel: String(email.ctaLabel || (kind === 'week' ? 'See your spotlight' : 'View your champion ribbon')).slice(0, 64),
    ctaUrl: url || '/alerts',
  }).catch(() => null);
  doc.serverPushManaged = sent > 0;
  doc.pushStatus = sent > 0 ? 'provider_accepted' : 'not_accepted';
  await ref.set(doc).catch(() => null);
  return { notified: true, pushSent: sent > 0 };
}
