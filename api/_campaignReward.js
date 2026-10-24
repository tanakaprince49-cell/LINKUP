// Server-owned Builder League reward. The client can read its own reward and
// claim it once; every write that matters (granting, stamping, deleting) is
// done here with the Admin SDK so a crafted request cannot mint a campaign.
import { awardWeek, chooseChampion, claimDeadline, rewardState, runDeadline, REWARD, toMs, DAY_MS } from '../shared/campaign-reward.js';
import { loadActivityLeague } from './_leagueSeo.js';
import { clean, problem } from './_builderCore.js';
import { isGoldMember } from '../shared/member-badges.js';

export const REWARD_COLLECTION = 'campaignRewards';
export const REWARD_AUDIT = 'campaignRewardsAudit';
const PLACEMENTS = new Set(['ideas', 'search', 'hub', 'linky', 'discover', 'news', 'feed', 'picks', 'projects', 'daily']);

const httpsUrl = value => {
  const raw = clean(value, 2048);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
};

/** Creative limits match the normal campaign form, minus everything a reward
 *  does not need. No creative text is ever returned by the read op. */
function creativeOf(input = {}) {
  const name = clean(input.name, 90);
  if (name.length < 3) throw problem('Give your campaign a name of at least 3 characters.');
  if (!input.creative || typeof input.creative !== 'object') throw problem('Add the product details for your campaign.');
  const productName = clean(input.creative.productName, 60);
  const tagline = clean(input.creative.tagline, 90);
  const description = clean(input.creative.description, 500);
  const website = httpsUrl(input.creative.website);
  if (productName.length < 2) throw problem('Add the product or project name.');
  if (tagline.length < 8) throw problem('Add a one-line description of at least 8 characters.');
  if (!website) throw problem('Add the product website as a secure https:// link.');
  const placements = [...new Set(Array.isArray(input.placements) ? input.placements : [])]
    .filter(id => PLACEMENTS.has(id)).slice(0, REWARD.placementsMax);
  if (!placements.length) throw problem('Choose one or two placements for the campaign.');
  const industries = [...new Set(Array.isArray(input.industries) ? input.industries : [])]
    .map(v => clean(v, 40)).filter(Boolean).slice(0, 8);
  return {
    name,
    placements,
    industries,
    creative: {
      source: 'product',
      productName,
      tagline,
      description,
      website,
      logoUrl: httpsUrl(input.creative.logoUrl),
      category: industries,
    },
  };
}

/**
 * Grant last week's champion exactly one reward. Idempotent: the document id is
 * the week key, so a cron re-run can never mint a second campaign.
 */
export async function awardWeeklyChampion(db, now = Date.now()) {
  const { end, weekKey } = awardWeek(now);
  const ref = db.collection(REWARD_COLLECTION).doc(weekKey);
  const existing = await ref.get();
  if (existing.exists) return { weekKey, skipped: true, status: existing.data().status };
  const board = await loadActivityLeague(db, { period: 'week', at: end - 1 });
  const champion = chooseChampion(board.rows || []);
  const base = {
    weekKey,
    weekStart: end - 7 * DAY_MS,
    weekEnd: end,
    awardedAt: now,
    claimBy: claimDeadline(end),
    participants: Number(board.participants) || 0,
    runDays: REWARD.runDays,
    placementsMax: REWARD.placementsMax,
  };
  let granted = false;
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (current.exists) return;
    tx.set(ref, champion
      ? { ...base, uid: champion.uid, points: champion.points, buildDays: champion.buildDays, helpful: champion.helpful, status: 'available' }
      : { ...base, status: 'no-winner' });
    granted = !!champion;
  });
  // A week with no recorded public activity has no champion. That is a real
  // answer, not a failure, and the marker stops the cron retrying it forever.
  return { weekKey, granted, participants: base.participants };
}

const campaignSummary = (id, data) => ({
  id,
  status: clean(data.status, 20),
  name: clean(data.name, 90),
  rewardWeek: clean(data.rewardWeek, 20),
  rewardStartedAt: toMs(data.rewardStartedAt),
  expiresAt: toMs(data.expiresAt),
});

/** What the campaign page shows for this member. */
export async function readCampaignReward(db, uid, now = Date.now()) {
  // No composite index needed: a member can only hold a handful of rewards, so
  // read the latest few and pick the newest week in code.
  const snap = await db.collection(REWARD_COLLECTION).where('uid', '==', uid).limit(10).get();
  const doc = snap.docs.sort((a, b) => String(b.data().weekKey || '').localeCompare(String(a.data().weekKey || '')))[0];
  if (!doc) return rewardState(null, null, now);
  const reward = doc.data();
  let campaign = null;
  if (reward.campaignId) {
    const ref = await db.collection('campaigns').doc(String(reward.campaignId)).get();
    if (ref.exists) campaign = campaignSummary(ref.id, ref.data());
  }
  return { ...rewardState(reward, campaign, now), rewardId: doc.id };
}

/**
 * Claim: creates ONE pending campaign owned by the member. Nothing here can
 * extend the run - the seven-day clock is stamped server-side at approval.
 */
export async function claimCampaignReward(db, uid, input = {}, now = Date.now()) {
  const weekKey = clean(input.weekKey, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) throw problem('Choose the reward you are claiming.');
  const payload = creativeOf(input);
  const userRef = db.collection('users').doc(uid);
  const rewardRef = db.collection(REWARD_COLLECTION).doc(weekKey);
  const profile = await userRef.get();
  if (!profile.exists) throw problem('Finish your LINKUP profile first.');
  const member = profile.data();
  const campaignRef = db.collection('campaigns').doc();
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(rewardRef);
    if (!snap.exists) throw problem('That reward no longer exists.', 404);
    const reward = snap.data();
    if (reward.uid !== uid) throw problem('This reward belongs to another builder.', 403);
    if (reward.status !== 'available') throw problem('This reward has already been used or locked.', 409);
    if (now >= toMs(reward.claimBy)) throw problem('The seven-day claim window for this reward has closed.', 410);
    tx.set(campaignRef, {
      ownerId: uid,
      ownerName: clean(member.displayName || member.fullName || member.name, 100) || 'LINKUP builder',
      ownerPic: clean(member.profilePic || member.profilePicUrl || member.photoURL, 2048),
      ownerOccupation: clean(member.occupation, 100),
      ownerCity: clean(member.city, 80),
      ownerCountry: clean(member.country, 80),
      ownerVerified: member.isVerified === true || isGoldMember(uid),
      name: payload.name,
      status: 'pending_review',
      placements: payload.placements,
      creative: payload.creative,
      industries: payload.industries,
      reward: true,
      rewardWeek: weekKey,
      statsImpressions: 0,
      statsClicks: 0,
      createdAt: now,
      updatedAt: now,
    });
    tx.update(rewardRef, {
      status: 'claimed',
      campaignId: campaignRef.id,
      claimedAt: now,
      // Unapproved by this instant and the campaign is removed: a reward must
      // not sit in the review queue forever and turn into a permanent slot.
      activationDeadline: now + REWARD.claimDays * DAY_MS,
    });
    return { campaignId: campaignRef.id, activationDeadline: now + REWARD.claimDays * DAY_MS };
  });
  return { ...result, runDays: REWARD.runDays, status: 'pending_review' };
}

async function archive(db, reward, campaign, now) {
  await db.collection(REWARD_AUDIT).doc(String(reward.weekKey || campaign.id)).set({
    weekKey: clean(reward.weekKey, 20),
    uid: clean(reward.uid, 128),
    campaignId: campaign?.id || '',
    impressions: Number(campaign?.statsImpressions) || 0,
    clicks: Number(campaign?.statsClicks) || 0,
    startedAt: toMs(campaign?.rewardStartedAt),
    endedAt: now,
    runDays: REWARD.runDays,
  }, { merge: true });
}

/**
 * Hourly sweep. Starts the seven-day clock on approval, deletes the campaign
 * when it ends (permanently - the creative is not retained), expires unclaimed
 * rewards, and removes reward campaigns that were never approved.
 */
export async function reconcileCampaignRewards(db, now = Date.now()) {
  const out = { started: 0, deleted: 0, expired: 0, archived: 0 };
  for (const kind of ['available', 'claimed']) {
    const queryRef = db.collection(REWARD_COLLECTION).where('status', '==', kind).limit(40);
    const page = await queryRef.get();
    for (const doc of page.docs) {
      const reward = doc.data();
      if (kind === 'available') {
        if (now < toMs(reward.claimBy)) continue;
        await doc.ref.update({ status: 'expired', expiredAt: now });
        out.expired += 1;
        continue;
      }
      const campaignId = clean(reward.campaignId, 128);
      if (!campaignId) continue;
      const ref = db.collection('campaigns').doc(campaignId);
      const snap = await ref.get();
      if (!snap.exists) {
        await doc.ref.update({ status: 'completed', completedAt: now, completion: 'deleted' });
        out.deleted += 1;
        continue;
      }
      const campaign = { id: snap.id, ...snap.data() };
      const startedAt = toMs(campaign.rewardStartedAt);
      // Approved but never stamped: start the clock now. The ad can therefore
      // run for slightly less than seven days, never more.
      if (campaign.status === 'active' && !startedAt) {
        await ref.update({ rewardStartedAt: now, expiresAt: new Date(runDeadline(now)), expiresAtSource: 'league-reward' });
        out.started += 1;
        continue;
      }
      if (startedAt && now >= runDeadline(startedAt)) {
        await archive(db, reward, campaign, now);
        await ref.delete();
        await doc.ref.update({ status: 'completed', completedAt: now, completion: 'expired-after-run' });
        out.deleted += 1; out.archived += 1;
        continue;
      }
      // Never approved in time: no permanent free slot sitting in review.
      if (!startedAt && toMs(reward.activationDeadline) && now >= toMs(reward.activationDeadline)) {
        await archive(db, reward, campaign, now);
        await ref.delete();
        await doc.ref.update({ status: 'completed', completedAt: now, completion: 'not-approved-in-time' });
        out.deleted += 1; out.archived += 1;
      }
    }
  }
  return out;
}
