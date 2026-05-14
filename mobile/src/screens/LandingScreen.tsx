import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Dimensions, Linking, Image } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Rocket, Shield, Lock, Globe } from 'lucide-react-native';

const { width, height } = Dimensions.get('window');

export default function LandingScreen() {
  const { signInWithGoogle } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const openLink = (url: string) => {
    Linking.openURL(url).catch(err => console.error("Couldn't load page", err));
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#050508' : '#FFFFFF' }]}>
      <View style={styles.glowContainer}>
        <View style={[styles.glow, { backgroundColor: '#FBE618', opacity: isDark ? 0.1 : 0.05, top: -height * 0.1, left: -width * 0.2 }]} />
        <View style={[styles.glow, { backgroundColor: '#FBE618', opacity: isDark ? 0.05 : 0.02, bottom: -height * 0.1, right: -width * 0.2 }]} />
      </View>

      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.logoBadge}>
            <Image source={require('../../assets/logo.png.png')} style={styles.logoImage} />
          </View>
          <Text style={[styles.logoText, { color: isDark ? '#FFF' : '#000' }]}>
            LINK<Text style={{ color: '#FBE618' }}>UP</Text>
          </Text>
        </View>

        {/* HERO AREA */}
        <View style={styles.hero}>
          <Text style={[styles.heroTitle, { color: isDark ? '#FFF' : '#000' }]}>
            THE FOUNDER{"\n"}
            <Text style={{ color: '#FBE618' }}>REALM_</Text>
          </Text>
          <Text style={[styles.heroSub, { color: isDark ? '#888' : '#666' }]}>
            An exclusive network for high-signal builders, technical founders, and visionary operators.
          </Text>
        </View>

        {/* ACTION AREA */}
        <View style={styles.actions}>
          <TouchableOpacity 
            style={styles.googleButton}
            onPress={signInWithGoogle}
            activeOpacity={0.8}
          >
            <View style={styles.googleIconContainer}>
              <View style={[styles.googleG, { borderTopColor: '#4285F4', borderLeftColor: '#EA4335', borderBottomColor: '#FBBC05', borderRightColor: '#34A853' }]} />
            </View>
            <Text style={styles.googleButtonText}>SIGN IN WITH GOOGLE</Text>
          </TouchableOpacity>

          <View style={styles.privacyNotice}>
            <Lock size={12} color="#666" />
            <Text style={styles.privacyText}>ENCRYPTED & PRIVACY COMPLIANT</Text>
          </View>

          <View style={styles.footer}>
            <Text style={styles.legalText}>
              By joining, you agree to our{"\n"}
              <Text style={styles.legalLink} onPress={() => openLink('https://linkup.pro/terms')}>TERMS OF SERVICE</Text>
              <Text style={styles.legalText}> & </Text>
              <Text style={styles.legalLink} onPress={() => openLink('https://linkup.pro/privacy')}>PRIVACY POLICY</Text>
            </Text>
            <Text style={styles.complianceText}>© 2026 LINKUP. DATA PROTECTED UNDER GDPR & CCPA.</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  glowContainer: {
    position: 'absolute',
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: width * 1.2,
    height: width * 1.2,
    borderRadius: width * 0.6,
  },
  content: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'space-between',
    paddingVertical: 60,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoBadge: {
    width: 60,
    height: 60,
    backgroundColor: '#FBE618',
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-5deg' }],
    overflow: 'hidden',
  },
  logoImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  logoText: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  hero: {
    marginTop: -40,
  },
  heroTitle: {
    fontSize: 52,
    fontWeight: '900',
    letterSpacing: -2,
    lineHeight: 56,
    fontStyle: 'italic',
  },
  heroSub: {
    fontSize: 16,
    lineHeight: 26,
    marginTop: 20,
    fontWeight: '500',
  },
  actions: {
    gap: 24,
  },
  googleButton: {
    backgroundColor: '#FBE618',
    height: 64,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    shadowColor: '#FBE618',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  googleIconContainer: {
    width: 28,
    height: 28,
    backgroundColor: '#FFF',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleG: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
  },
  googleButtonText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  privacyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    opacity: 0.6,
  },
  privacyText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#666',
    letterSpacing: 1,
  },
  footer: {
    marginTop: 10,
    gap: 12,
  },
  legalText: {
    textAlign: 'center',
    fontSize: 10,
    color: '#888',
    fontWeight: '700',
    lineHeight: 18,
  },
  legalLink: {
    color: '#FBE618',
    fontWeight: '900',
    textDecorationLine: 'underline',
  },
  complianceText: {
    textAlign: 'center',
    fontSize: 8,
    color: '#555',
    fontWeight: '800',
    letterSpacing: 0.5,
  }
});
