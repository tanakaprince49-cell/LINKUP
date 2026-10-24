import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {habitSnapshot,habitReminder,weekOf} from '../shared/build-habit.js';
import {freshState,sanitizePrefs} from '../api/_builderCore.js';
import {nextRetention} from '../shared/retention.js';
const at=Date.parse('2026-10-24T18:00:00Z');
test('mission is one real update, optional and zero activity is never manufactured',()=>{
 const h=habitSnapshot({},at);assert.equal(h.weekly.target,3);assert.equal(h.mission.done,false);assert.deepEqual(h.milestones,[]);assert.equal(h.credits,0);assert.equal(h.tokens,0);assert.equal(h.canRestToday,false);
 const done=habitSnapshot({days:['2026-10-24'],totalUpdates:1},at);assert.equal(done.mission.done,true);assert.deepEqual(done.milestones,[1]);assert.equal(done.weekly.progress,1);
});
test('UTC targets use Monday weeks and future changes do not rewrite current week',()=>{
 assert.equal(weekOf('2026-10-25'),'2026-10-19');assert.equal(weekOf('2026-10-26'),'2026-10-26');
 const c={days:['2026-10-23'],habit:{goals:[{week:'2026-10-19',target:3},{week:'2026-10-26',target:7}]}};
 assert.equal(habitSnapshot(c,at).weekly.target,3);assert.equal(habitSnapshot(c,Date.parse('2026-10-26')).weekly.target,7);
});
test('protected breaks bridge a rhythm but never inflate actual days, goal progress or milestones',()=>{
 const c={days:['2026-10-21','2026-10-22'],totalUpdates:2,habit:{rests:[{day:'2026-10-23',kind:'free'}]}};
 const h=habitSnapshot(c,at);assert.equal(h.rhythm.actualDays,2);assert.equal(h.rhythm.protectedDays,1);assert.equal(h.weekly.progress,2);assert.deepEqual(h.milestones,[1]);assert.equal(h.freeRestAvailable,false);assert.equal(h.canRestToday,true);
 const absent=habitSnapshot(c,at+3*86400000);assert.equal(absent.rhythm.actualDays,0);assert.equal(absent.totalUpdates,2);
});
test('cheeky reminders are off by default and suppressed on completion, rest or a met weekly target',()=>{
 const s=freshState(at);assert.equal(habitReminder(s,{},at),null);s.prefs.dailyBuild=true;s.prefs.buildOptInDay='2026-10-23';
 assert.match(habitReminder(s,{},at).content,/Sixty seconds/);
 assert.equal(habitReminder(s,{days:['2026-10-24']},at),null);
 assert.equal(habitReminder(s,{habit:{rests:[{day:'2026-10-24',kind:'free'}]}},at),null);
 assert.equal(habitReminder(s,{days:['2026-10-19','2026-10-20','2026-10-21']},at),null);
});
test('nudges use day one/three/five, genuinely pause on the third, and never fabricate urgency',()=>{
 const s=freshState(at);Object.assign(s.prefs,{dailyBuild:true,buildOptInDay:'2026-10-23'});s.buildReminderCount=1;assert.equal(habitReminder(s,{},at),null);
 assert.match(habitReminder(s,{},at+2*86400000).content,/dramatic comeback/);s.buildReminderCount=2;
 const last=habitReminder(s,{},at+4*86400000);assert.equal(last.pause,true);assert.match(last.content,/parked/);assert.doesNotMatch(last.content,/competitors|give up|moldy|impatient/);s.buildReminderCount=3;assert.equal(habitReminder(s,{},at+9*86400000),null);
});
test('the evening build nudge still honours quiet hours, spacing and delivery opt-out',()=>{
 const at=Date.parse('2026-10-24T18:00:00Z'),s=freshState(at);
 Object.assign(s.prefs,{dailyBuild:true,buildOptInDay:'2026-10-23',buildHour:18,timezone:'Africa/Harare',quietStart:22,retention:true});
 const facts={localDay:'2026-10-24',localHour:18,weekDays:0,weekTarget:3,totalUpdates:3,lastUpdateDay:'2026-10-23',streakDays:1,todayRecorded:false};
 assert.equal(nextRetention({state:s,facts,now:at,contributions:{}}).kind,'build');
 const quiet={...s,prefs:{...s.prefs,quietStart:17,quietEnd:22}};
 assert.equal(nextRetention({state:quiet,facts,now:at,contributions:{}}),null,'quiet hours win');
 s.lastDeliveryAt=at-60000;
 assert.equal(nextRetention({state:s,facts,now:at,contributions:{}}),null,'no second message within the gap');
 s.lastDeliveryAt=0;s.prefs.inApp=false;
 assert.equal(nextRetention({state:s,facts,now:at,contributions:{}}),null,'no in-app and no push means no delivery');
 assert.throws(()=>sanitizePrefs({buildHour:24}));assert.throws(()=>sanitizePrefs({dailyBuild:'yes'}));
});
test('retention routes preserve private server-owned scoring and add no AI quota or match penalty',()=>{
 const ui=fs.readFileSync(new URL('../mobile/src/components/BuildHabitCard.tsx',import.meta.url),'utf8');
 assert.match(ui,/Earned points never expire/);assert.match(ui,/Give useful feedback/);assert.match(ui,/Automatically pauses after three/);assert.doesNotMatch(ui,/Sparkles|WandSparkles/);
 const server=fs.readFileSync(new URL('../api/_builderHabit.js',import.meta.url),'utf8');assert.doesNotMatch(server,/reserveMessage|generate\(|isVerified|founderScore|reputationScore/);
 const alerts=fs.readFileSync(new URL('../mobile/src/screens/AlertsScreen.tsx',import.meta.url),'utf8');assert.match(alerts,/builderAction === 'ship'/);const app=fs.readFileSync(new URL('../mobile/App.tsx',import.meta.url),'utf8');assert.ok(app.indexOf("targetUrl === '/ship'")<app.indexOf("targetUrl.startsWith('/builder')"));
});
