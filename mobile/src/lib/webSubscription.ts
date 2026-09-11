// Web billing state.
//
// Android bills through Google Play, web bills through Payonify. Payonify
// cannot auto-renew, so a web purchase is a PREPAID TERM: the server writes an
// `endsAt` date onto webSubscriptions/{uid} and this module turns that document
// into the same "do you have PLUS?" answer the Play path produces.
//
// The entitlement is READ on every platform. A member who bought PLUS on the
// web and then opens the Android app must still be PLUS there (blue check,
// crown, Turbo Connect, ad-free) — billing surface and entitlement surface are
// two different things, and only the checkout stays web-only.
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

/** Only the web surface can START a Payonify checkout. Entitlements are read everywhere. */
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
 * Live-listen to a user's web entitlements. Runs on EVERY platform so a web
 * purchase is honoured in the Android/iOS app too — the document is readable
 * by its owner (firestore.rules), and only the server can write it.
 * Returns an unsubscribe function.
 */
export function subscribeWebSubscription(
  uid: string | undefined | null,
  onChange: (sub: WebSubscription | null) => void
): () => void {
  if (!uid) {
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

  // PLUS identity must agree across rails. The Google Play path writes the
  // verified tick, crown input and Turbo Connect boost to users/{uid}; a web
  // buyer gets the same flags (the server also writes them now, but folding
  // them in here means the buyer sees their own tick immediately, on the same
  // render that unlocks the gates, instead of a tick that lags a refresh).
  if (plus) {
    next.isVerified = true;
    next.verificationProgram = 'LINKUP PLUS';
    next.verifiedBy = 'LINKUP PLUS';
    next.turboConnect = true;
  }

  return next;
}
