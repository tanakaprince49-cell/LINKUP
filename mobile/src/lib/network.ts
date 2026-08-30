import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

const pingOnline = async () => {
  if (typeof navigator !== 'undefined' && 'onLine' in navigator && navigator.onLine === false) {
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    await fetch('https://clients3.google.com/generate_204', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      ...(Platform.OS === 'web' ? { mode: 'no-cors' as RequestMode } : {}),
    });
    return true;
  } catch {
    try {
      await fetch('https://www.gstatic.com/generate_204', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        ...(Platform.OS === 'web' ? { mode: 'no-cors' as RequestMode } : {}),
      });
      return true;
    } catch {
      return false;
    }
  } finally {
    clearTimeout(timer);
  }
};

export function useOnlineStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const next = await pingOnline();
      if (!cancelled) setOnline(next);
    };
    check();
    const interval = setInterval(check, 7000);
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    const onBrowser = () => check();
    nav?.addEventListener?.('online', onBrowser);
    nav?.addEventListener?.('offline', onBrowser);
    return () => {
      cancelled = true;
      clearInterval(interval);
      appSub.remove();
      nav?.removeEventListener?.('online', onBrowser);
      nav?.removeEventListener?.('offline', onBrowser);
    };
  }, []);

  return online;
}
