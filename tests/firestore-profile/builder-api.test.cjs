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
 await seed();const client=env.authenticatedContext('alice').firestore();await assertFails(getDoc(doc(client,'builderRooms/secret/messages/secret')));await assertFails(setDoc(doc(client,'builderRooms/secret/messages/secret'),{authorId:'alice',text:'Forged'}));
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
test('groups replace accountability forms and only accepted members are added',async()=>{
 const s=await seed(),{groupId}=await s.handle('alice','groupCreate',{title:'A private group',kind:'accountability',memberIds:['mallory']});
 assert.equal((await s.handle('alice','groupGet',{groupId})).group.memberCount,1);
 await s.handle('alice','groupInvite',{groupId,targetUid:'bob'});await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});
 assert.equal((await s.handle('bob','groupGet',{groupId})).group.memberCount,2);
 await assert.rejects(s.handle('mallory','groupGet',{groupId}),e=>e.status===403);
});

test('project mutations retire with 410; group admin, leave and archive permissions remain enforced',async()=>{
 const s=await seed(),roomId=await roomWithBob(s),groupId=roomId;await s.handle('bob','invitationRespond',{id:roomId+'_bob',decision:'accept'});
 await assert.rejects(s.handle('alice','roomAction',{roomId,action:'task',text:'Retired form'}),e=>e.status===410);
 await assert.rejects(s.handle('bob','groupAction',{groupId,action:'archive'}),/admin/);
 await s.handle('bob','groupAction',{groupId,action:'leave'});await assert.rejects(s.handle('bob','groupGet',{groupId}),/not available/);
 await s.handle('alice','groupAction',{groupId,action:'archive'});await assert.rejects(s.handle('alice','groupSend',{groupId,key:'archived_message',text:'Not allowed'}),/archived/);
});

test('followups require approved connections and cannot send, read or update somebody else\'s note',async()=>{
 const s=await seed();await assert.rejects(s.handle('alice','followup',{targetUid:'mallory',title:'Follow up',note:'Private',dueAt:NOW}),/Connect mutually/);
 await s.handle('alice','followup',{targetUid:'bob',title:'Review the demo',note:'PRIVATE RELATIONSHIP NOTE',dueAt:NOW});
 const f=(await s.handle('alice','home')).state.followups[0];assert.equal((await s.handle('alice','followupDraft',{id:f.id})).sent,false);
 await assert.rejects(s.handle('bob','followupStatus',{id:f.id,status:'done'}),/not found/);
 const exported=await s.handle('bob','export');assert.ok(!JSON.stringify(exported).includes('PRIVATE RELATIONSHIP NOTE'));
 await s.handle('alice','followupStatus',{id:f.id,status:'snooze'});assert.equal((await s.handle('alice','home')).state.followups[0].dueAt,NOW+86400000);
});
test('retired Coach cannot call a model or spend the shared main-Linky quota',async()=>{
 let calls=0;const s=await seed({generate:async()=>{calls++;return 'Never run';}});
 for(const kind of ['pitch','blocker','plan'])await assert.rejects(s.handle('alice','coach',{kind,text:'Old-client Coach request',key:'review_1'}),e=>e.status===410);
 assert.equal(calls,0);assert.equal((await db.collection('linkyUsage').doc('alice').get()).exists,false);
});

test('retired Coach creates neither a failed review nor provider work',async()=>{
 const s=await seed({generate:async()=>{throw Error('Never call the provider');}});
 await assert.rejects(s.handle('alice','coach',{key:'failure'}),e=>e.status===410);
 assert.equal((await db.collection('linkyUsage').doc('alice').get()).exists,false);
 assert.equal((await s.handle('alice','home')).state.coachRuns.length,0);
});

test('group credentials are rejected before persistence and never enter the model ledger',async()=>{
 const s=await seed(),{groupId}=await s.handle('alice','groupCreate',{title:'A private group'});
 await assert.rejects(s.handle('alice','groupSend',{groupId,key:'secret',text:'Please review github_pat_private_token_example'}),/Remove credentials/);
 assert.equal((await db.collection('builderRooms').doc(groupId).collection('messages').get()).size,0);
 assert.equal((await db.collection('linkyUsage').doc('alice').get()).exists,false);
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
 await db.collection('linkyUsage').doc('alice').set({month:{count:1}});await s.handle('alice','forget');
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

test('retired room tasks and group chat never farm contribution points',async()=>{
 const s=await seed(),{groupId}=await s.handle('alice','groupCreate',{title:'A private group'});
 await assert.rejects(s.handle('alice','roomAction',{roomId:groupId,action:'taskDone',taskId:'old_task'}),e=>e.status===410);
 await s.handle('alice','groupSend',{groupId,key:'a_message',text:'An ordinary private conversation'});
 assert.equal((await db.collection('builderContributions').doc('alice').get()).exists,false);
});

test('group sends are idempotent, paginated in stable cursor order, private and non-AI',async()=>{
 const s=await seed(),{groupId}=await s.handle('alice','groupCreate',{title:'Private group'}),r=await s.handle('alice','groupSend',{groupId,key:'-first',text:'PRIVATE GROUP TEXT'});
 assert.equal((await s.handle('alice','groupSend',{groupId,key:'-first',text:'PRIVATE GROUP TEXT'})).replayed,true);
 await assert.rejects(s.handle('alice','groupSend',{groupId,key:'-first',text:'Different'}),e=>e.status===409);
 const rr=db.collection('builderRooms').doc(groupId),batch=db.batch();for(let i=0;i<56;i++)batch.set(rr.collection('messages').doc('page_'+String(i).padStart(3,'0')),{authorId:'alice',text:'Message '+i,at:NOW+i+1});await batch.commit();
 const latest=await s.handle('alice','groupMessages',{groupId});assert.equal(latest.messages.length,50);assert.equal(latest.more,true);assert.equal(latest.messages.at(-1).text,'Message 55');
 const earlier=await s.handle('alice','groupMessages',{groupId,before:latest.nextBefore});assert.equal(earlier.messages.length,7);assert.equal(earlier.messages[0].id,r.message.id);
 const newer=await s.handle('alice','groupMessages',{groupId,after:r.message.id});assert.equal(newer.messages.length,50);assert.equal(newer.messages[0].text,'Message 0');assert.equal(newer.more,true);
 await assert.rejects(s.handle('mallory','groupMessages',{groupId}),e=>e.status===403);
 const exported=await s.handle('alice','groupExport',{groupId});assert.equal(exported.messages.length,50);assert.match(exported.exportScope,/Latest 50/);
 assert.equal((await db.collection('linkyUsage').doc('alice').get()).exists,false);
});
test('block revokes group text in both directions but leaves safe membership controls',async()=>{
 const s=await seed(),groupId=await roomWithBob(s);await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});await s.handle('alice','groupSend',{groupId,key:'before_block',text:'PRIVATE GROUP TEXT'});
 await db.collection('blocks').doc('bob_alice').set({blockedById:'bob',blockedUserId:'alice'});
 for(const uid of ['alice','bob']){await assert.rejects(s.handle(uid,'groupMessages',{groupId}),e=>e.status===403);await assert.rejects(s.handle(uid,'groupSend',{groupId,key:'blocked_send',text:'No access'}),e=>e.status===403);}
 const owner=await s.handle('alice','groupGet',{groupId});assert.equal(owner.group.blocked,true);assert.deepEqual(owner.messages,[]);
 const list=await s.handle('bob','groups');assert.equal(list.groups[0].canLeave,true);assert.doesNotMatch(JSON.stringify(list),/PRIVATE GROUP TEXT|An actual project/);
 await s.handle('bob','groupAction',{groupId,action:'leave'});assert.equal((await s.handle('alice','groupGet',{groupId})).group.blocked,false);
});
test('only admin can transfer/remove/invite, and removed members cannot retrieve history',async()=>{
 const s=await seed(),groupId=await roomWithBob(s);await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});
 await assert.rejects(s.handle('bob','groupInvite',{groupId,targetUid:'mallory'}),/admin/);await assert.rejects(s.handle('bob','groupAction',{groupId,action:'transfer',targetUid:'alice'}),/admin/);
 await s.handle('alice','groupAction',{groupId,action:'transfer',targetUid:'bob'});await s.handle('bob','groupAction',{groupId,action:'remove',targetUid:'alice'});
 await assert.rejects(s.handle('alice','groupGet',{groupId}),e=>e.status===403);
 await assert.rejects(s.handle('alice','groupExport',{groupId}),e=>e.status===403);
});
test('a member limit of 32 cannot be bypassed by accepting an old pending invitation',async()=>{
 const s=await seed(),groupId=await roomWithBob(s),r=db.collection('builderRooms').doc(groupId);await r.update({memberIds:['alice',...Array.from({length:31},(_,i)=>'member_'+i)]});
 await assert.rejects(s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'}),/full/);assert.equal((await r.get()).data().memberIds.length,32);
});
test('invitation settings, bans and other-member blocks are checked before consent commits',async()=>{
 const s=await seed(),{groupId}=await s.handle('alice','groupCreate',{title:'Private group'});
 await s.handle('bob','prefs',{allowInvites:false});await assert.rejects(s.handle('alice','groupInvite',{groupId,targetUid:'bob'}),/paused/);
 await s.handle('bob','prefs',{allowInvites:true});await s.handle('alice','groupInvite',{groupId,targetUid:'bob'});
 await db.collection('blocks').doc('bob_alice').set({blockedById:'bob',blockedUserId:'alice'});await assert.rejects(s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'}),e=>e.status===403);
 await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'decline'});
});
test('public momentum is explicit, persists through publishing, and opt-out is immediate',async()=>{
 const s=await seed();assert.equal((await s.handle('alice','habit')).publicMomentum,false);
 await assert.rejects(s.handle('alice','habitPrefs',{publicMomentum:'true'}));
 await s.handle('alice','habitPrefs',{publicMomentum:true});await s.handle('alice','shipUpdate',{key:'public_test',text:'Tested signup and removed one unnecessary field.'});
 assert.equal((await s.handle('alice','habit')).publicMomentum,true);
 await s.handle('alice','habitPrefs',{publicMomentum:false});assert.equal((await db.collection('builderContributions').doc('alice').get()).data().publicMomentum,false);
 await db.collection('users').doc('alice').update({isVisible:false});await assert.rejects(s.handle('alice','habitPrefs',{publicMomentum:true}),/profile public/);
});
test('public SSR filters real source visibility, omits private text, and removes opted-out calendars',async()=>{
 const s=await seed(),{createPublicSeoHandler}=await import('../../api/publicSeo.js');await s.handle('alice','habitPrefs',{publicMomentum:true});await s.handle('alice','shipUpdate',{key:'public_render',text:'PRIVATE UPDATE TEXT that must never be indexed.'});
 const handler=createPublicSeoHandler(()=>db),request=async query=>{const r={headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},send(v){this.body=v;return this;}};await handler({method:'GET',query},r);return r;};
 const p=await request({mode:'momentum-profile',uid:'alice'});assert.equal(p.code,200);assert.match(p.body,/#FBE618/);assert.doesNotMatch(p.body,/PRIVATE UPDATE TEXT/);assert.equal(p.headers['Cache-Control'],'private, no-store');
 const board=await request({mode:'league-json',period:'week',uid:'alice'});assert.equal(JSON.parse(board.body).me.uid,'alice');assert.doesNotMatch(board.body,/PRIVATE UPDATE TEXT/);
 await s.handle('alice','habitPrefs',{publicMomentum:false});assert.equal((await request({mode:'momentum-profile',uid:'alice'})).code,404);assert.equal(JSON.parse((await request({mode:'league-json'})).body).rows.length,0);
});
test('deleted accounts lose authored group data even after leaving; other members retain their conversation',async()=>{
 const s=await seed(),groupId=await roomWithBob(s);await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});await s.handle('bob','groupSend',{groupId,key:'erase_me',text:'PRIVATE DELETED TEXT'});await s.handle('bob','groupAction',{groupId,action:'leave'});
 await db.collection('users').doc('bob').delete();await db.collection('builderStates').doc('bob').delete();await s.runReminderPage();const r=db.collection('builderRooms').doc(groupId);assert.equal((await r.collection('messages').get()).size,0);assert.doesNotMatch(JSON.stringify((await r.get()).data()),/PRIVATE DELETED TEXT/);assert.deepEqual((await r.get()).data().memberIds,['alice']);
});
