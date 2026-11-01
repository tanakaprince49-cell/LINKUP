// Free-tier high-signal email fallback (Resend: 100/day, 3,000 free/month, no card).
// Fail-closed unless RESEND_API_KEY is configured. Enforces signed one-click
// unsubscribe links, per-recipient throttling, daily free-tier quota shields,
// and strict high-signal scope (Builder League wins, missed matches/requests,
// weekly digest, and milestone comeback check-ins with automatic sunsetting).
import crypto from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';

const APP_BASE = 'https://www.linkupbuild.com/app';
const API_BASE = 'https://linkup-muqu.vercel.app';
const SOCIAL_THROTTLE_MS = 6 * 60 * 60 * 1000;
export const DAILY_EMAIL_HARD_CAP = 90;
export const DAILY_COMEBACK_EMAIL_CAP = 50;
export const COMEBACK_SUNSET_DAYS = 45;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function hmacSecret() {
  const explicit = String(process.env.LINKY_CRON_SECRET || process.env.RESEND_API_KEY || '').trim();
  if (explicit) return explicit;
  try {
    const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
    const key = raw ? String(JSON.parse(raw).private_key || '') : String(process.env.FIREBASE_PRIVATE_KEY || '');
    if (key) return crypto.createHash('sha256').update(`linkup-email:${key.replace(/\s+/g, '')}`).digest('hex');
  } catch {}
  return 'linkup-local-email-secret';
}

export function signEmailUnsubscribe(uid) {
  return crypto.createHmac('sha256', hmacSecret()).update(`unsub:${uid}`).digest('hex').slice(0, 32);
}

export function verifyEmailUnsubscribe(uid, sig) {
  if (!uid || !sig) return false;
  const expected = Buffer.from(signEmailUnsubscribe(uid));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function unsubscribeEmailUrl(uid) {
  return `${API_BASE}/api/linky?action=unsubscribeEmail&uid=${encodeURIComponent(uid)}&sig=${encodeURIComponent(signEmailUnsubscribe(uid))}`;
}

export function emailStatus(env = process.env) {
  const key = String(env?.RESEND_API_KEY || '').trim();
  if (!key) return { available: false, provider: 'none', reason: 'RESEND_API_KEY not set' };
  return {
    available: true,
    provider: 'resend',
    from: String(env?.EMAIL_FROM || 'LINKUP <notifications@linkupbuild.com>').trim(),
  };
}

export function comebackEmailMilestone(daysSinceActive) {
  const days = Number(daysSinceActive);
  if (!Number.isFinite(days) || days < 3) return null;
  if (days > COMEBACK_SUNSET_DAYS) return 'sunset';
  if (days >= 30) return 'day30';
  if (days >= 14) return 'day14';
  if (days >= 7) return 'day7';
  return 'day3';
}

async function reserveDailyEmailQuota(db, bucket = 'transactional', bucketCap = DAILY_EMAIL_HARD_CAP, nowMs = Date.now()) {
  if (!db) return { allowed: false, reason: 'no_db' };
  const utcDay = new Date(nowMs).toISOString().slice(0, 10);
  const quotaRef = db.collection('systemJobs').doc(`emailQuota_${utcDay}`);
  try {
    if (typeof db.runTransaction === 'function') {
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(quotaRef);
        const cur = snap?.exists ? snap.data() || {} : {};
        const total = Number(cur.total || 0);
        const count = Number(cur[bucket] || 0);
        if (total >= DAILY_EMAIL_HARD_CAP || count >= bucketCap) {
          return { allowed: false, reason: 'daily_quota_reached', total, count };
        }
        tx.set(quotaRef, {
          day: utcDay,
          total: total + 1,
          [bucket]: count + 1,
          updatedAt: nowMs,
        }, { merge: true });
        return { allowed: true, total: total + 1, count: count + 1 };
      });
    }
    const snap = await quotaRef.get().catch(() => null);
    const cur = snap?.exists ? snap.data() || {} : {};
    const total = Number(cur.total || 0);
    const count = Number(cur[bucket] || 0);
    if (total >= DAILY_EMAIL_HARD_CAP || count >= bucketCap) {
      return { allowed: false, reason: 'daily_quota_reached', total, count };
    }
    await quotaRef.set({
      day: utcDay,
      total: total + 1,
      [bucket]: count + 1,
      updatedAt: nowMs,
    }, { merge: true });
    return { allowed: true, total: total + 1, count: count + 1 };
  } catch {
    return { allowed: true, fallback: true };
  }
}

async function resolveRecipientEmail(db, uid) {
  const userSnap = await db.collection('users').doc(uid).get().catch(() => null);
  if (userSnap?.exists && (userSnap.data()?.deleted || userSnap.data()?.banned)) return '';
  const fromDoc = String(userSnap?.exists ? userSnap.data()?.email || '' : '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromDoc)) return fromDoc;
  try {
    const authUser = await getAuth().getUser(uid);
    const fromAuth = String(authUser?.email || '').trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAuth)) return fromAuth;
  } catch {}
  return '';
}

export async function unsubscribeUserEmail(db, uid) {
  await db.collection('emailPrefs').doc(uid).set({ unsubscribed: true, updatedAt: Date.now() }, { merge: true });
  return { unsubscribed: true };
}

export async function sendHighSignalEmail(db, uid, {
  receiptKey = '',
  throttleMs = SOCIAL_THROTTLE_MS,
  subject = 'LINKUP update',
  headline = 'You have an update on LINKUP',
  body = '',
  ctaLabel = 'Open LINKUP',
  ctaUrl = '/alerts',
  badgeLabel = 'High-signal LINKUP alert',
  quotaBucket = 'transactional',
  quotaCap = DAILY_EMAIL_HARD_CAP,
} = {}, { fetcher = fetch, env = process.env, now = Date.now() } = {}) {
  const status = emailStatus(env);
  if (!status.available || !db || !uid) return { sent: false, reason: status.reason || 'disabled' };

  const prefSnap = await db.collection('emailPrefs').doc(uid).get().catch(() => null);
  if (prefSnap?.exists && prefSnap.data()?.unsubscribed === true) return { sent: false, reason: 'unsubscribed' };

  const nowMs = typeof now === 'function' ? now() : Number(now) || Date.now();
  const rKey = receiptKey || `social_${uid}`;
  const receiptRef = db.collection('emailReceipts').doc(rKey.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120));
  const prev = await receiptRef.get().catch(() => null);
  if (prev?.exists) {
    if (throttleMs <= 0) return { sent: false, reason: 'duplicate' };
    if (nowMs - Number(prev.data()?.at || 0) < throttleMs) return { sent: false, reason: 'throttled' };
  }

  const to = await resolveRecipientEmail(db, uid);
  if (!to) return { sent: false, reason: 'no_email' };

  const quota = await reserveDailyEmailQuota(db, quotaBucket, quotaCap, nowMs);
  if (!quota.allowed) return { sent: false, reason: quota.reason || 'daily_quota_reached' };

  const fullUrl = ctaUrl.startsWith('http') ? ctaUrl : `${APP_BASE}${ctaUrl.startsWith('/') ? ctaUrl : '/' + ctaUrl}`;
  const unsubUrl = unsubscribeEmailUrl(uid);
  const textBody = `${headline}\n\n${body}\n\n${ctaLabel}: ${fullUrl}\n\n---\nUnsubscribe from LINKUP notification emails: ${unsubUrl}`;
  const htmlBody = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0A0B0D;background:#FFFFFF;border:1px solid #E7E5DC;border-radius:18px">
  <div style="font-weight:900;font-size:15px;letter-spacing:0.6px;margin-bottom:16px">LINK<span style="background:#FBE618;padding:2px 6px;border-radius:5px">UP</span></div>
  <h2 style="font-size:20px;line-height:1.35;margin:0 0 12px">${esc(headline)}</h2>
  <p style="font-size:15px;line-height:1.6;color:#383B40;margin:0 0 20px">${esc(body)}</p>
  <a href="${esc(fullUrl)}" style="display:inline-block;background:#FBE618;color:#0A0B0D;font-weight:800;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:12px">${esc(ctaLabel)} →</a>
  <hr style="border:none;border-top:1px solid #ECEAE2;margin:24px 0 14px"/>
  <p style="font-size:12px;color:#767A82;margin:0">${esc(badgeLabel)} · <a href="${esc(unsubUrl)}" style="color:#575B60">Unsubscribe in one click</a></p>
</div>`;

  try {
    const res = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(env.RESEND_API_KEY).trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: status.from,
        to: [to],
        subject: String(subject).slice(0, 120),
        text: textBody,
        html: htmlBody,
        headers: {
          'List-Unsubscribe': `<${unsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { sent: false, reason: `http_${res.status}` };
    await receiptRef.set({ uid, at: nowMs, bucket: quotaBucket, subject: String(subject).slice(0, 120) }).catch(() => null);
    return { sent: true, bucket: quotaBucket };
  } catch {
    return { sent: false, reason: 'network_error' };
  }
}

export async function sendComebackEmail(db, uid, {
  daysSinceActive = 0,
  lastActiveAt = 0,
  headline = 'Your LinkUp seat is warm',
  body = 'Builders in your lane posted new progress while you were away. Jump back in when you have two minutes.',
  ctaLabel = 'Plug back into LINKUP',
  ctaUrl = '/ship?comeback=email',
  prefs = {},
} = {}, options = {}) {
  if (prefs && prefs.welcomeBack === false) return { sent: false, reason: 'welcome_back_opted_out' };
  const milestone = comebackEmailMilestone(daysSinceActive);
  if (!milestone) return { sent: false, reason: 'not_due' };
  if (milestone === 'sunset') return { sent: false, reason: 'sunset_inactive' };

  const cycleTag = Number(lastActiveAt) > 0
    ? new Date(Number(lastActiveAt)).toISOString().slice(0, 10)
    : 'initial';
  const receiptKey = `comeback_${uid}_${milestone}_${cycleTag}`;
  const isFinalNote = milestone === 'day30';
  const subjectPrefix = isFinalNote ? 'LINKUP · Last check-in for now: ' : 'LINKUP · ';
  const finalFooter = isFinalNote
    ? ' (We will pause comeback emails after today until you next stop by.)'
    : '';

  return sendHighSignalEmail(db, uid, {
    receiptKey,
    throttleMs: 0,
    subject: `${subjectPrefix}${headline}`.slice(0, 120),
    headline,
    body: `${body}${finalFooter}`,
    ctaLabel,
    ctaUrl,
    badgeLabel: 'Linky welcome-back invitation',
    quotaBucket: 'comeback',
    quotaCap: DAILY_COMEBACK_EMAIL_CAP,
  }, options);
}
