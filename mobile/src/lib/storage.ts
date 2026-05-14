import * as FileSystem from 'expo-file-system';

/**
 * ZERO-COST MEDIA HANDLER
 * Instead of using paid cloud storage, we convert images to optimized Base64 strings
 * that can be stored directly in Firestore documents.
 * 
 * NOTE: For videos, this approach is limited due to Firestore's 1MB document limit.
 * We highly recommend a dedicated media host for production video content.
 */
export const uploadMedia = async (uri: string, path: string): Promise<string> => {
  try {
    // Read the file as a base64 string
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const extension = uri.split('.').pop()?.toLowerCase();
    const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';
    
    // Prefix with data URI header
    const dataUri = `data:${mimeType};base64,${base64}`;
    
    // Safety check: Firestore has a 1MB limit per document.
    // Base64 is ~33% larger than binary. We should warn if it's too big.
    if (dataUri.length > 1000000) {
      console.warn("Media size exceeds 1MB Firestore limit. Image may not save correctly.");
    }

    return dataUri;
  } catch (error) {
    console.error("Base64 conversion failed:", error);
    throw error;
  }
};
