import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addDoc,
  collection,
  doc,
  getDoc,
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
export const LINKUP_CAMPAIGNS_MONTHLY_PRICE = '$29.99';
export const LINKUP_CAMPAIGNS_YEARLY_PRICE = '$249.99';
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

export type CampaignStatus = 'pending_review' | 'active' | 'paused' | 'rejected' | 'ended';

export type CampaignCreative = {
  source: 'idea';
  ideaId: string;
  title: string;
  description: string;
  stage: string;
  lookingFor: string[];
  tags: string[];
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

export const hasCampaignsPlan = (account: CampaignsAccount | null | undefined) => {
  if (Platform.OS === 'web') return true;
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
  planProductId?: string;
}) => {
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
    placements: ['ideas'],
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

export const isCampaignAdmin = async (uid: string) => {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, 'config', 'admins'));
    const uids = snap.data()?.uids;
    return Array.isArray(uids) && uids.includes(uid);
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Serving — viewer-side. This is where the anti-abuse guarantees live.
// ---------------------------------------------------------------------------

export type SponsoredIdeaDeckItem = IdeaDeckItem & { sponsored: true; campaignId: string };

const campaignViewsToday = async (uid: string, campaignId: string) => {
  const raw = await AsyncStorage.getItem(seenKey(uid, campaignId));
  const count = Number.parseInt(String(raw || '0'), 10);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
};

const toSponsoredItem = (campaign: Campaign): SponsoredIdeaDeckItem => ({
  id: `sponsored_${campaign.id}`,
  campaignId: campaign.id,
  sponsored: true,
  title: campaign.creative.title,
  description: campaign.creative.description,
  stage: campaign.creative.stage || 'Idea Stage',
  lookingFor: Array.isArray(campaign.creative.lookingFor) ? campaign.creative.lookingFor : [],
  tags: Array.isArray(campaign.creative.tags) ? campaign.creative.tags : [],
  ownerId: campaign.ownerId,
  ownerName: campaign.ownerName || 'Sponsor',
  ownerPic: campaign.ownerPic || '',
  ownerOccupation: campaign.ownerOccupation || '',
  ownerCity: campaign.ownerCity || '',
  ownerCountry: campaign.ownerCountry || '',
  ownerVerified: !!campaign.ownerVerified,
  source: 'startupIdea',
});

export const sponsoredIdeaCardsForViewer = async (campaigns: Campaign[], viewerUid: string): Promise<SponsoredIdeaDeckItem[]> => {
  const eligible: Campaign[] = [];
  for (const campaign of campaigns) {
    if (!campaign?.creative?.title) continue;
    if (campaign.ownerId === viewerUid) continue; // never advertise to yourself
    const views = await campaignViewsToday(viewerUid, campaign.id).catch(() => 0);
    if (views >= CAMPAIGN_IMPRESSION_DAILY_CAP) continue;
    eligible.push(campaign);
  }
  if (eligible.length > 1) {
    // Daily rotation gives every active campaign a fair share of first slot.
    const dayIndex = Math.floor(Date.now() / 86400000) % eligible.length;
    return [...eligible.slice(dayIndex), ...eligible.slice(0, dayIndex)].map(toSponsoredItem);
  }
  return eligible.map(toSponsoredItem);
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
  await AsyncStorage.setItem(seenKey(viewerUid, campaignId), String(views + 1)).catch(() => {});
  updateDoc(doc(db, 'campaigns', campaignId), { statsImpressions: increment(1) }).catch(() => {});
};

export const recordCampaignClick = async (campaignId: string, viewerUid?: string) => {
  if (!campaignId) return;
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
