import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_BLOG_CATEGORIES,
  applyToolbarFormat,
  estimateReadTimeMinutes,
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
            const entries = [...ensure(col).entries()].map(([id, v]) => ({ id, v: structuredClone(v) }));
            entries.sort((a, b) =>
              dir === 'desc' ? (b.v?.[field] || 0) - (a.v?.[field] || 0) : (a.v?.[field] || 0) - (b.v?.[field] || 0)
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

test('Rich formatting toolbar handles Bold, Italic, H2, Quote, Bulleted List, and Links in words on selected text', () => {
  // Bold
  const b = applyToolbarFormat('Ship fast every week', { start: 5, end: 9 }, 'bold');
  assert.equal(b.text, 'Ship **fast** every week');
  // Unwrap bold when selected with markers
  const bOff = applyToolbarFormat(b.text, { start: 5, end: 13 }, 'bold');
  assert.equal(bOff.text, 'Ship fast every week');

  // Italic
  const it = applyToolbarFormat('Real founder lessons', { start: 5, end: 12 }, 'italic');
  assert.equal(it.text, 'Real *founder* lessons');

  // H2 Sub-heading
  const h2 = applyToolbarFormat('Intro line\nWhy we pivoted\nClosing', { start: 11, end: 25 }, 'h2');
  assert.equal(h2.text, 'Intro line\n## Why we pivoted\nClosing');

  // Blockquote
  const qt = applyToolbarFormat('Customers pay for outcomes, not roadmaps.', { start: 0, end: 41 }, 'quote');
  assert.equal(qt.text, '> Customers pay for outcomes, not roadmaps.');

  // Bulleted list
  const lst = applyToolbarFormat('First step\nSecond step', { start: 0, end: 22 }, 'list');
  assert.equal(lst.text, '- First step\n- Second step');

  // Link in words
  const lnk = applyToolbarFormat('Try our live product today', { start: 8, end: 20 }, 'link', {
    url: 'https://www.linkupbuild.com',
  });
  assert.equal(lnk.text, 'Try our [live product](https://www.linkupbuild.com/) today');
});

test('Blog block parser renders H2, quotes, bullet lists, inline links in words, and blocks javascript: URLs', () => {
  const md = [
    '## Scaling from Harare to the world',
    'We built **LINKUP** for *serious* builders — read our [launch playbook](https://www.linkupbuild.com/app/blogs) and avoid [bad](javascript:alert(1)).',
    '> Momentum beats perfection every single week.',
    '- Ship daily\n- Talk to users',
  ].join('\n\n');

  const blocks = parseBlogBlocks(md);
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].type, 'h2');
  assert.equal(blocks[1].type, 'paragraph');
  assert.equal(blocks[2].type, 'quote');
  assert.equal(blocks[3].type, 'list');
  assert.equal(blocks[3].items.length, 2);

  const linkSeg = blocks[1].segments.find((s) => s.type === 'link');
  assert.ok(linkSeg);
  assert.equal(linkSeg.text, 'launch playbook');
  assert.equal(linkSeg.url, 'https://www.linkupbuild.com/app/blogs');

  // javascript: URL is stripped down to plain text, never a clickable link
  assert.equal(blocks[1].segments.some((s) => s.type === 'link' && s.url.startsWith('javascript:')), false);

  const excerpt = plainExcerptFromBlog(md, 90);
  assert.doesNotMatch(excerpt, /\*\*|##|^>/);
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

  // Everyone sees both blogs + the custom category 'Venture Factory'
  const feed = await service.list();
  assert.equal(feed.blogs.length, 2);
  assert.ok(feed.customCategories.includes('Venture Factory'));

  // Non-author cannot delete someone else's blog
  await assert.rejects(
    () => service.remove('unverified_writer', { blogId: pub1.blog.id }),
    /only delete blogs that you wrote/
  );

  // Author can delete their own blog and it disappears for everyone
  const deleted = await service.remove('unverified_writer', { blogId: pub2.blog.id });
  assert.equal(deleted.ok, true);
  const afterFeed = await service.list();
  assert.equal(afterFeed.blogs.length, 1);
  assert.equal(afterFeed.blogs[0].id, pub1.blog.id);
});

test('App navigation renames News to Blogs and mounts BlogsScreen with all external news removed from /api/news', () => {
  const appTsx = fs.readFileSync(new URL('../mobile/App.tsx', import.meta.url), 'utf8');
  assert.match(appTsx, /News:\s*'Blogs'/);
  assert.match(appTsx, /<Tab\.Screen name="News" component=\{BlogsScreen\} \/>/);

  const apiNews = fs.readFileSync(new URL('../api/news.js', import.meta.url), 'utf8');
  assert.doesNotMatch(apiNews, /newsapi\.org|_newsFeed/);
  assert.match(apiNews, /createBlogsService/);

  const blogsScreen = fs.readFileSync(new URL('../mobile/src/screens/BlogsScreen.tsx', import.meta.url), 'utf8');
  assert.match(blogsScreen, /Verified Author/);
  assert.match(blogsScreen, /Preview Before Publishing/);
});
