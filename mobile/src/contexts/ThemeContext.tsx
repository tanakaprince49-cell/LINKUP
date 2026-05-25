import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Theme = 'light' | 'dark';
const THEME_KEY = 'linkup:theme';
const LEGACY_THEME_KEY = 'theme';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setThemeMode: (nextTheme: Theme) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const normalizeTheme = (value: string | null | undefined): Theme | null =>
  value === 'dark' || value === 'light' ? value : null;

const readWebTheme = () => {
  if (Platform.OS !== 'web') return null;
  try {
    const storage = (globalThis as any)?.localStorage;
    return normalizeTheme(storage?.getItem(THEME_KEY)) || normalizeTheme(storage?.getItem(LEGACY_THEME_KEY));
  } catch {
    return null;
  }
};

const writeWebTheme = (nextTheme: Theme) => {
  if (Platform.OS !== 'web') return;
  try {
    const storage = (globalThis as any)?.localStorage;
    storage?.setItem(THEME_KEY, nextTheme);
    storage?.setItem(LEGACY_THEME_KEY, nextTheme);
  } catch {
    // Browser storage may be blocked in private/in-app browsers. AsyncStorage remains the fallback.
  }
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => readWebTheme() || 'light');

  useEffect(() => {
    const loadTheme = async () => {
      const webTheme = readWebTheme();
      if (webTheme) {
        setTheme(webTheme);
        await AsyncStorage.setItem(THEME_KEY, webTheme).catch(() => {});
        await AsyncStorage.setItem(LEGACY_THEME_KEY, webTheme).catch(() => {});
        return;
      }

      const saved =
        normalizeTheme(await AsyncStorage.getItem(THEME_KEY)) ||
        normalizeTheme(await AsyncStorage.getItem(LEGACY_THEME_KEY));

      setTheme(saved || 'light');
    };
    loadTheme();
  }, []);

  const setThemeMode = async (nextTheme: Theme) => {
    setTheme(nextTheme);
    writeWebTheme(nextTheme);
    await AsyncStorage.setItem(THEME_KEY, nextTheme);
    await AsyncStorage.setItem(LEGACY_THEME_KEY, nextTheme);
  };

  const toggleTheme = async () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    await setThemeMode(nextTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setThemeMode }}>
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
