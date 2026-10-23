const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc}=require('firebase/firestore');
const admin=require('firebase-admin');
let env,db,app,createBuilderService;
const NOW=Date.parse('2026-10-23T12:00:00Z');
const profile=name=>({displayName:name,onboarded:true,isVisible:true});
before(async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Builder tests MUST run against the Firestore Emulator.');
 env=await initializeTestEnvironment({projectId:'demo-linkup',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 app=admin.initializeApp({projectId:'demo-linkup'},'builder-tests');db=app.firestore();
 ({createBuilderService}=await import('../../api/_builder.js'));
});
after(async()=>{await env?.cleanup();await app?.delete();});
async function seed(options={}){
 await env.clearFirestore();
 for(const name of ['alice','bob','mallory'])await db.collection('users').doc(name).set(profile(name));
 await db.collection('connectionRequests').doc('alice_bob').set({senderId:'alice',recipientId:'bob',status:'approved'});
 const service=createBuilderService({db,now:()=>NOW,generate:async()=> 'A grounded review with a concrete next step.',...options});return service;
}
async function roomWithBob(service){const {roomId}=await service.handle('alice','roomCreate',{title:'An actual project',kind:'project'});await service.handle('alice','roomInvite',{roomId,targetUid:'bob'});return roomId;}
test('builder collections are server-only even for their apparent owner',async()=>{
 await seed();const client=env.authenticatedContext('alice').firestore();
 for(const collection of ['builderStates','builderRooms','builderInvites','builderAsks','builderEvents','builderRates','builderScheduler']){
  await assertFails(setDoc(doc(client,collection,'alice'),{ownerId:'alice',memberIds:['alice'],status:'accepted'}));
  await assertFails(getDoc(doc(client,collection,'alice')));
 }
});
test('private context and followup notes cannot be requested through another member identity',async()=>{
 const s=await seed();await s.handle('alice','context',{project:'PRIVATE PROJECT',constraints:'PRIVATE NOTE'});
 const other=await s.handle('bob','export',{uid:'alice'});assert.ok(!JSON.stringify(other).includes('PRIVATE PROJECT'));assert.ok(!JSON.stringify(other).includes('PRIVATE NOTE'));
 await db.collection('users').doc('alice').update({deleted:true});await assert.rejects(s.handle('alice','home'),/Finish your profile/);
});
test('accepted membership requires the intended recipient and a current mutual connection',async()=>{
 const s=await seed(),roomId=await roomWithBob(s),inviteId=roomId+'_bob';
 await assert.rejects(s.handle('mallory','invitationRespond',{id:inviteId,decision:'accept'}),/Invitation not found/);
 await assert.rejects(s.handle('bob','room',{roomId}),/not available/);
 await s.handle('bob','invitationRespond',{id:inviteId,decision:'accept'});assert.equal((await s.handle('bob','room',{roomId})).room.memberIds.length,2);
 await assert.rejects(s.handle('alice','roomInvite',{roomId,targetUid:'mallory'}),/Connect mutually/);
});
test('a declined invitation cannot be resent immediately and does not expose room content',async()=>{
 const s=await seed(),roomId=await roomWithBob(s);await s.handle('bob','invitationRespond',{id:roomId+'_bob',decision:'decline'});
 await assert.rejects(s.handle('alice','roomInvite',{roomId,targetUid:'bob'}),/recently/);
 await assert.rejects(s.handle('bob','room',{roomId}),/not available/);
});
test('blocking after acceptance revokes access in both directions',async()=>{
 const s=await seed(),roomId=await roomWithBob(s);await s.handle('bob','invitationRespond',{id:roomId+'_bob',decision:'accept'});
 await db.collection('blocks').doc('bob_alice').set({blockedById:'bob',blockedUserId:'alice'});
 await assert.rejects(s.handle('bob','room',{roomId}),/blocked/);await assert.rejects(s.handle('alice','room',{roomId}),/blocked/);
});
test('accountability rooms have two members and participant lists cannot be forged',async()=>{
 const s=await seed();const {roomId}=await s.handle('alice','roomCreate',{title:'Weekly accountability',kind:'accountability',memberIds:['mallory']});
 assert.deepEqual((await s.handle('alice','room',{roomId})).room.memberIds,['alice']);
 await s.handle('alice','roomInvite',{roomId,targetUid:'bob'});await s.handle('bob','invitationRespond',{id:roomId+'_bob',decision:'accept'});
 await db.collection('connectionRequests').doc('alice_mallory').set({senderId:'alice',recipientId:'mallory',status:'approved'});
 await s.handle('alice','roomInvite',{roomId,targetUid:'mallory'});await assert.rejects(s.handle('mallory','invitationRespond',{id:roomId+'_mallory',decision:'accept'}),/full/);
});
test('room task assignments, useful logs, archive and leave permissions are enforced',async()=>{
 const s=await seed(),roomId=await roomWithBob(s);await s.handle('bob','invitationRespond',{id:roomId+'_bob',decision:'accept'});
 await assert.rejects(s.handle('alice','roomAction',{roomId,action:'task',text:'Do a useful thing',assignee:'mallory'}),/accepted members/);
 await s.handle('bob','roomAction',{roomId,action:'log',text:'Finished the signup test.'});
 assert.equal((await s.handle('bob','home')).brief.momentumDays,1);
 await assert.rejects(s.handle('bob','roomAction',{roomId,action:'archive'}),/owner/);
 await s.handle('bob','roomAction',{roomId,action:'leave'});await assert.rejects(s.handle('bob','room',{roomId}),/not available/);
 await s.handle('alice','roomAction',{roomId,action:'archive'});await assert.rejects(s.handle('alice','roomAction',{roomId,action:'message',text:'This is not allowed'}),/archived/);
});
test('followups require approved connections and cannot send, read or update somebody else\'s note',async()=>{
 const s=await seed();await assert.rejects(s.handle('alice','followup',{targetUid:'mallory',title:'Follow up',note:'Private',dueAt:NOW}),/Connect mutually/);
 await s.handle('alice','followup',{targetUid:'bob',title:'Review the demo',note:'PRIVATE RELATIONSHIP NOTE',dueAt:NOW});
 const f=(await s.handle('alice','home')).state.followups[0];assert.equal((await s.handle('alice','followupDraft',{id:f.id})).sent,false);
 await assert.rejects(s.handle('bob','followupStatus',{id:f.id,status:'done'}),/not found/);
 const exported=await s.handle('bob','export');assert.ok(!JSON.stringify(exported).includes('PRIVATE RELATIONSHIP NOTE'));
 await s.handle('alice','followupStatus',{id:f.id,status:'snooze'});assert.equal((await s.handle('alice','home')).state.followups[0].dueAt,NOW+86400000);
});
test('AI reviews reserve the shared quota once per request and enforce the fifteenth-message boundary',async()=>{
 let calls=0;const s=await seed({generate:async()=>{calls++;return 'A grounded review';}});
 const request={kind:'pitch',text:'A sufficiently detailed startup pitch for review',key:'review_1'};
 await s.handle('alice','coach',request);await s.handle('alice','coach',request);assert.equal(calls,1);
 for(let i=2;i<=15;i++)await s.handle('alice','coach',{...request,key:'review_'+i});
 await assert.rejects(s.handle('alice','coach',{...request,key:'review_16'}),e=>e.code==='ask_limit');
 assert.equal(calls,15);assert.equal((await db.collection('linkyUsage').doc('alice').get()).data().month.count,15);
});
test('failed AI processing refunds the reserved period and does not store a fake successful review',async()=>{
 const s=await seed({generate:async()=>{throw Error('provider error SECRET');}});
 await assert.rejects(s.handle('alice','coach',{kind:'pitch',text:'A sufficiently detailed pitch to review',key:'failure'}),/refunded/);
 assert.equal((await db.collection('linkyUsage').doc('alice').get()).data().month.count,0);
 assert.equal((await s.handle('alice','home')).state.coachRuns[0].status,'failed');
});
test('secret detection happens before quota use and context erasure discards in-flight output',async()=>{
 let release,started;const signal=new Promise(r=>{started=r;});
 const s=await seed({generate:async()=>{started();return new Promise(r=>release=r);}});
 await assert.rejects(s.handle('alice','coach',{kind:'blocker',text:'Please review my github_pat_private_token_example',key:'secret'}),/Remove credentials/);
 assert.equal((await db.collection('linkyUsage').doc('alice').get()).exists,false);
 const pending=s.handle('alice','coach',{kind:'pitch',text:'A sufficiently detailed pitch to review',key:'inflight'});await signal;
 await s.handle('alice','forget');release('This should not reappear');await assert.rejects(pending,/discarded/);
 assert.equal((await s.handle('alice','home')).state.coachRuns.length,0);assert.equal((await db.collection('linkyUsage').doc('alice').get()).data().month.count,0);
});
test('scheduled reminders are opt-in, content-private, deep-linked and idempotent under concurrent workers',async()=>{
 let pushes=0;const s=await seed({push:async()=>{pushes++;}});
 await s.handle('alice','followup',{targetUid:'bob',title:'PRIVATE PROJECT ACTION',note:'PRIVATE NOTE',dueAt:NOW});
 assert.equal((await s.runReminderPage()).delivered,0);
 await s.handle('alice','prefs',{reminders:true,inApp:true,push:true,timezone:'UTC'});
 await Promise.all([s.runReminderPage(),s.runReminderPage()]);
 const notifications=await db.collection('notifications').get();assert.equal(notifications.docs.length,1);assert.equal(pushes,1);
 const n=notifications.docs[0].data();assert.equal(n.section,'Follow-ups');assert.ok(!JSON.stringify(n).includes('PRIVATE'));assert.equal(n.serverPushManaged,true);
 assert.equal((await s.runReminderPage()).delivered,0);
});
test('public help requests respect current owner visibility and only the author can close or recognise feedback',async()=>{
 const s=await seed();const {askId}=await s.handle('alice','askCreate',{title:'Review our signup flow',details:'We need help understanding our onboarding friction.',question:'Where would you get stuck?',kind:'launch',compensation:'voluntary',minutes:10});
 await s.handle('bob','askFeedback',{id:askId,text:'The second screen requests too much information. Explain why each field is needed.'});
 const ask=(await s.handle('alice','asks')).asks[0];assert.equal(ask.feedback.length,1);
 await assert.rejects(s.handle('bob','askClose',{id:askId}),/author/);
 await assert.rejects(s.handle('bob','askFeedbackStatus',{id:askId,feedbackId:ask.feedback[0].id,outcome:'Useful'}),/author/);
 await s.handle('alice','askFeedbackStatus',{id:askId,feedbackId:ask.feedback[0].id,outcome:'We reduced the fields.'});
 await db.collection('users').doc('alice').update({isVisible:false});assert.equal((await s.handle('bob','asks')).asks.length,0);
});
test('meaningful momentum cannot grant blue verification, paid entitlements or credibility claims',async()=>{
 const s=await seed();await s.handle('alice','goal',{text:'Interview three customers'});const g=(await s.handle('alice','home')).state.goals[0];await s.handle('alice','goalDone',{id:g.id});
 await s.handle('alice','goalDone',{id:g.id});assert.equal((await s.handle('alice','home')).brief.momentumDays,1);
 const p=(await db.collection('users').doc('alice').get()).data();assert.equal(p.isVerified,undefined);assert.equal(p.isPro,undefined);
});
test('email remains disabled and clear-context cannot refill the paid AI ledger',async()=>{
 const s=await seed();await assert.rejects(s.handle('alice','prefs',{email:true}),/not configured/);
 await s.handle('alice','coach',{kind:'pitch',key:'kept_quota',text:'A sufficiently detailed startup pitch to review'});await s.handle('alice','forget');
 assert.equal((await db.collection('linkyUsage').doc('alice').get()).data().month.count,1);assert.equal((await s.handle('alice','home')).emailAvailable,false);
});

test('closed or hidden requests remain in their own author history and can be closed privately',async()=>{
 const s=await seed();const {askId}=await s.handle('alice','askCreate',{title:'Review this flow',details:'Actual context for a feedback request.',question:'Where are you confused?'});
 await db.collection('users').doc('alice').update({isVisible:false});
 assert.equal((await s.handle('bob','asks')).asks.length,0);
 await s.handle('alice','askClose',{id:askId});const own=await s.handle('alice','asks',{mine:true});assert.equal(own.asks[0].status,'closed');
 assert.equal((await s.handle('bob','asks',{mine:true})).asks.length,0);
});
test('real userIds match documents satisfy mutual connection without an older connection request',async()=>{
 const s=await seed();await db.collection('connectionRequests').doc('alice_bob').delete();await db.collection('matches').doc('alice_bob').set({userIds:['alice','bob'],participants:{alice:true,bob:true}});
 await s.handle('alice','followup',{targetUid:'bob',title:'Finish an agreed action',dueAt:NOW});
 assert.equal((await s.handle('alice','export')).state.followups.length,1);
});
test('Friday drop requires real sourced opportunities and concurrent workers produce a single snapshot',async()=>{
 const s=await seed();await s.handle('alice','prefs',{friday:true});await s.handle('alice','context',{project:'Real build',intent:'investors',needs:'angel funding'});
 const review=await s.handle('alice','weeklyReview');assert.ok(review.review.opportunities.length>0);assert.ok(review.review.opportunities.every(o=>o.sourceUrl.startsWith('https://')));
 await Promise.all([s.runReminderPage(),s.runReminderPage()]);const notes=await db.collection('notifications').get();assert.equal(notes.docs.length,1);assert.match(notes.docs[0].data().content,/newly curated/);
 const state=(await db.collection('builderStates').doc('alice').get()).data();assert.ok(state.deliveredOpportunityKeys.length>0);assert.equal((await s.runReminderPage()).delivered,0);
});
test('a blocked member can leave without gaining access to room contents',async()=>{
 const s=await seed(),roomId=await roomWithBob(s);await s.handle('bob','invitationRespond',{id:roomId+'_bob',decision:'accept'});
 await db.collection('blocks').doc('bob_alice').set({blockedById:'bob',blockedUserId:'alice'});
 await assert.rejects(s.handle('bob','room',{roomId}),/blocked/);await s.handle('bob','roomAction',{roomId,action:'leave'});
 assert.deepEqual((await db.collection('builderRooms').doc(roomId).get()).data().memberIds,['alice']);
});
test('author cap is atomic under concurrent ask creation',async()=>{
 const s=await seed();const input={title:'Review this flow',details:'Actual context for a feedback request.',question:'Where are you confused?'};
 const results=await Promise.allSettled(Array.from({length:7},()=>s.handle('alice','askCreate',input)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,5);assert.equal((await db.collection('builderAsks').get()).docs.length,5);
});
test('weekly summaries count actual incoming messages only from an available approved conversation',async()=>{
 const s=await seed();const match=db.collection('matches').doc('alice_bob');await match.set({userIds:['alice','bob']});
 await match.collection('messages').doc('incoming').set({senderId:'bob',content:'A real reply',timestamp:admin.firestore.Timestamp.fromMillis(NOW-1000)});
 await match.collection('messages').doc('outgoing').set({senderId:'alice',content:'My own message',timestamp:admin.firestore.Timestamp.fromMillis(NOW-900)});
 assert.equal((await s.handle('alice','weeklyReview')).review.chatReplies,1);
 await db.collection('blocks').doc('bob_alice').set({blockedById:'bob',blockedUserId:'alice'});
 assert.equal((await s.handle('alice','weeklyReview')).review.chatReplies,0);
});
test('private follow-ups can be edited and permanently removed without modifying another author state',async()=>{
 const s=await seed();await s.handle('alice','followup',{targetUid:'bob',title:'An agreed action',note:'Original note',reason:'Met through a pilot',dueAt:NOW});
 const f=(await s.handle('alice','export')).state.followups[0];
 await assert.rejects(s.handle('bob','followupEdit',{id:f.id,title:'Unwanted change',dueAt:NOW}),/not found/);
 await s.handle('alice','followupEdit',{id:f.id,title:'A revised agreed action',note:'Updated private note',reason:'Pilot follow-through',dueAt:NOW+86400000});
 assert.equal((await s.handle('alice','export')).state.followups[0].note,'Updated private note');
 await s.handle('alice','followupDelete',{id:f.id});assert.equal((await s.handle('alice','export')).state.followups.length,0);
});

test('recompleting the same room task on a later day cannot farm momentum',async()=>{
 let clock=NOW;const s=await seed({now:()=>clock}),{roomId}=await s.handle('alice','roomCreate',{title:'A real workspace'});
 await s.handle('alice','roomAction',{roomId,action:'task',text:'Complete a real milestone',assignee:'alice'});
 const task=(await s.handle('alice','room',{roomId})).room.tasks[0];await s.handle('alice','roomAction',{roomId,action:'taskDone',taskId:task.id});
 clock+=86400000;await s.handle('alice','roomAction',{roomId,action:'taskDone',taskId:task.id});
 assert.equal((await s.handle('alice','export')).state.momentumDays.length,1);
});
