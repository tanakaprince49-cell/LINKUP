import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ArrowLeft, CalendarDays, Mail, MessageCircle, ShieldCheck } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import VerifiedBadge from '../components/VerifiedBadge';
import { agentPhoto } from '../lib/agentAssets';
import { agentConnect, agentHome, type AgentHome } from '../lib/linkyApi';

/**
 * Every agent has a full LINKUP profile, like any member: photo, verified
 * blue tick, role, about, skills, a track record — plus the two things that
 * make an agent different from a person, stated plainly on the profile
 * itself: "AI AGENT", and the approval rule it works under.
 */
const YELLOW = '#FBE618';
const INK = '#0A0B0D';

export default function AiAgentProfileScreen({ navigation, route }: any) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const dark = theme === 'dark';
  const agentId = String(route?.params?.agentId || 'alex');
  const [home, setHome] = useState<AgentHome | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setHome(await agentHome());
    } catch {
      setHome(null);
    }
  }, []);
  useEffect(() => { if (user?.uid) void load(); }, [load, user?.uid]);

  const agent = useMemo(
    () => (home?.agents || []).find((a) => a.id === agentId) || (home?.agents || [])[0] || null,
    [home, agentId],
  );
  const myTasks = useMemo(
    () => (home?.tasks || []).filter((t) => t.agent === (agent?.id || agentId)),
    [home, agent, agentId],
  );
  const done = myTasks.filter((t) => t.status === 'sent').length;
  const awaiting = myTasks.filter((t) => t.status === 'awaiting_approval').length;
  const connection = agent?.provider === 'calendar' ? home?.calendar : home?.gmail;
  const providerLabel = agent?.provider === 'calendar' ? 'Google Calendar' : 'Gmail';

  const connect = useCallback(async () => {
    if (!agent) return;
    setBusy('connect');
    try {
      const result = await agentConnect(agent.provider === 'calendar' ? 'calendar' : 'gmail');
      if (result?.url) await Linking.openURL(result.url);
    } finally {
      setBusy('');
    }
  }, [agent]);

  const titleColor = dark ? '#FFFFFF' : INK;
  const bodyColor = dark ? '#C9CEDA' : '#3D434F';
  const faintColor = dark ? '#868D9E' : '#6F7685';
  const cardBg = dark ? '#16181D' : '#FFFFFF';
  const lineColor = dark ? '#262A32' : '#E4E7EC';
  const card = [styles.card, { backgroundColor: cardBg, borderColor: lineColor }];

  if (!agent) {
    return (
      <View style={[styles.center, { backgroundColor: dark ? INK : '#F7F4E6' }]}>
        <ActivityIndicator color={INK} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: dark ? INK : '#F7F4E6' }} contentContainerStyle={styles.page}>
      <View style={styles.topBar}>
        <TouchableOpacity accessibilityLabel="Back" onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <ArrowLeft size={21} color={titleColor} />
        </TouchableOpacity>
      </View>

      <View style={styles.hero}>
        <Image source={agentPhoto(agent.id)} style={styles.photo} />
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: titleColor }]}>{agent.name}</Text>
          <VerifiedBadge size={26} accessibilityLabel={`Verified AI agent — ${agent.name}`} />
          <View style={styles.aiTag}><Text style={styles.aiTagText}>AI AGENT</Text></View>
        </View>
        <Text style={[styles.role, { color: bodyColor }]}>{agent.role}</Text>
        <Text style={[styles.faint, { color: faintColor }]}>LINKUP Workforce · Verified agent · Joined Nov 2026</Text>
        <Text style={[styles.bio, { color: bodyColor }]}>{agent.bio || agent.blurb}</Text>
        <TouchableOpacity
          style={[styles.primary, { backgroundColor: YELLOW }]}
          onPress={() => navigation.navigate('AiAgentChat', { agentId: agent.id })}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryText, { color: INK }]}><MessageCircle size={15} color={INK} /> Message {agent.name}</Text>
        </TouchableOpacity>
      </View>

      <View style={card}>
        <Text style={[styles.cardTitle, { color: titleColor }]}>Track record with you</Text>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={[styles.statNum, { color: titleColor }]}>{done}</Text>
            <Text style={[styles.faint, { color: faintColor }]}>{agent.provider === 'calendar' ? 'events created' : 'emails sent'}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statNum, { color: titleColor }]}>{awaiting}</Text>
            <Text style={[styles.faint, { color: faintColor }]}>awaiting approval</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statNum, { color: titleColor }]}>{myTasks.length}</Text>
            <Text style={[styles.faint, { color: faintColor }]}>tasks given</Text>
          </View>
        </View>
      </View>

      <View style={card}>
        <Text style={[styles.cardTitle, { color: titleColor }]}>Skills</Text>
        <View style={styles.chips}>
          {(agent.skills || []).map((skill) => (
            <View key={skill} style={[styles.chip, { borderColor: lineColor }]}>
              <Text style={[styles.chipText, { color: titleColor }]}>{skill}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={card}>
        <Text style={[styles.cardTitle, { color: titleColor }]}>Connected tools</Text>
        <View style={styles.toolRow}>
          {agent.provider === 'calendar' ? <CalendarDays size={18} color={titleColor} /> : <Mail size={18} color={titleColor} />}
          <View style={{ flex: 1 }}>
            <Text style={[styles.body, { color: titleColor, fontWeight: '700' }]}>{providerLabel}</Text>
            <Text style={[styles.faint, { color: faintColor }]}>
              {connection?.connected ? `Connected${connection.email ? ` · ${connection.email}` : ''}` : 'Not connected — drafting still works'}
            </Text>
          </View>
          {!connection?.connected && (
            <TouchableOpacity style={[styles.smallBtn, { backgroundColor: YELLOW }]} onPress={connect} disabled={busy === 'connect'}>
              {busy === 'connect' ? <ActivityIndicator color={INK} /> : <Text style={[styles.smallBtnText, { color: INK }]}>Connect</Text>}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={card}>
        <Text style={[styles.cardTitle, { color: titleColor }]}>How {agent.name} works</Text>
        <Text style={[styles.body, { color: bodyColor }]}><ShieldCheck size={13} color={bodyColor} /> You message the task in plain language.</Text>
        <Text style={[styles.body, { color: bodyColor }]}><ShieldCheck size={13} color={bodyColor} /> {agent.name} drafts the exact {agent.provider === 'calendar' ? 'event' : 'email'} in your thread — edit anything.</Text>
        <Text style={[styles.body, { color: bodyColor }]}><ShieldCheck size={13} color={bodyColor} /> Only your Approve tap {agent.provider === 'calendar' ? 'puts it on your Google Calendar' : 'sends it through Gmail'}. No approval, no action — ever.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { flexDirection: 'row', marginBottom: 6 },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 10 },
  photo: { width: 148, height: 148, borderRadius: 74, borderWidth: 3, borderColor: YELLOW },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6 },
  name: { fontSize: 26, fontWeight: '800' },
  aiTag: { backgroundColor: INK, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  aiTagText: { color: YELLOW, fontSize: 10, fontWeight: '800' },
  role: { fontSize: 15, fontWeight: '600' },
  bio: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 4 },
  primary: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', minHeight: 46, marginTop: 8 },
  primaryText: { fontSize: 14, fontWeight: '800' },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 14, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statNum: { fontSize: 22, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20 },
  faint: { fontSize: 12, lineHeight: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: '600' },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  smallBtn: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 13 },
  smallBtnText: { fontSize: 12, fontWeight: '800' },
});
