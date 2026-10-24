import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {calendarWeeks,contributionDay,contributionInsight,containsCredential,CONTRIBUTION_POINTS} from '../shared/contributions.js';
const now=Date.parse('2026-10-23T12:00:00Z');
test('instant coaching is two sentences, grounded in the topic and never invents ability, rank or savings',()=>{
 for(const text of ['Added Firebase rules tests','Interviewed five customers','Fixed an API bug','Launched our waitlist','Recorded our first paid sale','Updated signup design','Had a team meeting','Finished an important small milestone']){
  const insight=contributionInsight(text);assert.equal(insight.split(/[.!?]+/).filter(s=>s.trim()).length,2);
  assert.match(insight,/10 contribution points/);assert.doesNotMatch(insight,/top \d|\d+%|Technical Founder score|hundreds|guarantee|verified/i);
 }
 assert.equal(CONTRIBUTION_POINTS,10);assert.match(contributionInsight('Tightened Firestore security rules'),/allowed and denied/);assert.match(contributionInsight('Interviewed five customers'),/actually said/);
});
test('credentials are rejected before an update can be committed',()=>{
 for(const text of ['github_pat_privatevalue','-----BEGIN PRIVATE KEY-----','api_key = really_private_key_value'])assert.equal(containsCredential(text),true);
 assert.equal(containsCredential('Added Firestore rule tests without sharing any keys'),false);
});
test('calendar is Monday-aligned, twelve weeks, UTC-stable and lights only recorded days',()=>{
 const weeks=calendarWeeks(['2026-10-22','2026-10-23','2026-10-24','nonsense'],now);assert.equal(weeks.length,12);assert.ok(weeks.every(w=>w.length===7));
 assert.equal(new Date(weeks[0][0].day+'T00:00:00Z').getUTCDay(),1);
 assert.equal(weeks.flat().filter(c=>c.active).length,2);assert.equal(weeks.flat().filter(c=>c.today).length,1);
 assert.equal(weeks.flat().find(c=>c.day==='2026-10-24').active,false);assert.equal(weeks.flat().find(c=>c.day==='2026-10-24').future,true);
 assert.equal(contributionDay(Date.parse('2026-10-23T23:59:59Z')),'2026-10-23');assert.equal(contributionDay(Date.parse('2026-10-24T00:00:00Z')),'2026-10-24');
});
test('calendar handles leap day and year rollover without duplicating or inventing activity',()=>{
 for(const date of ['2028-02-29T12:00:00Z','2027-01-01T12:00:00Z']){
  const cells=calendarWeeks([],Date.parse(date)).flat();assert.equal(new Set(cells.map(c=>c.day)).size,84);assert.equal(cells.filter(c=>c.active).length,0);assert.equal(cells.filter(c=>c.today).length,1);
 }
});
test('profile and progress log use the actual calendar and authoritative publishing adapter, not client badges',()=>{
 const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
 const profile=read('mobile/src/screens/ProfileScreen.tsx'),ship=read('mobile/src/screens/ShipLogScreen.tsx'),calendar=read('mobile/src/components/ContributionCalendar.tsx');
 assert.match(profile,/<ContributionCalendar userId=\{profile.uid\}/);assert.match(ship,/builderCall\('shipUpdate',pending.current\)/);assert.match(ship,/no chat credit used/);
 assert.doesNotMatch(ship,/isVerified:|verificationProgram:|top 5%/);assert.doesNotMatch(calendar,/Animated|isReduceMotionEnabled/);assert.match(calendar,/#FBE618/);assert.match(calendar,/shadowRadius:7/);
 const loop=read('mobile/src/lib/dailyLoop.ts').split('export async function persistShipAndRep')[1].split('export async function syncDecayingRep')[0];assert.doesNotMatch(loop,/patch\.isVerified|SHIPPED|verifiedBy|setDoc\(/);
});
test('no decorative sparkle glyph or sparkle-icon import remains anywhere in application source',()=>{
 const root=new URL('../mobile/src/',import.meta.url),files=[];
 function visit(dir){for(const name of fs.readdirSync(dir)){const full=path.join(dir,name);if(fs.statSync(full).isDirectory())visit(full);else if(/\.(tsx?|jsx?)$/.test(name))files.push(full);}}
 visit(fileURLToPath(root));assert.ok(files.length>100);for(const file of files)assert.doesNotMatch(fs.readFileSync(file,'utf8'),/Sparkles|WandSparkles|✨/,file);
});
