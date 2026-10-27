import {publicMomentumSection,serveLeagueSeo} from './_leagueSeo.js';
import {serveContentSeo,contentSitemapIndex} from './_contentSeo.js';
import {getNewsFeed} from './_newsFeed.js';
import {selectProfileImage} from './_publicProfileImage.js';
import { getDb } from './_firebaseAdmin.js';
import { APP, SITE, PAGE_SIZE, SITEMAP_SIZE, safeUrl, validId, publicEligible, projectProfile, profileUrl, renderProfile, renderDirectory, documentHtml, xmlIndex, xmlUrls } from './_publicSeo.js';

const PUBLIC_FIELDS = ['displayName','fullName','name','username','bio','occupation','company','city','country','skills','lookingFor','profilePicUrl','photoURL','profilePic','avatarUrl','photos','socialLinks','projects','deleted','banned','isBot','onboarded','isVisible','isStealthMode'];
async function currentProfiles(db, ids) {
  if (!ids.length) return [];
  // The source of truth is users, NOT the eventually consistent discovery
  // index. Field masks reduce bandwidth; projection prevents private leaks.
  const docs = await db.getAll(...ids.map(id => db.collection('users').doc(id)), {fieldMask: PUBLIC_FIELDS});
  return docs.filter(d => d.exists && publicEligible(d.data(), d.id)).map(d => projectProfile(d.id, d.data()));
}
// LvlUp Ventures deal-flow demo (public, login-free): deterministic Linky-style
// matching over REAL public-eligible builder profiles. Bounded scan, cached
// JSON, no private fields ever (same projectProfile allowlist as /builders).
const LVLUP_SCAN = 60;
const LVLUP_CACHE = {'Cache-Control':'public, max-age=60','Vercel-CDN-Cache-Control':'public, s-maxage=300, stale-while-revalidate=3600','CDN-Cache-Control':'public, s-maxage=300, stale-while-revalidate=3600'};
function lvlupHaystack(p) {
  return [p.name, p.bio, p.occupation, p.company, p.location, (p.skills || []).join(' '), (p.lookingFor || []).join(' '), (p.projects || []).map(x => `${x.title} ${x.description}`).join(' ')].join(' ').toLowerCase();
}
function lvlupScore(p, terms) {
  const hay = lvlupHaystack(p);
  const matched = terms.filter(t => t.length > 1 && hay.includes(t));
  const signal = [p.bio && p.bio.length > 40, p.occupation, (p.skills || []).length >= 3, (p.projects || []).length > 0, p.image, p.company].filter(Boolean).length;
  const score = terms.length
    ? Math.max(5, Math.min(99, Math.round((matched.length / terms.length) * 82 + signal * 3)))
    : Math.max(5, Math.min(99, 58 + signal * 6));
  return { score, matched: matched.slice(0, 6) };
}
function lvlupBrief(p, matched) {
  const firstProject = (p.projects || [])[0]?.title || '';
  const building = firstProject || (p.bio ? p.bio.split('.')[0].slice(0, 90) : '');
  const stack = (p.skills || []).slice(0, 4).join(', ');
  const a = `${p.name}${p.occupation ? `, ${p.occupation}` : ''}${p.location ? ` in ${p.location}` : ''}${building ? ` — building ${building}` : ''}.`;
  const bits = [];
  if (matched.length) bits.push(`matches your thesis on ${matched.slice(0, 3).join(', ')}`);
  if (stack) bits.push(`stack signals: ${stack}`);
  if ((p.projects || []).length > 1) bits.push(`${p.projects.length} shipped projects on record`);
  const b = bits.length ? `Linky flag: ${bits.join(' · ')}.` : 'Linky flag: strong generalist footprint in the builder index.';
  return `${a} ${b}`;
}
function lvlupWeekLabel(now = new Date()) {
  const monday = new Date(now.getTime() - ((now.getUTCDay() + 6) % 7) * 86400000);
  return `Week of ${monday.toISOString().slice(0, 10)} (UTC)`;
}
const single = value => typeof value === 'string' ? value : '';
// Sitemap XML is crawler bait hit over and over for identical bytes; cache it
// for an hour at the edge and in browsers. Profile/directory/image bodies stay
// no-store (privacy changes must bite on the very next request).
const SEO_SITEMAP_CACHE = {'Cache-Control':'public, max-age=3600','Vercel-CDN-Cache-Control':'public, s-maxage=3600, stale-while-revalidate=86400','CDN-Cache-Control':'public, s-maxage=3600, stale-while-revalidate=86400'};
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
    const send = (code, body, type = 'text/html; charset=utf-8', headers = null) => {
      res.setHeader('Content-Type', type);
      // League cards are the one public asset that may be cached briefly; they
      // carry no private fields. Everything else stays no-store.
      if (headers) for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
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
      if (['league-json','builders-league-json','momentum-card'].includes(mode)) res.setHeader('X-Robots-Tag','noindex');
      if (await serveLeagueSeo(req,{database,send,failure})) return;
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
        const contributionRef=database().collection('builderContributions').doc(uid);const c=typeof contributionRef.get==='function'?await contributionRef.get():null;
        return send(200, renderProfile(profiles[0],publicMomentumSection(uid,c?.data()||{})));
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
        const urls=[`${APP}/sitemap-static.xml`,...Array.from({length:pages},(_,i) => `${APP}/sitemap-profiles-${i}.xml`),`${APP}/sitemap-momentum.xml`,...await contentSitemapIndex(db)];
        if(urls.length>50000)throw new Error('Sitemap index capacity exceeded');
        return send(200,xmlIndex(urls),'application/xml; charset=utf-8',SEO_SITEMAP_CACHE);
      }
      if (mode === 'static') return send(200,xmlUrls([`${APP}/landing`,`${APP}/builders`,`${APP}/campaigns`,`${APP}/startups`,`${APP}/news`,`${APP}/builder-league`,`${APP}/builder-league/month`,`${APP}/builder-league/all`,`${APP}/momentum`]),'application/xml; charset=utf-8',SEO_SITEMAP_CACHE);
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
        return send(200,xmlUrls(profiles.map(p => ({url:profileUrl(p.uid),image:p.image}))),'application/xml; charset=utf-8',SEO_SITEMAP_CACHE);
      }
      if (mode === 'lvlup') {
        const db = database();
        const q = single(req.query?.q).toLowerCase().slice(0, 60);
        const skills = single(req.query?.skills).toLowerCase().split(/[,+]/).map(x => x.trim()).filter(x => x.length > 1).slice(0, 8);
        const limit = Math.min(12, Math.max(1, Number(req.query?.limit) || 6));
        const digest = single(req.query?.digest) === '1';
        const terms = [...new Set([...q.split(/[\s,+/]+/).filter(w => w.length > 1), ...skills])].slice(0, 10);
        const snap = await db.collection('publicProfiles').orderBy('__name__').select().limit(LVLUP_SCAN).get();
        const profiles = await currentProfiles(db, snap.docs.map(d => d.id));
        const ranked = profiles.map(p => ({ p, ...lvlupScore(p, terms) }))
          .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
        const picks = ranked.slice(0, limit).map(({ p, score, matched }) => ({
          uid: p.uid, name: p.name, username: p.username, verified: p.verified,
          headline: [p.occupation, p.company].filter(Boolean).join(' @ ') || p.bio.split('.')[0].slice(0, 120),
          location: p.location, skills: (p.skills || []).slice(0, 6), image: p.image, url: profileUrl(p.uid),
          score, matched, brief: lvlupBrief(p, matched),
        }));
        const body = digest
          ? { digest: true, week: lvlupWeekLabel(), thesis: terms.join(', ') || 'generalist technical builders', picks, totalEligible: profiles.length, generatedAt: new Date().toISOString() }
          : { picks, totalEligible: profiles.length, scanned: snap.docs.length, terms, generatedAt: new Date().toISOString() };
        return send(200, JSON.stringify(body), 'application/json; charset=utf-8', LVLUP_CACHE);
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
