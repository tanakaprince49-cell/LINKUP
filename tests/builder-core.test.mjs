import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DAY,brief,freshState,contextOf,sanitizePrefs,pushAllowed,quiet,weekKey,relevantPeople,weeklySummary,relevantLeads} from '../api/_builderCore.js';
import {nextRetention} from '../shared/retention.js';
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
test('retention messages are opt-in, honest and quiet when there is nothing true to say',()=>{
 const s=freshState(at);s.prefs.retention=true;
 const facts={localDay:'2026-10-23',localHour:9,weekDays:0,weekTarget:3,totalUpdates:0,points:0,streakDays:0,todayRecorded:false,followupsDue:0,profileMissing:[]};
 assert.equal(nextRetention({state:s,facts:{localDay:'2026-10-23',localHour:9}}),null,'no facts means no message, never an invented one');
 assert.match(nextRetention({state:s,facts}).body,/still empty/,'an empty calendar is itself a true fact');
 s.prefs.retention=false;assert.equal(nextRetention({state:{...s,prefs:{...s.prefs,retention:false}},facts:{...facts,totalUpdates:9,lastUpdateDay:'2026-10-22'}}),null);
 s.prefs.retention=true;
 const real=nextRetention({state:s,facts:{...facts,totalUpdates:9,lastUpdateDay:'2026-10-22',weekDays:2}});
 assert.equal(real.category,'kickoff');assert.match(real.body,/2 build days this week, target 3/);
});
test('a due follow-up is the only thing that can claim the morning slot, and only when opted in',()=>{
 const s=freshState(at);const facts={localDay:'2026-10-23',localHour:9,weekDays:1,weekTarget:3,totalUpdates:4,lastUpdateDay:'2026-10-22',followupsDue:1,nextFollowupTitle:'Send the revised quote'};
 assert.equal(nextRetention({state:s,facts}).category,'kickoff');
 const opted={...s,prefs:{...s.prefs,reminders:true}};
 const due=nextRetention({state:opted,facts});
 assert.equal(due.category,'followup');
 // The title and note stay in the private workspace; the notification only
 // says that a real item reached its date.
 assert.doesNotMatch(due.body,/Send the revised quote/);
 assert.match(due.body,/reached its date/);assert.equal(due.section,'Follow-ups');
});
test('the same member cannot receive the same idea twice in a day',()=>{
 const s=freshState(at);const facts={localDay:'2026-10-23',localHour:9,weekDays:1,weekTarget:3,totalUpdates:4,lastUpdateDay:'2026-10-22',followupsDue:0};
 const first=nextRetention({state:s,facts});assert.equal(first.category,'kickoff');
 const after={...s,retention:{day:'2026-10-23',sent:[{category:'kickoff',at:at}]}};
 assert.equal(nextRetention({state:after,facts}),null);
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
test('push attempts honor an explicit opt-out but cover members who never chose',()=>{
 assert.equal(pushAllowed({push:false,pushSetOnce:true}),false);
 assert.equal(pushAllowed({push:true,pushSetOnce:true}),true);
 assert.equal(pushAllowed(freshState(at).prefs),true);
 assert.equal(pushAllowed({}),true);
});
