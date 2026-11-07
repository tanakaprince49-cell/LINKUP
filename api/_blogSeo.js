import crypto from 'node:crypto';
import {
  APP,
  SITE,
  PAGE_SIZE,
  SITEMAP_SIZE,
  text,
  escapeHtml as e,
  validId,
  publicEligible,
  safeUrl,
  profileUrl,
  memberBadgeHtml,
} from './_publicSeo.js';
import { isoDate } from './_contentSeo.js';
import { selectProfileImage } from './_publicProfileImage.js';
import { isGoldMember } from '../shared/member-badges.js';
import {
  canonicalBlogSlug,
  defaultCoverAlt,
  estimateReadTimeMinutes,
  extractBlogIdFromSlug,
  parseBlogBlocks,
  plainExcerptFromBlog,
} from '../shared/blog-format.js';

export const BLOG_SEO_FIELDS = [
  'title',
  'seoSlug',
  'body',
  'excerpt',
  'coverImage',
  'coverAlt',
  'readTimeMinutes',
  'categories',
  'links',
  'authorId',
  'status',
  'deleted',
  'isDeleted',
  'isHidden',
  'isPrivate',
  'createdAt',
  'updatedAt',
];

const BLOG_OWNER_FIELDS = [
  'displayName',
  'fullName',
  'name',
  'occupation',
  'company',
  'profilePicUrl',
  'photoURL',
  'profilePic',
  'avatarUrl',
  'isVerified',
  'onboarded',
  'isVisible',
  'isStealthMode',
  'deleted',
  'banned',
  'isBot',
];

const IK_PREFIX = 'https://ik.imagekit.io/vjkzaxrro/';
const BOT_UA_RE =
  /bot|crawl|spider|slurp|googleother|google-inspectiontool|mediapartners|apis-google|bingpreview|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|slackbot|applebot|ahrefs|semrush|mj12bot|HeadlessChrome/i;

export function blogCanonicalUrl(title, id) {
  return `${APP}/blogs/${encodeURIComponent(canonicalBlogSlug(title, id))}`;
}

function stripImageKitTransform(url = '') {
  if (!url.startsWith(IK_PREFIX)) return url;
  const rest = url.slice(IK_PREFIX.length).replace(/^tr:[^/]+\//, '');
  return `${IK_PREFIX}${rest}`;
}

/**
 * Generates Google News / Discover multi-aspect-ratio high-res variants (16:9, 4:3, 1:1)
 * plus responsive srcset for ImageKit-hosted blog cover photos.
 */
export function buildCoverSeoImages(rawCoverUrl = '', coverAlt = '', authorName = '') {
  const cleanUrl = safeUrl(rawCoverUrl);
  if (!cleanUrl) return null;

  if (cleanUrl.startsWith(IK_PREFIX)) {
    const master = stripImageKitTransform(cleanUrl);
    const tail = master.slice(IK_PREFIX.length);
    const img16x9 = `${IK_PREFIX}tr:w-1280,h-720,fo-auto,q-88,f-auto/${tail}`;
    const img4x3 = `${IK_PREFIX}tr:w-1200,h-900,fo-auto,q-86,f-auto/${tail}`;
    const img1x1 = `${IK_PREFIX}tr:w-1200,h-1200,fo-auto,q-86,f-auto/${tail}`;
    const w640 = `${IK_PREFIX}tr:w-640,h-360,fo-auto,q-82,f-auto/${tail}`;
    const w960 = `${IK_PREFIX}tr:w-960,h-540,fo-auto,q-85,f-auto/${tail}`;
    const srcset = `${w640} 640w, ${w960} 960w, ${img16x9} 1280w`;
    const makeObj = (url, width, height) => ({
      '@type': 'ImageObject',
      url,
      contentUrl: url,
      width,
      height,
      caption: coverAlt,
      name: coverAlt,
      ...(authorName
        ? { creditText: authorName, creator: { '@type': 'Person', name: authorName } }
        : {}),
    });
    return {
      primaryUrl: img16x9,
      thumbUrl: w640,
      srcset,
      width: 1280,
      height: 720,
      schemaImages: [
        makeObj(img16x9, 1280, 720),
        makeObj(img4x3, 1200, 900),
        makeObj(img1x1, 1200, 1200),
      ],
      primaryObject: makeObj(img16x9, 1280, 720),
    };
  }

  const obj = {
    '@type': 'ImageObject',
    url: cleanUrl,
    contentUrl: cleanUrl,
    width: 1280,
    height: 720,
    caption: coverAlt,
    name: coverAlt,
    ...(authorName
      ? { creditText: authorName, creator: { '@type': 'Person', name: authorName } }
      : {}),
  };
  return {
    primaryUrl: cleanUrl,
    thumbUrl: cleanUrl,
    srcset: '',
    width: 1280,
    height: 720,
    schemaImages: [obj],
    primaryObject: obj,
  };
}

export function blogSeoEligible(id, b, owner) {
  if (!validId(id) || /^(demo-|bot-)/.test(id) || !b) return false;
  if (b.deleted || b.isDeleted || b.isHidden || b.isPrivate || b.status !== 'published') {
    return false;
  }
  if (!validId(b.authorId) || !owner || owner.deleted || owner.banned || owner.isBot) {
    return false;
  }
  if (owner.onboarded !== true) return false;
  const authorName = text(owner.displayName || owner.fullName || owner.name, 100);
  const title = text(b.title, 140);
  const body = typeof b.body === 'string' ? b.body.trim() : '';
  return Boolean(authorName && title && body.length >= 15);
}

export function projectSeoBlog(id, b, owner) {
  const title = text(b.title, 140);
  const body = String(b.body || '').slice(0, 25000);
  const plainBody = plainExcerptFromBlog(body, 25000);
  const excerpt = text(b.excerpt || plainExcerptFromBlog(body, 200), 260);
  const categoriesRaw = (Array.isArray(b.categories) ? b.categories : [])
    .map((c) => text(c, 32))
    .filter(Boolean)
    .slice(0, 6);
  const categories = categoriesRaw.length ? categoriesRaw : ['Startups'];

  const authorName = text(owner.displayName || owner.fullName || owner.name, 100);
  const authorHeadline = text(owner.occupation || owner.company, 120);
  const authorVerified = owner.isVerified === true || isGoldMember(b.authorId);
  const authorIsPublic = publicEligible(owner, b.authorId);
  const authorAvatar = authorIsPublic
    ? selectProfileImage(b.authorId, owner, safeUrl)?.url || ''
    : '';

  const coverAlt = text(
    b.coverAlt || defaultCoverAlt(title, authorName, categories),
    180
  );
  const coverSeo = buildCoverSeoImages(b.coverImage, coverAlt, authorName);

  const published = isoDate(b.createdAt);
  const modified = isoDate(b.updatedAt) || published;
  const wordCount = Math.max(
    1,
    plainBody
      .trim()
      .split(/\s+/)
      .filter(Boolean).length
  );
  const readTimeMinutes = Math.max(
    1,
    Math.min(60, Math.round(Number(b.readTimeMinutes) || estimateReadTimeMinutes(body)))
  );
  const links = (Array.isArray(b.links) ? b.links : [])
    .slice(0, 8)
    .map((item) => ({
      label: text(item?.label, 80) || 'Reference',
      url: safeUrl(item?.url),
    }))
    .filter((item) => item.url);

  const url = blogCanonicalUrl(title, id);

  return {
    id,
    url,
    title,
    body,
    plainBody,
    excerpt,
    wordCount,
    readTimeMinutes,
    categories,
    links,
    coverAlt,
    coverSeo,
    authorId: b.authorId,
    authorName,
    authorHeadline,
    authorVerified,
    authorIsPublic,
    authorAvatar,
    published,
    modified,
  };
}

function renderInlineHtml(segments = []) {
  return segments
    .map((seg) => {
      let inner = e(seg.text || '');
      if (seg.code) inner = `<code>${inner}</code>`;
      if (seg.bold) inner = `<strong>${inner}</strong>`;
      if (seg.italic) inner = `<em>${inner}</em>`;
      if (seg.underline) inner = `<u>${inner}</u>`;
      if (seg.strike) inner = `<s>${inner}</s>`;
      if (seg.highlight) inner = `<mark>${inner}</mark>`;
      if (seg.type === 'link' && seg.url) {
        const href = safeUrl(seg.url) || '';
        if (href) {
          return `<a href="${e(href)}" rel="ugc noopener noreferrer">${inner}</a>`;
        }
      }
      return inner;
    })
    .join('');
}

export function renderBlogBodyHtml(body = '') {
  const blocks = parseBlogBlocks(body);
  return blocks
    .map((block) => {
      if (block.type === 'divider') return '<hr>';
      if (block.type === 'codeblock') return `<pre><code>${e(block.code || '')}</code></pre>`;
      if (block.type === 'h1') return `<h2>${renderInlineHtml(block.segments)}</h2>`;
      if (block.type === 'h2') return `<h2>${renderInlineHtml(block.segments)}</h2>`;
      if (block.type === 'h3') return `<h3>${renderInlineHtml(block.segments)}</h3>`;
      if (block.type === 'quote') {
        return `<blockquote><p>${renderInlineHtml(block.segments)}</p></blockquote>`;
      }
      if (block.type === 'list') {
        return `<ul>${block.items.map((it) => `<li>${renderInlineHtml(it)}</li>`).join('')}</ul>`;
      }
      if (block.type === 'ordered') {
        return `<ol>${block.items.map((it) => `<li>${renderInlineHtml(it)}</li>`).join('')}</ol>`;
      }
      return `<p>${renderInlineHtml(block.segments)}</p>`;
    })
    .join('\n');
}

const blogPageCss = `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#faf9f5;color:#171918;font:18px/1.72 system-ui,-apple-system,sans-serif}a{color:#0a58ca}header,main,footer{max-width:900px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;gap:20px;align-items:center;flex-wrap:wrap}header>a{color:#171918;font-weight:900;font-size:24px;text-decoration:none;letter-spacing:-1px}nav{display:flex;flex-wrap:wrap;gap:16px;font-size:15px}nav a{color:#171918}article,.card{background:#fff;border:1px solid #deded6;border-radius:24px;padding:34px;margin:16px 0}h1{font-size:clamp(30px,5.5vw,46px);letter-spacing:-1.4px;line-height:1.15;margin:14px 0}h2{font-size:24px;letter-spacing:-.5px;margin:26px 0 10px}h3{font-size:19px;margin:20px 0 8px}p{margin:14px 0;overflow-wrap:anywhere}blockquote{margin:18px 0;padding:14px 18px;border-left:4px solid #fbe618;background:#faf8eb;border-radius:10px;font-style:italic}pre{background:#181b22;color:#f3f4f6;padding:16px;border-radius:12px;overflow-x:auto;font-size:14px;line-height:1.5}code{background:#eceae2;padding:2px 6px;border-radius:5px;font-size:15px}pre code{background:none;padding:0;color:inherit}mark{background:#fef08a;padding:1px 4px;border-radius:4px}hr{border:0;border-top:1px solid #deded6;margin:26px 0}figure{margin:0 0 22px}.muted{color:#565b55}.avatar{width:54px;height:54px;object-fit:cover;border-radius:50%}.author-box{display:flex;align-items:center;gap:14px;padding:16px;border:1px solid #e5e2d9;border-radius:16px;background:#f8f7f2;margin:18px 0 26px}.verified-pill{display:inline-block;background:#eff6ff;color:#1d4ed8;border:1px solid #93c5fd;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:800;margin-left:6px}.tag{display:inline-block;background:#fbe618;color:#0a0b0d;font-weight:800;border-radius:30px;padding:4px 12px;margin:3px 4px 3px 0;font-size:12px;text-decoration:none}.button{display:inline-block;background:#fbe618;color:#171918;padding:12px 22px;border-radius:30px;text-decoration:none;font-weight:800;margin:12px 8px 8px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}.grid .card{margin:0;padding:22px}footer{font-size:14px;color:#565b55}@media(max-width:520px){header,main,footer{padding:16px}article{padding:22px}}`;

function renderSeoShell({
  title,
  description,
  canonical,
  ogType = 'website',
  coverSeo = null,
  coverAlt = '',
  published = '',
  modified = '',
  authorName = '',
  authorHref = '',
  categories = [],
  schema = null,
  content = '',
}) {
  const imageUrl = coverSeo?.primaryUrl || `${APP}/icons/icon-512.png`;
  const alt = coverAlt || title || 'LINKUP Founder Blogs';
  const twitterCard = coverSeo?.primaryUrl ? 'summary_large_image' : 'summary';

  const articleMeta =
    ogType === 'article'
      ? [
          published ? `<meta property="article:published_time" content="${e(published)}">` : '',
          modified ? `<meta property="article:modified_time" content="${e(modified)}">` : '',
          categories[0]
            ? `<meta property="article:section" content="${e(categories[0])}">`
            : '',
          ...categories.map((c) => `<meta property="article:tag" content="${e(c)}">`),
          authorHref ? `<meta property="article:author" content="${e(authorHref)}">` : '',
          authorName ? `<meta name="author" content="${e(authorName)}">` : '',
          categories.length
            ? `<meta name="news_keywords" content="${e(categories.join(', '))}">`
            : '',
        ].join('')
      : '';

  const imageMeta = imageUrl
    ? [
        `<meta property="og:image" content="${e(imageUrl)}">`,
        `<meta property="og:image:secure_url" content="${e(imageUrl)}">`,
        coverSeo?.primaryUrl ? `<meta property="og:image:width" content="1280">` : '',
        coverSeo?.primaryUrl ? `<meta property="og:image:height" content="720">` : '',
        `<meta property="og:image:alt" content="${e(alt)}">`,
        `<meta name="twitter:image" content="${e(imageUrl)}">`,
        `<meta name="twitter:image:alt" content="${e(alt)}">`,
        `<link rel="image_src" href="${e(imageUrl)}">`,
      ].join('')
    : '';

  const jsonLd = schema
    ? `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`
    : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><meta name="description" content="${e(description)}"><meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"><meta name="googlebot" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"><meta name="googlebot-news" content="index,follow"><link rel="canonical" href="${e(canonical)}"><link rel="alternate" type="application/rss+xml" title="LINKUP Founder &amp; Startup Blogs" href="${APP}/blogs/rss.xml"><meta property="og:type" content="${e(ogType)}"><meta property="og:site_name" content="LINKUP"><meta property="og:locale" content="en_US"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(canonical)}">${articleMeta}${imageMeta}<meta name="twitter:card" content="${twitterCard}"><meta name="twitter:title" content="${e(title)}"><meta name="twitter:description" content="${e(description)}">${jsonLd}<style>${blogPageCss}</style></head><body><header><a href="${SITE}/">LINKUP<span aria-hidden="true"> ↗</span></a><nav aria-label="Main"><a href="${APP}/blogs">Blogs</a><a href="${APP}/builders">Meet builders</a><a href="${APP}/startups">Startups</a><a href="${APP}/sponsored">Campaigns</a><a href="${APP}/builder-league">Builder League</a><a href="${APP}/momentum">Momentum</a><a href="${APP}/landing">Join LINKUP</a></nav></header><main>${content}</main><footer><p>LINKUP — Founder &amp; Builder Community Blogs, Co-Founder Matching, and Startup Discovery.</p><p><a href="${APP}/blogs">All Blogs</a> · <a href="${APP}/blogs/rss.xml">Google News RSS Feed</a> · <a href="${SITE}/privacy">Privacy policy</a> · <a href="${APP}/landing">Open the app</a></p></footer></body></html>`;
}

export function renderBlogArticlePage(b, related = []) {
  const authorHref = b.authorIsPublic ? profileUrl(b.authorId) : '';
  const description = b.excerpt || `Read "${b.title}" by ${b.authorName} on LINKUP Blogs.`;
  const pageTitle = `${b.title} — ${b.authorName} | LINKUP Blogs`;

  const authorEntity = {
    '@type': 'Person',
    name: b.authorName,
    ...(authorHref ? { '@id': `${authorHref}#person`, url: authorHref } : {}),
    ...(b.authorHeadline ? { jobTitle: b.authorHeadline } : {}),
    ...(b.authorAvatar
      ? {
          image: {
            '@type': 'ImageObject',
            url: b.authorAvatar,
            contentUrl: b.authorAvatar,
            caption: `${b.authorName} profile photo`,
          },
        }
      : {}),
  };

  const publisherEntity = {
    '@type': 'Organization',
    '@id': `${SITE}/#organization`,
    name: 'LINKUP',
    url: `${SITE}/`,
    logo: {
      '@type': 'ImageObject',
      url: `${APP}/icons/icon-512.png`,
      width: 512,
      height: 512,
    },
  };

  const articleSchema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['NewsArticle', 'BlogPosting'],
        '@id': `${b.url}#article`,
        mainEntityOfPage: { '@type': 'WebPage', '@id': b.url },
        headline: b.title.slice(0, 110),
        name: b.title,
        description,
        articleBody: b.plainBody.slice(0, 18000),
        wordCount: b.wordCount,
        timeRequired: `PT${b.readTimeMinutes}M`,
        inLanguage: 'en',
        isAccessibleForFree: true,
        articleSection: b.categories,
        keywords: b.categories.join(', '),
        url: b.url,
        author: [authorEntity],
        publisher: publisherEntity,
        ...(b.published ? { datePublished: b.published } : {}),
        ...(b.modified ? { dateModified: b.modified } : {}),
        ...(b.coverSeo
          ? {
              image: b.coverSeo.schemaImages,
              thumbnailUrl: b.coverSeo.thumbUrl,
            }
          : {}),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${b.url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'LINKUP', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Blogs', item: `${APP}/blogs` },
          { '@type': 'ListItem', position: 3, name: b.title, item: b.url },
        ],
      },
    ],
  };

  const coverFigure = b.coverSeo
    ? `<figure itemprop="image" itemscope itemtype="https://schema.org/ImageObject"><img src="${e(b.coverSeo.primaryUrl)}"${b.coverSeo.srcset ? ` srcset="${e(b.coverSeo.srcset)}" sizes="(max-width: 860px) 100vw, 860px"` : ''} alt="${e(b.coverAlt)}" title="${e(b.title)}" width="1280" height="720" fetchpriority="high" decoding="sync" itemprop="url contentUrl" style="width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:18px;display:block"><figcaption itemprop="caption" class="muted" style="font-size:14px;margin-top:8px">${e(b.coverAlt)}</figcaption><meta itemprop="width" content="1280"><meta itemprop="height" content="720"></figure>`
    : '';

  const authorHtml = `<div class="author-box">${b.authorAvatar ? `<img class="avatar" src="${e(b.authorAvatar)}" alt="${e(b.authorName)} profile photo" width="54" height="54" loading="eager" decoding="async">` : ''}<div><div><strong>${authorHref ? `<a href="${e(authorHref)}" rel="author" style="color:#171918;text-decoration:none">${e(b.authorName)}</a>` : e(b.authorName)}</strong>${memberBadgeHtml(b.authorId, b.authorVerified)}${b.authorVerified ? '<span class="verified-pill">Verified Author</span>' : ''}</div>${b.authorHeadline ? `<div class="muted" style="font-size:14px">${e(b.authorHeadline)}</div>` : ''}<div class="muted" style="font-size:13px">${b.published ? `<time datetime="${e(b.published)}">${e(b.published.slice(0, 10))}</time> · ` : ''}${b.readTimeMinutes} min read</div></div></div>`;

  const refsHtml = b.links.length
    ? `<section aria-label="Referenced links"><h2>Referenced Links</h2><ul>${b.links.map((l) => `<li><a href="${e(l.url)}" rel="ugc noopener noreferrer">${e(l.label)}</a></li>`).join('')}</ul></section>`
    : '';

  const relatedHtml = related.length
    ? `<section aria-label="More blogs on LINKUP"><h2>More Founder &amp; Builder Blogs</h2><div class="grid">${related
        .slice(0, 4)
        .map(
          (r) =>
            `<article class="card">${r.coverSeo ? `<a href="${e(r.url)}"><img src="${e(r.coverSeo.thumbUrl)}" alt="${e(r.coverAlt)}" width="640" height="360" loading="lazy" decoding="async" style="width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:12px;margin-bottom:10px"></a>` : ''}<h3 style="margin:4px 0"><a href="${e(r.url)}">${e(r.title)}</a></h3><p class="muted" style="font-size:14px;margin:4px 0">By ${e(r.authorName)} · ${r.readTimeMinutes} min read</p></article>`
        )
        .join('')}</div></section>`
    : '';

  return renderSeoShell({
    title: pageTitle,
    description,
    canonical: b.url,
    ogType: 'article',
    coverSeo: b.coverSeo,
    coverAlt: b.coverAlt,
    published: b.published,
    modified: b.modified,
    authorName: b.authorName,
    authorHref,
    categories: b.categories,
    schema: articleSchema,
    content: `<nav aria-label="Breadcrumb" style="font-size:14px"><a href="${SITE}/">LINKUP</a> / <a href="${APP}/blogs">Blogs</a> / ${e(b.title)}</nav><article itemscope itemtype="https://schema.org/NewsArticle">${coverFigure}<div>${b.categories.map((c) => `<span class="tag">${e(c)}</span>`).join('')}</div><h1 itemprop="headline">${e(b.title)}</h1>${authorHtml}<div itemprop="articleBody">${renderBlogBodyHtml(b.body)}</div>${refsHtml}<hr><p><a class="button" href="${APP}/news-feed?blog=${encodeURIComponent(b.id)}">Open &amp; Write Blogs in LINKUP ↗</a> <a href="${APP}/blogs">Browse All Blogs →</a></p></article>${relatedHtml}`,
  });
}

export function renderBlogsDirectoryPage(rows, cursor = '', next = '') {
  const canonical = `${APP}/blogs${cursor ? '?after=' + encodeURIComponent(cursor) : ''}`;
  const title = 'Founder, Startup & Engineering Blogs | LINKUP';
  const description =
    'Read original startup essays, engineering deep-dives, AI playbooks, and founder stories written by verified builders on LINKUP.';

  const schema = {
    '@context': 'https://schema.org',
    '@type': ['CollectionPage', 'Blog'],
    '@id': `${canonical}#blog`,
    name: 'LINKUP Community Blogs',
    url: canonical,
    description,
    inLanguage: 'en',
    publisher: {
      '@type': 'Organization',
      name: 'LINKUP',
      url: `${SITE}/`,
    },
    blogPost: rows.slice(0, 20).map((b) => ({
      '@type': 'BlogPosting',
      headline: b.title.slice(0, 110),
      url: b.url,
      ...(b.published ? { datePublished: b.published } : {}),
      author: { '@type': 'Person', name: b.authorName },
      ...(b.coverSeo ? { image: b.coverSeo.primaryUrl } : {}),
    })),
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: rows.map((b, idx) => ({
        '@type': 'ListItem',
        position: idx + 1,
        name: b.title,
        url: b.url,
      })),
    },
  };

  return renderSeoShell({
    title,
    description,
    canonical,
    schema,
    content: `<h1>Founder, Startup &amp; Engineering Blogs</h1><p>${e(description)}</p><p><a class="button" href="${APP}/news-feed">Write a Blog on LINKUP ↗</a> <a href="${APP}/blogs/rss.xml">RSS Feed</a></p><div class="grid">${rows
      .map(
        (b) =>
          `<article class="card">${b.coverSeo ? `<a href="${e(b.url)}"><img src="${e(b.coverSeo.thumbUrl)}" alt="${e(b.coverAlt)}" title="${e(b.title)}" width="640" height="360" loading="lazy" decoding="async" style="width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:14px;margin-bottom:12px"></a>` : ''}<div>${b.categories.slice(0, 2).map((c) => `<span class="tag">${e(c)}</span>`).join('')}</div><h2 style="font-size:20px;margin:8px 0"><a href="${e(b.url)}">${e(b.title)}</a></h2><p style="font-size:15px">${e(b.excerpt)}</p><p class="muted" style="font-size:13px">By ${e(b.authorName)}${b.authorVerified ? ' · Verified Author' : ''} · ${b.readTimeMinutes} min read${b.published ? ` · <time datetime="${e(b.published)}">${e(b.published.slice(0, 10))}</time>` : ''}</p><a href="${e(b.url)}">Read full article →</a></article>`
      )
      .join('')}</div>${!rows.length ? '<p>No public blogs on this page yet. Publish the first blog inside LINKUP.</p>' : ''}${next ? `<a class="button" rel="next" href="${APP}/blogs?after=${encodeURIComponent(next)}">Older blogs →</a>` : ''}${cursor ? `<p><a href="${APP}/blogs">← Back to newest blogs</a></p>` : ''}`,
  });
}

export function renderBlogImageSitemapXml(rows = []) {
  const entries = rows
    .map((b) => {
      const images = [];
      if (b.coverSeo?.primaryUrl) {
        images.push(
          `<image:image><image:loc>${e(b.coverSeo.primaryUrl)}</image:loc><image:title>${e(b.title)}</image:title><image:caption>${e(b.coverAlt)}</image:caption></image:image>`
        );
      }
      if (b.authorAvatar) {
        images.push(
          `<image:image><image:loc>${e(b.authorAvatar)}</image:loc><image:title>${e(b.authorName)} — Author on LINKUP</image:title><image:caption>${e(b.authorName)}, author of "${e(b.title)}" on LINKUP</image:caption></image:image>`
        );
      }
      const lastmod = b.modified || b.published;
      return `<url><loc>${e(b.url)}</loc>${lastmod ? `<lastmod>${e(lastmod)}</lastmod>` : ''}${images.join('')}</url>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${entries}</urlset>`;
}

/**
 * Official Google News XML Sitemap (xmlns:news="http://www.google.com/schemas/sitemap-news/0.9").
 * Per Google News specification, includes articles published within the last 48 hours (up to 1,000).
 */
export function renderGoogleNewsSitemapXml(rows = [], nowMs = Date.now()) {
  const cutoffMs = nowMs - 48 * 60 * 60 * 1000;
  const recent = rows
    .filter((b) => {
      if (!b.published) return false;
      const ms = Date.parse(b.published);
      return Number.isFinite(ms) && ms >= cutoffMs;
    })
    .slice(0, 1000);

  const items = recent
    .map((b) => {
      const keywords = b.categories.join(', ');
      const imgXml = b.coverSeo?.primaryUrl
        ? `<image:image><image:loc>${e(b.coverSeo.primaryUrl)}</image:loc><image:title>${e(b.title)}</image:title><image:caption>${e(b.coverAlt)}</image:caption></image:image>`
        : '';
      return `<url><loc>${e(b.url)}</loc><news:news><news:publication><news:name>LINKUP</news:name><news:language>en</news:language></news:publication><news:publication_date>${e(b.published)}</news:publication_date><news:title>${e(b.title.slice(0, 110))}</news:title>${keywords ? `<news:keywords>${e(keywords)}</news:keywords>` : ''}</news:news>${imgXml}</url>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${items}</urlset>`;
}

export function renderBlogsRssXml(rows = []) {
  const items = rows
    .slice(0, 50)
    .map((b) => {
      const pubDate = b.published ? new Date(b.published).toUTCString() : new Date().toUTCString();
      const mediaXml = b.coverSeo?.primaryUrl
        ? `<media:content url="${e(b.coverSeo.primaryUrl)}" medium="image" width="1280" height="720"><media:title>${e(b.title)}</media:title><media:description>${e(b.coverAlt)}</media:description></media:content>`
        : '';
      const catsXml = b.categories.map((c) => `<category>${e(c)}</category>`).join('');
      return `<item><title>${e(b.title)}</title><link>${e(b.url)}</link><guid isPermaLink="true">${e(b.url)}</guid><pubDate>${e(pubDate)}</pubDate><author>${e(b.authorName)}</author><description>${e(b.excerpt)}</description>${catsXml}${mediaXml}</item>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>LINKUP Founder &amp; Startup Blogs</title><link>${APP}/blogs</link><atom:link href="${APP}/blogs/rss.xml" rel="self" type="application/rss+xml"/><description>Original startup essays, engineering deep-dives, AI playbooks, and founder stories from builders on LINKUP.</description><language>en</language>${items}</channel></rss>`;
}

function baseBlogsQuery(db) {
  return db.collection('blogs').where('status', '==', 'published');
}

async function loadSeoBlogs(db, docs) {
  if (!docs.length) return [];
  const sources = await db.getAll(
    ...docs.map((d) => db.collection('blogs').doc(d.id)),
    { fieldMask: BLOG_SEO_FIELDS }
  );
  const ownerIds = [
    ...new Set(
      sources
        .filter((d) => d.exists)
        .map((d) => d.data()?.authorId)
        .filter(validId)
    ),
  ];
  const owners = ownerIds.length
    ? await db.getAll(...ownerIds.map((uid) => db.collection('users').doc(uid)), {
        fieldMask: BLOG_OWNER_FIELDS,
      })
    : [];
  const ownerMap = new Map(owners.filter((d) => d.exists).map((d) => [d.id, d.data()]));

  return sources
    .filter((d) => d.exists && blogSeoEligible(d.id, d.data(), ownerMap.get(d.data()?.authorId)))
    .map((d) => projectSeoBlog(d.id, d.data(), ownerMap.get(d.data()?.authorId)));
}

async function recordOrganicHumanView(db, req, blogId, nowMs) {
  try {
    if (req.method !== 'GET') return;
    const ua = String(req.headers?.['user-agent'] || '');
    if (!ua || BOT_UA_RE.test(ua)) return;
    const fwd = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const day = new Date(nowMs).toISOString().slice(0, 10);
    const viewerHash = crypto
      .createHash('sha256')
      .update(`linkup-blog-v1:${fwd}|${ua.slice(0, 120)}|${day}`)
      .digest('hex')
      .slice(0, 20);
    const bucketToken = `${viewerHash}:${Math.floor(nowMs / (30 * 60 * 1000))}`;

    const ref = db.collection('blogs').doc(blogId);
    if (typeof ref.get !== 'function' || typeof ref.set !== 'function') return;
    const snap = await ref.get();
    if (!snap?.exists) return;
    const data = snap.data() || {};
    if (data.deleted || data.status !== 'published') return;

    const recentBuckets = Array.isArray(data.recentViewBuckets)
      ? [...data.recentViewBuckets]
      : [];
    const viewerHashes = Array.isArray(data.viewerHashes) ? [...data.viewerHashes] : [];
    let viewsCount = Math.max(0, Math.round(Number(data.viewsCount) || 0));
    let uniqueViews = Math.max(0, Math.round(Number(data.uniqueViews) || 0));
    let changed = false;

    if (!recentBuckets.includes(bucketToken)) {
      viewsCount += 1;
      changed = true;
      recentBuckets.push(bucketToken);
      if (recentBuckets.length > 400) recentBuckets.splice(0, recentBuckets.length - 400);
    }
    if (!viewerHashes.includes(viewerHash)) {
      uniqueViews += 1;
      changed = true;
      viewerHashes.push(viewerHash);
      if (viewerHashes.length > 600) viewerHashes.splice(0, viewerHashes.length - 600);
    }
    if (changed) {
      await ref.set(
        { ...data, viewsCount, uniqueViews, recentViewBuckets: recentBuckets, viewerHashes },
        { merge: true }
      );
    }
  } catch {
    // Non-blocking organic analytics — never delay or fail an SEO page
  }
}

export async function blogSitemapIndex(db) {
  const count = (await baseBlogsQuery(db).count().get()).data().count;
  const pages = Math.max(1, Math.ceil(count / SITEMAP_SIZE));
  if (pages > 20000) throw new Error('Blog sitemap capacity exceeded');
  const urls = [`${APP}/sitemap-google-news.xml`];
  for (let i = 0; i < pages; i++) {
    urls.push(`${APP}/sitemap-blogs-${i}.xml`);
  }
  return urls;
}

const SITEMAP_HEADERS = {
  'Cache-Control': 'public, max-age=300',
  'Vercel-CDN-Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
  'CDN-Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
};

export async function serveBlogSeo(req, { database, send, failure, now = Date.now }) {
  const mode = typeof req.query?.mode === 'string' ? req.query.mode : '';
  if (
    !['blog', 'blogs', 'blog-sitemap', 'google-news-sitemap', 'blogs-rss'].includes(mode)
  ) {
    return false;
  }

  const db = database();

  if (mode === 'blog') {
    const rawParam = typeof req.query?.id === 'string' ? req.query.id : '';
    const blogId = extractBlogIdFromSlug(rawParam);
    if (!validId(blogId)) {
      failure(404, 'Blog not found');
      return true;
    }
    const rows = await loadSeoBlogs(db, [{ id: blogId }]);
    if (!rows.length) {
      failure(404, 'Blog not found');
      return true;
    }
    let related = [];
    try {
      const recentSnap = await baseBlogsQuery(db).orderBy('__name__').select().limit(6).get();
      const loaded = await loadSeoBlogs(
        db,
        recentSnap.docs.filter((d) => d.id !== blogId).slice(0, 4)
      );
      related = loaded.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
    } catch {
      related = [];
    }
    await recordOrganicHumanView(db, req, blogId, now());
    send(200, renderBlogArticlePage(rows[0], related));
    return true;
  }

  if (mode === 'google-news-sitemap' || mode === 'blogs-rss') {
    const snap = await baseBlogsQuery(db).orderBy('__name__').select().limit(250).get();
    const rows = (await loadSeoBlogs(db, snap.docs)).sort((a, b) =>
      (b.published || '').localeCompare(a.published || '')
    );
    if (mode === 'google-news-sitemap') {
      send(
        200,
        renderGoogleNewsSitemapXml(rows, now()),
        'application/xml; charset=utf-8',
        SITEMAP_HEADERS
      );
      return true;
    }
    send(200, renderBlogsRssXml(rows), 'application/rss+xml; charset=utf-8', SITEMAP_HEADERS);
    return true;
  }

  if (mode === 'blog-sitemap') {
    const raw = req.query?.page;
    if (typeof raw !== 'string' || !/^(0|[1-9]\d{0,4})$/.test(raw)) {
      failure(400, 'Invalid sitemap');
      return true;
    }
    const count = (await baseBlogsQuery(db).count().get()).data().count;
    const page = Number(raw);
    if (page >= Math.max(1, Math.ceil(count / SITEMAP_SIZE))) {
      failure(404, 'Sitemap not found');
      return true;
    }
    const snap = await baseBlogsQuery(db)
      .orderBy('__name__')
      .offset(page * SITEMAP_SIZE)
      .select()
      .limit(SITEMAP_SIZE)
      .get();
    const rows = await loadSeoBlogs(db, snap.docs);
    send(200, renderBlogImageSitemapXml(rows), 'application/xml; charset=utf-8', SITEMAP_HEADERS);
    return true;
  }

  // mode === 'blogs' directory
  const cursor = req.query?.after;
  if (cursor !== undefined && (typeof cursor !== 'string' || (cursor && !validId(cursor)))) {
    failure(400, 'Invalid page');
    return true;
  }
  let q = baseBlogsQuery(db).orderBy('__name__');
  if (cursor) q = q.startAfter(cursor);
  const snap = await q.select().limit(PAGE_SIZE + 1).get();
  const docs = snap.docs.slice(0, PAGE_SIZE);
  const rows = (await loadSeoBlogs(db, docs)).sort((a, b) =>
    (b.published || '').localeCompare(a.published || '')
  );
  const next = snap.docs.length > PAGE_SIZE ? docs.at(-1).id : '';
  send(200, renderBlogsDirectoryPage(rows, cursor || '', next));
  return true;
}
