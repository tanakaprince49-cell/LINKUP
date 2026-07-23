import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowRight, Lock, Star, Users } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import BrandMark from '../components/BrandMark';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';

const { width, height } = Dimensions.get('window');

export default function LandingScreen({ navigation }: any) {
  const { signInWithGoogle, authError, clearAuthError } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [googleBusy, setGoogleBusy] = useState(false);

  const openLink = (url: string) => {
    Linking.openURL(url).catch((err) => console.error("Couldn't load page", err));
  };

  const handleGoogleSignIn = async () => {
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <View style={styles.scene} pointerEvents="none">
        <View style={[styles.lightPlane, styles.lightPlaneOne, { backgroundColor: isDark ? 'rgba(0, 194, 255, 0.14)' : 'rgba(0, 194, 255, 0.16)' }]} />
        <View style={[styles.lightPlane, styles.lightPlaneTwo, { backgroundColor: isDark ? 'rgba(223, 251, 63, 0.12)' : 'rgba(223, 251, 63, 0.2)' }]} />
        <View style={[styles.lightPlane, styles.lightPlaneThree, { backgroundColor: isDark ? 'rgba(124, 58, 237, 0.16)' : 'rgba(124, 58, 237, 0.12)' }]} />
      </View>

      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.logoBadge}>
            <BrandMark size={28} />
          </View>
        </View>

        <View style={styles.hero}>
          <View style={[styles.kickerPill, liquidGlass(isDark, false)]}>
            <Star size={14} color={COLORS.primary} />
            <Text style={[styles.kickerText, { color: textColor(isDark, 'secondary') }]}>PRIVATE BUILDER NETWORK</Text>
          </View>
          <Text style={[styles.heroTitle, { color: textColor(isDark) }]}>
            Meet the people who move your idea forward.
          </Text>
          <Text style={[styles.heroSub, { color: textColor(isDark, 'secondary') }]}>
            LINKUP pairs founders, technical talent, creators, and operators through signal-rich matching instead of noisy scrolling.
          </Text>
          <View style={styles.signalRow}>
            <View style={[styles.signalCard, liquidGlass(isDark, false)]}>
              <Star size={18} color={COLORS.secondary} />
              <Text style={[styles.signalValue, { color: textColor(isDark) }]}>AI FIT</Text>
              <Text style={[styles.signalLabel, { color: textColor(isDark, 'muted') }]}>Compatibility</Text>
            </View>
            <View style={[styles.signalCard, liquidGlass(isDark, false)]}>
              <Users size={18} color={COLORS.primary} />
              <Text style={[styles.signalValue, { color: textColor(isDark) }]}>LIVE</Text>
              <Text style={[styles.signalLabel, { color: textColor(isDark, 'muted') }]}>Opportunities</Text>
            </View>
          </View>
        </View>

        <View style={[styles.actionPanel, liquidGlass(isDark)]}>
          <TouchableOpacity
            style={[styles.googleButton, googleBusy && styles.disabledButton]}
            onPress={handleGoogleSignIn}
            disabled={googleBusy}
            activeOpacity={0.85}
          >
            {googleBusy ? (
              <ActivityIndicator color="#07111F" />
            ) : (
              <>
                <View style={styles.googleIconContainer}>
                  <View style={styles.googleG} />
                </View>
                <Text style={styles.googleButtonText}>SIGN IN WITH GOOGLE</Text>
                <ArrowRight size={18} color="#07111F" />
              </>
            )}
          </TouchableOpacity>

          {authError ? (
            <View style={[styles.authErrorBox, { backgroundColor: isDark ? 'rgba(255, 77, 109, 0.12)' : '#FFF1F4', borderColor: COLORS.danger }]}>
              <Text style={styles.authErrorTitle}>GOOGLE AUTH ERROR</Text>
              <Text selectable style={[styles.authErrorText, { color: isDark ? '#FFD5DE' : '#7F1D2D' }]}>{authError}</Text>
              <TouchableOpacity onPress={clearAuthError} activeOpacity={0.8} style={styles.dismissErrorBtn}>
                <Text style={styles.dismissErrorText}>DISMISS</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.secondaryButton, liquidGlass(isDark, false)]}
            onPress={() => navigation.navigate('EmailAuth')}
            activeOpacity={0.85}
          >
            <Text style={[styles.secondaryButtonText, { color: textColor(isDark) }]}>CONTINUE WITH EMAIL</Text>
          </TouchableOpacity>

          <View style={styles.privacyNotice}>
            <Lock size={12} color={textColor(isDark, 'muted')} />
            <Text style={[styles.privacyText, { color: textColor(isDark, 'muted') }]}>ENCRYPTED AND PRIVACY COMPLIANT</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.legalText, { color: textColor(isDark, 'muted') }]}>
            By joining, you agree to our{'\n'}
            <Text style={styles.legalLink} onPress={() => openLink('https://docs.google.com/document/d/1SPu2VZchQfmWQT0gr2QuvmHbiuLpBZX-aFpmVd-ph2E/edit?usp=sharing')}>TERMS OF SERVICE</Text>
            <Text style={{ color: textColor(isDark, 'muted') }}> & </Text>
            <Text style={styles.legalLink} onPress={() => openLink('https://docs.google.com/document/d/1FUTyaNfaBXzYGUiqbfhrKX73H6S6S809kpI00chyWRM/edit?usp=sharing')}>PRIVACY POLICY</Text>
          </Text>
          <Text style={[styles.complianceText, { color: textColor(isDark, 'muted') }]}>(C) 2026 LINKUP. DATA PROTECTED UNDER GDPR & CCPA.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scene: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  lightPlane: {
    position: 'absolute',
    width: width * 0.9,
    height: height * 0.22,
    borderRadius: 36,
  },
  lightPlaneOne: {
    top: height * 0.08,
    right: -width * 0.34,
    transform: [{ rotate: '-18deg' }],
  },
  lightPlaneTwo: {
    top: height * 0.28,
    left: -width * 0.28,
    transform: [{ rotate: '14deg' }],
  },
  lightPlaneThree: {
    bottom: height * 0.1,
    right: -width * 0.22,
    transform: [{ rotate: '10deg' }],
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingVertical: 36,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  logoBadge: {
    width: 50,
    height: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.38,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  logoText: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0,
  },
  hero: {
    marginTop: 20,
    marginBottom: 20,
  },
  kickerPill: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  kickerText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  heroTitle: {
    marginTop: 16,
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 46,
  },
  heroSub: {
    fontSize: 15,
    lineHeight: 24,
    marginTop: 16,
    fontWeight: '600',
  },
  signalRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 22,
  },
  signalCard: {
    flex: 1,
    borderRadius: 22,
    padding: 14,
    minHeight: 94,
    justifyContent: 'space-between',
  },
  signalValue: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
  signalLabel: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '800',
  },
  actionPanel: {
    borderRadius: 28,
    padding: 22,
    gap: 16,
  },
  googleButton: {
    backgroundColor: COLORS.primary,
    minHeight: 58,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 6,
  },
  disabledButton: {
    opacity: 0.7,
  },
  googleIconContainer: {
    width: 24,
    height: 24,
    backgroundColor: '#FFF',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleG: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
    borderTopColor: '#4285F4',
    borderLeftColor: '#EA4335',
    borderBottomColor: '#FBBC05',
    borderRightColor: '#34A853',
  },
  googleButtonText: {
    color: '#07111F',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  authErrorBox: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  authErrorTitle: {
    color: COLORS.danger,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  authErrorText: {
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '700',
  },
  dismissErrorBtn: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.danger,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  dismissErrorText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  secondaryButton: {
    minHeight: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  privacyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 2,
  },
  privacyText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  footer: {
    marginTop: 10,
    gap: 8,
  },
  legalText: {
    textAlign: 'center',
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 16,
  },
  legalLink: {
    color: COLORS.primary,
    fontWeight: '900',
    textDecorationLine: 'underline',
  },
  complianceText: {
    textAlign: 'center',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
