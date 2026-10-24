import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {awardWeek,chooseChampion,claimDeadline,rewardState,runDeadline,timeLeft,WEEK_MS,DAY_MS} from '../shared/campaign-reward.js';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('the award always targets the last COMPLETED UTC week, never the one in progress', () => {
  const midweek = Date.parse('2026-10-21T09:00:00Z'); // Wednesday
  const {start, end, weekKey} = awardWeek(midweek);
  assert.equal(new Date(start).toISOString(), '2026-10-12T00:00:00.000Z');
  assert.equal(new Date(end).toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(weekKey, '2026-10-12');
  assert.equal(end - start, WEEK_MS);
  // Sunday 23:59 still belongs to the week that has not closed yet, so the
  // awardable week stays the one before it.
  assert.equal(awardWeek(Date.parse('2026-10-25T23:59:00Z')).weekKey, '2026-10-12');
  assert.equal(awardWeek(Date.parse('2026-10-26T00:00:00Z')).weekKey, '2026-10-19');
});

test('claim closes exactly seven days after the week ends and the run is exactly seven days', () => {
  const {end} = awardWeek(Date.parse('2026-10-24T12:00:00Z'));
  assert.equal(claimDeadline(end) - end, 7 * DAY_MS);
  const startedAt = Date.parse('2026-10-27T08:00:00Z');
  assert.equal(runDeadline(startedAt) - startedAt, 7 * DAY_MS);
  assert.equal(timeLeft(7 * DAY_MS + 3 * 3_600_000), '7d 3h');
  assert.equal(timeLeft(0), 'now');
});

test('a week with no recorded public activity has no champion - no invented winner', () => {
  assert.equal(chooseChampion([]), null);
  assert.equal(chooseChampion([{uid:'a', points:0}, {uid:'b', points:0, buildDays:4}]), null);
  assert.equal(chooseChampion([{uid:'a', points:0}]), null);
});

test('ties resolve deterministically: points, then build days, then helpful credit, then uid', () => {
  const champ = chooseChampion([
    {uid:'z', points:30, buildDays:2, helpful:1},
    {uid:'b', points:30, buildDays:3, helpful:0},
    {uid:'a', points:30, buildDays:3, helpful:0},
  ]);
  assert.equal(champ.uid, 'a');
  assert.equal(chooseChampion([{uid:'x', points:10}, {uid:'y', points:40}]).uid, 'y');
});

test('reward states lock permanently: claim window close, missing campaign, live countdown', () => {
  const weekEnd = Date.parse('2026-10-19T00:00:00Z');
  const base = {weekKey: '2026-10-12', status: 'available', claimBy: claimDeadline(weekEnd)};
  assert.equal(rewardState(base, null, weekEnd).status, 'available');
  assert.equal(rewardState({...base}, null, weekEnd + 8 * DAY_MS).status, 'expired');
  assert.equal(rewardState({...base, status: 'claimed'}, null, weekEnd).status, 'completed');
  const live = rewardState({...base, status: 'claimed'}, {id:'c1', status:'active', rewardStartedAt: weekEnd, expiresAt: runDeadline(weekEnd)}, weekEnd + DAY_MS);
  assert.equal(live.status, 'claimed');
  assert.equal(live.remainingMs, 6 * DAY_MS);
  assert.equal(rewardState(null, null, weekEnd).status, 'none');
});

test('the claim screen is unreachable without a reward and the campaign form claims server-side', () => {
  const campaigns = read('mobile/src/screens/CampaignsScreen.tsx');
  assert.match(campaigns, /renderReward\(\)/);
  assert.match(campaigns, /rewardWeek: reward\.weekKey/);
  assert.match(campaigns, /Rewards cannot be extended, re-issued or moved to another week/);
  const create = read('mobile/src/screens/CreateCampaignScreen.tsx');
  assert.match(create, /claimCampaignReward\(/);
  assert.match(create, /exactly seven days once approved, then deleted permanently/);
});

test('Firestore denies every client write to rewards and only shows a member their own', () => {
  const rules = read('firestore.rules');
  assert.match(rules, /match \/campaignRewards\/\{weekKey\} \{[\s\S]*?resource\.data\.uid == request\.auth\.uid[\s\S]*?allow write: if false;/);
  assert.match(rules, /match \/campaignRewardsAudit\/\{weekKey\} \{[\s\S]*?allow write: if false;/);
});

test('the hourly cron both grants the weekly champion and enforces expiry', () => {
  const runtime = read('api/_builderRuntime.js');
  assert.match(runtime, /awardWeeklyChampion\(db\)/);
  assert.match(runtime, /reconcileCampaignRewards\(db\)/);
  const api = read('api/_builder.js');
  assert.match(api, /if\(op==='campaignReward'\)/);
  assert.match(api, /if\(op==='campaignRewardClaim'\)/);
});
