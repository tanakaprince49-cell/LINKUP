import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Bot, Check, Clock3, Mail, PenLine, Send, ShieldCheck, X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import {
  agentApproveTask,
  agentClaim,
  agentConnectGmail,
  agentCreateTask,
  agentDisconnectGmail,
  agentDiscardTask,
  agentHome,
  type AgentHome,
  type AgentTask,
} from '../lib/linkyApi';

/**
 * AI AGENTS — the personal workforce, web-first closed beta.
 *
 * Alex is an AI. Alex drafts; the human approves; only then does Gmail send.
 * The server enforces the beta budget (20 seats, 5 tasks a day, 700 total);
 * this screen simply makes that visible and keeps the approval step one tap
 * away at all times. Nothing here can send without the Approve button.
 */
const YELLOW = '#FBE618';
const INK = '#0A0B0D';

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
  const [instruction, setInstruction] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { to: string; subject: string; body: string }>>({});

  const load = useCallback(async () => {
    try {
      const data = await agentHome();
      setHome(data);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const task of data.tasks || []) {
          if (!next[task.id] && task.draft) next[task.id] = { ...task.draft };
        }
        return next;
      });
    } catch (error) {
      setNotice(friendly(error, 'Could not load your workforce. Pull again in a moment.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The workforce API is signed-in only. Guests get the pitch below, not a
    // doomed request and an error toast.
    if (user?.uid) void load();
    else if (!authLoading) setLoading(false);
  }, [load, user?.uid, authLoading]);

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

  const connect = useCallback(async () => {
    setBusy('connect');
    setNotice('');
    try {
      const result = await agentConnectGmail();
      if (result?.url) await Linking.openURL(result.url);
      else setNotice('Gmail connection is not switched on yet. Alex can still draft.');
    } catch (error) {
      setNotice(friendly(error, 'Gmail connection is not switched on yet. Alex can still draft.'));
    } finally {
      setBusy('');
    }
  }, []);

  const disconnect = useCallback(async () => {
    setBusy('disconnect');
    try {
      await agentDisconnectGmail();
      await load();
    } catch (error) {
      setNotice(friendly(error, 'Could not disconnect Gmail just now.'));
    } finally {
      setBusy('');
    }
  }, [load]);

  const giveTask = useCallback(async () => {
    const ask = instruction.trim();
    if (ask.length < 3 || busy) return;
    setBusy('task');
    setNotice('');
    try {
      await agentCreateTask(ask);
      setInstruction('');
      await load();
    } catch (error) {
      setNotice(friendly(error, 'Alex could not take that task just now. Try again in a minute.'));
    } finally {
      setBusy('');
    }
  }, [busy, instruction, load]);

  const approve = useCallback(async (task: AgentTask) => {
    const draft = drafts[task.id];
    if (!draft) return;
    setBusy(`approve-${task.id}`);
    setNotice('');
    try {
      await agentApproveTask(task.id, draft);
      Alert.alert('Sent by Alex via Gmail', 'That email is out. The task is in your history.');
      await load();
    } catch (error) {
      setNotice(friendly(error, 'Alex could not send that. Check Gmail is connected and try again.'));
      await load();
    } finally {
      setBusy('');
    }
  }, [drafts, load]);

  const discard = useCallback(async (task: AgentTask) => {
    setBusy(`discard-${task.id}`);
    try {
      await agentDiscardTask(task.id);
      await load();
    } finally {
      setBusy('');
    }
  }, [load]);

  const card = [styles.card, { backgroundColor: dark ? '#16181D' : '#FFFFFF', borderColor: dark ? '#262A32' : '#E4E7EC' }];
  const titleColor = dark ? '#FFFFFF' : INK;
  const bodyColor = dark ? '#C9CEDA' : '#3D434F';
  const faintColor = dark ? '#868D9E' : '#6F7685';
  const inputStyle = [styles.input, { backgroundColor: dark ? '#101318' : '#F6F7F9', color: titleColor, borderColor: dark ? '#262A32' : '#E4E7EC' }];

  if (loading && !home) {
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
            You have co-founders for the company. Now staff the work itself. Alex, your executive assistant, drafts and sends email under your approval — sign in to claim one of the 20 beta seats.
          </Text>
        </View>
        <View style={card}>
          <Text style={[styles.cardTitle, { color: titleColor }]}>Alex is waiting inside</Text>
          <Text style={[styles.body, { color: bodyColor }]}>Closed beta: 20 seats, five free task executions a day for seven days. Nothing is ever sent without your explicit approval.</Text>
          <TouchableOpacity style={[styles.primary, { backgroundColor: YELLOW }]} onPress={() => navigation.navigate('EmailAuth')} activeOpacity={0.85}>
            <Text style={[styles.primaryText, { color: INK }]}>Sign in to claim your seat</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  const claimed = !!home?.beta?.claimed;
  const tasks = home?.tasks || [];
  const usage = home?.usage || { limit: 5, usedToday: 0, remaining: 5 };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: dark ? INK : '#F7F4E6' }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>LINKUP AI AGENTS · AI, LABELLED AS AI</Text>
        </View>
        <Text style={[styles.h1, { color: titleColor }]}>Your personal AI workforce</Text>
        <Text style={[styles.sub, { color: bodyColor }]}>
          You have co-founders for the company. Now staff the work itself. Alex handles email under your approval — other specialists join as the beta grows.
        </Text>
        <View style={styles.statsRow}>
          <Text style={[styles.stat, { color: faintColor }]}>Beta seats {home ? `${home.beta.seatsTaken}/${home.beta.seatsTotal}` : '—'}</Text>
          <Text style={[styles.stat, { color: faintColor }]}>Today {usage.remaining} of {usage.limit} tasks left</Text>
        </View>
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
            For 7 days, twenty LINKUP members test Alex with five free task executions a day. Approval-first, always labelled AI, never sent without you.
          </Text>
          <TouchableOpacity style={[styles.primary, { backgroundColor: YELLOW }]} onPress={claim} disabled={busy === 'claim'} activeOpacity={0.85}>
            {busy === 'claim' ? <ActivityIndicator color={INK} /> : <Text style={[styles.primaryText, { color: INK }]}>Claim my beta seat</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={card}>
            <View style={styles.rowBetween}>
              <View style={styles.row}>
                <View style={styles.avatar}><Bot size={20} color={INK} /></View>
                <View>
                  <Text style={[styles.agentName, { color: titleColor }]}>Alex · Personal Executive Assistant</Text>
                  <Text style={[styles.faint, { color: faintColor }]}>Gmail, approval-first · Online</Text>
                </View>
              </View>
              <View style={styles.livePill}><Text style={styles.livePillText}>AI</Text></View>
            </View>

            {home?.gmail?.connected ? (
              <View style={styles.rowBetween}>
                <Text style={[styles.body, { color: bodyColor }]}><Mail size={13} color={bodyColor} /> Gmail connected{home.gmail.email ? ` · ${home.gmail.email}` : ''}</Text>
                <TouchableOpacity onPress={disconnect} disabled={busy === 'disconnect'}>
                  <Text style={[styles.link, { color: faintColor }]}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.secondary, { borderColor: dark ? '#3A4150' : '#D8DCE3' }]}
                onPress={connect}
                disabled={busy === 'connect'}
                activeOpacity={0.8}
              >
                {busy === 'connect'
                  ? <ActivityIndicator color={titleColor} />
                  : <Text style={[styles.secondaryText, { color: titleColor }]}><Mail size={14} color={titleColor} /> Connect Gmail to send after approval</Text>}
              </TouchableOpacity>
            )}

            <TextInput
              value={instruction}
              onChangeText={setInstruction}
              placeholder="Give Alex a task. E.g. Email thabo@example.com: follow up on yesterday's meeting and propose Tuesday 10am."
              placeholderTextColor={faintColor}
              multiline
              style={[inputStyle, styles.taskInput]}
              maxLength={800}
              editable={usage.remaining > 0}
            />
            <TouchableOpacity
              style={[styles.primary, { backgroundColor: usage.remaining > 0 ? YELLOW : '#BDBDBD' }]}
              onPress={giveTask}
              disabled={usage.remaining <= 0 || busy === 'task' || instruction.trim().length < 3}
              activeOpacity={0.85}
            >
              {busy === 'task'
                ? <ActivityIndicator color={INK} />
                : <Text style={[styles.primaryText, { color: INK }]}><Send size={14} color={INK} /> Give Alex the task</Text>}
            </TouchableOpacity>
            <Text style={[styles.faint, { color: faintColor }]}>

              {usage.remaining > 0
                ? 'Alex drafts. You approve. Gmail sends. Every task counts once, draft included.'
                : 'That is your 5 beta tasks for today. Alex resets at midnight UTC.'}
            </Text>
          </View>

          <Text style={[styles.section, { color: titleColor }]}>Task history</Text>

          {tasks.length === 0 ? (
            <View style={card}>
              <Text style={[styles.body, { color: bodyColor }]}>No tasks yet. Give Alex the first one above — a follow-up email you have been avoiding is the classic start.</Text>
            </View>
          ) : tasks.map((task) => {
            const draft = drafts[task.id];
            const status = task.status || '';
            return (
              <View key={task.id} style={card}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.taskAsk, { color: titleColor }]} numberOfLines={2}>{task.instruction}</Text>
                  <View style={[styles.statusPill, status === 'sent' ? styles.statusGood : status === 'awaiting_approval' ? styles.statusWait : styles.statusMuted]}>
                    <Text style={styles.statusText}>
                      {status === 'awaiting_approval' ? 'NEEDS APPROVAL' : status.toUpperCase().replace(/_/g, ' ')}
                    </Text>
                  </View>
                </View>
                {!!task.summary && <Text style={[styles.faint, { color: faintColor }]}>{task.summary}</Text>}

                {!!task.createdAt && (
                  <Text style={[styles.faint, { color: faintColor }]}>
                    <Clock3 size={11} color={faintColor} /> {new Date(task.createdAt).toLocaleString()} · ~{task.tokensEst || 0} tokens
                  </Text>
                )}

                {status === 'unsupported' && !!task.reply && (
                  <Text style={[styles.body, { color: bodyColor }]}>{task.reply}</Text>
                )}

                {status === 'awaiting_approval' && draft && (
                  <View style={styles.draftBox}>
                    <Text style={[styles.faint, { color: faintColor }]}><PenLine size={12} color={faintColor} /> Draft by Alex (AI) — edit before you approve</Text>
                    <TextInput value={draft.to} onChangeText={(to) => setDrafts((p) => ({ ...p, [task.id]: { ...draft, to } }))} placeholder="Recipient email" placeholderTextColor={faintColor} style={inputStyle} autoCapitalize="none" />
                    <TextInput value={draft.subject} onChangeText={(subject) => setDrafts((p) => ({ ...p, [task.id]: { ...draft, subject } }))} placeholder="Subject" placeholderTextColor={faintColor} style={inputStyle} />
                    <TextInput value={draft.body} onChangeText={(body) => setDrafts((p) => ({ ...p, [task.id]: { ...draft, body } }))} multiline style={[inputStyle, styles.draftBody]} />
                    {!!task.error && <Text style={{ color: '#E02424', fontSize: 12 }}>{task.error === 'gmail_not_connected' ? 'Connect Gmail above, then approve — sending needs your Gmail.' : 'That send did not go through. Check the draft and try again.'}</Text>}
                    <View style={styles.actionRow}>
                      <TouchableOpacity style={[styles.approve, { backgroundColor: YELLOW }]} onPress={() => approve(task)} disabled={busy === `approve-${task.id}`}>
                        {busy === `approve-${task.id}` ? <ActivityIndicator color={INK} /> : <Text style={[styles.primaryText, { color: INK }]}><Check size={14} color={INK} /> Approve &amp; send</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.discard} onPress={() => discard(task)} disabled={busy === `discard-${task.id}`}>
                        <Text style={[styles.link, { color: faintColor }]}><X size={13} color={faintColor} /> Discard</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {status === 'sent' && (
                  <Text style={[styles.faint, { color: '#1F7A3D' }]}><ShieldCheck size={12} color="#1F7A3D" /> Sent by Alex via Gmail{task.result?.to ? ` to ${task.result.to}` : ''}. Approved by you.</Text>
                )}
              </View>
            );
          })}
        </>
      )}

      <View style={card}>
        <Text style={[styles.cardTitle, { color: titleColor }]}>Joining the workforce soon</Text>

        <Text style={[styles.body, { color: bodyColor }]}>Sarah · Email &amp; Communications Assistant</Text>
        <Text style={[styles.faint, { color: faintColor }]}>Inbox triage, follow-ups and communication drafts.</Text>
        <Text style={[styles.body, { color: bodyColor }]}>Marcus · Developer &amp; GitHub Assistant</Text>
        <Text style={[styles.faint, { color: faintColor }]}>Repository analysis and developer workflows.</Text>
        <Text style={[styles.faint, { color: faintColor, marginTop: 10 }]}>Every agent is clearly labelled AI. Nothing external — no email, no commitment — happens without your explicit approval.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { paddingVertical: 12 },
  heroBadge: { alignSelf: 'flex-start', backgroundColor: YELLOW, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  heroBadgeText: { color: INK, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  h1: { fontSize: 30, fontWeight: '800', marginTop: 12 },
  sub: { fontSize: 15, lineHeight: 21, marginTop: 8 },
  statsRow: { flexDirection: 'row', gap: 16, marginTop: 10, flexWrap: 'wrap' },
  stat: { fontSize: 12, fontWeight: '600' },
  notice: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14, gap: 10 },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 20 },
  faint: { fontSize: 12, lineHeight: 17 },
  primary: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  primaryText: { fontSize: 14, fontWeight: '800' },
  secondary: { borderWidth: 1, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  secondaryText: { fontSize: 13, fontWeight: '700' },
  link: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: YELLOW, alignItems: 'center', justifyContent: 'center' },
  agentName: { fontSize: 15, fontWeight: '700' },
  livePill: { backgroundColor: INK, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  livePillText: { color: YELLOW, fontSize: 10, fontWeight: '800' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  taskInput: { minHeight: 84, textAlignVertical: 'top' },
  section: { fontSize: 18, fontWeight: '700', marginVertical: 4 },
  taskAsk: { fontSize: 14, fontWeight: '700', flex: 1 },
  statusPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statusGood: { backgroundColor: '#DDF3E2' },
  statusWait: { backgroundColor: YELLOW },
  statusMuted: { backgroundColor: '#E9EBEF' },
  statusText: { fontSize: 10, fontWeight: '800', color: INK },
  draftBox: { gap: 8 },
  draftBody: { minHeight: 110, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  approve: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  discard: { paddingVertical: 8, paddingHorizontal: 4 },
});
