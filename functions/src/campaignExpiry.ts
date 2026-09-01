/**
 * Campaign expiry — closes the "start a 7-day trial, cancel, keep the ad
 * running forever" loophole.
 *
 * Before this, nothing ever ended a campaign. `status: 'active'` was written
 * once at approval and never cleared, `expiresAt` was never written at all,
 * and the app is never told when a Google Play subscription lapses. So an ad
 * bought on a free trial served indefinitely.
 *
 * Expiry is decided here, server-side, from the owner's entitlement:
 *
 *   web  (ContiPay)  webSubscriptions/{uid}.campaigns.endsAt   exact
 *   play (trial)     campaignAccounts/{uid}.trialEndsAt        exact
 *   play (paid)      no renewal date published to us           bounded window
 *   play (RTDN)      campaignAccounts/{uid}.expiresAt          exact, future
 *
 * Three functions enforce it:
 *   stampCampaignExpiry             writes expiresAt when a campaign is created
 *   refreshCampaignExpiryOnApproval re-stamps it when a campaign goes live,
 *                                   because review can take days
 *   endLapsedCampaigns              every 6h, ends anything whose entitlement
 *                                   has gone away, and tightens any stamp that
 *                                   has drifted past the entitlement end
 *
 * KNOWN WEAK SPOT — the bounded window. Google does not publish a Play
 * renewal date unless Real-Time Developer Notifications are wired up, so for a
 * paid Play subscription we can only bound the campaign and re-check it. A
 * cancelled Play subscriber therefore gets at most CAMPAIGN_WINDOW_DAYS more
 * days rather than forever. To make it exact, enable RTDN (Play Console →
 * Monetisation setup) and have the handler write expiresAt onto
 * campaignAccounts/{uid}. readCampaignsEntitlement already prefers that field.
 */
import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

const REGION = 'us-central1';

/** Safety net for a paid Play subscription whose renewal date we cannot see. */
const CAMPAIGN_WINDOW_DAYS = 30;

/** Renewal grace: a lapsed entitlement gets this long before the ad is pulled. */
const LAPSE_GRACE_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const db = () => admin.firestore();

type Entitlement = {
  /** Does the advertiser hold a campaigns plan right now? */
  active: boolean;
  /** Known end of that plan, or null when the provider will not tell us. */
  endsAt: number | null;
  source: string;
  /**
   * False when a read threw, so we could not determine entitlement either
   * way. Callers must leave the campaign alone: ending a paid ad over a
   * transient Firestore error is far worse than leaving it up another pass.
   */
  reliable: boolean;
};

const NO_ENTITLEMENT: Entitlement = { active: false, endsAt: null, source: 'none', reliable: true };

/** Firestore Timestamp | epoch millis | Date | ISO string -> millis, else null. */
function toMillis(value: any): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * What does this advertiser currently have, and when does it run out?
 *
 * Web is checked first: a ContiPay purchase is a prepaid term with a real end
 * date, and it is the most trustworthy signal we hold.
 */
async function readCampaignsEntitlement(uid: string): Promise<Entitlement> {
  if (!uid) return NO_ENTITLEMENT;
  const now = Date.now();
  let readFailed = false;

  try {
    const web = await db().doc(`webSubscriptions/${uid}`).get();
    if (web.exists) {
      const campaigns = ((web.get('campaigns') || {}) as Record<string, any>) || {};
      const status = String(campaigns.status || '').toLowerCase();
      const endsAt = toMillis(campaigns.endsAt);
      if (status === 'active' && endsAt != null) {
        return endsAt > now
          ? { active: true, endsAt, source: 'web', reliable: true }
          : { active: false, endsAt, source: 'web-lapsed', reliable: true };
      }
    }
  } catch (error) {
    readFailed = true;
    logger.warn('campaignExpiry: webSubscriptions read failed', { uid, error: String(error) });
  }

  try {
    const account = await db().doc(`campaignAccounts/${uid}`).get();
    if (account.exists) {
      const data: any = account.data() || {};

      // An exact expiry, for whenever Play RTDN or another billing sync writes
      // one. Preferred over everything else on this branch.
      const known = toMillis(data.expiresAt ?? data.entitlementEndsAt);
      if (known != null) {
        return known > now
          ? { active: true, endsAt: known, source: 'play', reliable: true }
          : { active: false, endsAt: known, source: 'play-lapsed', reliable: true };
      }

      // A trial has a real, exact end date.
      const trialEndsAt = toMillis(data.trialEndsAt);
      if (trialEndsAt != null) {
        return trialEndsAt > now
          ? { active: true, endsAt: trialEndsAt, source: 'play-trial', reliable: true }
          : { active: false, endsAt: trialEndsAt, source: 'play-trial-ended', reliable: true };
      }

      if (String(data.status || '').toLowerCase() === 'active') {
        // Paid, but Play has not published a renewal date to us. Bound it and
        // let the sweep re-check. Anchoring on `now` rather than unlockedAt
        // means a long-running annual subscriber is never wrongly cut off.
        return {
          active: true,
          endsAt: now + CAMPAIGN_WINDOW_DAYS * DAY_MS,
          source: 'play-window',
          reliable: true,
        };
      }

      return { active: false, endsAt: null, source: 'play-inactive', reliable: true };
    }
  } catch (error) {
    readFailed = true;
    logger.warn('campaignExpiry: campaignAccounts read failed', { uid, error: String(error) });
  }

  if (readFailed) {
    return { active: false, endsAt: null, source: 'read-failed', reliable: false };
  }
  return NO_ENTITLEMENT;
}

/** The date a campaign should stop serving, given its owner's entitlement. */
async function computeCampaignExpiry(
  ownerId: string
): Promise<{ expiresAt: number; source: string; active: boolean }> {
  const entitlement = await readCampaignsEntitlement(ownerId);
  if (entitlement.active) {
    return {
      expiresAt: entitlement.endsAt ?? Date.now() + CAMPAIGN_WINDOW_DAYS * DAY_MS,
      source: entitlement.source,
      active: true,
    };
  }
  // Nothing to run on. Expires immediately; the sweep ends it after the grace.
  return { expiresAt: Date.now(), source: entitlement.source, active: false };
}

/**
 * Stamp a campaign the moment it is created.
 *
 * The client is not asked for a date and is not trusted with one — expiry is
 * always derived here from the entitlement.
 */
export const stampCampaignExpiry = onDocumentCreated(
  { region: REGION, document: 'campaigns/{campaignId}' },
  async (event) => {
    const snap: any = event.data;
    if (!snap) return;
    const data: any = snap.data?.() || {};
    const ownerId = String(data.ownerId || '');
    if (!ownerId) return;

    const { expiresAt, source } = await computeCampaignExpiry(ownerId);
    await snap.ref.set(
      {
        expiresAt: admin.firestore.Timestamp.fromMillis(expiresAt),
        expiresAtSource: source,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    logger.info('campaignExpiry: stamped new campaign', {
      campaignId: snap.id,
      expiresAt: new Date(expiresAt).toISOString(),
      source,
    });
  }
);

/**
 * Re-stamp when a campaign actually goes live.
 *
 * Approval can happen days after creation, so the creation stamp is stale by
 * then. Only reacts to a transition INTO 'active' — approval, or an owner
 * un-pausing — so the sweep's own writes never retrigger this.
 */
export const refreshCampaignExpiryOnApproval = onDocumentUpdated(
  { region: REGION, document: 'campaigns/{campaignId}' },
  async (event) => {
    const change: any = event.data;
    if (!change?.after) return;
    const before: any = change.before?.data?.() || {};
    const after: any = change.after.data?.() || {};
    const snap = change.after;

    if (String(before.status || '') === 'active') return;
    if (String(after.status || '') !== 'active') return;

    const ownerId = String(after.ownerId || '');
    if (!ownerId) return;

    const { expiresAt, source } = await computeCampaignExpiry(ownerId);
    await snap.ref.set(
      {
        expiresAt: admin.firestore.Timestamp.fromMillis(expiresAt),
        expiresAtSource: source,
        entitlementLapsedAt: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    logger.info('campaignExpiry: re-stamped on approval', {
      campaignId: snap.id,
      expiresAt: new Date(expiresAt).toISOString(),
      source,
    });
  }
);

/**
 * The sweep. Every six hours:
 *
 *   - entitlement gone  -> mark lapsed, then end the campaign after the grace
 *   - entitlement live  -> keep expiresAt clamped to the entitlement end,
 *                          which also backfills campaigns with no stamp
 *
 * Expiry is compared here rather than in the query so the sweep needs no
 * composite index and, more usefully, so it walks campaigns that have no
 * expiresAt at all — which is every campaign created before this existed.
 */
export const endLapsedCampaigns = onSchedule(
  { region: REGION, schedule: 'every 6 hours', timeoutSeconds: 540, maxInstances: 1 },
  async () => {
    const now = Date.now();
    const snap = await db().collection('campaigns').where('status', '==', 'active').limit(300).get();

    const batch = db().batch();
    let ending = 0;
    let markingLapsed = 0;
    let tightened = 0;
    let stamped = 0;
    let skipped = 0;

    for (const docSnap of snap.docs) {
      const data: any = docSnap.data() || {};
      const ownerId = String(data.ownerId || '');
      if (!ownerId) continue;

      const entitlement = await readCampaignsEntitlement(ownerId);
      const current = toMillis(data.expiresAt);

      if (!entitlement.reliable) {
        // Could not determine entitlement. Leave the campaign exactly as it
        // is; the next pass will look again.
        skipped += 1;
        continue;
      }

      if (!entitlement.active) {
        const lapsedAt = toMillis(data.entitlementLapsedAt);
        if (lapsedAt == null) {
          // First time we have noticed. Start the grace clock rather than
          // killing an ad over a slow renewal.
          batch.set(
            docSnap.ref,
            {
              entitlementLapsedAt: admin.firestore.Timestamp.fromMillis(now),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          markingLapsed += 1;
          continue;
        }
        if (now - lapsedAt < LAPSE_GRACE_MS) continue;

        batch.set(
          docSnap.ref,
          {
            status: 'ended',
            endedAt: admin.firestore.FieldValue.serverTimestamp(),
            endedReason: `entitlement-lapsed:${entitlement.source}`,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        ending += 1;
        continue;
      }

      // Entitlement is live. A campaign must never outlive it, and must never
      // sit on a stamp that has already passed (that happens when someone
      // launches during a trial and then buys a real plan).
      const ceiling = entitlement.endsAt ?? now + CAMPAIGN_WINDOW_DAYS * DAY_MS;
      if (current == null || current > ceiling || current <= now) {
        batch.set(
          docSnap.ref,
          {
            expiresAt: admin.firestore.Timestamp.fromMillis(ceiling),
            expiresAtSource: entitlement.source,
            entitlementLapsedAt: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        if (current == null) stamped += 1;
        else tightened += 1;
      }
    }

    if (ending || markingLapsed || tightened || stamped) {
      await batch.commit();
    }

    logger.info('campaignExpiry: sweep complete', {
      scanned: snap.size,
      ending,
      markingLapsed,
      tightened,
      stamped,
      skipped,
    });
  }
);
