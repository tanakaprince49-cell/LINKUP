import 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerRootComponent } from 'expo';
import { applyBrandFlavor, BRAND_FLAVOR_KEY } from './src/theme/theme';

// Apply the stored brand flavor (white monochrome / OG yellow) BEFORE the app
// module graph loads: screens build their StyleSheets from COLORS at import
// time, so the palette must be final before the first screen module evaluates.
async function bootstrap() {
  try {
    const flavor = await AsyncStorage.getItem(BRAND_FLAVOR_KEY);
    if (flavor === 'yellow' || flavor === 'white') applyBrandFlavor(flavor);
  } catch {
    /* default white stands */
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const App = require('./App').default;
  registerRootComponent(App);
}

void bootstrap();
