import {selectProfileImage} from './_publicProfileImage.js';
import { isGoldMember, GOLD_MEMBER_LABEL } from '../shared/member-badges.js';
// Public web SEO only. Never serialize a Firestore document into a response.
export const SITE = 'https://www.linkupbuild.com';
export const APP = `${SITE}/app`;
export const PAGE_SIZE = 40;
export const SITEMAP_SIZE = 1000;
export const text = (value, max = 700) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const profileUrl = uid => `${APP}/p/${encodeURIComponent(uid)}`;
const list = (value, count = 20) => Array.isArray(value) ? value.slice(0, count).map(v => text(v, 80)).filter(Boolean) : [];
export function publicEligible(p, uid) {
  return validId(uid) && !!p && !p.deleted && !p.isBot && !/^(demo-|bot-)/.test(uid) && p.onboarded === true && p.isVisible !== false && !p.isStealthMode && !!text(p.displayName || p.fullName || p.name, 100);
}
export function safeUrl(value) {
  try { const url = new URL(text(value, 2048)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export function projectProfile(uid, p) {
  // This allowlist deliberately excludes email, telephone, age, activity,
  // billing, messages, relationship data and all internal fields.
  return {
    uid, verified: p.isVerified === true || isGoldMember(uid), name: text(p.displayName || p.fullName || p.name, 100), username: text(p.username, 40),
    bio: text(p.bio), occupation: text(p.occupation, 100), company: text(p.company, 120),
    location: [text(p.city, 80), text(p.country, 80)].filter(Boolean).join(', '),
    skills: list(p.skills), lookingFor: list(p.lookingFor, 16),
    socialLinks: Object.entries(p.socialLinks && typeof p.socialLinks === 'object' ? p.socialLinks : {}).filter(([key]) => ['linkedin','github','twitter','portfolio','instagram','tiktok'].includes(key)).map(([,value]) => safeUrl(value)).filter(Boolean),
    image: selectProfileImage(uid, p, safeUrl)?.url || '',
    projects: (Array.isArray(p.projects) ? p.projects : []).slice(0, 5).map(v => ({ title: text(v?.title, 120), description: text(v?.description, 300) })).filter(v => v.title),
  };
}
const css = `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#faf9f5;color:#171918;font:17px/1.65 system-ui,-apple-system,sans-serif}a{color:inherit}header,main,footer{max-width:920px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;gap:20px;align-items:center}header>a{font-weight:900;font-size:24px;text-decoration:none;letter-spacing:-1px}nav{display:flex;gap:20px;font-size:15px}article,.card{background:white;border:1px solid #deded6;border-radius:24px;padding:32px;margin:16px 0}h1{font-size:clamp(32px,6vw,52px);letter-spacing:-2px;line-height:1.12;margin:16px 0}h2{font-size:23px;letter-spacing:-.5px}p{white-space:pre-line;overflow-wrap:anywhere}.muted{color:#565b55}.avatar{width:100px;height:100px;object-fit:cover;border-radius:50%}.tag{display:inline-block;border:1px solid #deded6;border-radius:30px;padding:5px 14px;margin:4px;font-size:14px}.button{display:inline-block;background:#fbe618;color:#171918;padding:12px 22px;border-radius:30px;text-decoration:none;font-weight:750;margin:12px 8px 8px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.grid .card{margin:0;padding:24px}.card h2{margin:0}footer{font-size:14px;color:#565b55}a:focus-visible{outline:3px solid #3565bd;outline-offset:5px}@media(max-width:480px){header,main,footer{padding:16px}article{padding:24px}nav{gap:12px}}`;
export function documentHtml({ title, description, canonical, content, schema, image, imageAlt, noindex = false }) {
  const e = escapeHtml;
  const profile = schema?.['@type'] === 'ProfilePage';
  const photo = safeUrl(image || (typeof schema?.mainEntity?.image === 'string' ? schema.mainEntity.image : '')) || (!profile ? APP + '/icons/icon-512.png' : '');
  const alt = imageAlt || (profile ? `${schema.mainEntity.name} profile photo` : 'LINKUP');
  const imageMeta = photo ? `<meta property="og:image" content="${e(photo)}"><meta property="og:image:secure_url" content="${e(photo)}"><meta property="og:image:alt" content="${e(alt)}"><meta name="twitter:image" content="${e(photo)}"><meta name="twitter:image:alt" content="${e(alt)}"><link rel="image_src" href="${e(photo)}">` : '';
  const json = schema ? `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><meta name="description" content="${e(description)}"><meta name="robots" content="${noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large'}"><link rel="canonical" href="${e(canonical)}"><meta property="og:type" content="${schema?.['@type'] === 'ProfilePage' ? 'profile' : 'website'}"><meta property="og:site_name" content="LINKUP"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(canonical)}">${imageMeta}<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${e(title)}"><meta name="twitter:description" content="${e(description)}">${json}<style>${css}</style></head><body><header><a href="${SITE}/">LINKUP<span aria-hidden="true"> ↗</span></a><nav aria-label="Main"><a href="${APP}/builders">Meet builders</a><a href="${APP}/landing">Join LINKUP</a></nav></header><main>${content}</main><footer><p>LINKUP connects cofounders, collaborators and people who build.</p><a href="${SITE}/privacy">Privacy policy</a> · <a href="${APP}/landing">Open the app</a></footer></body></html>`;
}
export function memberBadgeHtml(uid, verified = false) {
  const gold=isGoldMember(uid);
  if(!gold && !verified)return '';
  const icon=(color,check,label)=>`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" role="img" aria-label="${label}" style="display:inline-block;vertical-align:middle;margin-left:5px;flex-shrink:0"><path fill="${color}" d="M12 1l2.5 2 3.2-.1.9 3.1 2.7 1.7-1 3.1 1 3.1-2.7 1.7-.9 3.1-3.2-.1L12 21l-2.5-2-3.2.1-.9-3.1-2.7-1.7 1-3.1-1-3.1L5.4 6l.9-3.1 3.2.1z"/><path d="m7.8 10.8 2.7 2.7 5.7-5.6" fill="none" stroke="${check}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return icon('#0A84FF','#fff','Verified')+(gold?icon('#e0be1b','#FFFFFF','Gold verified — LINKUP CEO'):'');
}
export function renderProfile(p) {
  const e = escapeHtml;
  const url = profileUrl(p.uid);
  const headline = [p.company && `Company: ${p.company}`, p.occupation && `Role: ${p.occupation}`].filter(Boolean).join(' · ');
  const description = [p.name, headline, p.location, p.bio || (p.skills.length ? `Skills: ${p.skills.join(', ')}` : 'Connect on LINKUP.')].filter(Boolean).join(' — ').slice(0, 300);
  const person = { '@type': 'Person', '@id': `${url}#person`, name: p.name, url,
    ...(p.occupation && {jobTitle:p.occupation}), ...(p.image && {image:{'@type':'ImageObject',url:p.image,contentUrl:p.image,caption:`${p.name} profile photo`}}),
    ...(p.bio && {description:p.bio}), ...(p.socialLinks?.length && {sameAs:p.socialLinks}),
    ...(p.location && {homeLocation:{'@type':'Place',name:p.location}}), ...(p.skills.length && {knowsAbout:p.skills}),
    ...(p.company && {worksFor:{'@type':'Organization',name:p.company}}) };
  return documentHtml({title:p.name, description, canonical:url, image:p.image, imageAlt:`${p.name} profile photo`,
    schema: {'@context':'https://schema.org','@type':'ProfilePage',name:p.name,url,mainEntity:person,...(p.image && {primaryImageOfPage:{'@type':'ImageObject',url:p.image,contentUrl:p.image,caption:`${p.name} profile photo`}})},
    content:`<article>${p.image ? `<img class="avatar" src="${e(p.image)}" alt="${e(p.name)} profile photo" width="100" height="100" fetchpriority="high" decoding="async">` : ''}<h1>${e(p.name)}${memberBadgeHtml(p.uid,p.verified)}</h1>${isGoldMember(p.uid) ? `<section aria-label="Member verification"><p>This verified builder has been marked by LINKUP as a trusted, high-signal voice in the network.</p><p style="color:#76520B;font-weight:800">${GOLD_MEMBER_LABEL}</p></section>` : ''}${p.username ? `<p class="muted">@${e(p.username)}</p>` : ''}${p.company ? `<p class="profile-company"><strong>Company:</strong> ${e(p.company)}</p>` : ''}${p.occupation ? `<p class="profile-role"><strong>Role:</strong> ${e(p.occupation)}</p>` : ''}${p.location ? `<p class="muted">${e(p.location)}</p>` : ''}${p.bio ? `<section><h2>About ${e(p.name)}</h2><p>${e(p.bio)}</p></section>` : ''}${p.skills.length ? `<section><h2>Skills</h2>${p.skills.map(s => `<span class="tag">${e(s)}</span>`).join('')}</section>` : ''}${p.projects.length ? `<section><h2>Projects</h2>${p.projects.map(v => `<h3>${e(v.title)}</h3><p>${e(v.description)}</p>`).join('')}</section>` : ''}${p.socialLinks?.length ? `<section><h2>Elsewhere online</h2><ul>${p.socialLinks.map(url => `<li><a rel="me nofollow noopener noreferrer" href="${e(url)}">${e(new URL(url).hostname)}</a></li>`).join('')}</ul></section>` : ''}${p.lookingFor.length ? `<section><h2>Looking to connect with</h2><p>${e(p.lookingFor.join(', '))}</p></section>` : ''}<a class="button" href="${APP}/profile/${encodeURIComponent(p.uid)}">Connect with ${e(p.name)} in the app ↗</a></article>` });
}
export function renderDirectory(profiles, cursor = '', next = '') {
  const canonical = `${APP}/builders${cursor ? '?after=' + encodeURIComponent(cursor) : ''}`;
  return documentHtml({title:'Meet founders, cofounders and builders | LINKUP', description:'Discover public LINKUP profiles. Meet founders, explore their skills and projects, and find people to build with.',canonical,
    schema:{'@context':'https://schema.org','@type':'CollectionPage',url:canonical,name:'LINKUP builders',mainEntity:{'@type':'ItemList',itemListElement:profiles.map((p,i) => ({'@type':'ListItem',position:i+1,url:profileUrl(p.uid),name:p.name}))}},
    content:`<h1>Meet the people building what’s next.</h1><p class="muted">Explore founders, collaborators and builders on LINKUP.</p><div class="grid">${profiles.map(p => `<article class="card">${p.image ? `<a href="${profileUrl(p.uid)}" aria-label="Open ${escapeHtml(p.name)} profile"><img class="avatar" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)} profile photo" width="100" height="100" loading="lazy" decoding="async"></a>` : ''}<h2><a href="${profileUrl(p.uid)}">${escapeHtml(p.name)}</a>${memberBadgeHtml(p.uid,p.verified)}</h2>${p.company ? `<p>Company: ${escapeHtml(p.company)}</p>` : ''}<p>${escapeHtml(p.occupation || p.bio.slice(0,160))}</p><p class="muted">${escapeHtml(p.location)}</p></article>`).join('')}</div>${next ? `<a class="button" rel="next" href="${APP}/builders?after=${encodeURIComponent(next)}">More builders →</a>` : ''}`});
}
export const xmlUrls = urls => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls.map(entry => {
  const url = typeof entry === 'string' ? entry : entry.url;
  const image = typeof entry === 'object' && safeUrl(entry.image);
  return `<url><loc>${escapeHtml(url)}</loc>${image ? `<image:image><image:loc>${escapeHtml(image)}</image:loc></image:image>` : ''}</url>`;
}).join('')}</urlset>`;
export const xmlIndex = urls => `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<sitemap><loc>${escapeHtml(url)}</loc></sitemap>`).join('')}</sitemapindex>`;
