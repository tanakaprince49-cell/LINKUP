import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MailCheck, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

export default function EmailVerificationScreen() {
  const { user, sendVerificationEmail, reloadCurrentUser, logout } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);

  const checkVerification = async () => {
    setChecking(true);
    try {
      const refreshedUser = await reloadCurrentUser();
      if (!refreshedUser?.emailVerified) {
        Alert.alert('Not verified yet', 'Open the Firebase verification link in your email first, then tap this again.');
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
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#050508' : '#FFFFFF' }]}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <MailCheck size={38} color="#000" />
        </View>
        <Text style={[styles.title, { color: isDark ? '#FFF' : '#000' }]}>VERIFY YOUR EMAIL</Text>
        <Text style={styles.subtitle}>
          We sent a Firebase verification link to {user?.email || 'your email'}. Verify it before entering LINKUP.
        </Text>
        <Text style={styles.spamNote}>Can't find it? Check your spam or junk folder.</Text>

        <TouchableOpacity
          disabled={checking}
          onPress={checkVerification}
          activeOpacity={0.85}
          style={[styles.primaryBtn, { opacity: checking ? 0.65 : 1 }]}
        >
          {checking ? <ActivityIndicator color="#000" /> : <ShieldCheck size={18} color="#000" />}
          <Text style={styles.primaryText}>I VERIFIED MY EMAIL</Text>
        </TouchableOpacity>

        <TouchableOpacity
          disabled={sending}
          onPress={resendVerification}
          activeOpacity={0.85}
          style={[styles.secondaryBtn, { borderColor: isDark ? '#24242A' : '#E5E7EB', opacity: sending ? 0.65 : 1 }]}
        >
          {sending ? <ActivityIndicator color={isDark ? '#FFF' : '#000'} /> : <RefreshCw size={16} color={isDark ? '#FFF' : '#000'} />}
          <Text style={[styles.secondaryText, { color: isDark ? '#FFF' : '#000' }]}>RESEND VERIFICATION EMAIL</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={logout} activeOpacity={0.8} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>USE ANOTHER ACCOUNT</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  card: {
    alignItems: 'center',
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 28,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 29,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 14,
    color: '#666',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
    textAlign: 'center',
  },
  spamNote: {
    marginTop: 12,
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  primaryBtn: {
    marginTop: 28,
    height: 58,
    borderRadius: 20,
    backgroundColor: '#FBE618',
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  secondaryBtn: {
    marginTop: 12,
    height: 54,
    borderRadius: 18,
    borderWidth: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  secondaryText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  logoutBtn: {
    marginTop: 22,
    padding: 10,
  },
  logoutText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
});
