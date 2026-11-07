import { Platform } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { buildAccountExport, exportFileName, type AccountExport } from './accountExport';

/**
 * SAVING THE EXPORT — the platform half.
 *
 * Web gets a downloaded .json, a phone gets the share sheet, and the clipboard
 * is the last resort so the member is never told "no". The delete button never
 * waits on any of this: the export is optional, and leaving always works.
 */

const readDoc = async (collection: string, uid: string): Promise<Record<string, unknown> | null> => {
  try {
    const snapshot = await getDoc(doc(db, collection, uid));
    return snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : null;
  } catch {
    // A blocked or missing collection must not stop the export.
    return null;
  }
};

export async function saveAccountExport(payload: AccountExport): Promise<'download' | 'share' | 'clipboard'> {
  const json = JSON.stringify(payload, null, 2);
  const fileName = exportFileName(payload.account.uid);

  if (Platform.OS === 'web') {
    const docRef = (globalThis as any).document;
    if (docRef?.createElement && (globalThis as any).URL?.createObjectURL) {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = docRef.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      docRef.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return 'download';
    }
    const Clipboard = await import('expo-clipboard').catch(() => null);
    if (Clipboard) {
      await Clipboard.setStringAsync(json);
      return 'clipboard';
    }
    throw new Error('This browser cannot start a download.');
  }

  const FS = await import('expo-file-system/legacy').catch(() => null);
  const Sharing = await import('expo-sharing').catch(() => null);
  if (FS && Sharing && (await Sharing.isAvailableAsync().catch(() => false))) {
    const uri = `${FS.cacheDirectory}${fileName}`;
    try {
      await FS.writeAsStringAsync(uri, json, { encoding: 'utf8' });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: 'Save your LINKUP data',
        UTI: 'public.json',
      });
      return 'share';
    } finally {
      await FS.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }

  const Clipboard = await import('expo-clipboard').catch(() => null);
  if (Clipboard) {
    await Clipboard.setStringAsync(json);
    return 'clipboard';
  }
  const { Share } = await import('react-native');
  await Share.share({ message: json, title: 'My LINKUP data' });
  return 'share';
}

/** Fetch + build + save, in that order. Used by the delete flow and by profile. */
export async function exportAccountData(input: {
  uid: string;
  email?: string | null;
  profile?: Record<string, any> | null;
}): Promise<{ mode: 'download' | 'share' | 'clipboard'; fileName: string; bytes: number }> {
  const privateState = await readDoc('userPrivate', input.uid);
  const payload = buildAccountExport({ ...input, private: privateState });
  const mode = await saveAccountExport(payload);
  return {
    mode,
    fileName: exportFileName(input.uid, new Date(payload.exportedAt)),
    bytes: JSON.stringify(payload).length,
  };
}
