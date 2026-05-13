import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground, Dimensions } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Rocket, Shield, Zap } from 'lucide-react-native';
import { seedDatabase } from '../lib/seed';

const { width, height } = Dimensions.get('window');

export default function LandingScreen() {
  const { user, signInWithGoogle } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#050508' : '#FFFFFF' }]}>
      <View style={styles.glowContainer}>
        <View style={[styles.glow, { backgroundColor: '#FBE618', opacity: 0.2, top: -100, left: -50 }]} />
      </View>

      <View style={styles.content}>
        <View style={styles.logoContainer}>
          <Rocket size={48} color="#FBE618" />
          <Text style={[styles.logoText, { color: isDark ? '#FFFFFF' : '#000000' }]}>
            LINK<Text style={{ color: '#FBE618' }}>UP</Text>
          </Text>
        </View>

        <View style={styles.heroSection}>
          <Text style={[styles.title, { color: isDark ? '#FFFFFF' : '#000000' }]}>
            THE FUTURE IS{"\n"}
            <Text style={{ color: '#FBE618' }}>BUILT TOGETHER</Text>
          </Text>
          <Text style={[styles.subtitle, { color: isDark ? '#CCCCCC' : '#666666' }]}>
            Connect with technical co-founders, early adopters, and visionary builders.
          </Text>
        </View>

        <View style={styles.actionSection}>
          <TouchableOpacity 
            style={styles.googleButton}
            onPress={signInWithGoogle}
          >
            <Shield size={20} color="#000000" />
            <Text style={styles.googleButtonText}>ENTER THE NETWORK</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.skipButton}
            onPress={() => {
               signInWithGoogle(); 
            }}
          >
            <Text style={styles.skipButtonText}>DEVELOPER PREVIEW (SKIP AUTH)</Text>
          </TouchableOpacity>



          <Text style={styles.footerText}>
            By entering, you agree to the Proof of Work.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  glowContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  glow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
  },
  content: {
    flex: 1,
    paddingHorizontal: 30,
    justifyContent: 'space-between',
    paddingVertical: 80,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoText: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -1,
  },
  heroSection: {
    marginTop: 40,
  },
  title: {
    fontSize: 48,
    fontWeight: '900',
    lineHeight: 52,
    letterSpacing: -2,
    fontStyle: 'italic',
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 20,
    lineHeight: 24,
  },
  actionSection: {
    gap: 20,
  },
  googleButton: {
    backgroundColor: '#FBE618',
    height: 60,
    borderRadius: 20,
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
  googleButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
  },
  skipButton: {
    padding: 15,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#66666630',
  },
  skipButtonText: {
    color: '#666666',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  footerText: {
    textAlign: 'center',
    fontSize: 10,
    color: '#666666',
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
