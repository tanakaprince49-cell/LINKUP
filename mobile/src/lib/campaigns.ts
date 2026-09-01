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
 * No web shortcut: on web the plan is bought through ContiPay and lives in
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
export const computeCampaignExpiryMs = async (uid: string): Promise<number> => {
  const now = Date.now();
  const fallback = now + CAMPAIGN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (!uid) return fallback;

  // Web / ContiPay: a prepaid term with a real end date.
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
    expiresAt: new Date(await computeCampaignExpiryMs(input.ownerId)),
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

/** Our own PLUS promo, drawn when paid inventory is empty. */
export const buildHouseIdeaCard = (): SponsoredIdeaDeckItem => ({
  id: `sponsored_${HOUSE_PLUS_CAMPAIGN_ID}`,
  campaignId: HOUSE_PLUS_CAMPAIGN_ID,
  sponsored: true,
  house: true,
  website: '',
  logo: '',
  title: 'Go PLUS',
  description: 'Unlimited swipes & rewinds, Who Viewed You, advanced search and zero sponsored cards.',
  stage: 'PLUS',
  lookingFor: [],
  tags: ['PLUS', 'UNLIMITED'],
  ownerId: 'linkup',
  ownerName: 'LinkUp',
  ownerPic: '',
  ownerOccupation: 'Membership',
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
  const eligible: Campaign[] = [];
  for (const campaign of campaigns) {
    if (!campaign?.creative) continue;
    if (campaign.ownerId === viewerUid) continue; // never advertise to yourself
    const views = await campaignViewsToday(viewerUid, campaign.id).catch(() => 0);
    if (views >= CAMPAIGN_IMPRESSION_DAILY_CAP) continue;
    eligible.push(campaign);
  }
  if (!eligible.length) {
    // House ads fill unsold inventory — but ONLY for people who have not
    // already bought PLUS. Showing "Go PLUS — unlimited swipes" to someone
    // who is paying for PLUS reads as a broken app, and an empty slot is
    // strictly better than upselling a subscriber.
    if (viewerIsPlus) return [];
    return [buildHouseIdeaCard()];
  }
  if (eligible.length > 1) {
    // Daily rotation gives every active campaign a fair share of first slot.
    const dayIndex = Math.floor(Date.now() / 86400000) % eligible.length;
    return [...eligible.slice(dayIndex), ...eligible.slice(0, dayIndex)].map(toSponsoredItem);
  }
  return eligible.map(toSponsoredItem);
};

/**
 * Any active campaign, regardless of placement targeting.
 *
 * THIN-INVENTORY FALLBACK ONLY. If a surface has no advertiser who actually
 * bought its placement, it shows the next best thing rather than an empty
 * slot — otherwise a new placement (news, play) looks broken until someone
 * happens to tick that box. It is never used to pad a surface that does have
 * targeted inventory, and it should be deleted once inventory is healthy.
 */
export const fetchAnyActiveCampaigns = async (max: number = 1): Promise<Campaign[]> => {
  try {
    const snap = await getDocs(query(collection(db, 'campaigns'), where('status', '==', 'active'), limit(12)));
    return snap.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }) as Campaign)
      .filter((campaign) => isCampaignServable(campaign))
      .slice(0, max);
  } catch {
    return [];
  }
};

/** One-shot fetch of active campaigns serving a given placement (search, hub, linky). */
export const fetchActiveCampaignsForPlacement = async (placement: string, max: number = 3): Promise<Campaign[]> => {
  try {
    const snap = await getDocs(query(collection(db, 'campaigns'), where('status', '==', 'active'), limit(12)));
    return snap.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }) as Campaign)
      .filter((campaign) => isCampaignServable(campaign))
      .filter((campaign) => Array.isArray(campaign.placements) && campaign.placements.includes(placement))
      .slice(0, max);
  } catch {
    return [];
  }
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
