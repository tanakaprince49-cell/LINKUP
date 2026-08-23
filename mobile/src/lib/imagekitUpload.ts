/**
 * ImageKit client upload: sends a picked photo (data URI) to the free
 * ImageKit CDN and returns the hosted URL. Pipeline:
 *   app -> /api/imagekitAuth (signature, private key stays server-side)
 *       -> upload.imagekit.io (public key + one-shot signature)
 *       -> hosted https URL written to users.profilePicUrl (+ lean index via
 *          updateLocalProfile, which prefers hosted photos first)
 *
 * Free tier: no credit card, rate-limits instead of billing — $0 forever.
 */

const IMAGEKIT_PUBLIC_KEY = 'public_nCVzK4bEGR6VH/FGJHDvjqB5urQ=';
const IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/vjkzaxrro';
// Prod API origin — same deployment that serves the web app.
const AUTH_ENDPOINT = 'https://linkup-muqu.vercel.app/api/imagekitAuth';

export const IMAGEKIT_AVATAR_FOLDER = '/linkup-avatars';

export type ImageKitAuthParams = {
  token: string;
  expire: number;
  signature: string;
};

export const uploadAvatarToImageKit = async (uid: string, dataUri: string): Promise<string | null> => {
  if (!uid || typeof dataUri !== 'string' || !dataUri.startsWith('data:image')) return null;
  try {
    const authRes = await fetch(AUTH_ENDPOINT);
    if (!authRes.ok) return null;
    const { token, expire, signature } = (await authRes.json()) as Partial<ImageKitAuthParams>;
    if (!token || !expire || !signature) return null;

    const form = new FormData();
    form.append('file', dataUri);
    form.append('fileName', `${uid}.jpg`);
    form.append('folder', IMAGEKIT_AVATAR_FOLDER);
    form.append('useUniqueFileName', 'false');
    form.append('publicKey', IMAGEKIT_PUBLIC_KEY);
    form.append('signature', signature);
    form.append('expire', String(expire));
    form.append('token', token);

    const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
      method: 'POST',
      body: form,
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.url) return null;
    return String(data.url);
  } catch {
    return null; // Upload is opportunistic — base64 save already succeeded.
  }
};
