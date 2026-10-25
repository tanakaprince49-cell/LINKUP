import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, initializeAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentSingleTabManager } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firebaseConfig from '../../firebase-applet-config.json';

const getFirebaseConfig = () => {
  return { ...(firebaseConfig as Record<string, any>) };
};

const app = initializeApp(getFirebaseConfig());

const createAuth = () => {
  if (Platform.OS === 'web') {
    return getAuth(app);
  }

  try {
    // `getReactNativePersistence` is only available in the React Native auth bundle.
    // Keep it out of the web path so Expo Web does not boot into a blank screen.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getReactNativePersistence } = require('@firebase/auth') as any;
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
};

export const auth = createAuth();
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  ...(Platform.OS === 'web'
    ? {
        // Web handles WebChannel streams fine; auto-detect picks the best transport.
        experimentalAutoDetectLongPolling: true,
        // Persist Firestore docs in IndexedDB on web so repeat visits render
        // profiles instantly from cache while the network copy refreshes.
        //
        // SINGLE-tab manager on purpose. The multi-tab manager mirrors every
        // pending write into localStorage ("firestore_mutations_...") so other
        // tabs can see it; localStorage is capped at ~5MB for the whole site,
        // and one large profile save (a users doc with photos) blew that cap
        // with QuotaExceededError, which the SDK turns into an INTERNAL
        // ASSERTION FAILED (ID: b815) uncaught error - the web app crashed.
        // Single-tab keeps everything in IndexedDB (no localStorage mirror).
        // forceOwnership keeps the cache usable if two tabs are open instead of
        // throwing "failed-precondition" in the second one.
        //
        // A STALE cache can still corrupt (an older build's schema, or a write
        // interrupted mid-transaction): the SDK then throws "Unexpected state
        // (ID: b7de)" from removeMutationBatch and poisons the async queue so
        // every later call re-throws b815. firestoreSelfHeal.ts (installed in
        // index.ts) drops the Firestore IndexedDB and reloads once for that.
        localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({ forceOwnership: true }) }),
      }
    : {
        // React Native / Expo Go: WebChannel listen streams flap roughly every
        // 75s and flood the console with "RPC 'Listen' stream transport errored"
        // warnings. Forcing long polling on native makes the transport stable
        // and silences the noise without touching the web app.
        experimentalForceLongPolling: true,
      }),
});
export const functions = getFunctions(app);

// Local Firebase emulators (dev-only, $0 quota burn): create mobile/.env with
//   EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=192.168.x.x   (your PC's LAN IP)
// and run `firebase emulators:start --only auth,firestore` from the repo root.
// When the variable is unset (or in production builds) this block is a no-op
// and the app talks to production exactly as before. Full free-testing guide:
// EMULATOR_TESTING.md
const EMULATOR_HOST =
  process.env.NODE_ENV === 'production'
    ? ''
    : String(process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST || '').trim();
if (EMULATOR_HOST) {
  try {
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, EMULATOR_HOST, 8085);
    console.log(`[LINKUP] Using local Firebase emulators at ${EMULATOR_HOST} (auth :9099, firestore :8085) — $0 quota burn.`);
  } catch (error) {
    console.warn('[LINKUP] Firebase emulator requested but unavailable; using production.', error);
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo, null, 2));
  return errInfo;
}
