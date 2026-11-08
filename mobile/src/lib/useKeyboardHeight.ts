import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Height of the on-screen keyboard (0 when hidden).
 *
 * KeyboardAvoidingView with an iOS-only `behavior` does nothing on Android,
 * so composers and form footers pinned to the bottom of the screen stayed
 * underneath the keyboard while typing. Screens use this hook instead: pad
 * the bottom container with the returned height and the composer/form rises
 * to sit exactly on top of the keyboard; when the keyboard closes the
 * height falls back to 0 and the container returns to its inset padding.
 *
 * `onShow` (optional) fires when the keyboard appears — chat screens use it
 * to scroll the thread to the latest message.
 */
export function useKeyboardHeight(onShow?: () => void): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent as any, (e: any) => {
      setHeight(e?.endCoordinates?.height || 0);
      onShow?.();
    });
    const hide = Keyboard.addListener(hideEvent as any, () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return height;
}
