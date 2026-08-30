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
export const IMAGEKIT_CAMPAIGN_FOLDER = '/linkup-campaigns';

export type ImageKitAuthParams = {
  token: string;
  expire: number;
  signature: string;
};

export type ImageKitUploadOptions = {
  folder?: string;
  fileName?: string;
  useUniqueFileName?: boolean;
};

export const uploadImageToImageKit = async (
  uid: string,
  dataUri: string,
  options: ImageKitUploadOptions = {}
): Promise<string | null> => {
  if (!uid || typeof dataUri !== 'string' || !dataUri.startsWith('data:image')) return null;
  try {
    const authRes = await fetch(AUTH_ENDPOINT);
    if (!authRes.ok) return null;
    const { token, expire, signature } = (await authRes.json()) as Partial<ImageKitAuthParams>;
    if (!token || !expire || !signature) return null;

    const form = new FormData();
    form.append('file', dataUri);
    form.append('fileName', options.fileName || `${uid}.jpg`);
    form.append('folder', options.folder || IMAGEKIT_AVATAR_FOLDER);
    form.append('useUniqueFileName', options.useUniqueFileName === false ? 'false' : 'true');
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
    return null; // Upload is opportunistic — caller decides the fallback.
  }
};

export const uploadAvatarToImageKit = (uid: string, dataUri: string) =>
  uploadImageToImageKit(uid, dataUri, {
    folder: IMAGEKIT_AVATAR_FOLDER,
    fileName: `${uid}.jpg`,
    useUniqueFileName: false,
  });

/** Advertiser logos for LinkUp Campaigns. Unique names so a re-uploaded logo
 *  never collides with a cached one on the CDN. */
export const uploadCampaignLogoToImageKit = (uid: string, dataUri: string) =>
  uploadImageToImageKit(uid, dataUri, {
    folder: IMAGEKIT_CAMPAIGN_FOLDER,
    fileName: `${uid}-logo.jpg`,
    useUniqueFileName: true,
  });
