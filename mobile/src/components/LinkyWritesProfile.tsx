import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Crown, PenLine } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, textColor } from '../theme/theme';
import { LinkyApiError, writeMyProfileWithLinky, type LinkyProfileDraft } from '../lib/linkyApi';

/**
 * LET LINKY WRITE IT — a LINKUP PLUS feature, in the member's own edit screen.
 *
 * The member already told LINKUP what they are building and which seat is empty.
 * What they cannot do is write about themselves well after a full day of
 * building, so Linky writes the bio, the headline, the skills line and the roles
 * they need — from their own facts only — and then waits.
 *
 * Rules:
 *  - nothing is saved until the member taps save, and what is saved is exactly
 *    the words on screen (the draft goes back to the server, so there is no
 *    second, unseen generation);
 *  - the server is the gate. A 402 opens the paywall, never a dead end;
 *  - if Linky has nothing to work from, it says so and asks for the one field,
 *    rather than inventing a company or a city.
 */

type Props = {
  isPlus: boolean;
  onUpgrade: () => void;
  onSaved: () => void;
  /** What Linky already knows, for the pitch. */
  building?: string;
  seat?: string;
};

export default function LinkyWritesProfile({ isPlus, onUpgrade, onSaved, building = '', seat = '' }: Props) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<LinkyProfileDraft | null>(null);

  const generate = useCallback(async () => {
    if (!isPlus) {
      onUpgrade();
      return;
    }
    setBusy(true);
    try {
      const result = await writeMyProfileWithLinky({ save: false });
      if (result?.draft) setDraft(result.draft);
      else Alert.alert('Linky could not write it', 'Try again in a minute.');
    } catch (error) {
      const status = error instanceof LinkyApiError ? error.status : 0;
      if (status === 402) onUpgrade();
      else if (status === 400) {
        Alert.alert('One thing first', 'Tell LINKUP what you are building — Linky will not invent it.');
      } else {
        Alert.alert('Linky could not write it', error instanceof Error ? error.message : 'Try again in a minute.');
      }
    } finally {
      setBusy(false);
    }
  }, [isPlus, onUpgrade]);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const result = await writeMyProfileWithLinky({ save: true, draft });
      if (result?.saved) {
        setDraft(null);
        onSaved();
        Alert.alert('Saved', 'Your profile now reads the way Linky wrote it. Edit anything you like — it is yours.');
      } else {
        Alert.alert('Could not save', 'Try once more in a moment.');
      }
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : 'Try once more in a moment.');
    } finally {
      setSaving(false);
    }
  }, [draft, onSaved]);

  const cardBg = isDark ? '#12151E' : '#FFFDF0';
  const border = isDark ? 'rgba(251,230,24,0.35)' : '#E7E1BF';

  return (
    <View testID="linky-writes-profile" style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
      <View style={styles.head}>
        {isPlus ? <PenLine size={15} color={COLORS.primaryStrong} /> : <Crown size={15} color={COLORS.primaryStrong} />}
        <Text style={[styles.label, { color: textColor(isDark, 'muted') }]}>
          {isPlus ? 'LINKY WRITES YOUR PROFILE' : 'LINKY PLUS · LINKY WRITES YOUR PROFILE'}
        </Text>
      </View>

      {!draft ? (
        <>
          <Text style={[styles.title, { color: textColor(isDark) }]}>
            {isPlus ? 'Let Linky write it for you' : 'You write it at midnight. Linky could write it now.'}
          </Text>
          <Text style={[styles.body, { color: textColor(isDark, 'secondary') }]}>
            {building
              ? `Linky already knows you are building ${building}${seat ? ` and that the seat you need filled is a ${seat.toLowerCase()}` : ''}. It will write your bio, your headline and the signals the matcher actually reads — and you approve every word before it is saved.`
              : 'Linky already has what you told LINKUP about your project and the seat you need filled. It will write your bio, your headline and the signals the matcher reads — and you approve every word before it is saved.'}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            testID="linky-writes-profile-cta"
            activeOpacity={0.88}
            onPress={() => void generate()}
            disabled={busy}
            style={[styles.cta, { backgroundColor: COLORS.primary }]}
          >
            {busy ? <ActivityIndicator size="small" color="#000" /> : null}
            <Text style={styles.ctaText}>
              {busy ? 'Linky is writing…' : isPlus ? 'Write it with Linky' : 'Unlock with PLUS'}
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={[styles.title, { color: textColor(isDark) }]}>Read it before it goes live</Text>
          <View style={[styles.draftBox, { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
            <Text style={[styles.draftLabel, { color: textColor(isDark, 'muted') }]}>HEADLINE</Text>
            <Text style={[styles.draftHeadline, { color: textColor(isDark) }]}>{draft.headline || '—'}</Text>
            <Text style={[styles.draftLabel, { color: textColor(isDark, 'muted') }]}>BIO</Text>
            <Text style={[styles.draftBody, { color: textColor(isDark, 'secondary') }]}>{draft.bio || '—'}</Text>
            {draft.skills.length ? (
              <>
                <Text style={[styles.draftLabel, { color: textColor(isDark, 'muted') }]}>SKILLS</Text>
                <Text style={[styles.draftBody, { color: textColor(isDark, 'secondary') }]}>{draft.skills.join(' · ')}</Text>
              </>
            ) : null}
            {draft.lookingFor.length ? (
              <>
                <Text style={[styles.draftLabel, { color: textColor(isDark, 'muted') }]}>LOOKING FOR</Text>
                <Text style={[styles.draftBody, { color: textColor(isDark, 'secondary') }]}>{draft.lookingFor.join(' · ')}</Text>
              </>
            ) : null}
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            testID="linky-writes-profile-save"
            activeOpacity={0.88}
            onPress={() => void save()}
            disabled={saving}
            style={[styles.cta, { backgroundColor: COLORS.primary }]}
          >
            {saving ? <ActivityIndicator size="small" color="#000" /> : null}
            <Text style={styles.ctaText}>{saving ? 'Saving…' : 'Save this to my profile'}</Text>
          </TouchableOpacity>
          <View style={styles.row}>
            <TouchableOpacity onPress={() => void generate()} disabled={busy} activeOpacity={0.8} style={styles.ghostBtn}>
              <Text style={[styles.ghostText, { color: textColor(isDark, 'secondary') }]}>{busy ? 'Writing…' : 'Write it again'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDraft(null)} activeOpacity={0.8} style={styles.ghostBtn}>
              <Text style={[styles.ghostText, { color: textColor(isDark, 'secondary') }]}>Discard</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 14, borderRadius: 16, borderWidth: 1, padding: 14, gap: 9 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  label: { fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  title: { fontSize: 17, fontWeight: '900', letterSpacing: -0.4, lineHeight: 22 },
  body: { fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  cta: { marginTop: 4, height: 44, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { fontSize: 12.5, fontWeight: '900', color: '#0A0B0D', letterSpacing: 0.2 },
  draftBox: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  draftLabel: { fontSize: 8.5, fontWeight: '900', letterSpacing: 1, marginTop: 6 },
  draftHeadline: { fontSize: 15, fontWeight: '900', lineHeight: 20 },
  draftBody: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  row: { flexDirection: 'row', gap: 8, marginTop: 2 },
  ghostBtn: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 11.5, fontWeight: '800' },
});
