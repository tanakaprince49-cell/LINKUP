import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check, FileText, PenLine, X } from 'lucide-react-native';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { textColor } from '../theme/theme';
import { hasLinkupPro } from '../lib/paywall';
import { LinkyApiError, linkyWriteProfile, type WrittenProfile } from '../lib/linkyApi';

/**
 * LINKY WRITES YOUR PROFILE — PLUS only.
 *
 * The profile is the product: every match, dossier and weekly email is generated
 * from it. So this is the one paid action that clearly earns its keep, and it
 * has to be honest in three specific ways:
 *
 *   1. It reads what the member already told LINKUP. It never asks them to type
 *      their build again — that is the thing they came here to stop doing.
 *   2. It shows the draft with the evidence for each line, and saves nothing
 *      until the member taps save. A rewrite that lands silently is a betrayal.
 *   3. Free members see the offer, never a draft. The paywall opens instead.
 */

const GOLD = '#FBE618';
const INK = '#0A0B0D';

type Props = {
  /** Opens the paywall when a free member taps. */
  onUpgrade: () => void;
  /** Called after a successful save so the caller can refresh. */
  onSaved?: () => void;
  /** compact = a row inside the Linky opening card. */
  compact?: boolean;
};

export default function LinkyProfileWriter({ onUpgrade, onSaved, compact = true }: Props) {
  const { profile, updateLocalProfile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const isPlus = hasLinkupPro(profile);

  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<WrittenProfile | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const run = useCallback(async () => {
    if (busy) return;
    if (!isPlus) {
      onUpgrade();
      return;
    }
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const out = await linkyWriteProfile();
      setDraft(out);
    } catch (err) {
      if (err instanceof LinkyApiError && err.status === 402) {
        onUpgrade();
      } else {
        setError(err instanceof Error ? err.message : 'Linky could not write that just now.');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, isPlus, onUpgrade]);

  const save = useCallback(async () => {
    const uid = profile?.uid;
    if (!draft || !uid || saving) return;
    setSaving(true);
    setError('');
    try {
      const fields = draft.fields || {};
      await updateDoc(doc(db, 'users', uid), {
        ...fields,
        profileWrittenByLinkyAt: serverTimestamp(),
        profileWriteSource: draft.source,
      });
      updateLocalProfile(fields);
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that to your profile.');
    } finally {
      setSaving(false);
    }
  }, [draft, onSaved, profile?.uid, saving, updateLocalProfile]);

  const close = () => {
    if (saving) return;
    setDraft(null);
    setError('');
  };

  const label = isPlus ? 'Let Linky write my profile' : 'Let Linky write my profile · PLUS';
  const hint = isPlus
    ? 'It reads what you have already told LINKUP and writes it the way the matcher reads it. You see it before it is saved.'
    : 'Free members write their own. PLUS members get Linky to write the whole thing, from the facts you already gave us.';

  const evidenceFor = (field: string) => draft?.evidence?.find((row) => row.field === field)?.from || '';

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={0.9}
        disabled={busy}
        onPress={() => void run()}
        style={[
          styles.trigger,
          compact && styles.triggerCompact,
          { borderColor: isDark ? 'rgba(251,230,24,0.35)' : 'rgba(17,24,39,0.12)', backgroundColor: isDark ? 'rgba(251,230,24,0.10)' : '#FFFDF2' },
        ]}
      >
        <View style={styles.triggerIcon}>
          {busy ? <ActivityIndicator color={INK} size="small" /> : <FileText size={15} color={INK} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.triggerTitle, { color: textColor(isDark) }]}>
            {busy ? 'Linky is writing…' : label}
          </Text>
          <Text style={[styles.triggerHint, { color: textColor(isDark, 'muted') }]} numberOfLines={2}>
            {hint}
          </Text>
        </View>
        {!isPlus ? <Text style={styles.plusChip}>PLUS</Text> : null}
      </TouchableOpacity>

      {!!error && !draft ? (
        <Text style={[styles.errorLine, { color: '#DC2626' }]}>{error}</Text>
      ) : null}

      <Modal visible={!!draft} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: isDark ? '#0F1216' : '#FFFFFF' }]}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.kicker, { color: isDark ? GOLD : '#6E5B00' }]}>LINKY WROTE THIS</Text>
                <Text style={[styles.sheetTitle, { color: textColor(isDark) }]} numberOfLines={2}>
                  {draft?.headline || 'Your profile, rewritten'}
                </Text>
              </View>
              <TouchableOpacity onPress={close} accessibilityLabel="Close" style={styles.closeBtn}>
                <X size={18} color={textColor(isDark, 'muted')} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
              <Text style={[styles.sheetNote, { color: textColor(isDark, 'muted') }]}>
                {draft?.message || ''}
                {draft?.source === 'local' ? ' Written from your own answers, no model involved.' : ''}
              </Text>

              <Field
                isDark={isDark}
                label="BIO"
                value={String(draft?.fields?.bio || '')}
                from={evidenceFor('bio')}
              />
              <Field
                isDark={isDark}
                label="HEADLINE"
                value={[draft?.fields?.occupation, draft?.fields?.company].filter(Boolean).join(' · ')}
                from={evidenceFor('occupation')}
              />
              <Field
                isDark={isDark}
                label="WHAT YOU WANT"
                value={String(draft?.fields?.goals || '')}
                from={evidenceFor('goals')}
              />
              <Field
                isDark={isDark}
                label="SKILLS"
                value={Array.isArray(draft?.fields?.skills) ? draft!.fields.skills.join(' · ') : ''}
                from={evidenceFor('skills')}
              />
              <Field
                isDark={isDark}
                label="THE EMPTY SEAT"
                value={String(draft?.fields?.missingSeat || '')}
                from={evidenceFor('missingSeat')}
              />

              {!!draft?.missing?.length && (
                <View style={[styles.missingBox, { borderColor: 'rgba(251,230,24,0.4)' }]}>
                  <Text style={[styles.missingTitle, { color: textColor(isDark) }]}>Still missing — tell Linky once and it will write it next time</Text>
                  {draft!.missing.map((line) => (
                    <Text key={line} style={[styles.missingLine, { color: textColor(isDark, 'muted') }]}>• {line}</Text>
                  ))}
                </View>
              )}
            </ScrollView>

            {!!error && <Text style={[styles.errorLine, { color: '#DC2626' }]}>{error}</Text>}

            {saved ? (
              <View style={styles.savedRow}>
                <Check size={16} color="#16A34A" />
                <Text style={[styles.savedText, { color: textColor(isDark) }]}>Saved. Your profile now says this.</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.saveBtn} activeOpacity={0.9} disabled={saving} onPress={() => void save()}>
                {saving ? <ActivityIndicator color={INK} size="small" /> : <PenLine size={15} color={INK} />}
                <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save this to my profile'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={close} style={styles.notNow} activeOpacity={0.7}>
              <Text style={[styles.notNowText, { color: textColor(isDark, 'muted') }]}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Field({ label, value, from, isDark }: { label: string; value: string; from: string; isDark: boolean }) {
  if (!value) return null;
  return (
    <View style={[styles.field, { borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(17,24,39,0.08)' }]}>
      <Text style={[styles.fieldLabel, { color: textColor(isDark, 'muted') }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: textColor(isDark) }]}>{value}</Text>
      {!!from && <Text style={[styles.fieldFrom, { color: textColor(isDark, 'muted') }]}>from {from}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  triggerCompact: { marginTop: 12 },
  triggerIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GOLD,
  },
  triggerTitle: { fontSize: 13, fontWeight: '900', letterSpacing: -0.1 },
  triggerHint: { marginTop: 3, fontSize: 11, fontWeight: '600', lineHeight: 15 },
  plusChip: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
    color: INK,
    backgroundColor: GOLD,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  errorLine: { marginTop: 8, fontSize: 11, fontWeight: '800', lineHeight: 15 },
  backdrop: { flex: 1, backgroundColor: 'rgba(10,11,13,0.62)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 28 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  kicker: { fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  sheetTitle: { marginTop: 5, fontSize: 20, fontWeight: '900', letterSpacing: -0.4, lineHeight: 25 },
  closeBtn: { padding: 6 },
  sheetNote: { marginTop: 10, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  field: { marginTop: 12, borderTopWidth: 1, paddingTop: 10 },
  fieldLabel: { fontSize: 8.5, fontWeight: '900', letterSpacing: 1 },
  fieldValue: { marginTop: 5, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  fieldFrom: { marginTop: 4, fontSize: 9.5, fontWeight: '700', fontStyle: 'italic' },
  missingBox: { marginTop: 14, borderWidth: 1, borderRadius: 12, padding: 12 },
  missingTitle: { fontSize: 11, fontWeight: '900', lineHeight: 15 },
  missingLine: { marginTop: 4, fontSize: 11, fontWeight: '700', lineHeight: 15 },
  saveBtn: {
    marginTop: 16,
    height: 50,
    borderRadius: 14,
    backgroundColor: GOLD,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveText: { fontSize: 13, fontWeight: '900', color: INK, letterSpacing: 0.1 },
  savedRow: { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  savedText: { fontSize: 13, fontWeight: '900' },
  notNow: { marginTop: 10, alignItems: 'center', paddingVertical: 8 },
  notNowText: { fontSize: 12, fontWeight: '800' },
});
