import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ArrowDown } from 'lucide-react-native';
import { buildFacts, DISCOVERY_VOICE, type VoiceProfile } from '../lib/brandVoice';
import { textColor } from '../theme/theme';

/**
 * THE FIRST THING ON THE HOME PAGE.
 *
 * Greeting by name and by the actual time of day, then the scout's report, then
 * the one line set in bold — the promise the whole page exists to make — and
 * finally the hand-off down to this week's person.
 *
 * Split out of the dashboard so it can be rendered (and proved in a browser)
 * on its own, with the real type, without dragging the whole feed with it.
 */

const GOLD = '#FBE618';
const GOLD_DEEP = '#6E5B00';
const INK = '#0A0B0D';

type Props = {
  profile: VoiceProfile;
  /** The question "Ready to meet your people?" only makes sense if there is one. */
  hasMatch: boolean;
  isDark?: boolean;
};

export default function HomeHero({ profile, hasMatch, isDark = false }: Props) {
  const facts = useMemo(() => buildFacts(profile), [profile]);
  const hero = DISCOVERY_VOICE.hero;

  return (
    <View testID="home-hero" style={styles.root}>
      <Text testID="home-hero-greeting" style={[styles.greeting, { color: textColor(isDark, 'secondary') }]}>
        {hero.greeting(facts)}
      </Text>

      <Text testID="home-hero-lead" style={[styles.lead, { color: textColor(isDark) }]}>
        {hero.leadLine1}
        {'\n'}
        {hero.leadLine2}{' '}
        {/* A non-breaking hyphen (U+2011) so "A-PLAYERS" can never split. */}
        <Text style={[styles.leadMark, { color: isDark ? GOLD : GOLD_DEEP }]}>
          {hero.leadHighlight.replace('-', '\u2011')}
        </Text>
      </Text>

      <Text testID="home-hero-body" style={[styles.body, { color: textColor(isDark, 'muted') }]}>
        {hero.body}
      </Text>

      {/* BOLD ON PURPOSE: this is the sentence the page is selling. */}
      <Text
        testID="home-hero-promise"
        accessibilityRole="text"
        style={[styles.promise, { color: textColor(isDark) }]}
      >
        {hero.promise}
      </Text>

      {hasMatch ? (
        <View testID="home-hero-cta" style={styles.ctaRow}>
          <Text style={styles.cta}>{hero.cta}</Text>
          <ArrowDown size={14} color={INK} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 6 },
  greeting: { fontSize: 14, fontWeight: '800', lineHeight: 20 },
  lead: { fontSize: 23, fontWeight: '900', letterSpacing: -0.5, lineHeight: 29 },
  leadMark: { fontSize: 23, fontWeight: '900', letterSpacing: -0.5 },
  body: { fontSize: 13.5, fontWeight: '600', lineHeight: 20 },
  promise: { marginTop: 4, fontSize: 16.5, fontWeight: '900', letterSpacing: -0.2, lineHeight: 23 },
  ctaRow: {
    marginTop: 12,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: 'rgba(10,11,13,0.14)',
  },
  cta: { fontSize: 13, fontWeight: '900', letterSpacing: 0.1, color: INK },
});
