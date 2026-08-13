import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setThemeMode: (nextTheme: Theme) => Promise<void>;
}

const THEME_KEY = 'linkup:theme';
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(THEME_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (stored === 'dark' || stored === 'light') setTheme(stored);
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

  const toggleTheme = () => {
    void setThemeMode(theme === 'dark' ? 'light' : 'dark');
  };

  if (!ready) {
    return (
      <ThemeContext.Provider value={{ theme, toggleTheme, setThemeMode }}>
        {children}
      </ThemeContext.Provider>
    );
  }

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
