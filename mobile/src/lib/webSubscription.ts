// Web billing state.
//
// Android keeps Google Play Billing. Web uses ContiPay, which cannot auto-renew,
// so a web purchase is a PREPAID TERM: the server writes an `endsAt` date onto
// webSubscriptions/{uid} and this module turns that document into the same
// "do you have PLUS?" answer the Play path produces.
//
// Nothing here is writable from the app — firestore.rules sets
// `allow write: if false` on webSubscriptions. Only api/ can grant.
import { Platform } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { TIERS } from './pricing';

export const PLUS_TIER = TIERS.PLUS;
export const CAMPAIGNS_TIER = TIERS.CAMPAIGNS;

export type WebTierState = {
  status: string;
  planKey: string;
  lastReference: string;
  lastAmount: number;
  endsAt: number | null;
  startedAt?: number | null;
};

export type WebSubscription = {
  uid: string;
  plus?: WebTierState | null;
  campaigns?: WebTierState | null;
};

/** Web is the only surface that bills through ContiPay. */
export const isWebBilling = () => Platform.OS === 'web';

/** Firestore Timestamp / {seconds} / epoch millis -> millis. */
function toMillis(value: any): number {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Live-listen to a user's web entitlements.
 * Returns an unsubscribe function. No-op on native (Play owns billing there).
 */
export function subscribeWebSubscription(
  uid: string | undefined | null,
  onChange: (sub: WebSubscription | null) => void
): () => void {
  if (!uid || !isWebBilling()) {
    onChange(null);
    return () => {};
  }
  return onSnapshot(
    doc(db, 'webSubscriptions', uid),
    (snap) => {
      onChange(snap.exists() ? ({ uid, ...(snap.data() as any) } as WebSubscription) : null);
    },
    (error) => {
      // Missing doc / permission denied both mean "no entitlement yet" — the
      // user must never be locked out because of a read failure.
      console.warn('[webSubscription] listener failed', error?.message || error);
      onChange(null);
    }
  );
}

/** Is this tier currently paid up? Expired terms read as not-active. */
export function webTierActive(sub: WebSubscription | null | undefined, tier: string): boolean {
  const entry = sub?.[tier as keyof WebSubscription] as WebTierState | null | undefined;
  if (!entry) return false;
  if (String(entry.status || '').toLowerCase() !== 'active') return false;
  return toMillis(entry.endsAt) > Date.now();
}

export const webPlusActive = (sub: WebSubscription | null | undefined) => webTierActive(sub, PLUS_TIER);
export const webCampaignsActive = (sub: WebSubscription | null | undefined) =>
  webTierActive(sub, CAMPAIGNS_TIER);

/** Millis remaining on a tier, or 0. */
export function webTierEndsAt(sub: WebSubscription | null | undefined, tier: string): number {
  const entry = sub?.[tier as keyof WebSubscription] as WebTierState | null | undefined;
  return webTierActive(sub, tier) ? toMillis(entry?.endsAt) : 0;
}

/**
 * Merge web entitlements into the auth profile so every existing gate
 * (`hasLinkupPro`, free-limit counters, ...) keeps working unchanged and keeps
 * agreeing across platforms.
 *
 * Additive only: a profile that already shows Pro — e.g. someone who bought on
 * Android and is now on a laptop — keeps it. We never downgrade someone who
 * has already paid, we only grant, so a web user with no purchase gets gated.
 */
export function withWebEntitlements(profile: any, sub: WebSubscription | null | undefined): any {
  const plus = webPlusActive(sub);
  const campaigns = webCampaignsActive(sub);

  const next: any = {
    ...(profile || {}),
    // Read by CampaignsScreen, which gates off a different document
    // (campaignAccounts/{uid}) than the profile.
    webCampaigns: campaigns || !!profile?.webCampaigns,
  };

  // Preserve any existing paid state; only ADD Pro when the web term is active.
  const alreadyPro = !!profile?.isPro || String(profile?.plan || '').toLowerCase() === 'plus';
  if (plus && !alreadyPro) {
    next.isPro = true;
    next.plan = 'plus';
    next.subscriptionPlan = 'plus';
    next.subscriptionStatus = 'active';
    next.linkupPlus = 'paid';
    next.proUnlockedAt = profile?.proUnlockedAt || new Date().toISOString();
    next.entitlements = { ...(profile?.entitlements || {}), pro: true };
  }

  return next;
}
