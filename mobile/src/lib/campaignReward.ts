// Builder League weekly champion reward — client reads its own reward from the
// server (Firestore rules deny every client write) and claims it once.
import { builderCall } from './builder';

export type CampaignRewardState = {
  status: 'none' | 'available' | 'claimed' | 'completed' | 'expired' | 'no-winner';
  rewardId?: string;
  weekKey?: string;
  points?: number;
  buildDays?: number;
  helpful?: number;
  claimBy?: number;
  claimedAt?: number;
  activationDeadline?: number;
  runDays: number;
  placementsMax: number;
  remainingMs: number;
  campaign: null | {
    id: string;
    status: string;
    name: string;
    rewardStartedAt: number;
    expiresAt: number;
  };
};

export const fetchCampaignReward = () => builderCall('campaignReward') as Promise<CampaignRewardState>;

export const claimCampaignReward = (input: {
  weekKey: string;
  name: string;
  creative: {
    source: 'product';
    productName: string;
    tagline: string;
    description: string;
    website: string;
    logoUrl?: string;
    category?: string[];
  };
  industries: string[];
  placements: string[];
}) => builderCall('campaignRewardClaim', input) as Promise<{ campaignId: string; activationDeadline: number; runDays: number }>;

export const rewardWhen = (ms?: number) => {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date(ms).toISOString();
  }
};

/** One honest line per state. No extensions are ever promised here. */
export function rewardHeadline(reward: CampaignRewardState | null): string {
  if (!reward || reward.status === 'none') return '';
  if (reward.status === 'available') return `You won the week of ${reward.weekKey}. Claim one campaign for exactly seven days.`;
  if (reward.status === 'claimed') {
    const campaign = reward.campaign;
    if (!campaign) return 'Reward used.';
    if (campaign.status === 'active') return `Live until ${rewardWhen(campaign.expiresAt)}. It is deleted permanently after that.`;
    if (campaign.status === 'pending_review') return `In review. It runs seven days from approval or is removed by ${rewardWhen(reward.activationDeadline)}.`;
    if (campaign.status === 'rejected') return 'The campaign was not approved. The reward cannot be re-issued.';
    return 'Reward campaign ended.';
  }
  if (reward.status === 'expired') return 'The seven-day claim window closed. This reward is locked.';
  return 'This reward is finished and cannot be claimed again.';
}
