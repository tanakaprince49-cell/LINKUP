import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { COLORS } from '../theme/theme';
import { useTheme } from '../contexts/ThemeContext';

// How long we wait before showing a spinner while a screen chunk loads.
// Preloaded/warm chunks resolve well under this, so on a healthy app the
// user NEVER sees a spinner mid-navigation — the fade animation just plays.
// Only genuinely cold loads (deep screens, slow network on web) ever show it.
const LOADER_GRACE_MS = 220;

export function lazyScreen(loader: () => Promise<{ default: React.ComponentType<any> }>) {
  let cached: React.ComponentType<any> | null = null;
  let pending: Promise<void> | null = null;

  const preload = () => {
    if (cached) return Promise.resolve();
    if (!pending) {
      pending = loader()
        .then((mod) => {
          cached = mod.default;
        })
        .catch(() => {
          // A failed chunk load (offline web, flaky metro) must not poison the
          // wrapper forever — reset so the next attempt tries again.
          pending = null;
        });
    }
    return pending;
  };

  function LazyRoute(props: any) {
    const { theme } = useTheme();
    // If a preload (or earlier visit) resolved the chunk before we mounted,
    // the very first render IS the actual screen — zero fallback frames.
    const [ready, setReady] = React.useState(() => cached != null);
    const [showLoader, setShowLoader] = React.useState(false);

    React.useEffect(() => {
      if (ready) return;
      let cancelled = false;
      const grace = setTimeout(() => {
        if (!cancelled) setShowLoader(true);
      }, LOADER_GRACE_MS);
      void preload()?.then(() => {
        if (!cancelled) setReady(true);
      });
      return () => {
        cancelled = true;
        clearTimeout(grace);
      };
    }, [ready]);

    if (!ready || !cached) {
      // Theme-matched surface — NEVER a hard-coded colour. During the nav
      // fade this reads as the screen itself, so there is no visible blink in
      // light or dark mode. (A static '#0B0B0B' here was the black flash
      // users saw on every page.)
      return (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme === 'dark' ? COLORS.darkBg : COLORS.lightBg,
          }}
        >
          {showLoader ? <ActivityIndicator color={COLORS.primaryStrong} /> : null}
        </View>
      );
    }

    const Screen = cached;
    return <Screen {...props} />;
  }

  LazyRoute.preload = preload;
  return LazyRoute;
}
