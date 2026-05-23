export const MAX_PICKED_PHOTO_BYTES = 1 * 1024 * 1024;
export const MAX_FIRESTORE_IMAGE_CHARS = 460_000;

const formatMegabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

type PickedImageAsset = {
  base64?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  uri?: string | null;
};

const tooLargeMessage =
  'This photo is too large. I compressed it as much as possible, but Firestore still rejected the size. Choose a smaller photo so LINKUP can save it without Firebase Storage.';

const hasWebCanvas = () =>
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof (globalThis as any).Image !== 'undefined';

const getMimeType = (asset?: PickedImageAsset) => {
  if (asset?.mimeType) return asset.mimeType;
  if (asset?.uri?.startsWith('data:image/png')) return 'image/png';
  if (asset?.uri?.startsWith('data:image/webp')) return 'image/webp';
  return 'image/jpeg';
};

const readBlobAsDataUri = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read selected image.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });

const readUriAsDataUri = async (uri: string) => {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not load selected image.');
  return readBlobAsDataUri(await response.blob());
};

const compressDataUriOnWeb = async (dataUri: string, savedLimit: number) => {
  if (!hasWebCanvas()) return dataUri.length <= savedLimit ? dataUri : null;

  const WebImage = (globalThis as any).Image;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new WebImage();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not prepare selected image.'));
    img.src = dataUri;
  });

  const sourceWidth = image.naturalWidth || image.width || 900;
  const sourceHeight = image.naturalHeight || image.height || 900;
  let smallest = dataUri;

  for (const maxDimension of [900, 760, 640, 520, 420, 320]) {
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) continue;

    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of [0.78, 0.64, 0.5, 0.38, 0.28]) {
      const compressed = canvas.toDataURL('image/jpeg', quality);
      if (compressed.length < smallest.length) smallest = compressed;
      if (compressed.length <= savedLimit) return compressed;
    }
  }

  return smallest.length <= savedLimit ? smallest : null;
};

export async function imageAssetToDataUri(
  asset: PickedImageAsset | undefined,
  savedLimit = MAX_FIRESTORE_IMAGE_CHARS
) {
  try {
    let dataUri = '';

    if (asset?.uri?.startsWith('data:image/')) {
      dataUri = asset.uri;
    } else if (asset?.base64) {
      dataUri = `data:${getMimeType(asset)};base64,${asset.base64}`;
    } else if (asset?.uri && hasWebCanvas()) {
      dataUri = await readUriAsDataUri(asset.uri);
    }

    if (!dataUri) {
      return { error: 'Could not read image data. Please try another photo.' };
    }

    if (dataUri.length <= savedLimit) {
      return { dataUri };
    }

    const compressed = await compressDataUriOnWeb(dataUri, savedLimit);
    if (compressed) {
      return { dataUri: compressed };
    }

    const encodedBytes = Math.ceil(dataUri.length * 0.75);
    return {
      error:
        encodedBytes > MAX_PICKED_PHOTO_BYTES
          ? `Please choose a photo under ${formatMegabytes(MAX_PICKED_PHOTO_BYTES)}.`
          : tooLargeMessage,
    };
  } catch (error: any) {
    return { error: error?.message || 'Could not prepare this photo. Please try another image.' };
  }
}
