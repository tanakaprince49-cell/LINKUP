import { Platform } from 'react-native';

let scheduled = false;

export async function scheduleDailyReminder(): Promise<void> {
  if (scheduled || Platform.OS === 'web') return;

  try {
    const Notifications = await import('expo-notifications');

    await Notifications.cancelScheduledNotificationAsync('daily_reminder');

    await Notifications.scheduleNotificationAsync({
      identifier: 'daily_reminder',
      content: {
        title: 'LINKUP',
        body: 'Someone\'s waiting to connect — jump back in! 🚀',
        sound: true,
        priority: Notifications.AndroidNotificationPriority?.HIGH ?? 'high',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes?.DAILY ?? 'daily',
        hour: 18,
        minute: 0,
      } as any,
    });

    scheduled = true;
  } catch (e) {
    console.warn('Failed to schedule daily reminder:', e);
  }
}