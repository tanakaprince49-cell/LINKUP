import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Image as RNImage, Platform } from 'react-native';
import { auth } from './firebase';
import { linkupWebBaseUrl } from './profileLinks';
import { webAppPath } from './webPaths';
import { uploadImageToImageKit } from './imagekitUpload';
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
  sanitizeBlogUrl,
  slugifyBlogTitle,
} from '../../../shared/blog-format.js';

export {
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
  sanitizeBlogUrl,
  slugifyBlogTitle,
};

export type BlogLink = {
  label: string;
  url: string;
};

export type AuthorBlogStats = {
  views: number;
  uniqueViews: number;
  cardClicks: number;
  linkClicks: number;
  totalClicks: number;
  linkBreakdown: Array<{ url: string; label: string; clicks: number }>;
};

export type CommunityBlog = {
  id: string;
  title: string;
  body: string;
  excerpt: string;
  coverImage: string;
  coverAlt?: string;
  seoSlug?: string;
  seoUrl?: string;
  readTimeMinutes: number;
  categories: string[];
  links: BlogLink[];
  authorId: string;
  authorName: string;
  authorHeadline: string;
  authorAvatar: string;
  authorVerified: boolean;
  authorIsGold?: boolean;
  authorBadgeLabel: string;
  createdAt: number;
  publishedAt: string;
  updatedAt?: string;
  authorStats?: AuthorBlogStats;
};

export type BlogsFeedResponse = {
  blogs: CommunityBlog[];
  defaultCategories: string[];
  customCategories: string[];
};

export type RawCoverAsset = {
  uri: string;
  dataUri: string;
  width: number;
  height: number;
  mimeType: string;
};

function blogsApiUrl(query = '') {
  const path = `/api/news${query ? `?${query}` : ''}`;
  if (Platform.OS === 'web') {
    return webAppPath(path);
  }
  return `${linkupWebBaseUrl()}${path}`;
}

async function optionalAuthHeaders(): Promise<Record<string, string>> {
  try {
    const token = await auth.currentUser?.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export async function fetchCommunityBlogs(category = ''): Promise<BlogsFeedResponse> {
  const qs = category && category !== 'All' ? new URLSearchParams({ category }).toString() : '';
  const authHeaders = await optionalAuthHeaders();
  const res = await fetch(blogsApiUrl(qs), {
    headers: { Accept: 'application/json', ...authHeaders },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    throw new Error(json?.error || 'Could not load blogs right now.');
  }
  return {
    blogs: Array.isArray(json.blogs) ? json.blogs : [],
    defaultCategories: Array.isArray(json.defaultCategories)
      ? json.defaultCategories
      : DEFAULT_BLOG_CATEGORIES,
    customCategories: Array.isArray(json.customCategories) ? json.customCategories : [],
  };
}

export async function fetchCommunityBlogById(blogId: string): Promise<CommunityBlog | null> {
  if (!blogId) return null;
  const qs = new URLSearchParams({ id: blogId }).toString();
  const authHeaders = await optionalAuthHeaders();
  const res = await fetch(blogsApiUrl(qs), {
    headers: { Accept: 'application/json', ...authHeaders },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.blog) return null;
  return json.blog as CommunityBlog;
}

export async function trackCommunityBlogEvent(
  blogId: string,
  event: 'view' | 'card_click' | 'link_click',
  extra?: { url?: string; label?: string }
): Promise<void> {
  if (!blogId) return;
  try {
    const authHeaders = await optionalAuthHeaders();
    await fetch(blogsApiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        action: 'track',
        blogId,
        event,
        ...(extra?.url ? { url: extra.url } : {}),
        ...(extra?.label ? { label: extra.label } : {}),
      }),
    });
  } catch {
    // Non-blocking telemetry
  }
}

export async function publishCommunityBlog(input: {
  title: string;
  body: string;
  coverImage?: string;
  coverAlt?: string;
  readTimeMinutes: number;
  categories: string[];
  links?: BlogLink[];
}): Promise<CommunityBlog> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sign in to publish your blog.');
  const res = await fetch(blogsApiUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 'publish', ...input }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.blog) {
    throw new Error(json?.error || 'Could not publish blog.');
  }
  return json.blog as CommunityBlog;
}

export async function deleteCommunityBlog(blogId: string): Promise<void> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sign in to delete your blog.');
  const res = await fetch(blogsApiUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 'delete', blogId }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error || 'Could not delete blog.');
  }
}

function measureImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    RNImage.getSize(
      uri,
      (width, height) => resolve({ width: width || 1280, height: height || 720 }),
      () => resolve({ width: 1280, height: 720 })
    );
  });
}

export async function pickRawBlogCoverImage(): Promise<RawCoverAsset | null> {
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Allow photo access to select a blog cover image.');
    }
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 0.9,
    base64: true,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;

  const mimeType = asset.mimeType || 'image/jpeg';
  const dataUri = asset.base64
    ? `data:${mimeType};base64,${asset.base64}`
    : asset.uri?.startsWith('data:')
      ? asset.uri
      : '';
  const sourceUri = dataUri || asset.uri;
  if (!sourceUri) {
    throw new Error('Could not read this image. Please pick another photo.');
  }
  if (asset.base64 && asset.base64.length > 10_000_000) {
    throw new Error('Choose a cover image smaller than 7 MB.');
  }

  let width = Number(asset.width) || 0;
  let height = Number(asset.height) || 0;
  if (!width || !height) {
    const measured = await measureImageDimensions(sourceUri);
    width = measured.width;
    height = measured.height;
  }

  return {
    uri: asset.uri || sourceUri,
    dataUri: dataUri || sourceUri,
    width,
    height,
    mimeType,
  };
}

async function renderWebCanvasCover(
  sourceUri: string,
  options: {
    mode: 'fill' | 'fit';
    stageW: number;
    stageH: number;
    zoom: number;
    panX: number;
    panY: number;
  }
): Promise<string> {
  const doc = (globalThis as any).document;
  const WinImage = (globalThis as any).Image;
  if (!doc || !WinImage) {
    throw new Error('Browser canvas unavailable.');
  }

  const img: any = await new Promise((resolve, reject) => {
    const el = new WinImage();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not decode selected cover image.'));
    el.src = sourceUri;
  });

  const outW = 1280;
  const outH = 720;
  const canvas = doc.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not initialize image cropper.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const natW = img.naturalWidth || img.width || 1280;
  const natH = img.naturalHeight || img.height || 720;

  if (options.mode === 'fit') {
    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, outW, outH);
    try {
      ctx.save();
      ctx.filter = 'blur(28px) brightness(0.42)';
      const bgScale = Math.max(outW / natW, outH / natH) * 1.08;
      const bgW = natW * bgScale;
      const bgH = natH * bgScale;
      ctx.drawImage(img, (outW - bgW) / 2, (outH - bgH) / 2, bgW, bgH);
      ctx.restore();
    } catch {}
    const fitScale = Math.min(outW / natW, outH / natH);
    const drawW = Math.round(natW * fitScale);
    const drawH = Math.round(natH * fitScale);
    const dx = Math.round((outW - drawW) / 2);
    const dy = Math.round((outH - drawH) / 2);
    ctx.drawImage(img, 0, 0, natW, natH, dx, dy, drawW, drawH);
  } else {
    const rect = computeCoverCropRect({
      imgW: natW,
      imgH: natH,
      stageW: options.stageW,
      stageH: options.stageH,
      zoom: options.zoom,
      panX: options.panX,
      panY: options.panY,
    });
    ctx.drawImage(
      img,
      rect.originX,
      rect.originY,
      rect.width,
      rect.height,
      0,
      0,
      outW,
      outH
    );
  }

  return canvas.toDataURL('image/jpeg', 0.86);
}

export async function cropAndUploadBlogCover(
  uid: string,
  rawAsset: RawCoverAsset,
  options: {
    mode: 'fill' | 'fit';
    stageW: number;
    stageH: number;
    zoom: number;
    panX: number;
    panY: number;
  }
): Promise<string> {
  let finalDataUri = '';

  if (Platform.OS === 'web') {
    finalDataUri = await renderWebCanvasCover(rawAsset.dataUri || rawAsset.uri, options);
  } else if (options.mode === 'fit') {
    const resized = await manipulateAsync(
      rawAsset.uri,
      [{ resize: { width: Math.min(1280, rawAsset.width || 1280) } }],
      { compress: 0.85, format: SaveFormat.JPEG, base64: true }
    );
    if (!resized.base64) {
      throw new Error('Could not prepare cover image.');
    }
    const uploaded = await uploadImageToImageKit(
      uid,
      `data:image/jpeg;base64,${resized.base64}`,
      {
        folder: '/linkup-blogs',
        fileName: `blog-cover-${Date.now()}.jpg`,
        useUniqueFileName: true,
      }
    );
    if (!uploaded) {
      throw new Error('Cover upload could not complete. Try again or paste an HTTPS image URL.');
    }
    const ikBase = 'https://ik.imagekit.io/vjkzaxrro/';
    if (uploaded.startsWith(ikBase) && !uploaded.includes('/tr:')) {
      return `${ikBase}tr:w-1280,h-720,cm-pad_resize,bg-111318,q-86,f-auto/${uploaded.slice(ikBase.length)}`;
    }
    return uploaded;
  } else {
    const rect = computeCoverCropRect({
      imgW: rawAsset.width,
      imgH: rawAsset.height,
      stageW: options.stageW,
      stageH: options.stageH,
      zoom: options.zoom,
      panX: options.panX,
      panY: options.panY,
    });
    const cropped = await manipulateAsync(
      rawAsset.uri,
      [
        {
          crop: {
            originX: rect.originX,
            originY: rect.originY,
            width: rect.width,
            height: rect.height,
          },
        },
        { resize: { width: 1280, height: 720 } },
      ],
      { compress: 0.85, format: SaveFormat.JPEG, base64: true }
    );
    if (!cropped.base64) {
      throw new Error('Could not crop this image. Please try another photo.');
    }
    finalDataUri = `data:image/jpeg;base64,${cropped.base64}`;
  }

  const hostedUrl = await uploadImageToImageKit(uid, finalDataUri, {
    folder: '/linkup-blogs',
    fileName: `blog-cover-${Date.now()}.jpg`,
    useUniqueFileName: true,
  });
  if (!hostedUrl) {
    throw new Error('Cover upload could not complete. Try again or paste an HTTPS image URL.');
  }
  return hostedUrl;
}

export async function pickAndUploadBlogCover(uid: string): Promise<string | null> {
  const raw = await pickRawBlogCoverImage();
  if (!raw) return null;
  return cropAndUploadBlogCover(uid, raw, {
    mode: 'fill',
    stageW: 320,
    stageH: 180,
    zoom: 1,
    panX: 0,
    panY: 0,
  });
}
