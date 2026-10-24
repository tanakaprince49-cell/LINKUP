// Public avatar selection only. No remote fetches, uploads or arbitrary URL proxy.
const MAX_DATA_URI_CHARS = 900000;
export function publicImageUrl(uid) {
  return `https://www.linkupbuild.com/app/api/publicSeo?mode=image&uid=${encodeURIComponent(uid)}`;
}
export function decodeProfileImage(value) {
  if (typeof value !== 'string' || value.length > MAX_DATA_URI_CHARS || !value.startsWith('data:image/')) return null;
  const match = value.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match || match[2].length % 4 === 1) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) return null;
  const kind = match[1].toLowerCase().replace('jpg', 'jpeg');
  const valid = kind === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : kind === 'jpeg' ? bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : kind === 'gif' ? ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'))
    : bytes.length >= 12 && bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP';
  return valid ? {bytes, contentType: `image/${kind}`} : null;
}
export function selectProfileImage(uid, profile, safeUrl) {
  // profilePic is the member's current selection; hosted/provider aliases are
  // fallbacks, not a reason to replace a newer selection with an old photo.
  for (const value of [profile.profilePic, profile.profilePicUrl, profile.photoURL, profile.avatarUrl,...(Array.isArray(profile.photos)?profile.photos.map(p=>typeof p==='string'?p:p?.url):[])]) {
    const url = safeUrl(value);
    if (url) return {url};
    const inline = decodeProfileImage(value);
    if (inline) return {url:publicImageUrl(uid), ...inline};
  }
  return null;
}
