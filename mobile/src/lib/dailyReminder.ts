import { Platform } from 'react-native';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from './firebase';

const FAKE_REMINDER_IDS = [
  'daily_reminder_9_0',
  'daily_reminder_12_0',
  'daily_reminder_15_30',
  'daily_reminder_18_0',
  'daily_reminder_20_30',
];

const EVENT_REMINDER_ID = 'linkup_real_event_reminder';

async function loadNotifications() {
  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

export async function cancelFakeDailyReminders(): Promise<void> {
  if (Platform.OS === 'web') return;
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  for (const id of FAKE_REMINDER_IDS) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id as any);
    } catch {
      // Best effort.
    }
  }
}

/** Only schedule a local ping when the user already has a real unread event. */
export async function syncEventReminders(userId?: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await cancelFakeDailyReminders();
  if (!userId) return;

  const Notifications = await loadNotifications();
  if (!Notifications) return;

  try {
    await Notifications.cancelScheduledNotificationAsync(EVENT_REMINDER_ID as any);
  } catch {
    // ignore
  }

  try {
    const snap = await getDocs(
      query(collection(db, 'notifications'), where('userId', '==', userId), limit(40))
    );
    const unread = snap.docs.filter((docSnap) => (docSnap.data() as any)?.isRead === false);
    if (unread.length === 0) return;

    const first = unread[0].data() as any;
    const body =
      first?.type === 'message'
        ? `${first.fromName || 'Someone'} messaged you.`
        : first?.type === 'match'
          ? 'You have a new match waiting.'
          : first?.type === 'like'
            ? `${first.fromName || 'Someone'} liked your profile.`
            : first?.content || 'You have something new on LINKUP.';

    await Notifications.scheduleNotificationAsync({
      identifier: EVENT_REMINDER_ID,
      content: {
        title: 'LINKUP',
        body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority?.HIGH ?? 'high',
      },
      trigger: { type: 'timeInterval', seconds: 90 * 60, repeats: false } as any,
    });
  } catch (error) {
    console.warn('Event reminder sync skipped:', error);
  }
}

/** Kept for existing imports — no more fake 5x daily pings. */
export async function scheduleDailyReminder(userId?: string): Promise<void> {
  await syncEventReminders(userId);
}
