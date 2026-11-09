import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Crown, PenLine } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, textColor } from '../theme/theme';
import { doc, setDoc } from '../lib/firestoreCompat';
import { db } from '../lib/firebase';
import {
  assessMyProfileWithLinky,
  LinkyApiError,
  writeMyProfileWithLinky,
  type LinkyProfileAssessment,
  type LinkyProfileDraft,
} from '../lib/linkyApi';

/**
 * LET LINKY WRITE IT — a LINKUP PLUS feature, on the member's own profile.
 *
 * The member already told LINKUP what they are building and which seat is empty.
 * What they cannot do is write about themselves well after a full day of
 * building, so Linky writes the bio, the headline, the skills line and the roles
 * they need — from their own facts only — and then waits.
 *
 * The conversation has an order, and the order is the feature:
 *  1. READ. Linky grades the profile first (cheap, deterministic, server-side).
 *  2. RECOMMEND. A profile that already reads well is told so, with the
 *     receipts — Linky does not fix what is not broken. A weak one hears its
 *     gaps named, one by one.
 *  3. ASK. Before drafting, Linky asks everything onboarding asked — role,
 *     the build, the one-liner, the empty seat, skills, industries, stage,
 *     funding, goals, city, experience, commitment, work style — each with
 *     its reason, because a complete brief gets a sharper profile and
 *     sharper matches. Answers save to the real profile. Skipping is
 *     allowed; writing from a half-empty brief without asking is not.
 *  4. PERMISSION. Nothing is drafted until the member says "write it for me".
 *     "Rewrite it anyway" is the only way past a good-profile verdict.
 *  5. APPROVE. Nothing is saved until the member taps save, and what is saved is exactly
 *     the words on screen (the draft goes back to the server, so there is no
 *     second, unseen generation).
 *
 * The server is the gate at every step. A 402 opens the paywall, never a dead
 * end; if Linky has nothing to work from, it says so and asks for the one
 * field, rather than inventing a company or a city.
 */

type Phase = 'idle' | 'checking' | 'verdict' | 'questions' | 'writing' | 'draft';

type Props = {
  isPlus: boolean;
  onUpgrade: () => void;
  onSaved: (draft: LinkyProfileDraft) => void;
  /** The member's uid — Linky's questions save their answers to this profile. */
  uid: string;
  /** Fired after onboarding answers are saved, so the screen can refresh. */
  onAnswersSaved?: () => void;
  /** What Linky already knows, for the pitch. */
  building?: string;
  seat?: string;
};

export default function LinkyWritesProfile({ isPlus, onUpgrade, onSaved, uid, onAnswersSaved, building = '', seat = '' }: Props) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [phase, setPhase] = useState<Phase>('idle');
  const [assessment, setAssessment] = useState<LinkyProfileAssessment | null>(null);
  const [draft, setDraft] = useState<LinkyProfileDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState(false);
  const [savingAnswers, setSavingAnswers] = useState(false);

  const reset = useCallback(() => {
    setPhase('idle');
    setAssessment(null);
    setDraft(null);
    setAnswers({});
    setSkipped(false);
  }, []);

  const fail = useCallback((error: unknown) => {
    const status = error instanceof LinkyApiError ? error.status : 0;
    if (status === 402) onUpgrade();
    else if (status === 400) {
      Alert.alert('One thing first', 'Tell LINKUP what you are building — Linky will not invent it.');
    } else {
      Alert.alert('Linky could not do that', error instanceof Error ? error.message : 'Try again in a minute.');
    }
  }, [onUpgrade]);

  // Step 1+2: read and recommend. No writing has happened, and none will
  // until the member gives permission on the next screen.
  const check = useCallback(async () => {
    if (!isPlus) {
      onUpgrade();
      return;
    }
    setPhase('checking');
    try {
      const result = await assessMyProfileWithLinky();
      if (result?.assessment) {
        setAssessment(result.assessment);
        setPhase('verdict');
      } else {
        setPhase('idle');
        Alert.alert('Linky could not read it', 'Try again in a minute.');
      }
    } catch (error) {
      setPhase('idle');
      fail(error);
    }
  }, [isPlus, onUpgrade, fail]);

  // Step 3+4: permission has been given — draft, then let the member read.
  const generate = useCallback(async (allowRewrite: boolean) => {
    if (!isPlus) {
      onUpgrade();
      return;
    }
    setPhase('writing');
    try {
      const result = allowRewrite
        ? await writeMyProfileWithLinky({ save: false, allowRewrite: true })
        : await writeMyProfileWithLinky({ save: false });
      if (result?.draft) {
        setDraft(result.draft);
        setPhase('draft');
      } else if (result?.reason === 'already_good') {
        // The server's verdict, not a failure: show it and stop.
        if (result.assessment) setAssessment(result.assessment);
        setPhase('verdict');
      } else {
        setPhase(assessment ? 'verdict' : 'idle');
        Alert.alert('Linky could not write it', 'Try again in a minute.');
      }
    } catch (error) {
      setPhase(assessment ? 'verdict' : 'idle');
      fail(error);
    }
  }, [isPlus, onUpgrade, fail, assessment]);

  // Step 3: the answers are the member's own profile data — save them to the
  // real profile (they sharpen matching too), then let Linky re-read.
  const saveAnswers = useCallback(async () => {
    if (!assessment) return;
    const patch: Record<string, unknown> = {};
    for (const q of assessment.questions) {
      const raw = String(answers[q.id] || '').trim();
      if (!raw) continue;
      if (q.kind === 'list') {
        const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
        if (items.length) for (const key of q.keys) patch[key] = items;
      } else {
        patch[q.keys[0]] = raw;
      }
    }
    if (!Object.keys(patch).length) {
      Alert.alert('Nothing to save yet', 'Answer at least one question — or skip and let Linky write from what it already has.');
      return;
    }
    if (!uid) {
      Alert.alert('Sign in again', 'Your session dropped — sign back in and Linky picks this up.');
      return;
    }
    setSavingAnswers(true);
    try {
      await setDoc(doc(db, 'users', uid), patch, { merge: true });
      onAnswersSaved?.();
      setAnswers({});
      setSkipped(false);
      const result = await assessMyProfileWithLinky();
      if (result?.assessment) setAssessment(result.assessment);
      setPhase('verdict');
    } catch (error) {
      Alert.alert('Could not save your answers', error instanceof Error ? error.message : 'Try once more in a moment.');
    } finally {
      setSavingAnswers(false);
    }
  }, [assessment, answers, uid, onAnswersSaved]);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const result = await writeMyProfileWithLinky({ save: true, draft });
      if (result?.saved) {
        const savedDraft = draft;
        reset();
        onSaved(savedDraft);
        Alert.alert('Saved', 'Your profile now reads the way Linky wrote it. Edit anything you like — it is yours.');
      } else {
        Alert.alert('Could not save', 'Try once more in a moment.');
      }
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : 'Try once more in a moment.');
    } finally {
      setSaving(false);
    }
  }, [draft, onSaved, reset]);

  const cardBg = isDark ? '#12151E' : '#FFFDF0';
  const border = isDark ? 'rgba(251,230,24,0.35)' : '#E7E1BF';
  const strong = assessment?.verdict === 'strong';

  return (
    <View testID="linky-writes-profile" style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
      <View style={styles.head}>
        {isPlus ? <PenLine size={15} color={COLORS.primaryStrong} /> : <Crown size={15} color={COLORS.primaryStrong} />}
        <Text style={[styles.label, { color: textColor(isDark, 'muted') }]}>
          {isPlus ? 'LINKY WRITES YOUR PROFILE' : 'LINKY PLUS · LINKY WRITES YOUR PROFILE'}
        </Text>
      </View>

      {phase === 'idle' ? (
        <>
          <Text style={[styles.title, { color: textColor(isDark) }]}>
            {isPlus ? 'Let Linky write it for you' : 'You write it at midnight. Linky could write it now.'}
          </Text>
          <Text style={[styles.body, { color: textColor(isDark, 'secondary') }]}>
            {building
              ? `Linky already knows you are building ${building}${seat ? ` and that the seat you need filled is a ${seat.toLowerCase()}` : ''}. First it reads your profile and says honestly whether it even needs fixing. If it does, it asks your permission, writes from your own facts — and you approve every word before it is saved.`
              : 'Linky already has what you told LINKUP about your project and the seat you need filled. First it reads your profile and says honestly whether it even needs fixing. If it does, it asks your permission — and you approve every word before anything is saved.'}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            testID="linky-writes-profile-cta"
            activeOpacity={0.88}
            onPress={() => void check()}
            style={[styles.cta, { backgroundColor: COLORS.primary }]}
          >
            <Text style={styles.ctaText}>{isPlus ? 'Ask Linky to write it' : 'Unlock with PLUS'}</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {phase === 'checking' ? (
        <View style={styles.waiting}>
          <ActivityIndicator size="small" color={COLORS.primaryStrong} />
          <Text style={[styles.body, { color: textColor(isDark, 'secondary') }]}>Linky is reading your profile…</Text>
        </View>
      ) : null}

      {phase === 'writing' ? (
        <View style={styles.waiting}>
          <ActivityIndicator size="small" color={COLORS.primaryStrong} />
          <Text style={[styles.body, { color: textColor(isDark, 'secondary') }]}>Linky is writing…</Text>
        </View>
      ) : null}

      {phase === 'verdict' && assessment ? (
        <>
          <Text style={[styles.title, { color: textColor(isDark) }]}>
            {strong
              ? 'Your profile already reads well'
              : assessment.verdict === 'patchy'
                ? 'So close — Linky can tighten this'
                : 'Linky can write this from what it knows'}
          </Text>
          <Text style={[styles.body, { color: textColor(isDark, 'secondary') }]}>{assessment.recommendation}</Text>
          <Text style={[styles.body, { color: textColor(isDark, 'secondary') }]}>
            {`Your brief is ${assessment.completeness.percent}% complete — ${assessment.completeness.answered} of ${assessment.completeness.total} onboarding answers in. Complete briefs get sharper profiles, and the same answers sharpen who Linky matches you with.`}
          </Text>

          {assessment.strengths.length ? (
            <View style={styles.listBlock}>
              <Text style={[styles.draftLabel, { color: textColor(isDark, 'muted') }]}>WHAT IS WORKING</Text>
              {assessment.strengths.map((line) => (
                <Text key={line} style={[styles.listLine, { color: textColor(isDark, 'secondary') }]}>✓ {line}</Text>
              ))}
            </View>
          ) : null}

          {assessment.gaps.length ? (
            <View style={styles.listBlock}>
              <Text style={[styles.draftLabel, { color: textColor(isDark, 'muted') }]}>WHAT LINKY WOULD FIX</Text>
              {assessment.gaps.map((line) => (
                <Text key={line} style={[styles.listLine, { color: textColor(isDark, 'secondary') }]}>• {line}</Text>
              ))}
            </View>
          ) : null}

          {strong ? (
            <>
              <TouchableOpacity
                accessibilityRole="button"
                testID="linky-writes-profile-keep"
                activeOpacity={0.88}
                onPress={reset}
                style={[styles.cta, { backgroundColor: COLORS.primary }]}
              >
                <Text style={styles.ctaText}>Keep my profile</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => void generate(true)} activeOpacity={0.8} style={styles.ghostBtn}>
                <Text style={[styles.ghostText, { color: textColor(isDark, 'secondary') }]}>Rewrite it anyway</Text>
              </TouchableOpacity>
              {assessment.questions.length ? (
                <TouchableOpacity onPress={() => setPhase('questions')} activeOpacity={0.8} style={styles.ghostBtn}>
                  <Text style={[styles.ghostText, { color: textColor(isDark, 'secondary') }]}>Answer a few more questions first</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : assessment.questions.length && !skipped ? (
            <>
              <Text style={[styles.body, { color: textColor(isDark, 'secondary') }]}>
                Before Linky writes, it asks — everything onboarding asked, because it can only write what it knows. Two minutes here is the difference between a generic profile and one that sounds like you.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                testID="linky-writes-profile-questions"
                activeOpacity={0.88}
                onPress={() => setPhase('questions')}
                style={[styles.cta, { backgroundColor: COLORS.primary }]}
              >
                <Text style={styles.ctaText}>{`Answer ${assessment.questions.length} quick questions`}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSkipped(true)} activeOpacity={0.8} style={styles.ghostBtn}>
                <Text style={[styles.ghostText, { color: textColor(isDark, 'secondary') }]}>Skip — write from what Linky knows</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={[styles.body, { color: textColor(isDark, 'secondary') }]}>
                May Linky write it for you? It only uses what LINKUP already knows about you, and nothing is saved until you read and approve the draft.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                testID="linky-writes-profile-permission"
                activeOpacity={0.88}
                onPress={() => void generate(false)}
                style={[styles.cta, { backgroundColor: COLORS.primary }]}
              >
                <Text style={styles.ctaText}>Yes — write it for me</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={reset} activeOpacity={0.8} style={styles.ghostBtn}>
                <Text style={[styles.ghostText, { color: textColor(isDark, 'secondary') }]}>Not now</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      ) : null}

      {phase === 'questions' && assessment ? (
        <>
          <Text style={[styles.title, { color: textColor(isDark) }]}>Linky needs the full picture</Text>
          <Text style={[styles.body, { color: textColor(isDark, 'secondary') }]}>
            Onboarding asked these for a reason: Linky writes only from what it knows, and it will not invent the rest. Every answer lands on your real profile — complete it here and your profile gets sharper, your matches get sharper, and Linky's draft stops guessing.
          </Text>
          <Text style={[styles.draftLabel, { color: textColor(isDark, 'muted') }]}>
            {`${assessment.completeness.answered} OF ${assessment.completeness.total} ANSWERED — ${assessment.questions.length} TO GO`}
          </Text>
          {assessment.questions.map((q) => (
            <View key={q.id} style={styles.qBlock}>
              <Text style={[styles.qPrompt, { color: textColor(isDark) }]}>{q.prompt}</Text>
              <Text style={[styles.qWhy, { color: textColor(isDark, 'muted') }]}>{q.why}</Text>
              <TextInput
                accessibilityLabel={q.prompt}
                value={answers[q.id] || ''}
                onChangeText={(t: string) => setAnswers((prev) => ({ ...prev, [q.id]: t }))}
                placeholder={q.kind === 'list' ? 'One, two, three…' : 'Your answer'}
                placeholderTextColor={textColor(isDark, 'muted')}
                style={[styles.qInput, { color: textColor(isDark), borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
              />
            </View>
          ))}
          <TouchableOpacity
            accessibilityRole="button"
            testID="linky-writes-profile-save-answers"
            activeOpacity={0.88}
            onPress={() => void saveAnswers()}
            disabled={savingAnswers}
            style={[styles.cta, { backgroundColor: COLORS.primary }]}
          >
            {savingAnswers ? <ActivityIndicator size="small" color="#000" /> : null}
            <Text style={styles.ctaText}>{savingAnswers ? 'Saving…' : 'Save my answers'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setSkipped(true); setPhase('verdict'); }}
            activeOpacity={0.8}
            style={styles.ghostBtn}
          >
            <Text style={[styles.ghostText, { color: textColor(isDark, 'secondary') }]}>Skip for now</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {phase === 'draft' && draft ? (
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
            <TouchableOpacity onPress={() => void generate(strong)} activeOpacity={0.8} style={styles.ghostBtn}>
              <Text style={[styles.ghostText, { color: textColor(isDark, 'secondary') }]}>Write it again</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={reset} activeOpacity={0.8} style={styles.ghostBtn}>
              <Text style={[styles.ghostText, { color: textColor(isDark, 'secondary') }]}>Discard</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 14, borderRadius: 16, borderWidth: 1, padding: 14, gap: 9 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  label: { fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  title: { fontSize: 17, fontWeight: '900', letterSpacing: -0.4, lineHeight: 22 },
  body: { fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 6 },
  listBlock: { gap: 4 },
  listLine: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  qBlock: { gap: 3, marginTop: 4 },
  qPrompt: { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  qWhy: { fontSize: 11, fontWeight: '600', lineHeight: 15 },
  qInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, fontSize: 13, fontWeight: '600', marginTop: 2 },
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
