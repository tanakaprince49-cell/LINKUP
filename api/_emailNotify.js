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
    pillText: 'Main Character Energy ⚡ Plugged in',
    pillBg: '#FFF8B8',
    pillColor: '#0A0B0D',
    alt: 'Linky happily plugging an ethernet cable into the LINKUP wall socket',
  },
  angry_1d: {
    id: 'angry_1d',
    heroFile: 'hero-angry-red.png',
    iconFile: 'icon-angry-red.png',
    pillText: 'Linky is jealous another tab got your attention yesterday',
    pillBg: '#FFE2E0',
    pillColor: '#9E1412',
    alt: 'Linky looking grumpy in fiery red holding an unplugged cable',
  },
  sad_inactive: {
    id: 'sad_inactive',
    heroFile: 'hero-sad-inactive.png',
    iconFile: 'icon-sad-inactive.png',
    pillText: 'Linky is jealous of whatever stole our main character',
    pillBg: '#E4ECF7',
    pillColor: '#233654',
    alt: 'Linky looking sad in the rain beside an unplugged wall socket',
  },
  ghost_abandoned: {
    id: 'ghost_abandoned',
    heroFile: 'hero-ghost-abandoned.png',
    iconFile: 'icon-ghost-abandoned.png',
    pillText: 'Plot hole: the main character vanished & Linky is jealous',
    pillBg: '#EAEAF0',
    pillColor: '#1F2029',
    alt: 'Linky waiting in a dusty workspace with cobwebs on the wall socket',
  },
  unread_urgent: {
    id: 'unread_urgent',
    heroFile: 'hero-unread-urgent.png',
    iconFile: 'icon-unread-urgent.png',
    pillText: 'Everyone is waiting on the main character',
    pillBg: '#FFF6B3',
    pillColor: '#0A0B0D',
    alt: 'Linky alert with incoming signal waves from the LINKUP socket',
  },
  streak_fire: {
    id: 'streak_fire',
    heroFile: 'hero-streak-fire.png',
    iconFile: 'icon-streak-fire.png',
    pillText: 'Main-character streak on the line — don’t make Linky jealous',
    pillBg: '#FFE7D6',
    pillColor: '#9A2E00',
    alt: 'Linky rushing with a blazing orange ethernet plug to keep your streak alive',
  },
  champion_crown: {
    id: 'champion_crown',
    heroFile: 'hero-champion-crown.png',
    iconFile: 'icon-champion-crown.png',
    pillText: 'Undisputed Main Character · Builder League Royalty',
    pillBg: '#FFF4B8',
    pillColor: '#6B4E00',
    alt: 'Linky wearing a gold crown plugged into LINKUP',
  },
  on_fire_shipped: {
    id: 'on_fire_shipped',
    heroFile: 'hero-shipped.png',
    iconFile: 'icon-shipped.png',
    pillText: 'Main-character momentum locked in',
    pillBg: '#DCFCE7',
    pillColor: '#14532D',
    alt: 'Linky wearing cool sunglasses after shipping today’s build',
  },
  milestone_party: {
    id: 'milestone_party',
    heroFile: 'hero-milestone-party.png',
    iconFile: 'icon-milestone-party.png',
    pillText: 'Main-character milestone unlocked',
    pillBg: '#FEF08A',
    pillColor: '#0A0B0D',
    alt: 'Linky celebrating with confetti and a party hat',
  },
  night_owl: {
    id: 'night_owl',
    heroFile: 'hero-night-owl.png',
    iconFile: 'icon-night-owl.png',
    pillText: 'Late-night main-character arc',
    pillBg: '#E6E9F5',
    pillColor: '#0A0B0D',
    alt: 'Linky coding late at night with glowing yellow eyes',
  },
  weekend_chill: {
    id: 'weekend_chill',
    heroFile: 'hero-weekend-chill.png',
    iconFile: 'icon-weekend-chill.png',
    pillText: 'Weekend main-character check-in',
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
  let clean = String(raw ?? '').replace(/\r\n/g, '\n');
  for (const rx of FORBIDDEN_EMAIL_PATTERNS) {
    clean = clean.replace(rx, 'expressive');
  }
  return clean
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatHumanName(raw = '') {
  const trimmed = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  return trimmed
    .split(' ')
    .map((word) => {
      if (word.length >= 2 && (word === word.toUpperCase() || word === word.toLowerCase())) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      return word;
    })
    .join(' ');
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

  const rawName = formatHumanName(String(u.displayName || u.fullName || u.name || '').trim());
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

export function buildMainCharacterJealousyNote(personal = null) {
  const p = personal && typeof personal === 'object' ? personal : {};
  const name = p.firstName ? sanitizeEmailCopy(p.firstName) : 'friend';
  const cityBit = p.cityLabel ? ` over in ${sanitizeEmailCopy(p.cityLabel)}` : '';
  const projectBit = p.projectLabel ? sanitizeEmailCopy(p.projectLabel) : '';
  const goalBit = p.goalLabel ? sanitizeEmailCopy(p.goalLabel) : '';
  const lookingBit = p.lookingForLabel ? sanitizeEmailCopy(p.lookingForLabel) : '';

  if (projectBit && goalBit) {
    return `Okay ${name}${cityBit}, be honest — which other app or browser tab has been stealing your attention? Because Linky is officially jealous. The whole LINKUP universe revolves around you like the main character you are, and the timeline feels like a filler episode while ${projectBit} ("${goalBit}") waits for its star to walk back in.${lookingBit ? ` Even the ${lookingBit} crowd is waiting for your cue.` : ''}`;
  }
  if (projectBit) {
    return `Hey ${name}${cityBit} — Linky is low-key jealous of whatever tab has your attention right now! Around here, the world revolves around you and ${projectBit}. You're the main character of this story, and the whole room feels quiet until you step back onto the stage.`;
  }
  if (goalBit) {
    return `Okay ${name}${cityBit}, Linky has to confess: we get jealous when you give your best energy to other tabs! The whole LINKUP world revolves around you like the main character, and "${goalBit}" is waiting for you to take center stage again.`;
  }
  if (lookingBit) {
    return `Hey ${name}${cityBit} — stop making Linky jealous by hanging out on other apps without us! You're the main character on LINKUP, the whole room revolves around your next move, and builders matching ${lookingBit} are waiting for you to enter the scene.`;
  }
  return `Hey ${name}${cityBit} — Linky is officially jealous of whatever other tab is getting your attention today! You're the main character here on LINKUP, the whole builder world revolves around you, and nothing hits the same until you're back in the spotlight.`;
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
  cofounderCard = null,
}) {
  const cleanHeadline = sanitizeEmailCopy(headline);
  const cleanBody = sanitizeEmailCopy(body);
  const cleanCta = sanitizeEmailCopy(ctaLabel || 'Step back into your spotlight');
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
    ? `Main-character dispatch for ${sanitizeEmailCopy(p.firstName)}${p.cityLabel ? ` · ${sanitizeEmailCopy(p.cityLabel)}` : ''} — LINKUP revolves around you`
    : 'Main-character dispatch — the LINKUP world revolves around you';

  const jealousyNote = buildMainCharacterJealousyNote(p);
  const needsJealousyCallout = !cofounderCard && (!/jealous/i.test(cleanBody) || !/main character/i.test(cleanBody));

  const personalTextBlock = !cofounderCard && personalRows.length > 0
    ? `\n\n--- Tailored to ${p?.firstName ? `${sanitizeEmailCopy(p.firstName)}'s` : 'Your'} Focus ---\n${personalRows.map(([k, v]) => `• ${k}: ${sanitizeEmailCopy(v)}`).join('\n')}`
    : '';

  const jealousyHtmlBlock = needsJealousyCallout
    ? `<div style="background:#FFF9DB;border:1px dashed #D6B900;border-radius:14px;padding:12px 15px;margin:0 0 18px 0;font-size:13.5px;line-height:1.55;color:#1F2024;font-weight:600;">
        💛 ${esc(jealousyNote)}
      </div>`
    : '';

  const personalHtmlBlock = !cofounderCard && personalRows.length > 0
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

  const renderSkillPills = (rawList = '', bg = '#F1EFE6', color = '#1F2024', border = '#DDD7C2') =>
    String(rawList || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5)
      .map(
        (chip) =>
          `<span style="display:inline-block;background:${bg};color:${color};border:1px solid ${border};border-radius:999px;padding:3px 10px;font-size:11.5px;font-weight:800;margin:2px 5px 2px 0;">${esc(chip)}</span>`
      )
      .join('');

  const c = cofounderCard && typeof cofounderCard === 'object' ? cofounderCard : null;
  const cofounderTextBlock = c
    ? [
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `1. YOUR PROFILE (MAIN CHARACTER)`,
        `   • Name: ${c.meFullName} (${c.meRole} · ${c.meCity})`,
        `   • Focus: ${c.meFocus}`,
        `   • What you bring: ${c.meBrings}`,
        '',
        `2. YOUR 1-OF-1 POTENTIAL CO-FOUNDER (${c.bandLabel} · ${c.weekKey})`,
        `   • Name: ${c.partnerFullName} (${c.partnerRole} · ${c.partnerCity})`,
        `   • Focus: ${c.partnerFocus}`,
        `   • What ${c.partnerFirst} brings: ${c.partnerBrings}`,
        '',
        `3. WHY LINKUP AI & ALGORITHM PAIRED YOU TWO`,
        `   • Shared Signal: ${c.sharedLine}`,
        `   • Co-Founder Complement: ${c.complementLine}`,
        `   • First 20-Minute Sprint: ${c.sprintLine}`,
        '',
        `4. HOW YOUR EXCLUSIVE 1:1 PAIRING WORKS`,
        `   • When ${c.partnerFirst} opens LINKUP this week, YOU are the single potential co-founder on their screen too.`,
        `   • If both of you tap "Interested in Meeting", LINKUP unlocks your direct room so you can meet!`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      ].join('\n')
    : '';

  const cofounderHtmlBlock = c
    ? `
      <!-- Card 1: Your Profile -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FCFBF4;border:1px solid #E6DFC0;border-radius:16px;margin:0 0 14px 0;">
        <tr>
          <td style="padding:15px 17px;">
            <div style="font-size:10px;font-weight:900;letter-spacing:0.8px;text-transform:uppercase;color:#7A6500;margin:0 0 6px 0;">
              1 &middot; YOUR PROFILE &middot; MAIN CHARACTER
            </div>
            <div style="font-size:16px;font-weight:900;color:#0A0B0D;line-height:1.3;">
              ${esc(c.meFullName)}
            </div>
            <div style="font-size:12.5px;font-weight:700;color:#575B60;margin:2px 0 10px 0;">
              ${esc(c.meRole)} &middot; ${esc(c.meCity)}
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="top" width="110" style="font-size:12px;font-weight:800;color:#575B60;padding:0 8px 6px 0;">Focus:</td>
                <td valign="top" style="font-size:13px;font-weight:700;color:#0A0B0D;padding:0 0 6px 0;">${esc(c.meFocus)}</td>
              </tr>
              <tr>
                <td valign="top" width="110" style="font-size:12px;font-weight:800;color:#575B60;padding:2px 8px 0 0;">What you bring:</td>
                <td valign="top" style="padding:0;">${renderSkillPills(c.meBrings, '#FFF8C5', '#1F2024', '#E5D462')}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Card 2: Your 1-of-1 Potential Co-Founder -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#11131A;border:2px solid #FBE618;border-radius:16px;margin:0 0 14px 0;">
        <tr>
          <td style="padding:16px 18px;">
            <div style="margin:0 0 8px 0;">
              <span style="display:inline-block;background:#FBE618;color:#0A0B0D;font-size:10px;font-weight:900;letter-spacing:0.8px;text-transform:uppercase;padding:4px 9px;border-radius:999px;">
                2 &middot; YOUR 1-OF-1 POTENTIAL CO-FOUNDER &middot; ${esc(c.bandLabel.toUpperCase())}
              </span>
            </div>
            <div style="font-size:18px;font-weight:900;color:#FFFFFF;line-height:1.3;">
              ${esc(c.partnerFullName)}
            </div>
            <div style="font-size:12.5px;font-weight:700;color:#CBD5E1;margin:3px 0 12px 0;">
              ${esc(c.partnerRole)} &middot; ${esc(c.partnerCity)}
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="top" width="118" style="font-size:12px;font-weight:800;color:#94A3B8;padding:0 8px 7px 0;">Focus:</td>
                <td valign="top" style="font-size:13px;font-weight:700;color:#F8FAFC;padding:0 0 7px 0;">${esc(c.partnerFocus)}</td>
              </tr>
              <tr>
                <td valign="top" width="118" style="font-size:12px;font-weight:800;color:#94A3B8;padding:2px 8px 0 0;">${esc(c.partnerFirst)} brings:</td>
                <td valign="top" style="padding:0;">${renderSkillPills(c.partnerBrings, '#222634', '#FBE618', '#524B16')}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Card 3: Why LINKUP AI & Algorithm Paired You Two -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:16px;margin:0 0 14px 0;">
        <tr>
          <td style="padding:15px 17px;">
            <div style="font-size:10.5px;font-weight:900;letter-spacing:0.8px;text-transform:uppercase;color:#0F172A;margin:0 0 10px 0;">
              &#9889; WHY LINKUP AI &amp; ALGORITHM PAIRED YOU TWO
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="top" width="110" style="font-size:12px;font-weight:800;color:#475569;padding:0 8px 7px 0;">Shared Signal:</td>
                <td valign="top" style="font-size:13px;line-height:1.5;font-weight:700;color:#0F172A;padding:0 0 7px 0;">${esc(c.sharedLine)}</td>
              </tr>
              <tr>
                <td valign="top" width="110" style="font-size:12px;font-weight:800;color:#475569;padding:0 8px 10px 0;">Complement:</td>
                <td valign="top" style="font-size:13px;line-height:1.5;font-weight:700;color:#0F172A;padding:0 0 10px 0;">${esc(c.complementLine)}</td>
              </tr>
            </table>
            <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-left:4px solid #FBE618;border-radius:10px;padding:10px 12px;">
              <div style="font-size:10px;font-weight:900;letter-spacing:0.7px;text-transform:uppercase;color:#6E5B00;margin:0 0 3px 0;">
                First 20-Minute Co-Founder Sprint
              </div>
              <div style="font-size:13px;line-height:1.5;font-weight:600;color:#1E293B;">
                ${esc(c.sprintLine)}
              </div>
            </div>
          </td>
        </tr>
      </table>

      <!-- Card 4: Mutual 1:1 Rule -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:14px;margin:0 0 20px 0;">
        <tr>
          <td style="padding:12px 15px;font-size:13px;line-height:1.55;color:#065F46;font-weight:700;">
            &#129309; <strong>How your exclusive 1:1 pairing works:</strong> When ${esc(c.partnerFirst)} opens LINKUP this week, <strong>you</strong> are the single potential co-founder on their screen too. If both of you tap <em>&ldquo;Interested in Meeting&rdquo;</em>, LINKUP immediately unlocks your direct chat so you can meet!
          </td>
        </tr>
      </table>
    `
    : '';

  const bodyParagraphsHtml = cleanBody
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map(
      (para) =>
        `<p style="font-size:15px;line-height:1.65;color:#2C3038;margin:0 0 14px 0;">${esc(para).replace(/\n/g, '<br/>')}</p>`
    )
    .join('');

  const textBody = `${cleanHeadline}\n[${moodSpec.pillText}]\n\n${cleanBody}${cofounderTextBlock}${needsJealousyCallout ? `\n\n${jealousyNote}` : ''}${personalTextBlock}\n\n${cleanCta}: ${fullUrl}\n\n— Linky, your slightly jealous #1 fan on LINKUP\n\n---\nUnsubscribe from LINKUP emails: ${unsubUrl}`;

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
        ${bodyParagraphsHtml}
        ${cofounderHtmlBlock}
        ${jealousyHtmlBlock}
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
  cofounderCard = null,
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
  if (!finalBody) {
    finalBody = buildMainCharacterJealousyNote(resolvedPersonal);
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
    cofounderCard,
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
  subject = 'LINKUP · Linky is jealous of your other tabs — come be the main character',
  headline = 'Okay be honest, which other app is stealing our main character today?',
  body = 'Linky is low-key jealous you are giving other tabs your best hours when the whole LINKUP room revolves around you.',
  ctaLabel = 'Reclaim your spotlight on LINKUP',
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
    badgeLabel: 'Daily main-character check-in from Linky on LINKUP',
    quotaBucket: 'daily_pulse',
    quotaCap: DAILY_PULSE_EMAIL_CAP,
  }, options);
}

const DEFAULT_COMEBACK_HEADLINE = 'Your LinkUp seat is warm — and Linky is jealous of whatever tab stole our main character';
const DEFAULT_COMEBACK_BODY = 'Okay, be honest — which other app has been stealing your attention? Because Linky is officially jealous! Around here, the whole LINKUP world revolves around you like the main character you are, and the timeline feels like a filler episode until you walk back in.';

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
        finalHeadline = `${greet}Linky is jealous without our main character — ${resolvedPersonal.projectLabel} & "${cleanSnippet(resolvedPersonal.goalLabel, 40)}" revolve around you`;
      } else if (resolvedPersonal.goalLabel) {
        finalHeadline = `${greet}stop making Linky jealous — main character move on "${cleanSnippet(resolvedPersonal.goalLabel, 44)}" is waiting`;
      } else if (resolvedPersonal.lookingForLabel) {
        finalHeadline = `${greet}we're jealous of your other tabs — your ${cleanSnippet(resolvedPersonal.lookingForLabel, 40)} matches revolve around you`;
      }
    }
    if (!callerPassedBody || body === DEFAULT_COMEBACK_BODY) {
      const sentences = [buildMainCharacterJealousyNote(resolvedPersonal)];
      if (resolvedPersonal.lookingForLabel) {
        sentences.push(`Builders matching what you're looking for (${resolvedPersonal.lookingForLabel}) have been active while you were away, and honestly we hate seeing anyone else get the spotlight when this whole stage was built for you.`);
        if (ctaLabel === 'Plug back into LINKUP') {
          finalCta = `Claim your ${cleanSnippet(resolvedPersonal.lookingForLabel, 26)} matches`;
          finalUrl = '/linky?comeback=email';
        }
      } else {
        sentences.push('Come back for two minutes, drop one update, and remind the whole room who the main character is.');
      }
      finalBody = sentences.join(' ');
    }
  } else if (!callerPassedBody || body === DEFAULT_COMEBACK_BODY) {
    finalBody = buildMainCharacterJealousyNote(resolvedPersonal);
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

const DEFAULT_DIRECT_SUBJECT = 'LINKUP · Linky is jealous of your other tabs — come be the main character ⚡';
const DEFAULT_DIRECT_HEADLINE = 'Hey main character — Linky is low-key jealous you are not in the room right now!';
const DEFAULT_DIRECT_BODY = 'Okay, be honest — what other app is getting your attention today? Because Linky is officially jealous! Around here, the whole LINKUP universe revolves around you, and the room feels like a filler episode until our main character steps back in.';

export async function sendLinkyDirectEmail(db, rawInput = {}, { fetcher = fetch, env = process.env } = {}) {
  const {
    to = '',
    uid = 'linky-test',
    mood = 'default',
    subject = DEFAULT_DIRECT_SUBJECT,
    headline = DEFAULT_DIRECT_HEADLINE,
    body = DEFAULT_DIRECT_BODY,
    ctaLabel = 'Step into your spotlight on LINKUP',
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
    const greet = resolvedPersonal.firstName ? `Hey ${resolvedPersonal.firstName}` : 'Hey main character';
    if (!callerPassedHeadline && headline === DEFAULT_DIRECT_HEADLINE) {
      if (resolvedPersonal.goalLabel) {
        finalHeadline = `${greet} — stop making Linky jealous, "${cleanSnippet(resolvedPersonal.goalLabel, 44)}" revolves around you!`;
      } else if (resolvedPersonal.lookingForLabel) {
        finalHeadline = `${greet} — Linky is jealous of your other tabs while ${cleanSnippet(resolvedPersonal.lookingForLabel, 38)} matches wait for our main character`;
      }
    }
    if (!callerPassedSubject && subject === DEFAULT_DIRECT_SUBJECT) {
      finalSubject = `LINKUP · ${finalHeadline}`.slice(0, 118);
    }
    if (!callerPassedBody && body === DEFAULT_DIRECT_BODY) {
      finalBody = buildMainCharacterJealousyNote(resolvedPersonal);
    }
  } else if (!callerPassedBody && body === DEFAULT_DIRECT_BODY) {
    finalBody = buildMainCharacterJealousyNote(resolvedPersonal);
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

export function buildWeeklyCofounderIntroCopy({
  weekKey = 'this week',
  recipientProfile = {},
  partnerProfile = {},
  recipientBrief = null,
  partnerBrief = null,
  why = {},
  myOffers = [],
  partnerOffers = [],
  aiIntro = '',
  firstSprintTask = '',
  bandLabel = 'Strong fit',
} = {}) {
  const meName = formatHumanName(
    cleanSnippet(
      recipientBrief?.firstName || extractFirstName(recipientProfile?.displayName, recipientProfile?.username) || 'Founder',
      40
    )
  );
  const meFullName = formatHumanName(cleanSnippet(recipientProfile?.displayName || meName, 60));
  const partnerFullName = formatHumanName(
    cleanSnippet(
      partnerProfile?.displayName || partnerBrief?.firstName || partnerProfile?.username || 'Your Co-Founder Match',
      60
    )
  );
  const partnerFirst = formatHumanName(
    cleanSnippet(
      partnerBrief?.firstName || extractFirstName(partnerProfile?.displayName, partnerProfile?.username) || partnerFullName,
      40
    )
  );

  const meRole = cleanSnippet(recipientBrief?.roleLabel || recipientProfile?.occupation || 'Builder & Founder', 60);
  const meCity = cleanSnippet(recipientBrief?.cityLabel || [recipientProfile?.city, recipientProfile?.country].filter(Boolean).join(', ') || 'Remote', 50);
  const meFocus = cleanSnippet(
    recipientBrief?.projectLabel || recipientBrief?.goalLabel || recipientProfile?.bio || (recipientProfile?.skills || []).slice(0, 3).join(', ') || 'High-conviction startup building',
    110
  );
  const meBrings = cleanSnippet((Array.isArray(myOffers) && myOffers.length ? myOffers : recipientProfile?.skills || ['Product Execution']).slice(0, 3).join(', '), 80);

  const partnerRole = cleanSnippet(partnerBrief?.roleLabel || partnerProfile?.occupation || 'Builder & Founder', 60);
  const partnerCity = cleanSnippet(partnerBrief?.cityLabel || [partnerProfile?.city, partnerProfile?.country].filter(Boolean).join(', ') || 'Remote', 50);
  const partnerFocus = cleanSnippet(
    partnerBrief?.projectLabel || partnerBrief?.goalLabel || partnerProfile?.bio || (partnerProfile?.skills || []).slice(0, 3).join(', ') || 'Building ambitious products',
    110
  );
  const partnerBrings = cleanSnippet((Array.isArray(partnerOffers) && partnerOffers.length ? partnerOffers : partnerProfile?.skills || ['Technical & Growth Execution']).slice(0, 3).join(', '), 80);

  const sharedLine = cleanSnippet(why?.shared || 'Shared startup ambition and builder velocity.', 140);
  const complementLine = cleanSnippet(why?.complement || `${meBrings} meets ${partnerBrings}.`, 140);
  const aiLine = cleanSnippet(aiIntro || `${sharedLine} ${complementLine}`, 200);
  const sprintLine = cleanSnippet(firstSprintTask || 'Spend 20 minutes scoping one concrete customer problem and a 48-hour prototype.', 140);

  const headline = `${meName}, Linky is almost too jealous to share you — meet ${partnerFullName}, your 1-of-1 Potential Co-Founder for ${weekKey}!`;
  const subject = `LINKUP · ${meName} × ${partnerFirst}: Your 1-of-1 Weekly Potential Co-Founder Match (Linky is jealous ⚡)`.slice(0, 118);

  const body = [
    `Okay ${meName}, be honest — which other app or tab has been stealing your attention? Because Linky is officially jealous, and we are even a little jealous of ${partnerFullName} for getting paired with our main character this week!`,
    `Around here, the whole LINKUP universe revolves around you. Our matching algorithm and AI selected ${partnerFullName} as your ONLY potential co-founder for ${weekKey} (${bandLabel}). Here is your mutual introduction below:`,
  ].join('\n\n');

  const cofounderCard = {
    weekKey,
    bandLabel,
    meName,
    meFullName,
    meRole,
    meCity,
    meFocus,
    meBrings,
    partnerFirst,
    partnerFullName,
    partnerRole,
    partnerCity,
    partnerFocus,
    partnerBrings,
    sharedLine,
    complementLine,
    aiLine,
    sprintLine,
  };

  return {
    subject,
    headline,
    body,
    cofounderCard,
    ctaLabel: `Meet ${partnerFirst} on LINKUP`,
    ctaUrl: `/profile/${encodeURIComponent(String(partnerProfile?.uid || ''))}?weeklyCofounder=1`,
  };
}

export async function sendWeeklyCofounderIntroEmails(db, pairRecord = {}, options = {}) {
  if (!db || !pairRecord?.uidA || !pairRecord?.uidB) {
    return { sentA: false, sentB: false, reason: 'missing_pair' };
  }
  const weekKey = String(pairRecord.weekKey || 'current');
  const uidA = String(pairRecord.uidA);
  const uidB = String(pairRecord.uidB);
  const profileA = pairRecord.profileA || { uid: uidA };
  const profileB = pairRecord.profileB || { uid: uidB };

  const [briefA, briefB] = await Promise.all([
    loadPersonalBuilderBrief(db, uidA, { user: profileA }),
    loadPersonalBuilderBrief(db, uidB, { user: profileB }),
  ]);

  const copyForA = buildWeeklyCofounderIntroCopy({
    weekKey,
    recipientProfile: profileA,
    partnerProfile: profileB,
    recipientBrief: briefA,
    partnerBrief: briefB,
    why: pairRecord.cardForA?.why || pairRecord.whyForA || {},
    myOffers: pairRecord.aOffers || [],
    partnerOffers: pairRecord.bOffers || [],
    aiIntro: pairRecord.aiIntroForA || pairRecord.aiWhyMutual || pairRecord.whyMutual || '',
    firstSprintTask: pairRecord.firstSprintTask || pairRecord.cardForA?.tiny_task || '',
    bandLabel: pairRecord.band?.label || 'Strong fit',
  });

  const copyForB = buildWeeklyCofounderIntroCopy({
    weekKey,
    recipientProfile: profileB,
    partnerProfile: profileA,
    recipientBrief: briefB,
    partnerBrief: briefA,
    why: pairRecord.cardForB?.why || pairRecord.whyForB || {},
    myOffers: pairRecord.bOffers || [],
    partnerOffers: pairRecord.aOffers || [],
    aiIntro: pairRecord.aiIntroForB || pairRecord.aiWhyMutual || pairRecord.whyMutual || '',
    firstSprintTask: pairRecord.firstSprintTask || pairRecord.cardForB?.tiny_task || '',
    bandLabel: pairRecord.band?.label || 'Strong fit',
  });

  const [resA, resB] = await Promise.all([
    sendHighSignalEmail(db, uidA, {
      receiptKey: `weekly_cofounder_${weekKey}_${uidA}_${uidB}`,
      throttleMs: 0,
      minUserGapMs: 0,
      subject: copyForA.subject,
      headline: copyForA.headline,
      body: copyForA.body,
      cofounderCard: copyForA.cofounderCard,
      ctaLabel: copyForA.ctaLabel,
      ctaUrl: copyForA.ctaUrl,
      mood: 'celebration',
      personal: briefA,
      badgeLabel: `1-of-1 Weekly Co-Founder Intro · ${weekKey}`,
    }, options),
    sendHighSignalEmail(db, uidB, {
      receiptKey: `weekly_cofounder_${weekKey}_${uidB}_${uidA}`,
      throttleMs: 0,
      minUserGapMs: 0,
      subject: copyForB.subject,
      headline: copyForB.headline,
      body: copyForB.body,
      cofounderCard: copyForB.cofounderCard,
      ctaLabel: copyForB.ctaLabel,
      ctaUrl: copyForB.ctaUrl,
      mood: 'celebration',
      personal: briefB,
      badgeLabel: `1-of-1 Weekly Co-Founder Intro · ${weekKey}`,
    }, options),
  ]);

  return {
    sentA: !!resA?.sent,
    sentB: !!resB?.sent,
    resA,
    resB,
    copyForA,
    copyForB,
  };
}

