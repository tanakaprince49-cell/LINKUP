import {DAY,id,clean,requireText,validId,problem,stateOf} from './_builderCore.js';
import {groupIsAdmin,groupBadges,groupMessage,groupChanges,GROUP_REACTIONS} from '../shared/group-policy.js';
import {isGoldMember} from '../shared/member-badges.js';
import {containsCredential} from '../shared/contributions.js';
const cursor=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,300}$/.test(value))throw problem('Invalid message or invitation cursor.');return value;};
const own=value=>{if(!validId(value))throw problem('Invalid group identifier.');return value;};
export function createGroupService({db,now,blocked,connectable,notify,plus=async()=>false}){
 async function assertActor(tx,uid){const u=await tx.get(db.collection('users').doc(uid));if(!u.exists||u.data().deleted||u.data().banned||u.data().onboarded!==true)throw problem('Your profile is unavailable.',403);}
 async function checkBlocks(tx,uid,members){const [a,b]=await Promise.all([tx.get(db.collection('blocks').where('blockedById','==',uid)),tx.get(db.collection('blocks').where('blockedUserId','==',uid))]);const denied=new Set([...a.docs.map(d=>d.data().blockedUserId),...b.docs.map(d=>d.data().blockedById)]);if(members.some(other=>other!==uid&&denied.has(other)))throw problem('A blocked member is present.',403);}
 const safePhoto=v=>{if(typeof v!=='string'||v.length>2048)return '';try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
 async function badgesFor(g){const badges=groupBadges(g);if(g.creatorPlus!==undefined||badges.verified)return badges;const uid=g.creatorId;if(!uid)return badges;const [u]=await db.getAll(db.collection('users').doc(uid),{fieldMask:['isPro','plan','subscriptionPlan','subscriptionStatus','entitlements']});return {...badges,verified:!!u?.exists&&await plus(uid,u.data())};}
 const ref=gid=>db.collection('builderRooms').doc(own(gid));
 async function access(uid,gid,{manage=false}={}){
  const d=await ref(gid).get(),g=d.data();if(!d.exists||!g.memberIds?.includes(uid))throw problem('This group is not available.',403);
  const unavailable=[];for(const u of g.memberIds)if(u!==uid&&await blocked(uid,u))unavailable.push(u);
  if(unavailable.length&&!(manage&&groupIsAdmin(g,uid)))throw problem('Group chat is unavailable while a blocked member is present.',403);
  return {id:d.id,...g,unavailable};
 }
 async function metadata(uid,g){
  const users=await db.getAll(...g.memberIds.map(u=>db.collection('users').doc(u)),{fieldMask:['displayName','fullName','name','profilePicUrl','photoURL','isVerified','deleted','banned','isPro','plan','subscriptionPlan','subscriptionStatus','entitlements']});
  const members=await Promise.all(users.map(async u=>{const p=u.data()||{},unavailable=!u.exists||p.deleted||p.banned||g.unavailable.includes(u.id);return {uid:u.id,name:unavailable?'Unavailable member':clean(p.displayName||p.fullName||p.name,100),avatar:unavailable?'':safePhoto(p.profilePic||p.profilePicUrl||p.photoURL),verified:!unavailable&&(isGoldMember(u.id)||p.isVerified===true||await plus(u.id,p)),admin:groupIsAdmin(g,u.id),unavailable};}));
  const badges=await badgesFor(g);
  return {id:g.id,title:g.title,description:g.description||'',photo:safePhoto(g.photo),rules:g.rules||'',ownerId:g.ownerId,adminIds:g.adminIds||[],creatorId:g.creatorId||'',...badges,archived:!!g.archived,announcementsOnly:!!g.announcementsOnly,discoverable:g.discoverable!==false,pinnedMessage:g.pinnedMessage||null,preferences:g.preferences?.[uid]||{},bannedIds:groupIsAdmin(g,uid)?g.bannedIds||[]:[],memberCount:g.memberIds.length,blocked:!!g.unavailable.length,legacy:g.kind!=='group',members,createdAt:g.createdAt,updatedAt:g.updatedAt};
 }
 async function messages(uid,input){
  const g=await access(uid,input.groupId);const collection=ref(g.id).collection('messages');let q;
  if(input.after&&input.before)throw problem('Choose one message cursor.');
  const direction=input.after?'asc':'desc';q=collection.orderBy('at',direction).orderBy('__name__',direction);
  if(input.after||input.before){const cursorDoc=await collection.doc(cursor(input.after||input.before)).get();if(!cursorDoc.exists)throw problem('Refresh the conversation to reset its cursor.',409);q=q.startAfter(cursorDoc.data().at,cursorDoc.id);}
  const s=await q.limit(51).get(),docs=s.docs.slice(0,50),items=docs.map(d=>groupMessage({id:d.id,...d.data()}));if(direction==='desc')items.reverse();
  if(input.revision!==undefined&&(!Number.isSafeInteger(input.revision)||input.revision<0))throw problem('Refresh the conversation to reset its revision.',409);
  const journal=g.recentChanges||[],refreshRequired=input.revision!==undefined&&journal.length>0&&input.revision<journal[0].version-1,changeIds=input.revision===undefined?[]:[...new Set(journal.filter(v=>v.version>input.revision).map(v=>v.id))];
  const changes=changeIds.length?(await db.getAll(...changeIds.map(k=>collection.doc(cursor(k))))).map(d=>d.exists?groupMessage({id:d.id,...d.data()}):{id:d.id,authorId:'',at:0,text:'Message deleted',deleted:true,reactions:{}}):[];
  const replyIds=[...new Set(items.map(m=>m.replyTo).filter(Boolean))];if(replyIds.length){const replies=await db.getAll(...replyIds.map(k=>collection.doc(cursor(k))));for(const m of items){const r=replies.find(d=>d.id===m.replyTo);if(r)m.reply={id:r.id,authorId:r.data()?.authorId||'',text:!r.exists||r.data().deleted?'Message deleted':clean(r.data().text,120)};}}
  return {revision:g.revision||0,changes,refreshRequired,settings:{title:g.title,photo:safePhoto(g.photo),description:g.description||'',rules:g.rules||'',ownerId:g.ownerId,adminIds:g.adminIds||[],pinnedMessage:g.pinnedMessage||null,announcementsOnly:!!g.announcementsOnly,preferences:g.preferences?.[uid]||{}},messages:items,more:s.docs.length>50,nextAfter:items.at(-1)?.id||null,nextBefore:items[0]?.id||null,archived:!!g.archived};
 }
 async function handle(uid,op,input){
  if(op==='groups'){
   const [r,i]=await Promise.all([db.collection('builderRooms').where('memberIds','array-contains',uid).limit(50).get(),db.collection('builderInvites').where('recipientId','==',uid).limit(100).get()]);const groups=[],invitations=[];
   for(const d of r.docs){try{const g=await access(uid,d.id,{manage:true});groups.push({id:g.id,title:g.title,ownerId:g.ownerId,photo:safePhoto(g.photo),...await badgesFor(g),preferences:g.preferences?.[uid]||{},memberCount:g.memberIds.length,archived:!!g.archived,discoverable:g.discoverable!==false,updatedAt:g.updatedAt,preview:g.unavailable.length?'Manage an unavailable member before chatting.':clean(g.lastMessage?.text,100),unread:!!g.lastMessage&&g.lastMessage.authorId!==uid&&g.lastMessage.at>(g.readAt?.[uid]||0),blocked:!!g.unavailable.length});}catch(e){if(e.status===403)groups.push({id:d.id,title:'Unavailable group',ownerId:'',memberCount:0,archived:false,updatedAt:d.data().updatedAt,preview:'Leave or resolve your blocked connection before chatting.',blocked:true,canLeave:true});}}
   for(const d of i.docs){const inv=d.data();if(inv.status!=='pending'||inv.expiresAt<=now())continue;try{await connectable(uid,inv.senderId);const r=await ref(inv.roomId).get();if(r.exists&&!r.data().archived&&groupIsAdmin(r.data(),inv.senderId))invitations.push({id:d.id,groupId:r.id,title:r.data().title,senderId:inv.senderId,description:r.data().description||'',rules:r.data().rules||'',role:inv.role||'member',expiresAt:inv.expiresAt});}catch{}}
   return {groups:groups.sort((a,b)=>Number(!!b.preferences?.pinned)-Number(!!a.preferences?.pinned)||b.updatedAt-a.updatedAt),invitations};
  }
  if(op==='groupCreate'){
   const creator=await db.collection('users').doc(uid).get(),creatorPlus=await plus(uid,creator.data());
   const title=requireText(input.title,80,3),description=clean(input.description,240),gid=id();if(containsCredential(title)||containsCredential(description))throw problem('Remove credentials before sharing.');
   await db.runTransaction(async tx=>{await assertActor(tx,uid);const stateRef=db.collection('builderStates').doc(uid),[s,existing]=await Promise.all([tx.get(stateRef),tx.get(db.collection('builderRooms').where('ownerId','==',uid))]);if(existing.docs.filter(d=>!d.data().archived).length>=12)throw problem('Archive an existing group first.');tx.set(stateRef,{...stateOf(s.data(),now()),updatedAt:now()});tx.set(ref(gid),{title,description,kind:'group',creatorId:uid,creatorPlus,ownerId:uid,adminIds:[uid],bannedIds:[],rules:'',photo:'',announcementsOnly:false,discoverable:true,preferences:{},memberIds:[uid],readAt:{},createdAt:now(),updatedAt:now(),archived:false});});return {groupId:gid};
  }
  if(op==='groupDiscover'){
   // Anyone with a live onboarded profile can browse. The listing exposes
   // SAFE METADATA ONLY: no messages, no member lists, no rules, no invites.
   // Single-field order on the automatic index (no composite index needed);
   // filtering, search and paging happen in code over a bounded page.
   const me=await db.collection('users').doc(uid).get();
   if(!me.exists||me.data().deleted||me.data().banned||me.data().onboarded!==true)throw problem('Your profile is unavailable.',403);
   const size=Math.min(30,Math.max(1,Number(input.limit)||20));
   const q=String(input.q||'').trim().toLowerCase().slice(0,60);
   const after=typeof input.after==='string'?input.after:'';
   const snap=await db.collection('builderRooms').orderBy('updatedAt','desc').limit(120).get();
   const mine=new Set();
   try{const r=await db.collection('builderRooms').where('memberIds','array-contains',uid).limit(50).get();r.docs.forEach(d=>mine.add(d.id));}catch{}
   const all=[];
   for(const d of snap.docs){
    const g=d.data()||{};
    if(g.archived===true||g.deleting===true)continue;
    if(g.kind&&g.kind!=='group')continue;
    if(g.discoverable===false)continue;
    if(!Array.isArray(g.memberIds)||!g.memberIds.length)continue;
    if((g.bannedIds||[]).includes(uid))continue;
    const title=clean(g.title,80);if(!title)continue;
    const description=clean(g.description||'',240);
    if(q&&!(title.toLowerCase().includes(q)||description.toLowerCase().includes(q)))continue;
    all.push({cursor:d.id+':'+Number(g.updatedAt||0),card:{id:d.id,title,description,photo:safePhoto(g.photo),memberCount:g.memberIds.length,discoverable:true,joined:mine.has(d.id),badges:groupBadges(g),createdAt:g.createdAt||0,updatedAt:g.updatedAt||0}});
   }
   const start=after?all.findIndex(c=>c.cursor===after)+1:0;
   const from=Math.max(0,start),page=all.slice(from,from+size);
   return {groups:page.map(p=>p.card),nextAfter:from+size<all.length&&page.length?page[page.length-1].cursor:null,total:all.length};
  }
  if(op==='groupJoin'){
   // Join a discoverable group straight from browsing. Same safety rails as
   // accepting an invitation: blocks, bans, capacity, archived/dormant rooms.
   const rr=ref(input.groupId);
   const joined=await db.runTransaction(async tx=>{
    await assertActor(tx,uid);
    const d=await tx.get(rr),g=d.data();
    if(!d.exists)throw problem('Group not found.',404);
    if(g.archived||g.deleting)throw problem('This group is not available.',409);
    if(g.kind&&g.kind!=='group')throw problem('This group is not available.',403);
    if(g.discoverable===false)throw problem('This group is private. Ask a member for an invitation.',403);
    if((g.memberIds||[]).includes(uid))return false;
    if((g.bannedIds||[]).includes(uid))throw problem('You are banned from this group.',403);
    await checkBlocks(tx,uid,g.memberIds||[]);
    if((g.memberIds||[]).length>=32)throw problem('This group is full.');
    const bs=await tx.get(db.collection('builderStates').doc(uid));
    if(!bs.exists)tx.set(db.collection('builderStates').doc(uid),stateOf({},now()));
    tx.update(rr,{memberIds:[...new Set([...(g.memberIds||[]),uid])],['readAt.'+uid]:now(),updatedAt:now()});
    return true;
   });
   return {ok:true,joined};
  }
  if(op==='groupGet'){
   const g=await access(uid,input.groupId,{manage:true}),group=await metadata(uid,g);return {group,...(group.blocked?{messages:[],more:false}:await messages(uid,{groupId:g.id}))};
  }
  if(op==='groupMessages')return messages(uid,input);
  if(op==='groupSend'){
   await access(uid,input.groupId);const text=requireText(input.text,2000,1),replyTo=input.replyTo?cursor(input.replyTo):null,key=own(input.key),rr=ref(input.groupId),mr=rr.collection('messages').doc(uid+'_'+key);
   if(containsCredential(text))throw problem('Remove credentials before sending.');
   const sent=await db.runTransaction(async tx=>{await assertActor(tx,uid);const [d,previous,u]=await Promise.all([tx.get(rr),tx.get(mr),tx.get(db.collection('users').doc(uid))]),g=d.data();
    if(!d.exists||!g.memberIds.includes(uid)||!u.exists||u.data().deleted||u.data().banned)throw problem('Group access was removed.',403);if(g.archived)throw problem('This group is archived.',409);if(g.bannedIds?.includes(uid))throw problem('You are banned from this group.',403);if(g.announcementsOnly&&!groupIsAdmin(g,uid))throw problem('Only admins can post announcements.',403);if(replyTo){const reply=await tx.get(rr.collection('messages').doc(replyTo));if(!reply.exists||reply.data().deleted)throw problem('Choose a message that is still available.');}
    await checkBlocks(tx,uid,g.memberIds);
    if(previous.exists){if(previous.data().text!==text||(previous.data().replyTo||null)!==replyTo)throw problem('This send request was used for a different message.',409);return {message:{id:previous.id,...previous.data()},replayed:true};}
    const message={authorId:uid,text,at:now(),replyTo,reactions:{}};tx.set(mr,message);tx.update(rr,{updatedAt:now(),lastMessage:{id:mr.id,...message},authorIds:[...new Set([...(g.authorIds||[]),uid])],['readAt.'+uid]:now()});return {message:{id:mr.id,...message},replayed:false};
   });
   if(!sent.replayed){const g=(await rr.get()).data();if(g)await Promise.allSettled(g.memberIds.filter(k=>k!==uid&&!g.preferences?.[k]?.muted).map(k=>notify(k,input.groupId+'_'+mr.id,'Groups','New message in a private group.',false,'/groups/'+input.groupId)));}return sent;
  }
  if(op==='groupRead'){await access(uid,input.groupId);await db.runTransaction(async tx=>{await assertActor(tx,uid);const rr=ref(input.groupId),d=await tx.get(rr);if(!d.exists||!d.data().memberIds.includes(uid))throw problem('Group access was removed.',403);tx.update(rr,{['readAt.'+uid]:now()});});return {ok:true};}
  if(op==='groupInvite'){
   const g=await access(uid,input.groupId);if(!groupIsAdmin(g,uid))throw problem('Only a group admin can invite members.',403);if(g.archived)throw problem('This group is archived.');await connectable(uid,input.targetUid);
   const ir=db.collection('builderInvites').doc(g.id+'_'+own(input.targetUid));
   await db.runTransaction(async tx=>{await assertActor(tx,uid);const [fresh,previous,settings,target]=await Promise.all([tx.get(ref(g.id)),tx.get(ir),tx.get(db.collection('builderStates').doc(input.targetUid)),tx.get(db.collection('users').doc(input.targetUid))]),r=fresh.data();
    if(!fresh.exists||!groupIsAdmin(r,uid)||r.archived)throw problem('Group administration changed.',409);await checkBlocks(tx,uid,[...r.memberIds,input.targetUid]);if(!target.exists||target.data().deleted||target.data().banned)throw problem('This member is unavailable.',403);if(r.bannedIds?.includes(input.targetUid))throw problem('Unban this member before inviting them.');if(settings.data()?.prefs?.allowInvites===false)throw problem('This member has paused invitations.');if(r.memberIds.includes(input.targetUid))throw problem('This member already joined.');if(r.memberIds.length>=32)throw problem('This group is full.');if(previous.exists&&previous.data().senderId===uid&&['pending','declined'].includes(previous.data().status)&&now()-previous.data().createdAt<7*DAY)throw problem('An invitation was already sent recently.');
    tx.set(ir,{roomId:g.id,senderId:uid,recipientId:input.targetUid,role:input.role==='admin'?'admin':'member',status:'pending',createdAt:now(),expiresAt:now()+7*DAY});});
   await notify(input.targetUid,g.id+'_'+input.targetUid,'Rooms','You have a private group invitation. Review it before joining.');return {ok:true};
  }
  if(op==='groupRespond'){
   if(!['accept','decline'].includes(input.decision))throw problem('Accept or decline the invitation.');const ir=db.collection('builderInvites').doc(cursor(input.id)),initial=await ir.get();if(!initial.exists||initial.data().recipientId!==uid)throw problem('Invitation not found.',404);
   if(input.decision==='accept'){await connectable(uid,initial.data().senderId);const d=await ref(initial.data().roomId).get();if(!d.exists)throw problem('Group not found.',404);for(const other of d.data().memberIds)if(other!==uid&&await blocked(uid,other))throw problem('A blocked member is present.',403);}
   await db.runTransaction(async tx=>{await assertActor(tx,uid);const i=await tx.get(ir),v=i.data();if(!i.exists||v.recipientId!==uid||v.status!=='pending'||v.expiresAt<=now())throw problem('This invitation is no longer active.',409);const rr=ref(v.roomId),[d,bs]=await Promise.all([tx.get(rr),tx.get(db.collection('builderStates').doc(uid))]),g=d.data();if(!d.exists||g.archived||!g.memberIds.includes(v.senderId))throw problem('This group invitation is no longer active.',409);if(input.decision==='accept'){if(!groupIsAdmin(g,v.senderId))throw problem('The group admin changed. Ask for a fresh invitation.',409);if(g.bannedIds?.includes(uid))throw problem('You are banned from this group.',403);await checkBlocks(tx,uid,g.memberIds);if(g.memberIds.length>=32&&!g.memberIds.includes(uid))throw problem('This group is full.');tx.update(rr,{memberIds:[...new Set([...g.memberIds,uid])],...(v.role==='admin'?{adminIds:[...new Set([...(g.adminIds||[]),uid])]}:{}),updatedAt:now()});}if(input.decision==='accept'&&!bs.exists)tx.set(db.collection('builderStates').doc(uid),stateOf({},now()));tx.update(ir,{status:input.decision==='accept'?'accepted':'declined',respondedAt:now()});});return {ok:true};
  }
  if(op==='groupAction'){
   const action=input.action;if(!['leave','archive','remove','rename','transfer','promote','demote','ban','unban'].includes(action))throw problem('Unknown group action.');
   // Leaving/removing an unavailable member never requires access to chat text.
   const rr=ref(input.groupId);return db.runTransaction(async tx=>{await assertActor(tx,uid);const d=await tx.get(rr),g=d.data();if(!d.exists||!g.memberIds.includes(uid))throw problem('This group is not available.',403);
    if(action==='leave'){if(g.ownerId===uid&&!g.archived)throw problem('Transfer admin or archive your group before leaving.');g.memberIds=g.memberIds.filter(k=>k!==uid);if(g.ownerId===uid)g.ownerId='';}
    else {if(!groupIsAdmin(g,uid))throw problem('Only a group admin can do this.',403);if(['transfer','demote','archive'].includes(action)&&g.ownerId!==uid)throw problem('Only the group owner can manage admins or archive.',403);if(action==='archive')g.archived=true;
     if(action==='rename'){g.title=requireText(input.title,80,3);if(containsCredential(g.title))throw problem('Remove credentials before sharing.');g.description=clean(input.description,240);if(containsCredential(g.description))throw problem('Remove credentials before sharing.');}
     if(['remove','transfer','promote','demote','ban','unban'].includes(action)){const target=own(input.targetUid);if(target===uid||target===g.ownerId)throw problem('You cannot remove or change the owner.');if(action==='unban'){g.bannedIds=(g.bannedIds||[]).filter(k=>k!==target);}else{if(!g.memberIds.includes(target))throw problem('Choose another current group member.');if(groupIsAdmin(g,target)&&g.ownerId!==uid)throw problem('Only the owner can moderate another admin.',403);if(['remove','ban'].includes(action)){g.memberIds=g.memberIds.filter(k=>k!==target);g.adminIds=(g.adminIds||[]).filter(k=>k!==target);if(action==='ban'){if((g.bannedIds||[]).length>=500)throw problem('Review the ban list before adding more bans.');g.bannedIds=[...new Set([...(g.bannedIds||[]),target])];}}if(action==='promote')g.adminIds=[...new Set([...(g.adminIds||[]),target])];if(action==='demote')g.adminIds=(g.adminIds||[]).filter(k=>k!==target);if(action==='transfer'){g.ownerId=target;g.adminIds=[...new Set([...(g.adminIds||[]),target])];}}}
    }g.adminIds=(g.adminIds||[]).filter(k=>g.memberIds.includes(k));g.updatedAt=now();tx.set(rr,g);return {ok:true};});
  }
  if(op==='groupUpdate'){
   await access(uid,input.groupId,{manage:true});const rr=ref(input.groupId);
   return db.runTransaction(async tx=>{await assertActor(tx,uid);const d=await tx.get(rr),g=d.data();if(!d.exists||!g.memberIds.includes(uid)||!groupIsAdmin(g,uid))throw problem('Only a current admin can edit group details.',403);if(g.archived)throw problem('This group is archived.',409);const patch={updatedAt:now()};
    if('title'in input)patch.title=requireText(input.title,80,3);if('description'in input)patch.description=clean(input.description,500);if('rules'in input)patch.rules=clean(input.rules,2000);if('photo'in input){if(input.photo!==''&&!safePhoto(input.photo))throw problem('Use a hosted HTTPS group photo.');patch.photo=input.photo;}if('announcementsOnly'in input){if(typeof input.announcementsOnly!=='boolean')throw problem('Choose the posting mode.');patch.announcementsOnly=input.announcementsOnly;}if('discoverable'in input){if(typeof input.discoverable!=='boolean')throw problem('Choose whether the group is listed publicly.');patch.discoverable=input.discoverable;}
    if(Object.values(patch).some(v=>typeof v==='string'&&containsCredential(v)))throw problem('Remove credentials before sharing.');tx.update(rr,patch);return {ok:true};});
  }
  if(op==='groupPrefs'){
   const rr=ref(input.groupId);return db.runTransaction(async tx=>{await assertActor(tx,uid);const d=await tx.get(rr),g=d.data();if(!d.exists||!g.memberIds.includes(uid))throw problem('Group access was removed.',403);const prefs={...(g.preferences?.[uid]||{})};for(const key of ['muted','pinned'])if(key in input){if(typeof input[key]!=='boolean')throw problem('Choose your conversation preference.');prefs[key]=input[key];}tx.update(rr,{['preferences.'+uid]:prefs});return {ok:true};});
  }
  if(op==='groupBlock'){
   const rr=ref(input.groupId),target=own(input.targetUid);if(target===uid)throw problem('Choose another member.');return db.runTransaction(async tx=>{await assertActor(tx,uid);const d=await tx.get(rr);if(!d.exists||!d.data().memberIds.includes(uid)||!d.data().memberIds.includes(target))throw problem('Choose a current group member.',403);const br=db.collection('blocks').doc(uid+'_'+target);if(input.blocked===false)tx.delete(br);else tx.set(br,{blockedById:uid,blockedUserId:target,createdAt:now()});return {ok:true};});
  }
  if(op==='groupMessageAction'){
   await access(uid,input.groupId);const rr=ref(input.groupId),mr=rr.collection('messages').doc(cursor(input.messageId));
   return db.runTransaction(async tx=>{await assertActor(tx,uid);const [d,m]=await Promise.all([tx.get(rr),tx.get(mr)]),g=d.data(),v=m.data();if(!d.exists||!g.memberIds.includes(uid)||g.bannedIds?.includes(uid))throw problem('Group access was removed.',403);await checkBlocks(tx,uid,g.memberIds);if(!m.exists)throw problem('Message not found.',404);if(g.archived)throw problem('This group is archived.',409);const admin=groupIsAdmin(g,uid),action=input.action;let patch={};
    if(action==='delete'){if(v.authorId!==uid&&!admin)throw problem('Only the author or an admin can delete this message.',403);patch={text:'',deleted:true,deletedAt:now(),reactions:{},replyTo:null};}
    else if(action==='edit'){if(v.deleted||v.authorId!==uid)throw problem('Only the author can edit an available message.',403);const text=requireText(input.text,2000,1);if(containsCredential(text))throw problem('Remove credentials before sharing.');patch={text,editedAt:now()};}
    else if(action==='react'){if(v.deleted||!GROUP_REACTIONS.includes(input.emoji))throw problem('Choose an available reaction.');const reactions=Object.fromEntries(Object.entries(v.reactions||{}).filter(([k])=>g.memberIds.includes(k)));if(reactions[uid]===input.emoji)delete reactions[uid];else reactions[uid]=input.emoji;patch={reactions};}
    else if(action==='pin'){if(!admin)throw problem('Only admins can pin messages.',403);if(v.deleted)throw problem('Deleted messages cannot be pinned.');tx.update(rr,{pinnedMessage:g.pinnedMessage?.id===mr.id?null:{id:mr.id,text:clean(v.text,160),authorId:v.authorId},updatedAt:now()});return {ok:true};}
    else throw problem('Unknown message action.');
    const changed={...v,...patch};tx.update(mr,patch);const groupPatch={updatedAt:now(),...groupChanges(g,[mr.id])};if(g.lastMessage?.id===mr.id||(!g.lastMessage?.id&&g.lastMessage?.at===v.at&&g.lastMessage?.authorId===v.authorId))groupPatch.lastMessage={id:mr.id,...changed,text:changed.deleted?'Message deleted':changed.text};if(g.pinnedMessage?.id===mr.id)groupPatch.pinnedMessage=changed.deleted?null:{...g.pinnedMessage,text:clean(changed.text,160)};tx.update(rr,groupPatch);return {message:groupMessage({id:mr.id,...changed})};});
  }
  if(op==='groupDelete'){
   const rr=ref(input.groupId);await db.runTransaction(async tx=>{await assertActor(tx,uid);const d=await tx.get(rr);if(!d.exists)return;if(d.data().ownerId!==uid)throw problem('Only the group owner can permanently delete this group.',403);tx.set(rr,{kind:'group',ownerId:uid,memberIds:[],adminIds:[],archived:true,deleting:true,updatedAt:now()});});
   for(let page=0;page<3;page++){if(await purgeGroup(db,rr))break;}return {deleted:true};
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
   tx.update(d.ref,{...groupChanges(g,page.map(m=>m.id)),adminIds:(g.adminIds||[]).filter(k=>k!==uid),preferences:Object.fromEntries(Object.entries(g.preferences||{}).filter(([k])=>k!==uid)),readAt:Object.fromEntries(Object.entries(g.readAt||{}).filter(([k])=>k!==uid)),...(g.pinnedMessage?.authorId===uid?{pinnedMessage:null}:{}),memberIds:members,...(g.lastMessage?.authorId===uid?{lastMessage:null}:{}),...(!members.length?{archived:true}:{}),authorIds:pending?(g.authorIds||[]):(g.authorIds||[]).filter(k=>k!==uid),...(g.ownerId===uid?{archived:true,ownerId:''}:{}),messages:(g.messages||[]).filter(m=>m.ownerId!==uid),logs:(g.logs||[]).filter(m=>m.ownerId!==uid),links:(g.links||[]).filter(m=>m.ownerId!==uid),updatedAt:at});
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

// Revoke access first, then physically erase bounded pages. The hourly sweep
// resumes large deletions after timeouts; no deleted group can be rejoined.
async function purgeGroup(db,rr){const deadline=Date.now()+9000;let remains=false;do{remains=false;for(const q of [rr.collection('messages').limit(400),db.collection('builderInvites').where('roomId','==',rr.id).limit(400),db.collection('notifications').where('targetUrl','==','/groups/'+rr.id).limit(400)]){const page=await q.get();if(page.size){const batch=db.batch();for(const d of page.docs)batch.delete(d.ref);await batch.commit();if(page.size===400||page.size>=400)remains=true;}}}while(remains&&Date.now()<deadline);if(!remains){await rr.delete();return true;}return false;}
export async function sweepDeletingGroups(db){const page=await db.collection('builderRooms').where('deleting','==',true).limit(3).get();for(const d of page.docs)await purgeGroup(db,d.ref);return {groups:page.size};}
