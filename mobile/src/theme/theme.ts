import { Platform } from 'react-native';

/** One visual language for every LINKUP screen. */
export const COLORS = {
  primary: '#FBE618',
  primaryGlow: 'rgba(251, 230, 24, 0.16)',
  primaryStrong: '#C9B400',
  secondary: '#0B1220',
  tertiary: '#42526B',
  success: '#16A34A',
  danger: '#E11D48',
  warning: '#D97706',

  darkBg: '#0A0B0D',
  darkBgSec: '#12141A',
  darkCard: '#171A21',
  darkGlassStrong: '#1C2028',
  darkBorder: 'rgba(255, 255, 255, 0.10)',
  darkBorderActive: 'rgba(251, 230, 24, 0.45)',
  darkTextPrimary: '#F4F5F7',
  darkTextSecondary: '#A8B0BD',
  darkTextMuted: '#6E7683',

  lightBg: '#F7F7F5',
  lightBgSec: '#FFFFFF',
  lightCard: '#FFFFFF',
  lightGlassStrong: '#FFFFFF',
  lightBorder: 'rgba(11, 18, 32, 0.08)',
  lightBorderActive: 'rgba(201, 180, 0, 0.45)',
  lightTextPrimary: '#0B1220',
  lightTextSecondary: '#4B5563',
  lightTextMuted: '#8A93A0',
};

export const RADIUS = {
  sm: 10,
  md: 14,
  lg: 16,
  xl: 20,
  pill: 999,
};

export const SPACE = {
  screen: 20,
  card: 16,
  gap: 12,
};

export const TYPE = {
  hero: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.7, lineHeight: 36 },
  title: { fontSize: 22, fontWeight: '800' as const, letterSpacing: -0.4, lineHeight: 28 },
  section: { fontSize: 16, fontWeight: '800' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '600' as const, lineHeight: 22 },
  meta: { fontSize: 13, fontWeight: '600' as const, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '700' as const },
  button: { fontSize: 16, fontWeight: '800' as const },
};

export const GLASS_SHADOW = Platform.select({
  ios: {
    shadowColor: '#0B1220',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
  },
  android: { elevation: 1 },
  default: {},
});

export const liquidGlass = (isDark: boolean, elevated = true) => ({
  backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard,
  borderWidth: 1,
  borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
  borderRadius: RADIUS.lg,
  ...(elevated ? GLASS_SHADOW : {}),
});

export const appBackground = (isDark: boolean) => ({
  backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg,
});

export const hairline = (isDark: boolean) =>
  isDark ? COLORS.darkBorder : COLORS.lightBorder;

export const textColor = (isDark: boolean, tone: 'primary' | 'secondary' | 'muted' = 'primary') => {
  if (tone === 'secondary') return isDark ? COLORS.darkTextSecondary : COLORS.lightTextSecondary;
  if (tone === 'muted') return isDark ? COLORS.darkTextMuted : COLORS.lightTextMuted;
  return isDark ? COLORS.darkTextPrimary : COLORS.lightTextPrimary;
};

export const THEME = {
  colors: COLORS,
  radius: RADIUS,
  space: SPACE,
  type: TYPE,
  glass: {
    dark: {
      backgroundColor: COLORS.darkCard,
      borderWidth: 1,
      borderColor: COLORS.darkBorder,
      borderRadius: RADIUS.lg,
      ...GLASS_SHADOW,
    },
    light: {
      backgroundColor: COLORS.lightCard,
      borderWidth: 1,
      borderColor: COLORS.lightBorder,
      borderRadius: RADIUS.lg,
      ...GLASS_SHADOW,
    },
  },
  typography: {
    fontFamily: 'System',
    logo: { fontSize: 18, fontWeight: '800' as const, letterSpacing: 0.4 },
    hero: TYPE.hero,
    title: TYPE.title,
    subtitle: TYPE.body,
    bodyBold: { fontSize: 15, fontWeight: '700' as const },
    body: TYPE.body,
    caption: TYPE.meta,
  },
};
