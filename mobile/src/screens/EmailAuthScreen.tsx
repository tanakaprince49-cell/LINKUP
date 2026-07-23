import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ChevronLeft, Eye, EyeOff } from 'lucide-react-native';
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
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.8}>
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>EMAIL LOGIN</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.content}>
        <Text style={[styles.title, { color: textColor(isDark) }]}>Welcome back</Text>
        <Text style={styles.sub}>Sign in, or create an account with email.</Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="Email"
          placeholderTextColor="#666"
          style={[styles.input, liquidGlass(isDark), { color: textColor(isDark), borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
        />
        <View
          style={[
            styles.passwordWrap,
            liquidGlass(isDark),
          ]}
        >
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            placeholder="Password"
            placeholderTextColor="#666"
            style={[styles.passwordInput, { color: textColor(isDark) }]}
          />
          <TouchableOpacity
            onPress={() => setShowPassword((current) => !current)}
            activeOpacity={0.8}
            style={styles.passwordToggle}
          >
            {showPassword ? (
              <EyeOff size={18} color={textColor(isDark)} />
            ) : (
              <Eye size={18} color={textColor(isDark)} />
            )}
            <Text style={[styles.passwordToggleText, { color: textColor(isDark) }]}>
              {showPassword ? 'HIDE' : 'SHOW'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={doResetPassword}
          disabled={busy}
          activeOpacity={0.8}
          style={styles.forgotBtn}
        >
          <Text style={styles.forgotText}>FORGOT PASSWORD?</Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
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
            style={[styles.btn, { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}
          >
            {busy ? <ActivityIndicator color="#000" /> : <Text style={[styles.btnText, { color: '#000' }]}>CREATE</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 60,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(251,230,24,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(251,230,24,0.19)',
  },
  headerTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  content: { paddingHorizontal: 24, paddingTop: 30 },
  title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  sub: { marginTop: 8, fontSize: 12, fontWeight: '700', color: '#666', lineHeight: 18 },
  input: {
    marginTop: 14,
    height: 54,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 13,
    fontWeight: '800',
  },
  passwordWrap: {
    marginTop: 14,
    height: 54,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
    height: '100%',
    fontSize: 13,
    fontWeight: '800',
    paddingRight: 12,
  },
  passwordToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  passwordToggleText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginTop: 12,
    paddingVertical: 8,
  },
  forgotText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  btn: {
    flex: 1,
    height: 54,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  btnText: { fontSize: 12, fontWeight: '900', letterSpacing: 2 },
});
