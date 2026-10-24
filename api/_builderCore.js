import crypto from 'node:crypto';
export const DAY=86400000;
export const id=()=>crypto.randomUUID();
export const clean=(value,max=500)=>typeof value==='string'?value.trim().slice(0,max):'';
export function requireText(value,max=500,min=1){const v=clean(value,max);if(v.length<min)throw problem('Please add the required details.');if(typeof value!=='string'||value.length>max)throw problem(`Keep this field within ${max} characters.`);return v;}
export function problem(message,status=400){return Object.assign(new Error(message),{status,builder:true});}
export function validId(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);}
export function safeLink(value){try{const u=new URL(clean(value,2048));return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
export function timezone(value){const t=clean(value,80)||'UTC';try{new Intl.DateTimeFormat('en',{timeZone:t}).format();return t;}catch{throw problem('Choose a valid timezone.');}}
export function localTime(now,tz='UTC'){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(now).map(p=>[p.type,p.value]));
 return {day:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour),weekday:p.weekday};
}
export function weekKey(now,tz='UTC'){const d=new Date(localTime(now,tz).day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
export const DEFAULT_PREFS={reminders:false,digest:false,friday:false,inApp:true,push:false,email:false,timezone:'UTC',quietStart:20,quietEnd:8,useContextForAI:false,allowInvites:true,dailyBuild:false,buildHour:18,retention:true};
export function sanitizePrefs(input,previous={}){
 const p={...DEFAULT_PREFS,...previous};
 for(const k of ['reminders','digest','friday','inApp','push','allowInvites','dailyBuild','retention'])if(k in input){if(typeof input[k]!=='boolean')throw problem('Invalid preference.');p[k]=input[k];}
 if(input.email===true)throw problem('Email delivery is not configured. Use in-app or push reminders for now.');p.email=false;p.useContextForAI=false;
 if('timezone'in input)p.timezone=timezone(input.timezone);
 for(const k of ['quietStart','quietEnd','buildHour'])if(k in input){if(!Number.isInteger(input[k])||input[k]<0||input[k]>23)throw problem('Quiet hours must be hours from 0 to 23.');p[k]=input[k];}
 return p;
}
export function quiet(now,prefs){const h=localTime(now,prefs.timezone).hour,a=prefs.quietStart,b=prefs.quietEnd;return a===b?false:a<b?h>=a&&h<b:h>=a||h<b;}
export function freshState(now=Date.now()){
 return {version:16,epoch:id(),context:{project:'',stage:'',goal:'',skills:'',needs:'',constraints:'',intent:'build',preferredLocation:'',preferredStage:'',remotePreference:'any',availabilityPreference:'any'},goals:[],followups:[],feedback:{},availability:{enabled:false,until:0,purpose:''},prefs:{...DEFAULT_PREFS},coachRuns:[],savedLeads:[],momentumDays:[],lastVisitAt:0,previousVisitAt:0,createdAt:now,updatedAt:now};
}
export function stateOf(value,now){const s=freshState(now);return {...s,...value,context:{...s.context,...value?.context},prefs:{...s.prefs,...value?.prefs}};}
export function brief(state,now=Date.now(),rooms=[],invitations=[]){
 const tz=state.prefs.timezone,week=weekKey(now,tz),due=state.followups.filter(f=>f.status==='open'&&f.dueAt<=now),active=state.goals.find(g=>g.week===week&&!g.doneAt),completed=state.goals.filter(g=>g.doneAt&&weekKey(g.doneAt,tz)===week).length;
 const changes=rooms.filter(r=>r.updatedAt>(state.previousVisitAt||state.lastVisitAt||0)).length;
 return {week,due:due.length,completed,roomUpdates:changes,invitations:invitations.length,returningAfterBreak:!!(state.previousVisitAt||state.lastVisitAt)&&now-(state.previousVisitAt||state.lastVisitAt)>7*DAY,
  next:due.length?{label:'Review a due follow-up',section:'Follow-ups'}:invitations.length?{label:'Review your collaboration invitation',section:'Rooms'}:active?{label:active.text,section:'Plan'}:!state.context.project?{label:'Tell Linky what you are building',section:'Plan'}:{label:'Choose one outcome for this week',section:'Plan'},
  momentumDays:state.momentumDays.filter(d=>d>=localTime(now-6*DAY,tz).day).length};
}
export function contextOf(input){const out={};for(const [k,n] of Object.entries({project:120,stage:80,goal:300,skills:250,needs:300,constraints:500,intent:30,preferredLocation:120,preferredStage:80,remotePreference:20,availabilityPreference:20}))out[k]=clean(input[k],n);if(!out.project)throw problem('Give your project or current goal a name.');return out;}
const words=value=>[...new Set(clean(value,3000).toLowerCase().match(/[\p{L}\p{N}+#.]{2,}/gu)||[])].filter(w=>!['the','and','for','with','need','want','build','help','looking','someone','startup','people','have','this','that'].includes(w));
export function relevantPeople(state,people,now=Date.now()){
 const needs=words(state.context.needs+' '+state.context.goal+' '+state.context.skills);
 return people.filter(p=>p.uid&&state.feedback[p.uid]?.status!=='not_relevant'&&state.feedback[p.uid]?.status!=='contacted').flatMap(p=>{
  const available=!!p.availability?.enabled&&p.availability.until>now;
  const location=clean(state.context.preferredLocation,120).toLowerCase(),stage=clean(state.context.preferredStage,80).toLowerCase();
  if(location&&![p.city,p.country].some(v=>clean(v,120).toLowerCase().includes(location)))return [];
  if(stage&&!clean(p.startupStage,80).toLowerCase().includes(stage))return [];
  if(state.context.remotePreference==='remote'&&p.remoteOnly!==true)return [];
  if(state.context.availabilityPreference==='available'&&!available)return [];
  const facts=[...(Array.isArray(p.skills)?p.skills:[]),p.occupation,p.city,p.country,p.startupStage,...(Array.isArray(p.industries)?p.industries:[])].filter(v=>typeof v==='string');
  const evidence=facts.filter(f=>words(f).some(w=>needs.includes(w))).slice(0,3);
  if(!evidence.length)return [];
  return [{uid:p.uid,name:p.name,why:'Profile lists '+evidence.join(', ')+'.',evidence,available,availability:available?p.availability.purpose:'',score:evidence.length*10+(available?3:0)}];
 }).sort((a,b)=>b.score-a.score||a.uid.localeCompare(b.uid)).slice(0,5);
}
export function relevantLeads(state,leads,now=Date.now()){
 const intentTopics={investors:'investor funding angel',cofounder:'cofounder collaborator developer',unblock:'developer engineering'};
 const wanted=words([state.context.intent,intentTopics[state.context.intent]||'',state.context.goal,state.context.needs,state.context.skills,state.context.constraints].join(' '));
 return leads.filter(l=>now>=Date.parse(l.checkedAt)&&now-Date.parse(l.checkedAt)<=90*DAY).map(l=>{
  const evidence=l.tags.filter(t=>words(t).some(w=>wanted.includes(w)));
  return {...l,saved:state.savedLeads.includes(l.id),member:false,relevance:evidence.length?'Relevant topics: '+evidence.join(', '):'General source; fit with your current goal is not established.',score:evidence.length};
 }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}
export function weeklySummary(state,now,{asks=[],ownedAsks=[],leads=[],rooms=[],chatReplies=0}={}){
 const cutoff=now-7*DAY,seen=new Set(state.deliveredOpportunityKeys||[]),wanted=words([state.context.goal,state.context.needs,state.context.skills].join(' '));
 const opportunities=[...asks.filter(a=>a.ownerId&&a.createdAt>=cutoff&&words([a.title,a.question,a.details].join(' ')).some(w=>wanted.includes(w))).map(a=>({key:'ask_'+a.id,title:a.title,section:'Help board',source:'LINKUP member request',sourceUrl:'',at:a.createdAt})),
 ...leads.filter(l=>l.score>0&&Date.parse(l.addedAt||l.checkedAt)>=cutoff).map(l=>({key:'lead_'+l.id,title:l.name,section:'Leads',source:l.attribution,sourceUrl:l.sourceUrl,at:Date.parse(l.addedAt||l.checkedAt)}))].slice(0,20);
 const completed=state.goals.filter(g=>g.doneAt&&g.doneAt>=cutoff).map(g=>g.text);
 const followedThrough=state.followups.filter(f=>f.status==='done'&&f.closedAt>=cutoff).length;
 const helpReplies=ownedAsks.flatMap(a=>(a.feedback||[]).filter(f=>f.at>=cutoff)).length;
 const replies=helpReplies+chatReplies;
 const roomMilestones=rooms.flatMap(r=>r.tasks||[]).filter(t=>t.doneAt>=cutoff).length;
 const due=state.followups.filter(f=>f.status==='open'&&f.dueAt<=now).length;
 const next=brief(state,now,rooms,[]).next;
 const newOpportunities=opportunities.filter(o=>!seen.has(o.key));
 return {asOf:now,periodStart:cutoff,completed,followedThrough,replies,helpReplies,chatReplies,roomMilestones,due,next,opportunities,newOpportunities,
 meaningful:!!(completed.length||followedThrough||replies||roomMilestones||due||opportunities.length),
 summary:`Last seven days: ${completed.length} completed outcomes, ${followedThrough} completed follow-ups, ${helpReplies} help-board replies, ${chatReplies} recent chat messages, ${roomMilestones} room tasks completed. ${due} follow-ups due. ${opportunities.length} sourced opportunities. Next: ${next.label}.`,
 scope:'Bounded review: first 40 board records, last 10 messages in up to 20 approved chats, up to 30 accepted rooms, plus manually reviewed sources. Counts are observed activity, not exhaustive totals. No background searches, fabricated replies or events.'};
}
