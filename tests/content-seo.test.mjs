import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPublicSeoHandler} from '../api/publicSeo.js';
import {APP} from '../api/_publicSeo.js';
import {isoDate,contentEligible} from '../api/_contentSeo.js';
import {createNewsFeed,projectNewsArticles} from '../api/_newsFeed.js';
const owner={displayName:'Public Founder',onboarded:true,isVisible:true};
const campaign={ownerId:'alice',status:'active',expiresAt:new Date(Date.now()+86400000),creative:{source:'product',productName:'Useful Product',tagline:'A practical product for builders',description:'A genuine description of the product.',website:'https://product.example',logoUrl:'https://cdn.example/product.png',category:['SaaS']},createdAt:new Date('2026-10-01T12:00:00Z'),updatedAt:new Date('2026-10-19T12:00:00Z'),statsClicks:100,statsImpressions:500,reviewNote:'PRIVATE REVIEW',planProductId:'PRIVATE BILLING'};
const startup={authorId:'alice',type:'startup',startupName:'Useful Startup',tagline:'Building something useful for founders',description:'What this startup is building.',website:'https://startup.example',logoUrl:'https://cdn.example/startup.png',timestamp:new Date('2026-10-01T12:00:00Z'),likedBy:['PRIVATE LIKE'],viewedBy:['PRIVATE VIEW'],authorWeek:'PRIVATE WEEK',commentsCount:24};
const news=[{title:'A real provider headline',description:'An attributed summary.',url:'https://publisher.example/story',sourceName:'Publisher',publishedAt:'2026-10-19T12:00:00.000Z',imageUrl:'https://publisher.example/story.png'}];
function database(data={users:{alice:{...owner}},campaigns:{product:{...campaign}},posts:{startup:{...startup}},publicProfiles:{alice:{}}}) {
 const queries=[],reads=[];
 return {data,queries,reads,collection(name) {
  const state={offset:0,limit:Infinity,after:'',filters:[]};
  const rows=()=>Object.entries(data[name]||{}).filter(([id,p])=>state.filters.every(([k,v])=>p[k]===v)).sort(([a],[b])=>a.localeCompare(b));
  const q={doc:id=>({id,name}),where:(key,op,value)=>{assert.equal(op,'==');state.filters.push([key,value]);return q;},orderBy:()=>q,select:()=>q,
   startAfter:id=>{state.after=id;return q;},offset:n=>{state.offset=n;return q;},limit:n=>{state.limit=n;return q;},count:()=>({get:async()=>({data:()=>({count:rows().length})})}),
   get:async()=>{queries.push({name,...state});return {docs:rows().filter(([id])=>!state.after || id>state.after).slice(state.offset,state.offset+state.limit).map(([id,p])=>({id,exists:true,data:()=>p}))};}};
  return q;
 },getAll:async(...args)=>{const mask=args.at(-1)?.fieldMask;reads.push({refs:args.filter(r=>r.id),mask});return args.filter(r=>r.id).map(({id,name})=>({id,exists:!!data[name]?.[id],data:()=>data[name]?.[id]}));}};
}
async function request(db,query,method='GET',feed=async()=>news) {
 const res={headers:{},body:'',code:0,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.code=n;return this;},send(body){this.body=body;return this;},end(){return this;}};
 await createPublicSeoHandler(()=>db,feed)({query,method},res);return res;
}
const schema=body=>JSON.parse(body.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
test('campaign products are server-rendered with truthful Product metadata, sponsorship, official links and breadcrumbs',async()=>{
 const res=await request(database(),{mode:'campaign',id:'product'});
 assert.equal(res.code,200);assert.match(res.body,/<h1>Useful Product<\/h1>/);assert.match(res.body,/Sponsored campaign/);
 assert.match(res.body,/rel="sponsored nofollow noopener noreferrer"/);assert.ok(res.body.includes(APP+'/campaigns/product'));
 assert.match(res.body,/twitter:image/);assert.equal(schema(res.body).mainEntity['@type'],'Product');
 assert.equal(schema(res.body).breadcrumb.itemListElement.length,3);assert.equal(schema(res.body).dateModified,'2026-10-19T12:00:00.000Z');
 assert.doesNotMatch(res.body,/PRIVATE|statsClicks|aggregateRating|"offers"|<script src|type="module"/);
 assert.equal(res.headers['cache-control'],'private, no-store');
});
test('startup detail uses only the startup introduction, not engagement data or an invented founder role',async()=>{
 const res=await request(database(),{mode:'startup',id:'startup'});
 assert.equal(res.code,200);assert.match(res.body,/<h1>Useful Startup<\/h1>/);assert.match(res.body,/What this startup is building/);
 const s=schema(res.body);assert.equal(s.mainEntity['@type'],'Organization');assert.equal(s.mainEntity.logo,'https://cdn.example/startup.png');
 assert.equal(s.mainEntity.founder,undefined);assert.match(res.body,/Shared by/);assert.ok(res.body.includes(APP+'/p/alice'));
 assert.doesNotMatch(res.body,/PRIVATE|likedBy|viewedBy|commentsCount|authorWeek/);
});
test('source and owner field masks exclude billing, engagement identities and profile private fields',async()=>{
 const db=database();await request(db,{mode:'campaign',id:'product'});
 const mask=db.reads[0].mask;assert.ok(mask.includes('creative'));assert.ok(!mask.includes('statsClicks')&&!mask.includes('reviewNote'));
 assert.ok(!db.reads[1].mask.includes('email'));assert.ok(!db.reads[1].mask.includes('profilePic'));
});
test('listing pages link to indexable details without sign-in or browser JavaScript',async()=>{
 for(const kind of ['campaigns','startups']) {
  const res=await request(database(),{mode:kind});assert.equal(res.code,200);assert.equal(schema(res.body)['@type'],'CollectionPage');
  assert.equal(schema(res.body).mainEntity.itemListElement.length,1);assert.ok(res.body.includes(APP+'/'+kind+'/'+(kind==='campaigns'?'product':'startup')));
  assert.match(res.body,/index,follow,max-image-preview:large/);assert.ok(res.body.includes(APP+'/news'));
 }
});
test('future public records enter listings and sitemaps without a rebuild, backfill or manual route',async()=>{
 const db=database();db.data.posts={};db.data.campaigns={};
 for(const [kind,collection,item,id,detail,sitemap] of [['campaigns','campaigns',campaign,'new-product','campaign','campaign-sitemap'],['startups','posts',startup,'new-startup','startup','startup-sitemap']]) {
  assert.equal(schema((await request(db,{mode:kind})).body).mainEntity.itemListElement.length,0);
  db.data[collection][id]={...item};
  assert.ok((await request(db,{mode:kind})).body.includes('/'+kind+'/'+id));
  assert.ok((await request(db,{mode:sitemap,page:'0'})).body.includes('/'+kind+'/'+id));
  assert.equal((await request(db,{mode:detail,id})).code,200);
 }
});
test('unapproved, paused, rejected, ended, expired and unstamped campaigns are never indexed',async()=>{
 for(const patch of [{status:'pending_review'},{status:'paused'},{status:'rejected'},{status:'ended'},{expiresAt:new Date(Date.now()-1)},{expiresAt:undefined},{expiresAt:'nonsense'},{creative:{}}]) {
  const db=database();Object.assign(db.data.campaigns.product,patch);
  assert.equal((await request(db,{mode:'campaign',id:'product'})).code,404,JSON.stringify(patch));
  assert.equal(schema((await request(db,{mode:'campaigns'})).body).mainEntity.itemListElement.length,0);
  assert.ok(!(await request(db,{mode:'campaign-sitemap',page:'0'})).body.includes('/campaigns/product'));
 }
});
test('removed, private, hidden and unapproved content is excluded consistently from details, directories and sitemaps',async()=>{
 for(const kind of ['campaigns','startups'])for(const patch of [{deleted:true},{isDeleted:true},{isHidden:true},{isPrivate:true},{isVisible:false},{isStealthMode:true},{visibility:'private'},{moderationStatus:'rejected'}]) {
  const db=database(),collection=kind==='campaigns'?'campaigns':'posts',id=kind==='campaigns'?'product':'startup';Object.assign(db.data[collection][id],patch);
  const res=await request(db,{mode:kind.slice(0,-1),id});assert.equal(res.code,404);assert.equal(res.headers['x-robots-tag'],'noindex');
  assert.ok(!(await request(db,{mode:kind})).body.includes('/'+kind+'/'+id));
  assert.ok(!(await request(db,{mode:kind.slice(0,-1)+'-sitemap',page:'0'})).body.includes('/'+kind+'/'+id));
 }
});
test('owner visibility changes and deletions remove existing listings immediately on the next request',async()=>{
 for(const patch of [{deleted:true},{isBot:true},{onboarded:false},{isVisible:false},{isStealthMode:true},null]) {
  const db=database();db.data.users.alice=patch?{...owner,...patch}:undefined;
  for(const kind of ['campaigns','startups']) {
   assert.equal((await request(db,{mode:kind.slice(0,-1),id:kind==='campaigns'?'product':'startup'})).code,404);
   assert.equal(schema((await request(db,{mode:kind})).body).mainEntity.itemListElement.length,0);
  }
 }
});
test('legacy non-startup posts and synthetic or house ads are not published as real listings',async()=>{
 const db=database();db.data.posts.startup.type='discussion';assert.equal((await request(db,{mode:'startup',id:'startup'})).code,404);
 db.data.posts.startup={...startup,status:'draft'};assert.equal((await request(db,{mode:'startup',id:'startup'})).code,404);
 for(const id of ['house_plus','demo-item','bot-item']) {db.data.campaigns[id]={...campaign};assert.equal((await request(db,{mode:'campaign',id})).code,404);}
});
test('legacy idea campaigns are CreativeWork, not an invented saleable product',async()=>{
 const db=database();db.data.campaigns.product.creative={source:'idea',title:'A legacy idea',description:'An idea description.'};
 const res=await request(db,{mode:'campaign',id:'product'});assert.equal(res.code,200);assert.equal(schema(res.body).mainEntity['@type'],'CreativeWork');
 assert.ok(!res.body.includes('og:image'));assert.ok(!res.body.includes('icon-512.png'));
});
test('pagination scans past hidden rows and has self-canonical cursor URLs and crawlable next links',async()=>{
 const db=database();db.data.posts=Object.fromEntries(Array.from({length:85},(_,i)=>['startup-'+String(i).padStart(3,'0'),{...startup,isVisible:i>=40}]));
 const first=await request(db,{mode:'startups'});assert.equal(schema(first.body).mainEntity.itemListElement.length,0);assert.match(first.body,/after=startup-039/);
 const second=await request(db,{mode:'startups',after:'startup-039'});assert.equal(schema(second.body).mainEntity.itemListElement.length,40);assert.match(second.body,/after=startup-079/);
 assert.equal(schema(second.body).url,APP+'/startups?after=startup-039');assert.equal(db.queries[0].limit,41);
});
test('content sitemaps have real images and modification dates and automatic bounded shards',async()=>{
 const db=database();db.data.posts=Object.fromEntries(Array.from({length:1002},(_,i)=>['startup-'+String(i).padStart(4,'0'),{...startup}]));
 const index=await request(db,{mode:'sitemap'});assert.ok(index.body.includes('sitemap-startups-1.xml'));assert.ok(index.body.includes('sitemap-campaigns-0.xml'));
 const last=await request(db,{mode:'startup-sitemap',page:'1'});assert.equal((last.body.match(/<url>/g)||[]).length,2);assert.match(last.body,/<image:loc>https:\/\/cdn.example\/startup.png/);assert.match(last.body,/<lastmod>2026-10-01/);
 assert.equal((await request(db,{mode:'startup-sitemap',page:'2'})).code,404);
 const statics=await request(db,{mode:'static'});for(const section of ['campaigns','startups','news'])assert.ok(statics.body.includes(APP+'/'+section));
});
test('invalid IDs, cursors and shard numbers are rejected and HEAD/method semantics remain correct',async()=>{
 for(const id of ['../private','',['product']])assert.equal((await request(database(),{mode:'campaign',id})).code,404);
 for(const after of ['../private',['product']])assert.equal((await request(database(),{mode:'campaigns',after})).code,400);
 for(const page of ['-1','1e3','01','0.5','100000',['0']])assert.equal((await request(database(),{mode:'campaign-sitemap',page})).code,400);
 assert.equal((await request(database(),{mode:'campaign',id:'product'},'HEAD')).body,'');
 assert.equal((await request(database(),{mode:'startups'},'POST')).code,405);
});
test('source errors return retryable noindex 503s instead of fake successful pages or leaked errors',async()=>{
 const old=console.error;console.error=()=>{};
 try {const res=await request({collection(){throw new Error('PRIVATE INTERNAL ERROR');}},{mode:'startups'});assert.equal(res.code,503);assert.equal(res.headers['retry-after'],'60');assert.doesNotMatch(res.body,/PRIVATE INTERNAL/);}finally{console.error=old;}
});
test('injected text and unsafe outbound/image URLs cannot become executable HTML or JSON-LD',async()=>{
 const db=database();db.data.posts.startup={...startup,startupName:'</script><script>alert(1)</script>',description:'<img src=x onerror=alert(2)>',website:'javascript:alert(3)',logoUrl:'https://user:pass@private.example',media:['data:image/svg+xml,<svg onload=alert(1)>']};
 const res=await request(db,{mode:'startup',id:'startup'});assert.equal(res.code,200);assert.match(res.body,/&lt;script&gt;/);assert.doesNotMatch(res.body,/<script>alert|javascript:|<img src=x|user:pass@|data:image/);assert.ok(schema(res.body));
});
test('news is a crawlable collection of real attributed external headlines, not fabricated original reporting',async()=>{
 const res=await request(database(),{mode:'news'});assert.equal(res.code,200);assert.match(res.body,/<h1>AI and startup news<\/h1>/);assert.match(res.body,/A real provider headline/);assert.match(res.body,/Source: Publisher/);
 assert.equal(schema(res.body)['@type'],'CollectionPage');assert.equal(schema(res.body).mainEntity.itemListElement[0].url,news[0].url);
 assert.doesNotMatch(res.body,/"@type":"NewsArticle"|"publisher":|sampleRotation/);
});
test('news upstream outages never publish sample stories or invented freshness',async()=>{
 const res=await request(database(),{mode:'news'},'GET',async()=>{throw new Error('PRIVATE PROVIDER KEY');});assert.equal(res.code,200);assert.match(res.body,/Live headlines are temporarily unavailable/);assert.equal(schema(res.body).mainEntity.itemListElement.length,0);assert.doesNotMatch(res.body,/PRIVATE PROVIDER|dateModified|datePublished/);
});
test('news projection has stable URL IDs, deduplicates stories and preserves only actual publication dates',()=>{
 const raw={title:'Original headline',url:'https://publisher.example/story',source:{name:'Publisher'},description:'Summary',publishedAt:'2026-10-19T12:00:00Z',urlToImage:'https://publisher.example/photo.jpg'};
 const first=projectNewsArticles([raw,raw,{...raw,url:'javascript:alert(1)'},{...raw,title:'[Removed]'}]);assert.equal(first.length,1);assert.deepEqual(first,projectNewsArticles([raw]));assert.equal(first[0].publishedAt,'2026-10-19T12:00:00.000Z');
 assert.equal(projectNewsArticles([{...raw,publishedAt:null}])[0].publishedAt,null);
});
test('news feed caches and coalesces real requests; keys and caller-controlled fetch URLs never leak',async()=>{
 let calls=0;const load=createNewsFeed({key:()=> 'PRIVATE KEY',fetcher:async(url,options)=>{calls++;assert.ok(url.startsWith('https://newsapi.org/v2/everything?'));assert.ok(options.signal);return {ok:true,json:async()=>({status:'ok',articles:[{title:'Real news',url:'https://publisher.example/story'}]})};}});
 const values=await Promise.all([load(),load()]);await load();assert.equal(calls,1);assert.deepEqual(values[0],values[1]);assert.ok(!JSON.stringify(values).includes('PRIVATE KEY'));
});
test('failed or missing news provider credentials cannot produce sample headlines',async()=>{
 await assert.rejects(createNewsFeed({key:()=>''})());
 await assert.rejects(createNewsFeed({key:()=> 'key',fetcher:async()=>({ok:false})})());
});
test('all public routes precede the SPA fallback in root and stripped-app deployment configurations',()=>{
 for(const file of ['vercel.json','mobile/vercel.json']) {
  const cfg=JSON.parse(fs.readFileSync(new URL('../'+file,import.meta.url)));
  for(const base of ['','/app'])for(const path of ['campaigns','campaigns/:id','startups','startups/:id','news','sitemap-campaigns-:page.xml','sitemap-startups-:page.xml']) {
   const index=cfg.rewrites.findIndex(r=>r.source===base+'/'+path);assert.ok(index>=0);assert.ok(index<cfg.rewrites.findIndex(r=>r.source==='/(.*)'));assert.match(cfg.rewrites[index].destination,/^\/api\/publicSeo\?mode=/);
  }
 }
});
test('timestamp parsing accepts actual Firestore values but does not invent dates from malformed fields',()=>{
 for(const value of [null,undefined,'nonsense',{},Infinity,-1])assert.equal(isoDate(value),'');
 assert.equal(isoDate({seconds:1790856000}),'2026-10-01T12:00:00.000Z');
 assert.equal(isoDate({toMillis:()=>1790856000000}),'2026-10-01T12:00:00.000Z');
 assert.equal(contentEligible('campaigns','product',campaign,owner,Date.now()),true);
});

test('concurrent provider failures share the same bounded stale real-news fallback',async()=>{
 let time=0,fail=false,calls=0;
 const load=createNewsFeed({key:()=> 'key',now:()=>time,fetcher:async()=>{calls++;if(fail)throw new Error('Provider down');return {ok:true,json:async()=>({status:'ok',articles:[{title:'Actual headline',url:'https://publisher.example/story',publishedAt:'2026-10-19T12:00:00Z'}]})};}});
 const original=await load();time=600001;fail=true;
 const values=await Promise.all([load(),load()]);assert.deepEqual(values,[original,original]);assert.equal(calls,2);
 time=3600001;await assert.rejects(load());
});
test('provider failures release the in-flight slot so a later valid request can recover',async()=>{
 let key='';const load=createNewsFeed({key:()=>key,fetcher:async()=>({ok:true,json:async()=>({status:'ok',articles:[{title:'Recovered headline',url:'https://publisher.example/story'}]})})});
 await assert.rejects(load());key='key';assert.equal((await load())[0].title,'Recovered headline');
});
