import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import * as ImagePicker from 'expo-image-picker';
import { uploadImageToStorage } from '../lib/mediaUpload';

type Choice = { id: string; label: string; desc?: string };

const identityChoices: Choice[] = [
  { id: 'Founder', label: 'Founder' },
  { id: 'Developer', label: 'Developer' },
  { id: 'Designer', label: 'Designer' },
  { id: 'Investor', label: 'Investor' },
  { id: 'Marketer', label: 'Marketer' },
  { id: 'Student', label: 'Student' },
  { id: 'Operator', label: 'Operator' },
];

const goalsChoices: Choice[] = [
  { id: 'Cofounder', label: 'Cofounder' },
  { id: 'Startup team', label: 'Startup team' },
  { id: 'Networking', label: 'Networking' },
  { id: 'Hiring', label: 'Hiring' },
  { id: 'Investment', label: 'Investment' },
  { id: 'Mentorship', label: 'Mentorship' },
];

const industryChoices: Choice[] = [
  { id: 'AI', label: 'AI' },
  { id: 'SaaS', label: 'SaaS' },
  { id: 'Fintech', label: 'Fintech' },
  { id: 'Healthtech', label: 'Healthtech' },
  { id: 'Gaming', label: 'Gaming' },
  { id: 'E-commerce', label: 'E-commerce' },
  { id: 'Crypto', label: 'Crypto' },
  { id: 'Education', label: 'Education' },
  { id: 'Media', label: 'Media' },
];

const skillChoices: Choice[] = [
  { id: 'Frontend', label: 'Frontend' },
  { id: 'Backend', label: 'Backend' },
  { id: 'UI/UX', label: 'UI/UX' },
  { id: 'Sales', label: 'Sales' },
  { id: 'Marketing', label: 'Marketing' },
  { id: 'Finance', label: 'Finance' },
  { id: 'Product', label: 'Product management' },
  { id: 'AI engineering', label: 'AI engineering' },
];

const experienceChoices: Choice[] = [
  { id: 'Beginner', label: 'Beginner' },
  { id: 'Intermediate', label: 'Intermediate' },
  { id: 'Experienced', label: 'Experienced' },
  { id: 'Exited founder', label: 'Exited founder' },
];

const workStyleChoices: Choice[] = [
  { id: 'Fast-paced', label: 'Fast-paced' },
  { id: 'Structured', label: 'Structured' },
  { id: 'Experimental', label: 'Experimental' },
  { id: 'Analytical', label: 'Analytical' },
  { id: 'Creative', label: 'Creative' },
];

const commitmentChoices: Choice[] = [
  { id: 'Weekends only', label: 'Weekends only' },
  { id: 'Part-time', label: 'Part-time' },
  { id: 'Full-time', label: 'Full-time' },
  { id: 'Actively building', label: 'Actively building' },
];

const startupStageChoices: Choice[] = [
  { id: 'Idea stage', label: 'Idea stage' },
  { id: 'MVP', label: 'MVP' },
  { id: 'Early traction', label: 'Early traction' },
  { id: 'Scaling', label: 'Scaling' },
];

const personalityQuestions = [
  {
    id: 'executionVsPlanning',
    title: 'Execution or Planning?',
    a: { id: 'Execution', label: 'Execution' },
    b: { id: 'Planning', label: 'Planning' },
  },
  {
    id: 'risk',
    title: 'Risk taker or Cautious?',
    a: { id: 'Risk taker', label: 'Risk taker' },
    b: { id: 'Cautious', label: 'Cautious' },
  },
  {
    id: 'team',
    title: 'Solo or Team-oriented?',
    a: { id: 'Solo', label: 'Solo' },
    b: { id: 'Team-oriented', label: 'Team-oriented' },
  },
  {
    id: 'competitive',
    title: 'Competitive or Collaborative?',
    a: { id: 'Competitive', label: 'Competitive' },
    b: { id: 'Collaborative', label: 'Collaborative' },
  },
] as const;

function buildCircles(input: {
  role: string;
  industries: string[];
  skills: string[];
  experience: string;
}) {
  const circles: string[] = [];
  if (input.role) circles.push(`${input.role}s`);
  input.industries.slice(0, 3).forEach((i) => circles.push(`${i} Builders`));
  if (input.skills.some((s) => s.toLowerCase().includes('ai'))) circles.push('AI Builders');
  if (input.skills.some((s) => s.toLowerCase().includes('frontend'))) circles.push('Frontend Builders');
  if (input.skills.some((s) => s.toLowerCase().includes('backend'))) circles.push('Backend Builders');
  if (input.experience) circles.push(input.experience);
  return Array.from(new Set(circles)).slice(0, 8);
}

const StepTitle = ({ title, subtitle, isDark }: { title: string; subtitle: string; isDark: boolean }) => (
  <View style={{ marginBottom: 18 }}>
    <Text style={[styles.title, { color: isDark ? '#FFF' : '#000' }]}>{title}</Text>
    <Text style={[styles.subtitle, { color: '#666' }]}>{subtitle}</Text>
  </View>
);

const PhotoSlot = ({
  label,
  uri,
  onPress,
  isDark,
}: {
  label: string;
  uri: string | null;
  onPress: () => void;
  isDark: boolean;
}) => {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[
        styles.photoSlot,
        {
          backgroundColor: isDark ? '#16161A' : '#F8F8F8',
          borderColor: isDark ? '#222226' : '#EEEEEE',
        },
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.photoSlotImg} />
      ) : (
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1, color: isDark ? '#FFF' : '#000' }}>
            ADD
          </Text>
        </View>
      )}
      <View style={[styles.photoSlotLabel, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
        <Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 1, color: isDark ? '#FFF' : '#000' }} numberOfLines={1}>
          {label.toUpperCase()}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const ChoiceGrid = ({
  value,
  onChange,
  choices,
  multi,
  isDark,
}: {
  value: string | string[];
  onChange: (next: string | string[]) => void;
  choices: Choice[];
  multi?: boolean;
  isDark: boolean;
}) => {
  const selected = Array.isArray(value) ? value : [value].filter(Boolean);
  const toggle = (id: string) => {
    if (!multi) return onChange(id);
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next);
  };

  return (
    <View style={styles.grid}>
      {choices.map((c) => {
        const on = selected.includes(c.id);
        return (
          <TouchableOpacity
            key={c.id}
            onPress={() => toggle(c.id)}
            style={[
              styles.choice,
              {
                backgroundColor: on ? '#FBE618' : (isDark ? '#16161A' : '#F8F8F8'),
                borderColor: isDark ? '#222226' : '#EEEEEE',
              },
            ]}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '900',
                letterSpacing: 1,
                color: on ? '#000' : (isDark ? '#FFF' : '#000'),
              }}
              numberOfLines={1}
            >
              {c.label.toUpperCase()}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

export default function OnboardingScreen({ navigation }: any) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [profilePicUri, setProfilePicUri] = useState<string>('');
  const [proofPhotos, setProofPhotos] = useState<string[]>(['', '', '']);

  const [role, setRole] = useState('');
  const [lookingFor, setLookingFor] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [experience, setExperience] = useState('');
  const [workStyle, setWorkStyle] = useState('');
  const [commitmentLevel, setCommitmentLevel] = useState('');
  const [startupStage, setStartupStage] = useState('');
  const [personalityAnswers, setPersonalityAnswers] = useState<Record<string, string>>({});

  const pickPhoto = async (slot: 'profile' | number) => {
    try {
      // Prefer camera for "proof of human", but fall back to library.
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (cam.status !== 'granted' && lib.status !== 'granted') {
        Alert.alert('Permission Denied', 'Please allow camera or photo library access.');
        return;
      }

      let result: ImagePicker.ImagePickerResult | null = null;
      if (cam.status === 'granted') {
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
      } else if (lib.status === 'granted') {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
      }

      if (!result || result.canceled) return;
      const uri = result.assets?.[0]?.uri || '';
      if (!uri) return;

      if (slot === 'profile') {
        setProfilePicUri(uri);
      } else {
        setProofPhotos((prev) => {
          const next = [...prev];
          next[slot] = uri;
          return next;
        });
      }
    } catch (e: any) {
      console.error('pickPhoto error', e);
      Alert.alert('Error', e?.message || 'Could not pick photo.');
    }
  };

  const steps = useMemo(
    () => [
      {
        key: 'photos',
        title: 'Your Photos',
        subtitle: 'Add a profile picture + 3 photos to prove you’re human.',
        body: (
          <View>
            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'space-between' }}>
              <PhotoSlot label="Profile" uri={profilePicUri || null} onPress={() => pickPhoto('profile')} isDark={isDark} />
              <PhotoSlot label="Photo 1" uri={proofPhotos[0] || null} onPress={() => pickPhoto(0)} isDark={isDark} />
            </View>
            <View style={{ height: 10 }} />
            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'space-between' }}>
              <PhotoSlot label="Photo 2" uri={proofPhotos[1] || null} onPress={() => pickPhoto(1)} isDark={isDark} />
              <PhotoSlot label="Photo 3" uri={proofPhotos[2] || null} onPress={() => pickPhoto(2)} isDark={isDark} />
            </View>
            <Text style={{ marginTop: 12, fontSize: 11, color: '#666', fontWeight: '800', lineHeight: 16 }}>
              These 3 photos are used on your swipe profile. You can edit them later from your profile page.
            </Text>
          </View>
        ),
        canNext: !!profilePicUri && proofPhotos.every((p) => !!p),
      },
      {
        key: 'identity',
        title: 'Your Identity',
        subtitle: 'What best describes you?',
        body: (
          <ChoiceGrid value={role} onChange={(v) => setRole(String(v))} choices={identityChoices} isDark={isDark} />
        ),
        canNext: !!role,
      },
      {
        key: 'goals',
        title: 'Your Goals',
        subtitle: 'What are you looking for?',
        body: (
          <ChoiceGrid
            value={lookingFor}
            onChange={(v) => setLookingFor(v as string[])}
            choices={goalsChoices}
            multi
            isDark={isDark}
          />
        ),
        canNext: lookingFor.length > 0,
      },
      {
        key: 'industries',
        title: 'Industries',
        subtitle: 'Select your startup interests.',
        body: (
          <ChoiceGrid
            value={industries}
            onChange={(v) => setIndustries(v as string[])}
            choices={industryChoices}
            multi
            isDark={isDark}
          />
        ),
        canNext: industries.length > 0,
      },
      {
        key: 'skills',
        title: 'Skills',
        subtitle: 'What can you contribute?',
        body: (
          <ChoiceGrid
            value={skills}
            onChange={(v) => setSkills(v as string[])}
            choices={skillChoices}
            multi
            isDark={isDark}
          />
        ),
        canNext: skills.length > 0,
      },
      {
        key: 'experience',
        title: 'Experience Level',
        subtitle: 'Choose what matches you best.',
        body: (
          <ChoiceGrid
            value={experience}
            onChange={(v) => setExperience(String(v))}
            choices={experienceChoices}
            isDark={isDark}
          />
        ),
        canNext: !!experience,
      },
      {
        key: 'workStyle',
        title: 'Work Style',
        subtitle: 'How do you like to build?',
        body: (
          <ChoiceGrid
            value={workStyle}
            onChange={(v) => setWorkStyle(String(v))}
            choices={workStyleChoices}
            isDark={isDark}
          />
        ),
        canNext: !!workStyle,
      },
      {
        key: 'commitment',
        title: 'Commitment Level',
        subtitle: 'How available are you right now?',
        body: (
          <ChoiceGrid
            value={commitmentLevel}
            onChange={(v) => setCommitmentLevel(String(v))}
            choices={commitmentChoices}
            isDark={isDark}
          />
        ),
        canNext: !!commitmentLevel,
      },
      {
        key: 'stage',
        title: 'Startup Stage',
        subtitle: 'Where are you right now?',
        body: (
          <ChoiceGrid
            value={startupStage}
            onChange={(v) => setStartupStage(String(v))}
            choices={startupStageChoices}
            isDark={isDark}
          />
        ),
        canNext: !!startupStage,
      },
      {
        key: 'personality',
        title: 'Personality',
        subtitle: 'Quick preferences that improve matching.',
        body: (
          <View style={{ gap: 12 }}>
            {personalityQuestions.map((q) => {
              const v = personalityAnswers[q.id];
              return (
                <View key={q.id} style={[styles.card, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
                  <Text style={[styles.cardTitle, { color: isDark ? '#FFF' : '#000' }]}>{q.title}</Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    {[q.a, q.b].map((opt) => {
                      const on = v === opt.id;
                      return (
                        <TouchableOpacity
                          key={opt.id}
                          onPress={() => setPersonalityAnswers((p) => ({ ...p, [q.id]: opt.id }))}
                          style={[
                            styles.choice,
                            {
                              flex: 1,
                              backgroundColor: on ? '#FBE618' : (isDark ? '#16161A' : '#F8F8F8'),
                              borderColor: isDark ? '#222226' : '#EEEEEE',
                            },
                          ]}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '900', letterSpacing: 1, color: on ? '#000' : (isDark ? '#FFF' : '#000') }}>
                            {opt.label.toUpperCase()}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        ),
        canNext: personalityQuestions.every((q) => !!personalityAnswers[q.id]),
      },
    ],
    [
      profilePicUri,
      proofPhotos,
      role,
      lookingFor,
      industries,
      skills,
      experience,
      workStyle,
      commitmentLevel,
      startupStage,
      personalityAnswers,
      isDark,
    ]
  );

  const current = steps[step];

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const circles = buildCircles({ role, industries, skills, experience });
      const ts = Date.now();
      const profilePic = profilePicUri
        ? await uploadImageToStorage({ uri: profilePicUri, path: `userPhotos/${user.uid}/profile_${ts}` })
        : '';
      const photos = await Promise.all(
        proofPhotos.map((uri, idx) => uploadImageToStorage({ uri, path: `userPhotos/${user.uid}/proof_${idx + 1}_${ts}` }))
      );
      await updateDoc(doc(db, 'users', user.uid), {
        occupation: role,
        lookingFor,
        industries,
        skills,
        experience,
        workStyle,
        commitmentLevel,
        startupStage,
        personalityAnswers,
        circles,
        profilePic,
        photos,
        onboarded: true,
        lastActiveAt: serverTimestamp(),
      } as any);
      navigation?.replace?.('Main');
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.stepCount, { color: isDark ? '#AAA' : '#666' }]}>
          STEP {step + 1} / {steps.length}
        </Text>
        <View style={[styles.track, { backgroundColor: isDark ? '#1A1A1F' : '#EEEEEE' }]}>
          <View style={[styles.fill, { width: `${Math.round(((step + 1) / steps.length) * 100)}%` }]} />
        </View>

        <View style={{ marginTop: 18 }}>
          <StepTitle title={current.title} subtitle={current.subtitle} isDark={isDark} />
          {current.body}
        </View>

        <View style={{ height: 24 }} />

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            disabled={step === 0 || saving}
            onPress={() => setStep((s) => Math.max(0, s - 1))}
            style={[
              styles.btn,
              {
                backgroundColor: isDark ? '#16161A' : '#F8F8F8',
                borderColor: isDark ? '#222226' : '#EEEEEE',
                flex: 1,
                opacity: step === 0 || saving ? 0.5 : 1,
              },
            ]}
          >
            <Text style={[styles.btnText, { color: isDark ? '#FFF' : '#000' }]}>BACK</Text>
          </TouchableOpacity>

          {step < steps.length - 1 ? (
            <TouchableOpacity
              disabled={!current.canNext || saving}
              onPress={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
              style={[styles.btn, { backgroundColor: '#FBE618', flex: 1, opacity: !current.canNext || saving ? 0.5 : 1 }]}
            >
              <Text style={[styles.btnText, { color: '#000' }]}>NEXT</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              disabled={!current.canNext || saving}
              onPress={finish}
              style={[styles.btn, { backgroundColor: '#FBE618', flex: 1, opacity: !current.canNext || saving ? 0.5 : 1 }]}
            >
              {saving ? <ActivityIndicator color="#000" /> : <Text style={[styles.btnText, { color: '#000' }]}>FINISH</Text>}
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 90 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingTop: 22 },
  stepCount: { fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 10 },
  fill: { height: 4, backgroundColor: '#FBE618' },
  title: { fontSize: 24, fontWeight: '900', letterSpacing: 1, color: '#000' },
  subtitle: { marginTop: 6, fontSize: 12, fontWeight: '700', color: '#666', lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: {
    minWidth: '48%',
    height: 54,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  photoSlot: {
    flex: 1,
    height: 150,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  photoSlotImg: { width: '100%', height: '100%' },
  photoSlotLabel: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#00000010',
    alignItems: 'center',
  },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 14,
  },
  cardTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  btn: {
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  btnText: { fontSize: 12, fontWeight: '900', letterSpacing: 2 },
});
