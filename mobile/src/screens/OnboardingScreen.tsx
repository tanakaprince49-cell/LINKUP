import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, SafeAreaView, ActivityIndicator, Image, Dimensions, Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import * as Icons from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { uploadMedia } from '../lib/storage';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

const { width } = Dimensions.get('window');

const steps = [
  {
    id: 'identity',
    title: 'Your Identity',
    subtitle: 'How should the network address you?',
    icon: 'User',
    type: 'form',
    fields: [
      { id: 'displayName', label: 'Full Name', placeholder: 'Vitalik Buterin', icon: 'User' },
      { id: 'city', label: 'Home Base', placeholder: 'Zug, Switzerland', icon: 'MapPin' }
    ]
  },
  {
    id: 'profilePic',
    title: 'Profile Picture',
    subtitle: 'Upload a clear headshot for your founder profile.',
    icon: 'Camera',
    type: 'single-photo',
    desc: 'This is the first thing other builders will see.'
  },
  {
    id: 'bio',
    title: 'Founder Bio',
    subtitle: 'Your story in 140 characters.',
    icon: 'Briefcase',
    type: 'textarea',
    field: { id: 'bio', label: 'Bio', placeholder: 'Serial entrepreneur building the future of...', icon: 'Briefcase' }
  },
  {
    id: 'photos',
    title: 'Proof of Life',
    subtitle: 'Upload 3 photos to verify your identity.',
    icon: 'Camera',
    type: 'photos',
    desc: 'You MUST upload at least 3 photos to proceed.'
  },
  {
    id: 'skills',
    title: 'Core Skills',
    subtitle: 'What can you build?',
    icon: 'Code',
    type: 'input',
    field: { id: 'skills', label: 'Skills (comma separated)', placeholder: 'React, Node.js, Python, Sales', icon: 'Code' }
  }
];

export default function OnboardingScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<Record<string, any>>({
    photos: [],
    profilePic: ''
  });
  const [isFinishing, setIsFinishing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleSelect = (stepId: string, optionId: string) => {
    setFormData(prev => ({ ...prev, [stepId]: optionId }));
    if (currentStep < steps.length - 1) {
      setTimeout(() => setCurrentStep(prev => prev + 1), 500);
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

  const handleSinglePhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need access to your photos to set your profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.2,
      base64: true,
    });

    if (!result.canceled) {
      handleInputChange('profilePic', `data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const handlePhotoUpload = async (index: number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need access to your photos for verification.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 6],
      quality: 0.2,
      base64: true,
    });

    if (!result.canceled) {
      const newPhotos = [...(formData.photos || [])];
      newPhotos[index] = `data:image/jpeg;base64,${result.assets[0].base64}`;
      handleInputChange('photos', newPhotos);
    }
  };

  const finishOnboarding = async () => {
    if (!user) return;
    setIsFinishing(true);
    try {
      const skillsArray = typeof formData.skills === 'string' 
        ? formData.skills.split(',').map((s: string) => s.trim()).filter((s: string) => s !== '')
        : [];

      await updateDoc(doc(db, 'users', user.uid), {
        ...formData,
        skills: skillsArray,
        onboarded: true,
        lastActiveAt: new Date()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsFinishing(false);
    }
  };

  const step = steps[currentStep];
  const IconComponent = (Icons as any)[step.icon];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        <View style={styles.progressHeader}>
          <Text style={[styles.stepCount, { color: isDark ? '#444' : '#CCC' }]}>
            STEP {currentStep + 1} OF {steps.length}
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((currentStep + 1) / steps.length) * 100}%` }]} />
          </View>
        </View>

        <View key={currentStep}>
          <View style={styles.header}>
            <View style={[styles.iconBadge, { backgroundColor: isDark ? '#FBE61810' : '#FBE61820' }]}>
              {IconComponent && <IconComponent size={28} color="#FBE618" />}
            </View>
            <Text style={[styles.title, { color: isDark ? '#FFFFFF' : '#000000' }]}>{step.title}</Text>
            <Text style={styles.subtitle}>{step.subtitle}</Text>
          </View>

          <View style={styles.contentContainer}>
            {step.type === 'form' && step.fields?.map((field) => (
              <View key={field.id} style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{field.label.toUpperCase()}</Text>
                <View style={[styles.inputContainer, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
                  <Icons.Search size={18} color="#666" />
                  <TextInput
                    placeholder={field.placeholder}
                    placeholderTextColor="#444"
                    value={formData[field.id] || ''}
                    onChangeText={(text) => handleInputChange(field.id, text)}
                    style={[styles.textInput, { color: isDark ? '#FFFFFF' : '#000000' }]}
                  />
                </View>
              </View>
            ))}

            {step.type === 'single-photo' && (
              <View style={styles.avatarStep}>
                <TouchableOpacity 
                  style={[styles.avatarUploadBtn, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}
                  onPress={handleSinglePhoto}
                >
                  {formData.profilePic ? (
                    <Image source={{ uri: formData.profilePic }} style={styles.avatarPreview} />
                  ) : (
                    <Icons.Camera size={40} color="#FBE618" />
                  )}
                </TouchableOpacity>
                <Text style={styles.photoDesc}>{step.desc}</Text>
                {isUploading && <ActivityIndicator color="#FBE618" style={{ marginTop: 20 }} />}
              </View>
            )}

            {step.type === 'textarea' && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{step.field.label.toUpperCase()}</Text>
                <TextInput
                  placeholder={step.field.placeholder}
                  placeholderTextColor="#444"
                  value={formData[step.field.id] || ''}
                  onChangeText={(text) => handleInputChange(step.field.id, text)}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                  style={[styles.textarea, { 
                    color: isDark ? '#FFFFFF' : '#000000', 
                    backgroundColor: isDark ? '#16161A' : '#F8F8F8' 
                  }]}
                />
              </View>
            )}

            {step.type === 'photos' && (
              <View>
                <View style={styles.photosGrid}>
                  {[0, 1, 2].map((i) => (
                    <TouchableOpacity 
                      key={i} 
                      style={[styles.photoCard, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}
                      onPress={() => handlePhotoUpload(i)}
                    >
                      {formData.photos?.[i] ? (
                        <Image source={{ uri: formData.photos[i] }} style={styles.uploadedPhoto} />
                      ) : (
                        <View style={styles.photoPlaceholder}>
                          <Icons.Plus size={24} color="#666" />
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.photoDesc}>{step.desc}</Text>
                {isUploading && <ActivityIndicator color="#FBE618" style={{ marginTop: 10 }} />}
              </View>
            )}

            {step.type === 'input' && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{step.field.label.toUpperCase()}</Text>
                <TextInput
                  placeholder={step.field.placeholder}
                  placeholderTextColor="#444"
                  value={formData[step.field.id] || ''}
                  onChangeText={(text) => handleInputChange(step.field.id, text)}
                  style={[styles.textInput, { 
                    color: isDark ? '#FFFFFF' : '#000000', 
                    backgroundColor: isDark ? '#16161A' : '#F8F8F8',
                    padding: 20,
                    borderRadius: 16
                  }]}
                />
              </View>
            )}
          </View>
        </View>

        <View style={styles.footer}>
          {currentStep === steps.length - 1 ? (
            <TouchableOpacity 
              style={[styles.finishButton, { opacity: isFinishing ? 0.7 : 1 }]} 
              onPress={finishOnboarding}
              disabled={isFinishing}
            >
              {isFinishing ? <ActivityIndicator color="#000" /> : <Text style={styles.finishText}>START BUILDING</Text>}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={[styles.nextButton, { opacity: (step.type === 'single-photo' && !formData.profilePic) ? 0.5 : 1 }]} 
              onPress={handleNext}
              disabled={step.type === 'single-photo' && !formData.profilePic && !isUploading}
            >
              <Text style={styles.nextText}>NEXT STEP</Text>
              <Icons.ChevronRight size={20} color="#000" />
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 24 },
  progressHeader: { marginBottom: 40 },
  stepCount: { fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 12 },
  progressTrack: { height: 4, backgroundColor: '#FBE61810', borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: '#FBE618', borderRadius: 2 },
  header: { marginBottom: 40 },
  iconBadge: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { fontSize: 28, fontWeight: '900', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', lineHeight: 22 },
  contentContainer: { marginBottom: 40 },
  inputGroup: { marginBottom: 24 },
  inputLabel: { fontSize: 10, fontWeight: '900', color: '#666', letterSpacing: 1.5, marginBottom: 12 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 56, borderRadius: 16, gap: 12 },
  textInput: { flex: 1, fontSize: 16, fontWeight: '500' },
  avatarStep: { alignItems: 'center', gap: 20 },
  avatarUploadBtn: { width: 150, height: 150, borderRadius: 75, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 2, borderColor: '#FBE61830' },
  avatarPreview: { width: '100%', height: '100%' },
  textarea: { height: 150, padding: 16, borderRadius: 16, fontSize: 16, fontWeight: '500' },
  photosGrid: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  photoCard: { flex: 1, aspectRatio: 2/3, borderRadius: 20, overflow: 'hidden' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  uploadedPhoto: { width: '100%', height: '100%' },
  photoDesc: { fontSize: 12, color: '#666', fontStyle: 'italic', textAlign: 'center' },
  footer: { marginTop: 20 },
  nextButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBE618', height: 60, borderRadius: 20, gap: 8 },
  nextText: { fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  finishButton: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBE618', height: 60, borderRadius: 20 },
  finishText: { fontSize: 14, fontWeight: '900', letterSpacing: 1 },
});
