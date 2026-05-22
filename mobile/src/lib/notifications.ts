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
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from './firebase';

let notificationHandlerReady = false;
const WEB_NOTIFICATIONS_STORAGE_KEY = 'linkup:web-notifications-enabled';
const NOTIFICATION_QUERY_LIMIT = 75;

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

async function ensureNativeNotificationRuntime() {
  if (Platform.OS === 'web') return null;

  const Notifications = await loadNotificationsModule();
  if (!Notifications) return null;

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

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'LINKUP alerts',
      description: 'Matches, messages, profile views, and AI opportunity alerts.',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FBE618',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: 'default',
    });
  }

  return Notifications;
}

function notificationTitle(data: any) {
  if (data?.type === 'message') return `New message from ${data.fromName || 'LINKUP'}`;
  if (data?.type === 'match') return 'New LINKUP match';
  if (data?.type === 'like') return 'New profile like';
  if (data?.type === 'view') return 'New profile view';
  if (data?.type === 'comment') return 'New comment';
  if (String(data?.content || '').startsWith('AI Project Match')) return 'AI Project Match found';
  if (String(data?.content || '').startsWith('AI Opportunity')) return 'AI Opportunity found';
  return 'LINKUP notification';
}

function notificationTargetUrl(data: any) {
  if (data?.matchId) return `/chat/${data.matchId}`;
  if (
    data?.fromId &&
    (String(data?.content || '').startsWith('AI Opportunity') ||
      String(data?.content || '').startsWith('AI Project Match'))
  ) {
    return `/opportunity/${data.fromId}`;
  }
  return '/alerts';
}

async function ensureNotificationPermission(Notifications: any) {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function registerForPushNotificationsAsync(userId: string) {
  if (!userId) {
    return;
  }

  if (Platform.OS === 'web') {
    return registerForWebNotificationsAsync(userId);
  }

  const Notifications = await ensureNativeNotificationRuntime();
  if (!Notifications) return;

  const permissionGranted = await ensureNotificationPermission(Notifications);
  if (!permissionGranted) {
    console.warn('Notification permission was not granted.');
    return;
  }

  if (isExpoGo()) {
    console.warn('Remote push tokens require a development build or real APK; foreground/local LINKUP notifications remain enabled.');
    return;
  }

  let token;
  if (Device.isDevice) {
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

export function subscribeToNotificationToasts(userId: string) {
  if (
    !userId
  ) {
    return () => {};
  }

  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    where('isRead', '==', false),
    orderBy('timestamp', 'desc'),
    limit(NOTIFICATION_QUERY_LIMIT)
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

        const title = notificationTitle(data);
        const body = String(data.content || 'Open LINKUP for the latest update.');
        const targetUrl = notificationTargetUrl(data);

        if (Platform.OS === 'web') {
          if (typeof window === 'undefined' || !('Notification' in window)) return;
          if (window.Notification.permission !== 'granted') return;

          const browserNotification = new window.Notification(title, {
            body,
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
          return;
        }

        void ensureNativeNotificationRuntime()
          .then((Notifications) => {
            if (!Notifications) return;
            return Notifications.scheduleNotificationAsync({
              content: {
                title,
                body,
                sound: 'default',
                badge: 1,
                data: {
                  notificationId,
                  targetUrl,
                  type: data.type,
                  matchId: data.matchId || '',
                  fromId: data.fromId || '',
                },
              },
              trigger: null,
            });
          })
          .catch((error) => {
            console.warn('Local notification skipped:', error);
          });
      });

      bootstrapped = true;
    },
    (err) => {
      console.warn('Notification listener unavailable:', err);
    }
  );
}

export const subscribeToBrowserNotificationToasts = subscribeToNotificationToasts;

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
    where('isRead', '==', false),
    orderBy('timestamp', 'desc'),
    limit(NOTIFICATION_QUERY_LIMIT)
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
    where('isRead', '==', false),
    orderBy('timestamp', 'desc'),
    limit(450)
  );
  const snap = await getDocs(unreadQuery);
  if (snap.empty) return;

  const batch = writeBatch(db);
  snap.docs.slice(0, 450).forEach((notificationDoc) => {
    batch.update(notificationDoc.ref, { isRead: true });
  });
  await batch.commit();
}
