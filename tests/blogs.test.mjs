import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_BLOG_CATEGORIES,
  applyToolbarFormat,
  computeCoverCropRect,
  estimateReadTimeMinutes,
  extractMarkdownLink,
  parseBlogBlocks,
  plainExcerptFromBlog,
} from '../shared/blog-format.js';
import { createBlogsService } from '../api/_blogs.js';
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
    set: async (data) => {
      ensure(col).set(id, structuredClone(data));
    },
    delete: async () => {
      ensure(col).delete(id);
    },
  });
  return {
    collection: (col) => ({
      doc: (id) => docRef(col, id),
      orderBy: (field, dir = 'asc') => ({
        limit: (n) => ({
          get: async () => {
            const entries = [...ensure(col).entries()].map(([id, v]) => ({
              id,
              v: structuredClone(v),
            }));
            entries.sort((a, b) =>
              dir === 'desc'
                ? (b.v?.[field] || 0) - (a.v?.[field] || 0)
                : (a.v?.[field] || 0) - (b.v?.[field] || 0)
            );
            return {
              docs: entries.slice(0, n).map((e) => ({
                id: e.id,
                exists: true,
                data: () => structuredClone(e.v),
              })),
            };
          },
        }),
      }),
    }),
    getAll: async (...refs) => Promise.all(refs.filter(Boolean).map((r) => r.get())),
  };
}

test('Highlighting a word supports Insert Link (with space & edit safety) plus full rich formatting options', () => {
  // Bold + smart toggle while inner word stays highlighted
  const b = applyToolbarFormat('Ship fast every week', { start: 5, end: 9 }, 'bold');
  assert.equal(b.text, 'Ship **fast** every week');
  assert.deepEqual(b.selection, { start: 7, end: 11 });
  const bToggleInner = applyToolbarFormat(b.text, b.selection, 'bold');
  assert.equal(bToggleInner.text, 'Ship fast every week');

  // Italic + Underline + Strikethrough + Highlight + Inline Code
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

  // H1, H2, H3, Quote, Bulleted List, Numbered List, Divider, Code Block
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

  // Highlighting a word (even with accidental trailing space) and inserting a link
  const lnk = applyToolbarFormat('Try our live product today', { start: 8, end: 21 }, 'link', {
    url: 'linkupbuild.com',
  });
  assert.equal(lnk.text, 'Try our [live product](https://linkupbuild.com/) today');

  // Re-highlighting an existing markdown link extracts label + URL and updates cleanly
  const extracted = extractMarkdownLink('[live product](https://linkupbuild.com/)');
  assert.deepEqual(extracted, { label: 'live product', url: 'https://linkupbuild.com/' });
});

test('Interactive 16:9 cover crop math maps pan and zoom cleanly within image bounds', () => {
  // Portrait 1000x2000 image in a 320x180 (16:9) stage
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

  // Dragging image all the way down brings top of portrait (originY = 0) into frame
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

  // 2x zoom cuts crop window in half while staying strictly inside bounds
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

  // javascript: URL is stripped down to plain text, never a clickable link
  assert.equal(
    blocks[2].segments.some((s) => s.type === 'link' && s.url.startsWith('javascript:')),
    false
  );

  const excerpt = plainExcerptFromBlog(md, 110);
  assert.doesNotMatch(excerpt, /\*\*|##|\+\+|~~|==|```/);
  assert.ok(estimateReadTimeMinutes(md) >= 1);
});

test('Community Blogs service supports cover page, read time, default + custom categories, Verified Author badge, and author-only deletion', async () => {
  const db = createMockDb({
    users: {
      [GOLD_MEMBER_UID]: {
        displayName: 'Tanaka Prince',
        occupation: 'Founder at LINKUP',
        profilePicUrl: 'https://ik.imagekit.io/vjkzaxrro/tanaka.jpg',
        isVerified: true,
        onboarded: true,
      },
      unverified_writer: {
        displayName: 'Tendai Builder',
        occupation: 'Product Engineer',
        profilePicUrl: 'https://ik.imagekit.io/vjkzaxrro/tendai.jpg',
        isVerified: false,
        onboarded: true,
      },
    },
  });

  const service = createBlogsService({ db, now: () => 1793640000000 });
  assert.ok(DEFAULT_BLOG_CATEGORIES.length >= 6);

  const pub1 = await service.publish(GOLD_MEMBER_UID, {
    title: 'How We Turned LINKUP Into a Company-Building Engine',
    coverImage: 'https://ik.imagekit.io/vjkzaxrro/cover-engine.jpg',
    readTimeMinutes: 6,
    categories: ['Startups', 'Venture Factory'],
    links: [{ label: 'LINKUP', url: 'https://www.linkupbuild.com' }],
    body: '## Why we evolved\n\nBuilders need **execution** and [verified collaborators](https://www.linkupbuild.com/app).',
  });

  assert.equal(pub1.ok, true);
  assert.equal(pub1.blog.readTimeMinutes, 6);
  assert.equal(pub1.blog.coverImage, 'https://ik.imagekit.io/vjkzaxrro/cover-engine.jpg');
  assert.deepEqual(pub1.blog.categories, ['Startups', 'Venture Factory']);
  assert.equal(pub1.blog.authorName, 'Tanaka Prince');
  assert.equal(pub1.blog.authorAvatar, 'https://ik.imagekit.io/vjkzaxrro/tanaka.jpg');
  assert.equal(pub1.blog.authorVerified, true);
  assert.equal(pub1.blog.authorBadgeLabel, 'Verified Author');

  const pub2 = await service.publish('unverified_writer', {
    title: 'Notes From Our First 10 Customer Calls',
    readTimeMinutes: 4,
    categories: ['Founder Stories'],
    body: 'Real notes from talking to ten customers in a single week before writing code.',
  });
  assert.equal(pub2.blog.authorVerified, false);
  assert.equal(pub2.blog.authorBadgeLabel, '');

  const feed = await service.list();
  assert.equal(feed.blogs.length, 2);
  assert.ok(feed.customCategories.includes('Venture Factory'));

  await assert.rejects(
    () => service.remove('unverified_writer', { blogId: pub1.blog.id }),
    /only delete blogs that you wrote/
  );

  const deleted = await service.remove('unverified_writer', { blogId: pub2.blog.id });
  assert.equal(deleted.ok, true);
  const afterFeed = await service.list();
  assert.equal(afterFeed.blogs.length, 1);
  assert.equal(afterFeed.blogs[0].id, pub1.blog.id);
});

test('App navigation, 16:9 cover cropper, and highlight-to-Insert-Link UI contracts are wired', () => {
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
});
