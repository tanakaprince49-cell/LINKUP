import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ChevronLeft, Eye, EyeOff } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BrandMark from '../components/BrandMark';

export default function EmailAuthScreen({ navigation }: any) {
  const { signInWithEmail, signUpWithEmail, resetPassword } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [resetNotice, setResetNotice] = useState({ ok: false, text: '' });

  const doSignIn = async () => {
    setBusy(true);
    try {
      await signInWithEmail(email, password);
    } finally {
      setBusy(false);
    }
  };

  const doSignUp = async () => {
    setBusy(true);
    try {
      await signUpWithEmail(email, password);
    } finally {
      setBusy(false);
    }
  };

  const doResetPassword = async () => {
    setResetNotice({ ok: false, text: '' });
    setBusy(true);
    try {
      const result = await resetPassword(email);
      if (result?.message) setResetNotice({ ok: result.ok, text: result.message });
    } finally {
      setBusy(false);
    }
  };

  const fieldBorder = { borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(11,18,32,0.12)' };

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backBtn, fieldBorder]} activeOpacity={0.8}>
              <ChevronLeft size={22} color={textColor(isDark)} />
            </TouchableOpacity>
            <View style={styles.wordmark}>
              <Text style={[styles.wordLeft, { color: textColor(isDark) }]}>LINK</Text>
              <View style={styles.wordRight}>
                <Text style={styles.wordRightText}>UP</Text>
              </View>
            </View>
            <View style={{ width: 44 }} />
          </View>

          <View style={styles.brandBlock}>
            <View style={styles.logoWrap}>
              <BrandMark size={56} />
            </View>
            <Text style={[styles.headline, { color: textColor(isDark) }]}>
              {mode === 'signin' ? 'Sign in with email.' : 'Create your account.'}
            </Text>
            <Text style={[styles.sub, { color: textColor(isDark, 'secondary') }]}>
              {mode === 'signin'
                ? 'Use the email you signed up with. Forgot it? Reset the password below.'
                : 'A few details now. Then we set up who you are on LINKUP.'}
            </Text>
          </View>

          <View style={styles.form}>
            <Text style={[styles.label, { color: textColor(isDark, 'muted') }]}>Email</Text>
            <TextInput
              value={email}
              onChangeText={(t) => { setEmail(t); if (resetNotice.text) setResetNotice({ ok: false, text: '' }); }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor={textColor(isDark, 'muted')}
              style={[styles.input, fieldBorder, { color: textColor(isDark) }]}
            />

            <Text style={[styles.label, { color: textColor(isDark, 'muted') }]}>Password</Text>
            <View style={[styles.inputRow, fieldBorder]}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
                placeholderTextColor={textColor(isDark, 'muted')}
                style={[styles.inputInner, { color: textColor(isDark) }]}
              />
              <TouchableOpacity onPress={() => setShowPassword((c) => !c)} activeOpacity={0.7} style={styles.toggleBtn}>
                {showPassword ? (
                  <EyeOff size={18} color={textColor(isDark, 'muted')} />
                ) : (
                  <Eye size={18} color={textColor(isDark, 'muted')} />
                )}
              </TouchableOpacity>
            </View>

            {mode === 'signin' ? (
              <TouchableOpacity onPress={doResetPassword} disabled={busy} activeOpacity={0.7} style={styles.forgotBtn}>
                <Text style={styles.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ height: 8 }} />
            )}

            {resetNotice.text ? (
              <Text style={{ marginTop: -4, marginBottom: 10, fontSize: 12, fontWeight: '700', lineHeight: 17, color: resetNotice.ok ? '#22C55E' : '#EF4444' }}>
                {resetNotice.text}
              </Text>
            ) : null}

            <TouchableOpacity
              onPress={mode === 'signin' ? doSignIn : doSignUp}
              disabled={busy}
              activeOpacity={0.88}
              style={[styles.primaryBtn, busy && styles.disabled]}
            >
              {busy ? (
                <ActivityIndicator color="#111" />
              ) : (
                <Text style={styles.primaryText}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setResetNotice({ ok: false, text: '' }); }}
              disabled={busy}
              activeOpacity={0.85}
              style={[styles.ghostBtn, fieldBorder]}
            >
              <Text style={[styles.ghostText, { color: textColor(isDark) }]}>
                {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 28,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  wordLeft: { fontSize: 16, fontWeight: '900', letterSpacing: 1.2 },
  wordRight: { backgroundColor: COLORS.primary, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  wordRightText: { fontSize: 16, fontWeight: '900', letterSpacing: 1.2, color: '#111' },
  brandBlock: { gap: 10, marginBottom: 28 },
  logoWrap: {
    width: 68,
    height: 68,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  headline: { fontSize: 30, fontWeight: '900', letterSpacing: -0.8, lineHeight: 36 },
  sub: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  form: { gap: 0 },
  label: { fontSize: 13, fontWeight: '700', marginBottom: 8, marginTop: 14 },
  input: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '600',
  },
  inputRow: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputInner: { flex: 1, height: 54, fontSize: 16, fontWeight: '600' },
  toggleBtn: { padding: 10 },
  forgotBtn: { alignSelf: 'flex-end', paddingVertical: 12 },
  forgotText: { fontSize: 13, fontWeight: '800', color: COLORS.primaryStrong },
  primaryBtn: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryText: { fontSize: 16, fontWeight: '800', color: '#111' },
  ghostBtn: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  ghostText: { fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.65 },
});
