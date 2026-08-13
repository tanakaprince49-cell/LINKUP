import AsyncStorage from '@react-native-async-storage/async-storage';
import { Share, Platform } from 'react-native';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { displayNameFor } from './discovery';

const welcomeKey = (uid: string) => `linkup:concierge-welcome:v1:${uid}`;

export const LINKUP_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.tana.linkup';

export const LINKUP_INVITE_MESSAGE =
  `Come build with me on LINKUP — find cofounders and people who actually ship.\n${LINKUP_PLAY_STORE_URL}`;

export async function shareLinkupInvite() {
  const message = LINKUP_INVITE_MESSAGE;
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && (navigator as any).share) {
      await (navigator as any).share({ title: 'LINKUP', text: message });
      return;
    }
    await Share.share({ message, title: 'Invite a builder to LINKUP' });
  } catch (error) {
    console.warn('Invite share skipped:', error);
  }
}

export async function seedConciergeWelcome(userId: string, profile?: any) {
  if (!userId) return;
  try {
    const already = await AsyncStorage.getItem(welcomeKey(userId));
    if (already) return;

    const name = displayNameFor(profile || { displayName: 'there' });
    await addDoc(collection(db, 'notifications'), {
      userId,
      fromId: userId,
      fromName: 'LINKUP Concierge',
      fromPic: '',
      type: 'system',
      content: `Welcome ${name.split(' ')[0]}. The network is still small in your area — invite 3 builders, swipe anyone already here, or tell us who you need and a human will try to intro you.`,
      isRead: false,
      timestamp: serverTimestamp(),
    });

    await AsyncStorage.setItem(welcomeKey(userId), new Date().toISOString());
  } catch (error) {
    console.warn('Concierge welcome skipped:', error);
  }
}
