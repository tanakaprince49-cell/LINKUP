import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {groupIsAdmin,groupBadges,groupChanges,groupMessage,mergeGroupMessages} from '../shared/group-policy.js';
import {GOLD_MEMBER_UID} from '../shared/member-badges.js';
import {momentumCardStats} from '../shared/momentum-card.js';
import {cardAvatar,momentumCardSvg,renderMomentumCard,safeCardRaster} from '../api/_momentumCard.js';
import {loadBuilderLeague,publicMomentumSection} from '../api/_leagueSeo.js';
import {memberHasPlus} from '../api/_memberTier.js';
const at=Date.parse('2026-10-24T12:00Z');
test('group role and badge policy distinguishes owner/admin/member, paid creation and exclusive CEO identity',()=>{
 const g={ownerId:'owner',adminIds:['admin'],creatorId:'creator',creatorPlus:false};assert.equal(groupIsAdmin(g,'owner'),true);assert.equal(groupIsAdmin(g,'admin'),true);assert.equal(groupIsAdmin(g,'member'),false);assert.deepEqual(groupBadges(g),{verified:false,gold:false});assert.deepEqual(groupBadges({...g,creatorPlus:true}),{verified:true,gold:false});assert.deepEqual(groupBadges({...g,creatorId:GOLD_MEMBER_UID,ownerId:'other'}),{verified:true,gold:true});assert.equal(groupBadges({...g,isCEO:true,gold:true}).gold,false);assert.deepEqual(groupBadges({ownerId:GOLD_MEMBER_UID}),{verified:false,gold:false});
});
test('revision journal is monotonic and bounded; deleted messages never project their original body or reactions',()=>{
 let g={};for(let i=0;i<130;i++)g=groupChanges(g,['message_'+i]);assert.equal(g.revision,130);assert.equal(g.recentChanges.length,100);assert.equal(g.recentChanges[0].version,31);assert.equal(groupMessage({id:'a',authorId:'b',text:'PRIVATE',deleted:true,reactions:{b:'👍'}}).text,'Message deleted');assert.deepEqual(groupMessage({id:'a',deleted:true,reactions:{b:'👍'}}).reactions,{});
});
test('Momentum card streak counts actual consecutive UTC update days, not breaks or balances',()=>{
 const c={days:['2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-24','2026-10-25'],totalUpdates:12,points:120,habit:{rests:[{day:'2026-10-20'}],tokens:3,credits:900}};assert.equal(momentumCardStats(c,at).streak,4);assert.equal(momentumCardStats(c,Date.parse('2026-10-26T12:00Z')).streak,5);assert.equal(momentumCardStats(c,Date.parse('2026-10-27T12:00Z')).streak,0);
});
test('share card is a real 1080 PNG, contains profile/photo/brand and safe blue/gold ticks without private notes',()=>{
 const user={displayName:'<script>Builder</script>',isCEO:true},c={days:['2026-10-24'],points:10,totalUpdates:1,updates:[{text:'PRIVATE UPDATE'}]},svg=momentumCardSvg({uid:'ordinary',user,c,at,verified:true,avatar:'data:image/png;base64,AA=='});assert.match(svg,/linkupbuild.com/);assert.match(svg,/&lt;script&gt;/);assert.match(svg,/<image /);assert.doesNotMatch(svg,/<script>|PRIVATE UPDATE|#e0be1b/);assert.match(svg,/#2485F5/);
 const gold=momentumCardSvg({uid:GOLD_MEMBER_UID,user,c,at});assert.match(gold,/#e0be1b/);assert.match(gold,/#2485F5/);const png=renderMomentumCard({uid:'ordinary',user:{displayName:'Test builder'},c,at});assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1080);
});
test('avatar renderer cannot fetch private/arbitrary hosts, redirects or decompression-sized pictures',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('must not fetch');};for(const profilePic of ['https://127.0.0.1/a','https://evil.test/a','http://ik.imagekit.io/a','https://ik.imagekit.io:9443/a','https://u:p@ik.imagekit.io/a'])assert.equal(await cardAvatar('a',{profilePic},{fetcher}),'');assert.equal(calls,0);
 const huge=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(huge);huge.writeUInt32BE(100000,16);huge.writeUInt32BE(100000,20);assert.equal(safeCardRaster(huge),false);assert.equal(await cardAvatar('a',{profilePic:'data:image/png;base64,'+huge.toString('base64')},{fetcher}),'');assert.equal(calls,0);
});
test('public profile calendar is absent without explicit consent and never includes private update text',()=>{
 const c={publicMomentum:false,days:['2026-10-24'],totalUpdates:1,points:10,updates:[{text:'PRIVATE'}]};assert.equal(publicMomentumSection('alice',c,at),'');const html=publicMomentumSection('alice',{...c,publicMomentum:true},at);assert.match(html,/Builder Momentum/);assert.match(html,/2026-10-24: Recorded update/);assert.match(html,/#FBE618/);assert.doesNotMatch(html,/PRIVATE/);
});
test('builder discovery is populated from eligible public profiles regardless of activity sharing',async()=>{
 const users={alice:{displayName:'Alice',onboarded:true,isVisible:true,occupation:'Founder',bio:'A real bio',skills:['React'],city:'Harare',country:'Zimbabwe'},hidden:{displayName:'Hidden',onboarded:true,isVisible:false},bob:{displayName:'Bob',onboarded:true,isVisible:true},banned:{displayName:'Banned',onboarded:true,banned:true}};
 const db={collection(name){assert.equal(name==='publicProfiles'||name==='users',true);const q={orderBy(){return q;},limit(){return q;},doc(id){return {id};},async get(){return {docs:Object.keys(users).map(id=>({id,data:()=>({})}))};}};return q;},async getAll(...refs){return refs.filter(r=>r.id).map(r=>({id:r.id,exists:!!users[r.id],data:()=>users[r.id]}));}};
 const board=await loadBuilderLeague(db,{viewerUid:'alice',at});assert.deepEqual(board.rows.map(r=>r.uid),['alice','bob']);assert.equal(board.me.uid,'alice');assert.equal(board.rows[1].points,0);assert.equal(board.kind,'builders');assert.doesNotMatch(JSON.stringify(board),/calendar|earnedCredits|PRIVATE UPDATE/);assert.match(board.rules,/not skill/);
});
test('PLUS badge lookup follows valid server entitlements and rejects lapsed profile status',async()=>{
 const db={collection:()=>({doc:()=>({get:async()=>({data:()=>({plus:{endsAt:at-1}})})})})};assert.equal(await memberHasPlus(db,'u',{isPro:true},at),true);assert.equal(await memberHasPlus(db,'u',{isPro:true,subscriptionStatus:'expired'},at),false);assert.equal(await memberHasPlus(db,'u',{gold:true,isCEO:true},at),false);
});
test('shared UI routes inbox groups, sender identity badges, moderation and image cards through server-owned APIs',()=>{
 const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');assert.match(read('mobile/src/screens/MessagesScreen.tsx'),/<GroupInbox/);const group=read('mobile/src/screens/GroupChatScreen.tsx');for(const key of ['groupMessageAction','groupUpdate','groupPrefs','groupBlock','Group rules','Group bio','Invite as co-admin']){assert.ok(group.includes(key),key);}assert.match(group,/MemberBadges userId=\{m.authorId\}/);assert.match(read('mobile/src/lib/momentumShare.ts'),/image\/png/);assert.match(read('mobile/src/components/BuildHabitCard.tsx'),/momentumVisibilityChanged/);
});

test('approved-CDN avatars remain photos; redirects, overlarge bodies and non-raster responses fall back safely',async()=>{
 const png=renderMomentumCard({uid:'test',user:{name:'Test'},c:{days:[]},at}),user={profilePic:'https://ik.imagekit.io/test/avatar.png'};let options;
 const photo=await cardAvatar('test',user,{fetcher:async(_url,opts)=>{options=opts;return new Response(png,{headers:{'Content-Type':'image/png'}});}});assert.match(photo,/^data:image\/png;base64,/);assert.equal(options.redirect,'error');
 assert.equal(await cardAvatar('test',user,{fetcher:async()=>new Response('',{status:302,headers:{Location:'https://127.0.0.1/'}})}),'');assert.equal(await cardAvatar('test',user,{fetcher:async()=>new Response('<svg/>',{headers:{'Content-Type':'image/svg+xml'}})}),'');assert.equal(await cardAvatar('test',user,{fetcher:async()=>new Response(Buffer.alloc(650001),{headers:{'Content-Type':'image/png'}})}),'');
});

test('reply quotes immediately use loaded history and update after source edits or erasure',()=>{
 let messages=[{id:'old',authorId:'bob',at:1,text:'Original'}];messages=mergeGroupMessages(messages,[{id:'reply',authorId:'alice',at:2,text:'Reply',replyTo:'old'}]);assert.equal(messages[1].reply.text,'Original');messages=mergeGroupMessages(messages,[{id:'old',authorId:'bob',at:1,text:'Edited'}]);assert.equal(messages[1].reply.text,'Edited');messages=mergeGroupMessages(messages,[{id:'old',at:0,authorId:'',deleted:true,text:'Message deleted'}]);assert.equal(messages[1].reply.text,'Message deleted');assert.doesNotMatch(JSON.stringify(messages),/Original|Edited/);
});
