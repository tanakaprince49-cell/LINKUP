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
 // `reminders` is the opt-in that governs the follow-up path; without it the
 // due follow-up produces nothing at all.
 const followups=async()=>(await db.collection('notifications').get()).docs.filter(d=>d.data().section==='Follow-ups');
 await s.handle('alice','followup',{targetUid:'bob',title:'PRIVATE PROJECT ACTION',note:'PRIVATE NOTE',dueAt:NOW});
 assert.equal((await followups()).length,0);
 await s.handle('alice','prefs',{reminders:true,inApp:true,push:true,timezone:'UTC'});
 await Promise.all([s.runReminderPage(),s.runReminderPage()]);
 const docs=await followups();assert.equal(docs.length,1);assert.equal(pushes,1);
 const n=docs[0].data();assert.ok(!JSON.stringify(n).includes('PRIVATE'));assert.equal(n.serverPushManaged,true);
 assert.ok(String(n.url||'').startsWith('/'),'deep link into the app');
 await s.runReminderPage();assert.equal((await followups()).length,1);assert.equal(pushes,1);
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
 await db.collection('linkyUsage').doc('alice').set({daily:{key:'2026-10-24',count:1}});await s.handle('alice','forget');
 assert.equal((await db.collection('linkyUsage').doc('alice').get()).data().daily.count,1);assert.equal((await s.handle('alice','home')).emailAvailable,false);
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
 await Promise.all([s.runReminderPage(),s.runReminderPage()]);
 // Retention may also deliver one truthful midday message; the Friday drop
 // itself must still appear exactly once across two concurrent workers.
 const drops=(await db.collection('notifications').get()).docs.filter(d=>d.data().section==='Leads');
 assert.equal(drops.length,1);
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
 const handler=createPublicSeoHandler(()=>db,undefined,undefined,()=>NOW),request=async query=>{const r={headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},send(v){this.body=v;return this;}};await handler({method:'GET',query},r);return r;};
 const p=await request({mode:'momentum-profile',uid:'alice'});assert.equal(p.code,200);assert.match(p.body,/#FBE618/);assert.doesNotMatch(p.body,/PRIVATE UPDATE TEXT/);assert.equal(p.headers['Cache-Control'],'private, no-store');
 const board=await request({mode:'league-json',period:'week',uid:'alice'});assert.equal(JSON.parse(board.body).me.uid,'alice');assert.doesNotMatch(board.body,/PRIVATE UPDATE TEXT/);
 await s.handle('alice','habitPrefs',{publicMomentum:false});assert.equal((await request({mode:'momentum-profile',uid:'alice'})).code,404);assert.equal(JSON.parse((await request({mode:'league-json'})).body).rows.length,0);
});
test('deleted accounts lose authored group data even after leaving; other members retain their conversation',async()=>{
 const s=await seed(),groupId=await roomWithBob(s);await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});await s.handle('bob','groupSend',{groupId,key:'erase_me',text:'PRIVATE DELETED TEXT'});await s.handle('bob','groupAction',{groupId,action:'leave'});
 await db.collection('users').doc('bob').delete();await db.collection('builderStates').doc('bob').delete();await s.runReminderPage();const r=db.collection('builderRooms').doc(groupId);assert.equal((await r.collection('messages').get()).size,0);assert.doesNotMatch(JSON.stringify((await r.get()).data()),/PRIVATE DELETED TEXT/);assert.deepEqual((await r.get()).data().memberIds,['alice']);
});

test('accepted groups automatically become private inbox rows with muted/pinned preferences',async()=>{
 const s=await seed(),groupId=await roomWithBob(s);assert.equal((await s.handle('bob','groups')).groups.length,0);await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});assert.equal((await s.handle('bob','groups')).groups[0].id,groupId);
 await s.handle('bob','groupPrefs',{groupId,muted:true,pinned:true});const row=(await s.handle('bob','groups')).groups[0];assert.deepEqual(row.preferences,{muted:true,pinned:true});
 const count=(await db.collection('notifications').where('userId','==','bob').get()).size;await s.handle('alice','groupSend',{groupId,key:'muted',text:'A useful private update.'});assert.equal((await db.collection('notifications').where('userId','==','bob').get()).size,count);
 await s.handle('bob','groupPrefs',{groupId,muted:false});await s.handle('alice','groupSend',{groupId,key:'alert',text:'Another useful private update.'});const notifications=await db.collection('notifications').where('userId','==','bob').get();assert.ok(notifications.docs.some(d=>d.data().targetUrl==='/groups/'+groupId));assert.doesNotMatch(JSON.stringify(notifications.docs.map(d=>d.data())),/Another useful private update/);
});
test('co-admins can add admins and moderate members; owner retains ultimate authority',async()=>{
 const s=await seed(),groupId=await roomWithBob(s);await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});await s.handle('alice','groupAction',{groupId,action:'promote',targetUid:'bob'});
 await db.collection('connectionRequests').doc('bob_mallory').set({senderId:'bob',recipientId:'mallory',status:'approved'});await s.handle('bob','groupInvite',{groupId,targetUid:'mallory'});await s.handle('mallory','groupRespond',{id:groupId+'_mallory',decision:'accept'});
 await s.handle('bob','groupAction',{groupId,action:'promote',targetUid:'mallory'});await s.handle('alice','groupAction',{groupId,action:'demote',targetUid:'mallory'});await assert.rejects(s.handle('bob','groupAction',{groupId,action:'remove',targetUid:'alice'}),/owner/);
 await s.handle('bob','groupAction',{groupId,action:'ban',targetUid:'mallory'});await assert.rejects(s.handle('mallory','groupGet',{groupId}),e=>e.status===403);await s.handle('alice','groupAction',{groupId,action:'demote',targetUid:'bob'});await assert.rejects(s.handle('bob','groupUpdate',{groupId,rules:'No spam'}),e=>e.status===403);
});
test('owner invitations can explicitly offer an admin role and cannot bypass recipient consent',async()=>{
 const s=await seed(),{groupId}=await s.handle('alice','groupCreate',{title:'Admin invitation group'});await s.handle('alice','groupInvite',{groupId,targetUid:'bob',role:'admin'});const inv=(await s.handle('bob','groups')).invitations[0];assert.equal(inv.role,'admin');assert.equal((await s.handle('bob','groups')).groups.length,0);
 await s.handle('bob','groupRespond',{id:inv.id,decision:'accept'});assert.ok((await s.handle('bob','groupGet',{groupId})).group.adminIds.includes('bob'));
});
test('bans block old invitations and re-invites until explicitly lifted',async()=>{
 const s=await seed(),groupId=await roomWithBob(s);await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});await s.handle('alice','groupAction',{groupId,action:'ban',targetUid:'bob'});await assert.rejects(s.handle('alice','groupInvite',{groupId,targetUid:'bob'}),/Unban/);
 await s.handle('alice','groupAction',{groupId,action:'unban',targetUid:'bob'});assert.equal((await s.handle('bob','groups')).groups.length,0);await s.handle('alice','groupInvite',{groupId,targetUid:'bob'});await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});assert.equal((await s.handle('bob','groupGet',{groupId})).group.memberCount,2);
});
test('group photos, bio, rules and announcements are admin-only and cannot forge identity badges',async()=>{
 const s=await seed(),groupId=await roomWithBob(s);await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});await assert.rejects(s.handle('bob','groupUpdate',{groupId,photo:'https://example.com/a.png'}),e=>e.status===403);
 await s.handle('alice','groupUpdate',{groupId,description:'Our builder bio',rules:'Be kind. No spam.',photo:'https://example.com/a.png',announcementsOnly:true,creatorId:'FvxIfciyHMfQZbLwziZpseMNKxC3',creatorPlus:true,verified:true});const g=(await s.handle('bob','groupGet',{groupId})).group;assert.equal(g.description,'Our builder bio');assert.equal(g.rules,'Be kind. No spam.');assert.equal(g.photo,'https://example.com/a.png');assert.equal(g.gold,false);assert.equal(g.verified,false);
 await assert.rejects(s.handle('bob','groupSend',{groupId,key:'ordinary',text:'Not an announcement'}),/Only admins/);await s.handle('alice','groupSend',{groupId,key:'announcement',text:'An admin announcement'});await s.handle('alice','groupAction',{groupId,action:'promote',targetUid:'bob'});await s.handle('bob','groupSend',{groupId,key:'coadmin',text:'A co-admin announcement'});
 await assert.rejects(s.handle('alice','groupUpdate',{groupId,photo:'javascript:alert(1)'}));await assert.rejects(s.handle('alice','groupUpdate',{groupId,rules:'github_pat_private_token_example'}),/credentials/);
});
test('PLUS group and member checks are server-derived; CEO-created groups keep both checks after transfer',async()=>{
 const ceo='FvxIfciyHMfQZbLwziZpseMNKxC3',s=await seed({plus:async(uid,u)=>u?.isPro===true});await db.collection('users').doc('alice').update({isPro:true});await db.collection('users').doc(ceo).set(profile('CEO'));await db.collection('connectionRequests').doc(ceo+'_bob').set({senderId:ceo,recipientId:'bob',status:'approved'});
 const {groupId}=await s.handle('alice','groupCreate',{title:'PLUS-created group'});const pg=(await s.handle('alice','groupGet',{groupId})).group;assert.equal(pg.verified,true);assert.equal(pg.gold,false);assert.equal(pg.members[0].verified,true);
 const {groupId:gold}=await s.handle(ceo,'groupCreate',{title:'CEO-created group'});await s.handle(ceo,'groupInvite',{groupId:gold,targetUid:'bob'});await s.handle('bob','groupRespond',{id:gold+'_bob',decision:'accept'});await s.handle(ceo,'groupAction',{groupId:gold,action:'transfer',targetUid:'bob'});const gg=(await s.handle('bob','groupGet',{groupId:gold})).group;assert.equal(gg.gold,true);assert.equal(gg.verified,true);assert.equal(gg.members.find(m=>m.uid===ceo).verified,true);
});
test('reply, own edit and reactions work; moderators delete/pin without leaking deleted quotes',async()=>{
 const s=await seed(),groupId=await roomWithBob(s);await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});const a=(await s.handle('alice','groupSend',{groupId,key:'original',text:'Original private message'})).message;
 await s.handle('bob','groupSend',{groupId,key:'reply',text:'A thoughtful reply',replyTo:a.id});await assert.rejects(s.handle('bob','groupMessageAction',{groupId,messageId:a.id,action:'edit',text:'Forged edit'}),e=>e.status===403);await assert.rejects(s.handle('bob','groupMessageAction',{groupId,messageId:a.id,action:'pin'}),e=>e.status===403);
 await s.handle('alice','groupMessageAction',{groupId,messageId:a.id,action:'edit',text:'Updated private message'});await s.handle('bob','groupMessageAction',{groupId,messageId:a.id,action:'react',emoji:'👍'});await s.handle('alice','groupMessageAction',{groupId,messageId:a.id,action:'pin'});assert.equal((await s.handle('alice','groupGet',{groupId})).group.pinnedMessage.text,'Updated private message');
 await s.handle('alice','groupMessageAction',{groupId,messageId:a.id,action:'delete'});const page=await s.handle('bob','groupMessages',{groupId,revision:0});assert.equal(page.messages.find(m=>m.replyTo===a.id).reply.text,'Message deleted');assert.equal(page.changes.find(m=>m.id===a.id).deleted,true);assert.doesNotMatch(JSON.stringify(page),/Updated private message|Original private message/);assert.equal((await s.handle('alice','groupGet',{groupId})).group.pinnedMessage,null);
});
test('revision journal catches edits outside the latest fifty and requests reset after a journal gap',async()=>{
 const s=await seed(),{groupId}=await s.handle('alice','groupCreate',{title:'Long conversation'}),rr=db.collection('builderRooms').doc(groupId),batch=db.batch();for(let i=0;i<65;i++)batch.set(rr.collection('messages').doc('history_'+i),{authorId:'alice',text:'History '+i,at:NOW+i});await batch.commit();await s.handle('alice','groupMessageAction',{groupId,messageId:'history_0',action:'delete'});const changed=await s.handle('alice','groupMessages',{groupId,revision:0});assert.equal(changed.messages.length,50);assert.ok(changed.changes.some(m=>m.id==='history_0'&&m.deleted));
 await rr.update({revision:200,recentChanges:[{id:'history_1',version:200}]});assert.equal((await s.handle('alice','groupMessages',{groupId,revision:1})).refreshRequired,true);const polled=await s.handle('alice','groupMessages',{groupId,revision:200});assert.equal(polled.revision,200);assert.equal(polled.messages.length,0);assert.equal(polled.refreshRequired,false);assert.equal(polled.settings.title,'Long conversation');
});
test('blocked group members can undo their own block, and removing co-admins removes privileges',async()=>{
 const s=await seed(),groupId=await roomWithBob(s);await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});await s.handle('bob','groupBlock',{groupId,targetUid:'alice'});await assert.rejects(s.handle('bob','groupMessages',{groupId}),e=>e.status===403);await s.handle('bob','groupBlock',{groupId,targetUid:'alice',blocked:false});assert.equal((await s.handle('bob','groupGet',{groupId})).group.blocked,false);
 await s.handle('alice','groupAction',{groupId,action:'promote',targetUid:'bob'});await s.handle('bob','groupAction',{groupId,action:'leave'});assert.ok(!(await db.collection('builderRooms').doc(groupId).get()).data().adminIds.includes('bob'));
});
test('public Momentum profile embeds its calendar only after explicit opt-in; PNG cards obey the same gate',async()=>{
 const s=await seed(),{createPublicSeoHandler}=await import('../../api/publicSeo.js'),handler=createPublicSeoHandler(()=>db);const request=async query=>{const r={setHeader(){},status(c){this.code=c;return this;},send(b){this.body=b;return this;}};await handler({method:'GET',query},r);return r;};
 await s.handle('alice','shipUpdate',{key:'card_test',text:'Private progress note that must not become public.'});assert.equal((await request({mode:'momentum-card',uid:'alice'})).code,404);assert.doesNotMatch((await request({mode:'profile',uid:'alice'})).body,/Public Builder Momentum/);
 await s.handle('alice','habitPrefs',{publicMomentum:true});const p=await request({mode:'profile',uid:'alice'});assert.match(p.body,/Public Builder Momentum/);assert.doesNotMatch(p.body,/Private progress note/);const card=await request({mode:'momentum-card',uid:'alice'});assert.equal(card.code,200);assert.ok(Buffer.isBuffer(card.body));assert.deepEqual([...card.body.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 await db.collection('users').doc('alice').update({isVisible:false});assert.equal((await request({mode:'momentum-card',uid:'alice'})).code,404);await db.collection('users').doc('alice').update({isVisible:true,banned:true});assert.equal((await request({mode:'momentum-card',uid:'alice'})).code,404);await db.collection('users').doc('alice').update({banned:false});await s.handle('alice','habitPrefs',{publicMomentum:false});assert.equal((await request({mode:'momentum-card',uid:'alice'})).code,404);
});

test('co-admins can invite another consenting co-admin but cannot transfer or demote the owner',async()=>{
 const s=await seed(),groupId=await roomWithBob(s);await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});await s.handle('alice','groupAction',{groupId,action:'promote',targetUid:'bob'});await db.collection('connectionRequests').doc('bob_mallory').set({senderId:'bob',recipientId:'mallory',status:'approved'});
 await s.handle('bob','groupInvite',{groupId,targetUid:'mallory',role:'admin'});assert.equal((await s.handle('mallory','groups')).invitations[0].role,'admin');await s.handle('mallory','groupRespond',{id:groupId+'_mallory',decision:'accept'});assert.ok((await s.handle('mallory','groupGet',{groupId})).group.adminIds.includes('mallory'));
 await assert.rejects(s.handle('bob','groupAction',{groupId,action:'transfer',targetUid:'mallory'}),/owner/);await assert.rejects(s.handle('mallory','groupAction',{groupId,action:'demote',targetUid:'alice'}),/owner/);
});

test('legacy owner alone never fabricates a CEO-created or PLUS-created group provenance',async()=>{
 const ceo='FvxIfciyHMfQZbLwziZpseMNKxC3',s=await seed({plus:async()=>true});await db.collection('users').doc(ceo).set(profile('CEO'));await db.collection('builderRooms').doc('legacy-group').set({kind:'group',title:'Legacy origin unknown',ownerId:ceo,memberIds:[ceo,'bob'],createdAt:NOW,updatedAt:NOW,readAt:{}});
 let group=(await s.handle(ceo,'groupGet',{groupId:'legacy-group'})).group;assert.equal(group.gold,false);assert.equal(group.verified,false);await s.handle(ceo,'groupAction',{groupId:'legacy-group',action:'transfer',targetUid:'bob'});group=(await s.handle('bob','groupGet',{groupId:'legacy-group'})).group;assert.equal(group.gold,false);assert.equal(group.creatorId,'');
});

test('daily picks are two stable live-eligible people, rotate on the next local day and recheck blocks',async()=>{
 let clock=NOW;const s=await seed({now:()=>clock});for(let i=0;i<8;i++){const uid='daily_'+i;await db.collection('users').doc(uid).set(profile(uid));await db.collection('publicProfiles').doc(uid).set({displayName:uid});}await db.collection('users').doc('daily_0').update({banned:true});
 const a=await s.handle('alice','dailyPicks',{timeZone:'Africa/Harare'}),b=await s.handle('alice','dailyPicks',{timeZone:'Africa/Harare'});assert.equal(a.people.length,2);assert.deepEqual(a.people.map(p=>p.uid),b.people.map(p=>p.uid));assert.ok(!a.people.some(p=>p.uid==='daily_0'));await db.collection('blocks').doc('alice_'+a.people[0].uid).set({blockedById:'alice',blockedUserId:a.people[0].uid});assert.ok(!(await s.handle('alice','dailyPicks',{timeZone:'Africa/Harare'})).people.some(p=>p.uid===a.people[0].uid));clock+=86400000;const c=await s.handle('alice','dailyPicks',{timeZone:'Africa/Harare'});assert.notEqual(c.day,a.day);assert.equal(c.people.length,2);
});
test('only the owner can delete a group forever; messages, invitations and notifications are physically removed',async()=>{
 const s=await seed(),groupId=await roomWithBob(s);await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});await s.handle('alice','groupAction',{groupId,action:'promote',targetUid:'bob'});await s.handle('alice','groupSend',{groupId,key:'erase',text:'Erase this private group message.'});await assert.rejects(s.handle('bob','groupDelete',{groupId}),e=>e.status===403);
 await s.handle('alice','groupDelete',{groupId});assert.equal((await db.collection('builderRooms').doc(groupId).get()).exists,false);assert.equal((await db.collection('builderRooms').doc(groupId).collection('messages').get()).size,0);assert.equal((await db.collection('builderInvites').where('roomId','==',groupId).get()).size,0);assert.equal((await db.collection('notifications').where('targetUrl','==','/groups/'+groupId).get()).size,0);await assert.rejects(s.handle('bob','groupGet',{groupId}),e=>e.status===403);
});
test('prepared source briefs use only the caller context, remain private and send nothing',async()=>{
 const s=await seed({now:()=>Date.parse('2026-10-24T12:00Z')});await s.handle('alice','context',{project:'Alice private project',goal:'Test a product'});await s.handle('bob','context',{project:'Bob private secret'});const r=await s.handle('alice','leadBrief',{id:'startup-school'});assert.match(r.text,/Alice private project/);assert.doesNotMatch(r.text,/Bob private/);assert.equal(r.sent,false);assert.equal((await db.collection('notifications').get()).size,0);
});

test('permanent deletion revokes access before a bounded background sweep erases a large history',async()=>{
 const s=await seed(),groupId=await roomWithBob(s);await s.handle('bob','groupRespond',{id:groupId+'_bob',decision:'accept'});const rr=db.collection('builderRooms').doc(groupId);for(let start=0;start<1220;start+=400){const batch=db.batch();for(let i=start;i<Math.min(1220,start+400);i++)batch.set(rr.collection('messages').doc('bulk_'+i),{authorId:'alice',text:'Private retained history',at:NOW+i});await batch.commit();}
 await assert.rejects(s.handle('bob','groupDelete',{groupId}),e=>e.status===403);const remaining=(await rr.collection('messages').get()).size;assert.ok(remaining>0);await s.handle('alice','groupDelete',{groupId});const after=(await rr.get()).exists?((await rr.collection('messages').get()).size):0;assert.ok(after===0||after<remaining);await assert.rejects(s.handle('bob','groupMessages',{groupId}),e=>e.status===403);await s.handle('alice','groupDelete',{groupId});const {sweepDeletingGroups}=await import('../../api/_groups.js');await sweepDeletingGroups(db);assert.equal((await rr.get()).exists,false);assert.equal((await rr.collection('messages').get()).size,0);
});

test('weekly champion reward: one winner, one claim, seven days, then locked forever',async()=>{
 const s=await seed(),weekEnd=Date.parse('2026-10-19T00:00:00Z'),DAY=86400000;
 await db.collection('campaignRewards').doc('2026-10-12').set({weekKey:'2026-10-12',uid:'alice',status:'available',points:40,buildDays:4,helpful:0,weekEnd,claimBy:weekEnd+7*DAY,awardedAt:weekEnd});
 const read=await s.handle('alice','campaignReward');assert.equal(read.status,'available');assert.equal(read.runDays,7);assert.equal(read.placementsMax,2);
 const creative={productName:'Alice app',tagline:'Invoices in one minute',description:'A real description of the product.',website:'https://example.com/app'};
 await assert.rejects(s.handle('bob','campaignRewardClaim',{weekKey:'2026-10-12',name:'Bob launch',creative,industries:[],placements:['ideas']}),e=>e.status===403);
 await assert.rejects(s.handle('alice','campaignRewardClaim',{weekKey:'2026-10-12',name:'No link',creative:{...creative,website:'javascript:alert(1)'},placements:['ideas']}),/https/);
 const claimed=await s.handle('alice','campaignRewardClaim',{weekKey:'2026-10-12',name:'Alice launch',creative,industries:['SaaS'],placements:['ideas','search','news']});
 const campaign=(await db.collection('campaigns').doc(claimed.campaignId).get()).data();
 assert.equal(campaign.status,'pending_review');assert.equal(campaign.reward,true);assert.equal(campaign.rewardWeek,'2026-10-12');assert.deepEqual(campaign.placements,['ideas','search']);assert.equal(campaign.statsImpressions,0);
 const again=await s.handle('alice','campaignReward');assert.equal(again.status,'claimed');assert.equal(again.campaign.id,claimed.campaignId);
 await assert.rejects(s.handle('alice','campaignRewardClaim',{weekKey:'2026-10-12',name:'Second launch',creative,placements:['ideas']}),e=>e.status===409);
 const old=await seed();await db.collection('campaignRewards').doc('2026-10-05').set({weekKey:'2026-10-05',uid:'alice',status:'available',points:10,buildDays:1,weekEnd:weekEnd-7*DAY,claimBy:weekEnd-DAY,awardedAt:weekEnd-7*DAY});
 assert.equal((await old.handle('alice','campaignReward')).status,'expired');
 await assert.rejects(old.handle('alice','campaignRewardClaim',{weekKey:'2026-10-05',name:'Too late',creative,placements:['ideas']}),e=>e.status===410);
});

test('reward campaigns start a seven-day clock, are deleted permanently and never linger unapproved',async()=>{
 const {reconcileCampaignRewards}=await import('../../api/_campaignReward.js');
 const s=await seed(),DAY=86400000,weekEnd=Date.parse('2026-10-19T00:00:00Z'),creative={productName:'Product',tagline:'A tagline long enough',description:'',website:'https://example.com'};
 await db.collection('campaignRewards').doc('2026-10-12').set({weekKey:'2026-10-12',uid:'alice',status:'available',points:30,buildDays:3,weekEnd,claimBy:weekEnd+7*DAY,awardedAt:weekEnd});
 const {campaignId}=await s.handle('alice','campaignRewardClaim',{weekKey:'2026-10-12',name:'Reward ad',creative,placements:['ideas']});
 await db.collection('campaigns').doc(campaignId).update({status:'active'});
 const started=await reconcileCampaignRewards(db,NOW);assert.equal(started.started,1);
 const live=(await db.collection('campaigns').doc(campaignId).get()).data();assert.equal(live.expiresAtSource,'league-reward');assert.equal(live.expiresAt.toMillis()-NOW,7*DAY);
 const stillThere=await reconcileCampaignRewards(db,NOW+6*DAY);assert.equal(stillThere.deleted,0);
 const done=await reconcileCampaignRewards(db,NOW+8*DAY);assert.equal(done.deleted,1);
 assert.equal((await db.collection('campaigns').doc(campaignId).get()).exists,false);
 assert.equal((await db.collection('campaignRewards').doc('2026-10-12').get()).data().status,'completed');
 const audit=(await db.collection('campaignRewardsAudit').doc('2026-10-12').get()).data();
 assert.equal(audit.uid,'alice');assert.equal(audit.campaignId,campaignId);assert.ok(!JSON.stringify(audit).includes('Reward ad'),'audit keeps no creative text');
 // Never approved in time: removed, not parked in review forever.
 await seed();await db.collection('campaignRewards').doc('2026-10-12').set({weekKey:'2026-10-12',uid:'alice',status:'claimed',weekEnd,claimBy:weekEnd+7*DAY,claimedAt:weekEnd,activationDeadline:weekEnd+2*DAY,campaignId:'pending-one'});
 await db.collection('campaigns').doc('pending-one').set({ownerId:'alice',name:'Pending ad',status:'pending_review',reward:true,rewardWeek:'2026-10-12',statsImpressions:0,statsClicks:0});
 const swept=await reconcileCampaignRewards(db,weekEnd+3*DAY);assert.equal(swept.deleted,1);
 assert.equal((await db.collection('campaigns').doc('pending-one').get()).exists,false);
 assert.equal((await db.collection('campaignRewards').doc('2026-10-12').get()).data().completion,'not-approved-in-time');
});

test('rewards are server-write only and private to their winner',async()=>{
 const s=await seed();await db.collection('campaignRewards').doc('2026-10-12').set({weekKey:'2026-10-12',uid:'alice',status:'available',points:10,claimBy:NOW+86400000});
 const alice=env.authenticatedContext('alice').firestore(),bob=env.authenticatedContext('bob').firestore();
 await assertFails(setDoc(doc(alice,'campaignRewards/2026-10-12'),{uid:'alice',status:'available',points:9999}));
 await assertFails(getDoc(doc(bob,'campaignRewards/2026-10-12')));
 await assertFails(getDoc(doc(bob,'campaignRewardsAudit/2026-10-12')));
});

test('the weekly grant and the monthly title are decided from real opt-in activity, once',async()=>{
 const {awardWeeklyChampion}=await import('../../api/_campaignReward.js');
 const {awardSeasonChampion}=await import('../../api/_leagueChampions.js');
 const {awardWeek}=await import('../../shared/campaign-reward.js');
 const {assertSucceeds}=require('@firebase/rules-unit-testing');
 await seed();
 // Two opted-in builders: alice recorded three days last week, bob two.
 const week=Date.parse('2026-10-24T09:00:00Z'),award=awardWeek(week);
 await db.collection('builderContributions').doc('alice').set({publicMomentum:true,points:30,totalUpdates:3,days:['2026-10-12','2026-10-14','2026-10-16'],habit:{earnedCredits:0,credits:0,awards:[]}});
 await db.collection('builderContributions').doc('bob').set({publicMomentum:true,points:20,totalUpdates:2,days:['2026-10-13','2026-10-15'],habit:{earnedCredits:0,credits:0,awards:[]}});
 await db.collection('users').doc('bob').update({isVisible:false});
 const granted=await awardWeeklyChampion(db,week);assert.equal(granted.granted,true);assert.equal(granted.weekKey,award.weekKey);
 const reward=(await db.collection('campaignRewards').doc(award.weekKey).get()).data();
 assert.equal(reward.uid,'alice');assert.equal(reward.status,'available');assert.equal(reward.points,30);
 // A hidden profile is excluded even if it opted in.
 const again=await awardWeeklyChampion(db,week);assert.equal(again.skipped,true);
 const win=(await db.collection('notifications').doc('league_win_week_'+award.weekKey).get()).data();assert.equal(win.userId,'alice');assert.equal(win.type,'league');assert.equal(win.isRead,false);
 // A week with nothing recorded gets no invented champion.
 const empty=await awardWeeklyChampion(db,award.end+8*86400000);assert.equal(empty.granted,false);
 assert.equal((await db.collection('campaignRewards').doc(awardWeek(award.end+8*86400000).weekKey).get()).data().status,'no-winner');
 // Same for a month: September has no activity in this fixture.
 await db.collection('users').doc('bob').update({isVisible:true});
 const month=await awardSeasonChampion(db,'month',week);assert.equal(month.granted,false);
 const client=env.authenticatedContext('alice').firestore();
 await assertSucceeds(getDoc(doc(client,'leagueChampions/month-2026-09')));
 await assertFails(setDoc(doc(client,'leagueChampions/month-2026-09'),{uid:'alice',status:'champion',points:9999}));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'leagueChampions/month-2026-09')));
});
test('created groups are discoverable and strangers can browse then join them',async()=>{
 const s=await seed();
 const a=await s.handle('alice','groupCreate',{title:'Harare builders',description:'Build in public.'});
 const b=await s.handle('alice','groupCreate',{title:'Design circle',description:'Critique welcomed.'});
 await db.collection('builderRooms').doc(b.groupId).update({updatedAt:NOW+1000});
 await s.handle('alice','groupSend',{groupId:a.groupId,key:'welcome',text:'PRIVATE GROUP TEXT'});
 const first=await s.handle('mallory','groupDiscover',{limit:1});
 assert.equal(first.groups.length,1);assert.equal(first.total,2);assert.ok(first.nextAfter);
 assert.equal(first.groups[0].id,b.groupId);
 const second=await s.handle('mallory','groupDiscover',{limit:1,after:first.nextAfter});
 assert.equal(second.groups.length,1);assert.equal(second.nextAfter,null);
 assert.equal(second.groups[0].id,a.groupId);
 const card=second.groups[0];
 assert.equal(card.title,'Harare builders');assert.equal(card.description,'Build in public.');
 assert.equal(card.memberCount,1);assert.equal(card.discoverable,true);assert.equal(card.joined,false);
 assert.deepEqual(Object.keys(card).sort(),['badges','createdAt','description','discoverable','id','joined','memberCount','photo','title','updatedAt']);
 assert.doesNotMatch(JSON.stringify(first)+JSON.stringify(second),/PRIVATE/);
 const found=await s.handle('mallory','groupDiscover',{q:'design'});
 assert.equal(found.groups.length,1);assert.equal(found.groups[0].id,b.groupId);
 const joined=await s.handle('mallory','groupJoin',{groupId:a.groupId});
 assert.deepEqual(joined,{ok:true,joined:true});
 assert.equal((await s.handle('mallory','groupGet',{groupId:a.groupId})).group.memberCount,2);
 assert.equal((await s.handle('mallory','groupDiscover',{q:'harare'})).groups[0].joined,true);
});
test('unlisted, archived and banned groups cannot be browsed or joined',async()=>{
 const s=await seed();
 const {groupId}=await s.handle('alice','groupCreate',{title:'Secret builders'});
 await s.handle('alice','groupUpdate',{groupId,discoverable:false});
 assert.equal((await s.handle('mallory','groupDiscover',{})).groups.length,0);
 await assert.rejects(s.handle('mallory','groupJoin',{groupId}),/private/);
 await s.handle('alice','groupUpdate',{groupId,discoverable:true});
 assert.equal((await s.handle('mallory','groupDiscover',{})).groups.length,1);
 await s.handle('alice','groupAction',{groupId,action:'archive'});
 assert.equal((await s.handle('mallory','groupDiscover',{})).groups.length,0);
 await assert.rejects(s.handle('mallory','groupJoin',{groupId}),/not available/);
});
