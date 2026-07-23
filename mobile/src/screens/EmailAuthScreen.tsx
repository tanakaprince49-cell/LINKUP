import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ChevronLeft, Eye, EyeOff, Mail, Lock } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function EmailAuthScreen({ navigation }: any) {
  const { signInWithEmail, signUpWithEmail, resetPassword } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    try {
      await resetPassword(email);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backBtn, liquidGlass(isDark, false)]} activeOpacity={0.8}>
          <ChevronLeft size={20} color={textColor(isDark)} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor(isDark, 'secondary') }]}>EMAIL LOGIN</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.body}>
        <View style={styles.brandArea}>
          <View style={[styles.brandIcon, { backgroundColor: COLORS.primary }]}>
            <Lock size={22} color="#000" />
          </View>
          <Text style={[styles.title, { color: textColor(isDark) }]}>Welcome back</Text>
          <Text style={[styles.subtitle, { color: textColor(isDark, 'secondary') }]}>
            Sign in or create your account
          </Text>
        </View>

        <View style={[styles.formCard, liquidGlass(isDark)]}>
          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: textColor(isDark, 'secondary') }]}>EMAIL</Text>
            <View style={[styles.inputRow, liquidGlass(isDark, false)]}>
              <Mail size={16} color={textColor(isDark, 'muted')} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="you@example.com"
                placeholderTextColor={textColor(isDark, 'muted')}
                style={[styles.input, { color: textColor(isDark) }]}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: textColor(isDark, 'secondary') }]}>PASSWORD</Text>
            <View style={[styles.inputRow, liquidGlass(isDark, false)]}>
              <Lock size={16} color={textColor(isDark, 'muted')} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="Your password"
                placeholderTextColor={textColor(isDark, 'muted')}
                style={[styles.input, { color: textColor(isDark) }]}
              />
              <TouchableOpacity
                onPress={() => setShowPassword((c) => !c)}
                activeOpacity={0.7}
                style={styles.toggleBtn}
              >
                {showPassword ? (
                  <EyeOff size={16} color={textColor(isDark, 'muted')} />
                ) : (
                  <Eye size={16} color={textColor(isDark, 'muted')} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity onPress={doResetPassword} disabled={busy} activeOpacity={0.7} style={styles.forgotBtn}>
            <Text style={[styles.forgotText, { color: COLORS.primary }]}>FORGOT PASSWORD?</Text>
          </TouchableOpacity>

          <View style={styles.btnRow}>
            <TouchableOpacity
              onPress={doSignIn}
              disabled={busy}
              activeOpacity={0.85}
              style={[styles.btn, liquidGlass(isDark, false)]}
            >
              {busy ? <ActivityIndicator color={textColor(isDark)} /> : <Text style={[styles.btnText, { color: textColor(isDark) }]}>SIGN IN</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={doSignUp}
              disabled={busy}
              activeOpacity={0.85}
              style={[styles.btn, styles.primaryBtn, { backgroundColor: COLORS.primary }]}
            >
              {busy ? <ActivityIndicator color="#000" /> : <Text style={[styles.btnText, { color: '#000' }]}>CREATE</Text>}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.divider}>
          <View style={[styles.dividerLine, { backgroundColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]} />
          <Text style={[styles.dividerText, { color: textColor(isDark, 'muted') }]}>SECURE CONNECTION</Text>
          <View style={[styles.dividerLine, { backgroundColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 56,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 2.5 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 10 },
  brandArea: { alignItems: 'center', marginBottom: 28 },
  brandIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  title: { marginTop: 16, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { marginTop: 6, fontSize: 13, fontWeight: '700', lineHeight: 20 },
  formCard: { borderRadius: 24, padding: 20, gap: 16 },
  inputGroup: { gap: 6 },
  inputLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.5, marginLeft: 2 },
  inputRow: {
    height: 50,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
  },
  input: { flex: 1, height: '100%', fontSize: 14, fontWeight: '700' },
  toggleBtn: { padding: 4 },
  forgotBtn: { alignSelf: 'flex-end', paddingVertical: 4 },
  forgotText: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  btn: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: { borderColor: COLORS.primary, shadowColor: COLORS.primary, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  btnText: { fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 28,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 8, fontWeight: '900', letterSpacing: 1.5 },
});
