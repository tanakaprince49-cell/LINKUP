import {leadBrief} from '../shared/lead-brief.js';
import {dailyPicks,pickDay} from '../shared/daily-picks.js';
import {readCampaignReward,claimCampaignReward} from './_campaignReward.js';
import {cleanupDeletedGroupData,sweepDeletedGroupData,sweepDeletingGroups,createGroupService} from './_groups.js';
import {createHabitActions} from './_builderHabit.js';
import {habitSnapshot,habitState} from '../shared/build-habit.js';
import {DAY,id,clean,requireText,problem,validId,safeLink,stateOf,freshState,contextOf,sanitizePrefs,weekKey,localTime,brief,relevantPeople,relevantLeads,weeklySummary} from './_builderCore.js';
import {planRetention,leagueSummary,retentionKey} from './_retention.js';
import {nextLinkyHeadlineIndex} from '../shared/linky-reengagement.js';
import {loadActivityLeague} from './_leagueSeo.js';
import {publicEligible} from './_publicSeo.js';
import {readMessageQuota} from './_linkyUsage.js';
import {CONTRIBUTION_POINTS,CONTRIBUTION_HISTORY_DAYS,contributionDay,contributionInsight,containsCredential,normalizeUpdate} from '../shared/contributions.js';
import {EXTERNAL_LEADS} from '../shared/builder-leads.js';
const fields=['displayName','fullName','name','occupation','skills','industries','city','country','onboarded','deleted','banned','isBot','isVisible','isStealthMode','startupStage','remoteOnly','isVerified','profilePicUrl','photoURL','avatarUrl'];
const row=d=>({id:d.id,...d.data()});
const ownId=value=>{if(!validId(value))throw problem('Invalid item identifier.');return value;};
export function createBuilderService({db,now=Date.now,plus=async()=>false,push=async()=>({sent:0})}){
 const habits=createHabitActions({db,now});
 const groups=createGroupService({db,now,blocked,connectable,notify,plus});
 const ref=uid=>db.collection('builderStates').doc(uid);
 async function state(uid){const d=await ref(uid).get();return stateOf(d.exists?d.data():{},now());}
 async function change(uid,edit){return db.runTransaction(async tx=>{const d=await tx.get(ref(uid));const s=stateOf(d.exists?d.data():{},now());const result=edit(s);s.updatedAt=now();tx.set(ref(uid),s);return result===undefined?s:result;});}
 const blockCache=new Map();
 async function blockSet(uid){if(!blockCache.has(uid))blockCache.set(uid,(async()=>{const [a,b]=await Promise.all([db.collection('blocks').where('blockedById','==',uid).get(),db.collection('blocks').where('blockedUserId','==',uid).get()]);return new Set([...a.docs.map(d=>d.data().blockedUserId),...b.docs.map(d=>d.data().blockedById)]);})());return blockCache.get(uid);}
 async function blocked(uid,other){return (await blockSet(uid)).has(other);}
 async function connectable(uid,other){
  ownId(other);if(uid===other)throw problem('Choose another member.');
  const target=await db.collection('users').doc(other).get();
  if(!target.exists||target.data().deleted||target.data().onboarded!==true||await blocked(uid,other))throw problem('This collaboration is not available.',403);
  const requests=await Promise.all([`${uid}_${other}`,`${other}_${uid}`].map(k=>db.collection('connectionRequests').doc(k).get()));
  const match=await db.collection('matches').doc([uid,other].sort().join('_')).get(),members=match.exists?(match.data().userIds||match.data().users||[match.data().u1,match.data().u2]):[];
  if(!requests.some(d=>d.exists&&d.data().status==='approved')&&!(match.exists&&Array.isArray(members)&&members.includes(uid)&&members.includes(other)))throw problem('Connect mutually before inviting or following up with this member.',403);
  return target.data();
 }
 async function roomFor(uid,roomId){const d=await db.collection('builderRooms').doc(ownId(roomId)).get();if(!d.exists||!d.data().memberIds.includes(uid))throw problem('This room is not available.',403);
  for(const member of d.data().memberIds)if(member!==uid&&await blocked(uid,member))throw problem('This room is unavailable because a member is blocked.',403);
  const names=await db.getAll(...d.data().memberIds.map(k=>db.collection('users').doc(k)),{fieldMask:['displayName','fullName','name','deleted']});
  return {...row(d),members:names.map(n=>({uid:n.id,name:n.exists&&!n.data().deleted?clean(n.data().displayName||n.data().fullName||n.data().name,100):'Former member'}))};
 }
 async function notify(uid,key,section,content,enabledPush=false,targetUrl=''){
  const n=db.collection('notifications').doc('builder_'+uid+'_'+key);
  const created=await db.runTransaction(async tx=>{const d=await tx.get(n);if(d.exists)return false;tx.set(n,{userId:uid,fromId:uid,fromName:'Linky',fromPic:'',type:'builder',content,section,...(targetUrl?{targetUrl,url:targetUrl}:{}),serverPushManaged:true,pushRequested:enabledPush,isRead:false,timestamp:new Date(now())});return true;});
  if(created&&enabledPush)await push(uid,{title:'LINKUP · Your next move',body:content,url:targetUrl||'/builder?section='+encodeURIComponent(section)});
 }
 async function event(uid,type){
  // One bounded audit document per user; analytics must never refund a finished AI review.
  try{const r=db.collection('builderEvents').doc(uid);await db.runTransaction(async tx=>{const d=await tx.get(r);tx.set(r,{uid,events:[{type,at:now()},...(d.exists?d.data().events||[]:[])].slice(0,40)});});}catch(e){console.warn('[builder] audit unavailable');}
 }
 async function recommendations(uid,s,daily=false,timeZone='UTC'){
  const candidates=await db.collection('publicProfiles').orderBy('__name__').limit(160).get();
  const ids=candidates.docs.map(d=>d.id).filter(k=>validId(k)&&k!==uid);if(!ids.length)return [];
  const [sources,states,outgoing,incoming]=await Promise.all([
   db.getAll(...ids.map(k=>db.collection('users').doc(k)),{fieldMask:fields}),
   daily?Promise.resolve([]):db.getAll(...ids.map(k=>ref(k)),{fieldMask:['availability']}),
   db.collection('blocks').where('blockedById','==',uid).get(),db.collection('blocks').where('blockedUserId','==',uid).get()]);
  const unavailable=new Set([...outgoing.docs.map(d=>d.data().blockedUserId),...incoming.docs.map(d=>d.data().blockedById)]);
  const availability=new Map(states.filter(d=>d.exists).map(d=>[d.id,d.data().availability]));
  const people=sources.filter(d=>d.exists&&!unavailable.has(d.id)&&publicEligible(d.data(),d.id)).map(d=>({uid:d.id,...d.data(),name:clean(d.data().displayName||d.data().fullName||d.data().name,100),availability:availability.get(d.id)}));
  if(daily){const day=pickDay(now(),timeZone),chosen=await change(uid,current=>{let ids=current.dailyPicks?.day===day&&current.dailyPicks?.timeZone===timeZone?current.dailyPicks.uids.filter(id=>people.some(p=>p.uid===id)):[];if(ids.length<Math.min(2,people.length)){const previous=current.dailyPicks?.day!==day?current.dailyPicks?.uids||[]:[];let candidates=people.filter(p=>!ids.includes(p.uid)&&!previous.includes(p.uid));if(candidates.length<2-ids.length)candidates=people.filter(p=>!ids.includes(p.uid));ids=[...ids,...dailyPicks(candidates,uid,day).map(p=>p.uid)].slice(0,2);}current.dailyPicks={day,timeZone,uids:ids};return ids;}),photos=new Map(candidates.docs.map(d=>[d.id,d.data()]));return {day,eligible:people.length,people:chosen.map(id=>people.find(p=>p.uid===id)).filter(Boolean).map(p=>({uid:p.uid,name:p.name,occupation:p.occupation||'',city:p.city||'',country:p.country||'',skills:p.skills||[],verified:p.isVerified===true,image:(photos.get(p.uid)?.profilePic||p.profilePicUrl||p.photoURL||p.avatarUrl)?'https://www.linkupbuild.com/app/api/publicSeo?mode=image&uid='+encodeURIComponent(p.uid):'',why:p.occupation?'Profile lists '+clean(p.occupation,120)+'.':p.skills?.length?'Profile lists '+p.skills.slice(0,3).join(', ')+'.':'An eligible public LINKUP member; explore their profile to assess fit.'})),note:people.length<3?'The eligible pool is small, so a person may repeat. We never invent members.':'A new pair each local calendar day. Rotation is discovery, not a compatibility guarantee.'};}
  return relevantPeople(s,people,now());
 }
 async function listAsks(uid,input={}){
  if(input.after&&!validId(input.after))throw problem('Invalid board cursor.');
  let q=db.collection('builderAsks');if(input.mine===true)q=q.where('ownerId','==',uid);q=q.orderBy('__name__');if(input.after)q=q.startAfter(input.after);
  const snap=await q.limit(41).get(),docs=snap.docs.slice(0,40),ids=[...new Set(docs.map(d=>d.data().ownerId))].filter(validId);
  const owners=ids.length?await db.getAll(...ids.map(k=>db.collection('users').doc(k)),{fieldMask:fields}):[];
  const map=new Map(owners.filter(d=>d.exists).map(d=>[d.id,d.data()])),blockedIds=await blockSet(uid);
  const out=[];
  for(const d of docs){const a=d.data(),owner=map.get(a.ownerId);if(input.mine!==true&&(a.status!=='open'||a.expiresAt<=now()||!owner||!publicEligible(owner,a.ownerId)||blockedIds.has(a.ownerId)))continue;
   out.push({id:d.id,ownerId:a.ownerId,ownerName:clean(owner?.displayName||owner?.fullName||owner?.name,100),title:a.title,details:a.details,question:a.question,kind:a.kind,compensation:a.compensation,minutes:a.minutes,expiresAt:a.expiresAt,url:a.url,feedback:a.feedback||[],status:a.status,createdAt:a.createdAt});
  }
  return {asks:out,nextCursor:snap.docs.length>40?docs.at(-1).id:null};
 }
 async function reviewFor(uid,s){
  const [board,owned,matches,roomDocs,blocks]=await Promise.all([listAsks(uid),listAsks(uid,{mine:true}),db.collection('matches').where('userIds','array-contains',uid).limit(20).get(),db.collection('builderRooms').where('memberIds','array-contains',uid).limit(30).get(),blockSet(uid)]);
  let chatReplies=0;
  for(const match of matches.docs){const pair=match.data().userIds||[],other=pair.find(k=>k!==uid);if(!other||blocks.has(other))continue;
   try{await connectable(uid,other);}catch{continue;}
   const messages=await match.ref.collection('messages').orderBy('timestamp','desc').limit(10).get();
   chatReplies+=messages.docs.filter(d=>{const m=d.data(),at=typeof m.timestamp?.toMillis==='function'?m.timestamp.toMillis():Number(m.timestamp);return m.senderId===other&&at>=now()-7*DAY;}).length;
  }
  const rooms=roomDocs.docs.map(d=>d.data()).filter(r=>!r.memberIds.some(k=>blocks.has(k)));
  return weeklySummary(s,now(),{asks:board.asks.filter(a=>a.ownerId!==uid),ownedAsks:owned.asks,leads:relevantLeads(s,EXTERNAL_LEADS,now()),rooms,chatReplies});
 }
 async function loadHome(uid,op){
  if(op==='visit')await change(uid,s=>{if(!s.lastVisitAt||now()-s.lastVisitAt>30*60000){s.previousVisitAt=s.lastVisitAt;s.lastVisitAt=now();}});
  const [s,r,i,me]=await Promise.all([state(uid),db.collection('builderRooms').where('memberIds','array-contains',uid).limit(30).get(),db.collection('builderInvites').where('recipientId','==',uid).limit(50).get(),db.collection('users').doc(uid).get()]);
  const rooms=[];for(const d of r.docs){try{const room=await roomFor(uid,d.id);rooms.push({id:room.id,title:room.title,kind:room.kind,updatedAt:room.updatedAt,archived:room.archived,ownerId:room.ownerId,memberCount:room.memberIds.length});}catch{}}
  const invitations=[];for(const d of i.docs){const v=d.data();if(v.status!=='pending'||v.expiresAt<=now())continue;try{await connectable(uid,v.senderId);const room=await db.collection('builderRooms').doc(v.roomId).get();if(room.exists&&!room.data().archived&&room.data().memberIds.includes(v.senderId))invitations.push({id:d.id,roomId:v.roomId,title:room.data().title,kind:room.data().kind,senderId:v.senderId});}catch{}}
  const quota=await readMessageQuota(db,uid,{plus:await plus(uid,me.data()),now:now()});
  return {state:s,brief:brief(s,now(),rooms,invitations),rooms,invitations,messageQuota:quota,emailAvailable:false};
 }
 function contributionHistory(c,person){
  const legacy=(Array.isArray(person.shipLogs)?person.shipLogs:[]).slice(0,20).map(u=>({id:clean(u.id,128),text:clean(u.text,180),link:safeLink(u.link),createdAt:clean(u.createdAt,32)})).filter(u=>u.id&&u.text);
  return [...(c.updates||[]),...legacy].filter((u,i,all)=>all.findIndex(v=>v.id===u.id)===i).slice(0,20);
 }
 async function contributionData(uid,target){
  const own=target===uid,person=await db.collection('users').doc(target).get();
  if(!person.exists||person.data().deleted||person.data().banned||(!own&&(!publicEligible(person.data(),target)||await blocked(uid,target))))throw problem('This contribution calendar is not available.',403);
  const d=await db.collection('builderContributions').doc(target).get(),c=d.exists?d.data():{};
  // The full recorded-date history (bounded server-side), plus which days in it
 // have a private update. Dates only: no update text is ever returned to a
 // viewer who is not the owner.
 const allDays=(Array.isArray(c.days)?c.days:[]).filter(d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d));
 const updatedDays=new Set([...(c.updates||[]).map(u=>u.day),...(person.data().shipLogs||[]).map(u=>String(u?.createdAt||'').slice(0,10))].filter(d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)));
 return {days:allDays,points:Number(c.points)||0,totalUpdates:Number(c.totalUpdates)||0,firstDay:allDays[0]||'',lastDay:allDays.at(-1)||'',historyDays:Number(c.totalUpdates)||allDays.length,updatedDays:[...updatedDays].slice(0,366),publicMomentum:c.publicMomentum===true,publicUrl:c.publicMomentum===true?'https://www.linkupbuild.com/app/momentum/'+encodeURIComponent(target):'',timezone:'UTC',today:contributionDay(now()),
   ...(own?{updates:c.updates||[],shipLogs:contributionHistory(c,person.data())}:{}),
   notice:'Self-reported progress, recorded by LINKUP; not proof of skill, trust, verification or investment quality.'};
 }
 async function publishContribution(uid,input){
  const text=requireText(input.text,180,12),key=ownId(input.key),link=input.link?safeLink(input.link):'';
  if(input.link&&!link)throw problem('Use an HTTPS link without embedded credentials, or leave the link empty.');
  if(containsCredential(text)||containsCredential(link))throw problem('Remove credentials, API keys and passwords before publishing.');
  const at=now(),day=contributionDay(at),createdAt=new Date(at).toISOString(),cr=db.collection('builderContributions').doc(uid),ur=db.collection('users').doc(uid);
  return db.runTransaction(async tx=>{
   const [cd,ud,sd]=await Promise.all([tx.get(cr),tx.get(ur),tx.get(ref(uid))]);
   if(!ud.exists||ud.data().deleted||ud.data().banned||ud.data().onboarded!==true)throw problem('Your profile is no longer available.',403);
   const c=cd.exists?cd.data():{days:[],updates:[],points:0,totalUpdates:0},previous=(c.updates||[]).find(u=>u.key===key);
   if(previous){if(previous.text!==text||previous.link!==link)throw problem('This request was already used for a different update.',409);return {...previous,days:c.days,contributionPoints:c.points,totalUpdates:c.totalUpdates,shipLogs:contributionHistory(c,ud.data()),today:day,habit:habitSnapshot(c,at,sd.data()?.prefs),replayed:true};}
   if(c.lastDay===day)throw problem('Your contribution is already recorded today; your next square opens at midnight UTC.',409);
   if((c.updates||[]).some(u=>normalizeUpdate(u.text)===normalizeUpdate(text)))throw problem('This update is already recorded; share a new result or next step.',409);
   const entry={id:id(),key,text,link,createdAt,day,pointsAwarded:CONTRIBUTION_POINTS,insight:contributionInsight(text)},cutoff=contributionDay(at-(CONTRIBUTION_HISTORY_DAYS-1)*DAY);
   const days=[...new Set([...(c.days||[]).filter(d=>typeof d==='string'&&d>=cutoff&&d<=day),day])].sort().slice(-CONTRIBUTION_HISTORY_DAYS);
   const updates=[entry,...(c.updates||[])].slice(0,20),points=(Number(c.points)||0)+CONTRIBUTION_POINTS,totalUpdates=(Number(c.totalUpdates)||0)+1;
   // New text/insights stay private in the server-owned collection, never in
   // public profile fields. Neither activity nor posting grants verification.
   const shipLogs=contributionHistory({updates},ud.data());
   const habit=habitState(c),rest=habit.rests.find(r=>r.day===day);if(rest?.kind==='token'){if(habit.tokens<3)habit.tokens++;else habit.credits+=20;}habit.rests=habit.rests.filter(r=>r.day!==day);
   const state=stateOf(sd.data(),at);state.momentumDays=[...new Set([...state.momentumDays,localTime(at,state.prefs.timezone).day])].slice(-90);state.updatedAt=at;state.buildReminderCount=0;
   tx.set(cr,{version:1,days,updates,points,totalUpdates,lastDay:day,habit,publicMomentum:c.publicMomentum===true,updatedAt:at});
   tx.set(ref(uid),state);
   return {...entry,days,contributionPoints:points,totalUpdates,shipLogs,today:day,habit:habitSnapshot({days,totalUpdates,habit,publicMomentum:c.publicMomentum},at,state.prefs),replayed:false};
  });
 }
 async function handle(uid,op,input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw problem('Use an object for this action.');
  blockCache.clear();
  if(!validId(uid))throw problem('Sign in to continue.',401);
  const me=await db.collection('users').doc(uid).get();if(!me.exists||me.data().deleted||me.data().banned||me.data().onboarded!==true)throw problem('Finish your profile before opening the builder workspace.',403);
  // Bounded server-owned request counter, separate from the paid AI ledger.
  await db.runTransaction(async tx=>{const r=db.collection('builderRates').doc(uid),d=await tx.get(r),v=d.exists?d.data():{};const key=Math.floor(now()/60000),count=v.key===key?v.count:0;if(count>=60)throw problem('Please pause for a moment before trying again.',429);tx.set(r,{key,count:count+1});});
  if(['groups','groupCreate','groupGet','groupMessages','groupSend','groupRead','groupInvite','groupRespond','groupAction','groupExport','groupUpdate','groupMessageAction','groupPrefs','groupBlock','groupDelete'].includes(op))return groups.handle(uid,op,input);
  if(op==='campaignReward')return readCampaignReward(db,uid,now());
  if(op==='campaignRewardClaim')return claimCampaignReward(db,uid,input,now());
  if(op==='habit')return habits.read(uid);
  if(['habitPrefs','habitRest','habitToken'].includes(op))return habits.act(uid,op,input);
  if(op==='contributions')return contributionData(uid,input.targetUid?ownId(input.targetUid):uid);
  if(op==='shipUpdate')return publishContribution(uid,input);
  if(['home','visit'].includes(op))return loadHome(uid,op);
  if(op==='context'){await change(uid,s=>{const context=contextOf(input);if(context.project!==s.context.project||context.goal!==s.context.goal||context.needs!==s.context.needs)s.feedback={};s.context=context;});await event(uid,'context_set');return {ok:true};}
  if(op==='prefs'){await change(uid,s=>{const before=s.prefs.dailyBuild;s.prefs=sanitizePrefs(input,s.prefs);if(s.prefs.dailyBuild&&!before){s.prefs.buildOptInDay=contributionDay(now());s.buildReminderCount=0;}});return {ok:true,emailAvailable:false};}
  if(op==='goal'){
   const text=requireText(input.text,300,4);await change(uid,s=>{const week=weekKey(now(),s.prefs.timezone);s.goals=[{id:id(),text,week,at:now(),doneAt:0},...s.goals.filter(g=>g.week!==week||g.doneAt)].slice(0,24);});await event(uid,'goal_set');return {ok:true};
  }
  if(op==='goalDone'){await change(uid,s=>{const g=s.goals.find(g=>g.id===input.id);if(!g)throw problem('Goal not found.',404);if(!g.doneAt){g.doneAt=now();s.momentumDays=[...new Set([...s.momentumDays,localTime(now(),s.prefs.timezone).day])].slice(-90);}});return {ok:true};}
  if(op==='availability'){const enabled=input.enabled===true,purpose=clean(input.purpose,180);if(enabled&&!purpose)throw problem('Tell people what kind of conversation you are available for.');await change(uid,s=>{s.availability={enabled,purpose,until:enabled?now()+7*DAY:0};});return {ok:true};}
  if(op==='connections'){
   const [a,b]=await Promise.all([db.collection('connectionRequests').where('senderId','==',uid).limit(100).get(),db.collection('connectionRequests').where('recipientId','==',uid).limit(100).get()]);
   const ids=[...new Set([...a.docs,...b.docs].filter(d=>d.data().status==='approved').map(d=>d.data().senderId===uid?d.data().recipientId:d.data().senderId))].filter(validId).slice(0,100);
   const people=[];for(const other of ids){try{const p=await connectable(uid,other);people.push({uid:other,name:clean(p.displayName||p.fullName||p.name,100)});}catch{}}
   return {people};
  }
  if(op==='weeklyReview')return {review:await reviewFor(uid,await state(uid))};
  if(op==='dailyPicks')return recommendations(uid,await state(uid),true,clean(input.timeZone,80)||'UTC');
  if(op==='recommendations')return {people:await recommendations(uid,await state(uid)),scope:'Up to 160 discovery candidates; only evidence-backed relevant members are shown.'};
  if(op==='recommendationFeedback'){ownId(input.uid);if(!['relevant','not_relevant','contacted'].includes(input.status))throw problem('Choose a feedback option.');await change(uid,s=>{s.feedback={...s.feedback,[input.uid]:{status:input.status,at:now()}};s.feedback=Object.fromEntries(Object.entries(s.feedback).sort((a,b)=>b[1].at-a[1].at).slice(0,100));});return {ok:true};}
  if(op==='followup'){
   const other=await connectable(uid,input.targetUid),title=requireText(input.title,180,3),note=clean(input.note,2000),reason=clean(input.reason,500),dueAt=Number(input.dueAt);
   if(!Number.isFinite(dueAt)||dueAt<now()-60000||dueAt>now()+90*DAY)throw problem('Choose a reminder date within the next 90 days.');
   await change(uid,s=>{if(s.followups.filter(f=>f.status==='open').length>=40)throw problem('Complete an existing follow-up first.');s.followups=[{id:id(),targetUid:input.targetUid,targetName:clean(other.displayName||other.fullName||other.name,100),title,note,reason,dueAt,status:'open',at:now(),notifiedAt:0},...s.followups].slice(0,60);});await event(uid,'followup_created');return {ok:true};
  }
  if(op==='followupEdit'){
   const title=requireText(input.title,180,3),dueAt=Number(input.dueAt);if(!Number.isFinite(dueAt)||dueAt<now()-60000||dueAt>now()+90*DAY)throw problem('Choose a reminder date within the next 90 days.');
   await change(uid,s=>{const f=s.followups.find(f=>f.id===input.id);if(!f)throw problem('Follow-up not found.',404);Object.assign(f,{title,note:clean(input.note,2000),reason:clean(input.reason,500),dueAt,notifiedAt:0});});return {ok:true};
  }
  if(op==='followupDelete'){await change(uid,s=>{s.followups=s.followups.filter(f=>f.id!==input.id);});return {ok:true};}
  if(op==='followupStatus'){await change(uid,s=>{const f=s.followups.find(f=>f.id===input.id);if(!f)throw problem('Follow-up not found.',404);if(input.status==='snooze'){f.dueAt=now()+DAY;f.notifiedAt=0;}else if(['done','dismissed'].includes(input.status)){if(f.status==='open'&&input.status==='done')s.momentumDays=[...new Set([...s.momentumDays,localTime(now(),s.prefs.timezone).day])].slice(-90);f.status=input.status;f.closedAt=f.closedAt||now();}else throw problem('Choose a valid follow-up action.');});return {ok:true};}
  if(op==='followupDraft'){const s=await state(uid),f=s.followups.find(f=>f.id===input.id);if(!f)throw problem('Follow-up not found.',404);await connectable(uid,f.targetUid);return {text:`Hi ${f.targetName}, following up on ${f.title}. Would you be open to agreeing on a useful next step?`,sent:false};}
  if(op==='coach')throw problem('The extra Coach has been removed. Main Linky chat is unchanged.',410);
  if(op==='leads'){
   const s=await state(uid);return {leads:relevantLeads(s,EXTERNAL_LEADS,now()),note:'External public sources, not LINKUP members. Source access does not establish current availability or acceptance of pitches.'};
  }
  if(op==='leadBrief'){const s=await state(uid),lead=relevantLeads(s,EXTERNAL_LEADS,now()).find(l=>l.id===input.id);if(!lead)throw problem('This source is unavailable or needs a new review.',404);return {text:leadBrief(s.context,lead),sent:false};}
  if(op==='leadSave'){if(!EXTERNAL_LEADS.some(l=>l.id===input.id))throw problem('Lead not found.',404);await change(uid,s=>{s.savedLeads=input.saved===false?s.savedLeads.filter(k=>k!==input.id):[...new Set([input.id,...s.savedLeads])].slice(0,50);});return {ok:true};}
  // Old room URLs remain readable; project/task mutations are retired.
  if(op==='roomCreate'){const r=await groups.handle(uid,'groupCreate',input);return {roomId:r.groupId};}
  if(op==='room')return {room:await roomFor(uid,input.roomId)};
  if(op==='roomInvite')return groups.handle(uid,'groupInvite',{...input,groupId:input.roomId});
  if(op==='invitationRespond')return groups.handle(uid,'groupRespond',input);
  if(op==='roomAction'){
   if(['leave','archive','remove'].includes(input.action))return groups.handle(uid,'groupAction',{...input,groupId:input.roomId});
   throw problem('Project rooms have been replaced by private group chat. Open Groups to continue.',410);
  }
  if(op==='asks')return listAsks(uid,input);
  if(op==='askCreate'){
   if(!publicEligible(me.data(),uid))throw problem('Use a public profile to post a public help request.');const askId=id();await db.runTransaction(async tx=>{const ownerState=await tx.get(ref(uid)),existing=await tx.get(db.collection('builderAsks').where('ownerId','==',uid));if(existing.docs.filter(d=>d.data().status==='open'&&d.data().expiresAt>now()).length>=5)throw problem('Close an existing request first.');tx.set(ref(uid),{...stateOf(ownerState.data(),now()),updatedAt:now()});tx.set(db.collection('builderAsks').doc(askId),{ownerId:uid,title:requireText(input.title,140,6),details:requireText(input.details,1500,12),question:requireText(input.question,300,6),kind:input.kind==='launch'?'launch':'help',compensation:['paid','voluntary','partnership'].includes(input.compensation)?input.compensation:'voluntary',minutes:Math.max(5,Math.min(120,Number(input.minutes)||15)),url:safeLink(input.url),status:'open',feedback:[],createdAt:now(),expiresAt:now()+14*DAY});});await event(uid,'ask_created');return {askId};
  }
  if(['askClose','askFeedback','askFeedbackStatus'].includes(op)){
   const ar=db.collection('builderAsks').doc(ownId(input.id)),first=await ar.get();if(!first.exists)throw problem('Request not found.',404);
   const ownerDoc=await db.collection('users').doc(first.data().ownerId).get();if(first.data().ownerId!==uid&&(!ownerDoc.exists||!publicEligible(ownerDoc.data(),first.data().ownerId)||await blocked(uid,first.data().ownerId)))throw problem('This request is unavailable.',403);
   const recognized=await db.runTransaction(async tx=>{let recognizedUid='';let reward=null;const doc=await tx.get(ar),a=doc.data();if(op==='askClose'){if(a.ownerId!==uid)throw problem('Only the author can close a request.',403);a.status='closed';a.closedAt=now();}
    if(op==='askFeedback'){if(a.status!=='open'||a.expiresAt<=now()||a.ownerId===uid)throw problem('This request cannot receive your feedback.');if(a.feedback.length>=40||a.feedback.some(f=>f.authorId===uid))throw problem('Feedback already exists or this round is full.');a.feedback.push({id:id(),authorId:uid,authorName:clean(me.data().displayName||me.data().fullName||me.data().name,100),text:requireText(input.text,1200,12),at:now(),useful:false});}
    if(op==='askFeedbackStatus'){if(a.ownerId!==uid)throw problem('Only the author can recognise feedback.',403);const f=a.feedback.find(f=>f.id===input.feedbackId);if(!f)throw problem('Feedback not found.',404);const outcome=requireText(input.outcome,300,4);if(!f.useful){recognizedUid=f.authorId;reward=await habits.rewardFeedback(tx,{...a,id:ar.id},f,uid,outcome);f.reward={amount:reward.amount,at:now()};}f.useful=true;f.outcome=outcome;}
    a.feedbackAuthorIds=[...new Set(a.feedback.map(f=>f.authorId))];tx.set(ar,a);return {uid:recognizedUid,reward};});if(validId(recognized.uid)){const author=await db.collection('users').doc(recognized.uid).get();if(author.exists&&!author.data().deleted)await change(recognized.uid,s=>{s.momentumDays=[...new Set([...s.momentumDays,localTime(now(),s.prefs.timezone).day])].slice(-90);});}await event(uid,op);return {ok:true,reward:recognized.reward};
  }
  if(op==='export'){const s=await state(uid);return {state:s,contributions:await contributionData(uid,uid),habit:await habits.read(uid),notice:'Shared room content is visible to accepted members. Private building context and notes are never part of the public profile.'};}
  if(op==='forget'){
   await change(uid,s=>{const prefs={...s.prefs,reminders:false,digest:false,friday:false,push:false,dailyBuild:false};Object.keys(s).forEach(k=>delete s[k]);Object.assign(s,freshState(now()),{prefs});});return {ok:true,notice:'Private context, notes and saved reviews cleared. Shared rooms and posted feedback remain shared; archive rooms or close requests separately.'};
  }
  throw problem('Unsupported builder action.');
 }
 async function runReminderPage({after='',limit=40}={}){
  await sweepDeletedGroupData(db,now());await sweepDeletingGroups(db,now());
  // One public board read per run serves every member on this page: the rank
  // facts in the midday messages are then real for everyone, not estimated.
  const league=await loadActivityLeague(db,{period:'week',at:now()}).then(board=>leagueSummary(board)).catch(()=>null);
  let query=db.collection('builderStates').orderBy('__name__').limit(Math.min(40,limit));if(after)query=query.startAfter(after);const docs=(await query.get()).docs;let delivered=0,lastProcessed=after;const started=Date.now();
  for(const d of docs){
   if(Date.now()-started>40000)return {delivered,nextCursor:lastProcessed};
   lastProcessed=d.id;const [user,presence]=await Promise.all([db.collection('users').doc(d.id).get(),db.collection('presence').doc(d.id).get()]);
   if(!user.exists||user.data().deleted){await db.collection('builderContributions').doc(d.id).delete();await cleanupDeletedGroupData(db,d.id,now());continue;}
   if(user.data().banned||user.data().onboarded!==true)continue;
   // The weekly review costs several reads, so it is only computed when one of
   // the member's own opt-ins is actually due right now. It is also the only
   // source of the Friday drop and the Sunday digest, so neither can be
   // fabricated when the review found nothing.
   const prior=stateOf(d.data(),now()),clock=localTime(now(),prior.prefs.timezone);
   const needsReview=(prior.prefs.friday===true&&prior.lastFriday!==weekKey(now(),prior.prefs.timezone)&&clock.weekday==='Fri'&&clock.hour>=9&&clock.hour<19)||(prior.prefs.digest===true&&prior.lastDigest!==weekKey(now(),prior.prefs.timezone)&&clock.weekday==='Sun'&&clock.hour>=17&&clock.hour<20);
   const review=needsReview?await reviewFor(d.id,prior).catch(()=>null):null;
   let delivery=null,prefs=null,notifyRef=null;
   await db.runTransaction(async tx=>{
    delivery=null;prefs=null;notifyRef=null;
    const fresh=await tx.get(d.ref),s=stateOf(fresh.data(),now());
    // Someone changed the account while the review was being read: use the next
    // run's review instead of delivering a stale one.
    if(review&&(s.epoch!==prior.epoch||s.updatedAt!==prior.updatedAt))return;
    const contrib=(await tx.get(db.collection('builderContributions').doc(d.id))).data()||{};
    const {message,facts}=planRetention({uid:d.id,state:s,contributions:contrib,user:user.data(),presence:presence.exists?presence.data():{},now:now(),league,review});
    if(!message)return;
    const nr=db.collection('notifications').doc(retentionKey(d.id,facts,message));
    if((await tx.get(nr)).exists)return;
    notifyRef=nr;
    // Build nudges keep the existing pause rule and private habit inbox.
    if(message.kind==='build'&&(habitState(contrib).nudges||[]).some(v=>v.key===message.key))return;
    prefs={...s.prefs};delivery=message;s.lastDeliveryAt=now();
    const sent=(s.retention&&s.retention.day===facts.localDay&&Array.isArray(s.retention.sent)?s.retention.sent:[]);
    s.retention={day:facts.localDay,sent:[...sent,{category:message.category,at:now()}].slice(-8)};
    if(message.kind==='build'){s.buildReminderCount=(s.buildReminderCount||0)+1;if(message.pause)s.prefs.dailyBuild=false;}
    if(message.category==='comeback'){s.lastComebackAt=now();s.comebackSequence=nextLinkyHeadlineIndex(message.headlineIndex);}
    if(message.category==='followup')s.followups=s.followups.map(f=>f.status==='open'&&f.dueAt<=now()?{...f,notifiedAt:now()}:f);
    if(message.category==='weekly'||message.category==='digest')s.lastDigest=weekKey(now(),s.prefs.timezone);
    if(message.category==='friday'){
     s.lastFriday=weekKey(now(),s.prefs.timezone);
     s.deliveredOpportunityKeys=[...new Set([...(s.deliveredOpportunityKeys||[]),...(review?.newOpportunities||[]).map(o=>o.key)])].slice(-100);
    }
    if(review)s.latestSummary={...review,summaryAt:now()};
    tx.set(d.ref,s);
    if(message.kind==='build'){
     const h=habitState(contrib);h.nudges=[{key:message.key,content:message.content,at:now(),url:'/ship'},...(h.nudges||[])].slice(0,10);
     tx.set(db.collection('builderContributions').doc(d.id),{...contrib,habit:h,updatedAt:now()});
    }else{
     // One document per member, per UTC day, per category: a replayed cron run
     // can never duplicate a message the member already received.
     tx.set(nr,{userId:d.id,fromId:d.id,fromName:'Linky',fromPic:'',type:'builder',category:message.category,slot:message.slot,title:message.title,body:message.body,content:message.content,section:message.section,url:message.url,...(message.campaign?{campaign:message.campaign,headlineKey:message.headlineKey}:{}),serverPushManaged:true,pushRequested:prefs.push,...(review?{builderSummary:review.summary}:{}),isRead:prefs.inApp===false,timestamp:new Date(now())});
    }
   });
   if(delivery){
    delivered++;
    if(prefs.push){
     const nr=delivery.kind==='build'?db.collection('builderContributions').doc(d.id):notifyRef;
     const patch=v=>delivery.kind==='build'?{buildPushStatus:{key:delivery.key,...v}}:v;
     try{
      const result=await push(d.id,{title:delivery.pushTitle||'LINKUP · '+delivery.title,body:delivery.body,url:delivery.url||'/ship',campaign:delivery.campaign||'builder_retention',category:delivery.category});
      await nr.set(patch({pushStatus:result?.sent>0?'provider_accepted':'not_accepted',pushAttemptAt:now()}),{merge:true});
     }catch{await nr.set(patch({pushStatus:'failed',pushAttemptAt:now()}),{merge:true});}
    }
   }
  }
  return {delivered,nextCursor:docs.length===Math.min(40,limit)?docs.at(-1).id:null};
 }
 return {handle,runReminderPage};
}
