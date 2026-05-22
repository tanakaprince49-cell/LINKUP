export const MAX_PICKED_PHOTO_BYTES = 1 * 1024 * 1024;
export const MAX_FIRESTORE_IMAGE_CHARS = 220_000;

const formatMegabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

export function imageAssetToDataUri(
  asset: { base64?: string | null; fileSize?: number | null; mimeType?: string | null } | undefined,
  savedLimit = MAX_FIRESTORE_IMAGE_CHARS
) {
  const base64 = asset?.base64;
  if (!base64) {
    return { error: 'Could not read image data. Please try another photo.' };
  }

  const sourceBytes = typeof asset?.fileSize === 'number' ? asset.fileSize : Math.ceil(base64.length * 0.75);
  if (sourceBytes > MAX_PICKED_PHOTO_BYTES) {
    return { error: `Please choose a photo under ${formatMegabytes(MAX_PICKED_PHOTO_BYTES)}.` };
  }

  const mimeType = asset?.mimeType || 'image/jpeg';
  const dataUri = `data:${mimeType};base64,${base64}`;
  if (dataUri.length > savedLimit) {
    return {
      error:
        'This photo is still too large after compression. Choose a smaller photo under 1MB so LINKUP can keep swiping smooth without Firebase Storage.',
    };
  }

  return { dataUri };
}
