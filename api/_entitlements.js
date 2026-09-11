// Web entitlement grants.
//
// A web user can buy PLUS and Campaigns independently, so we cannot write a
// single flat `tier` onto webSubscriptions/{uid} — buying one plan would erase
// the other. The shape is therefore per-tier:
//
//   webSubscriptions/{uid} = {
//     uid,
//     plus:      { status, planKey, lastReference, lastAmount, startedAt, endsAt, updatedAt },
//     campaigns: { status, planKey, lastReference, lastAmount, startedAt, endsAt, updatedAt },
//     updatedAt
//   }
//
// Only the server writes this collection (firestore.rules: `allow write: if false`).
import { serverTimestamp } from './_firebaseAdmin.js';

// Date maths used to live in _paynow.js; it has nothing to do with any
// particular gateway, so it belongs with the entitlement logic that uses it.
// (Paynow and ContiPay have been retired in favour of Payonify.)

/** Add whole months to a date, clamping the day (31 Jan + 1 month -> 28/29 Feb). */
export function addMonths(from, months) {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Number(months || 0));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** Extend an existing paid-through date so topping up stacks instead of resetting. */
export function extendFrom(currentEndsAt, now, months) {
  const baseMs = currentEndsAt?.toMillis ? currentEndsAt.toMillis() : Number(currentEndsAt || 0);
  const base = baseMs && baseMs > now.getTime() ? new Date(baseMs) : now;
  return addMonths(base, months);
}

/** Tiers a web user can hold. Mirrors TIERS in shared/pricing.js. */
export const WEB_TIERS = ['plus', 'campaigns'];

export function normalizeTier(tier) {
  const value = String(tier || '').trim().toLowerCase();
  return WEB_TIERS.includes(value) ? value : null;
}

/** Firestore Timestamp / Date / epoch millis -> millis. Tolerant on purpose. */
export function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Grant (or top up) one tier for one user.
 *
 * Topping up STACKS: a user with 5 months left who buys 12 ends up with 17.
 * The grant is idempotent — if the transaction is already marked paid we do
 * nothing rather than extending the term again.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {object} args
 * @param {string} args.uid
 * @param {'plus'|'campaigns'} args.tier
 * @param {number} args.months      prepaid term length
 * @param {string} args.planKey     e.g. 'plus_12m'
 * @param {number} args.amount
 * @param {string} args.reference   our reference (webTransactions doc id)
 * @param {FirebaseFirestore.DocumentReference} [args.txRef]   marked paid atomically
 * @param {object} [args.txPatch]   extra fields to merge onto the transaction
 * @returns {Promise<{ granted: boolean, endsAt: Date | null }>}
 */
export async function grantWebEntitlement(db, args) {
  const { uid, months, planKey, amount, reference, txRef, txPatch, force } = args || {};

  const tier = normalizeTier(args?.tier);
  if (!uid || !tier) {
    throw new Error(`grantWebEntitlement: bad uid/tier (${uid}/${args?.tier})`);
  }

  const subRef = db.collection('webSubscriptions').doc(uid);

  return db.runTransaction(async (t) => {
    // Re-read inside the transaction so a retried webhook cannot double-grant.
    // `paidAt` is written ONLY here, so it is the exact "already granted"
    // marker. `force` lets the status endpoint heal a legacy transaction that
    // was marked 'paid' by the old status poll without ever being granted
    // (status === 'paid' but no paidAt); even then a concurrent grant is
    // caught by the paidAt check.
    let gateway = 'web';
    if (txRef) {
      const fresh = await t.get(txRef);
      const data = fresh.exists ? fresh.data() || {} : {};
      gateway = String(data.gateway || 'web');
      const alreadyPaid = String(data.status || '').toLowerCase() === 'paid';
      if (data.paidAt || (alreadyPaid && !force)) {
        return { granted: false, endsAt: null };
      }
    }

    const subSnap = await t.get(subRef);
    const sub = subSnap.exists ? subSnap.data() || {} : {};
    const current = sub[tier] && typeof sub[tier] === 'object' ? sub[tier] : {};

    const now = new Date();
    const endsAt = extendFrom(current.endsAt, now, months || 1);

    if (txRef) {
      t.set(
        txRef,
        {
          ...(txPatch || {}),
          status: 'paid',
          paidAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    t.set(
      subRef,
      {
        uid,
        [tier]: {
          status: 'active',
          planKey: planKey || current.planKey || '',
          lastReference: reference || current.lastReference || '',
          lastAmount: amount ?? current.lastAmount ?? 0,
          // Keep the ORIGINAL start date so a top up reads as "until <date>",
          // not "12 months from today" for someone who already had time left.
          startedAt: current.startedAt || serverTimestamp(),
          endsAt,
          updatedAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // A PLUS grant must carry the same outward identity the Google Play path
    // writes: verified blue check, PLUS crown and the Turbo Connect boost are
    // all read off users/{uid} by other members. Web used to stop at
    // webSubscriptions/{uid}, so a web buyer looked unpaid (no tick, no crown,
    // no boost) to everyone else. Write the flags here, server-side, inside
    // the same transaction that extends the term — and into publicProfiles
    // too, because Discover/Search/ProfileScreen on Android read that lean
    // index first.
    if (tier === 'plus') {
      t.set(
        db.collection('users').doc(uid),
        {
          uid,
          isPro: true,
          plan: 'plus',
          subscriptionPlan: 'plus',
          subscriptionStatus: 'active',
          billingProvider: gateway,
          isVerified: true,
          verificationProgram: 'LINKUP PLUS',
          verifiedBy: 'LINKUP PLUS',
          verifiedAt: serverTimestamp(),
          turboConnect: true,
          proUnlockedAt: serverTimestamp(),
          subscriptionUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // Stamp the public index too — but only when it already exists, so a
      // brand-new buyer never gets a nameless publicProfiles row before their
      // own profile sync creates the full document.
      const pubSnap = await t.get(db.collection('publicProfiles').doc(uid));
      if (pubSnap.exists) {
        t.set(
          db.collection('publicProfiles').doc(uid),
          {
            uid,
            isPro: true,
            plan: 'plus',
            subscriptionPlan: 'plus',
            subscriptionStatus: 'active',
            isVerified: true,
            verificationProgram: 'LINKUP PLUS',
            turboConnect: true,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    return { granted: true, endsAt };
  });
}

/**
 * Repair the outward identity flags on users/{uid} for a member whose web PLUS
 * term is active but whose user doc was never stamped (purchases made before
 * the grant started writing the flags). The Google Play path writes the same
 * flags, and publicProfiles is synced from users/{uid}, so without this a web
 * buyer looks unpaid to everyone else on Android — no tick, no crown, no boost.
 *
 * Idempotent and additive: it only writes a field when it is missing/wrong, so
 * it can never fight a fresh grant or a manual correction, and it never clears
 * anything.
 *
 * @returns {Promise<boolean>} true when a repair was written.
 */
export async function repairWebIdentityFlags(db, uid) {
  if (!uid) return false;
  const subSnap = await db.collection('webSubscriptions').doc(uid).get().catch(() => null);
  const sub = subSnap && subSnap.exists ? subSnap.data() || {} : {};
  const plus = sub.plus && typeof sub.plus === 'object' ? sub.plus : null;
  const active =
    plus &&
    String(plus.status || '').toLowerCase() === 'active' &&
    toMillis(plus.endsAt) > Date.now();
  if (!active) return false;

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get().catch(() => null);
  const u = userSnap && userSnap.exists ? userSnap.data() || {} : {};

  const userPatch = {};
  if (!u.isPro) userPatch.isPro = true;
  if (String(u.plan || '').toLowerCase() !== 'plus') userPatch.plan = 'plus';
  if (String(u.subscriptionPlan || '').toLowerCase() !== 'plus') userPatch.subscriptionPlan = 'plus';
  if (String(u.subscriptionStatus || '').toLowerCase() !== 'active') userPatch.subscriptionStatus = 'active';
  if (!u.turboConnect) userPatch.turboConnect = true;
  if (!u.isVerified || String(u.verificationProgram || '').toUpperCase() !== 'LINKUP PLUS') {
    userPatch.isVerified = true;
    userPatch.verificationProgram = 'LINKUP PLUS';
    userPatch.verifiedBy = 'LINKUP PLUS';
    userPatch.verifiedAt = serverTimestamp();
  }

  // publicProfiles/{uid} is the lean index Discover/Search/ProfileScreen read
  // on the mobile app. A web PLUS member whose user doc predates the stamping
  // must also read as PLUS there — stamp it too, but only when the index row
  // already exists (never create a nameless public row from a repair).
  let pubWrote = false;
  const pubRef = db.collection('publicProfiles').doc(uid);
  const pubSnap = await pubRef.get().catch(() => null);
  if (pubSnap && pubSnap.exists) {
    const p = pubSnap.data() || {};
    const pubPatch = {};
    if (!p.isPro) pubPatch.isPro = true;
    if (String(p.plan || '').toLowerCase() !== 'plus') pubPatch.plan = 'plus';
    if (String(p.subscriptionPlan || '').toLowerCase() !== 'plus') pubPatch.subscriptionPlan = 'plus';
    if (String(p.subscriptionStatus || '').toLowerCase() !== 'active') pubPatch.subscriptionStatus = 'active';
    if (!p.turboConnect) pubPatch.turboConnect = true;
    if (!p.isVerified || String(p.verificationProgram || '').toUpperCase() !== 'LINKUP PLUS') {
      pubPatch.isVerified = true;
      pubPatch.verificationProgram = 'LINKUP PLUS';
    }
    if (Object.keys(pubPatch).length) {
      await pubRef.set({ uid, ...pubPatch, updatedAt: serverTimestamp() }, { merge: true });
      pubWrote = true;
    }
  }

  if (Object.keys(userPatch).length === 0 && !pubWrote) return false;
  if (Object.keys(userPatch).length) await userRef.set(userPatch, { merge: true });
  return true;
}

/** Read the current web entitlements for a user, normalised for the client. */
export async function readWebEntitlement(db, uid) {
  if (!uid) return null;
  const snap = await db.collection('webSubscriptions').doc(uid).get();
  if (!snap.exists) return null;
  const sub = snap.data() || {};
  const out = { uid };
  for (const tier of WEB_TIERS) {
    const entry = sub[tier];
    if (!entry) continue;
    const endsAt = toMillis(entry.endsAt);
    out[tier] = {
      status: endsAt > Date.now() ? 'active' : 'expired',
      planKey: entry.planKey || '',
      lastReference: entry.lastReference || '',
      lastAmount: entry.lastAmount ?? 0,
      endsAt: endsAt || null,
    };
  }
  return out;
}
