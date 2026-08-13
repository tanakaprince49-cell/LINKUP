import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import BrandMark from '../components/BrandMark';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';

export default function LandingScreen({ navigation }: any) {
  const { signInWithGoogle, authError, clearAuthError } = useAuth();
  const { theme } = useTheme();
  const { height } = useWindowDimensions();
  const isDark = theme === 'dark';
  const [googleBusy, setGoogleBusy] = useState(false);
  const compact = height < 720;

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
      <ScrollView
        contentContainerStyle={[styles.scroll, compact && styles.scrollCompact]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandBlock}>
          <View style={styles.logoWrap}>
            <BrandMark size={compact ? 72 : 88} />
          </View>
          <View style={styles.wordmark}>
            <Text style={[styles.wordLeft, { color: textColor(isDark) }]}>LINK</Text>
            <View style={styles.wordRight}>
              <Text style={styles.wordRightText}>UP</Text>
            </View>
          </View>
          <Text style={[styles.tag, { color: textColor(isDark, 'muted') }]}>Find cofounders and builders</Text>
        </View>

        <View style={styles.copy}>
          <Text style={[styles.headline, compact && styles.headlineCompact, { color: textColor(isDark) }]}>
            Meet the person{'\n'}who can ship it with you.
          </Text>
          <Text style={[styles.sub, { color: textColor(isDark, 'secondary') }]}>
            Swipe, search, and message people who are actually building — not posting hustle.
          </Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.googleBtn, googleBusy && styles.disabled]}
            onPress={handleGoogleSignIn}
            disabled={googleBusy}
            activeOpacity={0.88}
          >
            {googleBusy ? (
              <ActivityIndicator color="#1F1F1F" />
            ) : (
              <>
                <View style={styles.googleMark}>
                  <Text style={styles.googleG}>G</Text>
                </View>
                <Text style={styles.googleText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {authError ? (
            <View style={[styles.errorBox, { backgroundColor: isDark ? 'rgba(255,77,109,0.12)' : '#FFF1F4' }]}>
              <Text style={styles.errorText} selectable>{authError}</Text>
              <TouchableOpacity onPress={clearAuthError}>
                <Text style={styles.dismiss}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.emailBtn, { borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(11,18,32,0.12)' }]}
            onPress={() => navigation.navigate('EmailAuth')}
            activeOpacity={0.85}
          >
            <Text style={[styles.emailText, { color: textColor(isDark) }]}>Use email instead</Text>
          </TouchableOpacity>

          <Text style={[styles.legal, { color: textColor(isDark, 'muted') }]}>
            By continuing you agree to our{' '}
            <Text style={styles.link} onPress={() => openLink('https://docs.google.com/document/d/1SPu2VZchQfmWQT0gr2QuvmHbiuLpBZX-aFpmVd-ph2E/edit?usp=sharing')}>
              Terms
            </Text>
            {' '}and{' '}
            <Text style={styles.link} onPress={() => openLink('https://docs.google.com/document/d/1FUTyaNfaBXzYGUiqbfhrKX73H6S6S809kpI00chyWRM/edit?usp=sharing')}>
              Privacy Policy
            </Text>
            .
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 28,
    justifyContent: 'space-between',
  },
  scrollCompact: { paddingTop: 16, paddingBottom: 16 },
  brandBlock: { alignItems: 'center', gap: 12 },
  logoWrap: {
    width: 104,
    height: 104,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  wordLeft: { fontSize: 28, fontWeight: '900', letterSpacing: 1.4 },
  wordRight: { backgroundColor: COLORS.primary, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7 },
  wordRightText: { fontSize: 28, fontWeight: '900', letterSpacing: 1.4, color: '#111' },
  tag: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  copy: { gap: 10, marginTop: 20 },
  headline: { fontSize: 32, fontWeight: '900', letterSpacing: -0.8, lineHeight: 38 },
  headlineCompact: { fontSize: 26, lineHeight: 32 },
  sub: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  actions: { gap: 12, marginTop: 28 },
  googleBtn: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#DADCE0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  disabled: { opacity: 0.65 },
  googleMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
  },
  googleG: { fontSize: 16, fontWeight: '900', color: '#4285F4' },
  googleText: { fontSize: 16, fontWeight: '700', color: '#1F1F1F' },
  emailBtn: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailText: { fontSize: 15, fontWeight: '800' },
  errorBox: { borderRadius: 12, padding: 12, gap: 6 },
  errorText: { fontSize: 12, fontWeight: '700', color: COLORS.danger, lineHeight: 17 },
  dismiss: { fontSize: 12, fontWeight: '900', color: COLORS.danger },
  legal: { marginTop: 4, textAlign: 'center', fontSize: 11, fontWeight: '600', lineHeight: 16 },
  link: { color: COLORS.primaryStrong, fontWeight: '800', textDecorationLine: 'underline' },
});
