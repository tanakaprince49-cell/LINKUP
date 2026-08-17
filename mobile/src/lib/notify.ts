import { Alert, AlertButton, Platform } from 'react-native';

/**
 * Alert.alert is a silent no-op on react-native-web, which makes whole flows
 * look dead in the browser/PWA (tap something, nothing happens). notifyUser
 * mirrors Alert on native and falls back to window.alert / window.confirm on
 * web, including simple confirm/cancel button pairs.
 */
export const notifyUser = (title: string, message?: string, buttons?: AlertButton[]) => {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }

  const text = [title, message].filter(Boolean).join('\n\n');
  if (typeof window === 'undefined') return;

  const active = (buttons || []).filter((button) => button && button.text);

  if (active.length >= 2) {
    const confirmButton = active.find((button) => button.style !== 'cancel') || active[active.length - 1];
    const cancelButton = active.find((button) => button.style === 'cancel');
    const confirmed = typeof window.confirm === 'function' ? window.confirm(text) : true;
    if (confirmed) {
      confirmButton.onPress?.();
    } else {
      cancelButton?.onPress?.();
    }
    return;
  }

  if (typeof window.alert === 'function') {
    window.alert(text);
  }
  active[0]?.onPress?.();
};
