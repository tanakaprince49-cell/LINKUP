import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WifiOff } from 'lucide-react-native';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { useTheme } from '../contexts/ThemeContext';
import BrandMark from './BrandMark';

const LINES = [
  'Your Wi-Fi went to get milk and never came back.',
  'The internet is on a coffee break. Very long coffee.',
  'Packets left the group chat. You are offline.',
  'Even pigeons carrying USB sticks would be faster right now.',
  'LINKUP is here. The internet is… emotionally unavailable.',
  'We checked under the router. Nothing but dust and hope.',
];

export default function OfflineScreen({ onRetry }: { onRetry?: () => void }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const line = useMemo(() => LINES[Math.floor(Math.random() * LINES.length)], []);

  return (
    <SafeAreaView style={[styles.root, appBackground(isDark)]}>
      <View style={styles.inner}>
        <View style={styles.logoWrap}>
          <BrandMark size={64} />
        </View>
        <View style={styles.iconCircle}>
          <WifiOff size={28} color="#111" />
        </View>
        <Text style={[styles.title, { color: textColor(isDark) }]}>No internet. Bold choice.</Text>
        <Text style={[styles.joke, { color: textColor(isDark, 'secondary') }]}>{line}</Text>
        <Text style={[styles.hint, { color: textColor(isDark, 'muted') }]}>
          Turn data back on, poke the router, or walk closer to a window like it’s 2009.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={onRetry} activeOpacity={0.88}>
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { flex: 1, paddingHorizontal: 28, justifyContent: 'center' },
  logoWrap: {
    width: 80,
    height: 80,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.7, lineHeight: 36 },
  joke: { marginTop: 10, fontSize: 16, fontWeight: '600', lineHeight: 24 },
  hint: { marginTop: 10, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  btn: {
    marginTop: 28,
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontSize: 16, fontWeight: '800', color: '#111' },
});
