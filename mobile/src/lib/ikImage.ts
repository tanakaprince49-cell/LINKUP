/**
 * ImageKit URL transforms: resize/re-encode on the CDN before the bytes ever
 * hit a ~1Mbps link. One original master per photo on ImageKit; quality is a
 * URL param — raising it here re-encodes EVERY photo instantly, no migration.
 *
 *   https://ik.imagekit.io/vjkzaxrro/linkup-avatars/u.jpg
 *     -> https://ik.imagekit.io/vjkzaxrro/tr:w-1080,q-85,f-auto/linkup-avatars/u.jpg
 *
 * f-auto lets ImageKit serve WebP/AVIF per device: sharper per KB.
 * Only rewrites URLs on OUR ImageKit endpoint; anything else (ui-avatars,
 * data URIs, other hosts) passes through untouched.
 */
const IK_ENDPOINT = 'https://ik.imagekit.io/vjkzaxrro';

export const ikImage = (uri: unknown, width = 480, quality = 80): string => {
  if (typeof uri !== 'string' || !uri.startsWith(`${IK_ENDPOINT}/`)) return typeof uri === 'string' ? uri : '';
  if (uri.includes('/tr:')) return uri; // already transformed
  const w = Math.max(16, Math.round(width));
  const q = Math.min(100, Math.max(20, Math.round(quality)));
  return `${IK_ENDPOINT}/tr:w-${w},q-${q},f-auto${uri.slice(IK_ENDPOINT.length)}`;
};

/** Avatars (inbox/search/league rows, chat bubbles): crisp on 2-3x phone screens. */
export const ikAvatar = (uri: unknown) => ikImage(uri, 480, 80);
/** Cards + heroes: swipe deck, profile hero, chat media — the "users notice" zone. */
export const ikCard = (uri: unknown) => ikImage(uri, 1080, 85);
