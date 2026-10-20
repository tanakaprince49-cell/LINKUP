import {APP, PAGE_SIZE, SITEMAP_SIZE, text, escapeHtml as e, validId, publicEligible, safeUrl, profileUrl, documentHtml, xmlUrls} from './_publicSeo.js';
export const CONTENT = {
  campaigns:{collection:'campaigns',filter:['status','active'],label:'Campaigns',title:'Discover products, apps and services | LINKUP Campaigns',description:'Explore sponsored products, apps and services from the LINKUP community. Discover what each product does, view its details and visit its official website.'},
  startups:{collection:'posts',filter:['type','startup'],label:'Startups',title:'Discover startups and what they are building | LINKUP',description:'Explore startups shared by the LINKUP community. Read their introductions, discover what they are building and visit their official websites.'},
};
// Never expose complete source documents, moderation notes, billing, audience
// targeting, engagement identities, comments or private creator records.
export const CONTENT_FIELDS = ['ownerId','authorId','status','type','creative','startupName','tagline','description','website','logoUrl','media','industries','expiresAt','createdAt','updatedAt','liveEditedAt','timestamp','deleted','isDeleted','isHidden','isPrivate','isVisible','isStealthMode','visibility','moderationStatus'];
const OWNER_FIELDS=['displayName','fullName','name','onboarded','isVisible','isStealthMode','deleted','isBot'];
export const contentUrl=(kind,id)=>`${APP}/${kind}/${encodeURIComponent(id)}`;
export function isoDate(value) {
  try {
    if(value==null || value==='')return '';
    let n=typeof value?.toMillis==='function' ? value.toMillis() : value instanceof Date ? value.getTime() : typeof value==='number' ? value : typeof value==='string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : typeof value?.seconds==='number' ? value.seconds*1000 : NaN;
    return Number.isFinite(n) && n>0 && n<=253402300799999 ? new Date(n).toISOString() : '';
  }catch{return '';}
}
function visible(p) {
  return p && !p.deleted && !p.isDeleted && !p.isHidden && !p.isPrivate && p.isVisible!==false && !p.isStealthMode &&
    (p.visibility==null || p.visibility==='public') && (p.moderationStatus==null || ['approved','published'].includes(p.moderationStatus));
}
export function contentEligible(kind,id,p,owner,now=Date.now()) {
  if(!validId(id) || /^(demo-|bot-)/.test(id) || id==='house_plus' || !visible(p))return false;
  const ownerId=kind==='campaigns' ? p.ownerId : p.authorId;
  if(!publicEligible(owner,ownerId))return false;
  if(kind==='campaigns') {
    const expiry=isoDate(p.expiresAt);
    return p.status==='active' && !!expiry && Date.parse(expiry)>now && !!text(p.creative?.productName || p.creative?.title,120) && !!text(p.creative?.description,6000);
  }
  return kind==='startups' && p.type==='startup' && (p.status==null || ['active','published'].includes(p.status)) && !!text(p.startupName,120) && !!text(p.tagline || p.description,6000);
}
export function projectContent(kind,id,p,owner) {
  const c=kind==='campaigns' ? p.creative : p;
  const ownerId=kind==='campaigns' ? p.ownerId : p.authorId;
  const categories=kind==='campaigns' ? (Array.isArray(c.category) ? c.category : p.industries) : [];
  const image=safeUrl(c.logoUrl);
  const media=kind==='startups' && Array.isArray(p.media) ? p.media.slice(0,3).map(safeUrl).filter(Boolean) : [];
  const dates=[p.updatedAt,p.liveEditedAt,p.createdAt,p.timestamp].map(isoDate).filter(Boolean).sort();
  return {id,kind,name:text(kind==='campaigns' ? c.productName || c.title : p.startupName,120),
    tagline:text(c.tagline,200),description:text(c.description,6000),website:safeUrl(c.website),image,media,
    categories:(Array.isArray(categories) ? categories : []).slice(0,12).map(v=>text(v,80)).filter(Boolean),
    isProduct:kind==='campaigns' && c.source==='product',ownerId,ownerName:text(owner.displayName || owner.fullName || owner.name,100),
    published:isoDate(p.createdAt || p.timestamp),modified:dates.at(-1) || ''};
}
function breadcrumb(kind,name,url) {
  return {'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'LINKUP',item:APP+'/landing'},
    {'@type':'ListItem',position:2,name:CONTENT[kind].label,item:APP+'/'+kind},...(name ? [{'@type':'ListItem',position:3,name,item:url}] : [])]};
}
function photo(url,name,primary=false) {
  return url ? `<img src="${e(url)}" alt="${e(name)}" width="${primary?160:80}" height="${primary?160:80}" style="object-fit:contain;max-width:100%;border-radius:16px" ${primary?'fetchpriority="high"':'loading="lazy"'} decoding="async">` : '';
}
export function renderContent(p) {
  const url=contentUrl(p.kind,p.id),section=CONTENT[p.kind],sponsored=p.kind==='campaigns';
  const description=[p.tagline,p.description].filter(Boolean).join(' — ').slice(0,300) || `Discover ${p.name} on LINKUP.`;
  const mainEntity={'@type':sponsored ? (p.isProduct?'Product':'CreativeWork') : 'Organization','@id':url+'#entity',name:p.name,url,description,
    ...(p.image && (sponsored ? {image:p.image} : {logo:p.image,image:p.image})),
    ...(p.website && {sameAs:[p.website]}),...(p.categories.length && sponsored && p.isProduct && {category:p.categories.join(', ')})};
  return documentHtml({title:`${p.name}${p.tagline?' — '+p.tagline.slice(0,90):''} | LINKUP ${section.label}`,description,canonical:url,useSiteImage:false,image:p.image,imageAlt:`${p.name} logo`,
    schema:{'@context':'https://schema.org','@type':'WebPage','@id':url+'#page',url,name:p.name,description,breadcrumb:breadcrumb(p.kind,p.name,url),isPartOf:{'@type':'CollectionPage',url:APP+'/'+p.kind,name:section.label},mainEntity,
      ...(p.published && {datePublished:p.published}),...(p.modified && {dateModified:p.modified})},
    content:`<nav aria-label="Breadcrumb"><a href="${APP}/landing">LINKUP</a> / <a href="${APP}/${p.kind}">${section.label}</a> / ${e(p.name)}</nav><article>${sponsored?'<p class="tag">Sponsored campaign</p>':''}${photo(p.image,p.name+' logo',true)}<h1>${e(p.name)}</h1>${p.tagline?`<p><strong>${e(p.tagline)}</strong></p>`:''}${p.description?`<section><h2>About ${e(p.name)}</h2><p>${e(p.description)}</p></section>`:''}${p.categories.length?`<section><h2>Categories</h2>${p.categories.map(c=>`<span class="tag">${e(c)}</span>`).join('')}</section>`:''}${p.media.map((m,i)=>photo(m,`${p.name} product image ${i+1}`)).join('')}<p>${sponsored?'Promoted':'Shared'} by <a href="${profileUrl(p.ownerId)}">${e(p.ownerName)}</a>.</p>${p.website?`<a class="button" href="${e(p.website)}" rel="${sponsored?'sponsored nofollow':'ugc nofollow'} noopener noreferrer">Visit ${e(p.name)}’s website ↗</a>`:''}${p.modified?`<p class="muted">Updated <time datetime="${p.modified}">${p.modified.slice(0,10)}</time></p>`:''}<p class="muted">${sponsored?'This is an advertiser-submitted sponsored listing, not an independent review or endorsement.':'This startup introduction was submitted by a LINKUP member.'}</p><a href="${APP}/${sponsored?'campaign-manager/'+encodeURIComponent(p.id):'startup-feed'}">${sponsored?'View this campaign':'Join the startup conversation'} in the app ↗</a></article><p><a href="${APP}/${p.kind}">Explore more ${p.kind}</a> · <a href="${APP}/${sponsored?'startups':'campaigns'}">Discover ${sponsored?'startups':'products'}</a> · <a href="${APP}/news">Read startup and AI news</a></p>`});
}
export function renderContentDirectory(kind,rows,cursor,next) {
  const section=CONTENT[kind],url=APP+'/'+kind+(cursor?'?after='+encodeURIComponent(cursor):'');
  return documentHtml({title:section.title,description:section.description,canonical:url,
    schema:{'@context':'https://schema.org','@type':'CollectionPage',name:section.label,url,description:section.description,breadcrumb:breadcrumb(kind),mainEntity:{'@type':'ItemList',itemListElement:rows.map((p,i)=>({'@type':'ListItem',position:i+1,name:p.name,url:contentUrl(kind,p.id)}))}},
    content:`<h1>${kind==='campaigns'?'Discover products, apps and services':'Discover startups and what they are building'}</h1><p>${section.description}</p>${kind==='campaigns'?'<p class="muted">Campaign listings are sponsored. Discover the product and read its advertiser-provided description before visiting its website.</p>':'<p class="muted">These introductions come from the people sharing their startups on LINKUP. Explore each startup to learn more and find its official website.</p>'}<div class="grid">${rows.map(p=>`<article class="card">${photo(p.image,p.name+' logo')}<h2><a href="${contentUrl(kind,p.id)}">${e(p.name)}</a></h2>${kind==='campaigns'?'<p class="tag">Sponsored</p>':''}<p>${e(p.tagline || p.description.slice(0,240))}</p><a href="${contentUrl(kind,p.id)}">Explore ${e(p.name)} →</a></article>`).join('')}</div>${!rows.length?'<p>No public listings on this page right now. New eligible listings appear here automatically.</p>':''}${next?`<a class="button" rel="next" href="${APP}/${kind}?after=${encodeURIComponent(next)}">More ${kind} →</a>`:''}${cursor?`<p><a href="${APP}/${kind}">Back to the first page</a></p>`:''}<section><h2>${kind==='campaigns'?'Promote your product':'Share your startup'}</h2><p>${kind==='campaigns'?'LINKUP Campaigns lets advertisers introduce their product to the community. Only active, approved campaigns are shown publicly.':'Introduce what you are building, explain its value and add your official website in the LINKUP startup feed.'}</p><a class="button" href="${APP}/${kind==='campaigns'?'campaign-manager':'startup-feed'}">Open ${section.label} in the app ↗</a></section>`});
}
export function renderNews(articles,unavailable=false) {
  const url=APP+'/news',title='AI and startup news for founders and builders | LINKUP',description='Explore AI, startup, technology and research headlines on LINKUP. Read attributed summaries and follow links to the original publishers for full coverage.';
  return documentHtml({title,description,canonical:url,
    schema:{'@context':'https://schema.org','@type':'CollectionPage',url,name:'AI and startup news',description,mainEntity:{'@type':'ItemList',itemListElement:articles.map((a,i)=>({'@type':'ListItem',position:i+1,name:a.title,url:a.url}))}},
    content:`<h1>AI and startup news</h1><p>${description}</p><section><h2>News for people building what’s next</h2><p>Follow developments in artificial intelligence, startup funding, technology companies and research. LINKUP brings together headlines and short summaries from external publishers; each story links to its original source. These are not original LINKUP reporting or endorsements.</p><p><a href="${APP}/startups">Explore community startups</a> · <a href="${APP}/campaigns">Discover products and services</a></p></section>${unavailable?'<p role="status">Live headlines are temporarily unavailable. Please check back later; no sample stories are shown here.</p>':''}<section><h2>Latest headlines</h2>${articles.map(a=>`<article>${photo(a.imageUrl,a.title)}<h3><a href="${e(a.url)}" rel="noopener noreferrer">${e(a.title)}</a></h3><p class="muted">Source: ${e(a.sourceName)}${a.publishedAt?` · <time datetime="${e(a.publishedAt)}">${e(a.publishedAt.slice(0,10))}</time>`:''}</p>${a.description?`<p>${e(a.description)}</p>`:''}<a href="${e(a.url)}" rel="noopener noreferrer">Read the full story at ${e(a.sourceName)} ↗</a></article>`).join('')}</section><a class="button" href="${APP}/news-feed">Open the news feed in LINKUP ↗</a>`});
}
function baseQuery(db,kind) {
  const c=CONTENT[kind];return db.collection(c.collection).where(c.filter[0],'==',c.filter[1]);
}
async function loadContent(db,kind,docs) {
  if(!docs.length)return [];
  // IDs are taken from the collection, never from user-supplied path strings.
  const sources=await db.getAll(...docs.map(d=>db.collection(CONTENT[kind].collection).doc(d.id)),{fieldMask:CONTENT_FIELDS});
  const ids=[...new Set(sources.filter(d=>d.exists).map(d=>kind==='campaigns'?d.data().ownerId:d.data().authorId).filter(validId))];
  const owners=ids.length ? await db.getAll(...ids.map(id=>db.collection('users').doc(id)),{fieldMask:OWNER_FIELDS}) : [];
  const map=new Map(owners.filter(d=>d.exists).map(d=>[d.id,d.data()]));
  return sources.filter(d=>d.exists && contentEligible(kind,d.id,d.data(),map.get(kind==='campaigns'?d.data().ownerId:d.data().authorId))).map(d=>projectContent(kind,d.id,d.data(),map.get(kind==='campaigns'?d.data().ownerId:d.data().authorId)));
}
export async function contentSitemapIndex(db) {
  const urls=[];
  for(const kind of Object.keys(CONTENT)) {
    const count=(await baseQuery(db,kind).count().get()).data().count;
    const pages=Math.max(1,Math.ceil(count/SITEMAP_SIZE));
    if(pages>20000)throw new Error('Content sitemap capacity exceeded');
    for(let i=0;i<pages;i++)urls.push(`${APP}/sitemap-${kind}-${i}.xml`);
  }
  return urls;
}
export async function serveContentSeo(req,{database,send,failure,news}) {
  const mode=typeof req.query?.mode==='string'?req.query.mode:'';
  if(mode==='news') {
    let articles=[],unavailable=false;
    try{articles=await news();}catch{unavailable=true;}
    send(200,renderNews(articles,unavailable));return true;
  }
  const kind=mode.startsWith('campaign') || mode==='campaigns' ? 'campaigns' : mode.startsWith('startup') || mode==='startups' ? 'startups' : '';
  if(!kind || !['campaign','campaigns','campaign-sitemap','startup','startups','startup-sitemap'].includes(mode))return false;
  const db=database();
  if(mode===kind.slice(0,-1)) {
    const id=req.query?.id;
    if(!validId(id)){failure(404,'Listing not found');return true;}
    const rows=await loadContent(db,kind,[{id}]);
    if(!rows.length){failure(404,'Listing not found');return true;}
    send(200,renderContent(rows[0]));return true;
  }
  const shard=mode.endsWith('-sitemap');
  const cursor=req.query?.after;
  if(!shard && cursor!==undefined && (typeof cursor!=='string' || (cursor && !validId(cursor)))){failure(400,'Invalid page');return true;}
  let q=baseQuery(db,kind).orderBy('__name__');
  if(shard) {
    const raw=req.query?.page;
    if(typeof raw!=='string' || !/^(0|[1-9]\d{0,4})$/.test(raw)){failure(400,'Invalid sitemap');return true;}
    const count=(await baseQuery(db,kind).count().get()).data().count;
    const page=Number(raw);
    if(page>=Math.max(1,Math.ceil(count/SITEMAP_SIZE))){failure(404,'Sitemap not found');return true;}
    q=q.offset(page*SITEMAP_SIZE).select().limit(SITEMAP_SIZE);
  }else {
    if(cursor)q=q.startAfter(cursor);
    q=q.select().limit(PAGE_SIZE+1);
  }
  const snap=await q.get(),docs=shard?snap.docs:snap.docs.slice(0,PAGE_SIZE);
  const rows=await loadContent(db,kind,docs);
  if(shard)send(200,xmlUrls(rows.map(p=>({url:contentUrl(kind,p.id),image:p.image,lastmod:p.modified}))),'application/xml; charset=utf-8');
  else send(200,renderContentDirectory(kind,rows,cursor || '',snap.docs.length>PAGE_SIZE?docs.at(-1).id:''));
  return true;
}
