import crypto from 'node:crypto';
import { id, clean, requireText, problem, validId } from './_builderCore.js';
import { containsCredential } from '../shared/contributions.js';
import { isGoldMember } from '../shared/member-badges.js';
import { selectProfileImage } from './_publicProfileImage.js';
import { APP, safeUrl } from './_publicSeo.js';
import {
  DEFAULT_BLOG_CATEGORIES,
  canonicalBlogSlug,
  defaultCoverAlt,
  estimateReadTimeMinutes,
  extractBlogIdFromSlug,
  plainExcerptFromBlog,
  sanitizeBlogUrl,
} from '../shared/blog-format.js';

function resolveAuthorAvatar(uid, userData = {}) {
  for (const key of ['profilePicUrl', 'photoURL', 'profilePic', 'avatarUrl']) {
    const candidate = userData?.[key];
    if (
      typeof candidate === 'string' &&
      candidate.startsWith('https://') &&
      candidate.length <= 2048
    ) {
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
    const label =
      clean(item.label || url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0], 80) ||
      'Read link';
    out.push({ label, url });
  }
  return out;
}

function normalizeLinkBreakdown(rawBreakdown) {
  if (!Array.isArray(rawBreakdown)) return [];
  return rawBreakdown
    .filter((entry) => entry && typeof entry === 'object' && sanitizeBlogUrl(entry.url))
    .map((entry) => ({
      url: sanitizeBlogUrl(entry.url),
      label: clean(entry.label || entry.url, 80) || 'Link',
      clicks: Math.max(0, Math.round(Number(entry.clicks) || 0)),
    }))
    .filter((entry) => entry.clicks > 0)
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 25);
}

function hashViewerIdentity(rawKey = '') {
  const s = String(rawKey || '').trim();
  if (!s) return '';
  return crypto.createHash('sha256').update(`linkup-blog-v1:${s}`).digest('hex').slice(0, 20);
}

export function createBlogsService({ db, now = Date.now, plus = async () => false }) {
  async function hydrateBlogs(docs, { viewerUid = '' } = {}) {
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
          publicProfile: data.onboarded === true && data.isVisible !== false && !data.isStealthMode,
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
      const categoriesRaw = (Array.isArray(item.categories) ? item.categories : [])
        .map(sanitizeCategory)
        .filter(Boolean)
        .slice(0, 6);
      const categories = categoriesRaw.length ? categoriesRaw : ['Startups'];
      for (const c of categories) {
        if (!defaultLower.has(c.toLowerCase())) customCategorySet.add(c);
      }
      const createdMs =
        typeof item.createdAt === 'number'
          ? item.createdAt
          : Number.isFinite(Date.parse(item.createdAt))
            ? Date.parse(item.createdAt)
            : 0;
      const updatedMs =
        typeof item.updatedAt === 'number'
          ? item.updatedAt
          : Number.isFinite(Date.parse(item.updatedAt))
            ? Date.parse(item.updatedAt)
            : createdMs;

      const title = clean(item.title, 140);
      const coverImage = sanitizeBlogUrl(item.coverImage || '');
      const coverAlt = clean(
        item.coverAlt || defaultCoverAlt(title, author.name, categories),
        180
      );
      const seoSlug = canonicalBlogSlug(title, item.id);
      const seoUrl = `${APP}/blogs/${encodeURIComponent(seoSlug)}`;

      const isOwnerOrAdmin = Boolean(
        viewerUid && (viewerUid === author.uid || isGoldMember(viewerUid))
      );

      const views = Math.max(0, Math.round(Number(item.viewsCount) || 0));
      const uniqueViews = Math.max(0, Math.round(Number(item.uniqueViews) || 0));
      const cardClicks = Math.max(0, Math.round(Number(item.cardClicks) || 0));
      const linkClicks = Math.max(0, Math.round(Number(item.linkClicks) || 0));

      blogs.push({
        id: item.id,
        title,
        body: String(item.body || '').slice(0, 25000),
        excerpt: clean(item.excerpt || plainExcerptFromBlog(item.body || '', 180), 220),
        coverImage,
        coverAlt,
        seoSlug,
        seoUrl,
        readTimeMinutes: Math.max(
          1,
          Math.min(60, Number(item.readTimeMinutes) || estimateReadTimeMinutes(item.body || ''))
        ),
        categories,
        links: sanitizeLinksList(item.links),
        authorId: author.uid,
        authorName: author.name,
        authorHeadline: author.headline,
        authorAvatar: author.avatar,
        authorVerified: author.verified,
        authorIsGold: author.isGold,
        authorPublicProfile: author.publicProfile,
        authorBadgeLabel: author.badgeLabel,
        createdAt: createdMs,
        publishedAt: createdMs ? new Date(createdMs).toISOString() : '',
        updatedAt: updatedMs ? new Date(updatedMs).toISOString() : '',
        ...(isOwnerOrAdmin
          ? {
              authorStats: {
                views,
                uniqueViews,
                cardClicks,
                linkClicks,
                totalClicks: cardClicks + linkClicks,
                linkBreakdown: normalizeLinkBreakdown(item.linkClickBreakdown),
              },
            }
          : {}),
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
    const viewerUid = validId(input.viewerUid) ? input.viewerUid : '';
    const snap = await db.collection('blogs').orderBy('createdAt', 'desc').limit(80).get();
    const { blogs, customCategories } = await hydrateBlogs(snap.docs, { viewerUid });
    const filtered =
      !categoryFilter || categoryFilter.toLowerCase() === 'all'
        ? blogs
        : blogs.filter((b) =>
            b.categories.some((c) => c.toLowerCase() === categoryFilter.toLowerCase())
          );

    return {
      blogs: filtered.slice(0, Math.min(60, Math.max(1, Number(input.limit) || 40))),
      defaultCategories: DEFAULT_BLOG_CATEGORIES,
      customCategories,
    };
  }

  async function getById(slugOrId, { viewerUid = '' } = {}) {
    const resolvedId = extractBlogIdFromSlug(slugOrId);
    if (!validId(resolvedId)) return null;
    const doc = await db.collection('blogs').doc(resolvedId).get();
    if (!doc.exists) return null;
    const { blogs } = await hydrateBlogs([doc], {
      viewerUid: validId(viewerUid) ? viewerUid : '',
    });
    return blogs[0] || null;
  }

  async function publish(uid, input = {}) {
    if (!validId(uid)) throw problem('Sign in to publish a blog.', 401);
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() || {} : null;
    if (!userData || userData.deleted || userData.banned || userData.onboarded !== true) {
      throw problem('Complete your profile before publishing a blog.', 403);
    }

    const title = requireText(input.title, 140, 4);
    const rawBody =
      typeof input.body === 'string' ? input.body.replace(/\r\n/g, '\n').trim() : '';
    if (rawBody.length < 15) {
      throw problem('Write at least 15 characters for the body of your blog.');
    }
    if (rawBody.length > 25000) {
      throw problem('Blog body must be 25,000 characters or fewer.');
    }

    const coverImage = input.coverImage ? sanitizeBlogUrl(input.coverImage) : '';
    if (input.coverImage && !coverImage) {
      throw problem('Use a valid HTTPS cover image URL or upload a cover photo.');
    }

    const rawCoverAlt = typeof input.coverAlt === 'string' ? clean(input.coverAlt, 180) : '';

    if (
      containsCredential(title) ||
      containsCredential(rawBody) ||
      containsCredential(coverImage) ||
      containsCredential(rawCoverAlt)
    ) {
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

    const authorName = clean(
      userData.displayName || userData.fullName || userData.name || 'LINKUP Member',
      100
    );
    const coverAlt = rawCoverAlt || defaultCoverAlt(title, authorName, categories);

    const requestedReadTime = Number(input.readTimeMinutes);
    const readTimeMinutes =
      Number.isFinite(requestedReadTime) && requestedReadTime >= 1 && requestedReadTime <= 60
        ? Math.round(requestedReadTime)
        : estimateReadTimeMinutes(rawBody);

    const links = sanitizeLinksList(input.links);
    const at = now();
    const blogId = `blog_${id()}`;
    const seoSlug = canonicalBlogSlug(title, blogId);

    const record = {
      title,
      seoSlug,
      body: rawBody,
      excerpt: plainExcerptFromBlog(rawBody, 180),
      coverImage,
      coverAlt,
      readTimeMinutes,
      categories,
      links,
      authorId: uid,
      status: 'published',
      deleted: false,
      viewsCount: 0,
      uniqueViews: 0,
      cardClicks: 0,
      linkClicks: 0,
      linkClickBreakdown: [],
      viewerHashes: [],
      recentViewBuckets: [],
      createdAt: at,
      updatedAt: at,
    };

    await db.collection('blogs').doc(blogId).set(record);
    const hydrated = await getById(blogId, { viewerUid: uid });
    return { ok: true, blog: hydrated };
  }

  /**
   * Records genuine views, card opens, and link clicks on a blog.
   * Self-views and self-clicks by the blog's own author are ignored so stats stay accurate.
   */
  async function track(actor = {}, input = {}) {
    const resolvedId = extractBlogIdFromSlug(input.blogId || input.id || '');
    if (!validId(resolvedId)) throw problem('Invalid blog identifier.', 400);

    const event = String(input.event || 'view').toLowerCase();
    if (!['view', 'card_click', 'link_click'].includes(event)) {
      throw problem('Unsupported blog analytics event.', 400);
    }

    const ref = db.collection('blogs').doc(resolvedId);
    const snap = await ref.get();
    if (!snap.exists) throw problem('Blog not found.', 404);
    const data = snap.data() || {};
    if (data.deleted || data.status !== 'published') throw problem('Blog not found.', 404);

    const viewerUid = validId(actor?.uid) ? actor.uid : '';
    if (viewerUid && viewerUid === data.authorId) {
      return { ok: true, counted: false, self: true, skippedSelf: true };
    }

    const identitySeed = viewerUid || String(actor?.anonKey || '').trim();
    const viewerHash = identitySeed ? hashViewerIdentity(identitySeed) : '';
    const bucket30m = Math.floor(now() / (30 * 60 * 1000));
    const bucketToken = viewerHash ? `${viewerHash}:${bucket30m}` : '';

    let viewsCount = Math.max(0, Math.round(Number(data.viewsCount) || 0));
    let uniqueViews = Math.max(0, Math.round(Number(data.uniqueViews) || 0));
    let cardClicks = Math.max(0, Math.round(Number(data.cardClicks) || 0));
    let linkClicks = Math.max(0, Math.round(Number(data.linkClicks) || 0));
    const viewerHashes = Array.isArray(data.viewerHashes) ? [...data.viewerHashes] : [];
    const recentBuckets = Array.isArray(data.recentViewBuckets)
      ? [...data.recentViewBuckets]
      : [];
    const breakdown = normalizeLinkBreakdown(data.linkClickBreakdown);

    let changed = false;

    if (event === 'view') {
      if (!bucketToken || !recentBuckets.includes(bucketToken)) {
        viewsCount += 1;
        changed = true;
        if (bucketToken) {
          recentBuckets.push(bucketToken);
          if (recentBuckets.length > 400) recentBuckets.splice(0, recentBuckets.length - 400);
        }
      }
      if (viewerHash && !viewerHashes.includes(viewerHash)) {
        uniqueViews += 1;
        changed = true;
        viewerHashes.push(viewerHash);
        if (viewerHashes.length > 600) viewerHashes.splice(0, viewerHashes.length - 600);
      } else if (!viewerHash && uniqueViews === 0 && viewsCount === 1) {
        uniqueViews = 1;
      }
    } else if (event === 'card_click') {
      const clickBucket = viewerHash ? `c:${viewerHash}:${bucket30m}` : '';
      if (!clickBucket || !recentBuckets.includes(clickBucket)) {
        cardClicks += 1;
        changed = true;
        if (clickBucket) {
          recentBuckets.push(clickBucket);
          if (recentBuckets.length > 400) recentBuckets.splice(0, recentBuckets.length - 400);
        }
      }
    } else if (event === 'link_click') {
      const targetUrl = sanitizeBlogUrl(input.url || '');
      if (!targetUrl) throw problem('Invalid tracked link URL.', 400);
      linkClicks += 1;
      changed = true;
      const label = clean(input.label || targetUrl, 80) || 'Link';
      const existing = breakdown.find((x) => x.url === targetUrl);
      if (existing) {
        existing.clicks += 1;
        if (label && existing.label === existing.url) existing.label = label;
      } else {
        breakdown.push({ url: targetUrl, label, clicks: 1 });
      }
      breakdown.sort((a, b) => b.clicks - a.clicks);
      if (breakdown.length > 25) breakdown.length = 25;
    }

    if (changed) {
      await ref.set(
        {
          ...data,
          viewsCount,
          uniqueViews,
          cardClicks,
          linkClicks,
          linkClickBreakdown: breakdown,
          viewerHashes,
          recentViewBuckets: recentBuckets,
        },
        { merge: true }
      );
    }

    return { ok: true };
  }

  async function remove(uid, input = {}) {
    if (!validId(uid)) throw problem('Sign in to delete your blog.', 401);
    const blogId = extractBlogIdFromSlug(input.blogId || input.id || '');
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

  return { list, getById, publish, track, remove };
}
