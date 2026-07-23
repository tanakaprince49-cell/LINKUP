import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions, Alert, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { RefreshCw, Brain, Share2 } from 'lucide-react-native';

const QUESTIONS = [
  {
    q: 'Which company acquired Instagram?',
    options: ['Google', 'Facebook', 'Twitter', 'Snapchat'],
    answer: 1,
  },
  {
    q: 'What does "B2B" stand for?',
    options: ['Back to Basics', 'Business to Business', 'Brick to Brick', 'Bootstrap to Build'],
    answer: 1,
  },
  {
    q: 'What is a "unicorn" startup?',
    options: ['A company with a unicorn mascot', 'A startup worth >$1B', 'A company with one founder', 'A failed startup'],
    answer: 1,
  },
  {
    q: 'Which Y Combinator startup became a $100B+ company?',
    options: ['Dropbox', 'Airbnb', 'Reddit', 'Stripe'],
    answer: 1,
  },
  {
    q: 'What is "burn rate"?',
    options: ['How fast a company grows', 'How fast a company spends cash', 'Employee turnover rate', 'Server processing speed'],
    answer: 1,
  },
  {
    q: 'What does ARR stand for?',
    options: ['Annual Recurring Revenue', 'Annual Return Rate', 'Average Risk Ratio', 'Actual Revenue Recorded'],
    answer: 0,
  },
  {
    q: 'Who is the youngest self-made billionaire?',
    options: ['Mark Zuckerberg', 'Austin Russell', 'Kylie Jenner', 'Vitalik Buterin'],
    answer: 1,
  },
  {
    q: 'What does "MVP" mean in startups?',
    options: ['Most Valuable Player', 'Minimum Viable Product', 'Maximum Venture Potential', 'Market Value Proposition'],
    answer: 1,
  },
  {
    q: 'Which company was originally called "TheFacebook"?',
    options: ['Facebook', 'Twitter', 'Instagram', 'LinkedIn'],
    answer: 0,
  },
  {
    q: 'What is "bootstrapping"?',
    options: ['Using investor money only', 'Building a company without external funding', 'Hiring without interviews', 'A type of pitch deck'],
    answer: 1,
  },
  {
    q: 'Which is NOT a stage of startup funding?',
    options: ['Series A', 'Series B', 'Series D', 'Series M'],
    answer: 3,
  },
  {
    q: 'What does "pivot" mean?',
    options: ['Changing the company name', 'Fundamentally changing business strategy', 'Hiring a new CEO', 'Moving to a new office'],
    answer: 1,
  },
  {
    q: 'Who wrote "The Lean Startup"?',
    options: ['Steve Blank', 'Eric Ries', 'Peter Thiel', 'Paul Graham'],
    answer: 1,
  },
  {
    q: 'What is "traction"?',
    options: ['A car metaphor', 'Evidence of market demand', 'Investor meetings scheduled', 'Patent filings'],
    answer: 1,
  },
  {
    q: 'Which company started in a dorm room?',
    options: ['Apple', 'Microsoft', 'Facebook', 'Amazon'],
    answer: 2,
  },
];

const NetworkQuizScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [questions, setQuestions] = useState<any[]>([]);
  const [current, setCurrent] = useState(0);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState(false);

  const shuffleAndStart = useCallback(() => {
    const shuffled = [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 10);
    setQuestions(shuffled);
    setCurrent(0);
    setScore(0);
    setSelected(null);
    setRevealed(false);
    setFinished(false);
  }, []);

  useEffect(() => { shuffleAndStart(); }, [shuffleAndStart]);

  const handleAnswer = useCallback((index: number) => {
    if (revealed) return;
    setSelected(index);
    setRevealed(true);
    if (index === questions[current].answer) {
      setScore((s) => s + 1);
    }
  }, [revealed, current, questions]);

  const nextQuestion = useCallback(() => {
    if (current + 1 >= questions.length) {
      setFinished(true);
    } else {
      setCurrent((c) => c + 1);
      setSelected(null);
      setRevealed(false);
    }
  }, [current, questions]);

  const shareScore = useCallback(async () => {
    try {
      await Share.share({
        message: `I scored ${score}/${questions.length} on LINKUP Network Quiz! Can you beat me? 🧠`,
      });
    } catch (_) {}
  }, [score, questions]);

  return (
    <SafeAreaView style={[styles.root, appBackground(isDark)]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: textColor(isDark) }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: textColor(isDark) }]}>Network Quiz</Text>
        <View style={styles.headerRight} />
      </View>

      {!finished && questions.length > 0 && (
        <>
          <View style={styles.progressRow}>
            <Brain size={14} color={COLORS.primary} />
            <Text style={[styles.progressText, { color: textColor(isDark, 'muted') }]}>
              {current + 1} / {questions.length}
            </Text>
            <View style={styles.scoreBadge}>
              <Text style={styles.scoreText}>{score} pts</Text>
            </View>
          </View>

          <View style={styles.progressBarBg}>
            <View
              style={[styles.progressBarFill, { width: `${((current + 1) / questions.length) * 100}%` }]}
            />
          </View>

          <View style={[styles.questionCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
            <Text style={styles.questionText}>{questions[current].q}</Text>
          </View>

          <View style={styles.options}>
            {questions[current].options.map((opt: string, i: number) => {
              let bg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
              let borderColor = 'transparent';
              if (revealed && i === questions[current].answer) {
                bg = '#22C55E';
                borderColor = '#22C55E';
              } else if (revealed && i === selected && i !== questions[current].answer) {
                bg = '#FF3B5C';
                borderColor = '#FF3B5C';
              } else if (i === selected) {
                bg = COLORS.primary;
                borderColor = COLORS.primary;
              }
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.optionBtn, { backgroundColor: bg, borderColor }]}
                  onPress={() => handleAnswer(i)}
                  disabled={revealed}
                >
                  <Text style={[styles.optionText, { color: (revealed && (i === questions[current].answer || i === selected)) ? '#FFF' : textColor(isDark) }]}>
                    {opt}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {revealed && (
            <TouchableOpacity style={styles.nextBtn} onPress={nextQuestion}>
              <Text style={styles.nextBtnText}>
                {current + 1 >= questions.length ? 'See Results →' : 'Next →'}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {finished && (
        <View style={styles.finishedContainer}>
          <Text style={styles.finishedEmoji}>{score >= 8 ? '🏆' : score >= 5 ? '👏' : '💪'}</Text>
          <Text style={[styles.finishedScore, { color: textColor(isDark) }]}>
            {score} / {questions.length}
          </Text>
          <Text style={[styles.finishedSub, { color: textColor(isDark, 'muted') }]}>
            {score >= 9 ? 'Founder Genius!' : score >= 7 ? 'Startup Pro!' : score >= 5 ? 'Getting there!' : 'Keep learning!'}
          </Text>
          <View style={styles.finishedActions}>
            <TouchableOpacity style={styles.finishedBtn} onPress={shuffleAndStart}>
              <RefreshCw size={16} color="#000" />
              <Text style={styles.finishedBtnText}>Play Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.finishedBtn, { backgroundColor: '#FFF' }]} onPress={shareScore}>
              <Share2 size={16} color="#000" />
              <Text style={[styles.finishedBtnText, { color: '#000' }]}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  progressText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  scoreBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  scoreText: { fontSize: 11, fontWeight: '900', color: '#000' },
  progressBarBg: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    marginHorizontal: 24,
    marginBottom: 24,
  },
  progressBarFill: {
    height: 4,
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  questionCard: {
    marginHorizontal: 24,
    borderRadius: 20,
    padding: 24,
    marginBottom: 24,
  },
  questionText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFF',
    lineHeight: 26,
  },
  options: { paddingHorizontal: 24, gap: 10 },
  optionBtn: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 2,
  },
  optionText: { fontSize: 14, fontWeight: '700' },
  nextBtn: {
    marginHorizontal: 24,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  nextBtnText: { fontSize: 14, fontWeight: '900', color: '#000' },
  finishedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  finishedEmoji: { fontSize: 56, marginBottom: 4 },
  finishedScore: { fontSize: 42, fontWeight: '900' },
  finishedSub: { fontSize: 14, fontWeight: '700', marginBottom: 20 },
  finishedActions: { flexDirection: 'row', gap: 12 },
  finishedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
  },
  finishedBtnText: { fontSize: 12, fontWeight: '900', color: '#000' },
});

export default NetworkQuizScreen;