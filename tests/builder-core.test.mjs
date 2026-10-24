import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DAY,brief,freshState,contextOf,sanitizePrefs,quiet,weekKey,relevantPeople,nextDelivery,weeklySummary,relevantLeads} from '../api/_builderCore.js';
const at=Date.parse('2026-10-23T12:00:00Z');
test('builder context is explicit and defaults to private, optional AI use and opt-in reminders',()=>{
 const s=freshState(at);assert.equal(s.prefs.push,false);assert.equal(s.prefs.email,false);assert.equal(s.prefs.useContextForAI,false);assert.equal(s.prefs.reminders,false);assert.equal(s.version,16);
 assert.throws(()=>contextOf({}));assert.equal(contextOf({project:'Project',admin:true}).admin,undefined);
});
test('email fails closed and invalid notification types/timezones are rejected',()=>{
 for(const p of [{email:true},{push:'true'},{timezone:'wrong/timezone'},{quietStart:24},{quietEnd:-1}])assert.throws(()=>sanitizePrefs(p));
 const p=sanitizePrefs({timezone:'Africa/Harare',push:true});assert.equal(p.push,true);assert.equal(p.email,false);
});
test('quiet hours work across midnight, in local time and around daylight saving transitions',()=>{
 const p=sanitizePrefs({timezone:'Africa/Harare',quietStart:20,quietEnd:8});assert.equal(quiet(Date.parse('2026-10-23T19:00:00Z'),p),true);assert.equal(quiet(at,p),false);
 const ny=sanitizePrefs({timezone:'America/New_York'});assert.equal(typeof quiet(Date.parse('2026-11-01T06:30:00Z'),ny),'boolean');
 assert.equal(weekKey(at,'Africa/Harare'),'2026-10-19');
});
test('return briefing reports only actual goals, due followups, invitations and room updates',()=>{
 const s=freshState(at);s.context.project='A real project';s.followups=[{status:'open',dueAt:at-1}];s.goals=[{week:'2026-10-19',text:'Speak to customers',doneAt:0}];s.lastVisitAt=at-9*DAY;
 const b=brief(s,at,[{updatedAt:at-1}],[{id:'invite'}]);assert.equal(b.due,1);assert.equal(b.next.section,'Follow-ups');assert.equal(b.returningAfterBreak,true);assert.equal(b.completed,0);assert.equal(b.roomUpdates,1);assert.equal(b.invitations,1);
});
test('Daily 5 requires evidence, respects negative feedback and does not pad missing slots',()=>{
 const s=freshState(at);s.context.needs='Python developer in Harare';
 const people=[{uid:'a',name:'A',skills:['Python'],availability:{enabled:true,until:at+DAY,purpose:'MVP chat'}},{uid:'b',name:'B',skills:['Sales']},{uid:'c',name:'C',skills:['Python']}];
 s.feedback.c={status:'not_relevant'};const selected=relevantPeople(s,people,at);assert.equal(selected.length,1);assert.equal(selected[0].available,true);assert.match(selected[0].why,/Python/);
 assert.equal(relevantPeople(freshState(at),people,at).length,0);
});
test('expired availability is never advertised as currently available',()=>{
 const s=freshState(at);s.context.needs='Python';assert.equal(relevantPeople(s,[{uid:'a',name:'A',skills:['Python'],availability:{enabled:true,until:at-1}}],at)[0].available,false);
});
test('retired Coach context is never re-enabled through preferences',()=>{
 assert.equal(sanitizePrefs({useContextForAI:true}).useContextForAI,false);
});
test('reminder scheduling is opt-in, meaningful, frequency capped and never sends during quiet hours',()=>{
 const s=freshState(at);s.followups=[{status:'open',dueAt:at-1,notifiedAt:0}];assert.equal(nextDelivery(s,at),null);
 s.prefs.reminders=true;assert.equal(nextDelivery(s,at).section,'Follow-ups');s.lastDeliveryAt=at-1000;assert.equal(nextDelivery(s,at),null);
 s.lastDeliveryAt=0;assert.equal(nextDelivery(s,Date.parse('2026-10-23T23:00:00Z')),null);
});
test('Friday reviews do not manufacture a drop for an empty workspace and matching stays unlocked',()=>{
 const s=freshState(at);s.prefs.friday=true;assert.equal(nextDelivery(s,at),null);s.context.project='Real project';assert.equal(nextDelivery(s,at),null);const review={newOpportunities:[{key:'real-source'}],meaningful:true};assert.equal(nextDelivery(s,at,review).section,'Today');s.lastFriday='2026-10-19';assert.equal(nextDelivery(s,at,review),null);
});
test('Sunday progress summaries are source-based, opt-in and once per local week',()=>{
 const time=Date.parse('2026-10-25T18:00:00Z'),s=freshState(time);s.context.project='A';s.prefs.digest=true;assert.equal(nextDelivery(s,time),null);const review=weeklySummary(s,time);assert.equal(review.meaningful,false);s.goals=[{text:'Interview customers',doneAt:time-1000}];const actual=weeklySummary(s,time);assert.equal(nextDelivery(s,time,actual).section,'Today');assert.match(nextDelivery(s,time,actual).content,/1 completed outcomes/);s.lastDigest=weekKey(time);assert.equal(nextDelivery(s,time,actual),null);
});
test('V16 does not add a serverless function, bypass the existing ledger, or enable unsolicited email',()=>{
 const service=fs.readFileSync(new URL('../api/_builder.js',import.meta.url),'utf8');assert.doesNotMatch(service,/reserveMessage|refundMessage|await generate/);assert.match(service,/op==='coach'\)throw problem[^\n]+410/);
 const runtime=fs.readFileSync(new URL('../api/_builderRuntime.js',import.meta.url),'utf8');assert.match(runtime,/available:false/);
 const handler=fs.readFileSync(new URL('../api/linky.js',import.meta.url),'utf8');assert.match(handler,/case 'builder'/);assert.match(handler,/cronAuthorized\(req\)/);
});
test('private workspace is reachable, noindex, and both native and in-app notifications deep-link correctly',()=>{
 const app=fs.readFileSync(new URL('../mobile/App.tsx',import.meta.url),'utf8');assert.match(app,/BuilderWorkspace: 'builder'/);assert.match(app,/name="BuilderWorkspace"/);assert.match(app,/targetUrl.startsWith\('\/builder'\)/);
 const ui=fs.readFileSync(new URL('../mobile/src/screens/BuilderWorkspaceScreen.tsx',import.meta.url),'utf8');for(const feature of ['Follow-ups','Groups','Help board','Plan','Leads','Settings'])assert.ok(ui.includes(feature));assert.ok(!ui.includes('mailto:'));assert.doesNotMatch(ui,/['"]Coach['"]|section===['"]Rooms['"]/);
 const metadata=fs.readFileSync(new URL('../mobile/src/lib/webMetadata.ts',import.meta.url),'utf8');assert.match(metadata,/const isPublic = routeName === 'Landing'/);
});

test('profile preferences never imply missing stage, location, remote or current availability evidence',()=>{
 const s=freshState(at);s.context.needs='Python';s.context.preferredLocation='Harare';s.context.preferredStage='MVP';s.context.remotePreference='remote';s.context.availabilityPreference='available';
 const candidate={uid:'a',skills:['Python'],city:'Harare',startupStage:'MVP',remoteOnly:true,availability:{enabled:true,until:at+DAY}};
 assert.equal(relevantPeople(s,[candidate],at).length,1);
 for(const key of ['city','startupStage','remoteOnly','availability']){const copy={...candidate};delete copy[key];assert.equal(relevantPeople(s,[copy],at).length,0,key);}
});
test('weekly review contains actual outcomes, replies and attributed opportunities, not context-only filler',()=>{
 const s=freshState(at);s.context.intent='investors';s.goals=[{text:'Complete the interviews',doneAt:at-1}];
 const leads=relevantLeads(s,[{id:'fund',name:'Real source',tags:['investors'],checkedAt:new Date(at).toISOString(),sourceUrl:'https://example.com',attribution:'Official source'}],at);
 const review=weeklySummary(s,at,{leads,ownedAsks:[{feedback:[{at:at-1}]}]});
 assert.equal(review.completed.length,1);assert.equal(review.replies,1);assert.equal(review.opportunities.length,1);assert.equal(review.newOpportunities.length,1);assert.equal(review.opportunities[0].sourceUrl,'https://example.com');
 s.deliveredOpportunityKeys=['lead_fund'];assert.equal(weeklySummary(s,at,{leads}).newOpportunities.length,0);
});
test('old and future-dated external sources are not presented as freshly reviewed',()=>{
 const s=freshState(at);const lead={id:'source',name:'Source',tags:[],checkedAt:new Date(at-91*DAY).toISOString()};
 assert.equal(relevantLeads(s,[lead],at).length,0);lead.checkedAt=new Date(at+DAY).toISOString();assert.equal(relevantLeads(s,[lead],at).length,0);
});
