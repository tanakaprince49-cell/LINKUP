import React from 'react';
import { ActivityIndicator, Platform, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../theme/theme';
import { useTheme } from '../contexts/ThemeContext';

// How long we wait before showing a spinner while a screen chunk loads.
// Preloaded/warm chunks resolve well under this, so on a healthy app the
// user NEVER sees a spinner mid-navigation — the fade animation just plays.
// Only genuinely cold loads (deep screens, slow network on web) ever show it.
const LOADER_GRACE_MS = 220;

/**
 * Is this value something React can render as an element type?
 *
 * React error #300 ("Element type is invalid … but got: undefined") is thrown
 * when a screen chunk resolves to anything else — undefined, a module
 * namespace, a CJS interop wrapper. Rendering it takes down the whole app
 * behind the root error boundary, so we check before we ever render it.
 */
const isRenderable = (value: any) =>
  typeof value === 'function' ||
  (!!value && typeof value === 'object' && (!!value.$$typeof || typeof value.render === 'function'));

/**
 * Reload the page at most once per tab after a chunk fails to load.
 *
 * A deploy renames the JS chunks. A tab left open across a deploy keeps its
 * old entry bundle, so every lazily imported screen 404s until the page is
 * reloaded — the user sees a dead screen (or a crash) and blames the app.
 */
const reloadOnceForStaleBuild = () => {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    if (window.sessionStorage.getItem('linkup:chunk-reload') === '1') return;
    window.sessionStorage.setItem('linkup:chunk-reload', '1');
    window.location?.reload?.();
  } catch {
    // Storage blocked (private mode) — stay put rather than reload-loop.
  }
};

export function lazyScreen(loader: () => Promise<{ default: React.ComponentType<any> }>) {
  let cached: React.ComponentType<any> | null = null;
  let pending: Promise<void> | null = null;
  let failed = false;

  const preload = () => {
    if (cached) return Promise.resolve();
    if (!pending) {
      pending = loader()
        .then((mod) => {
          const resolved = (mod as any)?.default;
          if (!isRenderable(resolved)) {
            // Name the culprit instead of dying with a minified #300.
            console.error('[lazyScreen] chunk did not resolve to a component:', mod);
            throw new Error('Screen chunk did not resolve to a component');
          }
          cached = resolved;
          failed = false;
        })
        .catch((error) => {
          // A failed chunk load (offline web, flaky metro, a chunk that no
          // longer exists after a deploy) must not poison the wrapper forever —
          // reset so the next attempt tries again.
          console.error('[lazyScreen] failed to load screen chunk:', error);
          failed = true;
          pending = null;
          // A deploy replaces the chunk filenames. If this tab is holding an
          // old bundle, its lazy chunks 404 forever — one reload picks up the
          // new build instead of leaving the user stuck on a dead screen.
          if (Platform.OS === 'web') reloadOnceForStaleBuild();
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
    const [attempt, setAttempt] = React.useState(0);

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
    }, [ready, attempt]);

    if (!ready || !cached) {
      // Theme-matched surface — NEVER a hard-coded colour. During the nav
      // fade this reads as the screen itself, so there is no visible blink in
      // light or dark mode. (A static '#0B0B0B' here was the black flash
      // users saw on every page.)
      const surface = {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme === 'dark' ? COLORS.darkBg : COLORS.lightBg,
      } as const;

      // The chunk could not be loaded. Say so and offer a retry instead of
      // spinning forever on a screen that will never arrive.
      if (failed && !cached) {
        return (
          <View style={surface}>
            <Text style={{ color: theme === 'dark' ? COLORS.darkTextSecondary : COLORS.lightTextSecondary, fontSize: 13, fontWeight: '700', marginBottom: 14 }}>
              This screen didn’t load.
            </Text>
            <TouchableOpacity
              onPress={() => setAttempt((value) => value + 1)}
              style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: COLORS.primary }}
            >
              <Text style={{ color: '#000', fontWeight: '900', fontSize: 13 }}>Try again</Text>
            </TouchableOpacity>
          </View>
        );
      }

      return (
        <View style={surface}>
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
