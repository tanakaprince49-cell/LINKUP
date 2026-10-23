const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc}=require('firebase/firestore');
const admin=require('firebase-admin');
let env,app,db,createBuilderService;
const NOW=Date.parse('2026-10-23T12:00:00Z'),DAY=86400000;
before(async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Contribution tests MUST run against the emulator.');
 env=await initializeTestEnvironment({projectId:'demo-linkup',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 app=admin.initializeApp({projectId:'demo-linkup'},'contribution-tests');db=app.firestore();({createBuilderService}=await import('../../api/_builder.js'));
});
after(async()=>{await env?.cleanup();await app?.delete();});
async function seed(extra={}){
 await env.clearFirestore();for(const uid of ['alice','bob'])await db.collection('users').doc(uid).set({displayName:uid,onboarded:true,isVisible:true,isVerified:false,reputationScore:17,founderScore:19});
 return createBuilderService({db,now:()=>NOW,generate:async()=>{throw Error('Publishing may not call an AI provider');},...extra});
}
const input=(key='update_1')=>({key,text:'Added Firebase rules tests for blocked reads',link:'https://example.com/changelog'});
test('publishing commits the update, real points, UTC day and insight atomically without verification or AI quota',async()=>{
 const s=await seed(),r=await s.handle('alice','shipUpdate',{...input(),uid:'bob',points:999,day:'2030-01-01',percentile:5});
 assert.equal(r.pointsAwarded,10);assert.equal(r.contributionPoints,10);assert.deepEqual(r.days,['2026-10-23']);assert.match(r.insight,/allowed and denied/);
 const user=(await db.collection('users').doc('alice').get()).data();assert.equal(user.shipLogs,undefined);assert.equal(r.shipLogs[0].text,input().text);assert.equal(user.isVerified,false);assert.equal(user.reputationScore,17);assert.equal(user.founderScore,19);assert.equal(user.isPro,undefined);
 assert.equal((await db.collection('linkyUsage').doc('alice').get()).exists,false);assert.equal((await db.collection('builderContributions').doc('bob').get()).exists,false);
 assert.equal((await s.handle('alice','home')).brief.momentumDays,1);
});
test('lost-response retries are idempotent and the same request cannot be changed',async()=>{
 const s=await seed(),first=await s.handle('alice','shipUpdate',input()),again=await s.handle('alice','shipUpdate',input());
 assert.equal(again.id,first.id);assert.equal(again.replayed,true);assert.equal(again.contributionPoints,10);
 await assert.rejects(s.handle('alice','shipUpdate',{...input(),text:'A completely different milestone'}),/different update/);
 assert.equal((await db.collection('builderContributions').doc('alice').get()).data().totalUpdates,1);
});
test('concurrent submissions cannot award more than ten points on one UTC day',async()=>{
 const s=await seed();const results=await Promise.allSettled([s.handle('alice','shipUpdate',input('parallel_1')),s.handle('alice','shipUpdate',{...input('parallel_2'),text:'Completed our customer onboarding experiment'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const c=(await db.collection('builderContributions').doc('alice').get()).data();assert.equal(c.points,10);assert.equal(c.updates.length,1);assert.equal(c.days.length,1);
});
test('next UTC day opens a new square but identical updates cannot farm new days',async()=>{
 let clock=Date.parse('2026-10-23T23:59:59Z');const s=await seed({now:()=>clock});await s.handle('alice','shipUpdate',input());clock+=2000;
 const replay=await s.handle('alice','shipUpdate',input());assert.equal(replay.day,'2026-10-23');assert.equal(replay.today,'2026-10-24');assert.equal(replay.contributionPoints,10);
 await assert.rejects(s.handle('alice','shipUpdate',input('duplicate')),/already recorded/);
 const next=await s.handle('alice','shipUpdate',{key:'day_two',text:'Interviewed three customers about our onboarding flow'});assert.equal(next.contributionPoints,20);assert.deepEqual(next.days,['2026-10-23','2026-10-24']);
});
test('clearing private builder context cannot refill contribution rewards or erase the calendar',async()=>{
 const s=await seed();await s.handle('alice','shipUpdate',input());await s.handle('alice','forget');
 assert.equal((await s.handle('alice','contributions')).points,10);await assert.rejects(s.handle('alice','shipUpdate',{key:'after_reset',text:'Published another milestone without a new UTC day'}),/already recorded today/);
});
test('other profiles receive only public summary metadata, never saved coaching or update text',async()=>{
 const s=await seed();await s.handle('alice','shipUpdate',input());const own=await s.handle('alice','contributions'),other=await s.handle('bob','contributions',{targetUid:'alice'});
 assert.equal(own.updates.length,1);assert.equal(own.shipLogs.length,1);assert.equal(other.points,10);assert.equal(other.updates,undefined);assert.equal(other.shipLogs,undefined);assert.ok(!JSON.stringify(other).includes(input().text));
});
test('hidden, blocked and deleted profiles do not expose a contribution calendar',async()=>{
 const s=await seed();await s.handle('alice','shipUpdate',input());await db.collection('users').doc('alice').update({isVisible:false});
 await assert.rejects(s.handle('bob','contributions',{targetUid:'alice'}),/not available/);assert.equal((await s.handle('alice','contributions')).points,10);
 await db.collection('users').doc('alice').update({isVisible:true});await db.collection('blocks').doc('alice_bob').set({blockedById:'alice',blockedUserId:'bob'});
 await assert.rejects(s.handle('bob','contributions',{targetUid:'alice'}),/not available/);await db.collection('blocks').doc('alice_bob').delete();
 await db.collection('users').doc('alice').update({deleted:true});await assert.rejects(s.handle('bob','contributions',{targetUid:'alice'}),/not available/);
});
test('canonical calendar points and days cannot be forged through direct client reads or writes',async()=>{
 await seed();const client=env.authenticatedContext('alice').firestore();await assertFails(setDoc(doc(client,'builderContributions','alice'),{points:999,days:['2026-10-23']}));await assertFails(getDoc(doc(client,'builderContributions','alice')));
});
test('invalid, overly short and credential-bearing updates leave no reward or AI usage document',async()=>{
 const s=await seed();for(const bad of [{...input(),text:'done'},{...input(),text:'My github_pat_private_secret_value is here'},{...input(),link:'http://example.com'},{...input(),link:'https://user:password@example.com'},{...input(),text:'a'.repeat(181)}])await assert.rejects(s.handle('alice','shipUpdate',bad));
 assert.equal((await db.collection('builderContributions').doc('alice').get()).exists,false);assert.equal((await db.collection('linkyUsage').doc('alice').get()).exists,false);
});
test('calendar and update history are bounded while all-time contribution totals are retained',async()=>{
 const s=await seed(),days=Array.from({length:400},(_,i)=>new Date(NOW-(400-i)*DAY).toISOString().slice(0,10));
 await db.collection('builderContributions').doc('alice').set({days,updates:[],points:4000,totalUpdates:400,lastDay:days.at(-1)});
 const legacy=Array.from({length:20},(_,i)=>({id:'old_'+i,text:'An older self-reported milestone',createdAt:new Date(NOW-(i+1)*DAY).toISOString()}));await db.collection('users').doc('alice').update({shipLogs:legacy});
 const r=await s.handle('alice','shipUpdate',input());assert.equal(r.contributionPoints,4010);assert.equal(r.days.length,366);assert.equal(r.shipLogs.length,20);assert.equal(r.totalUpdates,401);
});

test('existing authenticated scheduler removes private contribution records after profile deletion',async()=>{
 const s=await seed();await s.handle('alice','shipUpdate',input());await db.collection('users').doc('alice').delete();
 await s.runReminderPage();assert.equal((await db.collection('builderContributions').doc('alice').get()).exists,false);
});
