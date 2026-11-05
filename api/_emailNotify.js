// Free-tier email engine (Resend: 100/day, 3,000 free/month, zero card).
// Fail-closed unless RESEND_API_KEY is configured. Enforces signed one-click
// unsubscribe links, daily free-tier quota shields, LINKUP cat avatar sender
// header, and full-width uncropped expressive Linky mood illustrations.
import crypto from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';

const APP_BASE = 'https://www.linkupbuild.com/app';
const API_BASE = 'https://linkup-muqu.vercel.app';
const SOCIAL_THROTTLE_MS = 20 * 60 * 60 * 1000;
export const MIN_USER_EMAIL_GAP_MS = 20 * 60 * 60 * 1000;
export const MAX_USER_EMAILS_PER_DAY = 1;
const RESEND_FALLBACK_FROM = 'Linky at LINKUP <onboarding@resend.dev>';
export const LINKY_AVATAR_URL = `${APP_BASE}/icons/linky-avatar.png`;
export const DAILY_EMAIL_HARD_CAP = 95;
export const DAILY_PULSE_EMAIL_CAP = 85;
export const DAILY_COMEBACK_EMAIL_CAP = 50;
export const COMEBACK_SUNSET_DAYS = 45;

export const EMAIL_MOODS = Object.freeze({
  default: {
    id: 'default',
    heroFile: 'hero-default.png',
    iconFile: 'icon-default.png',
    pillText: 'Plugged in & ready',
    pillBg: '#FFF8B8',
    pillColor: '#0A0B0D',
    alt: 'Linky happily plugging an ethernet cable into the LINKUP wall socket',
  },
  angry_1d: {
    id: 'angry_1d',
    heroFile: 'hero-angry-red.png',
    iconFile: 'icon-angry-red.png',
    pillText: 'Linky noticed you missed a day',
    pillBg: '#FFE2E0',
    pillColor: '#9E1412',
    alt: 'Linky looking grumpy in fiery red holding an unplugged cable',
  },
  sad_inactive: {
    id: 'sad_inactive',
    heroFile: 'hero-sad-inactive.png',
    iconFile: 'icon-sad-inactive.png',
    pillText: 'Linky misses seeing your builds',
    pillBg: '#E4ECF7',
    pillColor: '#233654',
    alt: 'Linky looking sad in the rain beside an unplugged wall socket',
  },
  ghost_abandoned: {
    id: 'ghost_abandoned',
    heroFile: 'hero-ghost-abandoned.png',
    iconFile: 'icon-ghost-abandoned.png',
    pillText: 'Cobwebs are gathering on your desk',
    pillBg: '#EAEAF0',
    pillColor: '#1F2029',
    alt: 'Linky waiting in a dusty workspace with cobwebs on the wall socket',
  },
  unread_urgent: {
    id: 'unread_urgent',
    heroFile: 'hero-unread-urgent.png',
    iconFile: 'icon-unread-urgent.png',
    pillText: 'Someone is waiting on you',
    pillBg: '#FFF6B3',
    pillColor: '#0A0B0D',
    alt: 'Linky alert with incoming signal waves from the LINKUP socket',
  },
  streak_fire: {
    id: 'streak_fire',
    heroFile: 'hero-streak-fire.png',
    iconFile: 'icon-streak-fire.png',
    pillText: 'Your build streak is on the line',
    pillBg: '#FFE7D6',
    pillColor: '#9A2E00',
    alt: 'Linky rushing with a blazing orange ethernet plug to keep your streak alive',
  },
  champion_crown: {
    id: 'champion_crown',
    heroFile: 'hero-champion-crown.png',
    iconFile: 'icon-champion-crown.png',
    pillText: 'Builder League standout',
    pillBg: '#FFF4B8',
    pillColor: '#6B4E00',
    alt: 'Linky wearing a gold crown plugged into LINKUP',
  },
  on_fire_shipped: {
    id: 'on_fire_shipped',
    heroFile: 'hero-shipped.png',
    iconFile: 'icon-shipped.png',
    pillText: 'Momentum locked in',
    pillBg: '#DCFCE7',
    pillColor: '#14532D',
    alt: 'Linky wearing cool sunglasses after shipping today’s build',
  },
  milestone_party: {
    id: 'milestone_party',
    heroFile: 'hero-milestone-party.png',
    iconFile: 'icon-milestone-party.png',
    pillText: 'Milestone unlocked',
    pillBg: '#FEF08A',
    pillColor: '#0A0B0D',
    alt: 'Linky celebrating with confetti and a party hat',
  },
  night_owl: {
    id: 'night_owl',
    heroFile: 'hero-night-owl.png',
    iconFile: 'icon-night-owl.png',
    pillText: 'Late-night builder session',
    pillBg: '#E6E9F5',
    pillColor: '#0A0B0D',
    alt: 'Linky coding late at night with glowing yellow eyes',
  },
  weekend_chill: {
    id: 'weekend_chill',
    heroFile: 'hero-weekend-chill.png',
    iconFile: 'icon-weekend-chill.png',
    pillText: 'Easy weekend check-in',
    pillBg: '#FFEDD5',
    pillColor: '#7C2D12',
    alt: 'Linky relaxing with a warm mug on a calm weekend',
  },
});

const FORBIDDEN_EMAIL_PATTERNS = [
  /all\s+\d+\s+duolingo(?:-style)?/gi,
  /duolingo(?:-style)?/gi,
];

export function sanitizeEmailCopy(raw) {
  let clean = String(raw ?? '');
  for (const rx of FORBIDDEN_EMAIL_PATTERNS) {
    clean = clean.replace(rx, 'expressive');
  }
  return clean.replace(/\s{2,}/g, ' ').trim();
}

function cleanSnippet(value = '', maxLen = 84) {
  const cleaned = sanitizeEmailCopy(String(value || ''))
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/^[-•*:\s]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxLen) return cleaned;
  const sliced = cleaned.slice(0, maxLen - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > 24 ? sliced.slice(0, lastSpace) : sliced).replace(/[.,;:\s]+$/, '')}…`;
}

function joinHumanList(items = [], maxItems = 3) {
  const list = (Array.isArray(items) ? items : [items])
    .map((item) => {
      if (!item) return '';
      if (typeof item === 'string') return cleanSnippet(item, 44);
      if (typeof item === 'object') return cleanSnippet(item.title || item.label || item.name || item.role || '', 44);
      return '';
    })
    .filter(Boolean);
  const unique = [...new Set(list)].slice(0, maxItems);
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} & ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')} & ${unique[unique.length - 1]}`;
}

function extractGoalFromBio(bio = '') {
  const raw = String(bio || '').replace(/[\r\n]+/g, '. ').trim();
  if (!raw) return '';
  const sentences = raw.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    if (/\b(goal|building|launching|working on|aiming|shipping|scaling|creating|solving)\b/i.test(s)) {
      return cleanSnippet(s.replace(/[.!?]+$/, ''), 76);
    }
  }
  return '';
}

export function buildPersonalBuilderBrief({ user = {}, state = {}, venture = {} } = {}) {
  const u = user && typeof user === 'object' ? user : {};
  const s = state && typeof state === 'object' ? state : {};
  const v = venture && typeof venture === 'object' ? venture : {};
  const ctx = s.context && typeof s.context === 'object' ? s.context : {};

  const rawName = String(u.displayName || u.fullName || u.name || '').trim();
  const firstName = rawName
    ? rawName.split(/\s+/)[0].replace(/[^A-Za-z0-9'-]/g, '').slice(0, 24)
    : '';

  const firstProject = Array.isArray(u.projects) && u.projects[0] && typeof u.projects[0] === 'object'
    ? u.projects[0]
    : null;
  const repoShort = v.githubRepo
    ? String(v.githubRepo).trim().split('/').filter(Boolean).pop() || String(v.githubRepo).trim()
    : '';

  const projectLabel = cleanSnippet(
    ctx.project
      || firstProject?.title
      || firstProject?.name
      || u.startupName
      || u.company
      || repoShort,
    56,
  );

  const openPlanTitle = Array.isArray(s.plan)
    ? cleanSnippet(s.plan.find((p) => p && !p.done && String(p.title || '').trim())?.title || '', 72)
    : '';
  const openFollowupTitle = Array.isArray(s.followups)
    ? cleanSnippet(s.followups.find((f) => f && f.status !== 'done' && String(f.title || '').trim())?.title || '', 72)
    : '';
  const userGoalField = Array.isArray(u.goals) ? joinHumanList(u.goals, 2) : (u.goal || u.goals || '');

  const goalLabel = cleanSnippet(
    ctx.goal
      || userGoalField
      || firstProject?.goal
      || openPlanTitle
      || openFollowupTitle
      || firstProject?.description
      || extractGoalFromBio(u.bio),
    80,
  );

  const openStep = openPlanTitle && openPlanTitle.toLowerCase() !== goalLabel.toLowerCase()
    ? openPlanTitle
    : (openFollowupTitle && openFollowupTitle.toLowerCase() !== goalLabel.toLowerCase() ? openFollowupTitle : '');

  const lookingFromProfile = Array.isArray(u.lookingFor)
    ? joinHumanList(u.lookingFor, 3)
    : cleanSnippet(u.lookingFor || '', 72);
  const seekingFallback = Array.isArray(u.collaborationInterests)
    ? joinHumanList(u.collaborationInterests, 3)
    : cleanSnippet(u.collaborationInterests || u.seeking || '', 72);
  const missingVentureRoles = Array.isArray(v?.codeDiagnosis?.missingRoles)
    ? joinHumanList(v.codeDiagnosis.missingRoles, 2)
    : '';
  const intentFallback = ctx.intent === 'cofounder'
    ? 'a Startup Co-Founder'
    : ctx.intent === 'hire'
      ? 'Founding Team Collaborators'
      : '';

  const lookingForLabel = cleanSnippet(
    lookingFromProfile
      || cleanSnippet(ctx.needs || '', 72)
      || seekingFallback
      || missingVentureRoles
      || intentFallback,
    76,
  );

  const roleLabel = cleanSnippet(u.occupation || u.headline || u.role || '', 48);
  const skillsLabel = Array.isArray(u.skills) ? joinHumanList(u.skills, 3) : cleanSnippet(u.skills || '', 48);
  const cityLabel = cleanSnippet(u.city || u.location || '', 36);

  const hasPersonalSignals = Boolean(
    projectLabel || goalLabel || lookingForLabel || openStep || roleLabel || skillsLabel,
  );

  return {
    firstName,
    projectLabel,
    goalLabel,
    lookingForLabel,
    openStep,
    roleLabel,
    skillsLabel,
    cityLabel,
    hasPersonalSignals,
  };
}

export async function loadPersonalBuilderBrief(db, uid, { email = '' } = {}) {
  if (!db) return buildPersonalBuilderBrief();
  let resolvedUid = uid && uid !== 'linky-test' ? String(uid) : '';
  let userDoc = null;

  if (resolvedUid) {
    const uSnap = await db.collection('users').doc(resolvedUid).get().catch(() => null);
    if (uSnap?.exists) userDoc = uSnap.data() || {};
  }
  if (!userDoc && email && typeof db.collection === 'function') {
    try {
      const usersCol = db.collection('users');
      if (typeof usersCol.where === 'function') {
        const qSnap = await usersCol.where('email', '==', String(email).trim()).limit(1).get();
        const matchDoc = qSnap?.docs?.[0];
        if (matchDoc?.exists) {
          resolvedUid = matchDoc.id;
          userDoc = matchDoc.data() || {};
        }
      }
    } catch {}
  }
  if (!resolvedUid && !userDoc) return buildPersonalBuilderBrief();

  const [stateSnap, ventureSnap] = resolvedUid
    ? await Promise.all([
        db.collection('builderStates').doc(resolvedUid).get().catch(() => null),
        db.collection('ventureProfiles').doc(resolvedUid).get().catch(() => null),
      ])
    : [null, null];

  return buildPersonalBuilderBrief({
    user: userDoc || {},
    state: stateSnap?.exists ? stateSnap.data() || {} : {},
    venture: ventureSnap?.exists ? ventureSnap.data() || {} : {},
  });
}

export function resolveEmailMood({ mood = '', receiptKey = '', subject = '', headline = '', badgeLabel = '', daysSinceActive = null } = {}) {
  if (mood && EMAIL_MOODS[mood]) return EMAIL_MOODS[mood];
  const days = Number(daysSinceActive);
  if (Number.isFinite(days) && daysSinceActive !== null && daysSinceActive !== '') {
    if (days >= 7) return EMAIL_MOODS.ghost_abandoned;
    if (days >= 3) return EMAIL_MOODS.sad_inactive;
    if (days >= 1) return EMAIL_MOODS.angry_1d;
  }
  const hay = `${receiptKey} ${subject} ${headline} ${badgeLabel}`.toLowerCase();
  if (/league|champion|crown|podium|won/.test(hay)) return EMAIL_MOODS.champion_crown;
  if (/milestone|day 7|day 14|day 30|day 50|day 100|celebrat/.test(hay)) return EMAIL_MOODS.milestone_party;
  if (/streak|on the line|before midnight|tonight/.test(hay)) return EMAIL_MOODS.streak_fire;
  if (/match|intro|message|unread|waiting|request|reply/.test(hay)) return EMAIL_MOODS.unread_urgent;
  if (/cobweb|day14|day30/.test(hay)) return EMAIL_MOODS.ghost_abandoned;
  if (/comeback|seat is warm|miss|away|day3|day7/.test(hay)) return EMAIL_MOODS.sad_inactive;
  if (/yesterday|skipped|1 day/.test(hay)) return EMAIL_MOODS.angry_1d;
  if (/shipped|weekly|numbers|locked in|momentum/.test(hay)) return EMAIL_MOODS.on_fire_shipped;
  if (/weekend|sunday|saturday|coffee|rest/.test(hay)) return EMAIL_MOODS.weekend_chill;
  if (/night|late|owl/.test(hay)) return EMAIL_MOODS.night_owl;
  return EMAIL_MOODS.default;
}

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
    from: String(env?.EMAIL_FROM || 'Linky at LINKUP <notifications@linkupbuild.com>').trim(),
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

export function buildLinkyEmailBodies({
  uid,
  headline,
  body,
  ctaLabel,
  fullUrl,
  badgeLabel,
  mood,
  receiptKey = '',
  subject = '',
  daysSinceActive = null,
  personal = null,
}) {
  const cleanHeadline = sanitizeEmailCopy(headline);
  const cleanBody = sanitizeEmailCopy(body);
  const cleanCta = sanitizeEmailCopy(ctaLabel || 'Open LINKUP');
  const cleanBadge = sanitizeEmailCopy(badgeLabel || 'From Linky on LINKUP');
  const moodSpec = resolveEmailMood({
    mood,
    receiptKey,
    subject,
    headline: cleanHeadline,
    badgeLabel: cleanBadge,
    daysSinceActive,
  });
  const unsubUrl = unsubscribeEmailUrl(uid || 'member');
  const avatarUrl = `${LINKY_AVATAR_URL}?v=2`;
  const heroUrl = `${APP_BASE}/icons/${moodSpec.heroFile}?v=2`;

  const p = personal && typeof personal === 'object' ? personal : null;
  const personalRows = [];
  if (p) {
    if (p.projectLabel) {
      personalRows.push(['Building', p.projectLabel]);
    } else if (p.roleLabel) {
      personalRows.push([
        'Your Lane',
        p.skillsLabel ? `${p.roleLabel} (${p.skillsLabel})` : p.roleLabel,
      ]);
    }
    if (p.goalLabel) personalRows.push(['Your Goal', p.goalLabel]);
    if (p.openStep) personalRows.push(['Next Step', p.openStep]);
    if (p.lookingForLabel) personalRows.push(['Looking For', p.lookingForLabel]);
  }

  const headerSubline = p?.firstName
    ? `Tailored check-in for ${sanitizeEmailCopy(p.firstName)}${p.cityLabel ? ` · ${sanitizeEmailCopy(p.cityLabel)}` : ''}`
    : (personalRows.length > 0 ? 'Tailored to your goals & co-founder search' : 'Builder network & daily momentum');

  const personalTextBlock = personalRows.length > 0
    ? `\n\n--- Tailored to ${p?.firstName ? `${sanitizeEmailCopy(p.firstName)}'s` : 'Your'} Focus ---\n${personalRows.map(([k, v]) => `• ${k}: ${sanitizeEmailCopy(v)}`).join('\n')}`
    : '';

  const personalHtmlBlock = personalRows.length > 0
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FCFBF3;border:1px solid #E7E1BF;border-radius:14px;margin:0 0 20px 0;">
          <tr>
            <td style="padding:13px 15px;">
              <div style="font-size:11px;font-weight:900;letter-spacing:0.7px;text-transform:uppercase;color:#6E5B00;margin:0 0 8px 0;">
                Tailored to ${p?.firstName ? `${esc(sanitizeEmailCopy(p.firstName))}&rsquo;s` : 'Your'} Goals &amp; Search
              </div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${personalRows.map(([label, val], idx) => `<tr>
                  <td valign="top" width="96" style="font-size:12px;font-weight:800;color:#575B60;padding:${idx === 0 ? '0' : '6px'} 8px 0 0;white-space:nowrap;">${esc(label)}:</td>
                  <td valign="top" style="font-size:13px;line-height:1.45;font-weight:700;color:#0A0B0D;padding:${idx === 0 ? '0' : '6px'} 0 0 0;">${esc(sanitizeEmailCopy(val))}</td>
                </tr>`).join('')}
              </table>
            </td>
          </tr>
        </table>`
    : '';

  const textBody = `${cleanHeadline}\n[${moodSpec.pillText}]\n\n${cleanBody}${personalTextBlock}\n\n${cleanCta}: ${fullUrl}\n\n— Linky, your LINKUP builder companion\n\n---\nUnsubscribe from LINKUP emails: ${unsubUrl}`;

  const htmlBody = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:16px 10px;background:#F6F5EF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0B0D;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E2D6;border-radius:22px;overflow:hidden;">
    <tr>
      <td style="padding:18px 20px 14px 20px;border-bottom:1px solid #F0EEE6;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="52" valign="middle" style="padding-right:12px;">
              <img src="${esc(avatarUrl)}" alt="LINKUP" width="48" height="48" style="display:block;width:48px;height:48px;border-radius:50%;border:2px solid #0A0B0D;background:#FBE618;"/>
            </td>
            <td valign="middle">
              <div style="font-weight:900;font-size:16px;line-height:1.2;color:#0A0B0D;">
                Linky <span style="display:inline-block;background:#FBE618;color:#0A0B0D;font-weight:900;font-size:11px;letter-spacing:0.6px;padding:2px 7px;border-radius:6px;margin-left:4px;vertical-align:middle;">LINKUP</span>
              </div>
              <div style="font-size:12px;color:#5E636B;margin-top:3px;">${esc(headerSubline)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:18px 20px 0 20px;">
        <div style="margin-bottom:12px;">
          <span style="display:inline-block;background:${esc(moodSpec.pillBg)};color:${esc(moodSpec.pillColor)};font-weight:800;font-size:12px;padding:5px 11px;border-radius:999px;">
            ${esc(moodSpec.pillText)}
          </span>
        </div>
        <img src="${esc(heroUrl)}" alt="${esc(moodSpec.alt)}" width="480" style="display:block;width:100%;max-width:480px;height:auto;border-radius:18px;border:1px solid #ECE9DD;margin:0 auto;"/>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 22px 24px 22px;">
        <h2 style="font-size:21px;line-height:1.32;font-weight:900;color:#0A0B0D;margin:0 0 12px 0;">${esc(cleanHeadline)}</h2>
        <p style="font-size:15px;line-height:1.62;color:#353940;margin:0 0 20px 0;">${esc(cleanBody)}</p>
        ${personalHtmlBlock}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center" bgcolor="#FBE618" style="border-radius:14px;">
              <a href="${esc(fullUrl)}" style="display:inline-block;background:#FBE618;color:#0A0B0D;font-weight:900;font-size:15px;text-decoration:none;padding:13px 22px;border-radius:14px;border:2px solid #0A0B0D;">
                ${esc(cleanCta)} &rarr;
              </a>
            </td>
          </tr>
        </table>
        <hr style="border:none;border-top:1px solid #ECEAE2;margin:24px 0 14px 0;"/>
        <p style="font-size:12px;line-height:1.5;color:#767A82;margin:0;">
          ${esc(cleanBadge)} &middot; <a href="${esc(unsubUrl)}" style="color:#575B60;text-decoration:underline;">Unsubscribe in one click</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return { unsubUrl, textBody, htmlBody, mood: moodSpec.id, heroUrl, avatarUrl };
}

function recipientLockId(to) {
  return crypto.createHash('sha256').update(`recipient:${String(to || '').trim().toLowerCase()}`).digest('hex').slice(0, 40);
}

async function checkRecipientSpacing(db, uid, to, effectiveSendAt, minGapMs = MIN_USER_EMAIL_GAP_MS) {
  if (!db) return { allowed: true };
  const userPrefRef = uid ? db.collection('emailPrefs').doc(uid) : null;
  const addrLockRef = to ? db.collection('emailRecipientLocks').doc(recipientLockId(to)) : null;

  const [uSnap, aSnap] = await Promise.all([
    userPrefRef ? userPrefRef.get().catch(() => null) : Promise.resolve(null),
    addrLockRef ? addrLockRef.get().catch(() => null) : Promise.resolve(null),
  ]);
  const uData = uSnap?.exists ? uSnap.data() || {} : {};
  const aData = aSnap?.exists ? aSnap.data() || {} : {};

  // Hard 1-email-per-day cap per user AND per email address
  const sendDay = new Date(effectiveSendAt).toISOString().slice(0, 10);
  if (minGapMs > 0 && (uData.lastEmailDay === sendDay || aData.lastEmailDay === sendDay)) {
    const lastAt = Math.max(Number(uData.lastEmailAt || 0), Number(aData.lastEmailAt || 0));
    return { allowed: false, reason: 'daily_user_email_limit', lastEmailAt: lastAt };
  }

  if (minGapMs > 0) {
    const lastAt = Math.max(Number(uData.lastEmailAt || 0), Number(aData.lastEmailAt || 0));
    if (lastAt > 0 && effectiveSendAt - lastAt < minGapMs) {
      return { allowed: false, reason: 'too_close_to_recent_email', lastEmailAt: lastAt };
    }
  }
  return { allowed: true, userPrefRef, addrLockRef };
}

async function stampRecipientSpacing(db, uid, to, effectiveSendAt, subject = '') {
  if (!db) return;
  const cleanSubj = sanitizeEmailCopy(subject).slice(0, 120);
  const sendDay = new Date(effectiveSendAt).toISOString().slice(0, 10);
  const writes = [];
  if (uid) {
    writes.push(
      db.collection('emailPrefs').doc(uid).set(
        { lastEmailAt: effectiveSendAt, lastEmailDay: sendDay, lastEmailSubject: cleanSubj, updatedAt: Date.now() },
        { merge: true },
      ).catch(() => null),
    );
  }
  if (to) {
    writes.push(
      db.collection('emailRecipientLocks').doc(recipientLockId(to)).set(
        { lastEmailAt: effectiveSendAt, lastEmailDay: sendDay, uid: uid || '', updatedAt: Date.now() },
        { merge: true },
      ).catch(() => null),
    );
  }
  await Promise.all(writes);
}

async function postResendEmail({
  fetcher,
  apiKey,
  from,
  allowOnboardingFallback,
  to,
  subject,
  textBody,
  htmlBody,
  unsubUrl,
  scheduledAt = '',
}) {
  const cleanSubject = sanitizeEmailCopy(subject).slice(0, 120);
  const sendOnce = async (sender, scheduleIso = '') => {
    const payloadObj = {
      from: sender,
      to: [to],
      subject: cleanSubject,
      text: textBody,
      html: htmlBody,
      ...(scheduleIso ? { scheduled_at: scheduleIso } : {}),
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };
    const res = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payloadObj),
      signal: AbortSignal.timeout(8000),
    });
    let payload = null;
    try {
      payload = typeof res.json === 'function' ? await res.json() : null;
    } catch {}
    return { res, payload, sender, scheduledAtUsed: scheduleIso || null };
  };

  let attempt = await sendOnce(from, scheduledAt);
  // If provider rejects scheduled_at syntax/window for any reason, send immediately rather than dropping
  if (!attempt.res.ok && scheduledAt && attempt.res.status >= 400 && attempt.res.status < 500 && attempt.res.status !== 403) {
    attempt = await sendOnce(from, '');
  }
  if (
    !attempt.res.ok &&
    attempt.res.status === 403 &&
    allowOnboardingFallback &&
    from !== RESEND_FALLBACK_FROM
  ) {
    attempt = await sendOnce(RESEND_FALLBACK_FROM, scheduledAt);
    if (!attempt.res.ok && scheduledAt) {
      attempt = await sendOnce(RESEND_FALLBACK_FROM, '');
    }
  }

  if (!attempt.res.ok) {
    return {
      sent: false,
      reason: `http_${attempt.res.status}`,
      detail: String(attempt.payload?.message || attempt.payload?.name || '').slice(0, 240),
      fromTried: attempt.sender,
    };
  }
  return {
    sent: true,
    id: attempt.payload?.id || null,
    fromUsed: attempt.sender,
    scheduledAt: attempt.scheduledAtUsed,
  };
}

export async function sendHighSignalEmail(db, uid, {
  receiptKey = '',
  throttleMs = SOCIAL_THROTTLE_MS,
  minUserGapMs = MIN_USER_EMAIL_GAP_MS,
  scheduledAt = '',
  subject = 'LINKUP update',
  headline = 'You have an update on LINKUP',
  body = '',
  ctaLabel = 'Open LINKUP',
  ctaUrl = '/alerts',
  badgeLabel = 'LINKUP builder alert',
  mood = '',
  daysSinceActive = null,
  quotaBucket = 'transactional',
  quotaCap = DAILY_EMAIL_HARD_CAP,
  personal = null,
} = {}, { fetcher = fetch, env = process.env, now = Date.now() } = {}) {
  const status = emailStatus(env);
  if (!status.available || !db || !uid) return { sent: false, reason: status.reason || 'disabled' };

  const prefSnap = await db.collection('emailPrefs').doc(uid).get().catch(() => null);
  if (prefSnap?.exists && prefSnap.data()?.unsubscribed === true) return { sent: false, reason: 'unsubscribed' };

  const nowMs = typeof now === 'function' ? now() : Number(now) || Date.now();
  const parsedSchedMs = scheduledAt ? Date.parse(String(scheduledAt)) : NaN;
  const effectiveSendAt = Number.isFinite(parsedSchedMs) && parsedSchedMs > nowMs ? parsedSchedMs : nowMs;
  const scheduleIso = effectiveSendAt > nowMs ? new Date(effectiveSendAt).toISOString() : '';

  const rKey = receiptKey || `social_${uid}`;
  const receiptRef = db.collection('emailReceipts').doc(rKey.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120));
  const prev = await receiptRef.get().catch(() => null);
  if (prev?.exists) {
    if (throttleMs <= 0) return { sent: false, reason: 'duplicate' };
    if (nowMs - Number(prev.data()?.at || 0) < throttleMs) return { sent: false, reason: 'throttled' };
  }

  const to = await resolveRecipientEmail(db, uid);
  if (!to) return { sent: false, reason: 'no_email' };

  // Global per-user + per-email-address anti-collision lock: never send 2 emails at the same time
  const spacing = await checkRecipientSpacing(db, uid, to, effectiveSendAt, minUserGapMs);
  if (!spacing.allowed) {
    return { sent: false, reason: spacing.reason, lastEmailAt: spacing.lastEmailAt };
  }

  const quota = await reserveDailyEmailQuota(db, quotaBucket, quotaCap, nowMs);
  if (!quota.allowed) return { sent: false, reason: quota.reason || 'daily_quota_reached' };

  const resolvedPersonal = personal && typeof personal === 'object'
    ? personal
    : await loadPersonalBuilderBrief(db, uid, { email: to });

  let finalBody = body;
  if (!finalBody && resolvedPersonal?.hasPersonalSignals) {
    const parts = [];
    if (resolvedPersonal.goalLabel) parts.push(`Your goal on LINKUP is "${resolvedPersonal.goalLabel}".`);
    if (resolvedPersonal.lookingForLabel) parts.push(`Builders matching what you're looking for (${resolvedPersonal.lookingForLabel}) are active right now.`);
    finalBody = parts.join(' ');
  }

  const fullUrl = ctaUrl.startsWith('http') ? ctaUrl : `${APP_BASE}${ctaUrl.startsWith('/') ? ctaUrl : '/' + ctaUrl}`;
  const { unsubUrl, textBody, htmlBody, mood: resolvedMood } = buildLinkyEmailBodies({
    uid,
    headline,
    body: finalBody,
    ctaLabel,
    fullUrl,
    badgeLabel,
    mood,
    receiptKey: rKey,
    subject,
    daysSinceActive,
    personal: resolvedPersonal,
  });

  try {
    const out = await postResendEmail({
      fetcher,
      apiKey: String(env.RESEND_API_KEY).trim(),
      from: status.from,
      allowOnboardingFallback: !String(env?.EMAIL_FROM || '').trim(),
      to,
      subject,
      textBody,
      htmlBody,
      unsubUrl,
      scheduledAt: scheduleIso,
    });
    if (!out.sent) return out;
    const stampedAt = out.scheduledAt ? effectiveSendAt : nowMs;
    await Promise.all([
      receiptRef.set({
        uid,
        at: stampedAt,
        bucket: quotaBucket,
        mood: resolvedMood,
        scheduledAt: out.scheduledAt || null,
        subject: sanitizeEmailCopy(subject).slice(0, 120),
      }).catch(() => null),
      stampRecipientSpacing(db, uid, to, stampedAt, subject),
    ]);
    return {
      sent: true,
      id: out.id,
      fromUsed: out.fromUsed,
      bucket: quotaBucket,
      mood: resolvedMood,
      scheduledAt: out.scheduledAt || null,
    };
  } catch {
    return { sent: false, reason: 'network_error' };
  }
}

export async function sendRetentionPulseEmail(db, uid, {
  localDateKey = '',
  slot = 'pulse1',
  mood = 'default',
  scheduledAt = '',
  subject = 'LINKUP · Quick builder check-in from Linky',
  headline = 'Plug in for two minutes today',
  body = 'Fresh builders and collaborators are active on LINKUP right now.',
  ctaLabel = 'Open LINKUP',
  ctaUrl = '/ship?pulse=email',
  daysSinceActive = 0,
  personal = null,
} = {}, options = {}) {
  const days = Number(daysSinceActive);
  if (Number.isFinite(days) && days > COMEBACK_SUNSET_DAYS) {
    return { sent: false, reason: 'sunset_inactive' };
  }
  const dayTag = String(localDateKey || new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, '');
  const slotTag = String(slot || 'pulse1').replace(/[^A-Za-z0-9_-]/g, '');
  return sendHighSignalEmail(db, uid, {
    receiptKey: `pulse_${uid}_${dayTag}_${slotTag}`,
    throttleMs: 0,
    minUserGapMs: MIN_USER_EMAIL_GAP_MS,
    scheduledAt,
    subject,
    headline,
    body,
    ctaLabel,
    ctaUrl,
    mood,
    daysSinceActive,
    personal,
    badgeLabel: 'Daily check-in from Linky on LINKUP',
    quotaBucket: 'daily_pulse',
    quotaCap: DAILY_PULSE_EMAIL_CAP,
  }, options);
}

const DEFAULT_COMEBACK_HEADLINE = 'Your LinkUp seat is warm';
const DEFAULT_COMEBACK_BODY = 'Builders in your lane posted new progress while you were away. Jump back in when you have two minutes.';

export async function sendComebackEmail(db, uid, rawInput = {}, options = {}) {
  const {
    daysSinceActive = 0,
    lastActiveAt = 0,
    headline = DEFAULT_COMEBACK_HEADLINE,
    body = DEFAULT_COMEBACK_BODY,
    ctaLabel = 'Plug back into LINKUP',
    ctaUrl = '/ship?comeback=email',
    mood = '',
    prefs = {},
    personal = null,
  } = rawInput || {};
  if (prefs && prefs.welcomeBack === false) return { sent: false, reason: 'welcome_back_opted_out' };
  const milestone = comebackEmailMilestone(daysSinceActive);
  if (!milestone) return { sent: false, reason: 'not_due' };
  if (milestone === 'sunset') return { sent: false, reason: 'sunset_inactive' };

  const resolvedPersonal = personal && typeof personal === 'object'
    ? personal
    : await loadPersonalBuilderBrief(db, uid);

  const callerPassedHeadline = rawInput && Object.prototype.hasOwnProperty.call(rawInput, 'headline');
  const callerPassedBody = rawInput && Object.prototype.hasOwnProperty.call(rawInput, 'body');

  let finalHeadline = headline;
  let finalBody = body;
  let finalCta = ctaLabel;
  let finalUrl = ctaUrl;

  if (resolvedPersonal?.hasPersonalSignals) {
    const greet = resolvedPersonal.firstName ? `${resolvedPersonal.firstName}, ` : '';
    if (!callerPassedHeadline) {
      if (resolvedPersonal.projectLabel && resolvedPersonal.goalLabel) {
        finalHeadline = `${greet}${resolvedPersonal.projectLabel} & "${cleanSnippet(resolvedPersonal.goalLabel, 44)}" are waiting on you`;
      } else if (resolvedPersonal.goalLabel) {
        finalHeadline = `${greet}ready to move "${cleanSnippet(resolvedPersonal.goalLabel, 50)}" forward?`;
      } else if (resolvedPersonal.lookingForLabel) {
        finalHeadline = `${greet}vetted ${cleanSnippet(resolvedPersonal.lookingForLabel, 46)} matches are active`;
      }
    }
    if (!callerPassedBody || body === DEFAULT_COMEBACK_BODY) {
      const sentences = [];
      if (resolvedPersonal.projectLabel && resolvedPersonal.goalLabel) {
        sentences.push(`You set out to push ${resolvedPersonal.projectLabel} toward "${resolvedPersonal.goalLabel}" — don't let a quiet stretch stall that momentum.`);
      } else if (resolvedPersonal.goalLabel) {
        sentences.push(`Your personalized goal on LINKUP ("${resolvedPersonal.goalLabel}") is still waiting for your next move.`);
      } else if (resolvedPersonal.projectLabel) {
        sentences.push(`${resolvedPersonal.projectLabel} builds fastest when you don't carry every week in isolation.`);
      }
      if (resolvedPersonal.lookingForLabel) {
        sentences.push(`Builders matching what you're looking for (${resolvedPersonal.lookingForLabel}) shipped updates while you were away — jump in for two minutes to review matches or log one step.`);
        if (ctaLabel === 'Plug back into LINKUP') {
          finalCta = `See ${cleanSnippet(resolvedPersonal.lookingForLabel, 30)} matches`;
          finalUrl = '/linky?comeback=email';
        }
      } else {
        sentences.push('Drop a quick 60-second update so Linky and compatible co-founders know what you need next.');
      }
      if (sentences.length > 0) finalBody = sentences.join(' ');
    }
  }

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
    subject: `${subjectPrefix}${finalHeadline}`.slice(0, 120),
    headline: finalHeadline,
    body: `${finalBody}${finalFooter}`,
    ctaLabel: finalCta,
    ctaUrl: finalUrl,
    mood,
    daysSinceActive,
    personal: resolvedPersonal,
    badgeLabel: 'Linky welcome-back invitation',
    quotaBucket: 'comeback',
    quotaCap: DAILY_COMEBACK_EMAIL_CAP,
  }, options);
}

const DEFAULT_DIRECT_SUBJECT = 'LINKUP · Linky is plugged in and waiting for you ⚡';
const DEFAULT_DIRECT_HEADLINE = 'Hey builder — Linky is plugged in with a fresh look!';
const DEFAULT_DIRECT_BODY = 'Builders in your lane are posting progress, opening warm intros, and climbing the Builder League right now. Plug in for two minutes and put today’s move on the board.';

export async function sendLinkyDirectEmail(db, rawInput = {}, { fetcher = fetch, env = process.env } = {}) {
  const {
    to = '',
    uid = 'linky-test',
    mood = 'default',
    subject = DEFAULT_DIRECT_SUBJECT,
    headline = DEFAULT_DIRECT_HEADLINE,
    body = DEFAULT_DIRECT_BODY,
    ctaLabel = 'Open LINKUP',
    ctaUrl = '/ship',
    personal = null,
  } = rawInput || {};
  const status = emailStatus(env);
  const cleanTo = String(to || '').trim();
  if (!status.available) return { sent: false, reason: status.reason || 'disabled' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanTo)) return { sent: false, reason: 'invalid_email' };

  const resolvedPersonal = personal && typeof personal === 'object'
    ? personal
    : await loadPersonalBuilderBrief(db, uid, { email: cleanTo });

  const callerPassedHeadline = rawInput && Object.prototype.hasOwnProperty.call(rawInput, 'headline');
  const callerPassedSubject = rawInput && Object.prototype.hasOwnProperty.call(rawInput, 'subject');
  const callerPassedBody = rawInput && Object.prototype.hasOwnProperty.call(rawInput, 'body');

  let finalSubject = subject;
  let finalHeadline = headline;
  let finalBody = body;

  if (resolvedPersonal?.hasPersonalSignals) {
    const greet = resolvedPersonal.firstName ? `Hey ${resolvedPersonal.firstName}` : 'Hey builder';
    if (!callerPassedHeadline && headline === DEFAULT_DIRECT_HEADLINE) {
      if (resolvedPersonal.goalLabel) {
        finalHeadline = `${greet} — let’s move "${cleanSnippet(resolvedPersonal.goalLabel, 50)}" forward today`;
      } else if (resolvedPersonal.lookingForLabel) {
        finalHeadline = `${greet} — vetted ${cleanSnippet(resolvedPersonal.lookingForLabel, 44)} matches are active`;
      }
    }
    if (!callerPassedSubject && subject === DEFAULT_DIRECT_SUBJECT) {
      finalSubject = `LINKUP · ${finalHeadline}`.slice(0, 118);
    }
    if (!callerPassedBody && body === DEFAULT_DIRECT_BODY) {
      const parts = [];
      if (resolvedPersonal.projectLabel && resolvedPersonal.goalLabel) {
        parts.push(`You’re building ${resolvedPersonal.projectLabel} with the goal "${resolvedPersonal.goalLabel}".`);
      } else if (resolvedPersonal.goalLabel) {
        parts.push(`Your current goal on LINKUP is "${resolvedPersonal.goalLabel}".`);
      }
      if (resolvedPersonal.lookingForLabel) {
        parts.push(`You’re also looking for ${resolvedPersonal.lookingForLabel} — don’t build alone when compatible co-founders and collaborators are active right now.`);
      } else {
        parts.push('Log one concrete move today so Linky can keep sharpening your co-founder & builder matches.');
      }
      finalBody = parts.join(' ');
    }
  }

  const fullUrl = ctaUrl.startsWith('http') ? ctaUrl : `${APP_BASE}${ctaUrl.startsWith('/') ? ctaUrl : '/' + ctaUrl}`;
  const { unsubUrl, textBody, htmlBody, mood: resolvedMood } = buildLinkyEmailBodies({
    uid,
    headline: finalHeadline,
    body: finalBody,
    ctaLabel,
    fullUrl,
    mood,
    subject: finalSubject,
    personal: resolvedPersonal,
    badgeLabel: 'From Linky on LINKUP',
  });

  try {
    const out = await postResendEmail({
      fetcher,
      apiKey: String(env.RESEND_API_KEY).trim(),
      from: status.from,
      allowOnboardingFallback: true,
      to: cleanTo,
      subject: finalSubject,
      textBody,
      htmlBody,
      unsubUrl,
    });
    return out.sent ? { ...out, mood: resolvedMood } : out;
  } catch (err) {
    return { sent: false, reason: 'network_error', detail: String(err?.message || '') };
  }
}
