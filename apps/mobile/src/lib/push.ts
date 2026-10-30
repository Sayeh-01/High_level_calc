import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { post } from './api';

/**
 * Registers this device's Expo push token. Native only: remote push doesn't exist on web and was removed from
 * Expo Go on Android (B7 #6), so this needs a development build — see REPORT device checks.
 */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const Notifications = await import('expo-notifications');
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return null;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Circle', importance: Notifications.AndroidImportance.DEFAULT });
    }
    // actions inside the notification (✓ Done, I'm in, Paid)
    await Notifications.setNotificationCategoryAsync('task', [{ identifier: 'done', buttonTitle: '✓ Done' }]);
    await Notifications.setNotificationCategoryAsync('rsvp', [{ identifier: 'going', buttonTitle: "I'm in" }]);
    await Notifications.setNotificationCategoryAsync('settle', [{ identifier: 'confirm', buttonTitle: 'Confirm' }]);
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await post('/me/push-tokens', { token, platform: Platform.OS });
    return token;
  } catch (e) {
    console.warn('[push] registration failed', e);
    return null;
  }
}
