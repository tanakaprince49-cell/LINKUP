import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { doc, updateDoc, arrayUnion, collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotificationsAsync(userId: string) {
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
    token = (await Notifications.getExpoPushTokenAsync()).data;
    
    // Save token to Firestore
    await updateDoc(doc(db, 'users', userId), {
      pushTokens: arrayUnion(token)
    });
  } else {
    console.log('Must use physical device for Push Notifications');
  }

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
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
  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    where('isRead', '==', false)
  );
  return onSnapshot(
    q,
    (snap) => onCount(snap.size),
    (err) => {
      console.error('Unread notifications listener error:', err);
      onCount(0);
    }
  );
}
