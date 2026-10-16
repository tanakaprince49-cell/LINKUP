import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';
import * as quality from '../api/_linkyQuality.js';
import * as companion from '../api/_linkyCompanion.js';
import * as usage from '../api/_linkyUsage.js';
import {publicEligible} from '../api/_publicSeo.js';
import {scoreBatch, cleanLink, safeLinkedinProfile} from '../api/_serpapi.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const person=(uid,extra={})=>({uid,displayName:uid,occupation:'Developer',skills:['Flutter'],city:'Harare',country:'Zimbabwe',onboarded:true,...extra});
const fact=(extra={})=>({uid:'candidate',name:'Alice',role:'Developer',skills:['Flutter'],industries:[],city:'Harare',country:'Zimbabwe',bio:'',...extra});
class Database {
  rows=new Map(); queue=Promise.resolve(); failRead=false;
  snapshot(path){return {id:path.split('/').at(-1),exists:this.rows.has(path),data:()=>structuredClone(this.rows.get(path))};}
  write(path,data,merge){this.rows.set(path,structuredClone(merge?{...this.rows.get(path),...data}:data));}
  async getAll(...refs){if(this.failRead)throw Error('source unavailable');return refs.map(r=>this.snapshot(r.path));}
  collection(name){const db=this;const filters=[];const q={
    where(k,op,v){filters.push([k,op,v]);return q;},limit(){return q;},orderBy(){return q;},
    async get(){if(db.failRead)throw Error('source unavailable');const docs=[...db.rows.keys()].filter(k=>k.startsWith(name+'/')&&k.split('/').length===2).map(k=>db.snapshot(k)).filter(d=>filters.every(([k,op,v])=>op==='=='?d.data()[k]===v:true));return {docs,size:docs.length};},
    doc(id){const path=`${name}/${id}`;return {path,get:async()=>db.snapshot(path),set:async(d,o)=>db.write(path,d,o?.merge),delete:async()=>db.rows.delete(path)};}
  };return q;}
  runTransaction(fn){const result=this.queue.then(async()=>{const writes=[];const result=await fn({get:async ref=>this.snapshot(ref.path),set:(ref,d,o)=>writes.push([ref.path,d,o?.merge])});writes.forEach(args=>this.write(...args));return result;});this.queue=result.catch(()=>{});return result;}
}
function core(db,{ai=false}={}) {
 const module={exports:{}};
 const mocks={
  'node:crypto':crypto,'./_linkyQuality.js':quality,'./_linkyCompanion.js':companion,'./_publicSeo.js':{publicEligible},'./_linkyUsage.js':usage,
  './_firebaseAdmin.js':{getDb:()=>db,getAdmin:()=>({firestore:{FieldValue:{serverTimestamp:()=>Date.now(),delete:()=>null},Timestamp:{fromMillis:ms=>ms}}})},
  './_gemini.js':{aiReady:()=>ai,aiStatus:()=>({gemini:{},zen:{}}),aiText:async()=>({text:'{"mode":"search","picks":[{"uid":"irrelevant","score":100}],"reply":"I found ten perfect matches"}'}),geminiText:async()=>'{"picks":[{"uid":"irrelevant","score":100}]}'},
  './_serpapi.js':{safeLinkedinProfile,findLeads:async()=>({leads:[],searches:0,note:'not-configured'})},'./_proof.js':{proofPoints:()=>[],badgeLine:()=>''}
 };
 const code=ts.transpileModule(read('api/_linky.js'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{assert.ok(name in mocks,name);return mocks[name];},console,process:{env:{}},Date,Set,Map,URL,Buffer,setTimeout,clearTimeout});
 return module.exports;
}
function seed(db,profiles){for(const p of profiles){db.rows.set('users/'+p.uid,p);db.rows.set('publicProfiles/'+p.uid,p);}}
const member=person('member',{skills:['Sales'],occupation:'Founder'});

test('all explicit skills and city must pass, with no PLUS/photo shortcut',()=>{
 const brief=quality.searchBrief('find a Flutter developer in Harare with Python');
 assert.equal(quality.assessCandidate(brief,fact({skills:['Flutter','Python']})).eligible,true);
 for(const candidate of [fact({skills:['React'],plus:true,pic:'https://a.test/x'}),fact({skills:['Flutter']}),fact({skills:['Flutter','Python'],city:'Bulawayo'})])assert.equal(quality.assessCandidate(brief,candidate).eligible,false);
});
test('names, company names, wish lists and negated bios are not expertise',()=>{
 const brief=quality.searchBrief('find a Flutter developer');
 for(const c of [fact({role:'Accountant',skills:[],name:'Flutter',company:'Flutter Labs'}),fact({role:'Founder',skills:[],lookingFor:['Flutter developer']}),fact({role:'Founder',skills:[],bio:'Looking for a Flutter developer.'}),fact({role:'Founder',skills:[],bio:'I am not a Flutter developer.'})])assert.equal(quality.assessCandidate(brief,c).eligible,false);
 assert.equal(quality.assessCandidate(quality.searchBrief('find an AI specialist'),fact({role:'Painter',skills:['Retail']})).eligible,false);
});
test('specific expertise never broadens to unrelated occupations',()=>{
 assert.equal(quality.assessCandidate(quality.searchBrief('find a quantum cryptographer'),fact()).eligible,false);
 assert.equal(quality.assessCandidate(quality.searchBrief('find a mathematician'),fact({role:'Accountant',skills:['Finance']})).eligible,false);
});
test('explicit exclusions and remote constraints are enforced',()=>{
 const brief=quality.searchBrief('find a developer with Flutter without React');
 assert.equal(quality.assessCandidate(brief,fact()).eligible,true);
 assert.equal(quality.assessCandidate(brief,fact({skills:['Flutter','React']})).eligible,false);
 assert.equal(quality.assessCandidate(quality.searchBrief('find a Flutter developer in Harare or remote'),fact({city:'London',remoteOnly:true})).eligible,true);
 assert.equal(quality.assessCandidate(quality.searchBrief('find a Flutter developer remote only'),fact()).eligible,false);
});
test('follow-up location edits replace the old location without removing skill requirements',()=>{
 const need=quality.refineSearch('only in Bulawayo','find a Flutter developer in Harare for my app');
 const brief=quality.searchBrief(need);
 assert.equal(brief.location,'bulawayo');assert.ok(brief.required.some(r=>r.label==='flutter'));assert.doesNotMatch(need,/Harare/);
});
test('personality replies address the actual message and disclose AI identity',()=>{
 assert.match(companion.socialReply('yoo',{name:'Alex'}),/Hey, Alex/);
 assert.doesNotMatch(companion.socialReply('thanks'),/search|professional goals|progressing/i);
 assert.match(companion.socialReply('are you human'),/AI.*not a person/);
 assert.match(companion.socialReply('I feel lonely'),/sounds like a lot/);
 assert.equal(companion.toneCommand('tone playful'),'playful');
});
test('utility commands explain uncertainty and never claim to contact or schedule people',()=>{
 const cards=[{targetName:'Alice',targetRole:'Developer',targetCity:'Harare',why:'Profile lists Flutter.',unknowns:['Availability unconfirmed.']},{targetName:'Bo',why:'Profile lists Python.'}];
 assert.match(companion.utilityReply(companion.utilityCommand('why 1'),cards,'Flutter'),/not a verified guarantee/);
 assert.match(companion.utilityReply(companion.utilityCommand('compare 1 and 2'),cards,'Flutter'),/haven't contacted either/);
 assert.match(companion.utilityReply(companion.utilityCommand('prep 1'),cards,'Flutter'),/not a scheduled meeting/);
 assert.match(companion.utilityReply(companion.utilityCommand('prep 99'),cards,'Flutter'),/don't point/);
 assert.match(companion.utilityReply(companion.utilityCommand('compare 1 and 1'),cards,'Flutter'),/don't point/);
});
test('shared matcher returns a genuine no-match and no nearest/random profiles',async()=>{
 const db=new Database(),api=core(db),profiles=[person('irrelevant',{occupation:'Accountant',skills:['Finance'],premium:true})];
 const ctx={candidates:profiles,states:{},pairs:{},week:api.weekKey()};
 const out=await api.findPeople('member',api.parseAsk('find a Flutter developer'),ctx,{user:member,state:{}});
 assert.equal(out.picks.length,0);assert.equal(out.nearest.length,0);
});
test('AI cannot promote an unsupported profile or rewrite the no-match verdict',async()=>{
 const db=new Database();seed(db,[person('irrelevant',{occupation:'Accountant',skills:['Finance']})]);
 const api=core(db,{ai:true});const out=await api.ask('member','find a Flutter developer',{userDoc:member});
 assert.equal(out.kind,'none');assert.equal(out.cards.length,0);assert.equal(out.nearest.length,0);assert.match(out.reply,/don't have a solid match/);assert.doesNotMatch(out.reply,/ten perfect matches/);
});
test('successful search produces evidence, uncertainties, comparisons and prep across channels',async()=>{
 const db=new Database();seed(db,[person('Alice'),person('Bo')]);const api=core(db);
 const found=await api.ask('member','find a Flutter developer in Harare',{userDoc:member,source:'telegram'});
 assert.equal(found.cards.length,2);assert.ok(found.cards[0].evidence.length>=2);assert.match(found.cards[0].unknowns[0],/not confirmed/);
 const compare=await api.ask('member','compare 1 and 2',{userDoc:member,source:'whatsapp'});assert.match(compare.reply,/Alice/);assert.match(compare.reply,/Bo/);
 const prep=await api.ask('member','prep 1',{userDoc:member});assert.match(prep.reply,/not a scheduled meeting/);assert.equal(prep.cards.length,2);assert.equal(prep.cardIds.length,2);
 assert.equal(db.rows.get('linkyUsage/member').month.count,3);
});
test('source privacy and real bidirectional blocks override stale public index',async()=>{
 const db=new Database();seed(db,[person('Alice'),person('Bo'),person('Hidden'),person('Deleted')]);
 db.rows.get('users/Hidden').isVisible=false;db.rows.delete('users/Deleted');
 db.rows.set('blocks/Bo_member',{blockedById:'Bo',blockedUserId:'member'});
 const api=core(db);const out=await api.ask('member','find a Flutter developer',{userDoc:member});
 assert.deepEqual(Array.from(out.cards,c=>c.targetUid),['Alice']);
 db.rows.get('users/Alice').isStealthMode=true;
 assert.equal((await api.loadCards('member')).length,0);
 assert.equal((await api.ask('member','find a Flutter developer',{userDoc:member})).cards.length,0);
});
test('old cached and legacy cards cannot revive wrong recommendations',async()=>{
 const db=new Database();seed(db,[person('Wrong',{occupation:'Accountant',skills:['Finance']})]);
 db.rows.set('introSuggestions/member',{cards:[{id:'old',targetUid:'Wrong',targetName:'Wrong',need:'find a Flutter developer',status:'new',createdAt:Date.now()}]});
 db.rows.set('linkyState/member',{lastAsk:{id:'old',need:'find a Flutter developer',norm:'developer flutter',cardIds:['old'],createdAt:Date.now(),none:false}});
 const api=core(db);assert.equal((await api.loadCards('member')).length,0);
 const out=await api.ask('member','find a Flutter developer',{userDoc:member});assert.equal(out.cards.length,0);assert.equal(out.cached,false);
});
test('vague requests ask one question; the next answer refines the search',async()=>{
 const db=new Database();seed(db,[person('Alice',{occupation:'Sales lead',skills:['Sales']})]);const api=core(db);
 const clarification=await api.ask('member','find me a cofounder',{userDoc:member});assert.equal(clarification.cards.length,0);assert.match(clarification.reply,/one skill or role/);
 const out=await api.ask('member','sales',{userDoc:member});assert.equal(out.cards.length,1);assert.equal(out.cards[0].targetName,'Alice');
});
test('tone persists across channels; preference changes validate supported values',async()=>{
 const db=new Database(),api=core(db);
 await api.ask('member','tone playful',{userDoc:member,source:'telegram'});
 const out=await api.ask('member','hello',{userDoc:member,source:'whatsapp'});assert.match(out.reply,/Big plan|round two/);
 await api.setPrefs('member',{companionTone:'direct'});assert.equal(db.rows.get('linkyState/member').companionTone,'direct');
 await assert.rejects(api.setPrefs('member',{companionTone:'manipulative'}));
});
test('source read failure is not reported as no match and the reserved message is refunded',async()=>{
 const db=new Database();seed(db,[person('Alice')]);db.failRead=true;const api=core(db);
 await assert.rejects(api.ask('member','find a Flutter developer',{userDoc:member}),/source unavailable/);
 assert.equal(db.rows.get('linkyUsage/member').month.count,0);
});
test('external results have no fabricated fit fallback when evidence is absent',async()=>{
 const profiles=[{name:'Alice',title:'Flutter developer',snippet:'Based in Harare'},{name:'Bo',title:'Accountant',snippet:'Based in Harare'}];
 const scored=await scoreBatch(profiles,{need:'find a Flutter developer in Harare'});
 assert.deepEqual(scored.map(s=>s.i),[0]);assert.ok(scored[0].evidence.length);
 assert.deepEqual(await scoreBatch(profiles,{need:'find a quantum cryptographer'}),[]);
});
test('external URL resolution rejects spoofed hosts, unsafe protocols and arbitrary fetch targets',async()=>{
 for(const url of ['http://linkedin.com/in/alice','https://evil-linkedin.com/in/alice','https://evil.test/?linkedin.com/in/alice','https://linkedin.com@evil.test/in/alice','https://linkedin.com/company/alice'])assert.equal(safeLinkedinProfile(url),'');
 assert.equal(await cleanLink('http://127.0.0.1/goto?url=secret'),'');
 assert.equal(await cleanLink('https://evil.test/goto?url=secret'),'');
 assert.equal(await cleanLink('https://www.google.com/url?url=https%3A%2F%2Fwww.linkedin.com%2Fin%2Falice'),'https://www.linkedin.com/in/alice');
});
test('bot discovery has one shared ask path and no silent external-search fallback',()=>{
 const s=read('api/linky.js');assert.doesNotMatch(s,/await pullProfiles\(rest/);assert.doesNotMatch(s,/if \(cmd === 'more' \|\| cmd === 'outside'/);
 assert.match(s,/cmd === 'more' \? 'who else do you have'/);assert.match(s,/Which person\?/);
 assert.doesNotMatch(read('mobile/src/screens/LinkyHomeScreen.tsx'),/answerCards\[Number\(meet\[1\]\) - 1\] \|\| answerCards\[0\]/);
});

test('name lookups and explicit person picks survive reload without pretending to be a skill fit',async()=>{
 const db=new Database();seed(db,[person('Alice',{occupation:'Accountant',skills:['Finance']})]);const api=core(db);
 const out=await api.ask('member','find Alice',{userDoc:member});assert.equal(out.kind,'person');assert.equal(out.cards[0].lookup,true);
 const cards=await api.loadCards('member');assert.equal(cards.length,1);assert.match(cards[0].unknowns[0],/name lookup/);
 const picked=await api.pickPerson('member','Alice');assert.equal(picked.lookup,true);assert.equal((await api.loadCards('member')).length,2);
});
test('ambiguous people are named clearly and persisted for a follow-up choice',async()=>{
 const db=new Database();seed(db,[person('a',{displayName:'Alex Smith'}),person('b',{displayName:'Alex Brown'})]);const api=core(db);
 const out=await api.ask('member','find Alex',{userDoc:member});assert.equal(out.kind,'ambiguous');assert.match(out.reply,/Alex Smith/);assert.match(out.reply,/Alex Brown/);
 assert.equal(db.rows.get('linkyState/member').lastAsk.kind,'ambiguous');assert.equal(out.cards.length,0);
});
test('an empty second page never falls back to previous matches',async()=>{
 const db=new Database();seed(db,[person('Alice')]);const api=core(db);
 const first=await api.ask('member','find a Flutter developer',{userDoc:member});assert.equal(first.cards.length,1);
 const next=await api.ask('member','who else do you have',{userDoc:member});assert.equal(next.cards.length,0);assert.equal(next.nearest.length,0);assert.equal(next.kind,'none');
});
test('parallel chat messages do not overwrite each other and IDs are unique',async()=>{
 const db=new Database(),api=core(db);
 await Promise.all(['hello','thanks','how are you'].map(message=>api.ask('member',message,{userDoc:member})));
 const turns=db.rows.get('linkyState/member').chat;assert.equal(turns.length,6);assert.equal(new Set(turns.map(t=>`${t.id}:${t.role}`)).size,6);
});
test('explicit OR skills allow either while AND still requires both',()=>{
 const candidate=fact({skills:['React']});
 assert.equal(quality.assessCandidate(quality.searchBrief('find a developer with Flutter or React'),candidate).eligible,true);
 assert.equal(quality.assessCandidate(quality.searchBrief('find a developer with Flutter and React'),candidate).eligible,false);
});
test('an active introduction follow-up does not swallow a greeting or feelings',async()=>{
 const db=new Database(),api=core(db);db.rows.set('linkyState/member',{pendingLoop:{at:Date.now(),introId:'intro'}});
 const out=await api.ask('member','I feel lonely',{userDoc:member});assert.equal(out.kind,'chat');assert.match(out.reply,/sounds like a lot/);
 assert.ok(db.rows.get('linkyState/member').pendingLoop);
});

test('unknown required technology is not ignored beside familiar skills',()=>{
 const brief=quality.searchBrief('find a Flutter developer with COBOL');
 assert.equal(quality.assessCandidate(brief,fact()).eligible,false);
 assert.equal(quality.assessCandidate(brief,fact({skills:['Flutter','COBOL']})).eligible,true);
});

test('short technology replacements and exclusions do not retain contradictory positives',()=>{
 const need=quality.refineSearch('instead Python','find a Flutter developer in Harare');
 assert.doesNotMatch(need,/Flutter/);assert.match(need,/Python/);
 const excluded=quality.searchBrief(quality.refineSearch('not Flutter','find a Flutter developer'));
 assert.ok(!excluded.required.some(r=>r.label==='flutter'));assert.ok(excluded.excluded.includes('flutter'));
});
test('external cached evidence is reassessed, not accepted because of a saved score',()=>{
 assert.equal(quality.assessPublicLead('find a Flutter developer in Harare',{title:'Accountant',snippet:'Finance in Harare',fit:100}).eligible,false);
 assert.equal(quality.assessPublicLead('find a Flutter developer in Harare',{title:'Flutter developer',snippet:'Based in Harare'}).eligible,true);
});
test('draft approval rechecks source privacy and blocks before sending anything',async()=>{
 const db=new Database();seed(db,[member,person('Alice')]);const api=core(db);
 const result=await api.ask('member','find a Flutter developer',{userDoc:member});
 const draft=await api.meet('member',result.cards[0].id,{userDoc:member});
 assert.equal(draft.needsApproval,true);assert.equal([...db.rows.keys()].some(k=>k.startsWith('intros/')),false);
 db.rows.set('blocks/Alice_member',{blockedById:'Alice',blockedUserId:'member'});
 await assert.rejects(api.approveMeet('member',{cardId:result.cards[0].id,userDoc:member}),/card is gone/);
 assert.equal([...db.rows.keys()].some(k=>k.startsWith('intros/')),false);
});
test('accepting an old pending intro cannot bypass a new block or deletion',async()=>{
 for(const deleted of [false,true]) {
  const db=new Database();seed(db,[member,person('Alice')]);const api=core(db);
  db.rows.set('intros/member_Alice',{requesterId:'member',targetId:'Alice',status:'pending',expiresAt:Date.now()+86400000});
  if(deleted)db.rows.delete('users/member');else db.rows.set('blocks/member_Alice',{blockedById:'member',blockedUserId:'Alice'});
  await assert.rejects(api.respond('Alice','member_Alice','accept'),/no longer available/);
  assert.equal([...db.rows.keys()].some(k=>k.startsWith('matches/')),false);
 }
});
test('own quiet-decline mutes remove stale cards from the approval path',async()=>{
 const db=new Database();seed(db,[member,person('Alice')]);const api=core(db);
 const found=await api.ask('member','find a Flutter developer',{userDoc:member});
 db.write('linkyState/member',{muted:{Alice:true}},true);
 assert.equal((await api.loadCards('member')).length,0);
 await assert.rejects(api.meet('member',found.cards[0].id,{userDoc:member}),/card is gone/);
});
function adapter(db,api) {
 const module={exports:{}};
 const mocks={'node:crypto':crypto,'./_linky.js':api,'./_proof.js':{badgeLine:()=>''},
  './_firebaseAdmin.js':{getDb:()=>db,verifyRequestUser:async()=>({uid:'member'})},
  './_gemini.js':{handleOptions:()=>false,readJsonBody:req=>req.body,setCors:()=>{},sendError:(res,code,message)=>res.status(code).json({error:message})}};
 const code=ts.transpileModule(read('api/linky.js'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{assert.ok(name in mocks,name);return mocks[name];},console,process:{env:{}},Date,Set,Map,URL,Buffer});
 return module.exports;
}
for(const channel of ['telegram','whatsapp'])test(`${channel} adapter shares strict search, tone, explanations, comparison and prep`,async()=>{
 const db=new Database();seed(db,[member,person('Alice'),person('Bo')]);db.rows.set(`botUsers/${channel}_chat`,{uid:'member'});
 const api=core(db),bot=adapter(db,api);
 assert.match((await bot.botReply(channel,'chat','tone playful')).text,/playful/);
 const found=await bot.botReply(channel,'chat','find a Flutter developer in Harare');
 assert.match(found.text,/Alice/);assert.match(found.text,/Bo/);
 assert.match((await bot.botReply(channel,'chat','why 1')).text,/not a verified guarantee/);
 assert.match((await bot.botReply(channel,'chat','compare 1 and 2')).text,/haven't contacted either/);
 assert.match((await bot.botReply(channel,'chat','prep 1')).text,/not a scheduled meeting/);
 assert.match((await bot.botReply(channel,'chat','meet 99')).text,/number|current|card/i);
 const none=await bot.botReply(channel,'chat','find a quantum cryptographer');
 assert.match(none.text,/don't have a solid match/);assert.ok(!none.cards?.length);
 assert.equal(db.rows.get('linkyUsage/member').month.count,6);
});
test('authenticated app prefs route persists the shared companion tone',async()=>{
 const db=new Database();seed(db,[member]);const api=core(db),route=adapter(db,api);
 const response={status(code){this.code=code;return this;},json(body){this.body=body;}};
 await route.default({method:'POST',query:{},body:{action:'prefs',companionTone:'direct'},headers:{}},response);
 assert.equal(response.code,200);assert.equal(db.rows.get('linkyState/member').companionTone,'direct');
 assert.match((await api.ask('member','hello',{userDoc:member})).reply,/What's on your mind/);
});

test('quantitative experience, rate and current availability are not invented from a skill tag',()=>{
 for(const need of ['find a Flutter developer with 5 years experience','find a Flutter developer under $20 per hour','find a Flutter developer available this week']) {
  const brief=quality.searchBrief(need);assert.ok(brief.unverifiedConstraints.length);
  assert.equal(quality.assessCandidate(brief,fact()).eligible,false);
  assert.match(companion.briefText(need),/Can't confirm from profile evidence/);
 }
});

test('squads require every slot and retain full slot constraints on reload',async()=>{
 const db=new Database();const profiles=[person('Alice',{skills:['Flutter','Python']}),person('Designer',{occupation:'Designer',skills:['Figma']})];seed(db,[member,...profiles]);
 const api=core(db),q=api.parseAsk('find a developer and a designer in Harare');
 const ctx={candidates:profiles,states:{},pairs:{},week:api.weekKey()};
 const slots=[{label:'developer',ask:api.parseAsk('Flutter developer with Python')},{label:'designer',ask:api.parseAsk('Figma designer')}];
 const found=await api.findSquads('member',q,ctx,{user:member,state:{},slots});
 assert.equal(found.squads.length,1);
 assert.match(found.squads[0].members[0].slotNeed,/Python/);assert.match(found.squads[0].members[0].slotNeed,/harare/i);
 const m=found.squads[0].members[0];
 db.rows.set('introSuggestions/member',{cards:[{id:'squad-card',targetUid:'Alice',need:q.need,squadId:'sq',squadRole:m.slot,squadNeed:m.slotNeed,status:'new'}]});
 assert.equal((await api.loadCards('member')).length,1);
 db.rows.get('users/Alice').skills=['Flutter'];
 assert.equal((await api.loadCards('member')).length,0);
 assert.equal((await api.findSquads('member',q,{...ctx,candidates:[profiles[0]]},{user:member,state:{},slots})).squads.length,0);
});

test('legacy app external-search action cannot bypass an exhausted message ledger',async()=>{
 const db=new Database();seed(db,[member]);const api=core(db),route=adapter(db,api);
 for(let i=0;i<10;i++)await usage.reserveMessage(db,'member',{now:Date.now()});
 const response={status(code){this.code=code;return this;},json(body){this.body=body;}};
 await route.default({method:'POST',query:{},body:{action:'pointers',need:'Flutter developer'},headers:{}},response);
 assert.equal(response.code,402);assert.equal(response.body.code,'ask_limit');
});
