import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowRight, Lock, Star, Users, Zap, Sparkles } from 'lucide-react-native';
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
          <View style={[styles.logoBadge, liquidGlass(isDark, false)]}>
            <BrandMark size={28} />
          </View>
          <View style={styles.headerTagline}>
            <Text style={[styles.headerTaglineText, { color: textColor(isDark, 'muted') }]}>LINKUP</Text>
          </View>
        </View>

        <View style={styles.heroSection}>
          <View style={[styles.kickerPill, liquidGlass(isDark, false)]}>
            <Sparkles size={13} color={COLORS.primary} />
            <Text style={[styles.kickerText, { color: COLORS.primary }]}>PRIVATE BUILDER NETWORK</Text>
          </View>

          <Text style={[styles.heroTitle, { color: textColor(isDark) }]}>
            Meet the people{'\n'}who move your{'\n'}<Text style={styles.heroHighlight}>idea forward.</Text>
          </Text>

          <Text style={[styles.heroSub, { color: textColor(isDark, 'secondary') }]}>
            LINKUP pairs founders, technical talent, creators, and operators through signal-rich matching instead of noisy scrolling.
          </Text>

          <View style={styles.statsRow}>
            <View style={[styles.statCard, liquidGlass(isDark, false)]}>
              <View style={[styles.statIconWrap, { backgroundColor: COLORS.primary + '20' }]}>
                <Star size={16} color={COLORS.primary} />
              </View>
              <View style={{ gap: 2 }}>
                <Text style={[styles.statValue, { color: textColor(isDark) }]}>AI FIT</Text>
                <Text style={[styles.statLabel, { color: textColor(isDark, 'muted') }]}>Smart Compatibility</Text>
              </View>
            </View>
            <View style={[styles.statCard, liquidGlass(isDark, false)]}>
              <View style={[styles.statIconWrap, { backgroundColor: COLORS.secondary + '20' }]}>
                <Users size={16} color={COLORS.secondary} />
              </View>
              <View style={{ gap: 2 }}>
                <Text style={[styles.statValue, { color: textColor(isDark) }]}>LIVE</Text>
                <Text style={[styles.statLabel, { color: textColor(isDark, 'muted') }]}>Active Builders</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.actionPanel, liquidGlass(isDark)]}>
          <TouchableOpacity
            style={[styles.primaryBtn, googleBusy && styles.disabledBtn]}
            onPress={handleGoogleSignIn}
            disabled={googleBusy}
            activeOpacity={0.85}
          >
            {googleBusy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <>
                <View style={styles.googleIconContainer}>
                  <View style={styles.googleG} />
                </View>
                <Text style={styles.primaryBtnText}>CONTINUE WITH GOOGLE</Text>
                <ArrowRight size={16} color="#000" />
              </>
            )}
          </TouchableOpacity>

          {authError ? (
            <View style={[styles.errorBox, { backgroundColor: isDark ? 'rgba(255, 77, 109, 0.12)' : '#FFF1F4', borderColor: COLORS.danger }]}>
              <Text style={styles.errorTitle}>AUTH ERROR</Text>
              <Text selectable style={[styles.errorText, { color: isDark ? '#FFD5DE' : '#7F1D2D' }]}>{authError}</Text>
              <TouchableOpacity onPress={clearAuthError} activeOpacity={0.8} style={[styles.dismissBtn, { backgroundColor: COLORS.danger + '20' }]}>
                <Text style={[styles.dismissText, { color: COLORS.danger }]}>DISMISS</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.secondaryBtn, liquidGlass(isDark, false)]}
            onPress={() => navigation.navigate('EmailAuth')}
            activeOpacity={0.85}
          >
            <Text style={[styles.secondaryBtnText, { color: textColor(isDark) }]}>SIGN IN WITH EMAIL</Text>
          </TouchableOpacity>

          <View style={styles.privacyNotice}>
            <Lock size={11} color={textColor(isDark, 'muted')} />
            <Text style={[styles.privacyText, { color: textColor(isDark, 'muted') }]}>ENCRYPTED & PRIVACY COMPLIANT</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.legalText, { color: textColor(isDark, 'muted') }]}>
            By joining, you agree to our{' '}
            <Text style={styles.legalLink} onPress={() => openLink('https://docs.google.com/document/d/1SPu2VZchQfmWQT0gr2QuvmHbiuLpBZX-aFpmVd-ph2E/edit?usp=sharing')}>TERMS</Text>
            {' '}&{' '}
            <Text style={styles.legalLink} onPress={() => openLink('https://docs.google.com/document/d/1FUTyaNfaBXzYGUiqbfhrKX73H6S6S809kpI00chyWRM/edit?usp=sharing')}>PRIVACY POLICY</Text>
          </Text>
          <Text style={[styles.complianceText, { color: textColor(isDark, 'muted') }]}>(C) 2026 LINKUP. DATA PROTECTED UNDER GDPR & CCPA.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scene: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  lightPlane: { position: 'absolute', width: width * 0.9, height: height * 0.22, borderRadius: 36 },
  lightPlaneOne: { top: height * 0.08, right: -width * 0.34, transform: [{ rotate: '-18deg' }] },
  lightPlaneTwo: { top: height * 0.28, left: -width * 0.28, transform: [{ rotate: '14deg' }] },
  lightPlaneThree: { bottom: height * 0.1, right: -width * 0.22, transform: [{ rotate: '10deg' }] },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
    paddingVertical: 32,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logoBadge: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  headerTagline: { flex: 1 },
  headerTaglineText: { fontSize: 9, fontWeight: '900', letterSpacing: 3 },
  heroSection: { marginTop: 12, marginBottom: 12 },
  kickerPill: {
    alignSelf: 'flex-start',
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  kickerText: { fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  heroTitle: {
    marginTop: 18,
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 44,
  },
  heroHighlight: {
    color: COLORS.primary,
    fontStyle: 'italic',
    textDecorationLine: 'underline',
    textDecorationColor: COLORS.primary + '40',
  },
  heroSub: {
    fontSize: 14,
    lineHeight: 22,
    marginTop: 14,
    fontWeight: '600',
  },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 22 },
  statCard: {
    flex: 1,
    borderRadius: 20,
    padding: 14,
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: { fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },
  statLabel: { fontSize: 10, fontWeight: '800' },
  actionPanel: { borderRadius: 26, padding: 20, gap: 14 },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    minHeight: 56,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
  },
  disabledBtn: { opacity: 0.65 },
  googleIconContainer: {
    width: 22,
    height: 22,
    backgroundColor: '#FFF',
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleG: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 2.5,
    borderTopColor: '#4285F4',
    borderLeftColor: '#EA4335',
    borderBottomColor: '#FBBC05',
    borderRightColor: '#34A853',
  },
  primaryBtnText: { color: '#000', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  errorBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  errorTitle: { color: COLORS.danger, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  errorText: { fontSize: 10, lineHeight: 16, fontWeight: '700' },
  dismissBtn: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  dismissText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  secondaryBtn: {
    minHeight: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  privacyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 2,
  },
  privacyText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  footer: { marginTop: 8, gap: 6 },
  legalText: { textAlign: 'center', fontSize: 9, fontWeight: '700', lineHeight: 16 },
  legalLink: { color: COLORS.primary, fontWeight: '900', textDecorationLine: 'underline' },
  complianceText: { textAlign: 'center', fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
});
