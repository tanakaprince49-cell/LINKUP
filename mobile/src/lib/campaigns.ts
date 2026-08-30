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

export const LINKUP_CAMPAIGNS_PRODUCT_ID = 'linkup_campaigns_monthly';
export const LINKUP_CAMPAIGNS_YEARLY_PRODUCT_ID = 'linkup_campaigns_yearly';
export const LINKUP_CAMPAIGNS_MONTHLY_PRICE = formatUsd(CAMPAIGNS_PRICES.monthly);
export const LINKUP_CAMPAIGNS_YEARLY_PRICE = formatUsd(CAMPAIGNS_PRICES.yearly);
export const CAMPAIGNS_PRODUCT_IDS = [LINKUP_CAMPAIGNS_PRODUCT_ID, LINKUP_CAMPAIGNS_YEARLY_PRODUCT_ID];

/** Max campaigns a subscriber may have in a live-ish state at once. */
export const MAX_ACTIVE_CAMPAIGNS = 3;
/** One viewer sees the same campaign at most this many times per day. */
export const CAMPAIGN_IMPRESSION_DAILY_CAP = 2;
/** One sponsored card per N organic cards in the deck. */
export const SPONSORED_INTERVAL = 10;

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
 * No web shortcut: on web the plan is bought through Paynow and lives in
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
    (snap) => onData(snapshotToCampaigns(snap)),
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
};

export const setCampaignStatus = async (campaignId: string, status: CampaignStatus, reviewNote: string = '') => {
  await updateDoc(doc(db, 'campaigns', campaignId), {
    status,
    ...(reviewNote ? { reviewNote: reviewNote.slice(0, 280) } : {}),
    updatedAt: serverTimestamp(),
  });
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
};

export const normalizeWebsite = (value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
};

export const websiteDisplay = (value: string) =>
  normalizeWebsite(value).replace(/^https?:\/\//i, '').replace(/\/+$/, '').slice(0, 40);

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

export const sponsoredIdeaCardsForViewer = async (campaigns: Campaign[], viewerUid: string): Promise<SponsoredIdeaDeckItem[]> => {
  const eligible: Campaign[] = [];
  for (const campaign of campaigns) {
    if (!campaign?.creative) continue;
    if (campaign.ownerId === viewerUid) continue; // never advertise to yourself
    const views = await campaignViewsToday(viewerUid, campaign.id).catch(() => 0);
    if (views >= CAMPAIGN_IMPRESSION_DAILY_CAP) continue;
    eligible.push(campaign);
  }
  if (!eligible.length) {
    // House ads: unsold inventory promotes PLUS instead of going dark.
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
    return snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as Campaign).slice(0, max);
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
