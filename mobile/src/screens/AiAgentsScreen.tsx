import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CalendarDays, Mail, MessageCircle, Settings2 } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import AgentAvatar from '../components/AgentAvatar';
import VerifiedBadge from '../components/VerifiedBadge';
import {
  agentClaim,
  agentHome,
  type AgentHome,
  type AgentInfo,
} from '../lib/linkyApi';

/**
 * AI WORKFORCE — the directory. Every agent is a person-shaped presence on
 * LINKUP: profile photo, verified blue tick, a real profile page, and a
 * private message thread where the work happens. Alex runs Gmail; Sarah
 * runs Google Calendar. Both draft first and act only on approval.
 */
const YELLOW = '#FBE618';
const INK = '#0A0B0D';

// The guest pitch mirrors the server roster (the authed API is members-only).
const FALLBACK_AGENTS: AgentInfo[] = [
  {
    id: 'alex', name: 'Alex', role: 'Personal Executive Assistant', provider: 'gmail', live: true,
    blurb: 'Your email chief of staff. Drafts, follows up and sends — after your approval.',
  },
  {
    id: 'Sarah', name: 'Sarah', role: 'Scheduling & Calendar Assistant', provider: 'calendar', live: true,
    blurb: 'Your calendar chief of staff. Puts real events on Google Calendar — after your approval.',
  },
];

function friendly(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message && message.length < 140 ? message : fallback;
}

export default function AiAgentsScreen({ navigation }: any) {
  const { theme } = useTheme();
  const { user, loading: authLoading } = useAuth();
  const dark = theme === 'dark';
  const [home, setHome] = useState<AgentHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setHome(await agentHome());
    } catch (error) {
      setNotice(friendly(error, 'Could not load your workforce. Pull again in a moment.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.uid) void load();
    else if (!authLoading) setLoading(false);
  }, [load, user?.uid, authLoading]);
  useFocusEffect(useCallback(() => { if (user?.uid) void load(); }, [load, user?.uid]));

  const claim = useCallback(async () => {
    setBusy('claim');
    setNotice('');
    try {
      await agentClaim();
      await load();
    } catch (error) {
      setNotice(friendly(error, 'The beta could not take another seat just now.'));
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

  if (loading && !home && !notice) {
    return (
      <View style={[styles.center, { backgroundColor: dark ? INK : '#F7F4E6' }]}>
        <ActivityIndicator color={INK} />
        <Text style={[styles.faint, { color: faintColor, marginTop: 10 }]}>Staffing your workforce…</Text>
      </View>
    );
  }

  if (!user && !authLoading) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: dark ? INK : '#F7F4E6' }} contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>LINKUP AI AGENTS · AI, LABELLED AS AI</Text>
          </View>
          <Text style={[styles.h1, { color: titleColor }]}>Your personal AI workforce</Text>
          <Text style={[styles.sub, { color: bodyColor }]}>
            You have co-founders for the company. Now staff the work itself. Message an agent like a chief of staff — it drafts the work, you approve it, then it acts. Sign in to claim one of the 20 beta seats.
          </Text>
        </View>
        {(home?.agents?.length ? home.agents : FALLBACK_AGENTS).map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            home={home}
            dark={dark}
            signedOut
            onMessage={() => navigation.navigate('EmailAuth')}
            onProfile={() => navigation.navigate('EmailAuth')}
          />
        ))}
        <View style={card}>
          <Text style={[styles.cardTitle, { color: titleColor }]}>Alex and Sarah are waiting inside</Text>
          <Text style={[styles.body, { color: bodyColor }]}>Closed beta: 20 seats, five free task executions a day for seven days. Nothing is ever sent or scheduled without your explicit approval.</Text>
          <TouchableOpacity style={[styles.primary, { backgroundColor: YELLOW }]} onPress={() => navigation.navigate('EmailAuth')} activeOpacity={0.85}>
            <Text style={[styles.primaryText, { color: INK }]}>Sign in to claim your seat</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  const claimed = !!home?.beta?.claimed;
  const usage = home?.usage || { limit: 5, usedToday: 0, remaining: 5 };
  const recent = (home?.tasks || []).slice(0, 4);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: dark ? INK : '#F7F4E6' }} contentContainerStyle={styles.page}>
      <View style={styles.headerRow}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>LINKUP AI AGENTS · BETA</Text>
        </View>
        <TouchableOpacity accessibilityLabel="Workforce settings" onPress={() => navigation.navigate('AiAgentsSettings')} style={[styles.gear, { borderColor: lineColor, backgroundColor: cardBg }]}>
          <Settings2 size={19} color={titleColor} />
        </TouchableOpacity>
      </View>
      <Text style={[styles.h1, { color: titleColor }]}>Your personal AI workforce</Text>
      <Text style={[styles.sub, { color: bodyColor }]}>
        Two specialists on staff. Message them like chiefs of staff — they draft, you approve, then they act. Nobody here is human, and nobody hides it.
      </Text>
      <View style={styles.statsRow}>
        <Text style={[styles.stat, { color: faintColor }]}>Beta seats {home ? `${home.beta.seatsTaken}/${home.beta.seatsTotal}` : '—'}</Text>
        <Text style={[styles.stat, { color: faintColor }]}>Today {usage.remaining} of {usage.limit} executions left</Text>
      </View>

      {!!notice && (
        <View style={[styles.notice, { borderColor: dark ? '#3A2E00' : '#E5D76B', backgroundColor: dark ? '#221C00' : '#FFF8CC' }]}>
          <Text style={{ color: dark ? YELLOW : '#574800', fontSize: 13 }}>{notice}</Text>
        </View>
      )}

      {!claimed ? (
        <View style={card}>
          <Text style={[styles.cardTitle, { color: titleColor }]}>Closed beta — 20 seats</Text>
          <Text style={[styles.body, { color: bodyColor }]}>
            For 7 days, twenty LINKUP members staff their workforce with five free task executions a day. Approval-first, always labelled AI, never sent or scheduled without you.
          </Text>
          <TouchableOpacity style={[styles.primary, { backgroundColor: YELLOW }]} onPress={claim} disabled={busy === 'claim'} activeOpacity={0.85}>
            {busy === 'claim' ? <ActivityIndicator color={INK} /> : <Text style={[styles.primaryText, { color: INK }]}>Claim my beta seat</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {(home?.agents || []).map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              home={home}
              dark={dark}
              onMessage={() => navigation.navigate('AiAgentChat', { agentId: agent.id })}
              onProfile={() => navigation.navigate('AiAgentProfile', { agentId: agent.id })}
            />
          ))}

          <View style={styles.sectionRow}>
            <Text style={[styles.section, { color: titleColor }]}>Recent activity</Text>
            <TouchableOpacity onPress={() => navigation.navigate('AiAgentsSettings')}>
              <Text style={[styles.link, { color: faintColor }]}>Task history →</Text>
            </TouchableOpacity>
          </View>
          {recent.length === 0 ? (
            <View style={card}>
              <Text style={[styles.body, { color: bodyColor }]}>Nothing yet. Message Alex about the email you keep avoiding, or Sarah about the meeting you keep meaning to set.</Text>
            </View>
          ) : recent.map((task) => (
            <TouchableOpacity
              key={task.id}
              style={card}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('AiAgentChat', { agentId: task.agent })}
            >
              <View style={styles.rowBetween}>
                <View style={[styles.row, { flex: 1 }]}>
                  <AgentAvatar agentId={task.agent} name={task.agentName} size={36} tick={false} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.body, { color: titleColor, fontWeight: '700' }]} numberOfLines={1}>{task.agentName || task.agent}</Text>
                    <Text style={[styles.faint, { color: faintColor }]} numberOfLines={2}>{task.instruction}</Text>
                  </View>
                </View>
                <View style={[styles.statusPill, task.status === 'sent' ? styles.statusGood : task.status === 'awaiting_approval' ? styles.statusWait : styles.statusMuted]}>
                  <Text style={styles.statusText}>{(task.status || '').replace(/_/g, ' ').toUpperCase()}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}

      <Text style={[styles.faint, { color: faintColor, textAlign: 'center', marginTop: 6 }]}>
        More specialists join the workforce as the beta grows. Every agent is clearly labelled AI, and nothing external happens without your approval.
      </Text>
    </ScrollView>
  );
}

function AgentCard({
  agent,
  home,
  dark,
  signedOut = false,
  onMessage,
  onProfile,
}: {
  agent: AgentInfo;
  home: AgentHome | null;
  dark: boolean;
  signedOut?: boolean;
  onMessage: () => void;
  onProfile: () => void;
}) {
  const titleColor = dark ? '#FFFFFF' : INK;
  const bodyColor = dark ? '#C9CEDA' : '#3D434F';
  const faintColor = dark ? '#868D9E' : '#6F7685';
  const cardBg = dark ? '#16181D' : '#FFFFFF';
  const lineColor = dark ? '#262A32' : '#E4E7EC';
  const connection = agent.provider === 'calendar' ? home?.calendar : home?.gmail;
  const tasksDone = (home?.tasks || []).filter((t) => t.agent === agent.id && t.status === 'sent').length;
  const ToolIcon = agent.provider === 'calendar' ? CalendarDays : Mail;
  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: lineColor }]}>
      <TouchableOpacity style={styles.agentHead} onPress={onProfile} activeOpacity={0.8} accessibilityLabel={`${agent.name} profile`}>
        <AgentAvatar agentId={agent.id} name={agent.name} size={64} />
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={[styles.agentName, { color: titleColor }]}>{agent.name}</Text>
            <VerifiedBadge size={19} accessibilityLabel={`Verified AI agent — ${agent.name}`} />
            <View style={styles.aiTag}><Text style={styles.aiTagText}>AI</Text></View>
          </View>
          <Text style={[styles.body, { color: bodyColor, fontWeight: '600' }]}>{agent.role}</Text>
          <Text style={[styles.faint, { color: faintColor }]} numberOfLines={2}>{agent.blurb}</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.rowBetween}>
        <View style={[styles.toolChip, { borderColor: lineColor }]}>
          <ToolIcon size={13} color={titleColor} />
          <Text style={[styles.toolChipText, { color: titleColor }]}>
            {agent.provider === 'calendar' ? 'Google Calendar' : 'Gmail'}
            {signedOut ? '' : connection?.connected ? ' · connected' : ' · not connected'}
          </Text>
        </View>
        {!signedOut && <Text style={[styles.faint, { color: faintColor }]}>{tasksDone} done for you</Text>}
      </View>
      <TouchableOpacity style={[styles.primary, { backgroundColor: YELLOW }]} onPress={onMessage} activeOpacity={0.85}>
        <Text style={[styles.primaryText, { color: INK }]}><MessageCircle size={15} color={INK} /> Message {agent.name}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { paddingVertical: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  gear: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  heroBadge: { alignSelf: 'flex-start', backgroundColor: YELLOW, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  heroBadgeText: { color: INK, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  h1: { fontSize: 30, fontWeight: '800', marginTop: 12 },
  sub: { fontSize: 15, lineHeight: 21, marginTop: 8 },
  statsRow: { flexDirection: 'row', gap: 16, marginTop: 10, marginBottom: 14, flexWrap: 'wrap' },
  stat: { fontSize: 12, fontWeight: '600' },
  notice: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14, gap: 10 },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  agentHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  agentName: { fontSize: 19, fontWeight: '800' },
  aiTag: { backgroundColor: INK, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  aiTagText: { color: YELLOW, fontSize: 9, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20 },
  faint: { fontSize: 12, lineHeight: 17 },
  primary: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  primaryText: { fontSize: 14, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  toolChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  toolChipText: { fontSize: 12, fontWeight: '700' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 10 },
  section: { fontSize: 18, fontWeight: '700' },
  link: { fontSize: 13, fontWeight: '600' },
  statusPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statusGood: { backgroundColor: '#DDF3E2' },
  statusWait: { backgroundColor: YELLOW },
  statusMuted: { backgroundColor: '#E9EBEF' },
  statusText: { fontSize: 10, fontWeight: '800', color: INK },
});
