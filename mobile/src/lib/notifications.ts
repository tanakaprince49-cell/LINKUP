import * as Device from 'expo-device';
import { Platform } from 'react-native';
import {
  doc,
  setDoc,
  arrayUnion,
  collection,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

let notificationHandlerReady = false;

function getExpoConstants() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-constants').default;
  } catch {
    return null;
  }
}

function isExpoGo() {
  const constants = getExpoConstants();
  return constants?.appOwnership === 'expo' || constants?.executionEnvironment === 'storeClient';
}

async function loadNotificationsModule() {
  try {
    return await import('expo-notifications');
  } catch (error) {
    console.warn('Notifications module unavailable in this runtime:', error);
    return null;
  }
}

export async function registerForPushNotificationsAsync(userId: string) {
  if (!userId || Platform.OS === 'web') {
    return;
  }

  if (isExpoGo()) {
    console.warn('Push notifications require a development build or real APK; skipping Expo Go token registration.');
    return;
  }

  const Notifications = await loadNotificationsModule();
  if (!Notifications) return;

  if (!notificationHandlerReady) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
    notificationHandlerReady = true;
  }

  let token;
  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!');
      return;
    }
    const constants = getExpoConstants();
    const projectId = constants?.expoConfig?.extra?.eas?.projectId || constants?.easConfig?.projectId;
    token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    
    try {
      await setDoc(
        doc(db, 'userPrivate', userId),
        {
          pushTokens: arrayUnion(token),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Push token save skipped:', e);
    }
  } else {
    console.log('Must use physical device for Push Notifications');
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FBE618',
    });
  }

  return token;
}

export function subscribeToUnreadNotificationsCount(
  userId: string,
  onCount: (count: number) => void
) {
  if (!userId) {
    onCount(0);
    return () => {};
  }
  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    where('isRead', '==', false)
  );
  return onSnapshot(
    q,
    (snap) => onCount(snap.size),
    (err) => {
      console.warn('Unread notifications unavailable:', err);
      onCount(0);
    }
  );
}

export async function markUnreadNotificationsRead(userId: string) {
  if (!userId) return;

  const unreadQuery = query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    where('isRead', '==', false)
  );
  const snap = await getDocs(unreadQuery);
  if (snap.empty) return;

  const batch = writeBatch(db);
  snap.docs.slice(0, 450).forEach((notificationDoc) => {
    batch.update(notificationDoc.ref, { isRead: true });
  });
  await batch.commit();
}
