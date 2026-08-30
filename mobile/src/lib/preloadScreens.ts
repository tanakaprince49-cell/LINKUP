import { InteractionManager, Platform } from 'react-native';

// A lazyScreen() wrapper exposes a real .preload() that populates the SAME
// cache its render path checks. Warming wrappers — not bare require() — is
// what makes first navigations paint instantly. (require() used to run here;
// it parsed the module but never set the wrapper's cached component, so
// every screen still flashed its loading fallback on first visit. That was
// the app-wide blink.)
type Preloadable = { preload?: () => Promise<void> | null };

let profileScreenPreloaded = false;

export const preloadProfileScreen = () => {
  if (profileScreenPreloaded) return;
  profileScreenPreloaded = true;
  require('../screens/ProfileScreen');
};

export const scheduleScreenPreloads = (screens: Preloadable[] = []) => {
  InteractionManager.runAfterInteractions(() => {
    const baseDelay = Platform.OS === 'android' ? 400 : 80;
    // Keep the legacy module warmers (cheap, idempotent)…
    setTimeout(preloadProfileScreen, baseDelay);
    setTimeout(() => {
      require('../screens/ChatScreen');
      require('../screens/AlertsScreen');
    }, baseDelay + 500);
    // …then warm the actual lazy wrappers, staggered so cold start stays
    // smooth and the network (web chunks) isn't hammered all at once.
    screens.forEach((screen, index) => {
      setTimeout(() => {
        try {
          void screen.preload?.()?.catch?.(() => {});
        } catch {
          // Preloading is best-effort; a screen that fails here still works
          // when the user actually navigates to it.
        }
      }, baseDelay + 300 + index * 250);
    });
  });
};
