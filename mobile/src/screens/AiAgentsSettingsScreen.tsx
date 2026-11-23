import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ArrowLeft, CalendarDays, Mail, ShieldCheck } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import AgentAvatar from '../components/AgentAvatar';
import {
  agentConnect,
  agentDisconnect,
  agentHome,
  type AgentHome,
  type AgentTask,
} from '../lib/linkyApi';

/**
 * Workforce settings: the whole beta at a glance. Usage today, seats, both
 * Google connections, and the full task history across every agent — with
 * awaiting drafts one tap from the conversation that owns them.
 */
const YELLOW = '#FBE618';
const INK = '#0A0B0D';

function friendly(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message && message.length < 140 ? message : fallback;
}

export default function AiAgentsSettingsScreen({ navigation }: any) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const dark = theme === 'dark';
  const [home, setHome] = useState<AgentHome | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setHome(await agentHome());
    } catch (error) {
      setNotice(friendly(error, 'Could not load settings. Try again in a moment.'));
    }
  }, []);
  useEffect(() => { if (user?.uid) void load(); }, [load, user?.uid]);
  useFocusEffect(useCallback(() => { if (user?.uid) void load(); }, [load, user?.uid]));

  const toggleConnection = useCallback(async (provider: 'gmail' | 'calendar', connected: boolean) => {
    setBusy(provider);
    setNotice('');
    try {
      if (connected) {
        await agentDisconnect(provider);
        await load();
      } else {
        const result = await agentConnect(provider);
        if (result?.url) await Linking.openURL(result.url);
        else setNotice('Google connection is not switched on yet. Your agents can still draft.');
      }
    } catch (error) {
      setNotice(friendly(error, 'That connection could not be changed just now.'));
    } finally {
      setBusy('');
    }
  }, [load]);

  const titleColor = dark ? '#FFFFFF' : INK;
  const bodyColor = dark ? '#C9CEDA' : '#3D434F';
  const faintColor = dark ? '#868D9E' : '#6F7685';
  const cardBg = dark ? '#16181D' : '#FFFFFF';
  const lineColor = dark ? '#262A32' : '#E4E7EC';
  const card = [styles.card, { backgroundColor: cardBg, borderColor: lineColor }];
  const usage = home?.usage || { limit: 5, usedToday: 0, remaining: 5 };
  const tasks = home?.tasks || [];

  const statusStyle = (task: AgentTask) => {
    const status = task.status || '';
    if (status === 'sent') return styles.statusGood;
    if (status === 'awaiting_approval') return styles.statusWait;
    return styles.statusMuted;
  };

  const connectionRow = (provider: 'gmail' | 'calendar') => {
    const conn = provider === 'calendar' ? home?.calendar : home?.gmail;
    const label = provider === 'calendar' ? 'Google Calendar' : 'Gmail';
    const Icon = provider === 'calendar' ? CalendarDays : Mail;
    return (
      <View style={styles.rowBetween}>
        <View style={styles.row}>
          <Icon size={18} color={titleColor} />
          <View>
            <Text style={[styles.body, { color: titleColor, fontWeight: '700' }]}>{label}</Text>
            <Text style={[styles.faint, { color: faintColor }]}>{conn?.connected ? `Connected${conn.email ? ` · ${conn.email}` : ''}` : 'Not connected'}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={conn?.connected ? [styles.ghostBtn, { borderColor: lineColor }] : [styles.smallBtn, { backgroundColor: YELLOW }]}
          onPress={() => toggleConnection(provider, !!conn?.connected)}
          disabled={busy === provider}
        >
          {busy === provider
            ? <ActivityIndicator color={titleColor} />
            : <Text style={[styles.smallBtnText, { color: conn?.connected ? titleColor : INK }]}>{conn?.connected ? 'Disconnect' : 'Connect'}</Text>}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: dark ? INK : '#F7F4E6' }} contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="Back" onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <ArrowLeft size={21} color={titleColor} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: titleColor }]}>Workforce settings</Text>
      </View>

      {!!notice && (
        <View style={[styles.notice, { borderColor: dark ? '#3A2E00' : '#E5D76B', backgroundColor: dark ? '#221C00' : '#FFF8CC' }]}>
          <Text style={{ color: dark ? YELLOW : '#574800', fontSize: 13 }}>{notice}</Text>
        </View>
      )}

      <View style={card}>
        <Text style={[styles.cardTitle, { color: titleColor }]}>Closed beta</Text>
        <View style={styles.rowBetween}>
          <Text style={[styles.body, { color: bodyColor }]}>Your executions today</Text>
          <Text style={[styles.body, { color: titleColor, fontWeight: '800' }]}>{usage.usedToday} / {usage.limit} used · {usage.remaining} left</Text>
        </View>
        <View style={styles.rowBetween}>
          <Text style={[styles.body, { color: bodyColor }]}>Beta seats</Text>
          <Text style={[styles.body, { color: titleColor, fontWeight: '800' }]}>{home ? `${home.beta.seatsTaken} / ${home.beta.seatsTotal}` : '—'}</Text>
        </View>
        <View style={styles.rowBetween}>
          <Text style={[styles.body, { color: bodyColor }]}>Beta execution budget</Text>
          <Text style={[styles.body, { color: titleColor, fontWeight: '800' }]}>{home?.beta?.cap ?? 700} total</Text>
        </View>
        <Text style={[styles.faint, { color: faintColor }]}>Limits reset at midnight UTC and are enforced on the server — no agent can spend past them.</Text>
      </View>

      <View style={card}>
        <Text style={[styles.cardTitle, { color: titleColor }]}>Connections</Text>
        {connectionRow('gmail')}
        {connectionRow('calendar')}
        <Text style={[styles.faint, { color: faintColor }]}>Approvals only ever act through the connection they belong to: Gmail for Alex, Google Calendar for Sarah. Disconnecting never deletes drafts.</Text>
      </View>

      <Text style={[styles.section, { color: titleColor }]}>Task history</Text>
      {tasks.length === 0 ? (
        <View style={card}>
          <Text style={[styles.body, { color: bodyColor }]}>No tasks yet. Message Alex or Sarah and everything they do for you will be recorded here.</Text>
        </View>
      ) : tasks.map((task) => (
        <View key={task.id} style={card}>
          <View style={styles.rowBetween}>
            <View style={[styles.row, { flex: 1 }]}>
              <AgentAvatar agentId={task.agent} name={task.agentName} size={34} tick={false} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.body, { color: titleColor, fontWeight: '700' }]} numberOfLines={1}>{task.agentName || task.agent} · {task.kind === 'event' ? 'Calendar event' : task.kind === 'email' ? 'Email' : 'Task'}</Text>
                <Text style={[styles.faint, { color: faintColor }]} numberOfLines={2}>{task.instruction}</Text>
              </View>
            </View>
            <View style={[styles.statusPill, statusStyle(task)]}>
              <Text style={styles.statusText}>{(task.status || '').replace(/_/g, ' ').toUpperCase()}</Text>
            </View>
          </View>
          <Text style={[styles.faint, { color: faintColor }]}>
            {task.createdAt ? `${new Date(task.createdAt).toLocaleString()} · ` : ''}~{task.tokensEst || 0} tokens
            {task.status === 'sent' && task.kind === 'email' && task.result?.to ? ` · to ${task.result.to}` : ''}
            {task.status === 'sent' && task.kind === 'event' && task.result?.title ? ` · ${task.result.title}` : ''}
          </Text>

          {task.status === 'awaiting_approval' && (
            <TouchableOpacity onPress={() => navigation.navigate('AiAgentChat', { agentId: task.agent })}>
              <Text style={[styles.link, { color: '#8A6D00' }]}>Review &amp; approve in your conversation →</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}

      <View style={card}>
        <Text style={[styles.cardTitle, { color: titleColor }]}>The rules your workforce lives by</Text>
        <Text style={[styles.body, { color: bodyColor }]}><ShieldCheck size={13} color={bodyColor} /> Every agent is AI, labelled AI, with a verified agent profile.</Text>
        <Text style={[styles.body, { color: bodyColor }]}><ShieldCheck size={13} color={bodyColor} /> Nothing external — no email, no calendar event — happens without your explicit approval in the thread.</Text>
        <Text style={[styles.body, { color: bodyColor }]}><ShieldCheck size={13} color={bodyColor} /> Agents never invent results. If an agent cannot do something in this beta, it says so.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800' },
  notice: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  section: { fontSize: 18, fontWeight: '700', marginVertical: 6 },
  body: { fontSize: 14, lineHeight: 20 },
  faint: { fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  smallBtn: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 13 },
  ghostBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 13 },
  smallBtnText: { fontSize: 12, fontWeight: '800' },
  link: { fontSize: 13, fontWeight: '700' },
  statusPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statusGood: { backgroundColor: '#DDF3E2' },
  statusWait: { backgroundColor: YELLOW },
  statusMuted: { backgroundColor: '#E9EBEF' },
  statusText: { fontSize: 10, fontWeight: '800', color: INK },
});
