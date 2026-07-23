import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions, Alert,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { RefreshCw, Heart, Share2, Zap, Star } from 'lucide-react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const PREFIXES = [
  'AI', 'Meta', 'Neo', 'Hyper', 'Flux', 'Pulse', 'Nova', 'Vibe', 'Zen',
  'Cloud', 'Byte', 'Swift', 'Bright', 'Bold', 'First', 'Next', 'Uni',
];
const SUFFIXES = [
  'Hub', 'Sync', 'Link', 'Stack', 'Flow', 'Works', 'Force', 'Mind', 'Mesh',
  'Wave', 'Spark', 'Craft', 'Labs', 'Forge', 'Bridge', 'Pilot', 'Shift',
];
const DESCRIPTIONS = [
  'AI-powered marketplace connecting freelancers with global brands',
  'The easiest way to manage team standups and async updates',
  'Democratizing access to commercial real estate data',
  'Peer-to-peer lending for creative projects',
  'Carbon-neutral delivery network for local businesses',
  'No-code mobile app builder for enterprise teams',
  'Smart calendar that optimizes your deep work hours',
  'Subscription box for indie developer tools',
  'API-first identity verification for Web3',
  'Community-driven investment insights platform',
  'Automated compliance monitoring for fintech startups',
  'On-demand warehouse space for small e-commerce brands',
];

interface Pitch {
  name: string;
  description: string;
  rating: number;
}

const PitchPerfectScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [faves, setFaves] = useState<string[]>([]);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const generatePitch = useCallback(() => {
    const p1 = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
    const p2 = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
    const s = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
    const d = DESCRIPTIONS[Math.floor(Math.random() * DESCRIPTIONS.length)];
    const nameOptions = [
      `${p1}${s}`,
      `${p2}${s}`,
      `${p1} ${s}`,
      `${p2}${p1}`,
    ];
    const name = nameOptions[Math.floor(Math.random() * nameOptions.length)];
    setPitch({ name, description: d, rating: 0 });

    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();
  }, [scaleAnim]);

  const savePitch = useCallback(() => {
    if (!pitch) return;
    setSaved((prev) => [...prev, pitch.name]);
    setFaves((prev) => [...prev, pitch.name]);
    setPitch((prev) => prev ? { ...prev, rating: 1 } : null);
  }, [pitch]);

  const sharePitch = useCallback(async () => {
    if (!pitch) return;
    try {
      await Share.share({
        message: `Check out my startup idea: **${pitch.name}** — ${pitch.description}\n\nBuilt with LINKUP Pitch Perfect 🚀`,
      });
    } catch (_) {}
  }, [pitch]);

  return (
    <SafeAreaView style={[styles.root, appBackground(isDark)]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: textColor(isDark) }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: textColor(isDark) }]}>Pitch Perfect</Text>
        <View style={styles.headerRight} />
      </View>

      <View style={styles.subtitleRow}>
        <Zap size={14} color={COLORS.primary} />
        <Text style={[styles.subtitle, { color: textColor(isDark, 'muted') }]}>
          Random startup ideas, infinite possibilities
        </Text>
      </View>

      {!pitch && (
        <View style={styles.placeholder}>
          <Text style={[styles.placeholderEmoji]}>💭</Text>
          <Text style={[styles.placeholderText, { color: textColor(isDark, 'muted') }]}>
            Tap generate to create your next unicorn
          </Text>
        </View>
      )}

      {pitch && (
        <Animated.View style={[styles.pitchCard, { transform: [{ scale: scaleAnim }], backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
          <Text style={styles.pitchName}>{pitch.name}</Text>
          <View style={styles.divider} />
          <Text style={[styles.pitchDesc, { color: textColor(isDark, 'muted') }]}>{pitch.description}</Text>
          <View style={styles.pitchRating}>
            {[1, 2, 3, 4, 5].map((r) => (
              <Star
                key={r}
                size={18}
                color={COLORS.primary}
                fill={pitch.rating >= r ? COLORS.primary : 'transparent'}
              />
            ))}
          </View>
        </Animated.View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]} onPress={generatePitch}>
          <RefreshCw size={18} color={COLORS.primary} />
          <Text style={styles.actionLabel}>Generate</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.faveBtn]}
          onPress={savePitch}
          disabled={!pitch}
        >
          <Heart size={18} color="#FFF" />
          <Text style={[styles.actionLabel, { color: '#FFF' }]}>Fave</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: '#FFF' }]}
          onPress={sharePitch}
          disabled={!pitch}
        >
          <Share2 size={18} color="#000" />
          <Text style={[styles.actionLabel, { color: '#000' }]}>Share</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
          <Text style={[styles.statText, { color: textColor(isDark) }]}>
            Ideas generated: {saved.length}
          </Text>
        </View>
        <View style={[styles.statChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
          <Text style={[styles.statText, { color: textColor(isDark) }]}>
            Faves: {faves.length}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 16, fontWeight: '800' },
  title: { fontSize: 20, fontWeight: '900', fontStyle: 'italic', letterSpacing: -0.5 },
  headerRight: { width: 60 },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 20,
  },
  subtitle: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  placeholderEmoji: { fontSize: 48 },
  placeholderText: { fontSize: 13, fontWeight: '600', maxWidth: 200, textAlign: 'center' },
  pitchCard: {
    marginHorizontal: 24,
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    gap: 16,
  },
  pitchName: {
    fontSize: 32,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: -1,
    color: COLORS.primary,
    textAlign: 'center',
  },
  divider: {
    width: 40,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
    opacity: 0.5,
  },
  pitchDesc: { fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 20 },
  pitchRating: { flexDirection: 'row', gap: 4 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 24,
    marginBottom: 16,
    paddingHorizontal: 24,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 16,
  },
  faveBtn: { backgroundColor: '#FF3B5C' },
  actionLabel: { fontSize: 11, fontWeight: '900', color: COLORS.primary, letterSpacing: 0.3 },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
  },
  statChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statText: { fontSize: 11, fontWeight: '700' },
});

export default PitchPerfectScreen;