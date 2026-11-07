import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowUpRight, Gauge } from 'lucide-react-native';
import { profileStrength } from '../../../shared/profile-strength';
import { textColor } from '../theme/theme';

/**
 * PROFILE STRENGTH — feature #4.
 *
 * A page with no new introduction still owes the member something to do. This
 * is the one number on Discover they can move themselves, plus the single
 * highest-leverage edit — not a checklist of seven chores.
 */

const GOLD = '#FBE618';
const GOLD_DEEP = '#6E5B00';
const INK = '#0A0B0D';

type Props = {
  profile: Record<string, any> | null | undefined;
  isDark?: boolean;
  onFix: (field: string) => void;
};

export default function ProfileStrengthCard({ profile, isDark = false, onFix }: Props) {
  const strength = useMemo(() => profileStrength(profile), [profile]);
  const next = strength.next;

  // Nothing to do and nothing missing: stay out of the way entirely.
  if (!next) return null;

  const trackBg = isDark ? 'rgba(255,255,255,0.10)' : '#EDEDE7';

  return (
    <View testID="profile-strength" style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <Gauge size={13} color={isDark ? GOLD : GOLD_DEEP} />
          <Text style={[styles.label, { color: textColor(isDark, 'muted') }]}>YOUR PROFILE IS DOING THE MATCHING</Text>
        </View>
        <Text testID="profile-strength-percent" style={[styles.percent, { color: textColor(isDark) }]}>
          {strength.percent}%
        </Text>
      </View>

      <View style={[styles.track, { backgroundColor: trackBg }]}>
        <View style={[styles.fill, { width: `${Math.max(4, strength.percent)}%`, backgroundColor: GOLD }]} />
      </View>

      <Text testID="profile-strength-next" style={[styles.nextLine, { color: textColor(isDark) }]}>
        {next.label}. <Text style={{ color: textColor(isDark, 'muted'), fontWeight: '700' }}>{next.why}</Text>
      </Text>

      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={0.86}
        onPress={() => onFix(next.key)}
        style={styles.cta}
      >
        <Text style={styles.ctaText}>{next.cta}</Text>
        <ArrowUpRight size={13} color={INK} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 26, paddingHorizontal: 18 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  label: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  percent: { fontSize: 20, fontWeight: '900', letterSpacing: -0.6 },
  track: { height: 7, borderRadius: 999, overflow: 'hidden', marginTop: 12 },
  fill: { height: 7, borderRadius: 999 },
  nextLine: { marginTop: 12, fontSize: 13.5, fontWeight: '800', lineHeight: 20 },
  cta: {
    marginTop: 14,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: GOLD,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  ctaText: { fontSize: 12.5, fontWeight: '900', color: INK, letterSpacing: -0.1 },
});
