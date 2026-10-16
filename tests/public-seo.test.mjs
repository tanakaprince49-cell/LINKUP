import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPublicSeoHandler} from '../api/publicSeo.js';
import {APP, publicEligible, projectProfile, renderProfile, safeUrl} from '../api/_publicSeo.js';
const user = {displayName:'Tanaka Prince',username:'tanaka',bio:'Building useful things.',occupation:'Founder',company:'LINKUP',city:'Harare',country:'Zimbabwe',skills:['React','Design'],projects:[{title:'LINKUP',description:'Connect builders'}],onboarded:true,isVisible:true,isStealthMode:false,email:'secret@example.com',phone:'private-phone',billing:'private-billing'};
function database(users = {alice:user}, ids = Object.keys(users)) {
  const queries = [];
  return {queries, collection(name) {
    let offset = 0, limit = Infinity, after = '';
    const q = {doc:id => ({id}),orderBy:() => q,select:() => q,
      startAfter:id => {after=id;return q;},offset:n => {offset=n;return q;},limit:n => {limit=n;return q;},
      count:() => ({get:async() => ({data:() => ({count:ids.length})})}),
      get:async() => {queries.push({name,offset,limit,after});return {docs:ids.slice().sort().filter(id => !after || id > after).slice(offset,offset+limit).map(id => ({id}))};}};
    return q;
  },async getAll(...args) {return args.filter(v => v.id).map(({id}) => ({id,exists:!!users[id],data:() => users[id]}));}};
}
async function request(db, query, method='GET') {
  const res = {headers:{},code:0,body:'',setHeader(k,v) {this.headers[k.toLowerCase()]=v;},status(c) {this.code=c;return this;},send(b) {this.body=b;return this;}};
  await createPublicSeoHandler(() => db)({query,method},res);
  return res;
}
test('public pages have real content and metadata without JavaScript or authentication',async() => {
  const res=await request(database(),{mode:'profile',uid:'alice'});
  assert.equal(res.code,200);
  for(const value of ['<h1>Tanaka Prince</h1>','Founder','Harare','React','Connect builders','<title>Tanaka Prince — Founder | LINKUP','application/ld+json','ProfilePage','"@type":"Person"',`${APP}/p/alice`,'og:title','twitter:card']) assert.ok(res.body.includes(value),value);
  assert.doesNotMatch(res.body,/secret@example|private-phone|private-billing|type="module"|<script src/);
  assert.equal(res.headers['cache-control'],'private, no-store');
  assert.equal(res.headers['vercel-cdn-cache-control'],'no-store');
});
test('private, deleted, unfinished, synthetic and missing accounts return genuine noindex 404s',async() => {
  for(const patch of [{isVisible:false},{isStealthMode:true},{deleted:true},{isBot:true},{onboarded:false},{onboarded:undefined},{displayName:''}]) {
    const db=database({alice:{...user,...patch}});
    const res=await request(db,{mode:'profile',uid:'alice'});
    assert.equal(res.code,404,JSON.stringify(patch));assert.equal(res.headers['x-robots-tag'],'noindex');assert.ok(!res.body.includes('Tanaka Prince'));
    const sitemap=await request(db,{mode:'profiles',page:'0'});assert.ok(!sitemap.body.includes('/p/alice'));
    const directory=await request(db,{mode:'directory'});assert.ok(!directory.body.includes('Tanaka Prince'));
  }
  for(const uid of ['missing','bot-123','demo-123','../users','', ['alice']]) assert.equal((await request(database(),{mode:'profile',uid})).code,404);
});
test('a stale discovery row cannot publish a hidden or deleted source account',async() => {
  const users={alice:{...user,isVisible:false},bob:{...user,displayName:'Bob'}};
  const db=database(users,['alice','bob','deleted']);
  const res=await request(db,{mode:'profiles',page:'0'});
  assert.equal(res.code,200);assert.ok(res.body.includes('/p/bob'));assert.doesNotMatch(res.body,/\/p\/(alice|deleted)/);
  users.bob.isStealthMode=true;
  assert.equal((await request(db,{mode:'profile',uid:'bob'})).code,404);
});
test('user input is escaped in HTML and JSON-LD; insecure images are rejected',() => {
  const html=renderProfile(projectProfile('alice',{...user,displayName:'<script>alert(1)</script>',bio:'</script><script>alert(2)</script>',profilePic:'javascript:alert(3)'}));
  assert.doesNotMatch(html,/<script>alert/);assert.match(html,/&lt;script&gt;/);assert.match(html,/\\u003c/);
  assert.ok(!html.includes('javascript:alert'));
  for(const url of ['javascript:alert(1)','http://example.com/a','data:image/png;base64,AAAA','//evil.test','https://user:password@example.com']) assert.equal(safeUrl(url),'');
  assert.equal(safeUrl('https://example.com/a.jpg'),'https://example.com/a.jpg');
});
test('directory pagination is bounded and profiles beyond page one are discoverable',async() => {
  const users=Object.fromEntries(Array.from({length:85},(_,i) => [`user-${String(i).padStart(3,'0')}`,{...user,displayName:`Builder ${i}`}])) ;
  const db=database(users);
  const first=await request(db,{mode:'directory'});
  assert.match(first.body,/<h1>/);assert.match(first.body,/after=user-039/);assert.equal((first.body.match(/class="card"/g)||[]).length,40);
  const second=await request(db,{mode:'directory',after:'user-039'});
  assert.ok(second.body.includes('/p/user-040'));assert.ok(!second.body.includes('/p/user-000'));
  assert.ok(second.body.includes('builders?after=user-039'));assert.ok(second.body.includes('after=user-079'));
  assert.equal(db.queries[0].limit,41);
  assert.equal((await request(db,{mode:'directory',after:'../x'})).code,400);
});
test('sitemap index uses bounded XML shards and rejects abusive page parameters',async() => {
  const ids=Array.from({length:1002},(_,i) => `user-${String(i).padStart(4,'0')}`);
  const db=database(Object.fromEntries(ids.map(id => [id,user])),ids);
  const index=await request(db,{mode:'sitemap'});
  assert.equal(index.headers['content-type'],'application/xml; charset=utf-8');
  assert.ok(index.body.includes('sitemap-static.xml'));assert.ok(index.body.includes('sitemap-profiles-1.xml'));assert.ok(!index.body.includes('sitemap-profiles-2.xml'));
  const last=await request(db,{mode:'profiles',page:'1'});
  assert.equal((last.body.match(/<url>/g)||[]).length,2);assert.equal(db.queries.at(-1).limit,1000);
  assert.equal((await request(db,{mode:'profiles',page:'2'})).code,404);
  for(const page of ['-1','1e3','100000','0.5','01',['0']]) assert.equal((await request(db,{mode:'profiles',page})).code,400);
  const robots=await request(db,{mode:'robots'});assert.ok(robots.body.includes(`Sitemap: ${APP}/sitemap.xml`));
});
test('HEAD, method restrictions and transient database errors are honest HTTP responses',async() => {
  const head=await request(database(),{mode:'profile',uid:'alice'},'HEAD');assert.equal(head.code,200);assert.equal(head.body,'');
  const post=await request(database(),{mode:'profile',uid:'alice'},'POST');assert.equal(post.code,405);assert.equal(post.headers.allow,'GET, HEAD');
  const original=console.error;console.error=() => {};
  try {const res=await request({getAll:async() => {throw new Error('private-details');},collection:() => ({doc:id => ({id})})},{mode:'profile',uid:'alice'});assert.equal(res.code,503);assert.equal(res.headers['retry-after'],'60');assert.ok(!res.body.includes('private-details'));}finally{console.error=original;}
});
test('SEO rewrites precede SPA fallback and work after the landing proxy strips /app',() => {
  for(const file of ['vercel.json','mobile/vercel.json']) {
    const config=JSON.parse(fs.readFileSync(new URL('../'+file,import.meta.url)));
    for(const base of ['', '/app']) for(const route of ['p/:uid','builders','sitemap.xml','sitemap-static.xml','sitemap-profiles-:page.xml','robots.txt']) {
      const i=config.rewrites.findIndex(r => r.source === base+'/'+route);assert.ok(i>=0,base+'/'+route);assert.ok(config.rewrites[i].destination.startsWith('/api/publicSeo?mode='));assert.ok(i<config.rewrites.length-1);
    }
  }
});

test('landing member feed serves live public fields only, with canonical links and no fake metrics',async() => {
  const db=database({alice:{...user,profilePicUrl:'https://example.com/avatar.jpg',isVerified:true}});
  const res=await request(db,{mode:'members'});
  assert.equal(res.code,200);assert.match(res.headers['content-type'],/application\/json/);
  assert.equal(res.headers['cache-control'],'private, no-store');assert.equal(res.headers['x-robots-tag'],'noindex');
  const body=JSON.parse(res.body);assert.equal(body.profiles.length,1);assert.equal(body.profiles[0].name,'Tanaka Prince');
  assert.equal(body.profiles[0].url,`${APP}/p/alice`);assert.equal(body.profiles[0].image,'https://example.com/avatar.jpg');assert.equal(body.nextCursor,null);
  assert.doesNotMatch(res.body,/secret@example|private-phone|private-billing|isVerified|matchScore|repScore|socialLinks|projects/);
  assert.deepEqual(Object.keys(body.profiles[0]).sort(),['uid','name','bio','occupation','company','location','skills','lookingFor','image','url'].sort());
});
test('member feed rechecks hidden, stealth, deleted and synthetic accounts despite stale discovery rows',async() => {
  const users={alice:{...user},hidden:{...user,isVisible:false},stealth:{...user,isStealthMode:true},deleted:{...user,deleted:true},unfinished:{...user,onboarded:false},bot:{...user,isBot:true},'demo-1':user};
  const db=database(users,[...Object.keys(users),'missing']);
  const first=JSON.parse((await request(db,{mode:'members'})).body);
  assert.deepEqual(first.profiles.map(p=>p.uid),['alice']);
  users.alice.isVisible=false;
  assert.deepEqual(JSON.parse((await request(db,{mode:'members'})).body).profiles,[]);
});
test('member feed paginates all source candidates, even when a page has no eligible profiles',async() => {
  const users=Object.fromEntries(Array.from({length:43},(_,i)=>[`user-${String(i).padStart(3,'0')}`,{...user,isVisible:i>=40}]));
  const db=database(users);
  const first=JSON.parse((await request(db,{mode:'members'})).body);
  assert.deepEqual(first.profiles,[]);assert.equal(first.nextCursor,'user-039');
  const second=JSON.parse((await request(db,{mode:'members',after:first.nextCursor})).body);
  assert.equal(second.profiles.length,3);assert.equal(second.nextCursor,null);
  assert.equal(db.queries[0].limit,41);
});
test('member API returns JSON errors, respects HEAD and does not manufacture fallback users',async() => {
  const invalid=await request(database(),{mode:'members',after:'../private'});assert.equal(invalid.code,400);assert.equal(JSON.parse(invalid.body).error,'Invalid page');
  const post=await request(database(),{mode:'members'},'POST');assert.equal(post.code,405);assert.ok(JSON.parse(post.body).error);
  assert.equal((await request(database(),{mode:'members'},'HEAD')).body,'');
  const old=console.error;console.error=()=>{};
  try {
    const res=await request({collection:()=>{throw new Error('private error');}},{mode:'members'});assert.equal(res.code,503);assert.deepEqual(JSON.parse(res.body),{error:'Temporarily unavailable'});
  }finally{console.error=old;}
});
