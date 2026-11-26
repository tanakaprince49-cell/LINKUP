import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { ArrowLeft, CalendarPlus, Check, Send, Settings2, X } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import AgentAvatar from '../components/AgentAvatar';
import {
  agentApproveTask,
  agentConnect,
  agentCreateTask,
  agentDiscardTask,
  agentHome,
  type AgentEventDraft,
  type AgentHome,
  type AgentTask,
} from '../lib/linkyApi';

/**
 * One agent, one conversation. The member talks to Alex or Sarah like a
 * chief of staff: plain-language messages in, drafted work out. Every draft
 * lands in this thread as an approval card — nothing external happens until
 * the member taps Approve. Each message is one beta task execution.
 */
const YELLOW = '#FBE618';
const INK = '#0A0B0D';

function friendly(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message && message.length < 400 ? message : fallback;
}

type EditState = {
  to?: string;
  subject?: string;
  body?: string;
  title?: string;
  start?: string;
  end?: string;
  attendees?: string;
  description?: string;
};

const editOf = (task: AgentTask): EditState => {
  if (!task.draft) return {};
  if (task.kind === 'event') {
    const d = task.draft as AgentEventDraft;
    return {
      title: d.title || '',
      start: String(d.start || '').slice(0, 16),
      end: String(d.end || '').slice(0, 16),
      attendees: (d.attendees || []).join(', '),
      description: d.description || '',
    };
  }
  const d = task.draft as { to: string; subject: string; body: string };
  return { to: d.to || '', subject: d.subject || '', body: d.body || '' };
};

const whenText = (iso?: string) => {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return String(iso || '');
  return new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function AiAgentChatScreen({ navigation, route }: any) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const dark = theme === 'dark';
  const agentId = String(route?.params?.agentId || 'alex');
  const [home, setHome] = useState<AgentHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [message, setMessage] = useState('');
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const scrollRef = React.useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try {
      const data = await agentHome();
      setHome(data);
      setEdits((prev) => {
        const next = { ...prev };
        for (const task of data.tasks || []) {
          if (!next[task.id] && task.draft) next[task.id] = editOf(task);
        }
        return next;
      });
    } catch (error) {
      setNotice(friendly(error, 'Could not load this conversation. Try again in a moment.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (user?.uid) void load(); }, [load, user?.uid]);
  useFocusEffect(useCallback(() => { if (user?.uid) void load(); }, [load, user?.uid]));

  const agent = useMemo(
    () => (home?.agents || []).find((a) => a.id === agentId) || (home?.agents || [])[0] || null,
    [home, agentId],
  );
  const connection = agent?.provider === 'calendar' ? home?.calendar : home?.gmail;
  const providerLabel = agent?.provider === 'calendar' ? 'Google Calendar' : 'Gmail';
  const thread = useMemo(
    () => (home?.tasks || []).filter((t) => t.agent === (agent?.id || agentId)).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    [home, agent, agentId],
  );
  const usage = home?.usage || { limit: 5, usedToday: 0, remaining: 5 };

  const send = useCallback(async () => {
    const ask = message.trim();
    if (ask.length < 3 || busy || !agent) return;
    setBusy('send');
    setNotice('');
    try {
      await agentCreateTask(ask, agent.id);
      setMessage('');
      await load();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
    } catch (error) {
      setNotice(friendly(error, `${agent.name} could not take that just now. Try again in a minute.`));
    } finally {
      setBusy('');
    }
  }, [agent, busy, load, message]);

  const connect = useCallback(async () => {
    if (!agent) return;
    setBusy('connect');
    try {
      const result = await agentConnect(agent.provider === 'calendar' ? 'calendar' : 'gmail');
      if (result?.url) await Linking.openURL(result.url);
      else setNotice(`${providerLabel} connection is not switched on yet. ${agent.name} can still draft.`);

    } catch (error) {
      setNotice(friendly(error, `${providerLabel} connection is not switched on yet. ${agent.name} can still draft.`));
    } finally {
      setBusy('');
    }
  }, [agent, providerLabel]);

  const approve = useCallback(async (task: AgentTask) => {
    const edit = edits[task.id];
    if (!edit || !agent) return;
    setBusy(`approve-${task.id}`);
    setNotice('');
    try {
      const draft = task.kind === 'event'
        ? {
            title: edit.title || '',
            start: edit.start || '',
            end: edit.end || '',
            attendees: edit.attendees || '',
            description: edit.description || '',
            timeZone: (task.draft as AgentEventDraft)?.timeZone || 'UTC',
          }
        : { to: edit.to || '', subject: edit.subject || '', body: edit.body || '' };
      await agentApproveTask(task.id, draft);
      Alert.alert(
        task.kind === 'event' ? `On your calendar — ${agent.name}` : `Sent by ${agent.name}`,
        task.kind === 'event' ? 'The event is on your Google Calendar.' : 'That email is out via Gmail.',
      );
      await load();
    } catch (error) {
      setNotice(friendly(error, `${agent.name} could not finish that. Check the connection and try again.`));
      await load();
    } finally {
      setBusy('');
    }
  }, [agent, edits, load]);

  const discard = useCallback(async (task: AgentTask) => {
    setBusy(`discard-${task.id}`);
    try {
      await agentDiscardTask(task.id);
      await load();
    } finally {
      setBusy('');
    }
  }, [load]);

  const titleColor = dark ? '#FFFFFF' : INK;
  const bodyColor = dark ? '#C9CEDA' : '#3D434F';
  const faintColor = dark ? '#868D9E' : '#6F7685';
  const cardBg = dark ? '#16181D' : '#FFFFFF';
  const lineColor = dark ? '#262A32' : '#E4E7EC';
  const inputStyle = [styles.input, { backgroundColor: dark ? '#101318' : '#F6F7F9', color: titleColor, borderColor: lineColor }];

  if ((loading && !home) || !agent) {
    return (
      <View style={[styles.center, { backgroundColor: dark ? INK : '#F7F4E6' }]}>
        <ActivityIndicator color={INK} />
        <Text style={[styles.faint, { color: faintColor, marginTop: 10 }]}>Opening your conversation…</Text>
      </View>
    );
  }

  const suggestions = agent.provider === 'calendar'
    ? ['Schedule 30 minutes with sarah@example.com tomorrow at 10am about the launch plan', 'Put a 1-hour deep-work block on my calendar Friday at 9am']
    : ['Email sarah@example.com: follow up on yesterday\'s meeting and propose Tuesday 10am', 'Write a polite follow-up to sarah@example.com about the invoice we discussed'];

  return (
    <View style={{ flex: 1, backgroundColor: dark ? INK : '#F7F4E6' }}>
      <View style={[styles.header, { borderBottomColor: lineColor, backgroundColor: cardBg }]}>
        <TouchableOpacity accessibilityLabel="Back to workforce" onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <ArrowLeft size={21} color={titleColor} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerId}
          onPress={() => navigation.navigate('AiAgentProfile', { agentId: agent.id })}
          accessibilityLabel={`${agent.name} profile`}
          activeOpacity={0.8}
        >
          <AgentAvatar agentId={agent.id} name={agent.name} size={42} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.agentName, { color: titleColor }]}>{agent.name} · AI</Text>
            <Text style={[styles.faint, { color: faintColor }]} numberOfLines={1}>{agent.role} · {providerLabel}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity accessibilityLabel="Workforce settings" onPress={() => navigation.navigate('AiAgentsSettings')} style={styles.iconBtn}>
          <Settings2 size={20} color={titleColor} />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.thread}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => { if (thread.length) scrollRef.current?.scrollToEnd({ animated: false }); }}
      >
        {!!notice && (
          <View style={[styles.notice, { borderColor: dark ? '#3A2E00' : '#E5D76B', backgroundColor: dark ? '#221C00' : '#FFF8CC' }]}>
            <Text style={{ color: dark ? YELLOW : '#574800', fontSize: 13 }}>{notice}</Text>
          </View>
        )}

        {!connection?.connected && (
          <View style={[styles.banner, { backgroundColor: cardBg, borderColor: lineColor }]}>
            <Text style={[styles.body, { color: bodyColor }]}>
              {agent.name} can draft right now. Connect {providerLabel} so approved work actually lands{agent.provider === 'calendar' ? ' on your calendar' : ' in their inbox'}.
            </Text>
            <TouchableOpacity style={[styles.connectBtn, { backgroundColor: YELLOW }]} onPress={connect} disabled={busy === 'connect'}>
              {busy === 'connect' ? <ActivityIndicator color={INK} /> : <Text style={[styles.primaryText, { color: INK }]}>Connect {providerLabel}</Text>}
            </TouchableOpacity>
          </View>
        )}

        {thread.length === 0 ? (
          <View style={styles.empty}>
            <AgentAvatar agentId={agent.id} name={agent.name} size={92} />
            <Text style={[styles.emptyTitle, { color: titleColor }]}>Message {agent.name}</Text>
            <Text style={[styles.body, { color: bodyColor, textAlign: 'center' }]}>{agent.blurb}</Text>
            <View style={styles.chips}>
              {suggestions.map((text) => (
                <TouchableOpacity key={text} style={[styles.chip, { borderColor: lineColor, backgroundColor: cardBg }]} onPress={() => setMessage(text)}>
                  <Text style={[styles.chipText, { color: titleColor }]}>{text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : thread.map((task) => {
          const edit = edits[task.id] || editOf(task);
          const status = task.status || '';
          const set = (patch: Partial<EditState>) => setEdits((p) => ({ ...p, [task.id]: { ...(p[task.id] || edit), ...patch } }));
          return (
            <View key={task.id} style={styles.exchange}>
              <View style={styles.memberRow}>
                <View style={styles.memberBubble}>
                  <Text style={styles.memberText}>{task.instruction}</Text>
                </View>
              </View>

              <View style={styles.agentRow}>
                <AgentAvatar agentId={agent.id} name={agent.name} size={30} tick={false} />
                <View style={[styles.agentBubble, { backgroundColor: cardBg, borderColor: lineColor }]}>
                  {!!task.summary && <Text style={[styles.body, { color: bodyColor }]}>{task.summary}</Text>}
                  {status === 'unsupported' && !!task.reply && <Text style={[styles.body, { color: bodyColor }]}>{task.reply}</Text>}

                  {status === 'sending' && task.kind === 'email' && (
                    <View style={styles.draft}>
                      <Text style={[styles.draftTag, { color: '#8A6D00' }]}>DRAFT · SENDING</Text>
                      <View style={styles.actions}>
                        <ActivityIndicator color={INK} style={{ marginRight: 8 }} /><Text style={[styles.primaryText, { color: INK }]}>Sending email…</Text>
                      </View>
                    </View>
                  )}

                  {status === 'awaiting_approval' && task.kind === 'email' && (
                    <View style={styles.draft}>
                      <Text style={[styles.draftTag, { color: '#8A6D00' }]}>DRAFT · NEEDS YOUR APPROVAL</Text>
                      <TextInput value={edit.to} onChangeText={(v) => set({ to: v })} placeholder="Recipient email" placeholderTextColor={faintColor} style={inputStyle} autoCapitalize="none" />
                      <TextInput value={edit.subject} onChangeText={(v) => set({ subject: v })} placeholder="Subject" placeholderTextColor={faintColor} style={inputStyle} />
                      <TextInput value={edit.body} onChangeText={(v) => set({ body: v })} multiline style={[inputStyle, styles.draftBody]} />
                      {!!task.error && <Text style={styles.errorText}>{task.error === 'gmail_not_connected' ? `Connect ${providerLabel} above, then approve — sending needs it.` : task.error === 'bad_recipient' ? `That recipient isn't a valid email address.` : task.error === 'gmail_send_failed' ? `Gmail couldn't send that — try again.` : String(task.error)}</Text>}
                      <View style={styles.actions}>
                        <TouchableOpacity style={[styles.approve, { backgroundColor: YELLOW }]} onPress={() => approve(task)} disabled={busy === `approve-${task.id}`}>
                          {busy === `approve-${task.id}` ? <ActivityIndicator color={INK} /> : <Text style={[styles.primaryText, { color: INK }]}><Check size={14} color={INK} /> Approve &amp; send</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => discard(task)} disabled={busy === `discard-${task.id}`}>
                          <Text style={[styles.link, { color: faintColor }]}><X size={13} color={faintColor} /> Discard</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {status === 'sending' && task.kind === 'event' && (
                    <View style={styles.draft}>
                      <Text style={[styles.draftTag, { color: '#8A6D00' }]}>EVENT DRAFT · ADDING</Text>
                      <View style={styles.actions}>
                        <ActivityIndicator color={INK} style={{ marginRight: 8 }} /><Text style={[styles.primaryText, { color: INK }]}>Adding to calendar…</Text>
                      </View>
                    </View>
                  )}

                  {status === 'awaiting_approval' && task.kind === 'event' && (
                    <View style={styles.draft}>
                      <Text style={[styles.draftTag, { color: '#8A6D00' }]}>EVENT DRAFT · NEEDS YOUR APPROVAL</Text>
                      <TextInput value={edit.title} onChangeText={(v) => set({ title: v })} placeholder="Event title" placeholderTextColor={faintColor} style={inputStyle} />
                      <View style={styles.timeRow}>
                        <TextInput value={edit.start} onChangeText={(v) => set({ start: v })} placeholder="Start YYYY-MM-DDTHH:mm:ss" placeholderTextColor={faintColor} style={[inputStyle, { flex: 1 }]} autoCapitalize="none" />
                        <TextInput value={edit.end} onChangeText={(v) => set({ end: v })} placeholder="End YYYY-MM-DDTHH:mm:ss" placeholderTextColor={faintColor} style={[inputStyle, { flex: 1 }]} autoCapitalize="none" />
                      </View>
                      {!!(edit.start && edit.end) && <Text style={[styles.faint, { color: faintColor }]}>{whenText(edit.start)} → {whenText(edit.end)}</Text>}
                      <TextInput value={edit.attendees} onChangeText={(v) => set({ attendees: v })} placeholder="Attendees, comma-separated emails" placeholderTextColor={faintColor} style={inputStyle} autoCapitalize="none" />
                      <TextInput value={edit.description} onChangeText={(v) => set({ description: v })} placeholder="Description (optional)" placeholderTextColor={faintColor} multiline style={[inputStyle, styles.draftBody]} />
                      {!!task.error && <Text style={styles.errorText}>{task.error === 'calendar_not_connected' ? `Connect ${providerLabel} above, then approve — creating the event needs it.` : task.error === 'bad_time' ? `The start or end time looks wrong. Use YYYY-MM-DDTHH:mm:ss.` : task.error === 'calendar_create_failed' ? `Calendar couldn't create the event — check the times.` : String(task.error)}</Text>}
                      <View style={styles.actions}>
                        <TouchableOpacity style={[styles.approve, { backgroundColor: YELLOW }]} onPress={() => approve(task)} disabled={busy === `approve-${task.id}`}>
                          {busy === `approve-${task.id}` ? <ActivityIndicator color={INK} /> : <Text style={[styles.primaryText, { color: INK }]}><CalendarPlus size={14} color={INK} /> Approve &amp; add to calendar</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => discard(task)} disabled={busy === `discard-${task.id}`}>
                          <Text style={[styles.link, { color: faintColor }]}><X size={13} color={faintColor} /> Discard</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {status === 'sent' && (
                    <Text style={[styles.body, { color: '#1F7A3D' }]}>
                      {task.kind === 'event'
                        ? `On your Google Calendar: ${task.result?.title || 'event'} · ${whenText(task.result?.start)}`
                        : `Email sent ✓ to ${task.result?.to || 'recipient'} — Approved by you.`}
                    </Text>
                  )}
                  {status === 'discarded' && <Text style={[styles.faint, { color: faintColor }]}>Discarded — nothing was sent.</Text>}
                  {!!task.createdAt && (
                    <Text style={[styles.faint, { color: faintColor }]}>{new Date(task.createdAt).toLocaleString()} · ~{task.tokensEst || 0} tokens</Text>
                  )}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.composer, { borderTopColor: lineColor, backgroundColor: cardBg }]}>
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder={usage.remaining > 0 ? `Message ${agent.name}…` : 'No executions left today'}
          placeholderTextColor={faintColor}
          multiline
          maxLength={800}
          editable={usage.remaining > 0}
          style={[inputStyle, styles.composerInput]}
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: usage.remaining > 0 && message.trim().length >= 1 ? YELLOW : '#BDBDBD' }]}
          onPress={send}
          disabled={usage.remaining <= 0 || busy === 'send' || message.trim().length < 1}
          accessibilityLabel={`Send message to ${agent.name}`}
        >
          {busy === 'send' ? <ActivityIndicator color={INK} /> : <Send size={18} color={INK} />}
        </TouchableOpacity>
      </View>
      <Text style={[styles.quota, { color: faintColor, backgroundColor: cardBg }]}>
        {usage.remaining} of {usage.limit} beta executions left today · every message = 1 execution · {agent.name} is AI and never acts without your approval
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 1 },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerId: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  agentName: { fontSize: 15, fontWeight: '800' },
  thread: { padding: 16, paddingBottom: 20, gap: 18, maxWidth: 760, width: '100%', alignSelf: 'center' },
  notice: { borderWidth: 1, borderRadius: 12, padding: 12 },
  banner: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  connectBtn: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center' },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 26 },
  emptyTitle: { fontSize: 20, fontWeight: '800' },
  chips: { gap: 8, width: '100%', marginTop: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { fontSize: 13 },
  exchange: { gap: 8 },
  memberRow: { alignItems: 'flex-end' },
  memberBubble: { backgroundColor: INK, borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '85%' },
  memberText: { color: '#FFFFFF', fontSize: 14, lineHeight: 20 },
  agentRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  agentBubble: { flex: 1, borderWidth: 1, borderRadius: 18, borderTopLeftRadius: 6, padding: 12, gap: 8 },
  body: { fontSize: 14, lineHeight: 20 },
  faint: { fontSize: 12, lineHeight: 17 },
  draft: { gap: 8 },
  draftTag: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  draftBody: { minHeight: 96, textAlignVertical: 'top' },
  timeRow: { flexDirection: 'row', gap: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  approve: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 13, fontWeight: '800' },
  link: { fontSize: 13, fontWeight: '600' },
  errorText: { color: '#E02424', fontSize: 12 },
  composer: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', padding: 12, borderTopWidth: 1 },
  composerInput: { flex: 1, minHeight: 44, maxHeight: 120, textAlignVertical: 'top' },
  sendBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  quota: { fontSize: 11, textAlign: 'center', paddingHorizontal: 12, paddingBottom: 10 },
});
