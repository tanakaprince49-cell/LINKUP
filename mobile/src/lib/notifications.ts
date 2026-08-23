import * as Device from 'expo-device';
import { Linking, Platform } from 'react-native';
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
  limit,
} from 'firebase/firestore';
import { db } from './firebase';
import { MOBILE_NOTIFICATION_QUERY_LIMIT } from './profilePerformance';

let notificationHandlerReady = false;
let lastInAppSoundAt = 0;
let webAudioContext: any = null;
const WEB_NOTIFICATIONS_STORAGE_KEY = 'linkup:web-notifications-enabled';
const NOTIFICATION_QUERY_LIMIT = MOBILE_NOTIFICATION_QUERY_LIMIT;

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
      name: 'LINKUP',
      description: 'Matches, messages, profile views, and opportunity alerts.',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FFFFFF',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: 'default',
    });
  }

  return Notifications;
}

export async function setupNativeNotificationRuntimeAsync() {
  return !!(await ensureNativeNotificationRuntime());
}

function notificationTitle(data: any) {
  return 'LINKUP';
}

function notificationBody(data: any) {
  const content = String(data?.content || '').trim();
  if (data?.type === 'message') return `${data.fromName || 'Someone'} ${content || 'sent you a message.'}`;
  if (data?.type === 'match') return content || 'You have a new match.';
  if (data?.type === 'like') return `${data.fromName || 'Someone'} ${content || 'liked your profile.'}`;
  if (data?.type === 'connection_request') return `${data.fromName || 'Someone'} sent a contact request.`;
  if (data?.type === 'connection_approved') return `${data.fromName || 'Someone'} approved your contact request.`;
  if (data?.type === 'connection_rejected') return `${data.fromName || 'Someone'} responded to your contact request.`;
  if (data?.type === 'view') return `${data.fromName || 'Someone'} viewed your profile.`;
  if (data?.type === 'game_challenge') return (data?.body || data?.title || `${data.fromName || 'Someone'} challenged you!`);
  return content || 'Open LINKUP for the latest update.';
}

function notificationTargetUrl(data: any) {
  if (data?.matchId) return `/chat/${data.matchId}`;
  if (data?.type === 'game_challenge') {
    const gameMap: Record<string, string> = {
      founderflip: 'FounderFlip',
      pitchperfect: 'PitchPerfect',
      networkquiz: 'NetworkQuiz',
    };
    const screen = gameMap[String(data?.gameType || '')];
    if (screen) return `/${screen}`;
  }
  if (
    data?.fromId &&
    (String(data?.content || '').startsWith('Opportunity') ||
      String(data?.content || '').startsWith('Project Match'))
  ) {
    return `/opportunity/${data.fromId}`;
  }
  return '/alerts';
}

export async function playInAppNotificationSound(type?: string) {
  const now = Date.now();
  if (now - lastInAppSoundAt < 650) return;
  lastInAppSoundAt = now;

  if (Platform.OS !== 'web') return;

  try {
    const win = globalThis as any;
    const AudioContextCtor = win?.AudioContext || win?.webkitAudioContext;
    if (!AudioContextCtor) return;

    webAudioContext = webAudioContext || new AudioContextCtor();
    if (webAudioContext.state === 'suspended') {
      await webAudioContext.resume();
    }

    const frequencies: Record<string, number[]> = {
      message: [740, 980],
      match: [620, 880, 1180],
      like: [780, 1040],
      connection_request: [740, 980],
      connection_approved: [620, 880, 1180],
      connection_rejected: [420, 540],
      view: [520, 700],
      game_challenge: [880, 1180, 1480],
      system: [640, 860],
      comment: [680, 900],
    };
    const tones = frequencies[String(type || '')] || [660, 880];
    const startTime = webAudioContext.currentTime;

    tones.slice(0, 3).forEach((frequency, index) => {
      const oscillator = webAudioContext.createOscillator();
      const gain = webAudioContext.createGain();
      const toneStart = startTime + index * 0.09;
      const toneEnd = toneStart + 0.08;

      oscillator.type = index % 2 ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, toneStart);
      gain.gain.setValueAtTime(0.0001, toneStart);
      gain.gain.exponentialRampToValueAtTime(0.08, toneStart + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);
      oscillator.connect(gain);
      gain.connect(webAudioContext.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneEnd + 0.02);
    });
  } catch (error) {
    console.warn('In-app notification sound skipped:', error);
  }
}

async function ensureNotificationPermission(Notifications: any) {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function getAppNotificationStatusAsync() {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unavailable';
    return window.Notification.permission;
  }

  const Notifications = await ensureNativeNotificationRuntime();
  if (!Notifications) return 'unavailable';

  const permissions = await Notifications.getPermissionsAsync();
  return permissions?.status || 'undetermined';
}

export async function enableAppNotificationsAsync(userId: string) {
  if (Platform.OS === 'web') {
    const permission = await registerForWebNotificationsAsync(userId);
    return permission || 'unavailable';
  }

  const Notifications = await ensureNativeNotificationRuntime();
  if (!Notifications) return 'unavailable';

  const granted = await ensureNotificationPermission(Notifications);
  if (!granted) return 'denied';

  await registerForPushNotificationsAsync(userId);
  return 'granted';
}

export async function openAppNotificationSettingsAsync() {
  try {
    await Linking.openSettings();
  } catch (error) {
    console.warn('Could not open app settings:', error);
  }
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
    limit(NOTIFICATION_QUERY_LIMIT)
  );

  const seenIds = new Set<string>();
  let bootstrapped = false;

  return onSnapshot(
    q,
    (snap) => {
      let playedSoundForBatch = false;
      snap.docs
        .filter((notificationDoc) => (notificationDoc.data() as any)?.isRead === false)
        .forEach((notificationDoc) => {
        const data = notificationDoc.data() as any;
        const notificationId = notificationDoc.id;

        if (!bootstrapped) {
          seenIds.add(notificationId);
          return;
        }

        if (seenIds.has(notificationId)) return;
        seenIds.add(notificationId);

        const title = notificationTitle(data);
        const body = notificationBody(data);
        const targetUrl = notificationTargetUrl(data);

        if (Platform.OS === 'web') {
          if (!playedSoundForBatch) {
            playedSoundForBatch = true;
            void playInAppNotificationSound(data.type);
          }

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
    limit(NOTIFICATION_QUERY_LIMIT)
  );
  return onSnapshot(
    q,
    (snap) => onCount(snap.docs.filter((notificationDoc) => (notificationDoc.data() as any)?.isRead === false).length),
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
    limit(450)
  );
  const snap = await getDocs(unreadQuery);
  if (snap.empty) return;

  const batch = writeBatch(db);
  snap.docs
    .filter((notificationDoc) => (notificationDoc.data() as any)?.isRead === false)
    .slice(0, 450)
    .forEach((notificationDoc) => {
    batch.update(notificationDoc.ref, { isRead: true });
  });
  await batch.commit();
}
