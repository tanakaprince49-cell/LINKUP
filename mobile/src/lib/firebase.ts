import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
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
  experimentalAutoDetectLongPolling: true,
  ignoreUndefinedProperties: true,
  // Persist Firestore docs in IndexedDB on web so repeat visits render
  // profiles instantly from cache while the network copy refreshes.
  // React Native has no IndexedDB, so native keeps the default memory cache.
  ...(Platform.OS === 'web'
    ? { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }
    : {}),
});
export const functions = getFunctions(app);

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
