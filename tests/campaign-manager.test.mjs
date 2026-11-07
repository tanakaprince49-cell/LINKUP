import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

test('campaign links open the in-app manager rather than the public marketing page', () => {
  const app = read('../mobile/App.tsx');
  assert.match(app, /targetUrl === '\/campaigns'[\s\S]*?navigationRef\.navigate\('Campaigns'\)/);
  assert.doesNotMatch(app, /targetUrl === '\/campaigns'[\s\S]*?ExpoLinking\.openURL\('https:\/\/www\.linkupbuild\.com\/campaigns\/'\)/);

  const feed = read('../mobile/src/screens/FeedScreen.tsx');
  assert.match(feed, /function FeedHouseCard[\s\S]*?navigation\.navigate\('Campaigns'\)/);
  assert.match(feed, /accessibilityLabel="Manage or start a LINKUP campaign"/);
});

test('Campaigns account gates the dashboard and offers the paywall when the account is missing', () => {
  const screen = read('../mobile/src/screens/CampaignsScreen.tsx');
  assert.match(screen, /hasPlan \? renderDashboard\(\) : renderPaywall\(\)/);
  assert.match(screen, /Campaigns account gives you ad performance/);
  assert.match(screen, /Campaign performance/);
  assert.match(screen, /compactNumber\(totalImpressions\).*views/);
  assert.match(screen, /compactNumber\(totalClicks\).*clicks/);
  assert.match(screen, /\{totalCtr\} ctr/);
  assert.match(screen, />New Campaign</);
});

test('plan gating is based on an active account or an explicit web entitlement', () => {
  const source = read('../mobile/src/lib/campaigns.ts');
  assert.match(source, /export const hasCampaignsPlan = \([\s\S]*?if \(webOverride === true\) return true;/);
  assert.match(source, /return String\(account\?\.status \|\| ''\)\.toLowerCase\(\) === 'active';/);
});
