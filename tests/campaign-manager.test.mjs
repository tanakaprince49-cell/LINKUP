// /campaigns/ is the advertiser's campaign manager, not a read-only SEO list.
// These tests pin the whole path: the public URL, the app route it lands on,
// and the controls the manager has to offer once it opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { renderContentDirectory } from '../api/_contentSeo.js';

const read = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const APP = 'https://www.linkupbuild.com/app';

test('/campaigns and /app/campaigns redirect into the campaign manager on every deployment config', () => {
  for (const file of ['vercel.json', 'mobile/vercel.json']) {
    const cfg = JSON.parse(read(file));
    assert.ok(Array.isArray(cfg.redirects), file + ' must declare redirects');
    for (const source of ['/campaigns', '/campaigns/', '/app/campaigns', '/app/campaigns/']) {
      const redirect = cfg.redirects.find((r) => r.source === source);
      assert.ok(redirect, file + ' must redirect ' + source);
      assert.equal(redirect.destination, '/app/campaign-manager');
      // 307: the destination is an app entry point, not a permanent content move.
      assert.equal(redirect.permanent, false);
    }
    // No rewrite may still swallow the manager URL for a server-rendered page.
    for (const source of ['/campaigns', '/app/campaigns']) {
      assert.equal(cfg.rewrites.some((r) => r.source === source), false, file + ' still rewrites ' + source);
    }
    // Redirects never chain into each other (no loop through the SPA fallback).
    const sources = new Set(cfg.redirects.map((r) => r.source));
    for (const redirect of cfg.redirects) assert.equal(sources.has(redirect.destination), false);
  }
});

test('the app serves the manager at the redirect target and drops visitors into it after signing in', () => {
  const app = read('mobile/App.tsx');
  // The web linking path for the manager screen is exactly the redirect target.
  assert.match(app, /Platform\.OS === 'web'\s*\?\s*\{ Campaigns: 'campaign-manager', CampaignDetail: 'campaign-manager\/:campaignId' \}/);
  // Signed-out visitors are remembered and taken to the manager once onboarded;
  // signed-in ones are placed there even if the router missed the path.
  assert.match(app, /const isCampaignManagerPath = /);
  assert.match(app, /campaignIntentRef/);
  assert.match(app, /history\?\.replaceState\?\.\(null, '', webAppPath\('\/campaign-manager'\)\)/);
  assert.match(app, /navigate\('Campaigns'\)/);
  // The screen itself is registered for the web stack.
  assert.match(app, /<Stack\.Screen name="Campaigns" component=\{CampaignsScreen\} \/>/);
});

test('the manager can publish an ad, buy a plan, and read views, clicks and CTR', () => {
  const screen = read('mobile/src/screens/CampaignsScreen.tsx');
  // Publish: a new campaign and the creative editor.
  assert.match(screen, /navigate\('CreateCampaign'\)/);
  assert.match(screen, /navigate\('CreateCampaign', \{ editCampaign: campaign \}\)/);
  // Buy: plan cards plus a checkout CTA on both stores.
  assert.match(screen, /const CAMPAIGNS_PLANS = \[/);
  assert.match(screen, /startPayonifyCheckout\(plan\.webPlanKey\)/);
  assert.match(screen, /Start Campaigns/);
  // Stats: views, clicks and CTR from real campaign counters.
  assert.match(screen, /\/> \{compactNumber\(totalImpressions\)\} views|\{compactNumber\(totalImpressions\)\} views/);
  assert.match(screen, /\{compactNumber\(totalClicks\)\} clicks/);
  assert.match(screen, /const ctrFor = \(impressions: number, clicks: number\) =>/);
  assert.match(screen, /CAMPAIGN MANAGER/);
});

test('the public sponsored directory still exists beside the manager, at /sponsored', () => {
  for (const file of ['vercel.json', 'mobile/vercel.json']) {
    const cfg = JSON.parse(read(file));
    for (const source of ['/sponsored', '/app/sponsored']) {
      const index = cfg.rewrites.findIndex((r) => r.source === source);
      assert.ok(index >= 0, file + ' must rewrite ' + source);
      assert.ok(index < cfg.rewrites.findIndex((r) => r.source === '/(.*)'));
      assert.equal(cfg.rewrites[index].destination, '/api/publicSeo?mode=campaigns');
    }
  }
  const html = renderContentDirectory('campaigns', [], null, null);
  assert.match(html, new RegExp('<link rel="canonical" href="' + APP + '/sponsored"'));
  assert.match(html, /Open Campaigns in the app ↗<\/a>/);
  assert.match(renderContentDirectory('campaigns', [], 'cursor-1', null), new RegExp(APP + '/sponsored">Back to the first page'));
  // Startups keep their own directory path untouched.
  assert.match(renderContentDirectory('startups', [], null, null), new RegExp('<link rel="canonical" href="' + APP + '/startups"'));
});
