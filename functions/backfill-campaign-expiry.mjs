/**
 * One-off backfill: stamp expiresAt on campaigns that predate the expiry work.
 *
 * Every campaign created before the fix has no expiresAt at all, and the
 * mobile client refuses to serve an unstamped campaign (that refusal IS the
 * loophole fix). So without this, every existing ad goes dark until the
 * 6-hourly sweep first runs. Run this once, right after shipping the client
 * change, and they keep serving.
 *
 * It reads and writes Firestore directly, so it does not depend on the
 * functions being deployed first.
 *
 *   cd C:\Users\hp\LINKUP\functions
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\hp\linkup-sa.json"
 *   node backfill-campaign-expiry.mjs           (dry run - shows the plan)
 *   node backfill-campaign-expiry.mjs --write   (applies it)
 *
 * Needs firebase-admin installed in this folder:
 *   cd C:\Users\hp\LINKUP\functions
 *   npm ci
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'linkup-e0906' });

const db = getFirestore();

const WRITE = process.argv.includes('--write');

/** Must match CAMPAIGN_WINDOW_DAYS in src/campaignExpiry.ts. */
const CAMPAIGN_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const toMillis = (value) => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function readCampaignsEntitlement(uid) {
  const now = Date.now();
  if (!uid) return { active: false, endsAt: null, source: 'none' };

  try {
    const web = await db.doc(`webSubscriptions/${uid}`).get();
    if (web.exists) {
      const campaigns = web.get('campaigns') || {};
      const status = String(campaigns.status || '').toLowerCase();
      const endsAt = toMillis(campaigns.endsAt);
      if (status === 'active' && endsAt != null) {
        return endsAt > now
          ? { active: true, endsAt, source: 'web' }
          : { active: false, endsAt, source: 'web-lapsed' };
      }
    }
  } catch (error) {
    console.warn(`  ! webSubscriptions read failed for ${uid}: ${error?.message || error}`);
  }

  try {
    const account = await db.doc(`campaignAccounts/${uid}`).get();
    if (account.exists) {
      const data = account.data() || {};
      const known = toMillis(data.expiresAt ?? data.entitlementEndsAt);
      if (known != null) {
        return known > now
          ? { active: true, endsAt: known, source: 'play' }
          : { active: false, endsAt: known, source: 'play-lapsed' };
      }
      const trialEndsAt = toMillis(data.trialEndsAt);
      if (trialEndsAt != null) {
        return trialEndsAt > now
          ? { active: true, endsAt: trialEndsAt, source: 'play-trial' }
          : { active: false, endsAt: trialEndsAt, source: 'play-trial-ended' };
      }
      if (String(data.status || '').toLowerCase() === 'active') {
        return { active: true, endsAt: now + CAMPAIGN_WINDOW_DAYS * DAY_MS, source: 'play-window' };
      }
      return { active: false, endsAt: null, source: 'play-inactive' };
    }
  } catch (error) {
    console.warn(`  ! campaignAccounts read failed for ${uid}: ${error?.message || error}`);
  }

  return { active: false, endsAt: null, source: 'none' };
}

const snap = await db.collection('campaigns').where('status', '==', 'active').limit(300).get();

console.log(`Active campaigns found: ${snap.size}`);
console.log(`Mode: ${WRITE ? 'WRITE' : 'DRY RUN - re-run with --write to apply'}\n`);

let stamped = 0;
let ended = 0;
let skipped = 0;
const batch = db.batch();

for (const docSnap of snap.docs) {
  const data = docSnap.data() || {};
  const ownerId = String(data.ownerId || '');
  const label = `${docSnap.id}  ${String(data.name || '(unnamed)').slice(0, 40)}`;

  if (!ownerId) {
    console.log(`  skip  ${label}  - no ownerId`);
    skipped += 1;
    continue;
  }

  const entitlement = await readCampaignsEntitlement(ownerId);

  if (!entitlement.active) {
    // No plan behind it. This is exactly the loophole: end it rather than
    // stamping a date and letting it run on.
    const reason = `entitlement-lapsed:${entitlement.source}`;
    console.log(`  END   ${label}  - ${reason}`);
    if (WRITE) {
      batch.set(
        docSnap.ref,
        {
          status: 'ended',
          endedAt: Timestamp.now(),
          endedReason: reason,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
    }
    ended += 1;
    continue;
  }

  const expiresAt = entitlement.endsAt ?? Date.now() + CAMPAIGN_WINDOW_DAYS * DAY_MS;
  const iso = new Date(expiresAt).toISOString();
  console.log(`  keep  ${label}  - until ${iso}  (${entitlement.source})`);
  if (WRITE) {
    batch.set(
      docSnap.ref,
      {
        expiresAt: Timestamp.fromMillis(expiresAt),
        expiresAtSource: entitlement.source,
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  }
  stamped += 1;
}

if (WRITE && (stamped || ended)) {
  await batch.commit();
  console.log(`\nCommitted. Stamped ${stamped}, ended ${ended}.`);
} else {
  console.log(`\nNothing written. Would stamp ${stamped}, would end ${ended}, skipped ${skipped}.`);
}
