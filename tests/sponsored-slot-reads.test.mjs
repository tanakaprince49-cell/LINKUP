// The sponsored slot used to be the single biggest read burner in the client:
// every mounted slot ran `getDocs` over the active-campaign collection on a 45s
// timer (~24 reads a tick, ~1,900 an hour per slot, against a 50k/day Spark
// quota). These tests pin the fix so it cannot quietly come back:
//   * inventory arrives through ONE shared realtime listener,
//   * rotation is local (state change, no network),
//   * the one-shot cache outlives a rotation,
//   * impressions stay capped per viewer per campaign per day.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const campaigns = source('mobile/src/lib/campaigns.ts');
const card = source('mobile/src/components/SponsoredCard.tsx');
const hub = source('mobile/src/screens/DiscoveryDashboardScreen.tsx');

test('servable inventory is shared through one ref-counted listener', () => {
  assert.match(campaigns, /export const subscribeServableCampaigns/);
  const body = campaigns.slice(campaigns.indexOf('export const subscribeServableCampaigns'));
  const listener = body.slice(0, body.indexOf('/** Every servable campaign'));
  assert.equal((listener.match(/onSnapshot\(/g) || []).length, 1, 'exactly one snapshot listener');
  assert.match(listener, /limit\(24\)/, 'inventory read stays bounded');
  // Ref-counted: the listener must die with its last subscriber, or a tab switch
  // would leave a live query running for the rest of the session.
  assert.match(listener, /if \(!entry\.subscribers\.size\) \{[\s\S]*?entry\.stop\(\)/);
});

test('the one-shot cache outlives a rotation instead of expiring before it', () => {
  const declared = campaigns.match(/const SERVABLE_CACHE_MS = ([^;]+);/);
  assert.ok(declared, 'SERVABLE_CACHE_MS must be declared');
  const value = declared[1].replace(/_/g, '');
  const ms = value.includes('*') ? value.split('*').map((part) => Number(part.trim())).reduce((a, b) => a * b, 1) : Number(value);
  const rotate = campaigns.match(/SPONSORED_SLOT_ROTATE_MS = ([\d_]+)/);
  assert.ok(rotate, 'SPONSORED_SLOT_ROTATE_MS must be declared');
  assert.ok(ms >= Number(rotate[1].replace(/_/g, '')), `cache ${ms}ms must not expire inside one ${rotate[1]}ms rotation`);
});

test('slots rotate locally instead of re-reading the collection', () => {
  const single = card.slice(card.indexOf('export function useSponsoredSlot'), card.indexOf('export function useSponsoredSlots'));
  const multi = card.slice(card.indexOf('export function useSponsoredSlots'));
  for (const [name, hook] of [['useSponsoredSlot', single], ['useSponsoredSlots', multi]]) {
    assert.ok(hook.length > 0, name + ' must exist');
    assert.doesNotMatch(hook, /pickSponsoredCampaign/, name + ' must not fetch inventory itself');
    assert.match(hook, /subscribeServableCampaigns\(/, name + ' must use the shared listener');
    // The timer body must only move an index / call a local setter.
    const timers = hook.match(/setInterval\(\(\) => \{[\s\S]*?\}, SPONSORED_SLOT_ROTATE_MS\)/g) || [];
    assert.equal(timers.length, 1, name + ' must have exactly one rotation timer');
    assert.doesNotMatch(timers[0], /getDocs|fetchServable|await /, name + ' timer must not touch the network');
  }
});

test('the Discover hub reuses the hook instead of running its own polling loop', () => {
  assert.match(hub, /useSponsoredSlot\('hub'/);
  assert.doesNotMatch(hub, /pickSponsoredCampaign\b/);
  assert.doesNotMatch(hub, /SPONSORED_SLOT_ROTATE_MS/);
});

test('impressions stay capped per viewer per campaign per day', () => {
  assert.match(campaigns, /CAMPAIGN_IMPRESSION_DAILY_CAP = 2/);
  const record = campaigns.slice(campaigns.indexOf('export const recordCampaignImpression'));
  assert.match(record.slice(0, 800), /views >= CAMPAIGN_IMPRESSION_DAILY_CAP\) return;/);
});
