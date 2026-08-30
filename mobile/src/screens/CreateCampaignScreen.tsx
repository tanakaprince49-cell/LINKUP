import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle2, ChevronLeft, Lightbulb, Megaphone, Send } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { displayNameFor } from '../lib/discovery';
import { notifyUser } from '../lib/notify';
import { StartupIdea } from '../types';
import { CAMPAIGN_INDUSTRY_OPTIONS, createCampaign } from '../lib/campaigns';

const toggleValue = (values: string[], value: string) =>
  values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];

export default function CreateCampaignScreen({ navigation, route }: any) {
  const { user, profile: myProfile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const nav = navigation;

  const myIdeas: StartupIdea[] = useMemo(
    () =>
      (Array.isArray((myProfile as any)?.startupIdeas) ? (myProfile as any).startupIdeas : []).filter((idea: any) =>
        String(idea?.title || '').trim()
      ),
    [myProfile]
  );

  const [name, setName] = useState('');
  const [selectedIdeaId, setSelectedIdeaId] = useState<string>('');
  const [industries, setIndustries] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const selectedIdea = myIdeas.find((idea) => idea.id === selectedIdeaId) || null;
  const canSubmit = !!selectedIdea && name.trim().length >= 3 && !submitting;

  const submit = async () => {
    if (!user?.uid) {
      notifyUser('Sign in required', 'Please sign in before launching a campaign.');
      return;
    }
    if (!selectedIdea) {
      notifyUser('Pick an idea', 'Choose which of your ideas this campaign promotes.');
      return;
    }
    if (name.trim().length < 3) {
      notifyUser('Name your campaign', 'Give it a short internal name (only you see this).');
      return;
    }

    setSubmitting(true);
    try {
      await createCampaign({
        ownerId: user.uid,
        ownerName: displayNameFor(myProfile || user),
        ownerPic: (myProfile as any)?.profilePic || user.photoURL || '',
        ownerOccupation: (myProfile as any)?.occupation || '',
        ownerCity: (myProfile as any)?.city || '',
        ownerCountry: (myProfile as any)?.country || '',
        ownerVerified: !!(myProfile as any)?.isVerified,
        name: name.trim(),
        creative: {
          source: 'idea',
          ideaId: selectedIdea.id,
          title: selectedIdea.title.slice(0, 90),
          description: String(selectedIdea.description || '').slice(0, 500),
          stage: selectedIdea.stage || 'Idea Stage',
          lookingFor: Array.isArray(selectedIdea.lookingFor) ? selectedIdea.lookingFor : [],
          tags: Array.isArray(selectedIdea.tags) ? selectedIdea.tags : [],
        },
        industries,
        planProductId: (route?.params?.planProductId as string) || '',
      });
      notifyUser('Campaign submitted 🎉', 'Our team reviews every campaign by hand — yours goes live within 24 hours.');
      nav.goBack();
    } catch (error: any) {
      notifyUser('Could not submit', error?.message || 'Please deploy the latest Firestore rules and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()} style={[styles.headerBtn, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec }]}>
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>New Campaign</Text>
          <Text style={styles.headerSub}>Sponsored card in the Idea Deck</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.label, { color: textColor(isDark, 'muted') }]}>CAMPAIGN NAME (PRIVATE)</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Seed round push"
            placeholderTextColor={isDark ? '#55545E' : '#9CA3AF'}
            maxLength={60}
            style={[styles.input, liquidGlass(isDark), { color: textColor(isDark), borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
          />

          <Text style={[styles.label, { color: textColor(isDark, 'muted') }]}>PROMOTE WHICH IDEA?</Text>
          {myIdeas.length === 0 ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => nav.navigate('IdeaDeck')}
              style={[styles.emptyIdeas, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
            >
              <Lightbulb size={22} color={COLORS.primaryStrong} />
              <Text style={[styles.emptyIdeasTitle, { color: textColor(isDark) }]}>Post an idea first</Text>
              <Text style={[styles.emptyIdeasCopy, { color: textColor(isDark, 'secondary') }]}>
                Campaigns promote one of your posted ideas. Tap to open the Idea Deck and publish one — then come back.
              </Text>
            </TouchableOpacity>
          ) : (
            myIdeas.slice(0, 8).map((idea) => {
              const selected = idea.id === selectedIdeaId;
              return (
                <TouchableOpacity
                  key={idea.id}
                  activeOpacity={0.85}
                  onPress={() => setSelectedIdeaId(idea.id)}
                  style={[
                    styles.ideaRow,
                    liquidGlass(isDark),
                    { borderColor: selected ? COLORS.primary : isDark ? COLORS.darkBorder : COLORS.lightBorder },
                    selected && { borderWidth: 2 },
                  ]}
                >
                  <View style={[styles.ideaIcon, { backgroundColor: selected ? COLORS.primary : isDark ? 'rgba(223,251,63,0.12)' : COLORS.primaryGlow }]}>
                    <Lightbulb size={16} color={selected ? COLORS.lightTextPrimary : COLORS.primaryStrong} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.ideaTitle, { color: textColor(isDark) }]} numberOfLines={1}>
                      {idea.title}
                    </Text>
                    <Text style={[styles.ideaMeta, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>
                      {idea.description}
                    </Text>
                  </View>
                  {selected ? <CheckCircle2 size={18} color={COLORS.primaryStrong} /> : null}
                </TouchableOpacity>
              );
            })
          )}

          <Text style={[styles.label, { color: textColor(isDark, 'muted') }]}>AUDIENCE FOCUS (OPTIONAL)</Text>
          <View style={styles.chipRow}>
            {CAMPAIGN_INDUSTRY_OPTIONS.map((option) => {
              const active = industries.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  onPress={() => setIndustries((current) => toggleValue(current, option))}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{option}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[styles.hint, { color: textColor(isDark, 'muted') }]}>
            Helps us rank your card for the right founders as targeting rolls out.
          </Text>

          <View style={[styles.reviewNote, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
            <Megaphone size={16} color={COLORS.primaryStrong} />
            <Text style={[styles.reviewNoteText, { color: textColor(isDark, 'secondary') }]}>
              Every campaign is reviewed by a human before going live — keep it founder-relevant and it ships within 24 hours. Sponsored cards are clearly labeled and PLUS members never see ads.
            </Text>
          </View>

          <TouchableOpacity
            onPress={submit}
            disabled={!canSubmit}
            activeOpacity={0.86}
            style={[styles.submitBtn, { backgroundColor: COLORS.primary }, !canSubmit && styles.submitBtnDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color={COLORS.lightTextPrimary} />
            ) : (
              <>
                <Send size={15} color={COLORS.lightTextPrimary} />
                <Text style={[styles.submitText, { color: COLORS.lightTextPrimary }]}>SUBMIT FOR REVIEW</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 74,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '900', letterSpacing: 4 },
  headerSub: { marginTop: 4, color: '#666', fontSize: 10, fontWeight: '900' },
  scroll: { padding: 16, paddingTop: 6, paddingBottom: 48 },
  label: { marginTop: 14, marginBottom: 10, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 15,
    fontWeight: '800',
  },
  emptyIdeas: { borderWidth: 1, borderRadius: 20, padding: 20, alignItems: 'center', gap: 8 },
  emptyIdeasTitle: { fontSize: 15, fontWeight: '900' },
  emptyIdeasCopy: { fontSize: 12, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  ideaRow: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  ideaIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  ideaTitle: { fontSize: 13, fontWeight: '900' },
  ideaMeta: { marginTop: 3, fontSize: 10, lineHeight: 15, fontWeight: '800' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: COLORS.lightCard,
  },
  chipActive: { borderColor: COLORS.lightBorderActive, backgroundColor: COLORS.primary },
  chipText: { color: '#555', fontSize: 11, fontWeight: '900' },
  chipTextActive: { color: '#000' },
  hint: { marginTop: 10, fontSize: 10, fontWeight: '800', lineHeight: 15 },
  reviewNote: {
    marginTop: 20,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  reviewNoteText: { flex: 1, fontSize: 11, lineHeight: 17, fontWeight: '700' },
  submitBtn: {
    marginTop: 18,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  submitBtnDisabled: { opacity: 0.55 },
  submitText: { fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
});
