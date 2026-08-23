/**
 * ImageKit URL transforms: resize/re-encode on the CDN before the bytes ever
 * hit a ~1Mbps link. A 48px inbox avatar should cost ~4KB, not 400KB.
 *
 *   https://ik.imagekit.io/vjkzaxrro/linkup-avatars/u.jpg
 *     -> https://ik.imagekit.io/vjkzaxrro/tr:w-160,q-55/linkup-avatars/u.jpg
 *
 * Only rewrites URLs on OUR ImageKit endpoint; anything else (ui-avatars,
 * data URIs, other hosts) passes through untouched.
 */
const IK_ENDPOINT = 'https://ik.imagekit.io/vjkzaxrro';

export const ikImage = (uri: unknown, width = 160, quality = 55): string => {
  if (typeof uri !== 'string' || !uri.startsWith(`${IK_ENDPOINT}/`)) return typeof uri === 'string' ? uri : '';
  if (uri.includes('/tr:')) return uri; // already transformed
  const w = Math.max(16, Math.round(width));
  const q = Math.min(100, Math.max(20, Math.round(quality)));
  return `${IK_ENDPOINT}/tr:w-${w},q-${q}${uri.slice(IK_ENDPOINT.length)}`;
};

/** Tiny square: inbox/search/league rows, chat bubbles, notification icons. */
export const ikAvatar = (uri: unknown) => ikImage(uri, 160, 55);
/** Cards: swipe deck, profile hero. */
export const ikCard = (uri: unknown) => ikImage(uri, 720, 60);
