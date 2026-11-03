import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { auth } from './firebase';
import { linkupWebBaseUrl } from './profileLinks';
import { webAppPath } from './webPaths';
import { uploadImageToImageKit } from './imagekitUpload';
import {
  DEFAULT_BLOG_CATEGORIES,
  applyToolbarFormat,
  estimateReadTimeMinutes,
  parseBlogBlocks,
  plainExcerptFromBlog,
  sanitizeBlogUrl,
} from '../../../shared/blog-format.js';

export {
  DEFAULT_BLOG_CATEGORIES,
  applyToolbarFormat,
  estimateReadTimeMinutes,
  parseBlogBlocks,
  plainExcerptFromBlog,
  sanitizeBlogUrl,
};

export type BlogLink = {
  label: string;
  url: string;
};

export type CommunityBlog = {
  id: string;
  title: string;
  body: string;
  excerpt: string;
  coverImage: string;
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
};

export type BlogsFeedResponse = {
  blogs: CommunityBlog[];
  defaultCategories: string[];
  customCategories: string[];
};

function blogsApiUrl(query = '') {
  const path = `/api/news${query ? `?${query}` : ''}`;
  if (Platform.OS === 'web') {
    return webAppPath(path);
  }
  return `${linkupWebBaseUrl()}${path}`;
}

export async function fetchCommunityBlogs(category = ''): Promise<BlogsFeedResponse> {
  const qs = category && category !== 'All' ? new URLSearchParams({ category }).toString() : '';
  const res = await fetch(blogsApiUrl(qs), { headers: { Accept: 'application/json' } });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    throw new Error(json?.error || 'Could not load blogs right now.');
  }
  return {
    blogs: Array.isArray(json.blogs) ? json.blogs : [],
    defaultCategories: Array.isArray(json.defaultCategories) ? json.defaultCategories : DEFAULT_BLOG_CATEGORIES,
    customCategories: Array.isArray(json.customCategories) ? json.customCategories : [],
  };
}

export async function publishCommunityBlog(input: {
  title: string;
  body: string;
  coverImage?: string;
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

export async function pickAndUploadBlogCover(uid: string): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Allow photo access to select a blog cover image.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [16, 9],
    quality: 0.72,
    base64: true,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.base64) {
    throw new Error('Could not read this image. Please pick another photo.');
  }
  if (asset.base64.length > 6_000_000) {
    throw new Error('Choose a cover image smaller than 4.5 MB.');
  }
  const dataUri = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
  const hostedUrl = await uploadImageToImageKit(uid, dataUri, {
    folder: '/linkup-blogs',
    fileName: `blog-cover-${Date.now()}.jpg`,
    useUniqueFileName: true,
  });
  if (!hostedUrl) {
    throw new Error('Cover upload could not complete. Try again or paste an HTTPS image URL.');
  }
  return hostedUrl;
}
