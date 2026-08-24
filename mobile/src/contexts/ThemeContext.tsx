import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyBrandFlavor, BrandFlavor, BRAND_FLAVOR_KEY } from '../theme/theme';

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
  const [brandFlavor, setBrandFlavorState] = useState<BrandFlavor>('white');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([AsyncStorage.getItem(THEME_KEY), AsyncStorage.getItem(BRAND_FLAVOR_KEY)])
      .then(([storedTheme, storedFlavor]) => {
        if (cancelled) return;
        if (storedTheme === 'dark' || storedTheme === 'light') setTheme(storedTheme);
        if (storedFlavor === 'white' || storedFlavor === 'yellow') {
          applyBrandFlavor(storedFlavor);
          setBrandFlavorState(storedFlavor);
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
    // Live: inline/render-time COLORS reads flip immediately via re-render.
    // Module-level StyleSheets capture it fully on next app start (index.ts
    // applies the flavor before the module graph loads).
    applyBrandFlavor(flavor);
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
