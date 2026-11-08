import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import LinkyCatIcon from './LinkyCatIcon';
import type { TeamMatchQuota } from '../lib/linkyApi';

/**
 * HOW MANY MESSAGES ARE LEFT.
 *
 * Linky's free allowance is 4 messages per UTC day and then the paywall, so the
 * number has to be on screen *before* the member spends one — a limit you only
 * discover by hitting it is a trap, not a limit. This sits directly above the
 * composer, in the same glance line as the text field:
 *
 *   [cat] 3 of 4 free messages left today   ● ● ○ ○
 *
 * and when the fourth is spent it becomes the upgrade itself:
 *
 *   [cat] Free messages used up · Upgrade to LINKUP PLUS   →
 *
 * The meter fills from the left as messages are used (spent dots are ink, unspent
 * dots are hollow), so it reads at a glance without counting.
 */
type Props = {
  quota: TeamMatchQuota | null;
  onUpgrade: () => void;
  dark?: boolean;
  testID?: string;
};

const GOLD = '#FBE618';
const INK = '#0A0B0D';

export default function LinkyQuotaPill({ quota, onUpgrade, dark = false, testID = 'linky-quota-pill' }: Props) {
  if (!quota) return null;

  const muted = dark ? '#9AA1AC' : '#6B7280';

  if (quota.unlimited) {
    return (
      <View
        testID={`${testID}-unlimited`}
        accessibilityLabel="LINKUP PLUS — unlimited Linky messages"
        style={[styles.pill, styles.pillPlus, { backgroundColor: dark ? 'rgba(251,230,24,0.12)' : 'rgba(251,230,24,0.28)', borderColor: GOLD }]}
      >
        <LinkyCatIcon size={15} color={dark ? GOLD : INK} weight={1.8} eyes={false} />
        <Text style={[styles.label, { color: dark ? GOLD : '#6E5B00' }]} numberOfLines={1}>
          PLUS · unlimited messages and searches
        </Text>
      </View>
    );
  }

  const limit = Math.max(0, Number(quota.limit ?? 0));
  const remaining = Math.max(0, Number(quota.remaining ?? 0));
  const used = Math.max(0, Math.min(limit, Number(quota.used ?? limit - remaining)));
  const exhausted = remaining <= 0 || !!quota.exhausted;

  if (exhausted) {
    return (
      <Pressable
        testID={`${testID}-exhausted`}
        accessibilityRole="button"
        accessibilityLabel="Free Linky messages used up today. Upgrade to LINKUP PLUS for unlimited messages."
        onPress={onUpgrade}
        style={({ pressed }) => [
          styles.pill,
          styles.pillUpgrade,
          { backgroundColor: GOLD, borderColor: GOLD, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <LinkyCatIcon size={15} color={INK} weight={1.8} eyes={false} />
        <Text style={[styles.label, styles.labelStrong]} numberOfLines={1}>
          Free messages used up · Upgrade to LINKUP PLUS
        </Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    );
  }

  return (
    <View
      testID={testID}
      accessibilityLabel={`${remaining} of ${limit} free Linky messages left today`}
      style={[
        styles.pill,
        { backgroundColor: dark ? 'rgba(255,255,255,0.05)' : '#FFFFFF', borderColor: dark ? 'rgba(255,255,255,0.10)' : 'rgba(10,11,13,0.12)' },
      ]}
    >
      <LinkyCatIcon size={15} color={muted} weight={1.7} eyes={false} />
      <Text style={[styles.label, { color: muted }]} numberOfLines={1}>
        {remaining} of {limit} free message{limit === 1 ? '' : 's'} left today
      </Text>
      <View style={styles.meter} testID={`${testID}-meter`}>
        {Array.from({ length: Math.min(limit, 8) }).map((_, index) => (
          <View
            key={`pip-${index}`}
            style={[
              styles.pip,
              index < used
                ? { backgroundColor: dark ? '#6C737E' : '#C7CBD1', borderColor: 'transparent' }
                : { backgroundColor: 'transparent', borderColor: dark ? GOLD : '#9A7B00' },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillPlus: {},
  pillUpgrade: { alignSelf: 'stretch', justifyContent: 'center' },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.1, flexShrink: 1 },
  labelStrong: { color: INK, fontSize: 11.5, fontWeight: '900' },
  chevron: { color: INK, fontSize: 14, fontWeight: '900', marginLeft: 2 },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 2 },
  pip: { width: 6, height: 6, borderRadius: 3, borderWidth: 1 },
});
