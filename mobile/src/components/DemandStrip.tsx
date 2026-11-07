import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Eye, Lock } from 'lucide-react-native';
import { demandSignal } from '../../../shared/demand-signal';
import { textColor } from '../theme/theme';

/**
 * "WHO IS ALREADY LOOKING FOR YOU" — feature #5.
 *
 * Counts only. No faces, no names, no ids: the page promises one introduction a
 * week, so this must create status and scarcity without handing out a second
 * introduction on the quiet. The tap hands off to Linky.
 */

const GOLD = '#FBE618';
const INK = '#0A0B0D';

type Props = {
  me: Record<string, any> | null | undefined;
  people: Array<Record<string, any>>;
  isDark?: boolean;
  onOpenLinky: () => void;
};

export default function DemandStrip({ me, people, isDark = false, onOpenLinky }: Props) {
  const signal = useMemo(() => demandSignal(me, people), [me, people]);
  if (!signal || signal.searching < 1) return null;

  const need = signal.topNeed || 'what you do';
  const onPaper = signal.matchedOnPaper;

  return (
    <TouchableOpacity
      testID="demand-strip"
      accessibilityRole="button"
      activeOpacity={0.88}
      onPress={onOpenLinky}
      style={[
        styles.card,
        {
          backgroundColor: isDark ? 'rgba(251,230,24,0.09)' : '#FCFBF3',
          borderColor: isDark ? 'rgba(251,230,24,0.30)' : '#E7E1BF',
        },
      ]}
    >
      <View style={styles.head}>
        <Eye size={13} color={isDark ? GOLD : '#6E5B00'} />
        <Text style={[styles.label, { color: textColor(isDark, 'muted') }]}>LOOKING FOR YOU THIS WEEK</Text>
      </View>

      <Text testID="demand-strip-number" style={[styles.number, { color: textColor(isDark) }]}>
        {signal.searching} {signal.searching === 1 ? 'builder is' : 'builders are'} hunting for {need.toLowerCase()} right now.
      </Text>

      <Text style={[styles.sub, { color: textColor(isDark, 'secondary') }]}>
        {onPaper > 0
          ? `${onPaper} of them already line up with you on paper. Ask Linky who they are.`
          : 'None of them are in this week’s pairing yet. Ask Linky what would move you up.'}
      </Text>

      <View style={styles.footer}>
        <Lock size={10} color={textColor(isDark, 'muted')} />
        <Text style={[styles.footNote, { color: textColor(isDark, 'muted') }]}>
          Counts only. One introduction a week stays the rule.
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 18, borderRadius: 18, borderWidth: 1, padding: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  label: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  number: { marginTop: 10, fontSize: 16, fontWeight: '900', letterSpacing: -0.3, lineHeight: 22 },
  sub: { marginTop: 7, fontSize: 12.5, fontWeight: '700', lineHeight: 18 },
  footer: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  footNote: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.1 },
});
