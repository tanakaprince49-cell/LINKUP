import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_BLOG_CATEGORIES,
  applyToolbarFormat,
  canonicalBlogSlug,
  computeCoverCropRect,
  defaultCoverAlt,
  estimateReadTimeMinutes,
  extractBlogIdFromSlug,
  extractMarkdownLink,
  parseBlogBlocks,
  plainExcerptFromBlog,
} from '../shared/blog-format.js';
import { createBlogsService } from '../api/_blogs.js';
import { createPublicSeoHandler } from '../api/publicSeo.js';
import { GOLD_MEMBER_UID } from '../shared/member-badges.js';

function createMockDb(initial = {}) {
  const store = new Map();
  for (const [col, docs] of Object.entries(initial)) {
    const m = new Map();
    for (const [k, v] of Object.entries(docs)) m.set(k, structuredClone(v));
    store.set(col, m);
  }
  const ensure = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };
  const docRef = (col, id) => ({
    id,
    get: async () => {
      const has = ensure(col).has(id);
      const val = has ? structuredClone(ensure(col).get(id)) : undefined;
      return { id, exists: has, data: () => (val ? structuredClone(val) : undefined) };
    },
    set: async (data, opts) => {
      const prev = opts?.merge && ensure(col).has(id) ? ensure(col).get(id) : {};
      ensure(col).set(id, structuredClone({ ...prev, ...data }));
    },
    delete: async () => {
      ensure(col).delete(id);
    },
  });

  function makeQuery(col, filters = [], sortField = null, sortDir = 'asc', afterId = '', off = 0, lim = null) {
    const resolveDocs = () => {
      let entries = [...ensure(col).entries()].map(([id, v]) => ({
        id,
        v: structuredClone(v),
      }));
      for (const [f, op, val] of filters) {
        if (op === '==') entries = entries.filter((e) => e.v?.[f] === val);
      }
      if (sortField === '__name__') {
        entries.sort((a, b) => a.id.localeCompare(b.id));
      } else if (sortField) {
        entries.sort((a, b) =>
          sortDir === 'desc'
            ? (b.v?.[sortField] || 0) - (a.v?.[sortField] || 0)
            : (a.v?.[sortField] || 0) - (b.v?.[sortField] || 0)
        );
      }
      if (afterId) {
        const idx = entries.findIndex((e) => e.id > afterId);
        entries = idx === -1 ? [] : entries.slice(idx);
      }
      if (off > 0) entries = entries.slice(off);
      if (lim !== null) entries = entries.slice(0, lim);
      return entries.map((e) => ({
        id: e.id,
        exists: true,
        data: () => structuredClone(e.v),
      }));
    };

    return {
      where: (f, op, val) => makeQuery(col, [...filters, [f, op, val]], sortField, sortDir, afterId, off, lim),
      orderBy: (f, dir = 'asc') => makeQuery(col, filters, f, dir, afterId, off, lim),
      startAfter: (cursor) => makeQuery(col, filters, sortField, sortDir, cursor, off, lim),
      offset: (n) => makeQuery(col, filters, sortField, sortDir, afterId, n, lim),
      select: () => makeQuery(col, filters, sortField, sortDir, afterId, off, lim),
      limit: (n) => makeQuery(col, filters, sortField, sortDir, afterId, off, n),
      count: () => ({
        get: async () => ({ data: () => ({ count: resolveDocs().length }) }),
      }),
      get: async () => ({ docs: resolveDocs() }),
    };
  }

  return {
    collection: (col) => ({
      doc: (id) => docRef(col, id),
      where: (f, op, val) => makeQuery(col, [[f, op, val]]),
      orderBy: (f, dir = 'asc') => makeQuery(col, [], f, dir),
      count: () => makeQuery(col).count(),
    }),
    getAll: async (...args) => {
      const refs = args.filter((a) => a && typeof a.get === 'function');
      return Promise.all(refs.map((r) => r.get()));
    },
  };
}

function callSeo(handler, query = {}, opts = {}) {
  const headers = {};
  let statusCode = 200;
  let body = '';
  const req = {
    method: opts.method || 'GET',
    query,
    headers: opts.headers || { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  };
  const res = {
    setHeader: (k, v) => {
      headers[k.toLowerCase()] = v;
    },
    status: (c) => {
      statusCode = c;
      return res;
    },
    send: (b) => {
      body = b;
      return res;
    },
    end: () => res,
  };
  return handler(req, res).then(() => ({ statusCode, headers, body }));
}

test('Highlighting a word supports Insert Link (with space & edit safety) plus full rich formatting options', () => {
  const b = applyToolbarFormat('Ship fast every week', { start: 5, end: 9 }, 'bold');
  assert.equal(b.text, 'Ship **fast** every week');
  assert.deepEqual(b.selection, { start: 7, end: 11 });
  const bToggleInner = applyToolbarFormat(b.text, b.selection, 'bold');
  assert.equal(bToggleInner.text, 'Ship fast every week');

  const it = applyToolbarFormat('Real founder lessons', { start: 5, end: 12 }, 'italic');
  assert.equal(it.text, 'Real *founder* lessons');

  const ul = applyToolbarFormat('Key takeaway here', { start: 0, end: 12 }, 'underline');
  assert.equal(ul.text, '++Key takeaway++ here');

  const st = applyToolbarFormat('Old assumption', { start: 0, end: 14 }, 'strike');
  assert.equal(st.text, '~~Old assumption~~');

  const hl = applyToolbarFormat('Remember this metric', { start: 9, end: 20 }, 'highlight');
  assert.equal(hl.text, 'Remember ==this metric==');

  const cd = applyToolbarFormat('Run npm test first', { start: 4, end: 12 }, 'code');
  assert.equal(cd.text, 'Run `npm test` first');

  const h1 = applyToolbarFormat('Big Title', { start: 0, end: 9 }, 'h1');
  assert.equal(h1.text, '# Big Title');

  const h2 = applyToolbarFormat('Intro line\nWhy we pivoted\nClosing', { start: 11, end: 25 }, 'h2');
  assert.equal(h2.text, 'Intro line\n## Why we pivoted\nClosing');

  const h3 = applyToolbarFormat('Sub point', { start: 0, end: 9 }, 'h3');
  assert.equal(h3.text, '### Sub point');

  const qt = applyToolbarFormat('Customers pay for outcomes, not roadmaps.', { start: 0, end: 41 }, 'quote');
  assert.equal(qt.text, '> Customers pay for outcomes, not roadmaps.');

  const lst = applyToolbarFormat('First step\nSecond step', { start: 0, end: 22 }, 'list');
  assert.equal(lst.text, '- First step\n- Second step');

  const ord = applyToolbarFormat('Alpha\nBeta', { start: 0, end: 10 }, 'ordered');
  assert.equal(ord.text, '1. Alpha\n2. Beta');

  const lnk = applyToolbarFormat('Try our live product today', { start: 8, end: 21 }, 'link', {
    url: 'linkupbuild.com',
  });
  assert.equal(lnk.text, 'Try our [live product](https://linkupbuild.com/) today');

  const extracted = extractMarkdownLink('[live product](https://linkupbuild.com/)');
  assert.deepEqual(extracted, { label: 'live product', url: 'https://linkupbuild.com/' });
});

test('Interactive 16:9 cover crop math maps pan and zoom cleanly within image bounds', () => {
  const centered = computeCoverCropRect({
    imgW: 1000,
    imgH: 2000,
    stageW: 320,
    stageH: 180,
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  assert.equal(centered.originX, 0);
  assert.equal(centered.width, 1000);
  assert.equal(centered.height, 563);
  assert.ok(centered.originY > 600 && centered.originY < 800);

  const topFramed = computeCoverCropRect({
    imgW: 1000,
    imgH: 2000,
    stageW: 320,
    stageH: 180,
    zoom: 1,
    panX: 0,
    panY: 9999,
  });
  assert.equal(topFramed.originY, 0);
  assert.equal(topFramed.width, 1000);
  assert.equal(topFramed.height, 563);

  const zoomed = computeCoverCropRect({
    imgW: 1000,
    imgH: 2000,
    stageW: 320,
    stageH: 180,
    zoom: 2,
    panX: 0,
    panY: 0,
  });
  assert.equal(zoomed.width, 500);
  assert.equal(zoomed.height, 281);
  assert.equal(zoomed.originX, 250);
});

test('Blog block parser renders H1/H2/H3, quotes, bullet & numbered lists, code, underline, highlight, inline links, and blocks javascript: URLs', () => {
  const md = [
    '# Main Thesis',
    '## Scaling from Harare to the world',
    'We built **LINKUP** for *serious* ++builders++ with ==daily momentum==, ~~excuses~~, and `git push` — read our [launch playbook](https://www.linkupbuild.com/app/blogs) and avoid [bad](javascript:alert(1)).',
    '> Momentum beats perfection every single week.',
    '- Ship daily\n- Talk to users',
    '1. Pick problem\n2. Launch MVP',
    '---',
    '```\nconst shipped = true;\n```',
  ].join('\n\n');

  const blocks = parseBlogBlocks(md);
  assert.equal(blocks.length, 8);
  assert.equal(blocks[0].type, 'h1');
  assert.equal(blocks[1].type, 'h2');
  assert.equal(blocks[2].type, 'paragraph');
  assert.equal(blocks[3].type, 'quote');
  assert.equal(blocks[4].type, 'list');
  assert.equal(blocks[5].type, 'ordered');
  assert.equal(blocks[6].type, 'divider');
  assert.equal(blocks[7].type, 'codeblock');

  const linkSeg = blocks[2].segments.find((s) => s.type === 'link');
  assert.ok(linkSeg);
  assert.equal(linkSeg.text, 'launch playbook');
  assert.equal(linkSeg.url, 'https://www.linkupbuild.com/app/blogs');

  assert.equal(blocks[2].segments.some((s) => s.underline), true);
  assert.equal(blocks[2].segments.some((s) => s.highlight), true);
  assert.equal(blocks[2].segments.some((s) => s.strike), true);
  assert.equal(blocks[2].segments.some((s) => s.code), true);
  assert.equal(
    blocks[2].segments.some((s) => s.type === 'link' && s.url.startsWith('javascript:')),
    false
  );

  const excerpt = plainExcerptFromBlog(md, 110);
  assert.doesNotMatch(excerpt, /\*\*|##|\+\+|~~|==|```/);
  assert.ok(estimateReadTimeMinutes(md) >= 1);
});

test('Author-only Views & Clicks analytics: only the blog author sees views/clicks, self-views are ignored, and link clicks track breakdown', async () => {
  let clock = 1793640000000;
  const db = createMockDb({
    users: {
      author_alice: {
        displayName: 'Alice Founder',
        occupation: 'CEO at BuildCo',
        profilePicUrl: 'https://ik.imagekit.io/vjkzaxrro/alice.jpg',
        isVerified: true,
        onboarded: true,
      },
      reader_bob: {
        displayName: 'Bob Builder',
        occupation: 'Engineer',
        isVerified: false,
        onboarded: true,
      },
    },
  });

  const service = createBlogsService({ db, now: () => clock });
  const pub = await service.publish('author_alice', {
    title: 'How We Scaled Our AI Startup to 10k Builders',
    coverImage: 'https://ik.imagekit.io/vjkzaxrro/linkup-blogs/ai-scale.jpg',
    coverAlt: 'Alice Founder presenting 10k builder growth chart',
    readTimeMinutes: 5,
    categories: ['Startups', 'AI'],
    links: [{ label: 'Live Demo', url: 'https://www.linkupbuild.com' }],
    body: 'Read our [engineering architecture](https://github.com/example/arch) and ship daily.',
  });

  const blogId = pub.blog.id;
  assert.ok(pub.blog.authorStats, 'Author immediately receives authorStats on publish');
  assert.equal(pub.blog.authorStats.views, 0);
  assert.equal(pub.blog.seoUrl.includes(blogId), true);
  assert.equal(extractBlogIdFromSlug(canonicalBlogSlug(pub.blog.title, blogId)), blogId);

  // Author viewing/clicking their own blog must NOT inflate views or clicks
  const selfView = await service.track({ uid: 'author_alice' }, { blogId, event: 'view' });
  assert.equal(selfView.counted, false);
  assert.equal(selfView.self, true);

  // Reader Bob opens card, views article, and clicks inline + reference links
  await service.track({ uid: 'reader_bob' }, { blogId, event: 'card_click' });
  await service.track({ uid: 'reader_bob' }, { blogId, event: 'view' });
  // Duplicate view within 30 minutes is deduplicated
  await service.track({ uid: 'reader_bob' }, { blogId, event: 'view' });
  await service.track(
    { uid: 'reader_bob' },
    { blogId, event: 'link_click', url: 'https://github.com/example/arch', label: 'engineering architecture' }
  );
  await service.track(
    { uid: 'reader_bob' },
    { blogId, event: 'link_click', url: 'https://github.com/example/arch', label: 'engineering architecture' }
  );
  await service.track(
    { anonKey: '203.0.113.9|Mozilla|2026-11-03' },
    { blogId, event: 'view' }
  );

  // 35 minutes later Bob reads again -> views increments, uniqueViews stays 2
  clock += 35 * 60 * 1000;
  await service.track({ uid: 'reader_bob' }, { blogId, event: 'view' });

  // Anonymous & non-author readers NEVER see authorStats or raw internal counters
  const publicFeed = await service.list({ viewerUid: '' });
  assert.equal(publicFeed.blogs[0].authorStats, undefined);
  assert.equal('viewsCount' in publicFeed.blogs[0], false);
  assert.equal('viewerHashes' in publicFeed.blogs[0], false);

  const bobFeed = await service.list({ viewerUid: 'reader_bob' });
  assert.equal(bobFeed.blogs[0].authorStats, undefined);

  const bobSingle = await service.getById(blogId, { viewerUid: 'reader_bob' });
  assert.equal(bobSingle.authorStats, undefined);

  // Author Alice sees full views, unique readers, card clicks, link clicks & per-link breakdown!
  const aliceSingle = await service.getById(blogId, { viewerUid: 'author_alice' });
  assert.ok(aliceSingle.authorStats);
  assert.equal(aliceSingle.authorStats.views, 3);
  assert.equal(aliceSingle.authorStats.uniqueViews, 2);
  assert.equal(aliceSingle.authorStats.cardClicks, 1);
  assert.equal(aliceSingle.authorStats.linkClicks, 2);
  assert.equal(aliceSingle.authorStats.totalClicks, 3);
  assert.equal(aliceSingle.authorStats.linkBreakdown.length, 1);
  assert.equal(aliceSingle.authorStats.linkBreakdown[0].clicks, 2);
  assert.equal(aliceSingle.authorStats.linkBreakdown[0].label, 'engineering architecture');
});

test('Google Search, Google News & Super Picture SEO: SSR article, directory, Image Sitemap, Google News Sitemap & RSS feed', async () => {
  const nowMs = Date.parse('2026-11-03T12:00:00.000Z');
  const recentCreated = nowMs - 4 * 60 * 60 * 1000; // 4 hours ago -> inside 48h Google News window
  const olderCreated = nowMs - 96 * 60 * 60 * 1000; // 4 days ago -> in main blog sitemap, omitted from 48h Google News sitemap

  const db = createMockDb({
    users: {
      [GOLD_MEMBER_UID]: {
        displayName: 'Tanaka Prince',
        occupation: 'Founder at LINKUP',
        profilePicUrl: 'https://ik.imagekit.io/vjkzaxrro/tanaka.jpg',
        isVerified: true,
        onboarded: true,
        isVisible: true,
        email: 'private-never-leak@example.com',
      },
      banned_user: {
        displayName: 'Banned Writer',
        onboarded: true,
        banned: true,
      },
    },
    blogs: {
      b_fresh: {
        title: 'Why Africa Builders Are Shipping Global AI Companies',
        seoSlug: 'why-africa-builders-are-shipping-global-ai-companies--b_fresh',
        body: '## The New Wave\n\nFounders are building **AI-native** startups with [LINKUP](https://www.linkupbuild.com/app) every single day.',
        excerpt: 'Founders are building AI-native startups with LINKUP every single day.',
        coverImage: 'https://ik.imagekit.io/vjkzaxrro/linkup-blogs/africa-ai-cover.jpg',
        coverAlt: 'Founders collaborating on AI startups in Harare',
        readTimeMinutes: 5,
        categories: ['AI', 'Startups'],
        links: [{ label: 'LINKUP App', url: 'https://www.linkupbuild.com/app' }],
        authorId: GOLD_MEMBER_UID,
        status: 'published',
        deleted: false,
        viewsCount: 10,
        uniqueViews: 8,
        createdAt: recentCreated,
        updatedAt: recentCreated,
      },
      b_archive: {
        title: ' Lessons From 100 Cofounder Matches ',
        body: 'Deep lessons on cofounder alignment, equity splits, and shipping velocity across 100 teams.',
        coverImage: 'https://ik.imagekit.io/vjkzaxrro/linkup-blogs/cofounders.jpg',
        readTimeMinutes: 7,
        categories: ['Founder Stories'],
        links: [],
        authorId: GOLD_MEMBER_UID,
        status: 'published',
        deleted: false,
        createdAt: olderCreated,
        updatedAt: olderCreated,
      },
      b_banned: {
        title: 'Hidden Banned Post',
        body: 'Should never be indexed or rendered anywhere on public SEO.',
        authorId: 'banned_user',
        status: 'published',
        deleted: false,
        createdAt: recentCreated,
        updatedAt: recentCreated,
      },
    },
  });

  const handler = createPublicSeoHandler(() => db, async () => [], null, () => nowMs);

  // 1. SSR Single Blog Page (resolves pretty slug--id AND bare id, emits NewsArticle + BlogPosting + 16:9/4:3/1:1 ImageObjects)
  const articleRes = await callSeo(handler, {
    mode: 'blog',
    id: 'why-africa-builders-are-shipping-global-ai-companies--b_fresh',
  });
  assert.equal(articleRes.statusCode, 200);
  assert.match(articleRes.body, /max-image-preview:large/);
  assert.match(articleRes.body, /googlebot-news/);
  assert.match(articleRes.body, /property="og:type" content="article"/);
  assert.match(articleRes.body, /name="twitter:card" content="summary_large_image"/);
  assert.match(articleRes.body, /property="og:image:width" content="1280"/);
  assert.match(articleRes.body, /property="og:image:height" content="720"/);
  assert.match(articleRes.body, /Founders collaborating on AI startups in Harare/);
  // Multi-aspect-ratio ImageKit transforms for Google News & Google Discover (16:9, 4:3, 1:1)
  assert.match(articleRes.body, /tr:w-1280,h-720,fo-auto,q-88,f-auto\/linkup-blogs\/africa-ai-cover\.jpg/);
  assert.match(articleRes.body, /tr:w-1200,h-900,fo-auto,q-86,f-auto\/linkup-blogs\/africa-ai-cover\.jpg/);
  assert.match(articleRes.body, /tr:w-1200,h-1200,fo-auto,q-86,f-auto\/linkup-blogs\/africa-ai-cover\.jpg/);
  assert.match(articleRes.body, /"NewsArticle"/);
  assert.match(articleRes.body, /"BlogPosting"/);
  assert.match(articleRes.body, /"BreadcrumbList"/);
  assert.match(articleRes.body, /fetchpriority="high"/);
  assert.doesNotMatch(articleRes.body, /private-never-leak@example\.com|viewsCount|authorStats/);

  // Organic human browser visit incremented viewsCount from 10 -> 11, while Googlebot does NOT inflate it
  const snapAfterHuman = await db.collection('blogs').doc('b_fresh').get();
  assert.equal(snapAfterHuman.data().viewsCount, 11);

  await callSeo(
    handler,
    { mode: 'blog', id: 'b_fresh' },
    { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } }
  );
  const snapAfterBot = await db.collection('blogs').doc('b_fresh').get();
  assert.equal(snapAfterBot.data().viewsCount, 11);

  // Banned / deleted / missing blog returns 404 + noindex
  const bannedRes = await callSeo(handler, { mode: 'blog', id: 'b_banned' });
  assert.equal(bannedRes.statusCode, 404);
  assert.match(bannedRes.body, /noindex/);

  // 2. SSR Blogs Directory (/app/blogs)
  const dirRes = await callSeo(handler, { mode: 'blogs' });
  assert.equal(dirRes.statusCode, 200);
  assert.match(dirRes.body, /Founder, Startup &amp; Engineering Blogs/);
  assert.match(dirRes.body, /Why Africa Builders Are Shipping Global AI Companies/);
  assert.doesNotMatch(dirRes.body, /Hidden Banned Post/);

  // 3. Blog Image Sitemap (/app/sitemap-blogs-0.xml) includes ALL public blogs + <image:image> with title & caption
  const blogSitemap = await callSeo(handler, { mode: 'blog-sitemap', page: '0' });
  assert.equal(blogSitemap.statusCode, 200);
  assert.match(blogSitemap.body, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  assert.match(blogSitemap.body, /why-africa-builders-are-shipping-global-ai-companies--b_fresh/);
  assert.match(blogSitemap.body, /lessons-from-100-cofounder-matches--b_archive/);
  assert.match(blogSitemap.body, /<image:title>Why Africa Builders Are Shipping Global AI Companies<\/image:title>/);
  assert.match(blogSitemap.body, /<image:caption>Founders collaborating on AI startups in Harare<\/image:caption>/);
  assert.doesNotMatch(blogSitemap.body, /b_banned/);

  // 4. Official Google News Sitemap (/app/sitemap-google-news.xml) includes <48h blog with <news:news> + <image:image>
  const gnewsSitemap = await callSeo(handler, { mode: 'google-news-sitemap' });
  assert.equal(gnewsSitemap.statusCode, 200);
  assert.match(gnewsSitemap.body, /xmlns:news="http:\/\/www\.google\.com\/schemas\/sitemap-news\/0\.9"/);
  assert.match(gnewsSitemap.body, /<news:name>LINKUP<\/news:name>/);
  assert.match(gnewsSitemap.body, /why-africa-builders-are-shipping-global-ai-companies--b_fresh/);
  assert.doesNotMatch(gnewsSitemap.body, /b_archive/);

  // 5. RSS 2.0 + Media RSS Feed (/app/blogs/rss.xml)
  const rssRes = await callSeo(handler, { mode: 'blogs-rss' });
  assert.equal(rssRes.statusCode, 200);
  assert.match(rssRes.body, /<rss version="2\.0"/);
  assert.match(rssRes.body, /<media:content url="https:\/\/ik\.imagekit\.io\/vjkzaxrro\/tr:w-1280,h-720/);

  // 6. robots.txt + root sitemap index advertise Googlebot-News, Googlebot-Image, sitemap-google-news.xml & sitemap-blogs-0.xml
  const robotsRes = await callSeo(handler, { mode: 'robots' });
  assert.match(robotsRes.body, /Googlebot-News/);
  assert.match(robotsRes.body, /Googlebot-Image/);
  assert.match(robotsRes.body, /sitemap-google-news\.xml/);

  const rootSitemap = await callSeo(handler, { mode: 'sitemap' });
  assert.match(rootSitemap.body, /sitemap-google-news\.xml/);
  assert.match(rootSitemap.body, /sitemap-blogs-0\.xml/);
});

test('App navigation, 16:9 cover cropper, highlight-to-Insert-Link, and author analytics UI contracts are wired', () => {
  const appTsx = fs.readFileSync(new URL('../mobile/App.tsx', import.meta.url), 'utf8');
  assert.match(appTsx, /News:\s*'Blogs'/);
  assert.match(appTsx, /<Tab\.Screen name="News" component=\{BlogsScreen\} \/>/);

  const apiNews = fs.readFileSync(new URL('../api/news.js', import.meta.url), 'utf8');
  assert.doesNotMatch(apiNews, /newsapi\.org|_newsFeed/);
  assert.match(apiNews, /createBlogsService/);

  const blogsScreen = fs.readFileSync(
    new URL('../mobile/src/screens/BlogsScreen.tsx', import.meta.url),
    'utf8'
  );
  assert.match(blogsScreen, /Verified Author/);
  assert.match(blogsScreen, /Preview Before Publishing/);
  assert.match(blogsScreen, /BlogCoverCropModal/);
  assert.match(blogsScreen, /aspectRatio:\s*16\s*\/\s*9/);
  assert.match(blogsScreen, /Insert Link/);
  assert.match(blogsScreen, /lockedLinkRangeRef/);
  assert.match(blogsScreen, /Author Analytics \(Visible only to you\)/);
  assert.match(blogsScreen, /Only you see this/);
  assert.ok(defaultCoverAlt('AI Growth', 'Alice', ['AI']).includes('AI Growth'));
});
