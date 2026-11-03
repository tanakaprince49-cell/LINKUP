import { id, clean, requireText, problem, validId } from './_builderCore.js';
import { containsCredential } from '../shared/contributions.js';
import { isGoldMember } from '../shared/member-badges.js';
import { selectProfileImage } from './_publicProfileImage.js';
import { safeUrl } from './_publicSeo.js';
import {
  DEFAULT_BLOG_CATEGORIES,
  sanitizeBlogUrl,
  estimateReadTimeMinutes,
  plainExcerptFromBlog,
} from '../shared/blog-format.js';

function resolveAuthorAvatar(uid, userData = {}) {
  for (const key of ['profilePicUrl', 'photoURL', 'profilePic', 'avatarUrl']) {
    const candidate = userData?.[key];
    if (typeof candidate === 'string' && candidate.startsWith('https://') && candidate.length <= 2048) {
      const checked = sanitizeBlogUrl(candidate);
      if (checked) return checked;
    }
  }
  try {
    const selected = selectProfileImage(uid, userData, safeUrl);
    if (selected?.url) return selected.url;
  } catch {}
  return '';
}

function sanitizeCategory(raw = '') {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
}

function sanitizeLinksList(rawLinks) {
  if (!Array.isArray(rawLinks)) return [];
  const out = [];
  for (const item of rawLinks.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const url = sanitizeBlogUrl(item.url);
    if (!url) continue;
    const label = clean(item.label || url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0], 80) || 'Read link';
    out.push({ label, url });
  }
  return out;
}

export function createBlogsService({ db, now = Date.now, plus = async () => false }) {
  async function hydrateBlogs(docs) {
    if (!docs.length) return { blogs: [], customCategories: [] };
    const rawItems = docs
      .map((d) => (d.exists ? { id: d.id, ...d.data() } : null))
      .filter((b) => b && !b.deleted && b.status === 'published' && validId(b.authorId));

    if (!rawItems.length) return { blogs: [], customCategories: [] };

    const authorIds = [...new Set(rawItems.map((b) => b.authorId))];
    const authorDocs = await db.getAll(...authorIds.map((uid) => db.collection('users').doc(uid)));
    const authorMap = new Map();

    await Promise.all(
      authorDocs.map(async (uDoc) => {
        if (!uDoc.exists) return;
        const data = uDoc.data() || {};
        if (data.deleted || data.banned) return;
        const gold = isGoldMember(uDoc.id);
        let plusVerified = false;
        try {
          plusVerified = await plus(uDoc.id, data);
        } catch {
          plusVerified = false;
        }
        const verified = gold || data.isVerified === true || plusVerified;
        authorMap.set(uDoc.id, {
          uid: uDoc.id,
          name: clean(data.displayName || data.fullName || data.name || 'LINKUP Member', 100),
          headline: clean(data.occupation || data.company || '', 120),
          avatar: resolveAuthorAvatar(uDoc.id, data),
          verified,
          isGold: gold,
          badgeLabel: verified ? 'Verified Author' : '',
        });
      })
    );

    const customCategorySet = new Set();
    const defaultLower = new Set(DEFAULT_BLOG_CATEGORIES.map((c) => c.toLowerCase()));
    const blogs = [];

    for (const item of rawItems) {
      const author = authorMap.get(item.authorId);
      if (!author) continue;
      const categories = (Array.isArray(item.categories) ? item.categories : [])
        .map(sanitizeCategory)
        .filter(Boolean)
        .slice(0, 6);
      for (const c of categories) {
        if (!defaultLower.has(c.toLowerCase())) customCategorySet.add(c);
      }
      const createdMs =
        typeof item.createdAt === 'number'
          ? item.createdAt
          : Number.isFinite(Date.parse(item.createdAt))
            ? Date.parse(item.createdAt)
            : 0;

      blogs.push({
        id: item.id,
        title: clean(item.title, 140),
        body: String(item.body || '').slice(0, 25000),
        excerpt: clean(item.excerpt || plainExcerptFromBlog(item.body || '', 180), 220),
        coverImage: sanitizeBlogUrl(item.coverImage || ''),
        readTimeMinutes: Math.max(1, Math.min(60, Number(item.readTimeMinutes) || estimateReadTimeMinutes(item.body || ''))),
        categories: categories.length ? categories : ['Startups'],
        links: sanitizeLinksList(item.links),
        authorId: author.uid,
        authorName: author.name,
        authorHeadline: author.headline,
        authorAvatar: author.avatar,
        authorVerified: author.verified,
        authorIsGold: author.isGold,
        authorBadgeLabel: author.badgeLabel,
        createdAt: createdMs,
        publishedAt: createdMs ? new Date(createdMs).toISOString() : '',
      });
    }

    blogs.sort((a, b) => b.createdAt - a.createdAt);
    return {
      blogs,
      customCategories: [...customCategorySet].slice(0, 24),
    };
  }

  async function list(input = {}) {
    const categoryFilter = sanitizeCategory(input.category || '');
    const snap = await db.collection('blogs').orderBy('createdAt', 'desc').limit(80).get();
    const { blogs, customCategories } = await hydrateBlogs(snap.docs);
    const filtered =
      !categoryFilter || categoryFilter.toLowerCase() === 'all'
        ? blogs
        : blogs.filter((b) => b.categories.some((c) => c.toLowerCase() === categoryFilter.toLowerCase()));

    return {
      blogs: filtered.slice(0, Math.min(60, Math.max(1, Number(input.limit) || 40))),
      defaultCategories: DEFAULT_BLOG_CATEGORIES,
      customCategories,
    };
  }

  async function getById(blogId) {
    if (!validId(blogId)) return null;
    const doc = await db.collection('blogs').doc(blogId).get();
    if (!doc.exists) return null;
    const { blogs } = await hydrateBlogs([doc]);
    return blogs[0] || null;
  }

  async function publish(uid, input = {}) {
    if (!validId(uid)) throw problem('Sign in to publish a blog.', 401);
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data()?.deleted || userDoc.data()?.banned || userDoc.data()?.onboarded !== true) {
      throw problem('Complete your profile before publishing a blog.', 403);
    }

    const title = requireText(input.title, 140, 4);
    const rawBody = typeof input.body === 'string' ? input.body.replace(/\r\n/g, '\n').trim() : '';
    if (rawBody.length < 15) throw problem('Write at least 15 characters for the body of your blog.');
    if (rawBody.length > 25000) throw problem('Blog body must be 25,000 characters or fewer.');

    const coverImage = input.coverImage ? sanitizeBlogUrl(input.coverImage) : '';
    if (input.coverImage && !coverImage) {
      throw problem('Use a valid HTTPS cover image URL or upload a cover photo.');
    }

    if (containsCredential(title) || containsCredential(rawBody) || containsCredential(coverImage)) {
      throw problem('Remove API keys, tokens, or passwords before publishing.');
    }

    const rawCategories = Array.isArray(input.categories)
      ? input.categories
      : typeof input.categories === 'string'
        ? input.categories.split(',')
        : [];
    const seenCat = new Set();
    const categories = [];
    for (const rawCat of rawCategories) {
      const cat = sanitizeCategory(rawCat);
      if (!cat) continue;
      const key = cat.toLowerCase();
      if (seenCat.has(key)) continue;
      seenCat.add(key);
      categories.push(cat);
      if (categories.length >= 6) break;
    }
    if (!categories.length) categories.push('Startups');

    const requestedReadTime = Number(input.readTimeMinutes);
    const readTimeMinutes =
      Number.isFinite(requestedReadTime) && requestedReadTime >= 1 && requestedReadTime <= 60
        ? Math.round(requestedReadTime)
        : estimateReadTimeMinutes(rawBody);

    const links = sanitizeLinksList(input.links);
    const at = now();
    const blogId = `blog_${id()}`;

    const record = {
      title,
      body: rawBody,
      excerpt: plainExcerptFromBlog(rawBody, 180),
      coverImage,
      readTimeMinutes,
      categories,
      links,
      authorId: uid,
      status: 'published',
      deleted: false,
      createdAt: at,
      updatedAt: at,
    };

    await db.collection('blogs').doc(blogId).set(record);
    const hydrated = await getById(blogId);
    return { ok: true, blog: hydrated };
  }

  async function remove(uid, input = {}) {
    if (!validId(uid)) throw problem('Sign in to delete your blog.', 401);
    const blogId = clean(input.blogId || input.id || '', 128);
    if (!validId(blogId)) throw problem('Invalid blog identifier.', 400);

    const [blogDoc, actorDoc] = await Promise.all([
      db.collection('blogs').doc(blogId).get(),
      db.collection('users').doc(uid).get(),
    ]);
    if (!blogDoc.exists) throw problem('Blog not found.', 404);
    const isAdmin = actorDoc.exists && (actorDoc.data()?.isAdmin === true || isGoldMember(uid));
    if (blogDoc.data()?.authorId !== uid && !isAdmin) {
      throw problem('You can only delete blogs that you wrote.', 403);
    }

    await db.collection('blogs').doc(blogId).delete();
    return { ok: true, deletedId: blogId };
  }

  return { list, getById, publish, remove };
}
