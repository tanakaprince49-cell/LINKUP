import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// 7-day free trial — LINKUP PLUS and LINKUP Campaigns.
//
// Ownership rule: GOOGLE PLAY OWNS THE TRIAL. Play starts the subscription at
// $0, bills nothing for 7 days, then charges automatically on day 8 unless the
// user cancels. The app never gates access on a local countdown — a lapsed
// local clock must never lock out someone who is paying.
//
// What this module does:
//   1. Reads the real trial Play advertises (pricing phases) so every screen
//      shows the same truth — "7 days free, then $19.99/mo".
//   2. Remembers locally when a trial started so we can show a countdown,
//      a "trial ends tomorrow" nudge, and honest trial badges.
// ---------------------------------------------------------------------------

export const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type OfferTrial = {
  /** Play reports a $0 (free-trial) pricing phase for this offer. */
  hasTrial: boolean;
  /** Length of that free phase in days, as Play reports it. */
  trialDays: number;
  /** Formatted price of the recurring phase after the trial, e.g. "$19.99". */
  priceLabel: string;
};

export type TrialRecord = {
  productId: string;
  startedAt: number;
  endsAt: number;
};

const trialKey = (uid: string, productId: string) =>
  `linkup:trial:${uid || 'anonymous'}:${productId}`;

/** ISO-8601 duration ("P7D", "P1W", "P1M", "P1Y") -> days. */
const parseIsoDays = (period: string) => {
  const match = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?$/.exec(
    String(period || '').trim().toUpperCase()
  );
  if (!match) return 0;
  const [, years, months, weeks, days] = match;
  return (
    Number(years || 0) * 365 +
    Number(months || 0) * 30 +
    Number(weeks || 0) * 7 +
    Number(days || 0)
  );
};

type RawPhase = {
  priceAmountMicros?: string | number | null;
  formattedPrice?: string | null;
  billingPeriod?: string | null;
  recurrenceMode?: number | null;
};

/** True when an offer carries a $0 free-trial pricing phase. */
export const hasFreeTrialPhase = (offer: any) => {
  const phases: RawPhase[] = Array.isArray(offer?.pricingPhasesAndroid?.pricingPhaseList)
    ? offer.pricingPhasesAndroid.pricingPhaseList
    : Array.isArray(offer?.pricingPhases?.pricingPhaseList)
      ? offer.pricingPhases.pricingPhaseList
      : [];
  return phases.some(
    (phase) => Number(phase?.priceAmountMicros ?? 0) === 0 && Number(phase?.recurrenceMode ?? 1) !== 1
  );
};

/**
 * Choose which Play offer to buy.
 *
 * A subscription with a free-trial offer exposes SEVERAL offers to the Billing
 * Library: one for the bare base plan (no trial) and one per offer. Buying the
 * first token we see would silently give the user the no-trial base plan, so we
 * always prefer an offer with a free-trial phase and only fall back to the base
 * plan when none exists.
 */
export const pickSubscriptionOffer = (product: any) => {
  const offers: any[] = Array.isArray(product?.subscriptionOffers)
    ? product.subscriptionOffers
    : Array.isArray(product?.subscriptionOfferDetailsAndroid)
      ? product.subscriptionOfferDetailsAndroid
      : [];
  const purchasable = offers.filter((offer) => !!offerTokenFor(offer));
  const pool = purchasable.length ? purchasable : offers;
  return pool.find((offer) => hasFreeTrialPhase(offer)) || pool[0] || null;
};

/** expo-iap names the token differently on the new vs deprecated offer types. */
export const offerTokenFor = (offer: any) => offer?.offerTokenAndroid || offer?.offerToken || null;

/**
 * Describe one Play subscription offer (expo-iap `SubscriptionOffer` or the
 * deprecated `subscriptionOfferDetailsAndroid` entry).
 *
 * - recurrenceMode 1 = INFINITE_RECURRING  -> the real price after the trial
 * - any other mode priced at 0             -> the free-trial phase
 *
 * When Play gives us no phases at all (offline, product not cached yet) we
 * assume the shipped configuration (7 days) rather than hiding the trial —
 * the local record is display-only, so guessing wrong can never bill or lock
 * anyone out.
 */
export const describeSubscriptionOffer = (
  offer: any,
  fallbackPrice: string,
  fallbackDays: number = TRIAL_DAYS
): OfferTrial => {
  const phases: RawPhase[] = Array.isArray(offer?.pricingPhasesAndroid?.pricingPhaseList)
    ? offer.pricingPhasesAndroid.pricingPhaseList
    : Array.isArray(offer?.pricingPhases?.pricingPhaseList)
      ? offer.pricingPhases.pricingPhaseList
      : [];

  if (!phases.length) {
    return { hasTrial: true, trialDays: fallbackDays, priceLabel: offer?.displayPrice || fallbackPrice };
  }

  const freePhase = phases.find(
    (phase) => Number(phase?.priceAmountMicros ?? 0) === 0 && Number(phase?.recurrenceMode ?? 1) !== 1
  );
  const recurringPhase =
    phases.find((phase) => Number(phase?.recurrenceMode ?? 1) === 1) || phases[phases.length - 1];

  return {
    hasTrial: !!freePhase,
    trialDays: (freePhase ? parseIsoDays(String(freePhase?.billingPeriod || '')) : 0) || fallbackDays,
    priceLabel: recurringPhase?.formattedPrice || offer?.displayPrice || fallbackPrice,
  };
};

/**
 * Record the start of a trial. Idempotent — if the user already trialled this
 * product we keep the original window instead of restarting the clock.
 */
export const saveTrialStart = async (
  uid: string,
  productId: string,
  days: number = TRIAL_DAYS
): Promise<TrialRecord | null> => {
  if (!uid || !productId) return null;
  const key = trialKey(uid, productId);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const existing = JSON.parse(raw) as TrialRecord;
      if (existing?.endsAt) return existing;
    }
  } catch {
    // Corrupt entry — fall through and rewrite it.
  }
  const now = Date.now();
  const record: TrialRecord = { productId, startedAt: now, endsAt: now + Math.max(1, days) * DAY_MS };
  await AsyncStorage.setItem(key, JSON.stringify(record)).catch(() => {});
  return record;
};

export const readTrial = async (uid: string, productId: string): Promise<TrialRecord | null> => {
  if (!uid || !productId) return null;
  try {
    const raw = await AsyncStorage.getItem(trialKey(uid, productId));
    if (!raw) return null;
    const record = JSON.parse(raw) as TrialRecord;
    return record?.endsAt ? record : null;
  } catch {
    return null;
  }
};

/** The trial that ends soonest across a set of products (e.g. PLUS monthly + yearly). */
export const readActiveTrial = async (uid: string, productIds: string[]): Promise<TrialRecord | null> => {
  if (!uid || !productIds.length) return null;
  const records = await Promise.all(productIds.map((productId) => readTrial(uid, productId)));
  const active = records.filter(
    (record): record is TrialRecord => !!record && record.endsAt > Date.now()
  );
  if (!active.length) return null;
  return active.sort((a, b) => a.endsAt - b.endsAt)[0];
};

export const isTrialActive = (record: TrialRecord | null | undefined) =>
  !!record && record.endsAt > Date.now();

/** Whole days left, rounded up — 1 means "ends tomorrow", 0 means finished. */
export const trialDaysLeft = (record: TrialRecord | null | undefined) =>
  record ? Math.max(0, Math.ceil((record.endsAt - Date.now()) / DAY_MS)) : 0;

export const trialStatusLabel = (record: TrialRecord | null | undefined) => {
  if (!isTrialActive(record)) return '';
  const days = trialDaysLeft(record);
  // Under a day left, hours are the honest unit — "1 DAY LEFT" reads wrong
  // when the trial actually ends in forty minutes.
  if (days <= 1) {
    const hours = Math.max(1, Math.ceil((record!.endsAt - Date.now()) / (60 * 60 * 1000)));
    return `FREE TRIAL · ${hours} HOUR${hours === 1 ? '' : 'S'} LEFT`;
  }
  return `FREE TRIAL · ${days} DAYS LEFT`;
};

/** "7 days free, then $19.99/mo" — the copy shared by every paywall surface. */
export const trialThenPrice = (trial: OfferTrial, cadence: string) =>
  `${trial.trialDays} days free, then ${trial.priceLabel}${cadence}`;
