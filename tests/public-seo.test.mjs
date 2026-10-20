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
      where:() => q,startAfter:id => {after=id;return q;},offset:n => {offset=n;return q;},limit:n => {limit=n;return q;},
      count:() => ({get:async() => ({data:() => ({count:ids.length})})}),
      get:async() => {queries.push({name,offset,limit,after});return {docs:ids.slice().sort().filter(id => !after || id > after).slice(offset,offset+limit).map(id => ({id}))};}};
    return q;
  },async getAll(...args) {return args.filter(v => v.id).map(({id}) => ({id,exists:!!users[id],data:() => users[id]}));}};
}
async function request(db, query, method='GET') {
  const res = {headers:{},code:0,body:'',setHeader(k,v) {this.headers[k.toLowerCase()]=v;},status(c) {this.code=c;return this;},send(b) {this.body=b;return this;},end() {this.body='';return this;}};
  await createPublicSeoHandler(() => db)({query,method},res);
  return res;
}
test('public pages have real content and metadata without JavaScript or authentication',async() => {
  const res=await request(database(),{mode:'profile',uid:'alice'});
  assert.equal(res.code,200);
  for(const value of ['<h1>Tanaka Prince</h1>','Founder','Harare','React','Connect builders','<title>Tanaka Prince</title>','application/ld+json','ProfilePage','"@type":"Person"',`${APP}/p/alice`,'og:title','twitter:card']) assert.ok(res.body.includes(value),value);
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

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8ioAAAAASUVORK5CYII=';
const schemaFrom=html=>JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
test('a personal search title contains only the name; company and role are separate and never inferred from LINKUP',async()=>{
 const db=database({rudra:{...user,displayName:'Rudra Keshwani (The TIBER guy)',company:'TIBER'}});
 const html=(await request(db,{mode:'profile',uid:'rudra'})).body;
 assert.match(html,/<title>Rudra Keshwani \(The TIBER guy\)<\/title>/);
 assert.match(html,/<meta property="og:title" content="Rudra Keshwani \(The TIBER guy\)">/);
 assert.match(html,/<strong>Company:<\/strong> TIBER/);assert.match(html,/<strong>Role:<\/strong> Founder/);
 assert.doesNotMatch(html,/Rudra Keshwani \(The TIBER guy\) — Founder \| LINKUP/);
 const schema=schemaFrom(html);assert.equal(schema.mainEntity.worksFor.name,'TIBER');
 const noCompany=schemaFrom(renderProfile(projectProfile('rudra',{...user,company:''})));
 assert.equal(noCompany.mainEntity.worksFor,undefined);
});
test('real hosted profile photo appears in HTML, image metadata, Person schema and the image sitemap',async()=>{
 const photo='https://example.com/alice.jpg';const db=database({alice:{...user,profilePic:photo}});
 const html=(await request(db,{mode:'profile',uid:'alice'})).body;
 for(const key of ['og:image','og:image:secure_url','twitter:image'])assert.ok(html.includes(`"${key}" content="${photo}"`),key);
 assert.match(html,/<img class="avatar" src="https:\/\/example.com\/alice.jpg"/);
 const schema=schemaFrom(html);assert.equal(schema.mainEntity.image.contentUrl,photo);assert.equal(schema.primaryImageOfPage.url,photo);
 const sitemap=(await request(db,{mode:'profiles',page:'0'})).body;assert.match(sitemap,/xmlns:image=/);assert.ok(sitemap.includes(`<image:loc>${photo}</image:loc>`));
 assert.ok((await request(db,{mode:'directory'})).body.includes(`src="${photo}"`));
});
test('legacy raster profile photos get a crawlable HTTPS image URL without leaking base64 into HTML or JSON',async()=>{
 const db=database({alice:{...user,profilePic:png}});const html=(await request(db,{mode:'profile',uid:'alice'})).body;
 const url=`${APP}/api/publicSeo?mode=image&uid=alice`;
 assert.equal(schemaFrom(html).mainEntity.image.contentUrl,url);assert.doesNotMatch(html,/data:image|iVBOR/);
 const members=JSON.parse((await request(db,{mode:'members'})).body);assert.equal(members.profiles[0].image,url);
 const image=await request(db,{mode:'image',uid:'alice'});assert.equal(image.code,200);assert.equal(image.headers['content-type'],'image/png');assert.equal(image.headers['cache-control'],'private, no-store');assert.ok(Buffer.isBuffer(image.body));assert.equal(image.body.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 const head=await request(db,{mode:'image',uid:'alice'},'HEAD');assert.equal(head.code,200);assert.equal(head.body,'');assert.ok(Number(head.headers['content-length'])>0);
});
test('image access rechecks source visibility and never revives hidden or deleted avatars',async()=>{
 for(const patch of [{isVisible:false},{isStealthMode:true},{deleted:true},{isBot:true},{onboarded:false}]){
  const db=database({alice:{...user,profilePic:png,...patch}});const image=await request(db,{mode:'image',uid:'alice'});assert.equal(image.code,404);assert.equal(image.headers['x-robots-tag'],'noindex');assert.doesNotMatch(String(image.body),/iVBOR|data:image/);
  assert.ok(!(await request(db,{mode:'profiles',page:'0'})).body.includes('<image:loc>'));
 }
 assert.equal((await request(database(),{mode:'image',uid:'../private'})).code,404);
});
test('hosted image responses redirect without server-side remote fetching, and missing photos do not use the app logo as a person image',async()=>{
 const db=database({alice:{...user,profilePic:'https://example.com/avatar.jpg'}});
 const res=await request(db,{mode:'image',uid:'alice'});assert.equal(res.code,302);assert.equal(res.headers.location,'https://example.com/avatar.jpg');
 const html=renderProfile(projectProfile('alice',user));assert.equal(schemaFrom(html).mainEntity.image,undefined);assert.doesNotMatch(html,/property="og:image"|name="twitter:image"|class="avatar"/);
 assert.equal((await request(database(),{mode:'image',uid:'alice'})).code,404);
});
test('legacy SVG, malformed base64, spoofed MIME and oversized image payloads never become public images',async()=>{
 for(const image of ['data:image/svg+xml;base64,'+Buffer.from('<svg onload="alert(1)"/>').toString('base64'),'data:image/png;base64,AAAA','data:image/png;base64,iVBOR!!!','data:image/png;base64,'+'A'.repeat(900000)]){
  const db=database({alice:{...user,profilePic:image}});assert.equal(projectProfile('alice',{...user,profilePic:image}).image,'');assert.equal((await request(db,{mode:'image',uid:'alice'})).code,404);
 }
});
test('the current chosen profile photo takes precedence over stale hosted/provider aliases',()=>{
 const p=projectProfile('alice',{...user,profilePic:png,profilePicUrl:'https://example.com/old.jpg',photoURL:'https://example.com/google-old.jpg'});
 assert.equal(p.image,`${APP}/api/publicSeo?mode=image&uid=alice`);
});
