import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, SafeAreaView, ActivityIndicator } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Rocket, Target, Briefcase, Zap, ChevronRight, Check, User, MapPin, Code } from 'lucide-react-native';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

const steps = [
  {
    id: 'role',
    title: 'What is your current focus?',
    icon: Rocket,
    type: 'select',
    options: [
      { id: 'founder', label: 'Technical Founder', desc: 'Building the core product' },
      { id: 'growth', label: 'Growth/Marketing', desc: 'Scaling the user base' },
      { id: 'investor', label: 'Angel/VC', desc: 'Seeking the next unicorn' },
      { id: 'advisor', label: 'Advisor', desc: 'Expert guidance for startups' }
    ]
  },
  {
    id: 'ambition',
    title: 'What is your ambition level?',
    icon: Zap,
    type: 'select',
    options: [
      { id: 'unicorn', label: 'Unicorn or Bust', desc: 'Building a $1B+ company' },
      { id: 'lifestyle', label: 'Profitable Indie', desc: 'Sustainable, high-margin business' },
      { id: 'impact', label: 'Social Impact', desc: 'Solving world-scale problems' },
      { id: 'learn', label: 'Skill Acquisition', desc: 'Focused on growth and learning' }
    ]
  },
  {
    id: 'profile_basic',
    title: 'Set up your identity',
    icon: User,
    type: 'form',
    fields: [
      { id: 'displayName', label: 'Display Name', placeholder: 'Elon Musk', icon: User },
      { id: 'city', label: 'Location', placeholder: 'San Francisco, CA', icon: MapPin },
      { id: 'age', label: 'Age', placeholder: '25', icon: Target }
    ]
  },
  {
    id: 'bio',
    title: 'Tell us your story',
    icon: Briefcase,
    type: 'textarea',
    field: { id: 'bio', label: 'Founder Bio', placeholder: 'Serial entrepreneur building the future of...', icon: Briefcase }
  },
  {
    id: 'skills',
    title: 'What are your core skills?',
    icon: Code,
    type: 'input',
    field: { id: 'skills', label: 'Skills (comma separated)', placeholder: 'React, Node.js, Python, Sales', icon: Code }
  }
];

export default function OnboardingScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [isFinishing, setIsFinishing] = useState(false);

  const handleSelect = (stepId: string, optionId: string) => {
    setFormData(prev => ({ ...prev, [stepId]: optionId }));
    if (currentStep < steps.length - 1) {
      setTimeout(() => setCurrentStep(prev => prev + 1), 300);
    }
  };

  const handleInputChange = (fieldId: string, value: string) => {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleFinish = async () => {
    if (!user) return;
    setIsFinishing(true);
    try {
      const skillsArray = formData.skills ? formData.skills.split(',').map((s: string) => s.trim()) : [];
      await updateDoc(doc(db, 'users', user.uid), {
        onboarded: true,
        displayName: formData.displayName || user.displayName,
        city: formData.city || 'Unknown',
        age: parseInt(formData.age) || 20,
        bio: formData.bio || '',
        experience: formData.experience || 'first',
        ambition: formData.ambition || 'unicorn',
        industries: [formData.industries || 'ai'],
        skills: skillsArray,
        commitmentLevel: formData.commitment || 'fulltime'
      });
      // In mobile, we might need to handle navigation differently or rely on state update
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsFinishing(false);
    }
  };

  const step = steps[currentStep];

  const isStepValid = () => {
    if (step.type === 'select') return !!formData[step.id];
    if (step.type === 'form') return step.fields?.every(f => !!formData[f.id]);
    if (step.type === 'textarea') return !!formData[step.field.id];
    if (step.type === 'input') return !!formData[step.field.id];
    return false;
  };

  const Icon = step.icon;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#050508' : '#FFFFFF' }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.progressContainer}>
          {steps.map((_, i) => (
            <View 
              key={i} 
              style={[
                styles.progressBar, 
                { backgroundColor: i <= currentStep ? '#FBE618' : (isDark ? '#222222' : '#EEEEEE') }
              ]} 
            />
          ))}
        </View>

        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Icon size={24} color="#FBE618" />
          </View>
          <Text style={[styles.title, { color: isDark ? '#FFFFFF' : '#000000' }]}>
            {step.title}
          </Text>
        </View>

        <View style={styles.optionsContainer}>
          {step.type === 'select' && step.options?.map((option) => {
            const isSelected = formData[step.id] === option.id;
            return (
              <TouchableOpacity
                key={option.id}
                onPress={() => handleSelect(step.id, option.id)}
                style={[
                  styles.selectButton,
                  { 
                    backgroundColor: isSelected ? '#FBE618' : (isDark ? '#111111' : '#F8F8F8'),
                    borderColor: isSelected ? '#FBE618' : (isDark ? '#222222' : '#EEEEEE')
                  }
                ]}
              >
                <View style={styles.selectHeader}>
                  <Text style={[styles.selectLabel, { color: isSelected ? '#000000' : (isDark ? '#FFFFFF' : '#000000') }]}>
                    {option.label}
                  </Text>
                  {isSelected && <Check size={16} color="#000000" />}
                </View>
                <Text style={[styles.selectDesc, { color: isSelected ? '#00000080' : '#666666' }]}>
                  {option.desc}
                </Text>
              </TouchableOpacity>
            );
          })}

          {step.type === 'form' && step.fields?.map((field) => {
            const FieldIcon = field.icon;
            return (
              <View key={field.id} style={styles.inputWrapper}>
                <FieldIcon size={16} color={isDark ? '#444444' : '#CCCCCC'} style={styles.inputIcon} />
                <TextInput
                  placeholder={field.placeholder}
                  placeholderTextColor={isDark ? '#444444' : '#CCCCCC'}
                  value={formData[field.id] || ''}
                  onChangeText={(text) => handleInputChange(field.id, text)}
                  style={[styles.input, { color: isDark ? '#FFFFFF' : '#000000', backgroundColor: isDark ? '#111111' : '#F8F8F8' }]}
                />
              </View>
            );
          })}

          {step.type === 'textarea' && (
            <TextInput
              placeholder={step.field.placeholder}
              placeholderTextColor={isDark ? '#444444' : '#CCCCCC'}
              value={formData[step.field.id] || ''}
              onChangeText={(text) => handleInputChange(step.field.id, text)}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              style={[styles.textarea, { color: isDark ? '#FFFFFF' : '#000000', backgroundColor: isDark ? '#111111' : '#F8F8F8' }]}
            />
          )}

          {step.type === 'input' && (
            <View style={styles.inputWrapper}>
              <Code size={16} color={isDark ? '#444444' : '#CCCCCC'} style={styles.inputIcon} />
              <TextInput
                placeholder={step.field.placeholder}
                placeholderTextColor={isDark ? '#444444' : '#CCCCCC'}
                value={formData[step.field.id] || ''}
                onChangeText={(text) => handleInputChange(step.field.id, text)}
                style={[styles.input, { color: isDark ? '#FFFFFF' : '#000000', backgroundColor: isDark ? '#111111' : '#F8F8F8' }]}
              />
            </View>
          )}
        </View>

        {step.type !== 'select' && (
          <TouchableOpacity
            disabled={!isStepValid()}
            onPress={currentStep === steps.length - 1 ? handleFinish : handleNext}
            style={[styles.nextButton, { opacity: isStepValid() ? 1 : 0.3 }]}
          >
            {isFinishing ? (
              <ActivityIndicator color="#000000" />
            ) : (
              <>
                <Text style={styles.nextButtonText}>
                  {currentStep === steps.length - 1 ? 'CONNECT TO NETWORK' : 'NEXT STEP'}
                </Text>
                <ChevronRight size={18} color="#000000" />
              </>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 30,
    paddingBottom: 50,
  },
  progressContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 40,
    height: 4,
  },
  progressBar: {
    flex: 1,
    borderRadius: 2,
  },
  header: {
    marginBottom: 40,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#FBE61815',
    borderWidth: 1,
    borderColor: '#FBE61830',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    fontStyle: 'italic',
    textTransform: 'uppercase',
    lineHeight: 36,
  },
  optionsContainer: {
    gap: 12,
    marginBottom: 40,
  },
  selectButton: {
    padding: 24,
    borderRadius: 32,
    borderWidth: 1,
  },
  selectHeader: {
    flexDirection: 'row',
    justifyContent: 'between',
    alignItems: 'center',
    marginBottom: 4,
  },
  selectLabel: {
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
    flex: 1,
  },
  selectDesc: {
    fontSize: 12,
    fontWeight: '500',
  },
  inputWrapper: {
    position: 'relative',
    marginBottom: 12,
  },
  inputIcon: {
    position: 'absolute',
    left: 24,
    top: 22,
    zIndex: 1,
  },
  input: {
    height: 60,
    borderRadius: 30,
    paddingHorizontal: 54,
    fontSize: 14,
    fontWeight: '700',
  },
  textarea: {
    borderRadius: 32,
    padding: 24,
    fontSize: 14,
    fontWeight: '700',
    minHeight: 160,
  },
  nextButton: {
    backgroundColor: '#FBE618',
    height: 60,
    borderRadius: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#FBE618',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 5,
  },
  nextButtonText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
});
