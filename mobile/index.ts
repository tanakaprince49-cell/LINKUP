import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { applyBrandFlavor, getStoredBrandFlavorSync } from './src/theme/theme';

// 100% SYNCHRONOUS boot path. The previous version awaited AsyncStorage
// before registering and React Native killed the app with "main has not been
// registered" — registration must happen inside the initial module
// evaluation. expo-sqlite/kv-store gives us the stored brand flavor sync, so
// the flavor is final BEFORE the App module graph builds its StyleSheets.
applyBrandFlavor(getStoredBrandFlavorSync() || 'yellow');

/**
 * Resolve the root component defensively.
 *
 * React error #300 ("Element type is invalid … but got: undefined") was being
 * thrown by Expo's ROOT wrapper — i.e. the component handed to
 * registerRootComponent was not renderable. That happens when `require()` hands
 * back `undefined` (a module graph still winding up: circular import) or a
 * namespace / double-interop wrapper instead of the component.
 *
 * Unwrap through any number of `.default` hops, re-require once the graph has
 * settled, and log hard if it is still not a component — so the next occurrence
 * is named in the console instead of dying in a minified stack.
 */
const unwrapComponent = (value: any, depth = 0): any => {
  if (typeof value === 'function') return value;
  if (value && typeof value === 'object' && depth < 4) return unwrapComponent(value.default, depth + 1);
  return value;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const appModule = require('./App');
let App = unwrapComponent(appModule);
if (typeof App !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  App = unwrapComponent(require('./App'));
}
if (typeof App !== 'function') {
  console.error('[boot] App module did not resolve to a component:', appModule);
}

registerRootComponent(App);
