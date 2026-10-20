import {serveContentSeo,contentSitemapIndex} from './_contentSeo.js';
import {getNewsFeed} from './_newsFeed.js';
import {selectProfileImage} from './_publicProfileImage.js';
import { getDb } from './_firebaseAdmin.js';
import { APP, SITE, PAGE_SIZE, SITEMAP_SIZE, safeUrl, validId, publicEligible, projectProfile, profileUrl, renderProfile, renderDirectory, documentHtml, xmlIndex, xmlUrls } from './_publicSeo.js';

const PUBLIC_FIELDS = ['displayName','fullName','name','username','bio','occupation','company','city','country','skills','lookingFor','profilePicUrl','photoURL','profilePic','avatarUrl','socialLinks','projects','deleted','isBot','onboarded','isVisible','isStealthMode'];
async function currentProfiles(db, ids) {
  if (!ids.length) return [];
  // The source of truth is users, NOT the eventually consistent discovery
  // index. Field masks reduce bandwidth; projection prevents private leaks.
  const docs = await db.getAll(...ids.map(id => db.collection('users').doc(id)), {fieldMask: PUBLIC_FIELDS});
  return docs.filter(d => d.exists && publicEligible(d.data(), d.id)).map(d => projectProfile(d.id, d.data()));
}
const single = value => typeof value === 'string' ? value : '';
export function createPublicSeoHandler(database = getDb, news = getNewsFeed) {
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    // No CDN/browser profile cache: privacy changes must take effect on the
    // next request, even before the discovery sync job has caught up.
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vercel-CDN-Cache-Control','no-store');
    res.setHeader('CDN-Cache-Control','no-store');
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const send = (code, body, type = 'text/html; charset=utf-8') => {
      res.setHeader('Content-Type', type);
      res.status(code);
      return res.send(req.method === 'HEAD' ? '' : body);
    };
    const mode = single(req.query?.mode);
    const failure = (code, message) => {
      res.setHeader('X-Robots-Tag','noindex');
      if (mode === 'members') return send(code, JSON.stringify({ error: message }), 'application/json; charset=utf-8');
      return send(code, documentHtml({title:`${message} | LINKUP`,description:message,canonical:`${APP}/builders`,noindex:true,content:`<h1>${message}</h1><p>This profile may be private or no longer available.</p><a href="${APP}/builders">Explore public builders</a>`}));
    };
    if (!['GET','HEAD'].includes(req.method)) { res.setHeader('Allow','GET, HEAD'); return failure(405,'Method not allowed'); }
    try {
      if (mode === 'robots') return send(200,`User-agent: *\nAllow: /\n\nSitemap: ${APP}/sitemap.xml\n`,'text/plain; charset=utf-8');
      if (await serveContentSeo(req,{database,send,failure,news})) return;
      if (mode === 'image') {
        const uid = single(req.query?.uid);
        if (!validId(uid)) return failure(404,'Profile image not found');
        const db = database();
        const [source] = await db.getAll(db.collection('users').doc(uid), {fieldMask: PUBLIC_FIELDS});
        if (!source?.exists || !publicEligible(source.data(), uid)) return failure(404,'Profile image not found');
        const photo = selectProfileImage(uid, source.data(), safeUrl);
        if (!photo) return failure(404,'Profile image not found');
        // No remote proxy or arbitrary fetch: redirect a hosted avatar or serve
        // a bounded, magic-checked raster legacy image from this visible owner.
        if (!photo.bytes) { res.setHeader('Location',photo.url); return send(302,''); }
        res.setHeader('Content-Length',String(photo.bytes.length));
        res.setHeader('Content-Disposition','inline');
        if (req.method === 'HEAD') { res.setHeader('Content-Type',photo.contentType); res.status(200); return res.end(); }
        return send(200, photo.bytes, photo.contentType);
      }
      if (mode === 'profile') {
        const uid = single(req.query?.uid);
        if (!validId(uid)) return failure(404,'Profile not found');
        const profiles = await currentProfiles(database(), [uid]);
        if (!profiles.length) return failure(404,'Profile not found');
        return send(200, renderProfile(profiles[0]));
      }
      if (mode === 'directory' || mode === 'members') {
        const cursor = single(req.query?.after);
        if (cursor && !validId(cursor)) return failure(400,'Invalid page');
        const db = database();
        let query = db.collection('publicProfiles').orderBy('__name__');
        if (cursor) query = query.startAfter(cursor);
        const snap = await query.select().limit(PAGE_SIZE + 1).get();
        const docs = snap.docs.slice(0, PAGE_SIZE);
        const profiles = await currentProfiles(db, docs.map(d => d.id));
        const next = snap.docs.length > PAGE_SIZE ? docs.at(-1).id : '';
        if (mode === 'members') {
          res.setHeader('X-Robots-Tag', 'noindex');
          // Landing cards use the SAME live eligibility checks as SEO pages.
          // No scores, billing, activity or invented verification claims.
          const members = profiles.map(p => ({
            uid: p.uid, name: p.name, bio: p.bio, occupation: p.occupation,
            company: p.company, location: p.location, skills: p.skills,
            lookingFor: p.lookingFor, image: p.image, url: profileUrl(p.uid),
          }));
          return send(200, JSON.stringify({ profiles: members, nextCursor: next || null }), 'application/json; charset=utf-8');
        }
        return send(200,renderDirectory(profiles,cursor,next));
      }
      if (mode === 'sitemap') {
        const db = database();
        const count = (await db.collection('publicProfiles').count().get()).data().count;
        const pages = Math.max(1,Math.ceil(count / SITEMAP_SIZE));
        // Sitemap indexes may contain at most 50,000 child sitemaps.
        if (pages > 50000) throw new Error('Sitemap index capacity exceeded');
        const urls=[`${APP}/sitemap-static.xml`,...Array.from({length:pages},(_,i) => `${APP}/sitemap-profiles-${i}.xml`),...await contentSitemapIndex(db)];
        if(urls.length>50000)throw new Error('Sitemap index capacity exceeded');
        return send(200,xmlIndex(urls),'application/xml; charset=utf-8');
      }
      if (mode === 'static') return send(200,xmlUrls([`${APP}/landing`,`${APP}/builders`,`${APP}/campaigns`,`${APP}/startups`,`${APP}/news`]),'application/xml; charset=utf-8');
      if (mode === 'profiles') {
        const raw = single(req.query?.page);
        if (!/^(0|[1-9]\d{0,4})$/.test(raw)) return failure(400,'Invalid sitemap');
        const page = Number(raw);
        const db = database();
        const count = (await db.collection('publicProfiles').count().get()).data().count;
        if (page >= Math.max(1,Math.ceil(count / SITEMAP_SIZE))) return failure(404,'Sitemap not found');
        // Bounded shards; offset trades some reads for simple, stable sitemap
        // URLs. At very large scale replace this with stored cursor manifests.
        const snap = await db.collection('publicProfiles').orderBy('__name__').select().offset(page * SITEMAP_SIZE).limit(SITEMAP_SIZE).get();
        const profiles = await currentProfiles(db,snap.docs.map(d => d.id));
        return send(200,xmlUrls(profiles.map(p => ({url:profileUrl(p.uid),image:p.image}))),'application/xml; charset=utf-8');
      }
      return failure(404,'Page not found');
    } catch (error) {
      console.error('Public SEO request failed:', error?.code || error?.name || 'unknown');
      res.setHeader('Retry-After','60');
      return failure(503,'Temporarily unavailable');
    }
  };
}
export default createPublicSeoHandler();
