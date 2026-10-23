import {DAY,id,clean,requireText,problem,validId,safeLink,stateOf,freshState,contextOf,sanitizePrefs,weekKey,localTime,brief,relevantPeople,coachPrompt,nextDelivery,relevantLeads,weeklySummary} from './_builderCore.js';
import {publicEligible} from './_publicSeo.js';
import {reserveMessage,refundMessage,readMessageQuota} from './_linkyUsage.js';
import {CONTRIBUTION_POINTS,CONTRIBUTION_HISTORY_DAYS,contributionDay,contributionInsight,containsCredential,normalizeUpdate} from '../shared/contributions.js';
import {EXTERNAL_LEADS} from '../shared/builder-leads.js';
const fields=['displayName','fullName','name','occupation','skills','industries','city','country','onboarded','deleted','isBot','isVisible','isStealthMode','startupStage','remoteOnly'];
const row=d=>({id:d.id,...d.data()});
const ownId=value=>{if(!validId(value))throw problem('Invalid item identifier.');return value;};
export function createBuilderService({db,now=Date.now,generate,plus=async()=>false,push=async()=>({sent:0})}){
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
 async function notify(uid,key,section,content,enabledPush=false){
  const n=db.collection('notifications').doc('builder_'+uid+'_'+key);
  const created=await db.runTransaction(async tx=>{const d=await tx.get(n);if(d.exists)return false;tx.set(n,{userId:uid,fromId:uid,fromName:'Linky',fromPic:'',type:'builder',content,section,serverPushManaged:true,pushRequested:enabledPush,isRead:false,timestamp:new Date(now())});return true;});
  if(created&&enabledPush)await push(uid,{title:'LINKUP · Your next move',body:content,url:'/builder?section='+encodeURIComponent(section)});
 }
 async function event(uid,type){
  // One bounded audit document per user; analytics must never refund a finished AI review.
  try{const r=db.collection('builderEvents').doc(uid);await db.runTransaction(async tx=>{const d=await tx.get(r);tx.set(r,{uid,events:[{type,at:now()},...(d.exists?d.data().events||[]:[])].slice(0,40)});});}catch(e){console.warn('[builder] audit unavailable');}
 }
 async function recommendations(uid,s){
  const candidates=await db.collection('publicProfiles').orderBy('__name__').limit(160).get();
  const ids=candidates.docs.map(d=>d.id).filter(k=>validId(k)&&k!==uid);if(!ids.length)return [];
  const [sources,states,outgoing,incoming]=await Promise.all([
   db.getAll(...ids.map(k=>db.collection('users').doc(k)),{fieldMask:fields}),
   db.getAll(...ids.map(k=>ref(k)),{fieldMask:['availability']}),
   db.collection('blocks').where('blockedById','==',uid).get(),db.collection('blocks').where('blockedUserId','==',uid).get()]);
  const unavailable=new Set([...outgoing.docs.map(d=>d.data().blockedUserId),...incoming.docs.map(d=>d.data().blockedById)]);
  const availability=new Map(states.filter(d=>d.exists).map(d=>[d.id,d.data().availability]));
  const people=sources.filter(d=>d.exists&&!unavailable.has(d.id)&&publicEligible(d.data(),d.id)).map(d=>({uid:d.id,...d.data(),name:clean(d.data().displayName||d.data().fullName||d.data().name,100),availability:availability.get(d.id)}));
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
 async function coach(uid,input){
  const kind=clean(input.kind,20),key=ownId(input.key),s=await state(uid),prompt=coachPrompt(kind,input.text,s);
  const existing=s.coachRuns.find(r=>r.key===key);if(existing){if(existing.status==='complete')return existing;if(existing.status==='pending')throw problem('This review is still processing. Refresh shortly.',409);throw problem('Retry this review with a new request.',409);}
  const epoch=await change(uid,current=>{if(current.coachRuns.some(r=>r.key===key))throw problem('This review is already processing.',409);current.coachRuns=[{key,kind,status:'pending',at:now()},...current.coachRuns].slice(0,15);return current.epoch;});
  let reservation;
  try{
   const me=await db.collection('users').doc(uid).get();reservation=await reserveMessage(db,uid,{plus:await plus(uid,me.data()),now:now()});
   if(!generate)throw new Error('Model unavailable');
   const text=clean(await generate(prompt),12000);if(!text)throw new Error('Empty response');
   const result={key,kind,status:'complete',at:now(),text};
   await change(uid,current=>{if(current.epoch!==epoch)throw problem('Your context was cleared while the review was running. The result was discarded.',409);current.coachRuns=current.coachRuns.map(r=>r.key===key?result:r);});
   await event(uid,'coach_completed');return {...result,messageQuota:reservation};
  }catch(error){if(reservation)await refundMessage(db,uid,reservation);await change(uid,current=>{current.coachRuns=current.coachRuns.map(r=>r.key===key?{...r,status:'failed'}:r);});if(error.code==='ask_limit'||error.builder)throw error;throw problem('The review could not finish. Your reserved chat message was refunded.',503);}
 }
 function contributionHistory(c,person){
  const legacy=(Array.isArray(person.shipLogs)?person.shipLogs:[]).slice(0,20).map(u=>({id:clean(u.id,128),text:clean(u.text,180),link:safeLink(u.link),createdAt:clean(u.createdAt,32)})).filter(u=>u.id&&u.text);
  return [...(c.updates||[]),...legacy].filter((u,i,all)=>all.findIndex(v=>v.id===u.id)===i).slice(0,20);
 }
 async function contributionData(uid,target){
  const own=target===uid,person=await db.collection('users').doc(target).get();
  if(!person.exists||person.data().deleted||person.data().banned||(!own&&(!publicEligible(person.data(),target)||await blocked(uid,target))))throw problem('This contribution calendar is not available.',403);
  const d=await db.collection('builderContributions').doc(target).get(),c=d.exists?d.data():{};
  return {days:Array.isArray(c.days)?c.days:[],points:Number(c.points)||0,totalUpdates:Number(c.totalUpdates)||0,timezone:'UTC',today:contributionDay(now()),
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
   if(previous){if(previous.text!==text||previous.link!==link)throw problem('This request was already used for a different update.',409);return {...previous,days:c.days,contributionPoints:c.points,totalUpdates:c.totalUpdates,shipLogs:contributionHistory(c,ud.data()),today:day,replayed:true};}
   if(c.lastDay===day)throw problem('Your contribution is already recorded today; your next square opens at midnight UTC.',409);
   if((c.updates||[]).some(u=>normalizeUpdate(u.text)===normalizeUpdate(text)))throw problem('This update is already recorded; share a new result or next step.',409);
   const entry={id:id(),key,text,link,createdAt,day,pointsAwarded:CONTRIBUTION_POINTS,insight:contributionInsight(text)},cutoff=contributionDay(at-(CONTRIBUTION_HISTORY_DAYS-1)*DAY);
   const days=[...new Set([...(c.days||[]).filter(d=>typeof d==='string'&&d>=cutoff&&d<=day),day])].sort().slice(-CONTRIBUTION_HISTORY_DAYS);
   const updates=[entry,...(c.updates||[])].slice(0,20),points=(Number(c.points)||0)+CONTRIBUTION_POINTS,totalUpdates=(Number(c.totalUpdates)||0)+1;
   // New text/insights stay private in the server-owned collection, never in
   // public profile fields. Neither activity nor posting grants verification.
   const shipLogs=contributionHistory({updates},ud.data());
   const state=stateOf(sd.data(),at);state.momentumDays=[...new Set([...state.momentumDays,localTime(at,state.prefs.timezone).day])].slice(-90);state.updatedAt=at;
   tx.set(cr,{version:1,days,updates,points,totalUpdates,lastDay:day,updatedAt:at});
   tx.set(ref(uid),state);
   return {...entry,days,contributionPoints:points,totalUpdates,shipLogs,today:day,replayed:false};
  });
 }
 async function handle(uid,op,input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw problem('Use an object for this action.');
  blockCache.clear();
  if(!validId(uid))throw problem('Sign in to continue.',401);
  const me=await db.collection('users').doc(uid).get();if(!me.exists||me.data().deleted||me.data().banned||me.data().onboarded!==true)throw problem('Finish your profile before opening the builder workspace.',403);
  // Bounded server-owned request counter, separate from the paid AI ledger.
  await db.runTransaction(async tx=>{const r=db.collection('builderRates').doc(uid),d=await tx.get(r),v=d.exists?d.data():{};const key=Math.floor(now()/60000),count=v.key===key?v.count:0;if(count>=60)throw problem('Please pause for a moment before trying again.',429);tx.set(r,{key,count:count+1});});
  if(op==='contributions')return contributionData(uid,input.targetUid?ownId(input.targetUid):uid);
  if(op==='shipUpdate')return publishContribution(uid,input);
  if(['home','visit'].includes(op))return loadHome(uid,op);
  if(op==='context'){await change(uid,s=>{const context=contextOf(input);if(context.project!==s.context.project||context.goal!==s.context.goal||context.needs!==s.context.needs)s.feedback={};s.context=context;});await event(uid,'context_set');return {ok:true};}
  if(op==='prefs'){await change(uid,s=>{s.prefs=sanitizePrefs(input,s.prefs);});return {ok:true,emailAvailable:false};}
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
  if(op==='coach')return coach(uid,input);
  if(op==='leads'){
   const s=await state(uid);return {leads:relevantLeads(s,EXTERNAL_LEADS,now()),note:'External public sources, not LINKUP members. Source access does not establish current availability or acceptance of pitches.'};
  }
  if(op==='leadSave'){if(!EXTERNAL_LEADS.some(l=>l.id===input.id))throw problem('Lead not found.',404);await change(uid,s=>{s.savedLeads=input.saved===false?s.savedLeads.filter(k=>k!==input.id):[...new Set([input.id,...s.savedLeads])].slice(0,50);});return {ok:true};}
  if(op==='roomCreate'){const title=requireText(input.title,120,3),kind=input.kind==='accountability'?'accountability':'project';const roomId=id();await db.runTransaction(async tx=>{const ownerState=await tx.get(ref(uid)),rooms=await tx.get(db.collection('builderRooms').where('ownerId','==',uid));if(rooms.docs.filter(d=>!d.data().archived).length>=12)throw problem('Archive an existing room before creating another.');tx.set(ref(uid),{...stateOf(ownerState.data(),now()),updatedAt:now()});tx.set(db.collection('builderRooms').doc(roomId),{ownerId:uid,title,kind,goal:clean(input.goal,300),milestone:clean(input.milestone,300),memberIds:[uid],tasks:[],logs:[],messages:[],links:[],archived:false,createdAt:now(),updatedAt:now()});});await event(uid,'room_created');return {roomId};}
  if(op==='room')return {room:await roomFor(uid,input.roomId)};
  if(op==='roomInvite'){
   const r=await roomFor(uid,input.roomId);if(r.archived)throw problem('This room is archived.');await connectable(uid,input.targetUid);const otherState=await state(input.targetUid);if(!otherState.prefs.allowInvites)throw problem('This member has paused workspace invitations.');
   if(r.memberIds.includes(input.targetUid))throw problem('This member is already in the room.');
   const inviteId=r.id+'_'+input.targetUid,iref=db.collection('builderInvites').doc(inviteId);
   await db.runTransaction(async tx=>{const prev=await tx.get(iref);if(prev.exists&&['pending','declined'].includes(prev.data().status)&&now()-prev.data().createdAt<7*DAY)throw problem('An invitation was already sent recently.');tx.set(iref,{roomId:r.id,senderId:uid,recipientId:input.targetUid,status:'pending',createdAt:now(),expiresAt:now()+7*DAY});});
   await notify(input.targetUid,inviteId,'Rooms','A connected member invited you to a building room. Review the invitation before joining.');return {ok:true};
  }
  if(op==='invitationRespond'){
   const iref=db.collection('builderInvites').doc(ownId(input.id)),first=await iref.get();if(!first.exists||first.data().recipientId!==uid)throw problem('Invitation not found.',404);if(!['accept','decline'].includes(input.decision))throw problem('Choose accept or decline.');await connectable(uid,first.data().senderId);
   await db.runTransaction(async tx=>{const inv=await tx.get(iref),rr=db.collection('builderRooms').doc(inv.data().roomId),rd=await tx.get(rr),v=inv.data(),r=rd.exists?rd.data():null;
    if(v.recipientId!==uid||v.status!=='pending'||v.expiresAt<=now()||!r||r.archived||!r.memberIds.includes(v.senderId))throw problem('This invitation is no longer active.',409);
    if(input.decision==='accept'){if(r.memberIds.length>=(r.kind==='accountability'?2:8))throw problem('This room is full.');tx.update(rr,{memberIds:[...new Set([...r.memberIds,uid])],updatedAt:now()});}
    tx.update(iref,{status:input.decision==='accept'?'accepted':'declined',respondedAt:now()});});await event(uid,'invitation_'+input.decision);return {ok:true};
  }
  if(op==='roomAction'){
   if(!['leave','archive'].includes(input.action))await roomFor(uid,input.roomId);else ownId(input.roomId);let meaningful=false;const rr=db.collection('builderRooms').doc(input.roomId);
   await db.runTransaction(async tx=>{meaningful=false;const doc=await tx.get(rr);if(!doc.exists||!doc.data().memberIds.includes(uid))throw problem('Room access was removed.',403);const r=doc.data();if(r.archived)throw problem('This room is archived.');const action=input.action;
    if(action==='archive'){if(r.ownerId!==uid)throw problem('Only the room owner can archive it.',403);r.archived=true;}
    else if(action==='leave'){if(r.ownerId===uid)throw problem('Archive your room instead of leaving it.');r.memberIds=r.memberIds.filter(k=>k!==uid);}
    else if(action==='remove'){if(r.ownerId!==uid||input.targetUid===uid)throw problem('Only the owner can remove another member.',403);r.memberIds=r.memberIds.filter(k=>k!==input.targetUid);}
    else if(action==='plan'){if(r.ownerId!==uid)throw problem('Only the owner can edit the room plan.',403);r.goal=requireText(input.goal,300,4);r.milestone=requireText(input.milestone,300,4);}
    else if(action==='task'){if(r.tasks.length>=40)throw problem('This room has reached its task limit.');const assignee=clean(input.assignee,128);if(assignee&&!r.memberIds.includes(assignee))throw problem('Assign tasks only to accepted members.');r.tasks.push({id:id(),text:requireText(input.text,250,3),assignee,ownerId:uid,doneAt:0,at:now()});}
    else if(action==='taskDone'){const task=r.tasks.find(t=>t.id===input.taskId);if(!task)throw problem('Task not found.',404);if(task.assignee&&task.assignee!==uid&&r.ownerId!==uid)throw problem('Only the assignee or owner can complete this task.',403);if(!task.doneAt){task.doneAt=now();meaningful=true;}}
    else if(action==='log'){r.logs=[{id:id(),ownerId:uid,text:requireText(input.text,300,4),at:now()},...r.logs].slice(0,60);}
    else if(action==='message'){r.messages=[...r.messages,{id:id(),ownerId:uid,text:requireText(input.text,1500,1),at:now()}].slice(-80);}
    else if(action==='link'){const url=safeLink(input.url);if(!url)throw problem('Use a public HTTPS link.');r.links=[{id:id(),ownerId:uid,title:requireText(input.text,120),url,at:now()},...r.links].slice(0,20);}
    else throw problem('Unknown room action.');r.updatedAt=now();tx.set(rr,r);
   });
   if(input.action==='log'||meaningful)await change(uid,s=>{s.momentumDays=[...new Set([...s.momentumDays,localTime(now(),s.prefs.timezone).day])].slice(-90);});return {ok:true};
  }
  if(op==='asks')return listAsks(uid,input);
  if(op==='askCreate'){
   if(!publicEligible(me.data(),uid))throw problem('Use a public profile to post a public help request.');const askId=id();await db.runTransaction(async tx=>{const ownerState=await tx.get(ref(uid)),existing=await tx.get(db.collection('builderAsks').where('ownerId','==',uid));if(existing.docs.filter(d=>d.data().status==='open'&&d.data().expiresAt>now()).length>=5)throw problem('Close an existing request first.');tx.set(ref(uid),{...stateOf(ownerState.data(),now()),updatedAt:now()});tx.set(db.collection('builderAsks').doc(askId),{ownerId:uid,title:requireText(input.title,140,6),details:requireText(input.details,1500,12),question:requireText(input.question,300,6),kind:input.kind==='launch'?'launch':'help',compensation:['paid','voluntary','partnership'].includes(input.compensation)?input.compensation:'voluntary',minutes:Math.max(5,Math.min(120,Number(input.minutes)||15)),url:safeLink(input.url),status:'open',feedback:[],createdAt:now(),expiresAt:now()+14*DAY});});await event(uid,'ask_created');return {askId};
  }
  if(['askClose','askFeedback','askFeedbackStatus'].includes(op)){
   const ar=db.collection('builderAsks').doc(ownId(input.id)),first=await ar.get();if(!first.exists)throw problem('Request not found.',404);
   const ownerDoc=await db.collection('users').doc(first.data().ownerId).get();if(first.data().ownerId!==uid&&(!ownerDoc.exists||!publicEligible(ownerDoc.data(),first.data().ownerId)||await blocked(uid,first.data().ownerId)))throw problem('This request is unavailable.',403);
   const recognized=await db.runTransaction(async tx=>{let recognizedUid='';const doc=await tx.get(ar),a=doc.data();if(op==='askClose'){if(a.ownerId!==uid)throw problem('Only the author can close a request.',403);a.status='closed';a.closedAt=now();}
    if(op==='askFeedback'){if(a.status!=='open'||a.expiresAt<=now()||a.ownerId===uid)throw problem('This request cannot receive your feedback.');if(a.feedback.length>=40||a.feedback.some(f=>f.authorId===uid))throw problem('Feedback already exists or this round is full.');a.feedback.push({id:id(),authorId:uid,authorName:clean(me.data().displayName||me.data().fullName||me.data().name,100),text:requireText(input.text,1200,12),at:now(),useful:false});}
    if(op==='askFeedbackStatus'){if(a.ownerId!==uid)throw problem('Only the author can recognise feedback.',403);const f=a.feedback.find(f=>f.id===input.feedbackId);if(!f)throw problem('Feedback not found.',404);if(!f.useful)recognizedUid=f.authorId;f.useful=true;f.outcome=requireText(input.outcome,300,4);}
    a.feedbackAuthorIds=[...new Set(a.feedback.map(f=>f.authorId))];tx.set(ar,a);return recognizedUid;});if(validId(recognized)){const author=await db.collection('users').doc(recognized).get();if(author.exists&&!author.data().deleted)await change(recognized,s=>{s.momentumDays=[...new Set([...s.momentumDays,localTime(now(),s.prefs.timezone).day])].slice(-90);});}await event(uid,op);return {ok:true};
  }
  if(op==='export'){const s=await state(uid);return {state:s,notice:'Shared room content is visible to accepted members. Private building context and notes are never part of the public profile.'};}
  if(op==='forget'){
   await change(uid,s=>{const prefs={...s.prefs,reminders:false,digest:false,friday:false,push:false};Object.keys(s).forEach(k=>delete s[k]);Object.assign(s,freshState(now()),{prefs});});return {ok:true,notice:'Private context, notes and saved reviews cleared. Shared rooms and posted feedback remain shared; archive rooms or close requests separately.'};
  }
  throw problem('Unsupported builder action.');
 }
 async function runReminderPage({after='',limit=40}={}){
  let query=db.collection('builderStates').orderBy('__name__').limit(Math.min(40,limit));if(after)query=query.startAfter(after);const docs=(await query.get()).docs;let delivered=0,lastProcessed=after;const started=Date.now();
  for(const d of docs){if(Date.now()-started>40000)return {delivered,nextCursor:lastProcessed};lastProcessed=d.id;const user=await db.collection('users').doc(d.id).get();if(!user.exists||user.data().deleted){await db.collection('builderContributions').doc(d.id).delete();continue;}if(user.data().banned||user.data().onboarded!==true)continue;
   const prior=stateOf(d.data(),now()),clock=localTime(now(),prior.prefs.timezone);
   const eligibleReview=!prior.lastDeliveryAt||now()-prior.lastDeliveryAt>=20*3600000;
   const needsReview=eligibleReview&&((prior.prefs.friday&&prior.lastFriday!==weekKey(now(),prior.prefs.timezone)&&clock.weekday==='Fri'&&clock.hour>=9&&clock.hour<19)||(prior.prefs.digest&&prior.lastDigest!==weekKey(now(),prior.prefs.timezone)&&clock.weekday==='Sun'&&clock.hour>=17&&clock.hour<20));
   const review=needsReview?await reviewFor(d.id,prior):null;
   let delivery=null,prefs;
   await db.runTransaction(async tx=>{delivery=null;prefs=null;const fresh=await tx.get(d.ref),s=stateOf(fresh.data(),now());if(review&&(s.epoch!==prior.epoch||s.updatedAt!==prior.updatedAt))return;const n=nextDelivery(s,now(),review);if(!n)return;
    const nr=db.collection('notifications').doc('builder_'+d.id+'_'+n.key),previous=await tx.get(nr);if(previous.exists)return;
    prefs=s.prefs;delivery=n;s.lastDeliveryAt=now();if(n.key.startsWith('followup'))s.followups=s.followups.map(f=>f.status==='open'&&f.dueAt<=now()?{...f,notifiedAt:now()}:f);if(n.key.startsWith('digest'))s.lastDigest=weekKey(now(),s.prefs.timezone);if(n.key.startsWith('friday')){s.lastFriday=weekKey(now(),s.prefs.timezone);s.deliveredOpportunityKeys=[...new Set([...(s.deliveredOpportunityKeys||[]),...review.newOpportunities.map(o=>o.key)])].slice(-100);}if(review)s.latestSummary={...review,summaryAt:now()};
    tx.set(d.ref,s);if(prefs.inApp)tx.set(nr,{userId:d.id,fromId:d.id,fromName:'Linky',fromPic:'',type:'builder',content:n.content,section:n.section,serverPushManaged:true,pushRequested:prefs.push,...(review?{builderSummary:review.summary}:{}),isRead:false,timestamp:new Date(now())});
    else tx.set(nr,{userId:d.id,fromId:d.id,fromName:'Linky',type:'builder',content:n.content,section:n.section,serverPushManaged:true,pushRequested:prefs.push,...(review?{builderSummary:review.summary}:{}),isRead:true,timestamp:new Date(now())});
   });
   if(delivery){delivered++;if(prefs.push){const nr=db.collection('notifications').doc('builder_'+d.id+'_'+delivery.key);try{const result=await push(d.id,{title:'LINKUP · Your next move',body:'Your private building update is ready. Open LINKUP to review it.',url:'/builder?section='+encodeURIComponent(delivery.section)});await nr.set({pushStatus:result?.sent>0?'provider_accepted':'not_accepted',pushAttemptAt:now()},{merge:true});}catch{await nr.set({pushStatus:'failed',pushAttemptAt:now()},{merge:true});}}}
  }return {delivered,nextCursor:docs.length===Math.min(40,limit)?docs.at(-1).id:null};
 }
 return {handle,runReminderPage};
}
