import { Platform } from 'react-native';

export const COLORS = {
  // Brand
  primary: '#FBE618',      // LINKUP Signal Yellow
  primaryGlow: 'rgba(251, 230, 24, 0.18)',
  primaryStrong: '#E8D000', // Darker yellow for borders/accents
  secondary: '#00C2FF',    // Liquid Cyan
  tertiary: '#7C3AED',     // Violet Accent
  success: '#28E7A8',      // Mint Green
  danger: '#FF4D6D',       // Signal Rose
  warning: '#FFB020',      // Warm Amber

  // Dark Mode Palette (Premium Tech Noir / Glass)
  darkBg: '#05070D',
  darkBgSec: '#0B1020',
  darkCard: 'rgba(16, 21, 34, 0.68)',
  darkGlassStrong: 'rgba(20, 28, 44, 0.82)',
  darkBorder: 'rgba(255, 255, 255, 0.14)',
  darkBorderActive: 'rgba(251, 230, 24, 0.48)',
  darkTextPrimary: '#FFFFFF',
  darkTextSecondary: '#B7C0D8',
  darkTextMuted: '#718096',

  // Light Mode Palette (Sleek Daylight Glass)
  lightBg: '#F4F7FB',
  lightBgSec: '#EAF0F8',
  lightCard: 'rgba(255, 255, 255, 0.74)',
  lightGlassStrong: 'rgba(255, 255, 255, 0.9)',
  lightBorder: 'rgba(15, 23, 42, 0.1)',
  lightBorderActive: 'rgba(251, 230, 24, 0.38)',
  lightTextPrimary: '#0B1220',
  lightTextSecondary: '#42526B',
  lightTextMuted: '#8492A6',
};

export const GLASS_SHADOW = {
  shadowColor: '#07111F',
  shadowOffset: { width: 0, height: 18 },
  shadowOpacity: 0.18,
  shadowRadius: 30,
  elevation: 10,
};

export const liquidGlass = (isDark: boolean, elevated = true) => ({
  backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec,
  borderWidth: 1,
  borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
  ...(elevated ? GLASS_SHADOW : {}),
});

export const appBackground = (isDark: boolean) => ({
  backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg,
});

export const textColor = (isDark: boolean, tone: 'primary' | 'secondary' | 'muted' = 'primary') => {
  if (tone === 'secondary') return isDark ? COLORS.darkTextSecondary : COLORS.lightTextSecondary;
  if (tone === 'muted') return isDark ? COLORS.darkTextMuted : COLORS.lightTextMuted;
  return isDark ? COLORS.darkTextPrimary : COLORS.lightTextPrimary;
};

export const THEME = {
  colors: COLORS,
  glass: {
    dark: {
      backgroundColor: COLORS.darkCard,
      borderWidth: 1,
      borderColor: COLORS.darkBorder,
      borderRadius: 24,
      ...GLASS_SHADOW,
    },
    light: {
      backgroundColor: COLORS.lightCard,
      borderWidth: 1,
      borderColor: COLORS.lightBorder,
      borderRadius: 24,
      ...GLASS_SHADOW,
    },
  },
  typography: {
    fontFamily: 'System',
    logo: {
      fontSize: 24,
      fontWeight: '900' as const,
      letterSpacing: -0.5,
    },
    hero: {
      fontSize: 48,
      fontWeight: '900' as const,
      letterSpacing: -1.5,
      lineHeight: 52,
      fontStyle: 'italic' as const,
    },
    title: {
      fontSize: 20,
      fontWeight: '800' as const,
      letterSpacing: 0.5,
      textTransform: 'uppercase' as const,
      fontStyle: 'italic' as const,
    },
    subtitle: {
      fontSize: 14,
      fontWeight: '500' as const,
      lineHeight: 22,
    },
    bodyBold: {
      fontSize: 14,
      fontWeight: '700' as const,
    },
    body: {
      fontSize: 14,
      fontWeight: '400' as const,
    },
    caption: {
      fontSize: 11,
      fontWeight: '600' as const,
      letterSpacing: 0.5,
    },
  },
};
