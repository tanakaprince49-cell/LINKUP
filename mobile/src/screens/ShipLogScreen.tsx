import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Rocket } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { normalizeShipLogs, persistShipAndRep, SHIP_VERIFY_DAYS, todayKey, uniqueShipDays } from '../lib/dailyLoop';

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
      <View style={styles.top}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: textColor(isDark) }]}>SHIP LOG</Text>
          <Text style={styles.sub}>{days}/{SHIP_VERIFY_DAYS} days toward ship verification · Rep decays if you go quiet</Text>
        </View>
      </View>
      <View style={[styles.composer, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#FFF' }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Shipped today: launched waitlist / fixed onboarding / talked to 3 users"
          placeholderTextColor="#888"
          maxLength={180}
          multiline
          style={[styles.input, { color: textColor(isDark) }]}
        />
        <TextInput
          value={link}
          onChangeText={setLink}
          placeholder="Optional link"
          placeholderTextColor="#888"
          autoCapitalize="none"
          style={[styles.link, { color: textColor(isDark) }]}
        />
        <TouchableOpacity onPress={submit} disabled={saving} style={styles.btn}>
          {saving ? <ActivityIndicator color="#000" /> : <><Rocket size={14} color="#000" /><Text style={styles.btnText}>LOG SHIP</Text></>}
        </TouchableOpacity>
      </View>
      <FlatList
        data={logs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        renderItem={({ item }) => (
          <View style={[styles.log, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#FFF' }]}>
            <Text style={[styles.logText, { color: textColor(isDark) }]}>{item.text}</Text>
            <Text style={styles.logDate}>{item.createdAt.slice(0, 10)}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No ships yet. One line. Today.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900' },
  sub: { marginTop: 3, fontSize: 11, fontWeight: '700', color: '#777', lineHeight: 15 },
  composer: { margin: 16, borderRadius: 18, padding: 14, gap: 10 },
  input: { minHeight: 72, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  link: { height: 40, fontSize: 13, fontWeight: '700' },
  btn: { height: 48, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnText: { fontSize: 12, fontWeight: '900', letterSpacing: 1.2, color: '#000' },
  log: { borderRadius: 16, padding: 14 },
  logText: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  logDate: { marginTop: 6, fontSize: 10, fontWeight: '800', color: '#888' },
  empty: { textAlign: 'center', marginTop: 24, color: '#888', fontWeight: '700' },
});
