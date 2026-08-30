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
import { extendFrom } from './_paynow.js';

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
 * @param {string} args.reference   our reference (paynowTransactions doc id)
 * @param {FirebaseFirestore.DocumentReference} [args.txRef]   marked paid atomically
 * @param {object} [args.txPatch]   extra fields to merge onto the transaction
 * @returns {Promise<{ granted: boolean, endsAt: Date | null }>}
 */
export async function grantWebEntitlement(db, args) {
  const { uid, months, planKey, amount, reference, txRef, txPatch } = args || {};

  const tier = normalizeTier(args?.tier);
  if (!uid || !tier) {
    throw new Error(`grantWebEntitlement: bad uid/tier (${uid}/${args?.tier})`);
  }

  const subRef = db.collection('webSubscriptions').doc(uid);

  return db.runTransaction(async (t) => {
    // Re-read inside the transaction so a retried webhook cannot double-grant.
    if (txRef) {
      const fresh = await t.get(txRef);
      if (fresh.exists && String(fresh.data()?.status || '').toLowerCase() === 'paid') {
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
          paidAt: current.paidAt || serverTimestamp(),
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

    return { granted: true, endsAt };
  });
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
