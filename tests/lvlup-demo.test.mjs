import {test} from 'node:test';
import assert from 'node:assert/strict';
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
  await createPublicSeoHandler(() => db)({query,method},res);
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
  assert.equal(first.body, second.body); // byte-identical: deterministic, no AI jitter
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
