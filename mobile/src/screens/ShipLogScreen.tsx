import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, hairline, liquidGlass, textColor } from '../theme/theme';
import { normalizeShipLogs, persistShipAndRep, SHIP_VERIFY_DAYS, todayKey, uniqueShipDays } from '../lib/dailyLoop';
import ScreenHeader from '../components/ScreenHeader';

export default function ShipLogScreen({ navigation }: any) {
  const { user, profile, updateLocalProfile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [saving, setSaving] = useState(false);
  const logs = useMemo(() => normalizeShipLogs((profile as any)?.shipLogs), [profile]);
  const days = uniqueShipDays(logs);

  const submit = async () => {
    if (!user?.uid) return;
    const line = text.trim();
    if (line.length < 4) {
      Alert.alert('Too short', 'Write what you shipped today in one line.');
      return;
    }
    if (logs.some((log) => log.createdAt.slice(0, 10) === todayKey())) {
      Alert.alert('Already shipped today', 'One log per day keeps Rep honest.');
      return;
    }
    setSaving(true);
    try {
      const next = [{ id: `ship_${Date.now()}`, text: line, link: link.trim(), createdAt: new Date().toISOString() }, ...logs];
      const result = await persistShipAndRep(user.uid, profile, next);
      updateLocalProfile({
        shipLogs: next,
        shipCount: next.length,
        reputationScore: result.reputationScore,
        isVerified: result.earnedShipBadge || profile?.isVerified,
        verificationProgram: result.earnedShipBadge ? 'SHIPPED' : profile?.verificationProgram,
      });
      setText('');
      setLink('');
      if (result.earnedShipBadge) {
        Alert.alert('Verified by shipping', `You shipped on ${SHIP_VERIFY_DAYS} different days. That’s a real badge.`);
      }
    } catch (error: any) {
      Alert.alert('Could not save', error?.message || 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.root, appBackground(isDark)]}>
      <ScreenHeader
        title="Ship log"
        subtitle={`${days}/${SHIP_VERIFY_DAYS} days toward ship verification`}
        onBack={() => navigation.goBack()}
        isDark={isDark}
      />
      <View style={[styles.composer, liquidGlass(isDark, false)]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Shipped today: launched waitlist / talked to 3 users"
          placeholderTextColor={textColor(isDark, 'muted')}
          maxLength={180}
          multiline
          style={[styles.input, { color: textColor(isDark) }]}
        />
        <TextInput
          value={link}
          onChangeText={setLink}
          placeholder="Optional link"
          placeholderTextColor={textColor(isDark, 'muted')}
          autoCapitalize="none"
          style={[styles.link, { color: textColor(isDark), borderColor: hairline(isDark) }]}
        />
        <TouchableOpacity onPress={submit} disabled={saving} style={styles.btn}>
          {saving ? <ActivityIndicator color="#111" /> : <Text style={styles.btnText}>Log ship</Text>}
        </TouchableOpacity>
      </View>
      <FlatList
        data={logs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 20, gap: 10 }}
        renderItem={({ item }) => (
          <View style={[styles.log, liquidGlass(isDark, false)]}>
            <Text style={[styles.logText, { color: textColor(isDark) }]}>{item.text}</Text>
            <Text style={[styles.logDate, { color: textColor(isDark, 'muted') }]}>{item.createdAt.slice(0, 10)}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={[styles.empty, { color: textColor(isDark, 'muted') }]}>No ships yet. One line. Today.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  composer: { marginHorizontal: 20, marginBottom: 8, padding: 14, gap: 10 },
  input: { minHeight: 72, fontSize: 15, fontWeight: '600', lineHeight: 22 },
  link: { minHeight: 48, fontSize: 15, fontWeight: '600', borderTopWidth: 1, paddingTop: 10 },
  btn: { minHeight: 52, borderRadius: 16, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '800', color: '#111' },
  log: { padding: 14 },
  logText: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  logDate: { marginTop: 6, fontSize: 12, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 24, fontWeight: '600', fontSize: 15 },
});
