import { NativeModules, Platform } from 'react-native';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from './firebase';

export const GOOGLE_WEB_CLIENT_ID =
  '70946124449-9nbp25ptm4vovihcrcoahafbhtaq0usn.apps.googleusercontent.com';

type GoogleSignInModule = {
  GoogleSignin: {
    configure: (options: Record<string, unknown>) => void;
    hasPlayServices: (options?: { showPlayServicesUpdateDialog?: boolean }) => Promise<boolean>;
    hasPreviousSignIn?: () => Promise<boolean> | boolean;
    signOut?: () => Promise<void>;
    signIn: () => Promise<any>;
    getTokens?: () => Promise<{ idToken?: string | null }>;
  };
};

function nativeModuleRegistered() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TurboModuleRegistry } = require('react-native');
    if (typeof TurboModuleRegistry?.get === 'function' && TurboModuleRegistry.get('RNGoogleSignin')) {
      return true;
    }
  } catch {
    // Fall through.
  }
  return !!(NativeModules as { RNGoogleSignin?: unknown }).RNGoogleSignin;
}

export function isNativeGoogleModulePresent() {
  if (Platform.OS === 'web') return false;
  return nativeModuleRegistered();
}

export function loadNativeGoogleSignIn(): GoogleSignInModule | null {
  if (Platform.OS === 'web') return null;
  if (!nativeModuleRegistered()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@react-native-google-signin/google-signin') as GoogleSignInModule;
  } catch (error) {
    console.warn('Native Google Sign-In JS package failed to load:', error);
    return null;
  }
}

let nativeGoogleConfigured = false;

export function prepareNativeGoogleSignIn() {
  const googleModule = loadNativeGoogleSignIn();
  const GoogleSignin = googleModule?.GoogleSignin;
  if (!GoogleSignin?.configure) return googleModule;
  if (nativeGoogleConfigured) return googleModule;
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    offlineAccess: false,
    forceCodeForRefreshToken: false,
    scopes: ['profile', 'email'],
    profileImageSize: 120,
  });
  nativeGoogleConfigured = true;
  return googleModule;
}

const getGoogleIdTokenFromNative = async (GoogleSignin: GoogleSignInModule['GoogleSignin'], signInResult: any) => {
  const type = String(signInResult?.type || '').toLowerCase();
  if (type === 'cancelled' || type === 'cancel' || signInResult === false) return null;
  const tokenFromSignIn =
    signInResult?.data?.idToken ||
    signInResult?.idToken ||
    signInResult?.data?.user?.idToken ||
    signInResult?.user?.idToken;
  if (tokenFromSignIn) return tokenFromSignIn;
  const tokens = await GoogleSignin.getTokens?.().catch(() => null);
  return tokens?.idToken || null;
};

export async function signInToFirebaseWithGoogle() {
  if (Platform.OS === 'web') {
    throw new Error('Use the web Google button on the browser app. Native Google Sign-In is for the Android/iOS build.');
  }

  const googleModule = prepareNativeGoogleSignIn();
  if (!googleModule?.GoogleSignin) {
    throw new Error(
      'Native Google Sign-In is not linked. Rebuild the Android app from Android Studio (Run app / expo run:android). Expo Go cannot show the Google account picker.'
    );
  }

  const { GoogleSignin } = googleModule;
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  // v13+ returns a boolean synchronously; older versions return a Promise.
  // Promise.resolve() handles both — calling .catch directly on a boolean
  // crashes with "undefined is not a function".
  const alreadySignedIn = await Promise.resolve(GoogleSignin.hasPreviousSignIn?.()).catch(() => false);
  if (alreadySignedIn) {
    await GoogleSignin.signOut?.().catch(() => {});
  }

  const signInResult = await GoogleSignin.signIn();
  const cancelledType = String(signInResult?.type || '').toLowerCase();
  if (cancelledType === 'cancelled' || cancelledType === 'cancel') {
    return { cancelled: true as const };
  }

  const idToken = await getGoogleIdTokenFromNative(GoogleSignin, signInResult);
  if (!idToken) return { cancelled: true as const };

  const credential = GoogleAuthProvider.credential(idToken);
  const signedIn = await signInWithCredential(auth, credential);
  return { user: signedIn.user };
}
