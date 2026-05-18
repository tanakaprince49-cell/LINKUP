import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';

function guessExt(uri: string) {
  const lower = uri.toLowerCase();
  if (lower.includes('.png')) return 'png';
  if (lower.includes('.webp')) return 'webp';
  if (lower.includes('.heic')) return 'heic';
  return 'jpg';
}

export async function uploadImageToStorage(opts: { uri: string; path: string }): Promise<string> {
  const { uri, path } = opts;
  if (!uri) throw new Error('uploadImageToStorage: missing uri');
  if (uri.startsWith('https://') || uri.startsWith('http://')) return uri;

  const res = await fetch(uri);
  const blob = await res.blob();
  const ext = guessExt(uri);
  const withExt = path.includes('.') ? path : `${path}.${ext}`;
  const objectRef = ref(storage, withExt);
  await uploadBytes(objectRef, blob, { contentType: blob.type || `image/${ext}` });
  return await getDownloadURL(objectRef);
}

