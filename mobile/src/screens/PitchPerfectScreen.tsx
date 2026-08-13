import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions,
  Share, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { RefreshCw, Heart, Share2, Zap, Lightbulb, Trophy, Swords, CheckCircle2, Loader } from 'lucide-react-native';
import GameChallengeModal from '../components/GameChallengeModal';
import { submitChallengeScore, subscribeToChallenge, GameChallenge, setPlayerJoined } from '../lib/gameChallenges';
import { useAuth } from '../contexts/AuthContext';

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
}

const PitchPerfectScreen: React.FC<{ navigation: any; route?: any }> = ({ navigation, route }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { user } = useAuth();
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [faves, setFaves] = useState<string[]>([]);
  const [challengeVisible, setChallengeVisible] = useState(false);
  const incomingChallengeId = route?.params?.challengeId as string | undefined;
  const [challengeId, setChallengeId] = useState<string | null>(incomingChallengeId || null);
  const [challengeResult, setChallengeResult] = useState<GameChallenge | null>(null);
  const waitingRef = useRef(!!incomingChallengeId);
  const [waitingForOpponent, setWaitingForOpponent] = useState(!!incomingChallengeId);
  const [countdown, setCountdown] = useState(0);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Challenge sync: set joined + wait for opponent
  useEffect(() => {
    if (!challengeId || !user?.uid) return;
    let cancelled = false;
    void setPlayerJoined(challengeId, user.uid);
    const unsub = subscribeToChallenge(challengeId, (c) => {
      if (cancelled || !c) return;
      if (c.status === 'completed' || (c.senderScore != null && c.recipientScore != null)) {
        setChallengeResult(c);
        return;
      }
      if (c.senderJoined && c.recipientJoined && waitingRef.current) {
        waitingRef.current = false;
        setWaitingForOpponent(false);
        setCountdown(3);
        const interval = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) { clearInterval(interval); return 0; }
            return prev - 1;
          });
        }, 1000);
      }
    });
    return () => { cancelled = true; unsub(); };
  }, [challengeId, user?.uid]);

  // Timeout: play solo after 15s
  useEffect(() => {
    if (!waitingForOpponent) return;
    const timer = setTimeout(() => { waitingRef.current = false; setWaitingForOpponent(false); }, 15000);
    return () => clearTimeout(timer);
  }, [waitingForOpponent]);

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
    setPitch({ name, description: d });
    setGeneratedCount((c) => c + 1);

    fadeAnim.setValue(0);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 0.92, duration: 60, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
      ]),
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [scaleAnim, fadeAnim]);

  const savePitch = useCallback(() => {
    if (!pitch || faves.includes(pitch.name)) return;
    setFaves((prev) => [pitch.name, ...prev]);
  }, [pitch, faves]);

  const sharePitch = useCallback(async () => {
    if (!pitch) return;
    try {
      await Share.share({
        message: `Check out my startup idea: **${pitch.name}** — ${pitch.description}\n\nBuilt with LINKUP Pitch Perfect 🚀`,
      });
    } catch (_) {}
  }, [pitch]);

  useEffect(() => {
    if (!challengeId || !user?.uid || generatedCount === 0) return;
    submitChallengeScore(challengeId, user.uid, generatedCount).catch(() => {});
  }, [challengeId, user?.uid, generatedCount]);

  return (
    <SafeAreaView style={[styles.root, appBackground(isDark)]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: textColor(isDark) }]}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Lightbulb size={16} color={COLORS.primary} />
          <Text style={[styles.title, { color: textColor(isDark) }]}>Pitch Perfect</Text>
        </View>
        <TouchableOpacity style={styles.headerRight} onPress={generatePitch}>
          <RefreshCw size={18} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {waitingForOpponent ? (
        <View style={styles.waitingWrap}>
          {countdown > 0 ? (
            <Text style={[styles.countdownText, { color: COLORS.primary }]}>{countdown}</Text>
          ) : (
            <>
              <Loader size={36} color={COLORS.primary} />
              <Text style={[styles.waitingText, { color: textColor(isDark) }]}>Waiting for opponent...</Text>
              <Text style={[styles.waitingSub, { color: textColor(isDark, 'muted') }]}>Share the challenge so your friend joins</Text>
            </>
          )}
        </View>
      ) : (
      <>

      {challengeResult && (
        <View style={{ marginHorizontal: 24, marginBottom: 12, padding: 16, borderRadius: 16, backgroundColor: '#22C55E' }}>
          <Text style={{ fontSize: 16, fontWeight: '900', color: '#000', textAlign: 'center' }}>Challenge Complete!</Text>
          {challengeResult.senderScore != null && challengeResult.recipientScore != null ? (
            <>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#000', textAlign: 'center', marginTop: 4 }}>
                You: {user?.uid === challengeResult.senderId ? challengeResult.senderScore : challengeResult.recipientScore} ideas
              </Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#000', textAlign: 'center' }}>
                Opponent: {user?.uid === challengeResult.senderId ? challengeResult.recipientScore : challengeResult.senderScore} ideas
              </Text>
              <Text style={{ fontSize: 14, fontWeight: '900', color: '#000', textAlign: 'center', marginTop: 4 }}>
                {(() => {
                  const my = user?.uid === challengeResult.senderId ? challengeResult.senderScore : challengeResult.recipientScore;
                  const their = user?.uid === challengeResult.senderId ? challengeResult.recipientScore : challengeResult.senderScore;
                  if (my == null || their == null) return '';
                  if (my > their) return 'You win! 🏆';
                  if (their > my) return 'Opponent wins!';
                  return 'It\'s a tie! 🤝';
                })()}
              </Text>
            </>
          ) : (
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#000', textAlign: 'center', marginTop: 4 }}>Waiting for opponent to play...</Text>
          )}
        </View>
      )}

      <View style={styles.statsRow}>
        <View style={[styles.statChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
          <Zap size={12} color={COLORS.primary} />
          <Text style={[styles.statText, { color: textColor(isDark) }]}>{generatedCount} generated</Text>
        </View>
        <View style={[styles.statChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
          <Heart size={12} color="#FF3B5C" />
          <Text style={[styles.statText, { color: textColor(isDark) }]}>{faves.length} faves</Text>
        </View>
      </View>

      {!pitch && (
        <View style={styles.heroEmpty}>
          <View style={styles.heroEmptyIconWrap}>
            <Lightbulb size={40} color={COLORS.primary} />
          </View>
          <Text style={[styles.heroEmptyTitle, { color: textColor(isDark) }]}>
            Your Next Big Idea
          </Text>
          <Text style={[styles.heroEmptySub, { color: textColor(isDark, 'muted') }]}>
            Tap the spark below to generate a random startup name and pitch
          </Text>
          <TouchableOpacity style={styles.bigGenBtn} onPress={generatePitch} activeOpacity={0.8}>
            <Zap size={28} color="#000" fill={COLORS.primary} />
            <Text style={styles.bigGenText}>Generate Idea</Text>
          </TouchableOpacity>
        </View>
      )}

      {pitch && (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View
            style={[
              styles.heroCard,
              {
                transform: [{ scale: scaleAnim }],
                backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
              },
            ]}
          >
            <View style={styles.heroBadge}>
              <Zap size={12} color="#000" />
              <Text style={styles.heroBadgeText}>Startup Idea</Text>
            </View>
            <Text style={styles.heroName}>{pitch.name}</Text>
            <View style={styles.heroDivider} />
            <Text style={[styles.heroDesc, { color: textColor(isDark, 'muted') }]}>
              {pitch.description}
            </Text>
          </Animated.View>

          <View style={styles.actionBar}>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]} onPress={generatePitch}>
              <RefreshCw size={16} color={COLORS.primary} />
              <Text style={[styles.actionLabel, { color: textColor(isDark) }]}>New</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, faves.includes(pitch.name) ? { backgroundColor: '#FF3B5C' } : { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}
              onPress={savePitch}
            >
              <Heart size={16} color={faves.includes(pitch.name) ? '#FFF' : '#FF3B5C'} fill={faves.includes(pitch.name) ? '#FFF' : 'transparent'} />
              <Text style={[styles.actionLabel, { color: faves.includes(pitch.name) ? '#FFF' : textColor(isDark) }]}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#FFF' }]} onPress={sharePitch}>
              <Share2 size={16} color="#000" />
              <Text style={[styles.actionLabel, { color: '#000' }]}>Share</Text>
            </TouchableOpacity>
            {!challengeId && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.primary }]} onPress={() => setChallengeVisible(true)}>
                <Swords size={16} color="#000" />
                <Text style={[styles.actionLabel, { color: '#000' }]}>Challenge</Text>
              </TouchableOpacity>
            )}
          </View>

          {faves.length > 0 && (
            <View style={styles.favesSection}>
              <View style={styles.favesHeader}>
                <Trophy size={14} color={COLORS.primary} />
                <Text style={[styles.favesTitle, { color: textColor(isDark) }]}>Saved Ideas</Text>
              </View>
              {faves.slice(0, 5).map((name, i) => (
                <View key={i} style={[styles.faveRow, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]}>
                  <Text style={[styles.faveIndex, { color: textColor(isDark, 'muted') }]}>#{i + 1}</Text>
                  <Text style={[styles.faveName, { color: textColor(isDark) }]} numberOfLines={1}>{name}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
      </>
      )}
      <GameChallengeModal
        visible={challengeVisible}
        gameType="pitchperfect"
        gameLabel="Pitch Perfect"
        currentScore={generatedCount}
        onClose={() => setChallengeVisible(false)}
      />
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
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: { fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  headerRight: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(251,230,24,0.15)',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statText: { fontSize: 11, fontWeight: '700' },
  heroEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  heroEmptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(251,230,24,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroEmptyTitle: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  heroEmptySub: { fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 18, maxWidth: 280 },
  bigGenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 100,
    marginTop: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  bigGenText: { fontSize: 16, fontWeight: '900', color: '#000', letterSpacing: 0.5 },
  content: {
    paddingBottom: 40,
    alignItems: 'center',
  },
  heroCard: {
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 14,
    width: SCREEN_WIDTH - 48,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  heroBadgeText: { fontSize: 10, fontWeight: '900', color: '#000', letterSpacing: 1 },
  heroName: {
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1.5,
    color: COLORS.primary,
    textAlign: 'center',
  },
  heroDivider: {
    width: 32,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
    opacity: 0.4,
  },
  heroDesc: { fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 20 },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 20,
    marginBottom: 24,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 100,
  },
  actionLabel: { fontSize: 12, fontWeight: '900', letterSpacing: 0.3 },
  favesSection: {
    width: SCREEN_WIDTH - 48,
    marginTop: 4,
  },
  favesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  favesTitle: { fontSize: 14, fontWeight: '900' },
  faveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 6,
  },
  faveIndex: { fontSize: 12, fontWeight: '700', width: 28 },
  faveName: { fontSize: 13, fontWeight: '800', flex: 1 },
  waitingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  waitingText: { fontSize: 18, fontWeight: '900', marginTop: 16, textAlign: 'center' },
  waitingSub: { fontSize: 12, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  countdownText: { fontSize: 72, fontWeight: '900' },
});

export default PitchPerfectScreen;
