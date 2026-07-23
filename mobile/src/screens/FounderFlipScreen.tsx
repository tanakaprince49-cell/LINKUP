import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { RotateCcw } from 'lucide-react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_SIZE = (SCREEN_WIDTH - 80) / 4;
const CARD_PAIRS = [
  { id: '1', emoji: '🚀', label: 'Launch' },
  { id: '2', emoji: '💡', label: 'Idea' },
  { id: '3', emoji: '🤝', label: 'Pitch' },
  { id: '4', emoji: '📈', label: 'Growth' },
  { id: '5', emoji: '⚡', label: 'Scale' },
  { id: '6', emoji: '🎯', label: 'Focus' },
  { id: '7', emoji: '💎', label: 'Value' },
  { id: '8', emoji: '🌍', label: 'Global' },
];

interface CardData {
  pairId: string;
  emoji: string;
  label: string;
  index: number;
  flipped: boolean;
  matched: boolean;
}

const FounderFlipScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [cards, setCards] = useState<CardData[]>([]);
  const [flippedIndices, setFlippedIndices] = useState<number[]>([]);
  const [matchedPairs, setMatchedPairs] = useState(0);
  const [moves, setMoves] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const lockRef = useRef(false);

  const initGame = useCallback(() => {
    const doubled = [...CARD_PAIRS, ...CARD_PAIRS].map((c, i) => ({
      pairId: c.id,
      emoji: c.emoji,
      label: c.label,
      index: i,
      flipped: false,
      matched: false,
    }));
    for (let i = doubled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [doubled[i], doubled[j]] = [doubled[j], doubled[i]];
    }
    setCards(doubled);
    setFlippedIndices([]);
    setMatchedPairs(0);
    setMoves(0);
    setGameOver(false);
    lockRef.current = false;
  }, []);

  useEffect(() => { initGame(); }, [initGame]);

  const handleCardPress = useCallback((index: number) => {
    if (lockRef.current || cards[index].flipped || cards[index].matched) return;
    const newCards = [...cards];
    newCards[index] = { ...newCards[index], flipped: true };
    setCards(newCards);
    const newFlipped = [...flippedIndices, index];
    setFlippedIndices(newFlipped);

    if (newFlipped.length === 2) {
      lockRef.current = true;
      setMoves((m) => m + 1);
      const [first, second] = newFlipped;
      if (cards[first].pairId === cards[second].pairId) {
        setTimeout(() => {
          setCards((prev) => {
            const next = [...prev];
            next[first] = { ...next[first], matched: true, flipped: true };
            next[second] = { ...next[second], matched: true, flipped: true };
            return next;
          });
          setMatchedPairs((p) => {
            const newCount = p + 1;
            if (newCount === 8) setGameOver(true);
            return newCount;
          });
          setFlippedIndices([]);
          lockRef.current = false;
        }, 400);
      } else {
        setTimeout(() => {
          setCards((prev) => {
            const next = [...prev];
            next[first] = { ...next[first], flipped: false };
            next[second] = { ...next[second], flipped: false };
            return next;
          });
          setFlippedIndices([]);
          lockRef.current = false;
        }, 800);
      }
    }
  }, [cards, flippedIndices]);

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView style={[styles.root, appBackground(isDark)]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: textColor(isDark) }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: textColor(isDark) }]}>Founder Flip</Text>
        <View style={styles.headerRight} />
      </View>

      <View style={styles.stats}>
        <View style={[styles.statBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
          <Text style={[styles.statNum, { color: COLORS.primary }]}>{moves}</Text>
          <Text style={[styles.statLabel, { color: textColor(isDark, 'muted') }]}>Moves</Text>
        </View>
        <View style={[styles.statBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
          <Text style={[styles.statNum, { color: COLORS.primary }]}>{matchedPairs}/8</Text>
          <Text style={[styles.statLabel, { color: textColor(isDark, 'muted') }]}>Pairs</Text>
        </View>
      </View>

      <View style={styles.grid}>
        {cards.map((card, i) => (
          <TouchableOpacity
            key={i}
            style={[
              styles.card,
              { backgroundColor: card.flipped ? COLORS.primary : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') },
              card.matched && styles.cardMatched,
            ]}
            onPress={() => handleCardPress(i)}
            activeOpacity={0.8}
            disabled={card.matched}
          >
            {(card.flipped || card.matched) ? (
              <Text style={styles.cardEmoji}>{card.emoji}</Text>
            ) : (
              <Text style={[styles.cardQuestion, { color: isDark ? '#FFF' : '#000' }]}>?</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {gameOver && (
        <View style={styles.gameOverBanner}>
          <Text style={styles.gameOverTitle}>🎉 You matched all pairs!</Text>
          <Text style={styles.gameOverMoves}>{moves} moves</Text>
          <View style={styles.gameOverActions}>
            <TouchableOpacity style={styles.gameOverBtn} onPress={initGame}>
              <RotateCcw size={16} color="#000" />
              <Text style={styles.gameOverBtnText}>Play Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      </SafeAreaView>
    </View>
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
  stats: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 20,
  },
  statBox: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 14,
  },
  statNum: { fontSize: 24, fontWeight: '900' },
  statLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  card: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMatched: { opacity: 0.5 },
  cardEmoji: { fontSize: 28 },
  cardQuestion: { fontSize: 24, fontWeight: '900' },
  gameOverBanner: {
    margin: 20,
    padding: 24,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    gap: 8,
  },
  gameOverTitle: { fontSize: 18, fontWeight: '900', color: '#000' },
  gameOverMoves: { fontSize: 14, fontWeight: '700', color: '#000', opacity: 0.7 },
  gameOverActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  gameOverBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  gameOverBtnText: { fontSize: 12, fontWeight: '900', color: '#000' },
});

export default FounderFlipScreen;