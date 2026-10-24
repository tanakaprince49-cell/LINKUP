import {DAY,id,clean,requireText,validId,problem,stateOf} from './_builderCore.js';
import {containsCredential} from '../shared/contributions.js';
const cursor=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,300}$/.test(value))throw problem('Invalid message or invitation cursor.');return value;};
const own=value=>{if(!validId(value))throw problem('Invalid group identifier.');return value;};
export function createGroupService({db,now,blocked,connectable,notify}){
 async function checkBlocks(tx,uid,members){const [a,b]=await Promise.all([tx.get(db.collection('blocks').where('blockedById','==',uid)),tx.get(db.collection('blocks').where('blockedUserId','==',uid))]);const denied=new Set([...a.docs.map(d=>d.data().blockedUserId),...b.docs.map(d=>d.data().blockedById)]);if(members.some(other=>other!==uid&&denied.has(other)))throw problem('A blocked member is present.',403);}
 const ref=gid=>db.collection('builderRooms').doc(own(gid));
 async function access(uid,gid,{manage=false}={}){
  const d=await ref(gid).get(),g=d.data();if(!d.exists||!g.memberIds?.includes(uid))throw problem('This group is not available.',403);
  const unavailable=[];for(const u of g.memberIds)if(u!==uid&&await blocked(uid,u))unavailable.push(u);
  if(unavailable.length&&!(manage&&g.ownerId===uid))throw problem('Group chat is unavailable while a blocked member is present.',403);
  return {id:d.id,...g,unavailable};
 }
 async function metadata(uid,g){
  const users=await db.getAll(...g.memberIds.map(u=>db.collection('users').doc(u)),{fieldMask:['displayName','fullName','name','isVerified','deleted','banned']});
  return {id:g.id,title:g.title,description:g.description||'',ownerId:g.ownerId,archived:!!g.archived,memberCount:g.memberIds.length,blocked:!!g.unavailable.length,legacy:g.kind!=='group',members:users.map(u=>({uid:u.id,name:!u.exists||u.data().deleted||u.data().banned?'Former member':g.unavailable.includes(u.id)?'Unavailable member':clean(u.data().displayName||u.data().fullName||u.data().name,100),verified:u.exists&&!g.unavailable.includes(u.id)&&u.data().isVerified===true,unavailable:g.unavailable.includes(u.id)})),createdAt:g.createdAt,updatedAt:g.updatedAt};
 }
 async function messages(uid,input){
  const g=await access(uid,input.groupId);const collection=ref(g.id).collection('messages');let q;
  if(input.after&&input.before)throw problem('Choose one message cursor.');
  const direction=input.after?'asc':'desc';q=collection.orderBy('at',direction).orderBy('__name__',direction);
  if(input.after||input.before){const cursorDoc=await collection.doc(cursor(input.after||input.before)).get();if(!cursorDoc.exists)throw problem('Refresh the conversation to reset its cursor.',409);q=q.startAfter(cursorDoc.data().at,cursorDoc.id);}
  const s=await q.limit(51).get(),docs=s.docs.slice(0,50),items=docs.map(d=>({id:d.id,authorId:d.data().authorId,text:d.data().text,at:d.data().at}));if(direction==='desc')items.reverse();
  return {messages:items,more:s.docs.length>50,nextAfter:items.at(-1)?.id||null,nextBefore:items[0]?.id||null,archived:!!g.archived};
 }
 async function handle(uid,op,input){
  if(op==='groups'){
   const [r,i]=await Promise.all([db.collection('builderRooms').where('memberIds','array-contains',uid).limit(50).get(),db.collection('builderInvites').where('recipientId','==',uid).limit(100).get()]);const groups=[],invitations=[];
   for(const d of r.docs){try{const g=await access(uid,d.id,{manage:true});groups.push({id:g.id,title:g.title,ownerId:g.ownerId,memberCount:g.memberIds.length,archived:!!g.archived,updatedAt:g.updatedAt,preview:g.unavailable.length?'Manage an unavailable member before chatting.':clean(g.lastMessage?.text,100),unread:!!g.lastMessage&&g.lastMessage.authorId!==uid&&g.lastMessage.at>(g.readAt?.[uid]||0),blocked:!!g.unavailable.length});}catch(e){if(e.status===403)groups.push({id:d.id,title:'Unavailable group',ownerId:'',memberCount:0,archived:false,updatedAt:d.data().updatedAt,preview:'Leave or resolve your blocked connection before chatting.',blocked:true,canLeave:true});}}
   for(const d of i.docs){const inv=d.data();if(inv.status!=='pending'||inv.expiresAt<=now())continue;try{await connectable(uid,inv.senderId);const r=await ref(inv.roomId).get();if(r.exists&&!r.data().archived&&r.data().ownerId===inv.senderId)invitations.push({id:d.id,groupId:r.id,title:r.data().title,senderId:inv.senderId,expiresAt:inv.expiresAt});}catch{}}
   return {groups:groups.sort((a,b)=>b.updatedAt-a.updatedAt),invitations};
  }
  if(op==='groupCreate'){
   const title=requireText(input.title,80,3),description=clean(input.description,240),gid=id();if(containsCredential(title)||containsCredential(description))throw problem('Remove credentials before sharing.');
   await db.runTransaction(async tx=>{const stateRef=db.collection('builderStates').doc(uid),[s,existing]=await Promise.all([tx.get(stateRef),tx.get(db.collection('builderRooms').where('ownerId','==',uid))]);if(existing.docs.filter(d=>!d.data().archived).length>=12)throw problem('Archive an existing group first.');tx.set(stateRef,{...stateOf(s.data(),now()),updatedAt:now()});tx.set(ref(gid),{title,description,kind:'group',ownerId:uid,memberIds:[uid],readAt:{},createdAt:now(),updatedAt:now(),archived:false});});return {groupId:gid};
  }
  if(op==='groupGet'){
   const g=await access(uid,input.groupId,{manage:true}),group=await metadata(uid,g);return {group,...(group.blocked?{messages:[],more:false}:await messages(uid,{groupId:g.id}))};
  }
  if(op==='groupMessages')return messages(uid,input);
  if(op==='groupSend'){
   await access(uid,input.groupId);const text=requireText(input.text,2000,1),key=own(input.key),rr=ref(input.groupId),mr=rr.collection('messages').doc(uid+'_'+key);
   if(containsCredential(text))throw problem('Remove credentials before sending.');
   return db.runTransaction(async tx=>{const [d,previous,u]=await Promise.all([tx.get(rr),tx.get(mr),tx.get(db.collection('users').doc(uid))]),g=d.data();
    if(!d.exists||!g.memberIds.includes(uid)||!u.exists||u.data().deleted||u.data().banned)throw problem('Group access was removed.',403);if(g.archived)throw problem('This group is archived.',409);
    await checkBlocks(tx,uid,g.memberIds);
    if(previous.exists){if(previous.data().text!==text)throw problem('This send request was used for a different message.',409);return {message:{id:previous.id,...previous.data()},replayed:true};}
    const message={authorId:uid,text,at:now()};tx.set(mr,message);tx.update(rr,{updatedAt:now(),lastMessage:message,authorIds:[...new Set([...(g.authorIds||[]),uid])],['readAt.'+uid]:now()});return {message:{id:mr.id,...message},replayed:false};
   });
  }
  if(op==='groupRead'){await access(uid,input.groupId);await db.runTransaction(async tx=>{const rr=ref(input.groupId),d=await tx.get(rr);if(!d.exists||!d.data().memberIds.includes(uid))throw problem('Group access was removed.',403);tx.update(rr,{['readAt.'+uid]:now()});});return {ok:true};}
  if(op==='groupInvite'){
   const g=await access(uid,input.groupId);if(g.ownerId!==uid)throw problem('Only the group admin can invite members.',403);if(g.archived)throw problem('This group is archived.');await connectable(uid,input.targetUid);
   const ir=db.collection('builderInvites').doc(g.id+'_'+own(input.targetUid));
   await db.runTransaction(async tx=>{const [fresh,previous,settings,target]=await Promise.all([tx.get(ref(g.id)),tx.get(ir),tx.get(db.collection('builderStates').doc(input.targetUid)),tx.get(db.collection('users').doc(input.targetUid))]),r=fresh.data();
    if(!fresh.exists||r.ownerId!==uid||r.archived)throw problem('Group administration changed.',409);await checkBlocks(tx,uid,[...r.memberIds,input.targetUid]);if(!target.exists||target.data().deleted||target.data().banned)throw problem('This member is unavailable.',403);if(settings.data()?.prefs?.allowInvites===false)throw problem('This member has paused invitations.');if(r.memberIds.includes(input.targetUid))throw problem('This member already joined.');if(r.memberIds.length>=32)throw problem('This group is full.');if(previous.exists&&previous.data().senderId===uid&&['pending','declined'].includes(previous.data().status)&&now()-previous.data().createdAt<7*DAY)throw problem('An invitation was already sent recently.');
    tx.set(ir,{roomId:g.id,senderId:uid,recipientId:input.targetUid,status:'pending',createdAt:now(),expiresAt:now()+7*DAY});});
   await notify(input.targetUid,g.id+'_'+input.targetUid,'Rooms','You have a private group invitation. Review it before joining.');return {ok:true};
  }
  if(op==='groupRespond'){
   if(!['accept','decline'].includes(input.decision))throw problem('Accept or decline the invitation.');const ir=db.collection('builderInvites').doc(cursor(input.id)),initial=await ir.get();if(!initial.exists||initial.data().recipientId!==uid)throw problem('Invitation not found.',404);
   if(input.decision==='accept'){await connectable(uid,initial.data().senderId);const d=await ref(initial.data().roomId).get();if(!d.exists)throw problem('Group not found.',404);for(const other of d.data().memberIds)if(other!==uid&&await blocked(uid,other))throw problem('A blocked member is present.',403);}
   await db.runTransaction(async tx=>{const i=await tx.get(ir),v=i.data();if(!i.exists||v.recipientId!==uid||v.status!=='pending'||v.expiresAt<=now())throw problem('This invitation is no longer active.',409);const rr=ref(v.roomId),[d,bs]=await Promise.all([tx.get(rr),tx.get(db.collection('builderStates').doc(uid))]),g=d.data();if(!d.exists||g.archived||!g.memberIds.includes(v.senderId))throw problem('This group invitation is no longer active.',409);if(input.decision==='accept'){if(g.ownerId!==v.senderId)throw problem('The group admin changed. Ask for a fresh invitation.',409);await checkBlocks(tx,uid,g.memberIds);if(g.memberIds.length>=32&&!g.memberIds.includes(uid))throw problem('This group is full.');tx.update(rr,{memberIds:[...new Set([...g.memberIds,uid])],updatedAt:now()});}if(input.decision==='accept'&&!bs.exists)tx.set(db.collection('builderStates').doc(uid),stateOf({},now()));tx.update(ir,{status:input.decision==='accept'?'accepted':'declined',respondedAt:now()});});return {ok:true};
  }
  if(op==='groupAction'){
   const action=input.action;if(!['leave','archive','remove','rename','transfer'].includes(action))throw problem('Unknown group action.');
   // Leaving/removing an unavailable member never requires access to chat text.
   const rr=ref(input.groupId);return db.runTransaction(async tx=>{const d=await tx.get(rr),g=d.data();if(!d.exists||!g.memberIds.includes(uid))throw problem('This group is not available.',403);
    if(action==='leave'){if(g.ownerId===uid&&!g.archived)throw problem('Transfer admin or archive your group before leaving.');g.memberIds=g.memberIds.filter(k=>k!==uid);if(g.ownerId===uid)g.ownerId='';}
    else {if(g.ownerId!==uid)throw problem('Only the group admin can do this.',403);if(action==='archive')g.archived=true;
     if(action==='rename'){g.title=requireText(input.title,80,3);if(containsCredential(g.title))throw problem('Remove credentials before sharing.');g.description=clean(input.description,240);if(containsCredential(g.description))throw problem('Remove credentials before sharing.');}
     if(action==='remove'||action==='transfer'){const target=own(input.targetUid);if(target===uid||!g.memberIds.includes(target))throw problem('Choose another current group member.');if(action==='remove')g.memberIds=g.memberIds.filter(k=>k!==target);else g.ownerId=target;}
    }g.updatedAt=now();tx.set(rr,g);return {ok:true};});
  }
  if(op==='groupExport'){const g=await access(uid,input.groupId);return {exportScope:'Latest 50 messages plus retained legacy project notes. Use nextBefore for earlier history.',group:await metadata(uid,g),legacy:{goal:g.goal||'',milestone:g.milestone||'',tasks:g.tasks||[],logs:g.logs||[],links:g.links||[],messages:g.messages||[]},...(await messages(uid,{groupId:g.id}))};}
  throw problem('Unknown group operation.');
 }
 return {handle};
}

// Bounded, repeatable cleanup. Access is denied immediately by the user check;
// retained private state lets the existing cron finish large deletions in pages.
export async function cleanupDeletedGroupData(db,uid,at=Date.now()){
 const [membership,authored]=await Promise.all([db.collection('builderRooms').where('memberIds','array-contains',uid).limit(20).get(),db.collection('builderRooms').where('authorIds','array-contains',uid).limit(20).get()]);
 const docs=new Map([...membership.docs,...authored.docs].map(d=>[d.id,d]));let more=false;
 for(const d of docs.values()){
  const noMembers=(d.data().memberIds||[]).filter(k=>k!==uid).length===0;
  let q=d.ref.collection('messages');if(!noMembers)q=q.where('authorId','==',uid);const messages=await q.limit(201).get(),page=messages.docs.slice(0,200),remaining=messages.size>200;more ||= remaining;
  await db.runTransaction(async tx=>{const fresh=await tx.get(d.ref);if(!fresh.exists)return;const g=fresh.data(),members=(g.memberIds||[]).filter(k=>k!==uid);page.filter(m=>!members.length||m.data().authorId===uid).forEach(m=>tx.delete(m.ref));
   if(!members.length&&noMembers&&!remaining){tx.delete(d.ref);return;}
   const pending=remaining||(!members.length&&!noMembers);more ||= pending;
   tx.update(d.ref,{memberIds:members,...(g.lastMessage?.authorId===uid?{lastMessage:null}:{}),...(!members.length?{archived:true}:{}),authorIds:pending?(g.authorIds||[]):(g.authorIds||[]).filter(k=>k!==uid),...(g.ownerId===uid?{archived:true,ownerId:''}:{}),messages:(g.messages||[]).filter(m=>m.ownerId!==uid),logs:(g.logs||[]).filter(m=>m.ownerId!==uid),links:(g.links||[]).filter(m=>m.ownerId!==uid),updatedAt:at});
  });
 }
 return {more:more||membership.size===20||authored.size===20};
}

// Also finds former authors whose private builder state was already erased by
// account deletion. Bounded sweep/cursor avoids a full group scan on each cron.
export async function sweepDeletedGroupData(db,at=Date.now()){
 const marker=db.collection('builderScheduler').doc('group-retention'),previous=await marker.get(),s=previous.data()||{};
 let q=db.collection('builderRooms').orderBy('__name__').limit(10);if(s.after)q=q.startAfter(s.after);const page=await q.get();let after=s.after||'',afterUid=s.afterUid||'',cleaned=0;
 for(const d of page.docs){
  const ids=[...new Set([...(d.data().memberIds||[]),...(d.data().authorIds||[])])].sort().filter(uid=>!afterUid||uid>afterUid).slice(0,100);
  if(ids.length){const users=await db.getAll(...ids.map(uid=>db.collection('users').doc(uid)),{fieldMask:['deleted']});for(const u of users){if(!u.exists||u.data().deleted){await cleanupDeletedGroupData(db,u.id,at);cleaned++;}afterUid=u.id;if(cleaned>=2){await marker.set({after,afterUid,at});return {cleaned};}}}
  if(ids.length===100){await marker.set({after,afterUid,at});return {cleaned};}after=d.id;afterUid='';
 }
 await marker.set({after:page.size===10?after:'',afterUid:'',at});return {cleaned};
}
