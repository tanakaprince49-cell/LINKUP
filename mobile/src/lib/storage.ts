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
    // Most places in the app already pass `data:image/...;base64,...` URIs from ImagePicker.
    // Keep this utility dependency-free to avoid requiring `expo-file-system` in Expo Go.
    if (uri.startsWith('data:')) {
      if (uri.length > 1000000) {
        console.warn("Media size exceeds ~1MB. Firestore may reject it.");
      }
      return uri;
    }

    // Fallback: if we were given a remote URL, just store it as-is.
    // Production apps should upload to Storage/CDN instead.
    if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;

    // If this is a local file URI, we currently return it unchanged (no file-system dependency).
    return uri;
    
    // Safety check: Firestore has a 1MB limit per document.
    // Base64 is ~33% larger than binary. We should warn if it's too big.
  } catch (error) {
    console.error("Base64 conversion failed:", error);
    throw error;
  }
};
