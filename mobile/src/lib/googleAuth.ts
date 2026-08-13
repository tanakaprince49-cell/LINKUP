import { NativeModules, Platform } from 'react-native';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from './firebase';

export const GOOGLE_WEB_CLIENT_ID =
  '70946124449-9nbp25ptm4vovihcrcoahafbhtaq0usn.apps.googleusercontent.com';

const GOOGLE_ANDROID_CLIENT_ID =
  '70946124449-9fkogibansijkib564gq1rilr6lavf46.apps.googleusercontent.com';

export function isNativeGoogleModulePresent() {
  if (Platform.OS === 'web') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TurboModuleRegistry } = require('react-native');
    if (typeof TurboModuleRegistry?.get === 'function') {
      return !!TurboModuleRegistry.get('RNGoogleSignin');
    }
  } catch {
    // Fall through to NativeModules.
  }
  return !!(NativeModules as any)?.RNGoogleSignin;
}

export function loadNativeGoogleSignIn() {
  if (!isNativeGoogleModulePresent()) return null;
  try {
    // Only require after the native binary actually registered the module.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@react-native-google-signin/google-signin') as any;
  } catch (error) {
    console.warn('Native Google Sign-In JS module unavailable:', error);
    return null;
  }
}

let nativeGoogleConfigured = false;

export function prepareNativeGoogleSignIn() {
  if (Platform.OS === 'web' || nativeGoogleConfigured) return loadNativeGoogleSignIn();
  if (!isNativeGoogleModulePresent()) return null;
  const googleModule = loadNativeGoogleSignIn();
  const GoogleSignin = googleModule?.GoogleSignin;
  if (!GoogleSignin?.configure) return googleModule;
  try {
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      offlineAccess: false,
      forceCodeForRefreshToken: false,
      scopes: ['profile', 'email'],
      profileImageSize: 120,
    });
    nativeGoogleConfigured = true;
  } catch (error) {
    console.warn('Native Google Sign-In configure skipped:', error);
  }
  return googleModule;
}

const getGoogleIdTokenFromNative = async (GoogleSignin: any, signInResult: any) => {
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

async function signInWithExpoAuthSession() {
  const AuthSession = await import('expo-auth-session');
  try {
    await import('expo-web-browser').then((WebBrowser) => WebBrowser.maybeCompleteAuthSession?.()).catch(() => {});
  } catch {
    // optional
  }

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: 'linkup',
    path: 'oauth',
  });

  const request = new AuthSession.AuthRequest({
    clientId: Platform.OS === 'android' ? GOOGLE_ANDROID_CLIENT_ID : GOOGLE_WEB_CLIENT_ID,
    scopes: ['openid', 'profile', 'email'],
    redirectUri,
    responseType: AuthSession.ResponseType.IdToken,
    extraParams: { nonce: String(Date.now()) },
    usePKCE: false,
  });

  const result = await request.promptAsync({
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  });

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { cancelled: true as const };
  }
  if (result.type !== 'success') {
    throw new Error(result.type === 'error' ? result.error?.message || 'Google sign-in failed' : 'Google sign-in did not complete');
  }
  const idToken = (result.params as any)?.id_token || (result as any)?.authentication?.idToken;
  if (!idToken) {
    throw new Error('Google did not return an ID token. Add the linkup:/oauth redirect in Google Cloud OAuth client.');
  }
  return { idToken };
}

export async function signInToFirebaseWithGoogle() {
  if (Platform.OS !== 'web' && isNativeGoogleModulePresent()) {
    const googleModule = prepareNativeGoogleSignIn();
    if (googleModule?.GoogleSignin) {
      const { GoogleSignin } = googleModule;
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const alreadySignedIn = await GoogleSignin.hasPreviousSignIn?.().catch(() => false);
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
  }

  const expoResult = await signInWithExpoAuthSession();
  if ('cancelled' in expoResult && expoResult.cancelled) return { cancelled: true as const };
  const credential = GoogleAuthProvider.credential((expoResult as any).idToken);
  const signedIn = await signInWithCredential(auth, credential);
  return { user: signedIn.user };
}
