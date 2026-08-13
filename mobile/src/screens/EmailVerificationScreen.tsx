import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import BrandMark from '../components/BrandMark';

export default function EmailVerificationScreen() {
  const { user, sendVerificationEmail, reloadCurrentUser, logout } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const fieldBorder = { borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(11,18,32,0.12)' };

  const checkVerification = async () => {
    setChecking(true);
    try {
      const refreshedUser = await reloadCurrentUser();
      if (!refreshedUser?.emailVerified) {
        Alert.alert('Not verified yet', 'Open the verification link in your email first, then tap this again.');
      }
    } catch (error: any) {
      Alert.alert('Check failed', error?.message || 'Could not refresh your verification status.');
    } finally {
      setChecking(false);
    }
  };

  const resendVerification = async () => {
    setSending(true);
    try {
      await sendVerificationEmail();
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <View style={styles.inner}>
        <View style={styles.logoWrap}>
          <BrandMark size={64} />
        </View>
        <Text style={[styles.headline, { color: textColor(isDark) }]}>Check your inbox.</Text>
        <Text style={[styles.sub, { color: textColor(isDark, 'secondary') }]}>
          We sent a link to {user?.email || 'your email'}. Open it, then come back here.
        </Text>
        <Text style={[styles.hint, { color: textColor(isDark, 'muted') }]}>
          Can’t find it? Look in spam or junk.
        </Text>

        <TouchableOpacity
          disabled={checking}
          onPress={checkVerification}
          activeOpacity={0.88}
          style={[styles.primaryBtn, checking && styles.disabled]}
        >
          {checking ? <ActivityIndicator color="#111" /> : <Text style={styles.primaryText}>I verified my email</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          disabled={sending}
          onPress={resendVerification}
          activeOpacity={0.85}
          style={[styles.ghostBtn, fieldBorder, sending && styles.disabled]}
        >
          {sending ? (
            <ActivityIndicator color={textColor(isDark)} />
          ) : (
            <Text style={[styles.ghostText, { color: textColor(isDark) }]}>Resend email</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={logout} activeOpacity={0.8} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Use another account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: 28,
    justifyContent: 'center',
  },
  logoWrap: {
    width: 80,
    height: 80,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  headline: { fontSize: 32, fontWeight: '900', letterSpacing: -0.8, lineHeight: 38 },
  sub: { marginTop: 10, fontSize: 15, fontWeight: '600', lineHeight: 22 },
  hint: { marginTop: 8, fontSize: 13, fontWeight: '600' },
  primaryBtn: {
    marginTop: 28,
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontSize: 16, fontWeight: '800', color: '#111' },
  ghostBtn: {
    marginTop: 12,
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { fontSize: 15, fontWeight: '800' },
  logoutBtn: { marginTop: 20, alignItems: 'center', padding: 10 },
  logoutText: { color: COLORS.danger, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.65 },
});
