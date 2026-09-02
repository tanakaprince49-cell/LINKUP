import AsyncStorage from '@react-native-async-storage/async-storage';
import { CAMPAIGNS_PRICES, formatUsd } from './pricing';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { hasLinkupPro } from './paywall';
import { isAdminEmail, isAdminIdentity, type AdminIdentity } from './admin';
import { IdeaDeckItem } from './ideas';

// ---------------------------------------------------------------------------
// LinkUp Campaigns — in-house sponsored placements.
// Advertisers subscribe (Google Play: linkup_campaigns_monthly / yearly), submit
// a creative (a snapshot of one of their own posted ideas), it lands in
// pending_review, an admin approves it, and eligible non-PLUS viewers get it
// injected into the Idea Deck at 1-sponsored-per-interval density.
// Abuse controls live here: per-plan active cap, per-viewer daily impression
// cap, and a global density cap that is enforced on the *viewer* side, so
// advertiser volume can never degrade the organic deck.
// ---------------------------------------------------------------------------

export const LINKUP_CAMPAIGNS_PRODUCT_ID = 'linkup_campaigns_monthly_2';
export const LINKUP_CAMPAIGNS_YEARLY_PRODUCT_ID = 'linkup_campaigns_yearly_2';
export const LINKUP_CAMPAIGNS_MONTHLY_PRICE = formatUsd(CAMPAIGNS_PRICES.monthly);
export const LINKUP_CAMPAIGNS_YEARLY_PRICE = formatUsd(CAMPAIGNS_PRICES.yearly);
export const CAMPAIGNS_PRODUCT_IDS = [LINKUP_CAMPAIGNS_PRODUCT_ID, LINKUP_CAMPAIGNS_YEARLY_PRODUCT_ID];

/** Max campaigns a subscriber may have in a live-ish state at once. */
export const MAX_ACTIVE_CAMPAIGNS = 3;
/** One viewer sees the same campaign at most this many times per day. */
export const CAMPAIGN_IMPRESSION_DAILY_CAP = 2;
/**
 * One sponsored card per N organic cards in the deck.
 *
 * 4 means the sponsored card lands at index 3 — the 4th card the viewer
 * swipes. Density is capped here, on the VIEWER side, so an advertiser buying
 * more campaigns can never flood anyone's deck.
 */
export const SPONSORED_INTERVAL = 4;

export const CAMPAIGN_INDUSTRY_OPTIONS = [
  'SaaS',
  'AI',
  'Fintech',
  'Healthtech',
  'EdTech',
  'E-commerce',
  'Creator Economy',
  'Social',
];

/** Placements an advertiser can buy. `available: false` ships in a later build
 * — the chip renders disabled so the roadmap is visible without overselling. */
export const CAMPAIGN_PLACEMENT_OPTIONS: { id: string; label: string; desc: string; available: boolean }[] = [
  { id: 'ideas', label: 'Idea Deck', desc: 'Sponsored card inside the idea swipe flow', available: true },
  { id: 'search', label: 'Search boost', desc: 'Sponsored slot pinned to the top of search', available: true },
  { id: 'hub', label: 'Hub strip', desc: 'Banner on the discovery home screen', available: true },
  { id: 'linky', label: 'Linky picks', desc: 'Linky may recommend you — always disclosed as sponsored', available: true },
  { id: 'discover', label: 'Discover boost', desc: 'Sponsored card shows every 4th swipe in the people deck', available: true },
  { id: 'news', label: 'News feed', desc: 'Sponsored card inside the AI news feed', available: true },
  { id: 'play', label: 'Play tab', desc: 'Sponsored card on the Play screen', available: true },
  { id: 'picks', label: "Today's picks", desc: 'Sponsored card above the recommended-people list', available: true },
  { id: 'projects', label: 'Project matches', desc: 'Sponsored card at the top of project & opportunity lists', available: true },
  { id: 'daily', label: 'Daily 5', desc: 'Sponsored card on the Daily 5 loop screen', available: true },
];


/**
 * How long a campaign runs when the advertiser's plan has no published end
 * date - a paid Play subscription, before RTDN tells us the renewal date.
 * Mirrors CAMPAIGN_WINDOW_DAYS in functions/src/campaignExpiry.ts.
 */
export const CAMPAIGN_WINDOW_DAYS = 30;

/** House ads fill empty inventory: when no advertiser campaign is eligible we
 * promote PLUS ourselves instead of wasting the slot. */
export const HOUSE_PLUS_CAMPAIGN_ID = 'house_plus';

export type CampaignStatus = 'pending_review' | 'active' | 'paused' | 'rejected' | 'ended';

/** Advertisers promote a PRODUCT (app, service, startup). `idea` source is
 * kept for back-compat with campaigns created before the product pivot. */
export type CampaignCreative = {
  source: 'product' | 'idea';
  productName?: string;
  tagline?: string;
  description: string;
  website?: string;
  /** Advertiser logo (ImageKit URL). Shown on every sponsored placement. */
  logoUrl?: string;
  category?: string[];
  ideaId?: string;
  title?: string;
  stage?: string;
  lookingFor?: string[];
  tags?: string[];
};

export type Campaign = {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerPic?: string;
  ownerOccupation?: string;
  ownerCity?: string;
  ownerCountry?: string;
  ownerVerified?: boolean;
  name: string;
  status: CampaignStatus;
  placements: string[];
  creative: CampaignCreative;
  industries: string[];
  planProductId?: string;
  /** Server-stamped stop date. Written by functions/src/campaignExpiry.ts. */
  expiresAt?: any;
  /** Which entitlement the stamp came from — 'web', 'play-trial', … */
  expiresAtSource?: string;
  statsImpressions: number;
  statsClicks: number;
  reviewNote?: string;
  createdAt?: any;
  updatedAt?: any;
};

export type CampaignsAccount = {
  uid?: string;
  plan?: string;
  status?: string;
  planProductId?: string;
  billingProvider?: string;
  /** Exact end of the entitlement when known (Play re-verify, RTDN, web). */
  expiresAt?: any;
  trialEndsAt?: any;
  storeVerifiedAt?: any;
  unlockedAt?: any;
  updatedAt?: any;
};

const todayStamp = () => new Date().toISOString().slice(0, 10);
const seenKey = (uid: string, campaignId: string) => `linkup:campaign-seen:${uid || 'anonymous'}:${campaignId}:${todayStamp()}`;
const clickedKey = (uid: string, campaignId: string) => `linkup:campaign-clicked:${uid || 'anonymous'}:${campaignId}:${todayStamp()}`;
const accountCacheKey = (uid: string) => `linkup:campaigns-account:${uid || 'anonymous'}`;

/**
 * Does this account have an active Campaigns plan?
 *
 * No web shortcut: on web the plan is bought through Payonify and lives in
 * webSubscriptions/{uid}, not campaignAccounts/{uid}. Callers on web pass the
 * web flag in via `webOverride` (see withWebEntitlements).
 */
export const hasCampaignsPlan = (
  account: CampaignsAccount | null | undefined,
  webOverride?: boolean
) => {
  if (webOverride === true) return true;
  return String(account?.status || '').toLowerCase() === 'active';
};

export const fetchCampaignsAccount = async (uid: string): Promise<CampaignsAccount | null> => {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'campaignAccounts', uid));
    if (snap.exists()) {
      const data = snap.data() as CampaignsAccount;
      await AsyncStorage.setItem(accountCacheKey(uid), JSON.stringify(data)).catch(() => {});
      return data;
    }
  } catch {
    // Fall through to the cached copy — billing checks must not block the screen.
  }
  try {
    const raw = await AsyncStorage.getItem(accountCacheKey(uid));
    return raw ? (JSON.parse(raw) as CampaignsAccount) : null;
  } catch {
    return null;
  }
};

/**
 * Play-side lapse detection.
 *
 * Google never tells this app when a subscription ends (no RTDN), so the
 * campaignAccounts doc stayed `status: 'active'` forever and the hourly
 * sweep kept re-extending the 30-day window: a cancelled subscriber's ad
 * could run indefinitely. The Campaigns screen now re-checks the store on
 * every open and calls this with what Google actually says.
 *
 *   still owned   -> `status: 'active'`, `verifiedAt` refreshed
 *   not owned     -> `status: 'expired'`, `expiresAt: now`
 *
 * The sweep reads `expiresAt` first, so a lapsed owner's campaigns are
 * ended on the next hourly pass. Between passes the client filter
 * (isCampaignServable) already hides anything past its stamp.
 */
export const syncCampaignsAccountFromStore = async (
  uid: string,
  owned: boolean,
  options: { productId?: string; autoRenewing?: boolean | null } = {}
) => {
  if (!uid) return;
  const now = Date.now();
  if (owned) {
    // Still paying. Clear any earlier lapse stamp and a finished trial date,
    // otherwise the sweep reads the stale past date first and ends the ads
    // of someone who converted from trial to paid.
    await saveCampaignsAccount(uid, {
      status: 'active',
      ...(options.productId ? { planProductId: options.productId } : {}),
      autoRenewing: options.autoRenewing ?? null,
      expiresAt: null,
      trialEndsAt: null,
      isTrial: false,
      storeVerifiedAt: now,
      updatedAt: serverTimestamp(),
    });
    return;
  }
  await saveCampaignsAccount(uid, {
    status: 'expired',
    expiresAt: now,
    storeVerifiedAt: now,
    updatedAt: serverTimestamp(),
  });
};

export const saveCampaignsAccount = async (uid: string, patch: Record<string, unknown>) => {
  if (!uid) return;
  const payload = { uid, ...patch };
  try {
    await setDoc(doc(db, 'campaignAccounts', uid), payload as any, { merge: true });
  } catch {
    // Cache-only unlock still lets this device run campaigns; Firestore sync retries next open.
  }
  await AsyncStorage.setItem(accountCacheKey(uid), JSON.stringify(payload)).catch(() => {});
};

const snapshotToCampaigns = (snap: any): Campaign[] =>
  snap.docs.map((entry: any) => ({ id: entry.id, ...entry.data() } as Campaign));

export const subscribeMyCampaigns = (uid: string, onData: (campaigns: Campaign[]) => void, onError?: (error: any) => void) =>
  onSnapshot(
    query(collection(db, 'campaigns'), where('ownerId', '==', uid), limit(25)),
    (snap) => onData(snapshotToCampaigns(snap)),
    (error) => onError?.(error)
  );

export const subscribeActiveCampaigns = (onData: (campaigns: Campaign[]) => void, onError?: (error: any) => void) =>
  onSnapshot(
    query(collection(db, 'campaigns'), where('status', '==', 'active'), limit(12)),
    (snap) => onData(snapshotToCampaigns(snap).filter((campaign) => isCampaignServable(campaign))),
    (error) => onError?.(error)
  );

export const subscribePendingCampaigns = (onData: (campaigns: Campaign[]) => void, onError?: (error: any) => void) =>
  onSnapshot(
    query(collection(db, 'campaigns'), where('status', '==', 'pending_review'), limit(50)),
    (snap) => onData(snapshotToCampaigns(snap)),
    (error) => onError?.(error)
  );

export const countLiveCampaigns = (campaigns: Campaign[]) =>
  campaigns.filter((campaign) => ['pending_review', 'active', 'paused'].includes(campaign.status)).length;

/** Firestore Timestamp | epoch millis | Date -> millis, or null if unusable. */
const toEpochMillis = (value: any): number | null => {
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

/**
 * May this campaign serve right now?
 *
 * `status: 'active'` alone is not enough, and that was the whole loophole:
 * status was set once at approval and never cleared, so a campaign bought on
 * a 7-day trial ran forever after the trial ended or the advertiser cancelled.
 *
 * Expiry is the authority. The scheduled sweep stamps expiresAt and flips
 * lapsed campaigns to 'ended'; this check keeps a lapsed ad out of rotation in
 * the hours between sweeps, on every surface that serves one.
 *
 * Fails CLOSED: a campaign with no stamp does not serve. An unstamped campaign
 * is precisely the shape the loophole took, so the safe default is off. Run
 * functions/backfill-campaign-expiry.mjs once when this ships to stamp the
 * campaigns that predate it.
 */
/**
 * When should this advertiser's campaign stop serving?
 *
 * This is a CLIENT-side estimate and is not trusted: the hourly sweep
 * re-clamps expiresAt back onto the real entitlement, and the create rule
 * bounds how far out it may be set at all. Its only job is to let a new
 * campaign serve straight away instead of waiting up to an hour for the
 * sweep to notice it exists.
 *
 * Mirrors the entitlement order in functions/src/campaignExpiry.ts.
 */
export const computeCampaignExpiryMs = async (
  uid: string,
  options: { isAdmin?: boolean } = {}
): Promise<number> => {
  const now = Date.now();
  const fallback = now + CAMPAIGN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (!uid) return fallback;

  // Admins run campaigns for free and hold no billing document, so the
  // entitlement lookups below would find nothing and read as "cancelled".
  if (options.isAdmin) return fallback;
  try {
    const ownerDoc = await getDoc(doc(db, 'users', uid));
    if (ownerDoc.exists() && (ownerDoc.data() as any)?.isAdmin === true) return fallback;
  } catch {
    // Fall through to the entitlement lookups.
  }

  // Web / Payonify: a prepaid term with a real end date.
  try {
    const web = await getDoc(doc(db, 'webSubscriptions', uid));
    if (web.exists()) {
      const campaigns = (web.data() as any)?.campaigns || {};
      const endsAt = toEpochMillis(campaigns.endsAt);
      if (String(campaigns.status || '').toLowerCase() === 'active' && endsAt != null && endsAt > now) {
        return endsAt;
      }
    }
  } catch {
    // Fall through to Play.
  }

  try {
    const account = await getDoc(doc(db, 'campaignAccounts', uid));
    if (account.exists()) {
      const data = account.data() as any;
      const known = toEpochMillis(data?.expiresAt ?? data?.entitlementEndsAt);
      if (known != null && known > now) return known;
      const trialEndsAt = toEpochMillis(data?.trialEndsAt);
      if (trialEndsAt != null && trialEndsAt > now) return trialEndsAt;
      if (String(data?.status || '').toLowerCase() === 'active') return fallback;
      // No plan at all: nothing to run on. The sweep ends it within the hour.
      return now;
    }
  } catch {
    // Fall through.
  }

  return fallback;
};

export const isCampaignServable = (campaign: Campaign | null | undefined, now: number = Date.now()): boolean => {
  if (!campaign) return false;
  if (campaign.status !== 'active') return false;
  const expiresAt = toEpochMillis(campaign.expiresAt);
  if (expiresAt == null) return false;
  return expiresAt > now;
};

const notifyCampaignAdmins = async (campaignId: string, ownerName: string, productName: string) => {
  try {
    const adminsSnap = await getDoc(doc(db, 'config', 'admins'));
    const adminUids: string[] = adminsSnap.data()?.uids || [];
    const campaignName = productName || 'Untitled';
    for (const adminUid of adminUids) {
      await addDoc(collection(db, 'notifications'), {
        userId: adminUid,
        fromId: campaignId,
        fromName: ownerName || 'An advertiser',
        fromPic: '',
        type: 'campaign_review',
        content: `submitted "${campaignName}" for review.`,
        campaignId,
        isRead: false,
        timestamp: serverTimestamp(),
      }).catch(() => {});
    }
  } catch {
    // config/admins may not exist — non-critical.
  }
};

const notifyCampaignOwner = async (
  ownerId: string,
  campaignId: string,
  status: 'active' | 'rejected',
  reviewNote: string = ''
) => {
  try {
    const campaignSnap = await getDoc(doc(db, 'campaigns', campaignId));
    const campaignName = campaignSnap.data()?.creative?.productName || campaignSnap.data()?.creative?.title || 'Your campaign';
    const content =
      status === 'active'
        ? `Your campaign "${campaignName}" has been approved and is now live!`
        : `Your campaign "${campaignName}" was not approved.${reviewNote ? ` Reason: ${reviewNote}` : ''}`;
    await addDoc(collection(db, 'notifications'), {
      userId: ownerId,
      fromId: 'linkup_admin',
      fromName: 'LINKUP',
      fromPic: '',
      type: status === 'active' ? 'campaign_approved' : 'campaign_rejected',
      content,
      campaignId,
      isRead: false,
      timestamp: serverTimestamp(),
    }).catch(() => {});
  } catch {
    // Notification failure must not block the status update.
  }
};

export const createCampaign = async (input: {
  ownerId: string;
  ownerName: string;
  ownerPic?: string;
  ownerOccupation?: string;
  ownerCity?: string;
  ownerCountry?: string;
  ownerVerified?: boolean;
  name: string;
  creative: CampaignCreative;
  industries: string[];
  placements: string[];
  planProductId?: string;
  /** Admins hold campaigns for free, with no billing document behind them. */
  isAdmin?: boolean;
}) => {
  const placements = (input.placements.length ? input.placements : ['ideas']).filter((placement) =>
    CAMPAIGN_PLACEMENT_OPTIONS.some((option) => option.id === placement && option.available)
  );
  const ref = await addDoc(collection(db, 'campaigns'), {
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    ownerPic: input.ownerPic || '',
    ownerOccupation: input.ownerOccupation || '',
    ownerCity: input.ownerCity || '',
    ownerCountry: input.ownerCountry || '',
    ownerVerified: !!input.ownerVerified,
    name: input.name.slice(0, 90),
    status: 'pending_review',
    placements: placements.length ? placements : ['ideas'],
    creative: input.creative,
    industries: input.industries.slice(0, 6),
    planProductId: input.planProductId || '',
    statsImpressions: 0,
    statsClicks: 0,
    reviewNote: '',
    // Stamped here so the campaign serves the moment it is approved rather
    // than waiting for the sweep. Not trusted - see computeCampaignExpiryMs.
    expiresAt: new Date(await computeCampaignExpiryMs(input.ownerId, { isAdmin: !!input.isAdmin })),
    expiresAtSource: 'client',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Notify admins and confirm to the sender.
  const productName = input.creative?.productName || input.creative?.title || input.name;
  await notifyCampaignAdmins(ref.id, input.ownerName, productName).catch(() => {});
  await addDoc(collection(db, 'notifications'), {
    userId: input.ownerId,
    fromId: 'linkup_admin',
    fromName: 'LINKUP',
    fromPic: '',
    type: 'system',
    content: `Your campaign "${productName}" was submitted for review. We'll notify you once it's approved.`,
    campaignId: ref.id,
    isRead: false,
    timestamp: serverTimestamp(),
  }).catch(() => {});

  return ref.id;
};

export const setCampaignStatus = async (
  campaignId: string,
  status: CampaignStatus,
  reviewNote: string = '',
  options: { revalidateExpiry?: boolean } = {}
) => {
  // Only admins may write expiresAt - the owner pause/resume path is limited
  // to status and updatedAt by the Firestore rules, so revalidation is opt-in
  // and only the moderation screen asks for it.
  let expiryPatch: Record<string, unknown> = {};
  if (options.revalidateExpiry) {
    try {
      const snap = await getDoc(doc(db, 'campaigns', campaignId));
      const ownerId = String(snap.data()?.ownerId || '');
      if (ownerId) {
        expiryPatch = {
          expiresAt: new Date(await computeCampaignExpiryMs(ownerId)),
          expiresAtSource: 'client',
        };
      }
    } catch {
      // Approval must not fail because the stamp could not be computed; the
      // sweep will set it within the hour.
    }
  }

  await updateDoc(doc(db, 'campaigns', campaignId), {
    status,
    ...(reviewNote ? { reviewNote: reviewNote.slice(0, 280) } : {}),
    ...expiryPatch,
    updatedAt: serverTimestamp(),
  });

  // Notify the campaign owner on accept/reject.
  if (status === 'active' || status === 'rejected') {
    try {
      const campaignSnap = await getDoc(doc(db, 'campaigns', campaignId));
      const ownerId = campaignSnap.data()?.ownerId;
      if (ownerId) {
        await notifyCampaignOwner(ownerId, campaignId, status, reviewNote);
      }
    } catch {
      // Best-effort — owner notification must not block moderation.
    }
  }
};

/** Owner edits while the campaign is still in review — stats, ownership and
 * the pending status are untouchable (rules enforce it too). */
export const updateCampaignCreative = async (
  campaignId: string,
  patch: {
    name: string;
    creative: CampaignCreative;
    industries: string[];
    placements: string[];
  }
) => {
  const placements = (patch.placements.length ? patch.placements : ['ideas']).filter((placement) =>
    CAMPAIGN_PLACEMENT_OPTIONS.some((option) => option.id === placement && option.available)
  );
  await updateDoc(doc(db, 'campaigns', campaignId), {
    name: patch.name.slice(0, 90),
    creative: patch.creative,
    industries: patch.industries.slice(0, 6),
    placements: placements.length ? placements : ['ideas'],
    updatedAt: serverTimestamp(),
  });
};

/**
 * Admin check with three independent paths:
 *   0. Founder allowlist by email (see lib/admin.ts) — instant, offline-safe,
 *      and immune to a missing Firestore flag. Pass `{ email, isAdmin }` when
 *      the caller already has the signed-in identity to skip the round trips.
 *   1. config/admins — the console-managed `uids` array.
 *   2. users/{uid}.isAdmin === true, or the user doc's email on the allowlist.
 * Each path owns its own try/catch so a failed read on one never masks the
 * other, and neither can throw out of this function.
 */
export const isCampaignAdmin = async (uid: string, identity?: AdminIdentity) => {
  if (isAdminIdentity(identity)) return true;
  if (!uid) return false;

  try {
    const snap = await getDoc(doc(db, 'config', 'admins'));
    const uids = snap.data()?.uids;
    if (Array.isArray(uids) && uids.includes(uid)) return true;
  } catch {
    // Missing doc, permission denied, offline — fall through to the user doc.
  }

  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    const data = userSnap.data();
    if (data?.isAdmin === true || isAdminEmail(data?.email)) return true;
  } catch {
    // Fall through — not an admin.
  }

  return false;
};

// ---------------------------------------------------------------------------
// Serving — viewer-side. This is where the anti-abuse guarantees live.
// ---------------------------------------------------------------------------

export type SponsoredIdeaDeckItem = IdeaDeckItem & {
  sponsored: true;
  campaignId: string;
  website?: string;
  house?: boolean;
  /** Advertiser logo for the sponsored card. Empty for the house promo. */
  logo?: string;
  /** The advertiser's own one-liner, when they wrote one. Drives every
   *  sponsored surface through `sponsorOneLiner`. */
  tagline?: string;
};

export const normalizeWebsite = (value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
};

export const websiteDisplay = (value: string) =>
  normalizeWebsite(value).replace(/^https?:\/\//i, '').replace(/\/+$/, '').slice(0, 40);

/**
 * Should this viewer be shielded from sponsored placements?
 *
 * PLUS members are ad-free — with exactly one exception: the founder/admin
 * accounts. You cannot review, price or QA an ad product you are not allowed
 * to see, so allowlisted owners get the sponsored slots a normal PLUS
 * subscriber is shielded from. Ordinary PLUS members are unaffected, and the
 * entitlement checks (budget, paywall, features) never read this.
 */
export const isSponsoredHiddenForViewer = (profile: any, identity?: AdminIdentity): boolean =>
  hasLinkupPro(profile) && !isAdminIdentity(identity);

/**
 * ONE scannable line: what the product actually does.
 *
 * Every sponsored surface — swipe deck, scroll feed, idea deck — shows this
 * and only this. The creative description is a paragraph, and stopping to
 * read a paragraph costs the swipe its rhythm, so the card carries a single
 * line instead.
 *
 * The advertiser's own tagline wins when they wrote one; otherwise we take
 * the first sentence of the description and hard-cap the length so the line
 * can never wrap into a second one.
 */
export const sponsorOneLiner = (
  item?: { tagline?: string; description?: string } | null,
  maxChars: number = 92
): string => {
  const raw = String(item?.tagline || item?.description || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const firstSentence = (raw.split(/[.!?]\s/)[0] || '').trim() || raw;
  return firstSentence.length > maxChars
    ? `${firstSentence.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
    : firstSentence;
};

const campaignViewsToday = async (uid: string, campaignId: string) => {
  const raw = await AsyncStorage.getItem(seenKey(uid, campaignId));
  const count = Number.parseInt(String(raw || '0'), 10);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
};

export const toSponsoredItem = (campaign: Campaign): SponsoredIdeaDeckItem => {
  const creative = campaign.creative;
  const isProduct = creative.source === 'product';
  return {
    id: `sponsored_${campaign.id}`,
    campaignId: campaign.id,
    sponsored: true,
    house: false,
    website: isProduct ? normalizeWebsite(creative.website || '') : '',
    logo: creative.logoUrl || '',
    title: (isProduct ? creative.productName : creative.title) || 'Sponsored',
    description: (isProduct ? creative.tagline : creative.description) || creative.description || '',
    tagline: creative.tagline || '',
    stage: isProduct ? 'Product' : creative.stage || 'Idea Stage',
    lookingFor: Array.isArray(creative.lookingFor) ? creative.lookingFor : isProduct ? ['Customers', 'Feedback'] : [],
    tags: Array.isArray(creative.category) && creative.category.length
      ? creative.category
      : Array.isArray(creative.tags)
        ? creative.tags
        : [],
    ownerId: campaign.ownerId,
    ownerName: campaign.ownerName || 'Sponsor',
    ownerPic: campaign.ownerPic || '',
    ownerOccupation: campaign.ownerOccupation || '',
    ownerCity: campaign.ownerCity || '',
    ownerCountry: campaign.ownerCountry || '',
    ownerVerified: !!campaign.ownerVerified,
    source: 'startupIdea',
  };
};

/**
 * Our own promo, drawn when paid inventory is empty.
 *
 * Linky is the face of it. "Go PLUS" sold a feature list; this sells the
 * character - a first-person line from the assistant free members cannot
 * talk to yet. Tapping it opens the paywall (see the `house` flag).
 */
export const buildHouseIdeaCard = (): SponsoredIdeaDeckItem => ({
  id: `sponsored_${HOUSE_PLUS_CAMPAIGN_ID}`,
  campaignId: HOUSE_PLUS_CAMPAIGN_ID,
  sponsored: true,
  house: true,
  website: '',
  logo: '',
  title: 'Linky found people for you',
  description: "I've read every builder here. Unlock me and I'll introduce you to the ones who fit.",
  tagline: "I've read every builder here. Unlock me and I'll introduce you to the ones who fit.",
  stage: 'PLUS',
  lookingFor: [],
  tags: ['LINKY', 'PLUS'],
  ownerId: 'linkup',
  ownerName: 'Linky AI',
  ownerPic: '',
  ownerOccupation: 'Your AI networking assistant',
  ownerCity: '',
  ownerCountry: '',
  ownerVerified: true,
  source: 'startupIdea',
});

export const sponsoredIdeaCardsForViewer = async (
  campaigns: Campaign[],
  viewerUid: string,
  viewerIsPlus: boolean = false
): Promise<SponsoredIdeaDeckItem[]> => {
  // NOT pre-filtered by the daily impression cap. Recording an impression
  // writes to the campaign doc, which re-fires the listener, which rebuilt
  // this list with the cap applied - so after two views of each campaign
  // every paid ad dropped out and the deck only ever showed the house promo.
  // That is the "only one ad" symptom. The cap still throttles impression
  // STATS inside recordCampaignImpression; it no longer decides what you see.
  const eligible = campaigns.filter(
    (campaign) => !!campaign?.creative && campaign.ownerId !== viewerUid // never advertise to yourself
  );
  if (!eligible.length) {
    // House ads fill unsold inventory — but ONLY for people who have not
    // already bought PLUS. Showing "Go PLUS — unlimited swipes" to someone
    // who is paying for PLUS reads as a broken app, and an empty slot is
    // strictly better than upselling a subscriber.
    if (viewerIsPlus) return [];
    return [buildHouseIdeaCard()];
  }
  // Per-viewer rotation: each rebuild of the deck starts one campaign further
  // round, so the 4th card is a different ad each time. The old "daily"
  // rotation was a single index derived from the date - every viewer saw the
  // same first ad all day, and with two campaigns that read as "only one ad".
  const rotated = await rotateCampaignsForViewer(eligible, viewerUid, 'ideas');
  return rotated.map(toSponsoredItem);
};

// ---------------------------------------------------------------------------
// Rotation.
//
// THE BUG THIS REPLACES: every single-slot surface (search, hub, news, play)
// asked for `limit 1` of an equality query with no orderBy. Firestore answers
// that in document-id order, so with two live campaigns the same doc came
// back first on every fetch, on every screen, for every viewer, forever. The
// second ad was live, stamped and eligible - and never got a single slot.
//
// Now every fetch walks a shared, persisted rotation cursor. Each surface
// asks for the NEXT campaign, so the ad changes every time a slot is filled:
// open Search -> ad A, open Hub -> ad B, back to Search -> ad A, and so on.
// The cursor lives in AsyncStorage so it survives restarts, and it is per
// viewer so two people on one device do not share a position.
// ---------------------------------------------------------------------------

const rotationKey = (uid: string, scope: string) => `linkup:campaign-rotation:${uid || 'anonymous'}:${scope}`;

/** In-memory mirror of the cursor so back-to-back fills never race the disk. */
const rotationMemo: Record<string, number> = {};

const readRotationCursor = async (key: string): Promise<number> => {
  if (rotationMemo[key] != null) return rotationMemo[key];
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = Number.parseInt(String(raw || '0'), 10);
    const value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    rotationMemo[key] = value;
    return value;
  } catch {
    return rotationMemo[key] || 0;
  }
};

const writeRotationCursor = (key: string, value: number) => {
  rotationMemo[key] = value;
  AsyncStorage.setItem(key, String(value)).catch(() => {});
};

/**
 * Cursor reads and advances are serialised. Home mounts three slots at once
 * (hub strip, picks, projects); without this they all read the same cursor
 * before any of them advanced it and showed the same ad three times.
 */
let rotationChain: Promise<unknown> = Promise.resolve();
const withRotationLock = <T,>(fn: () => Promise<T>): Promise<T> => {
  const run = rotationChain.then(fn, fn);
  rotationChain = run.catch(() => undefined);
  return run;
};

/** Stable order for the pool so the cursor means the same thing every time. */
const sortForRotation = (campaigns: Campaign[]) => [...campaigns].sort((a, b) => a.id.localeCompare(b.id));

/**
 * Rotate `campaigns` so the viewer's next ad comes first and advance the
 * cursor by `advanceBy` (default: one). Every eligible campaign therefore
 * heads the list in turn; a surface that shows one ad shows a different one
 * each time it loads, and a surface that shows several starts each load one
 * step further round.
 *
 * `scope` separates cursors that should not interfere - the discover deck
 * cycles on its own so a Search visit does not skip the deck ahead.
 */
export const rotateCampaignsForViewer = (
  campaigns: Campaign[],
  viewerUid: string,
  scope: string = 'global',
  advanceBy: number = 1
): Promise<Campaign[]> =>
  withRotationLock(async () => {
    const pool = sortForRotation(campaigns);
    if (pool.length <= 1) return pool;
    const key = rotationKey(viewerUid, scope);
    const cursor = (await readRotationCursor(key)) % pool.length;
    writeRotationCursor(key, (cursor + Math.max(1, advanceBy)) % pool.length);
    return [...pool.slice(cursor), ...pool.slice(0, cursor)];
  });

/** Peek at the rotation without advancing it (for previews / stable re-renders). */
export const peekRotatedCampaigns = async (
  campaigns: Campaign[],
  viewerUid: string,
  scope: string = 'global'
): Promise<Campaign[]> => {
  const pool = sortForRotation(campaigns);
  if (pool.length <= 1) return pool;
  const cursor = (await readRotationCursor(rotationKey(viewerUid, scope))) % pool.length;
  return [...pool.slice(cursor), ...pool.slice(0, cursor)];
};

/** Several slots mount together; share one read for a few seconds. */
const SERVABLE_CACHE_MS = 15_000;
let servableCache: { at: number; rows: Campaign[] } | null = null;

/** Every servable campaign, unfiltered by placement. One Firestore read. */
export const fetchServableCampaigns = async (): Promise<Campaign[]> => {
  const now = Date.now();
  if (servableCache && now - servableCache.at < SERVABLE_CACHE_MS) {
    // Re-check expiry on the cached rows: a campaign can lapse mid-cache.
    return servableCache.rows.filter((campaign) => isCampaignServable(campaign, now));
  }
  try {
    const snap = await getDocs(query(collection(db, 'campaigns'), where('status', '==', 'active'), limit(24)));
    const rows = snap.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }) as Campaign)
      .filter((campaign) => isCampaignServable(campaign, now) && !!campaign.creative);
    servableCache = { at: now, rows };
    return rows;
  } catch {
    return servableCache?.rows.filter((campaign) => isCampaignServable(campaign, now)) || [];
  }
};

/**
 * Any active campaign, regardless of placement targeting.
 *
 * THIN-INVENTORY FALLBACK ONLY. If a surface has no advertiser who actually
 * bought its placement, it shows the next best thing rather than an empty
 * slot — otherwise a new placement (news, play) looks broken until someone
 * happens to tick that box. It is never used to pad a surface that does have
 * targeted inventory, and it should be deleted once inventory is healthy.
 *
 * Rotates: pass `viewerUid` and each call starts one campaign further round.
 */
export const fetchAnyActiveCampaigns = async (max: number = 1, viewerUid: string = ''): Promise<Campaign[]> => {
  const pool = await fetchServableCampaigns();
  const rotated = await rotateCampaignsForViewer(pool, viewerUid, 'global');
  return rotated.slice(0, max);
};

/**
 * One-shot fetch of active campaigns serving a given placement (search, hub,
 * linky, news, play). Rotates per viewer so a single-slot surface shows a
 * different campaign on each load rather than the first document forever.
 */
export const fetchActiveCampaignsForPlacement = async (
  placement: string,
  max: number = 3,
  viewerUid: string = ''
): Promise<Campaign[]> => {
  const pool = (await fetchServableCampaigns()).filter(
    (campaign) => Array.isArray(campaign.placements) && campaign.placements.includes(placement)
  );
  const rotated = await rotateCampaignsForViewer(pool, viewerUid, 'global');
  return rotated.slice(0, max);
};

/**
 * The one call every single-slot surface should make.
 *
 * Targeted inventory first, thin-inventory fallback second, never the
 * viewer's own campaign, always the next one in rotation. Returns null when
 * there is genuinely nothing to show. Records the impression for you.
 */
export const pickSponsoredCampaign = async (
  placement: string,
  viewerUid: string,
  options: { recordImpression?: boolean } = {}
): Promise<Campaign | null> => {
  if (!viewerUid) return null;
  const all = await fetchServableCampaigns();
  const notMine = all.filter((campaign) => campaign.ownerId !== viewerUid);
  const targeted = notMine.filter(
    (campaign) => Array.isArray(campaign.placements) && campaign.placements.includes(placement)
  );
  const pool = targeted.length ? targeted : notMine;
  if (!pool.length) return null;
  const [next] = await rotateCampaignsForViewer(pool, viewerUid, 'global');
  if (next && options.recordImpression !== false) void recordCampaignImpression(next.id, viewerUid);
  return next || null;
};

/** How often a mounted single-slot surface swaps to the next campaign. */
export const SPONSORED_SLOT_ROTATE_MS = 45_000;

/**
 * Several campaigns for a multi-slot surface - the News feed weaves one in
 * every few stories. Rotated per viewer exactly like pickSponsoredCampaign,
 * then cycled so all `count` slots are filled even when inventory is thin:
 * two live campaigns fill ten slots as A, B, A, B, ... and the next load
 * starts one step further round. Impressions are recorded once per distinct
 * campaign (and are still capped per viewer per day inside
 * recordCampaignImpression).
 */
export const pickSponsoredCampaigns = async (
  placement: string,
  viewerUid: string,
  count: number,
  options: { recordImpression?: boolean } = {}
): Promise<Campaign[]> => {
  if (!viewerUid || count <= 0) return [];
  const all = await fetchServableCampaigns();
  const notMine = all.filter((campaign) => campaign.ownerId !== viewerUid);
  const targeted = notMine.filter(
    (campaign) => Array.isArray(campaign.placements) && campaign.placements.includes(placement)
  );
  const pool = targeted.length ? targeted : notMine;
  if (!pool.length) return [];
  const rotated = await rotateCampaignsForViewer(pool, viewerUid, 'global');
  const out: Campaign[] = [];
  for (let i = 0; i < count; i++) out.push(rotated[i % rotated.length]);
  if (options.recordImpression !== false) {
    rotated.slice(0, Math.min(rotated.length, count)).forEach((campaign) => {
      void recordCampaignImpression(campaign.id, viewerUid);
    });
  }
  return out;
};

/**
 * Weave `ads` into `rows`: the first ad after `firstAfter` rows, then one
 * after every `every` rows, until the ads run out. Pure, so the News feed's
 * layout can be tested without React.
 */
export const interleaveSponsored = <R, A>(
  rows: R[],
  ads: A[],
  every: number,
  firstAfter: number = every
): Array<{ kind: 'row'; row: R } | { kind: 'ad'; ad: A; slot: number }> => {
  const out: Array<{ kind: 'row'; row: R } | { kind: 'ad'; ad: A; slot: number }> = [];
  let adIndex = 0;
  let sinceAd = 0;
  let nextAt = Math.max(1, firstAfter);
  rows.forEach((row) => {
    out.push({ kind: 'row', row });
    sinceAd += 1;
    if (sinceAd >= nextAt && adIndex < ads.length) {
      out.push({ kind: 'ad', ad: ads[adIndex], slot: adIndex });
      adIndex += 1;
      sinceAd = 0;
      nextAt = Math.max(1, every);
    }
  });
  return out;
};

export const injectSponsored = (organic: IdeaDeckItem[], sponsored: IdeaDeckItem[], interval: number = SPONSORED_INTERVAL): IdeaDeckItem[] => {
  if (!sponsored.length) return organic;
  const merged = [...organic];
  sponsored.forEach((item, index) => {
    const position = Math.min(interval - 1 + index * interval, merged.length);
    if (!merged.some((entry) => entry.id === item.id)) {
      merged.splice(position, 0, item);
    }
  });
  return merged;
};

export const recordCampaignImpression = async (campaignId: string, viewerUid: string) => {
  if (!campaignId) return;
  const views = await campaignViewsToday(viewerUid, campaignId).catch(() => 0);
  if (views >= CAMPAIGN_IMPRESSION_DAILY_CAP) return;
  // House promos count against the same per-day cap locally, but write nothing
  // to Firestore (there is no campaign doc behind them).
  await AsyncStorage.setItem(seenKey(viewerUid, campaignId), String(views + 1)).catch(() => {});
  if (campaignId.startsWith('house_')) return;
  updateDoc(doc(db, 'campaigns', campaignId), { statsImpressions: increment(1) }).catch(() => {});
};

export const recordCampaignClick = async (campaignId: string, viewerUid?: string) => {
  if (!campaignId || campaignId.startsWith('house_')) return;
  const key = clickedKey(viewerUid || 'anonymous', campaignId);
  const already = await AsyncStorage.getItem(key).catch(() => null);
  if (already) return;
  await AsyncStorage.setItem(key, '1').catch(() => {});
  updateDoc(doc(db, 'campaigns', campaignId), { statsClicks: increment(1) }).catch(() => {});
};

export const campaignStatusMeta = (status: CampaignStatus | string): { label: string; color: string; bg: string } => {
  switch (status) {
    case 'active':
      return { label: 'Live', color: '#16A34A', bg: 'rgba(22,163,74,0.14)' };
    case 'paused':
      return { label: 'Paused', color: '#B45309', bg: 'rgba(245,158,11,0.16)' };
    case 'pending_review':
      return { label: 'In Review', color: '#2563EB', bg: 'rgba(37,99,235,0.12)' };
    case 'rejected':
      return { label: 'Rejected', color: '#DC2626', bg: 'rgba(220,38,38,0.12)' };
    case 'ended':
    default:
      return { label: 'Ended', color: '#6B7280', bg: 'rgba(107,114,128,0.14)' };
  }
};
