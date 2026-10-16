// Deterministic evidence gate. AI, paid visibility and profile completeness
// cannot manufacture eligibility or silently relax a member's requirements.
export const MATCHER_VERSION = 5;
export const norm = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const contains = (value, term) => new RegExp(`(^|[^a-z0-9])${escape(norm(term))}(?=$|[^a-z0-9])`, 'i').test(norm(value));
const groups = [
  ['developer',['developer','developers','dev','devs','programmer','programmers','coder','software engineer','software engineering','software development','backend engineer','frontend engineer','full stack','fullstack','cto','flutter','react','python','javascript','typescript','django','laravel','node.js']],
  ['designer',['designer','designers','design','ux','ui','figma','graphic design','product design']],
  ['investor',['investor','investors','angel investor','angel investors','venture capitalist','venture capital','vc']],
  ['accountant',['accountant','accountants','accounting','bookkeeper','bookkeeping','cfo']],
  ['lawyer',['lawyer','lawyers','attorney','legal counsel','solicitor']],
  ['marketer',['marketer','marketers','marketing','growth marketer','digital marketing']],
  ['sales',['sales','salesperson','business development']],
  ['founder',['founder','founders','cofounder','co founder','entrepreneur']],
  ['mentor',['mentor','mentoring','advisor','adviser']],
  ['teacher',['teacher','teaching','tutor','tutoring','lecturer']],
  ['doctor',['doctor','physician','medical practitioner']],
];
const roles = new Map(groups.map(([key, terms]) => [key,terms]));
const tech = ['flutter','react native','react','node.js','nodejs','python','django','javascript','typescript','java','kotlin','swift','firebase','aws','figma','c++','rust','golang','solidity','wordpress','shopify','laravel','php','sql'];
const domains = ['ai','artificial intelligence','fintech','agritech','healthtech','edtech','blockchain','cybersecurity','machine learning','data science'];
const roleTriggers = {developer:['developer','developers','dev','devs','programmer','coder','software engineer','cto'],designer:['designer','designers','ux','ui','graphic design'],investor:['investor','investors','angel','angels','vc'],accountant:['accountant','accountants','bookkeeper','cfo'],lawyer:['lawyer','lawyers','attorney'],marketer:['marketer','marketers','marketing'],sales:['sales','salesperson'],founder:['founder','founders','cofounder','co founder'],mentor:['mentor','advisor','adviser'],teacher:['teacher','tutor','lecturer'],doctor:['doctor','physician']};
const fillers = new Set('find search show me a an the i need want looking for someone somebody person people professional professionals who can help with my our your startup project app building build work experience experienced expertise good great best local only please must have know skilled skills specialist expert based from around near in on of at to and or is be get connect introduction paid equity mvp collaboration partner team remote anywhere fine okay also instead'.split(' '));
function negativeTerms(message) {
  return [...norm(message).matchAll(/\b(?:not|without|exclude|excluding|avoid|no)\s+([a-z0-9+#.]+(?:\s+native)?)/g)].map(m=>m[1]).filter(t=>!['one','match','matches','preference'].includes(t));
}
export function searchBrief(message) {
  const input=norm(message).slice(0,600);
  const excluded=negativeTerms(input);
  const positive=input.replace(/\b(?:not|without|exclude|excluding|avoid|no)\s+[a-z0-9+#.]+(?:\s+native)?/g,' ');
  const required=[];
  const unverifiedConstraints=[];
  if(/\b(?:\d{1,2}\+?\s*(?:years?|yrs?))\b/.test(input))unverifiedConstraints.push('Minimum years of relevant experience are not confirmed.');
  if(/(?:under|below|less than|maximum|max|budget|rate)\s*(?:of |is |: )?[$£€]\s*\d|[$£€]\s*\d+(?:\s*\/\s*(?:h(?:ou)?r|hour|day)|\s*(?:per|an?)\s+(?:hour|day))/i.test(input))unverifiedConstraints.push('Requested rate or budget is not confirmed.');
  if(/\bavailable (?:now|today|immediately|this week|this month)\b/.test(input))unverifiedConstraints.push('Requested current availability is not confirmed.');
  for (const [key,triggers] of Object.entries(roleTriggers)) if(!(key==='investor' && /\b(?:raised|raising|fundraising)\b/.test(positive)) && triggers.some(t=>contains(positive,t))) required.push({label:key,terms:roles.get(key)});
  for (const term of [...tech,...domains]) if(contains(positive,term) && !(term==='react' && contains(positive,'react native'))) required.push({label:term,terms:term==='nodejs'||term==='node.js'?['nodejs','node.js']: term==='ai'||term==='artificial intelligence'?['ai','artificial intelligence','machine learning']: [term]});
  if(/\b(?:raised|raising|fundraising)\b/.test(positive))required.push({label:'fundraising experience',terms:['raised funding','raised capital','raised investment','fundraising','raised from']});
  for(const level of ['senior','junior']) if(contains(positive,level)) required.push({label:level,terms:[level]});
  // Explicit unknown technologies/qualifications may not be silently dropped
  // just because a familiar skill was also mentioned.
  const clauses=[...positive.matchAll(/\b(?:with|must have|must know|expertise in|skilled in|who knows?)\s+([a-z0-9+#. ]{2,100})/g)];
  for(const clause of clauses) {
    const phrase=clause[1].split(/\s+(?:in|from|near|for|based|available)\b/)[0];
    const covered=new Set(required.flatMap(r=>[r.label,...r.terms]).flatMap(t=>norm(t).split(' ')));
    for(const word of (phrase.match(/[a-z0-9][a-z0-9+#.]*/g)||[])) {
      if(word.length<3 || fillers.has(word) || covered.has(word) || ['years','year','yrs','experience'].includes(word))continue;
      required.push({label:word,terms:[word]});covered.add(word);
    }
  }
  if(/\bco ?founder\b/.test(positive) && required.length>1) {const i=required.findIndex(r=>r.label==='founder');if(i>=0)required.splice(i,1);}
  for(let i=0;i<required.length;i++) for(let j=i+1;j<required.length;j++) {
    const a=required[i],b=required[j];
    if(new RegExp(`${escape(a.label)}\\s+or\\s+(?:a |an )?${escape(b.label)}|${escape(b.label)}\\s+or\\s+(?:a |an )?${escape(a.label)}`).test(positive)) {
      required[i]={label:`${a.label} or ${b.label}`,terms:[...a.terms,...b.terms]};required.splice(j,1);j--;
    }
  }
  const known = required.length>0;
  const locationMatch=positive.match(/\b(?:based in|must be in|only in|in|from|near|around)\s+([a-z][a-z ]{1,40})/);
  let location=locationMatch?.[1]?.split(/\s+(?:for|with|and|or|who|that|to|on|must|only)\b/)[0]?.trim() || '';
  if([...tech,...domains,...roles.keys()].some(t=>contains(location,t))) location='';
  const remoteAllowed=/\b(?:remote (?:is )?(?:fine|ok|okay|welcome)|or remote|anywhere|any location)\b/.test(input);
  const remoteOnly=/\bremote only\b/.test(input);
  if(!required.length) {
    const words=positive.replace(location,' ').match(/[a-z0-9][a-z0-9+#.]*/g)||[];
    for(const word of [...new Set(words)].filter(w=>w.length>2&&!fillers.has(w)).slice(0,6)) required.push({label:word,terms:[word]});
  }
  return {need:String(message).slice(0,600),required,excluded,location,remoteAllowed,remoteOnly,known,unverifiedConstraints,version:MATCHER_VERSION};
}
function factsForEvidence(candidate) {
  const entries=[['role',candidate.role],...((candidate.skills||[]).map(s=>['skill',s])),...((candidate.industries||[]).map(s=>['industry',s]))];
  // Seeking a skill, or explicitly denying it, is not evidence of possessing it.
  const sentences=String(candidate.bio||'').split(/[.!?;\n]/).filter(s=>!/(?:looking for|seeking|need (?:a|an)|want (?:a|an)|not (?:a|an)|no experience|never worked|do not|don't|cannot|can't)/i.test(s));
  entries.push(...sentences.map(s=>['bio',s.trim()]));
  return entries.filter(([,value])=>value && !/(?:looking for|seeking|not (?:a|an)|no experience|do not|don't|cannot|can't)/i.test(value));
}
export function assessCandidate(brief, candidate) {
  const fields=factsForEvidence(candidate);
  const evidence=[];const missing=[...(brief.unverifiedConstraints||[])];
  for(const req of brief.required) {
    const hit=fields.find(([,value])=>req.terms.some(term=>contains(value,term)));
    if(hit)evidence.push({requirement:req.label,field:hit[0],value:String(hit[1]).slice(0,180)});
    else missing.push(req.label);
  }
  const excluded=brief.excluded.some(term=>fields.some(([,v])=>contains(v,term)));
  const inLocation=!brief.location||contains([candidate.city,candidate.country].filter(Boolean).join(' '),brief.location);
  if(!inLocation && !(brief.remoteAllowed&&candidate.remoteOnly)) missing.push(`location: ${brief.location}`);
  if(brief.remoteOnly&&!candidate.remoteOnly)missing.push('remote availability');
  if(brief.location&&inLocation)evidence.push({requirement:brief.location,field:'location',value:[candidate.city,candidate.country].filter(Boolean).join(', ')});
  const eligible=brief.required.length>0&&!missing.length&&!excluded;
  return {eligible,evidence,missing,excluded,score:eligible?Math.min(90,65+evidence.filter(e=>e.field==='skill'||e.field==='role').length*4):0,
    unknowns:['Current availability and interest are not confirmed.','Rates, funding and willingness to collaborate need a conversation.']};
}
export function evidenceReason(name, assessment) {
  return `${name}: ${assessment.evidence.slice(0,4).map(e=>`${e.requirement} — ${e.field}: “${e.value}”`).join('; ')}.`.slice(0,550);
}
// Cached external leads must still satisfy the current full brief. Old entries
// without source snippets fail closed rather than borrowing a saved AI score.
export function assessPublicLead(need, lead) {
  const brief=searchBrief(need), snippet=String(lead?.snippet||'');
  return assessCandidate(brief,{role:lead?.title||'',bio:snippet,skills:[],industries:[],
    city:brief.location && contains(`${lead?.title||''} ${snippet}`,brief.location)?brief.location:'',country:'',remoteOnly:false});
}
export function refineSearch(message, previous) {
  if(!previous)return null;
  const s=String(message).trim();
  const swap=s.match(/^(?:use )?([a-z0-9+#. ]{1,40}) instead of ([a-z0-9+#. ]{1,40})$/i);
  if(swap && contains(previous,swap[2]))return String(previous).replace(new RegExp(escape(swap[2]),'ig'),swap[1]).slice(0,600);
  const replace=s.match(/^(?:instead|actually)\s+([a-z0-9+#.]+(?: native)?)$/i);
  if(replace && tech.some(t=>norm(t)===norm(replace[1]))) {
    const old=tech.filter(t=>contains(previous,t) && !(t==='react' && contains(previous,'react native')));
    if(old.length===1)return String(previous).replace(new RegExp(escape(old[0]),'ig'),replace[1]).slice(0,600);
  }
  // An exclusion must not leave the same positive technology behind.
  const exclude=s.match(/^(?:not|without)\s+([a-z0-9+#.]+(?: native)?)$/i);
  if(exclude && tech.some(t=>norm(t)===norm(exclude[1]))) {
    const base=String(previous).replace(new RegExp(`\\b${escape(exclude[1])}\\b`,'ig'),'');
    return `${base}; ${s}`.slice(0,600);
  }
  if(/^(?:only |instead |actually |also |must |not |without |remote |anywhere\b|make (?:that|it) )/i.test(s)) {
    let base=String(previous);
    if(/^(?:(?:only|instead|actually)\s+)?(?:in|from|near|based in)\s+/i.test(s)) base=base.replace(/\b(?:based in|must be in|only in|in|from|near|around)\s+[a-z][a-z ]*?(?=\s+(?:for|with|and|who|that)\b|$)/i,'');
    return `${base.trim()}; ${s}`.slice(0,600);
  }
  return null;
}
