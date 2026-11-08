// Referral links for intern-led growth.
//
// Public side:  GET /r/:code (rewritten to publicSeo?mode=ref) counts the
//               click on the link doc, then 302s into the app with
//               ?ref=:code attached. The client stores the code and stamps
//               it onto the user doc when a fresh account signs in, which is
//               what makes a "signup" attributable to an intern.
// Admin side:   POST publicSeo?mode=ref-admin (Bearer Firebase ID token,
//               admin only) creates/names/renames/pauses/deletes links and
//               reports clicks vs attributed signups per link.
//
// Storage is the `referralLinks` collection, one doc per code. Clients can
// never touch it directly: api/_dbPolicy.js default-denies collections the
// rules never opened, so all access flows through this module.
import { fieldIncrement, serverTimestamp, verifyRequestUser } from './_firebaseAdmin.js';

// Founder allowlist — keep in sync with mobile/src/lib/admin.ts. A user doc
// carrying isAdmin === true is equally an admin; both signals are checked,
// exactly like the app does.
const ADMIN_EMAILS = ['tanakaprince49@gmail.com'];

export const REFERRAL_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;

export function slugifyReferralCode(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const tsToMillis = (value) => {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return null;
};

export function publicReferralLink(link, appBase) {
  return {
    code: link.code,
    label: link.label || link.code,
    // Links must live under /app: that is the only prefix the public site
    // routes to this deployment. A bare /r/<code> hits the marketing site's
    // 404 before it can ever reach the counter.
    url: `${appBase}/r/${link.code}`,
    clicks: Number(link.clicks) || 0,
    signups: Number(link.signups) || 0,
    active: link.active !== false,
    createdAt: tsToMillis(link.createdAt),
    lastClickAt: tsToMillis(link.lastClickAt),
  };
}

export async function requireReferralAdmin(db, user) {
  if (!user?.uid) return false;
  if (ADMIN_EMAILS.includes(String(user.email || '').trim().toLowerCase())) return true;
  try {
    const snap = await db.collection('users').doc(user.uid).get();
    return !!(snap?.exists && snap.data()?.isAdmin === true);
  } catch {
    return false;
  }
}

async function countSignups(db, code) {
  const users = db.collection('users');
  try {
    const aggregate = await users.where('referralCode', '==', code).count().get();
    return Number(aggregate.data().count) || 0;
  } catch {
    const snap = await users.where('referralCode', '==', code).get();
    return snap.docs?.length || 0;
  }
}

export async function listReferralLinks(db, appBase) {
  const snap = await db.collection('referralLinks').get();
  const links = (snap.docs || []).map((d) => ({ code: d.id, ...(d.data() || {}) }));
  links.sort((a, b) => (tsToMillis(b.createdAt) || 0) - (tsToMillis(a.createdAt) || 0));
  return Promise.all(
    links.map(async (link) => publicReferralLink({ ...link, signups: await countSignups(db, link.code) }, appBase)),
  );
}

// GET /r/:code — count the click, then land the visitor in the app with the
// code attached. Unknown/paused codes still land in the app, just without
// attribution: a printed or shared link must never dead-end.
export async function handleReferralRedirect({ db, code, appBase, send, res }) {
  const clean = String(code || '').toLowerCase();
  let valid = false;
  if (REFERRAL_CODE_PATTERN.test(clean)) {
    try {
      const ref = db.collection('referralLinks').doc(clean);
      const snap = await ref.get();
      if (snap?.exists && snap.data()?.active !== false) {
        valid = true;
        await ref.update({ clicks: fieldIncrement(1), lastClickAt: serverTimestamp() });
      }
    } catch {
      // Counter trouble must never block the visit.
    }
  }
  res.setHeader('Location', valid ? `${appBase}/?ref=${encodeURIComponent(clean)}` : `${appBase}/`);
  res.setHeader('Cache-Control', 'private, no-store');
  return send(302, '');
}

// POST publicSeo?mode=ref-admin  { action: 'list'|'create'|'rename'|'setActive'|'delete', ... }
export async function handleReferralAdmin({ db, req, verifyUser = verifyRequestUser, appBase, send }) {
  const json = (code, body) => send(code, JSON.stringify(body), 'application/json; charset=utf-8');
  const user = await verifyUser(req).catch(() => null);
  if (!user?.uid) return json(401, { error: 'Sign in required' });
  if (!(await requireReferralAdmin(db, user))) return json(403, { error: 'Admin access required' });

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  const action = String(body.action || 'list');

  try {
    if (action === 'list') {
      return json(200, { links: await listReferralLinks(db, appBase) });
    }
    if (action === 'create') {
      const label = String(body.label || '').trim().slice(0, 60);
      if (label.length < 2) return json(400, { error: "Give the link a name — the intern's name." });
      const code = slugifyReferralCode(body.code || label);
      if (!REFERRAL_CODE_PATTERN.test(code)) {
        return json(400, { error: 'Link code must be 3-40 characters: lowercase letters, numbers, hyphens.' });
      }
      const ref = db.collection('referralLinks').doc(code);
      const existing = await ref.get();
      if (existing?.exists) return json(409, { error: 'That link code is already taken. Pick another.' });
      const doc = {
        code,
        label,
        clicks: 0,
        active: true,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        lastClickAt: null,
      };
      await ref.set(doc);
      return json(201, { link: publicReferralLink(doc, appBase) });
    }

    const code = slugifyReferralCode(body.code || '');
    if (!REFERRAL_CODE_PATTERN.test(code)) return json(400, { error: 'Invalid link code.' });
    const ref = db.collection('referralLinks').doc(code);
    const snap = await ref.get();
    if (!snap?.exists) return json(404, { error: 'Link not found.' });
    const current = { code, ...(snap.data() || {}) };

    if (action === 'rename') {
      const label = String(body.label || '').trim().slice(0, 60);
      if (label.length < 2) return json(400, { error: 'Name is too short.' });
      await ref.update({ label, updatedAt: serverTimestamp() });
      return json(200, { link: publicReferralLink({ ...current, label, signups: await countSignups(db, code) }, appBase) });
    }
    if (action === 'setActive') {
      const active = body.active === true;
      await ref.update({ active, updatedAt: serverTimestamp() });
      return json(200, { link: publicReferralLink({ ...current, active, signups: await countSignups(db, code) }, appBase) });
    }
    if (action === 'delete') {
      await ref.delete();
      return json(200, { deleted: code });
    }
    return json(400, { error: 'Unknown action.' });
  } catch {
    return json(503, { error: 'Referral service is temporarily unavailable.' });
  }
}
