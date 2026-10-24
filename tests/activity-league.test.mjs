import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {leagueScore,rankActivity} from '../shared/league.js';
import {loadActivityLeague,serveLeagueSeo} from '../api/_leagueSeo.js';
const at=Date.parse('2026-10-24T12:00:00Z');
function database(users,contributions){
 const row=(id,v)=>({id,exists:!!v,data:()=>v});
 return {collection(name){let after='',cap=Infinity;const values=name==='users'?users:contributions;const q={where(){return q;},orderBy(){return q;},limit(n){cap=n;return q;},startAfter(id){after=id;return q;},doc(id){return {id,get:async()=>row(id,values[id])};},async get(){const docs=Object.keys(values).sort().filter(id=>id>after&&(name!=='builderContributions'||values[id].publicMomentum===true)).slice(0,cap).map(id=>row(id,values[id]));return {docs,size:docs.length};}};return q;},async getAll(...refs){return refs.filter(v=>v.id).map(({id})=>row(id,users[id]));}};
}
const profile=(name,extra={})=>({displayName:name,onboarded:true,isVisible:true,city:'Harare',country:'Zimbabwe',...extra});
const activity=(extra={})=>({publicMomentum:true,points:20,totalUpdates:2,days:['2026-10-20','2026-10-24'],habit:{earnedCredits:10,credits:0,awards:[{day:'2026-10-24'}]},updates:[{text:'PRIVATE UPDATE'}],...extra});
async function request(db,query){const r={};await serveLeagueSeo({query},{database:()=>db,now:()=>at,send:(code,body,type)=>Object.assign(r,{code,body,type}),failure:(code,error)=>Object.assign(r,{code,error})});return r;}
test('UTC week/month/all scores use actual days and acknowledged rewards, never wallet spending or profile boosts',()=>{
 const c=activity({days:['2026-10-01','2026-10-18','2026-10-19','2026-10-24','2026-10-24','2026-10-25'],points:40,totalUpdates:4,habit:{earnedCredits:15,credits:0,awards:[{day:'2026-10-18'},{day:'2026-10-24'},{day:'2026-10-25'}]},isPro:true,views:10000,reputationScore:9999});
 assert.equal(leagueScore(c,'week',at).points,25);assert.equal(leagueScore(c,'month',at).points,50);assert.equal(leagueScore(c,'all',at).points,55);assert.equal(leagueScore(c,'all',at).helpful,3);
 assert.equal(leagueScore(c,'week',Date.parse('2026-10-26T00:00:00Z')).points,0);
});
test('ties share a deterministic competition rank, with build days breaking score ties',()=>{
 const rows=rankActivity([{uid:'c',points:15,buildDays:1},{uid:'b',points:20,buildDays:2},{uid:'a',points:20,buildDays:2},{uid:'d',points:20,buildDays:1}]);assert.deepEqual(rows.map(r=>[r.uid,r.rank]),[['a',1],['b',1],['d',3],['c',4]]);
});
test('only explicit opt-in and live eligible profiles reach JSON, with exact geographic filtering',async()=>{
 const users={alice:profile('Alice'),bob:profile('Bob',{isVisible:false}),banned:profile('Banned',{banned:true}),private:profile('Private'),other:profile('Other',{country:'South Africa'})};
 const c={alice:activity(),bob:activity(),banned:activity(),private:activity({publicMomentum:false}),other:activity()};const db=database(users,c);
 const board=await loadActivityLeague(db,{at,viewerUid:'alice',country:'zimbabwe'});assert.deepEqual(board.rows.map(r=>r.uid),['alice']);assert.equal(board.me.uid,'alice');assert.equal(board.complete,true);assert.doesNotMatch(JSON.stringify(board),/PRIVATE UPDATE|earnedCredits|credits|"updates"/);
 users.alice.isStealthMode=true;assert.equal((await loadActivityLeague(db,{at,country:'Zimbabwe'})).rows.length,0);
});
test('own public rank is returned even outside the top hundred; output remains bounded',async()=>{
 const users={},c={};for(let i=0;i<105;i++){const id='member_'+String(i).padStart(3,'0');users[id]=profile(id);c[id]=activity({points:2000-i,totalUpdates:200-i});}const board=await loadActivityLeague(database(users,c),{at,period:'all',viewerUid:'member_104'});assert.equal(board.rows.length,100);assert.equal(board.participants,105);assert.equal(board.me.rank,105);assert.equal(board.next.rank,104);
});
test('league and momentum are server-rendered, canonical, crawlable, escaped and free of private notes',async()=>{
 const db=database({alice:profile('<script>Alice</script>')},{alice:activity()});
 const league=await request(db,{mode:'league',period:'week',city:'Nowhere'});assert.equal(league.code,200);for(const text of ['CollectionPage','ItemList','Builder League','/app/builder-league','&lt;script&gt;Alice'])assert.ok(league.body.includes(text));assert.doesNotMatch(league.body,/<script>Alice|PRIVATE UPDATE|earnedCredits/);
 const p=await request(db,{mode:'momentum-profile',uid:'alice'});assert.equal(p.code,200);assert.match(p.body,/ProfilePage/);assert.match(p.body,/#FBE618/);assert.match(p.body,/2026-10-24: Recorded update/);assert.doesNotMatch(p.body,/PRIVATE UPDATE|earnedCredits/);
 const sitemap=await request(db,{mode:'momentum-sitemap'});assert.match(sitemap.body,/\/app\/momentum\/alice/);
});
test('opt-out and visibility changes stop serving the searchable calendar and sitemap immediately',async()=>{
 const users={alice:profile('Alice')},c={alice:activity()},db=database(users,c);
 c.alice.publicMomentum=false;assert.equal((await request(db,{mode:'momentum-profile',uid:'alice'})).code,404);assert.doesNotMatch((await request(db,{mode:'momentum-sitemap'})).body,/momentum\/alice/);
 c.alice.publicMomentum=true;users.alice.deleted=true;assert.equal((await request(db,{mode:'momentum-profile',uid:'alice'})).code,404);
 assert.equal((await request(db,{mode:'momentum-profile',uid:'../private'})).code,404);assert.equal((await request(db,{mode:'league',period:'bad'})).code,400);
});
test('Coach is gone, public consent can be revoked, groups are private and recorded squares remain solid yellow',()=>{
 const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
 assert.match(read('mobile/src/components/BuildHabitCard.tsx'),/publicMomentum:v/);assert.match(read('mobile/src/components/BuildHabitCard.tsx'),/search caches may take time/);
 assert.doesNotMatch(read('api/_builderRuntime.js'),/generate:|gemini|generateContent/);assert.doesNotMatch(read('api/_linky.js'),/PRIVATE BUILDER CONTEXT|privateBuilderContext/);
 assert.match(read('mobile/src/screens/GroupChatScreen.tsx'),/record\?\.viewerUid===user\?\.uid/);assert.match(read('mobile/src/screens/TrendingBuildersScreen.tsx'),/scopeKey===scope/);
 const rules=read('firestore.rules');assert.match(rules,/match \/messages\/\{messageId\} \{ allow read, write: if false; \}/);
});
