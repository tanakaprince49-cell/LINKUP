import { Platform } from 'react-native';

export function blurActiveElementOnWeb() {
  if (Platform.OS !== 'web') return;

  const activeElement = (globalThis as any)?.document?.activeElement;
  if (activeElement && typeof activeElement.blur === 'function') {
    activeElement.blur();
  }
}
