import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { useTheme } from '../contexts/ThemeContext';

const offlineCat = require('../../assets/offline-cat.png');

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
        <View style={styles.catCard}>
          <Image source={offlineCat} style={styles.catImage} resizeMode="cover" />
        </View>
        <Text style={[styles.title, { color: textColor(isDark) }]}>No internet connection</Text>
        <Text style={[styles.subtitle, { color: textColor(isDark, 'secondary') }]}>
          The cat pulled the cable again.
        </Text>
        <Text style={[styles.joke, { color: textColor(isDark, 'muted') }]}>{line}</Text>
        <Text style={[styles.hint, { color: textColor(isDark, 'muted') }]}>
          Check your data or Wi-Fi, then give it another go.
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
  inner: { flex: 1, paddingHorizontal: 28, justifyContent: 'center', alignItems: 'center' },
  catCard: {
    width: 220,
    height: 220,
    borderRadius: 32,
    overflow: 'hidden',
    marginBottom: 26,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  catImage: { width: '100%', height: '100%' },
  title: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: { fontSize: 15, fontWeight: '700', textAlign: 'center', marginBottom: 14 },
  joke: { fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 19, marginBottom: 6 },
  hint: { fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 19, marginBottom: 22 },
  btn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 34,
    paddingVertical: 14,
    borderRadius: 16,
  },
  btnText: { color: '#000', fontSize: 15, fontWeight: '900', letterSpacing: 0.2 },
});
