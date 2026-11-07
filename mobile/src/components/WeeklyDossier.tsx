import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Rocket, Target } from 'lucide-react-native';
import { DISCOVERY_VOICE } from '../lib/brandVoice';
import { textColor } from '../theme/theme';

/**
 * THE FULL READ — why this person, why you, why now.
 *
 * The weekly card is not allowed to be two lines of pleasantry. This is the
 * dossier the AI writes from the profile facts the algorithm verified: the
 * mechanism that triggered the pairing, the honest risk, what each founder
 * brings the other, and the first twenty minutes. Nothing here is truncated
 * with numberOfLines — a reason you have to tap to finish reading is not a
 * reason.
 */

const GOLD = '#FBE618';
const GOLD_DEEP = '#6E5B00';
const INK = '#0A0B0D';

export type Contribution = { skill: string; unlocks: string };

type Props = {
  partnerFirst: string;
  headline: string;
  whyChosen: string;
  partnerBrings: Contribution[];
  youBring: Contribution[];
  sharedGround: string[];
  firstSprint: string;
  source?: string;
  isDark?: boolean;
  testID?: string;
};

function Ledger({
  heading,
  entries,
  isDark,
  gold,
}: {
  heading: string;
  entries: Contribution[];
  isDark: boolean;
  gold: boolean;
}) {
  if (!entries.length) return null;
  return (
    <View style={styles.ledger}>
      <Text style={[styles.label, { color: gold ? GOLD : GOLD_DEEP }]}>{heading}</Text>
      {entries.map((entry, index) => (
        <View key={`${entry.skill}-${index}`} style={styles.row}>
          <View style={[styles.index, index > 0 && { backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : '#FFFFFF' }]}>
            <Text style={[styles.indexText, { color: index > 0 ? textColor(isDark) : INK }]}>{index + 1}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.skill, { color: textColor(isDark) }]}>{entry.skill}</Text>
            {!!entry.unlocks && (
              <Text style={[styles.unlocks, { color: textColor(isDark, 'muted') }]}>{entry.unlocks}</Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

export default function WeeklyDossier({
  partnerFirst,
  headline,
  whyChosen,
  partnerBrings,
  youBring,
  sharedGround,
  firstSprint,
  source,
  isDark = false,
  testID = 'weekly-dossier',
}: Props) {
  if (!whyChosen) return null;
  const gold = isDark;

  return (
    <View testID={testID} style={styles.box}>
      <View style={styles.head}>
        <Rocket size={14} color={gold ? GOLD : '#111827'} />
        <Text style={[styles.kicker, { color: textColor(isDark, 'muted') }]}>
          {DISCOVERY_VOICE.dossier.kicker}
        </Text>
      </View>

      {!!headline && (
        <Text testID={`${testID}-headline`} style={[styles.headline, { color: textColor(isDark) }]}>
          {headline}
        </Text>
      )}

      <Text style={[styles.label, { color: gold ? GOLD : GOLD_DEEP }]}>
        {DISCOVERY_VOICE.dossier.whyLabel}
      </Text>
      <Text testID={`${testID}-why`} style={[styles.why, { color: textColor(isDark) }]}>
        {whyChosen}
      </Text>

      <Ledger heading={DISCOVERY_VOICE.dossier.partnerBrings(partnerFirst)} entries={partnerBrings} isDark={isDark} gold={gold} />
      <Ledger heading={DISCOVERY_VOICE.dossier.youBring(partnerFirst)} entries={youBring} isDark={isDark} gold={gold} />

      {sharedGround.length > 0 && (
        <View style={styles.ledger}>
          <Text style={[styles.label, { color: gold ? GOLD : GOLD_DEEP }]}>
            {DISCOVERY_VOICE.dossier.sharedGround}
          </Text>
          <View style={styles.groundRow}>
            {sharedGround.map((item, index) => (
              <View
                key={`${item}-${index}`}
                style={[styles.chip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF' }]}
              >
                <Text style={[styles.chipText, { color: textColor(isDark) }]} numberOfLines={1}>
                  {item}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {!!firstSprint && (
        <View style={styles.sprintRow}>
          <Target size={12} color={isDark ? '#4ADE80' : '#15803D'} />
          <Text style={[styles.sprint, { color: textColor(isDark, 'secondary') }]}>
            {DISCOVERY_VOICE.dossier.sprint(firstSprint)}
          </Text>
        </View>
      )}

      {source === 'engine' && (
        <Text style={[styles.source, { color: textColor(isDark, 'muted') }]}>
          {DISCOVERY_VOICE.dossier.engineNote}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // No panel, no border: the dossier reads as part of the page, edge to edge.
  box: { marginTop: 22 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  kicker: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  headline: { marginTop: 10, fontSize: 19, fontWeight: '900', letterSpacing: -0.4, lineHeight: 24 },
  label: { marginTop: 16, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  why: { marginTop: 8, fontSize: 13.5, fontWeight: '600', lineHeight: 21 },
  ledger: { marginTop: 4 },
  row: { marginTop: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  index: { width: 20, height: 20, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: GOLD, marginTop: 1 },
  indexText: { fontSize: 10, fontWeight: '900' },
  skill: { fontSize: 13.5, fontWeight: '900', letterSpacing: -0.2 },
  unlocks: { marginTop: 2, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  groundRow: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(17,24,39,0.08)' },
  chipText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.2 },
  sprintRow: { marginTop: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  sprint: { flex: 1, fontSize: 12, fontWeight: '800', lineHeight: 18 },
  source: { marginTop: 12, fontSize: 9.5, fontWeight: '700', fontStyle: 'italic' },
});
