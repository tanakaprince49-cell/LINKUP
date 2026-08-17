import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import sharp from 'sharp';

// Photos are stored as base64 data URIs inside the Firestore doc. The app
// strips any image over ~240k chars when displaying/caching, so oversized
// uploads "save fine" but then appear missing. This trigger recompresses
// oversized images in place so every client (old APKs, web, new builds)
// can always show them.
const MAX_IMAGE_CHARS = 230_000;
const PHOTO_FIELDS = ['profilePic'] as const;

const isDataUri = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('data:image/');

const needsHeal = (value: unknown): value is string => isDataUri(value) && value.length > MAX_IMAGE_CHARS;

const dataUriToJpeg = async (uri: string): Promise<string> => {
  const base64 = uri.split(',')[1] || '';
  const input = Buffer.from(base64, 'base64');
  for (const width of [480, 420, 360, 300, 240]) {
    for (const quality of [72, 60, 48, 36]) {
      const out = await sharp(input)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      const healed = `data:image/jpeg;base64,${out.toString('base64')}`;
      if (healed.length <= MAX_IMAGE_CHARS) return healed;
    }
  }
  // Last resort: smallest render we can produce (better a small pic than none).
  const out = await sharp(input).rotate().resize({ width: 200 }).jpeg({ quality: 30 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
};

const healPhotosArray = async (photos: unknown): Promise<{ next?: string[]; changed: boolean }> => {
  if (!Array.isArray(photos)) return { changed: false };
  let changed = false;
  const next: string[] = [];
  for (const entry of photos.slice(0, 5)) {
    if (needsHeal(entry)) {
      changed = true;
      next.push(await dataUriToJpeg(entry));
    } else if (typeof entry === 'string' && entry) {
      next.push(entry);
    }
  }
  return changed ? { next, changed } : { changed: false };
};

export const healProfileImages = onDocumentWritten(
  { document: 'users/{userId}', memory: '512MiB', timeoutSeconds: 120 },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const data = after.data() || {};
    const userId = String(event.params.userId || '');

    const patch: Record<string, unknown> = {};

    for (const field of PHOTO_FIELDS) {
      if (needsHeal(data[field])) {
        patch[field] = await dataUriToJpeg(data[field]);
      }
    }

    const photosResult = await healPhotosArray(data.photos);
    if (photosResult.changed && photosResult.next) {
      patch.photos = photosResult.next;
    }

    if (!Object.keys(patch).length) return; // nothing oversized -> no write, no loop

    if (typeof patch.profilePic === 'string' && patch.profilePic === data.profilePic) {
      delete patch.profilePic;
    }
    if (!Object.keys(patch).length) return;

    // Safe from infinite loops: the healed images are below the threshold,
    // so the follow-up write this triggers sees nothing to fix and stops.
    patch.imageHealedAt = new Date().toISOString();
    await after.ref.set(patch, { merge: true });
    logger.info('Healed oversized profile images', {
      userId,
      fields: Object.keys(patch).filter((k) => k !== 'imageHealedAt'),
    });

    // Mirror the healed avatar into the public discovery index when present
    // so lists re-render the face instead of a ghost.
    if (typeof patch.profilePic === 'string') {
      const publicRef = after.ref.firestore.collection('publicProfiles').doc(userId);
      const publicSnap = await publicRef.get();
      if (publicSnap.exists) {
        await publicRef.set({ profilePic: patch.profilePic, updatedAt: new Date().toISOString() }, { merge: true });
      }
    }
  }
);
