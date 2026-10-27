import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPublicSeoHandler} from '../api/publicSeo.js';

const ada = {displayName:'Ada Fintech',username:'ada',bio:'Building instant settlement rails for African merchants.',occupation:'Founder',company:'PayBridge',city:'Harare',country:'Zimbabwe',skills:['React Native','Node.js','Postgres'],lookingFor:['Angel investors','Fintech advisors'],projects:[{title:'PayBridge',description:'Instant settlement for merchants'},{title:'Kuda clone',description:'Side project'}],onboarded:true,isVisible:true,isStealthMode:false,email:'ada@secret.example',phone:'private-phone',billing:'private-billing'};
const bob = {displayName:'Bob Baker',username:'bob',bio:'Sourdough obsessive. Croissants on Sundays.',occupation:'Pastry Chef',company:'Crust & Co',city:'Bulawayo',country:'Zimbabwe',skills:['Baking','Pastry'],projects:[],onboarded:true,isVisible:true,isStealthMode:false};
const cara = {displayName:'Cara Stealth',username:'cara',bio:'Fintech founder in hiding.',occupation:'Founder',company:'Stealth',skills:['React','Fintech'],onboarded:true,isVisible:true,isStealthMode:true};

function database(users = {ada, bob, cara}, ids = Object.keys(users)) {
  return {collection(name) {
    let limit = Infinity;
    const q = {doc:id => ({id}),orderBy:() => q,select:() => q,where:() => q,startAfter:() => q,offset:() => q,limit:n => {limit=n;return q;},
      get:async() => ({docs:ids.slice().sort().slice(0,limit).map(id => ({id}))})};
    return q;
  },async getAll(...args) {return args.filter(v => v.id).map(({id}) => ({id,exists:!!users[id],data:() => users[id]}));}};
}
async function request(db, query, method='GET') {
  const res = {headers:{},code:0,body:'',setHeader(k,v) {this.headers[k.toLowerCase()]=v;},status(c) {this.code=c;return this;},send(b) {this.body=b;return this;},end() {this.body='';return this;}};
  const noAi = async () => { throw new Error('AI disabled in unit tests'); };
  await createPublicSeoHandler(() => db, undefined, noAi)({query,method},res);
  return res;
}

test('lvlup search ranks the thesis-matching builder first with a real-data brief',async() => {
  const res = await request(database(), {mode:'lvlup', q:'fintech settlement'});
  assert.equal(res.code,200);
  const body = JSON.parse(res.body);
  assert.equal(body.picks[0].uid,'ada');
  assert.ok(body.picks[0].score > body.picks[1].score);
  assert.ok(body.picks[0].brief.includes('PayBridge'));
  assert.ok(body.picks[0].brief.includes('Harare'));
  assert.ok(body.picks[0].brief.includes('fintech'));
  assert.ok(body.picks[0].url.includes('/p/ada'));
  assert.deepEqual(body.terms, ['fintech','settlement']);
});

test('lvlup never leaks private contact or billing fields',async() => {
  const res = await request(database(), {mode:'lvlup', q:'fintech'});
  assert.equal(res.code,200);
  // ada's secrets must never appear; skills param also in play
  assert.doesNotMatch(res.body, /ada@secret|private-phone|private-billing/);
  const body = JSON.parse(res.body);
  assert.ok(body.picks.every(p => !('email' in p) && !('phone' in p) && !('billing' in p)));
});

test('lvlup hides stealth and invisible builders from the demo',async() => {
  const res = await request(database(), {mode:'lvlup', q:'fintech'});
  assert.equal(res.code,200);
  const body = JSON.parse(res.body);
  assert.equal(body.totalEligible,2);
  assert.ok(body.picks.every(p => p.uid !== 'cara'));
});

test('lvlup skills param and score determinism',async() => {
  const first = await request(database(), {mode:'lvlup', skills:'React Native, Node.js'});
  const second = await request(database(), {mode:'lvlup', skills:'React Native, Node.js'});
  assert.equal(first.code,200);
  const a = JSON.parse(first.body), b = JSON.parse(second.body);
  delete a.generatedAt; delete b.generatedAt;
  assert.deepEqual(a, b); // deterministic: identical modulo the timestamp, no AI jitter
  const body = JSON.parse(first.body);
  assert.equal(body.picks[0].uid,'ada');
  assert.ok(body.picks[0].matched.includes('react native') || body.picks[0].matched.includes('node.js'));
});

test('lvlup digest returns a weekly VC-style brief',async() => {
  const res = await request(database(), {mode:'lvlup', digest:'1', q:'fintech builders', limit:'5'});
  assert.equal(res.code,200);
  const body = JSON.parse(res.body);
  assert.equal(body.digest,true);
  assert.match(body.week, /^Week of \d{4}-\d{2}-\d{2} \(UTC\)$/);
  assert.equal(body.thesis,'fintech, builders');
  assert.ok(body.picks.length <= 5);
  assert.equal(body.totalEligible,2);
});

test('lvlup clamps limit and caches publicly on the CDN',async() => {
  const res = await request(database(), {mode:'lvlup', limit:'99'});
  assert.equal(res.code,200);
  const body = JSON.parse(res.body);
  assert.ok(body.picks.length <= 12);
  assert.ok(res.headers['cache-control'].includes('public'));
  assert.ok(res.headers['vercel-cdn-cache-control'].includes('s-maxage=300'));
  const fallback = await request(database(), {mode:'lvlup', limit:'abc'});
  assert.equal(JSON.parse(fallback.body).picks.length,2); // default 6, only 2 eligible
});

test('lvlup deep link survives the signed-out web guard in both stacks',() => {
  // Regression: /app/lvlup used to be rewritten to /landing by the publicPaths
  // guard, then re-parsed after the auth remount into Main/LinkyHome (/linky).
  const app = fs.readFileSync(new URL('../mobile/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /publicPaths = new Set\(\[[^\]]*'\/lvlup'[^\]]*\]\)/);
  assert.match(app, /LvlupDemo: 'lvlup',/);
  assert.equal(app.match(/<Stack\.Screen name="LvlupDemo" component=\{LvlupDemoScreen\} \/>/g)?.length, 2);
});

test('lvlup explains why each pick surfaced and assigns a LvlUp lane',async() => {
  const res = await request(database(), {mode:'lvlup', q:'fintech settlement'});
  assert.equal(res.code,200);
  const body = JSON.parse(res.body);
  const ada = body.picks[0];
  assert.equal(ada.uid,'ada');
  assert.equal(ada.why[0].c,'Thesis fit');
  assert.ok(ada.why[0].d.includes('fintech'));
  assert.match(ada.why[0].d, /skills|projects|bio|role|seeking/);
  assert.ok(ada.why.some(w => w.c==='Shipping velocity' && w.d.includes('PayBridge')));
  assert.ok(ada.why.some(w => w.c==='Founder focus'));
  assert.equal(ada.lane,'Seed track');
  assert.ok(ada.laneWhy.includes('seed-lane'));
  const bob = body.picks[1];
  assert.equal(bob.uid,'bob');
  assert.equal(bob.lane,'First Check');
});

async function requestAi(db, query, aiFn) {
  const res = {headers:{},code:0,body:'',setHeader(k,v) {this.headers[k.toLowerCase()]=v;},status(c) {this.code=c;return this;},send(b) {this.body=b;return this;},end() {this.body='';return this;}};
  await createPublicSeoHandler(() => db, undefined, aiFn)({query,method:'GET'},res);
  return res;
}
const aiOk = picks => async () => ({text: JSON.stringify({picks}), provider: 'stub'});

test('lvlup uses real Linky AI ranking when a provider answers',async() => {
  // AI overrules deterministic order (bob first) and hydrates full cards.
  const stub = aiOk([{uid:'bob', score:95, lane:'First Check', laneWhy:'idea-stage baker, first-check lane', why:[{c:'Thesis fit', d:'matches sourdough at scale'}]}]);
  const res = await requestAi(database(), {mode:'lvlup', q:'fintech', limit:'1'}, stub);
  assert.equal(res.code,200);
  const body = JSON.parse(res.body);
  assert.equal(body.engine,'linky-ai');
  assert.equal(body.aiProvider,'stub');
  const pick = body.picks[0];
  assert.equal(pick.uid,'bob');
  assert.equal(pick.score,95);
  assert.equal(pick.name,'Bob Baker');
  assert.ok(pick.url.includes('/p/bob'));
  assert.equal(pick.why[0].c,'Thesis fit');
});

test('lvlup degrades to deterministic ranking when Linky AI fails',async() => {
  const stub = async () => { throw new Error('model down'); };
  const res = await requestAi(database(), {mode:'lvlup', q:'fintech settlement'}, stub);
  assert.equal(res.code,200);
  const body = JSON.parse(res.body);
  assert.equal(body.engine,'linky-offline');
  assert.equal(body.aiProvider,'');
  assert.equal(body.picks[0].uid,'ada');
  assert.equal(body.picks[0].why[0].c,'Thesis fit');
});

test('lvlup filters AI-invented uids and rejects junk completions',async() => {
  const mixed = aiOk([
    {uid:'mallory', score:99, lane:'Seed track', laneWhy:'fake', why:[{c:'x', d:'y'}]},
    {uid:'ada', score:60, lane:'Seed track', laneWhy:'stub lane', why:[]},
  ]);
  const res = await requestAi(database(), {mode:'lvlup', q:'fintech', limit:'6'}, mixed);
  const body = JSON.parse(res.body);
  assert.equal(body.engine,'linky-ai');
  assert.deepEqual(body.picks.map(p => p.uid), ['ada']);
  const junk = async () => ({text: 'sorry, no JSON here', provider: 'stub'});
  const res2 = await requestAi(database(), {mode:'lvlup', q:'fintech'}, junk);
  const body2 = JSON.parse(res2.body);
  assert.equal(body2.engine,'linky-offline');
  assert.equal(body2.picks[0].uid,'ada');
});

const LVLUP_CATALOG = ['First Check Fund','Seed Fund','Flagship Fund','CPG Fund','Labs CPG','Marketing Edge','LvlUp Labs','E-Commerce Builders','Small Business Fund','CPG Non-Dilutive','Tech Non-Dilutive','Real Economy Non-Dilutive','B2B SaaS Accel'];

test('lvlup categorizes founders into real LvlUp funding programs',async() => {
  const res = await request(database(), {mode:'lvlup', q:'fintech settlement'});
  assert.equal(res.code,200);
  const body = JSON.parse(res.body);
  const ada = body.picks[0];
  const names = ada.programs.map(p => p.name);
  assert.ok(names.includes('LvlUp Labs'));
  assert.ok(names.includes('Seed Fund')); // shipped product
  assert.ok(names.includes('Tech Non-Dilutive')); // fintech + shipped
  assert.ok(ada.programs.every(p => LVLUP_CATALOG.includes(p.name) && p.check && p.why));
  assert.equal(ada.programs.length, 3); // Tech Non-Dilutive + Seed + Labs: every rule that fires
  const bob = body.picks[1];
  const bobNames = bob.programs.map(p => p.name);
  assert.ok(bobNames.includes('First Check Fund')); // idea stage, 0 projects
  assert.ok(bobNames.includes('Small Business Fund')); // pastry craft, brick-and-mortar
  assert.equal(bob.programs.length, 3); // First Check + SMB + Labs
});

test('lvlup keeps only real program names from Linky AI',async() => {
  const stub = aiOk([{uid:'ada', score:80, lane:'Seed track', laneWhy:'stub', why:[], programs:[{name:'Seed Fund', why:'stub reason'}, {name:'LvlUp Labs', why:'stub'}, {name:'Tech Non-Dilutive', why:'stub'}, {name:'B2B SaaS Accel', why:'stub'}, {name:'Marketing Edge', why:'stub'}, {name:'Fake Fund', why:'invented'}]}]);
  const res = await requestAi(database(), {mode:'lvlup', q:'fintech', limit:'1'}, stub);
  const ada = JSON.parse(res.body).picks[0];
  assert.deepEqual(ada.programs.map(p => p.name), ['Seed Fund', 'LvlUp Labs', 'Tech Non-Dilutive', 'B2B SaaS Accel', 'Marketing Edge']); // no cap, fake dropped
  assert.equal(ada.programs[0].check, '$100K–$250K');
  const empty = aiOk([{uid:'ada', score:80, lane:'Seed track', laneWhy:'stub', why:[], programs:[]}]);
  const res2 = await requestAi(database(), {mode:'lvlup', q:'fintech', limit:'1'}, empty);
  const ada2 = JSON.parse(res2.body).picks[0];
  assert.ok(ada2.programs.some(p => p.name === 'LvlUp Labs')); // deterministic backfill
});

const dave = {displayName:'Dave Solo',username:'dave',bio:'Solo dev shipping a habit app.',occupation:'Indie Hacker',company:'',skills:['React Native'],projects:[{title:'SoloApp',description:'Habit tracker'}],onboarded:true,isVisible:true,isStealthMode:false};

test('lvlup companies view groups founders by venture with union programs',async() => {
  const users = {ada, bob, cara, dave};
  const db = database(users, Object.keys(users));
  const res = await request(db, {mode:'lvlup', view:'companies', q:'fintech settlement', limit:'6'});
  assert.equal(res.code,200);
  const body = JSON.parse(res.body);
  assert.equal(body.totalEligible,3); // cara still excluded
  assert.equal(body.totalCompanies,3); // PayBridge, Crust & Co, SoloApp (project fallback)
  const names = body.companies.map(c => c.name);
  assert.ok(!names.includes('Stealth'));
  assert.ok(names.includes('SoloApp'));
  const top = body.companies[0];
  assert.equal(top.name,'PayBridge'); // ada outranks on fintech
  assert.equal(top.founders[0].uid,'ada');
  assert.ok(top.founders[0].url.includes('/p/ada'));
  assert.ok(top.programs.some(p => p.name === 'LvlUp Labs'));
  assert.equal(top.why[0].c,'Thesis fit');
  assert.ok(top.brief.includes('LINKUP') || top.brief.includes('React Native'));
});

test('lvlup companies view works over real Linky AI picks',async() => {
  const stub = aiOk([
    {uid:'bob', score:95, lane:'First Check', laneWhy:'stub', why:[], programs:[{name:'Small Business Fund', why:'stub'}]},
    {uid:'ada', score:80, lane:'Seed track', laneWhy:'stub', why:[], programs:[{name:'Seed Fund', why:'stub'}]},
  ]);
  const res = await requestAi(database(), {mode:'lvlup', view:'companies', q:'food brands', limit:'6'}, stub);
  assert.equal(res.code,200);
  const body = JSON.parse(res.body);
  assert.equal(body.engine,'linky-ai');
  assert.equal(body.companies[0].name,'Crust & Co'); // AI order honored
  assert.ok(body.companies[0].programs.some(p => p.name === 'Small Business Fund'));
});

test('lvlup explains each program fit with criterion + evidence',async() => {
  const res = await request(database(), {mode:'lvlup', q:'fintech settlement'});
  assert.equal(res.code,200);
  const ada = JSON.parse(res.body).picks[0];
  assert.ok(ada.programs.every(p => p.fit && p.fit.length > 10));
  assert.ok(ada.programs.find(p => p.name === 'Seed Fund').fit.includes('seed-check'));
  assert.ok(ada.programs.find(p => p.name === 'Tech Non-Dilutive').fit.includes('cap table'));
  const stub = aiOk([{uid:'ada', score:80, lane:'Seed track', laneWhy:'s', why:[], programs:[{name:'Seed Fund', why:'stub', fit:'AI fit explanation here'}]}]);
  const res2 = await requestAi(database(), {mode:'lvlup', q:'fintech', limit:'1'}, stub);
  assert.equal(JSON.parse(res2.body).picks[0].programs[0].fit, 'AI fit explanation here');
  const nofit = aiOk([{uid:'ada', score:80, lane:'Seed track', laneWhy:'s', why:[], programs:[{name:'Seed Fund', why:'stub'}]}]);
  const res3 = await requestAi(database(), {mode:'lvlup', q:'fintech', limit:'1'}, nofit);
  assert.ok(JSON.parse(res3.body).picks[0].programs[0].fit.includes('seed-check')); // deterministic backfill
});

test('lvlup salvages AI completions wrapped in prose or cut off mid-stream',async() => {
  const good = {picks:[{uid:'ada', score:77, lane:'Seed track', laneWhy:'s', why:[], programs:[]}]};
  const wrapped = async () => ({text: 'Sure! Here are the matches:\n```json\n' + JSON.stringify(good) + '\n```\nGood luck!', provider:'stub'});
  const res = await requestAi(database(), {mode:'lvlup', q:'fintech', limit:'1'}, wrapped);
  assert.equal(JSON.parse(res.body).picks[0].score, 77);
  const cut = JSON.stringify(good).slice(0, 60); // severed mid-string
  const trunc = async () => ({text: cut, provider:'stub'});
  const res2 = await requestAi(database(), {mode:'lvlup', q:'fintech', limit:'1'}, trunc);
  const body2 = JSON.parse(res2.body);
  assert.equal(body2.engine, 'linky-ai');
  assert.equal(body2.picks[0].uid, 'ada');
  assert.equal(body2.picks[0].score, 77);
});

test('lvlup reports why it fell back when Linky AI fails',async() => {
  const quota = async () => { throw new Error('Zen HTTP 429: quota exceeded'); };
  assert.equal(JSON.parse((await requestAi(database(), {mode:'lvlup', q:'fintech'}, quota)).body).aiNote, 'quota');
  const keys = async () => { throw new Error('No AI provider configured (GEMINI_API_KEY or ZEN_API_KEY).'); };
  assert.equal(JSON.parse((await requestAi(database(), {mode:'lvlup', q:'fintech'}, keys)).body).aiNote, 'no-key');
  const slow = async () => { throw new Error('The operation was aborted due to timeout'); };
  assert.equal(JSON.parse((await requestAi(database(), {mode:'lvlup', q:'fintech'}, slow)).body).aiNote, 'timeout');
});

test('lvlup reports which AI providers were attempted',async() => {
  const both = async () => { throw new Error('gemini: 429 quota | zen: 429 quota'); };
  assert.equal(JSON.parse((await requestAi(database(), {mode:'lvlup', q:'fintech'}, both)).body).aiTried, 'gemini+zen');
  const zenOnly = async () => { throw new Error('zen: 429 quota exceeded'); };
  assert.equal(JSON.parse((await requestAi(database(), {mode:'lvlup', q:'fintech'}, zenOnly)).body).aiTried, 'zen');
});
