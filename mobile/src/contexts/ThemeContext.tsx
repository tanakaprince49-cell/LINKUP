import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyBrandFlavor, BrandFlavor, BRAND_FLAVOR_KEY, getStoredBrandFlavorSync, storeBrandFlavorSync } from '../theme/theme';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  themeReady: boolean;
  toggleTheme: () => void;
  setThemeMode: (nextTheme: Theme) => Promise<void>;
  brandFlavor: BrandFlavor;
  setBrandFlavor: (flavor: BrandFlavor) => Promise<void>;
}

const THEME_KEY = 'linkup:theme';
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>('light');
  // Sync source of truth (kv-store/localStorage) — matches what index.ts
  // applied pre-boot, so context never disagrees with the module palettes.
  const [brandFlavor, setBrandFlavorState] = useState<BrandFlavor>(() => getStoredBrandFlavorSync() || 'yellow');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([AsyncStorage.getItem(THEME_KEY), AsyncStorage.getItem(BRAND_FLAVOR_KEY)])
      .then(([storedTheme, legacyFlavor]) => {
        if (cancelled) return;
        if (storedTheme === 'dark' || storedTheme === 'light') setTheme(storedTheme);
        // One-way legacy migration: a flavor only in AsyncStorage moves into
        // the sync store once, then AsyncStorage stops being the truth.
        if (!getStoredBrandFlavorSync() && (legacyFlavor === 'white' || legacyFlavor === 'yellow')) {
          storeBrandFlavorSync(legacyFlavor);
          applyBrandFlavor(legacyFlavor);
          setBrandFlavorState(legacyFlavor);
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setThemeMode = async (nextTheme: Theme) => {
    setTheme(nextTheme);
    await AsyncStorage.setItem(THEME_KEY, nextTheme).catch(() => {});
  };

  const setBrandFlavor = async (flavor: BrandFlavor) => {
    // Live: apply now for render-time COLORS reads; persist to the SYNC store
    // so the next cold boot applies it before any StyleSheet is built.
    applyBrandFlavor(flavor);
    storeBrandFlavorSync(flavor);
    setBrandFlavorState(flavor);
    await AsyncStorage.setItem(BRAND_FLAVOR_KEY, flavor).catch(() => {});
  };

  const toggleTheme = () => {
    void setThemeMode(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, themeReady: ready, toggleTheme, setThemeMode, brandFlavor, setBrandFlavor }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
