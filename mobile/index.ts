import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { applyBrandFlavor, getStoredBrandFlavorSync } from './src/theme/theme';

// 100% SYNCHRONOUS boot path. The previous version awaited AsyncStorage
// before registering and React Native killed the app with "main has not been
// registered" — registration must happen inside the initial module
// evaluation. expo-sqlite/kv-store gives us the stored brand flavor sync, so
// the flavor is final BEFORE the App module graph builds its StyleSheets.
applyBrandFlavor(getStoredBrandFlavorSync() || 'yellow');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const App = require('./App').default;
registerRootComponent(App);
