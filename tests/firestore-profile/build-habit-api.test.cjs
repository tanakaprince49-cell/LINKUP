const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing'),admin=require('firebase-admin');
let env,app,db,createBuilderService,clock,pushes;
const START=Date.parse('2026-10-19T18:00:00Z'),DAY=86400000;
before(async()=>{if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Emulator required');env=await initializeTestEnvironment({projectId:'demo-linkup',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});app=admin.initializeApp({projectId:'demo-linkup'},'habit-tests');db=app.firestore();({createBuilderService}=await import('../../api/_builder.js'));});
after(async()=>{await env?.cleanup();await app?.delete();});
async function seed(){await env.clearFirestore();clock=START;pushes=[];for(const uid of ['alice','bob','carl','dana','eli','fay'])await db.collection('users').doc(uid).set({displayName:uid,onboarded:true,isVisible:true,isVerified:false,reputationScore:9});return createBuilderService({db,now:()=>clock,generate:()=>{throw Error('No AI call allowed');},push:async(uid,msg)=>{pushes.push({uid,...msg});return {sent:1};}});}
const ship=(s,uid='alice',key='ship')=>s.handle(uid,'shipUpdate',{key,text:'Finished API tests and measured the changed behavior '+key});
async function help(s,owner='bob',text='The signup flow hides the primary button on a small phone. Increase its contrast and test the flow with a new customer.'){
 const {askId}=await s.handle(owner,'askCreate',{title:'Please review our signup flow',details:'We need specific usability feedback on our first signup flow.',question:'What should we change in this signup?',minutes:5});
 await s.handle('alice','askFeedback',{id:askId,text:text+' For '+owner+'’s project.'});const a=(await db.collection('builderAsks').doc(askId).get()).data();return {id:askId,feedbackId:a.feedback[0].id,outcome:'We increased contrast and tested the revised button with customers.'};
}
test('habit settings are validated and goals do not retroactively lower this week after progress',async()=>{
 const s=await seed();let h=await s.handle('alice','habitPrefs',{target:5,dailyBuild:true,buildHour:18,timezone:'Africa/Harare'});assert.equal(h.weekly.target,5);assert.equal(h.reminders.enabled,true);
 h=await s.handle('alice','habitPrefs',{target:3});assert.equal(h.weekly.target,3);await ship(s);h=await s.handle('alice','habitPrefs',{target:7});assert.equal(h.weekly.target,3);assert.equal(h.weekly.pending.target,7);
 await assert.rejects(s.handle('alice','habitPrefs',{target:0}));await assert.rejects(s.handle('alice','habitPrefs',{buildHour:24}));assert.equal((await db.collection('linkyUsage').doc('alice').get()).exists,false);
});
test('free rest is once per UTC week and never awards points or a fake recorded square',async()=>{
 const s=await seed();await ship(s);clock+=DAY;const before=await s.handle('alice','contributions');const h=await s.handle('alice','habitRest',{day:'2026-10-20'});assert.equal(h.resting,true);assert.equal(h.rhythm.actualDays,1);assert.equal(h.rhythm.protectedDays,1);
 assert.equal((await s.handle('alice','habitRest',{day:'2026-10-20'})).replayed,true);const after=await s.handle('alice','contributions');assert.equal(after.points,before.points);assert.deepEqual(after.days,before.days);
 clock+=DAY;await assert.rejects(s.handle('alice','habitRest',{day:'2026-10-21'}),/free protection is used/);await assert.rejects(s.handle('alice','habitRest',{day:'2026-10-25'}),/today or yesterday/);
});
test('a build on a protected day replaces the rest and refunds a used token, not extra contribution points',async()=>{
 const s=await seed();await ship(s);clock+=DAY;await db.collection('builderContributions').doc('alice').update({'habit.rests':[{day:'2026-10-20',kind:'token'}],'habit.tokens':0});await ship(s,'alice','second');const h=await s.handle('alice','habit');assert.equal(h.tokens,1);assert.equal(h.resting,false);assert.equal(h.weekly.progress,2);assert.equal((await s.handle('alice','contributions')).points,20);
 clock+=DAY;await db.collection('builderContributions').doc('alice').update({'habit.rests':[{day:'2026-10-21',kind:'token'}],'habit.tokens':3,'habit.credits':0});await ship(s,'alice','third');const refunded=await s.handle('alice','habit');assert.equal(refunded.tokens,3);assert.equal(refunded.credits,20);
});
test('helpful feedback earns private credits exactly once, not contribution points, badges or AI charges',async()=>{
 const s=await seed(),f=await help(s);const r=await s.handle('bob','askFeedbackStatus',f);assert.equal(r.reward.amount,5);await s.handle('bob','askFeedbackStatus',f);
 const h=await s.handle('alice','habit');assert.equal(h.credits,5);assert.equal(h.totalUpdates,0);assert.equal((await s.handle('alice','contributions')).points,0);assert.equal((await db.collection('users').doc('alice').get()).data().isVerified,false);assert.equal((await db.collection('users').doc('alice').get()).data().reputationScore,9);assert.equal((await db.collection('linkyUsage').doc('alice').get()).exists,false);
 const other=await s.handle('bob','contributions',{targetUid:'alice'});assert.equal(other.habit,undefined);assert.ok(!JSON.stringify(other).includes('credits'));
});
test('reward caps resist recipient repeats, same-day bursts and concurrent recognition',async()=>{
 const s=await seed(),f1=await help(s,'bob'),f2=await help(s,'carl'),f3=await help(s,'dana');await Promise.all([s.handle('bob','askFeedbackStatus',f1),s.handle('bob','askFeedbackStatus',f1)]);await s.handle('carl','askFeedbackStatus',f2);assert.equal((await s.handle('dana','askFeedbackStatus',f3)).reward.amount,0);assert.equal((await s.handle('alice','habit')).credits,10);
 clock+=DAY;const repeat=await help(s,'bob');assert.equal((await s.handle('bob','askFeedbackStatus',repeat)).reward.amount,0);const f4=await help(s,'eli'),f5=await help(s,'fay');await s.handle('eli','askFeedbackStatus',f4);await s.handle('fay','askFeedbackStatus',f5);clock+=DAY;const again=await help(s,'dana');assert.equal((await s.handle('dana','askFeedbackStatus',again)).reward.amount,0);assert.equal((await s.handle('alice','habit')).credits,20);
});
test('blocked, deleted, expired and low-effort feedback cannot mint credits',async()=>{
 const s=await seed(),f=await help(s);await db.collection('blocks').doc('block').set({blockedById:'alice',blockedUserId:'bob'});assert.equal((await s.handle('bob','askFeedbackStatus',f)).reward.amount,0);
 await db.collection('blocks').doc('block').delete();const expired=await help(s,'carl');await db.collection('builderAsks').doc(expired.id).update({expiresAt:START-1});assert.equal((await s.handle('carl','askFeedbackStatus',expired)).reward.amount,0);
 const short=await help(s,'dana','Try this button.');assert.equal((await s.handle('dana','askFeedbackStatus',short)).reward.amount,0);
 const deleted=await help(s,'eli');await db.collection('users').doc('alice').update({deleted:true});assert.equal((await s.handle('eli','askFeedbackStatus',deleted)).reward.amount,0);
});
test('token spending is atomic, replay-safe, capped, and private reset does not refill balances',async()=>{
 const s=await seed();await db.collection('builderContributions').doc('alice').set({habit:{credits:40,tokens:0}});const result=await Promise.all([s.handle('alice','habitToken',{key:'token_1'}),s.handle('alice','habitToken',{key:'token_1'})]);assert.equal(result.filter(r=>r.replayed).length,1);let h=await s.handle('alice','habit');assert.equal(h.tokens,1);assert.equal(h.credits,20);
 await s.handle('alice','forget');h=await s.handle('alice','habit');assert.equal(h.tokens,1);assert.equal(h.credits,20);await s.handle('alice','habitToken',{key:'token_2'});await assert.rejects(s.handle('alice','habitToken',{key:'token_3'}),/20 community/);
 await db.collection('builderContributions').doc('alice').update({'habit.credits':100,'habit.tokens':3});await assert.rejects(s.handle('alice','habitToken',{key:'too_many'}),/at most three/);
});
test('scheduled cheeky nudges deduplicate, deep-link to Progress Log and genuinely auto-pause',async()=>{
 const s=await seed();await s.handle('alice','habitPrefs',{dailyBuild:true});await s.handle('alice','prefs',{push:true});clock+=DAY;
 assert.equal((await s.runReminderPage()).delivered,1);assert.equal((await s.runReminderPage()).delivered,0);assert.equal(pushes[0].url,'/ship');assert.match(pushes[0].body,/Sixty seconds/);
 const privateInbox=(await db.collection('builderContributions').doc('alice').get()).data().habit.nudges;assert.equal(privateInbox[0].url,'/ship');assert.equal((await db.collection('notifications').get()).size,0);clock+=2*DAY;assert.equal((await s.runReminderPage()).delivered,1);clock+=2*DAY;assert.equal((await s.runReminderPage()).delivered,1);assert.equal((await s.handle('alice','habit')).reminders.enabled,false);clock+=DAY;assert.equal((await s.runReminderPage()).delivered,0);assert.equal(pushes.length,3);
});
test('quiet hours, completion, rest and weekly goal suppress scheduled build nudges',async()=>{
 // `delivered` now counts every retention message, so these assertions look at
 // the build nudge itself: it must never fire once the day is recorded,
 // protected, or the weekly goal is met.
 const s=await seed();await s.handle('alice','habitPrefs',{dailyBuild:true});clock+=DAY;await ship(s);
 await s.runReminderPage();assert.equal(((await db.collection('builderContributions').doc('alice').get()).data().habit.nudges||[]).length,0);
 clock+=DAY;await s.handle('alice','habitRest',{day:'2026-10-21'});await s.runReminderPage();
 assert.equal(((await db.collection('builderContributions').doc('alice').get()).data().habit.nudges||[]).length,0);
 clock+=DAY;await s.handle('alice','prefs',{quietStart:18,quietEnd:6});assert.equal((await s.runReminderPage()).delivered,0);await s.handle('alice','prefs',{quietStart:20,quietEnd:6});
 await db.collection('builderContributions').doc('alice').update({days:['2026-10-19','2026-10-20','2026-10-21']});await s.runReminderPage();
 assert.equal(((await db.collection('builderContributions').doc('alice').get()).data().habit.nudges||[]).length,0);
 assert.equal(pushes.filter(p=>/Sixty seconds|dramatic comeback|parked the build/.test(p.body||'')).length,0);
});
test('exports include private ledgers for their owner only and forged identity fields cannot spend another wallet',async()=>{
 const s=await seed();await ship(s);await s.handle('alice','habitPrefs',{dailyBuild:true});const r=await s.handle('alice','export');assert.equal(r.habit.totalUpdates,1);assert.equal(r.contributions.updates.length,1);await s.handle('alice','forget');assert.equal((await s.handle('alice','habit')).reminders.enabled,false);
 await assert.rejects(s.handle('bob','habitToken',{uid:'alice',key:'forged',credits:999,tokens:3}),/20 community/);assert.equal((await s.handle('alice','habit')).tokens,0);
});

test('in-app-only habit nudges cannot trigger legacy notification pushes',async()=>{const s=await seed();await s.handle('alice','habitPrefs',{dailyBuild:true});clock+=DAY;await s.runReminderPage();assert.equal(pushes.length,0);assert.equal((await db.collection('notifications').get()).size,0);assert.match((await s.handle('alice','habit')).nudge.content,/Sixty seconds/);await ship(s);assert.equal((await s.handle('alice','habit')).nudge,null);});

test('copy-pasted feedback cannot farm rewards from different recipients',async()=>{
 const s=await seed(),text='The primary signup button is hidden below the fold. Bring it above the fold and test it with a first-time customer.';
 async function round(owner){const {askId}=await s.handle(owner,'askCreate',{title:'Review the signup journey',details:'We are testing our first signup journey with new users.',question:'Where is the next step unclear?'});await s.handle('alice','askFeedback',{id:askId,text});const f=(await db.collection('builderAsks').doc(askId).get()).data().feedback[0];return s.handle(owner,'askFeedbackStatus',{id:askId,feedbackId:f.id,outcome:'We moved the primary action and tested the new layout.'});}
 assert.equal((await round('bob')).reward.amount,5);assert.equal((await round('carl')).reward.amount,0);assert.equal((await s.handle('alice','habit')).credits,5);
});
test('concurrent rest claims cannot consume two free days in the same week',async()=>{
 const s=await seed();await ship(s);clock+=2*DAY;
 const r=await Promise.allSettled([s.handle('alice','habitRest',{day:'2026-10-20'}),s.handle('alice','habitRest',{day:'2026-10-21'})]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
 const c=(await db.collection('builderContributions').doc('alice').get()).data();assert.equal(c.habit.rests.length,1);assert.equal(c.points,10);assert.equal(c.days.length,1);
});
