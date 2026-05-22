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
const WEB_NOTIFICATIONS_STORAGE_KEY = 'linkup:web-notifications-enabled';

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
  if (!userId) {
    return;
  }

  if (Platform.OS === 'web') {
    return registerForWebNotificationsAsync(userId);
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

export async function registerForWebNotificationsAsync(userId: string) {
  if (!userId || Platform.OS !== 'web' || typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }

  try {
    const permission =
      window.Notification.permission === 'default'
        ? await window.Notification.requestPermission()
        : window.Notification.permission;

    window.localStorage?.setItem(WEB_NOTIFICATIONS_STORAGE_KEY, permission === 'granted' ? 'true' : 'false');

    await setDoc(
      doc(db, 'userPrivate', userId),
      {
        webNotificationsEnabled: permission === 'granted',
        webNotificationsUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch(() => undefined);

    return permission;
  } catch (error) {
    console.warn('Web notifications setup skipped:', error);
  }
}

export function subscribeToBrowserNotificationToasts(userId: string) {
  if (
    !userId ||
    Platform.OS !== 'web' ||
    typeof window === 'undefined' ||
    !('Notification' in window)
  ) {
    return () => {};
  }

  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    where('isRead', '==', false)
  );

  const seenIds = new Set<string>();
  let bootstrapped = false;

  return onSnapshot(
    q,
    (snap) => {
      snap.docs.forEach((notificationDoc) => {
        const data = notificationDoc.data() as any;
        const notificationId = notificationDoc.id;

        if (!bootstrapped) {
          seenIds.add(notificationId);
          return;
        }

        if (seenIds.has(notificationId)) return;
        seenIds.add(notificationId);

        if (window.Notification.permission !== 'granted') return;

        const title = data.type === 'message'
          ? `New message from ${data.fromName || 'LINKUP'}`
          : data.type === 'match'
            ? 'New LINKUP match'
            : data.content?.startsWith('AI Opportunity')
              ? 'AI Opportunity found'
              : 'LINKUP notification';

        const targetUrl = data.matchId
          ? `/chat/${data.matchId}`
          : data.content?.startsWith('AI Opportunity') && data.fromId
            ? `/opportunity/${data.fromId}`
            : '/alerts';

        const browserNotification = new window.Notification(title, {
          body: String(data.content || 'Open LINKUP for the latest update.'),
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: notificationId,
          data: { targetUrl },
        });

        browserNotification.onclick = () => {
          window.focus();
          window.location.assign(targetUrl);
          browserNotification.close();
        };
      });

      bootstrapped = true;
    },
    (err) => {
      console.warn('Web notification listener unavailable:', err);
    }
  );
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
