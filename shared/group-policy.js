import {isGoldMember} from './member-badges.js';
export const GROUP_REACTIONS=['👍','❤️','🔥','👏','✅'];
export const groupIsAdmin=(g,uid)=>g?.ownerId===uid||(Array.isArray(g?.adminIds)&&g.adminIds.includes(uid));
export const groupBadges=g=>({verified:!!g?.creatorId&&(g?.creatorPlus===true||isGoldMember(g.creatorId)),gold:isGoldMember(g?.creatorId)});
export const groupMessage=m=>({id:m.id,authorId:m.authorId,at:m.at,text:m.deleted?'Message deleted':m.text,deleted:!!m.deleted,editedAt:m.editedAt||0,replyTo:m.replyTo||null,reactions:m.deleted?{}:m.reactions||{}});
// Bounded revision journal: lets foreground polling refresh edits/deletions and
// reactions outside the latest message page without rereading 500 documents.
export function groupChanges(g,ids){let revision=Number(g.revision)||0;const recent=[...(g.recentChanges||[])];for(const id of [...new Set(ids)])recent.push({id,version:++revision});return {revision,recentChanges:recent.slice(-100)};}
// Rehydrate quotes from the newest loaded source, including deletion markers.
export function mergeGroupMessages(old,incoming){const m=new Map(old.map(x=>[x.id,x]));for(const x of incoming)m.set(x.id,x);for(const [id,v] of m){const source=m.get(v.replyTo);if(source)m.set(id,{...v,reply:{id:source.id,authorId:source.authorId,text:source.deleted?'Message deleted':source.text}});}return [...m.values()].sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id)).slice(-500);}
