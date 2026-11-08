import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { doc, updateDoc, serverTimestamp } from '../lib/firestoreCompat';
import { X } from 'lucide-react-native';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, liquidGlass, textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
import { WORK_STYLE_CARD_INTRO, WORK_STYLE_QUESTIONS } from '../../../shared/linkup-match';

/**
 * The Work Style Card — eight forced choices, ~90 seconds, opt-in, editable
 * (docs/LINKUP_ALGORITHM_DESIGN.md §19.1).
 *
 * What it is allowed to change: who we introduce you to and what we suggest you
 * do first. What it is not allowed to change: your visibility, your standing,
 * or what anybody else sees. The influence cap (±3 positions inside a band) is
 * enforced in the engine, not in this component.
 */
export default function WorkStyleCard({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const existing = useMemo(() => {
    const raw = (profile as any)?.workStyleCard;
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  }, [profile]);

  const [answers, setAnswers] = useState<Record<string, string>>(existing);
  const [saving, setSaving] = useState(false);

  const answered = WORK_STYLE_QUESTIONS.filter((question) => !!answers[question.id]).length;

  const choose = (questionId: string, optionId: string) => {
    setAnswers((current) => ({ ...current, [questionId]: current[questionId] === optionId ? '' : optionId }));
  };

  const save = async () => {
    if (!user?.uid || saving) return;
    setSaving(true);
    try {
      const clean: Record<string, string> = {};
      for (const question of WORK_STYLE_QUESTIONS) {
        const value = answers[question.id];
        if (value) clean[question.id] = value;
      }
      await updateDoc(doc(db, 'users', user.uid), {
        workStyleCard: clean,
        workStyleCardUpdatedAt: serverTimestamp(),
      });
      notifyUser('Saved', 'These eight answers now shape who we introduce you to — and nothing else.');
      onClose();
    } catch (error) {
      console.warn('Work style card save failed:', error);
      notifyUser('Not saved', 'Your answers stayed on this screen. Try again in a moment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}>
          <View style={styles.head}>
            <Text style={[styles.title, { color: textColor(isDark) }]}>Work style</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <X size={20} color={textColor(isDark)} />
            </TouchableOpacity>
          </View>

          <Text style={styles.intro}>{WORK_STYLE_CARD_INTRO}</Text>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            {WORK_STYLE_QUESTIONS.map((question, index) => (
              <View key={question.id} style={[styles.question, liquidGlass(isDark, false)]}>
                <Text style={[styles.prompt, { color: textColor(isDark) }]}>
                  {index + 1}. {question.prompt}
                </Text>
                <View style={styles.options}>
                  {question.options.map((option) => {
                    const active = answers[question.id] === option.id;
                    return (
                      <TouchableOpacity
                        key={option.id}
                        onPress={() => choose(question.id, option.id)}
                        style={[styles.option, active && styles.optionActive]}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.optionText, { color: active ? '#000' : textColor(isDark, 'secondary') }]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    onPress={() => choose(question.id, '')}
                    style={[styles.option, !answers[question.id] && styles.optionActive]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.optionText, { color: !answers[question.id] ? '#000' : textColor(isDark, 'secondary') }]}>
                      No preference
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity style={styles.saveBtn} onPress={() => void save()} disabled={saving} activeOpacity={0.9}>
            {saving ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={styles.saveText}>
                {answered}/{WORK_STYLE_QUESTIONS.length} ANSWERED · SAVE
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
  intro: { marginTop: 10, marginBottom: 14, fontSize: 12, fontWeight: '700', lineHeight: 18, color: '#666' },
  question: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12 },
  prompt: { fontSize: 13, fontWeight: '900', lineHeight: 18 },
  options: { marginTop: 10, gap: 8 },
  option: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.35)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  optionText: { fontSize: 12, fontWeight: '800' },
  saveBtn: {
    marginBottom: 26,
    height: 50,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, color: '#000' },
});
