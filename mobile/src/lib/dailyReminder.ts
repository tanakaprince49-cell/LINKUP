import { Platform } from 'react-native';

let scheduled = false;

const REMINDERS = [
  { hour: 9, minute: 0, body: 'Good morning! Check who\'s been viewing your profile overnight. 🔍' },
  { hour: 12, minute: 0, body: 'Your daily matches are ready — see who wants to connect. 🤝' },
  { hour: 15, minute: 30, body: 'Afternoon networking break. New builders joined LINKUP today. ⚡' },
  { hour: 18, minute: 0, body: 'Someone\'s waiting to connect — jump back in! 🚀' },
  { hour: 20, minute: 30, body: 'Evening scroll? Your PLAY streak and messages are waiting. 🌙' },
];

export async function scheduleDailyReminder(): Promise<void> {
  if (scheduled || Platform.OS === 'web') return;

  try {
    const Notifications = await import('expo-notifications');

    for (const reminder of REMINDERS) {
      const id = `daily_reminder_${reminder.hour}_${reminder.minute}`;
      await Notifications.cancelScheduledNotificationAsync(id as any);
    }

    for (const reminder of REMINDERS) {
      const id = `daily_reminder_${reminder.hour}_${reminder.minute}`;
      await Notifications.scheduleNotificationAsync({
        identifier: id,
        content: {
          title: 'LINKUP',
          body: reminder.body,
          sound: true,
          priority: Notifications.AndroidNotificationPriority?.HIGH ?? 'high',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes?.DAILY ?? 'daily',
          hour: reminder.hour,
          minute: reminder.minute,
        } as any,
      });
    }

    scheduled = true;
  } catch (e) {
    console.warn('Failed to schedule daily reminders:', e);
  }
}
