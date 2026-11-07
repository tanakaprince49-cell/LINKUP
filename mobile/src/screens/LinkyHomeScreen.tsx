import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ArrowLeft, MessageCircle, Search, Send, Trash2, Users } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { appBackground, COLORS, RADIUS, textColor } from '../theme/theme';
import {
  linkyTeamChat,
  LinkyApiError,
  type LinkyChatTurn,
  type TeamMatchMember,
  type TeamMatchQuota,
  type TeamMatchTeam,
} from '../lib/linkyApi';
import PaywallModal from '../components/PaywallModal';
import MemberBadges from '../components/MemberBadges';
import LinkyCatIntro from '../components/LinkyCatIntro';
import { buildFacts, LINKY_VOICE } from '../lib/brandVoice';

/**
 * LINKY · TEAM CHAT
 *
 * This is a conversation, not a form. You text Linky like a friend who happens
 * to have the entire LINKUP member database open on a second screen: describe
 * the build, ask for the missing seat, and Linky searches every public profile
 * in the same turn and hands back an evidence-backed squad.
 *
 * The evidence rule still holds on this surface: Linky only ever names people
 * whose public profile actually supports the role, and says so plainly when
 * nobody clears the bar. Chatting can never manufacture a match.
 */

type ChatMessage = {
  id: string;
  role: 'user' | 'linky';
  text: string;
  at: number;
  teams?: TeamMatchTeam[];
  roles?: string[];
  checked?: number;
  noMatchReason?: string;
  failed?: boolean;
};

const STARTER_CHIPS = ['Find my teammates', 'What are you building?', 'I need a designer', 'Who can build my product?'];
const MAX_MESSAGES = 60;
const MAX_INPUT = 800;

const messageId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const storageKey = (uid?: string) => `linkup:linky-chat:v1:${uid || 'anon'}`;

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

export default function LinkyHomeScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const { profile } = useAuth();
  const uid = profile?.uid || '';

  const [introOpen, setIntroOpen] = useState(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [chips, setChips] = useState<string[]>(STARTER_CHIPS);
  const [quota, setQuota] = useState<TeamMatchQuota | null>(null);
  const [paywall, setPaywall] = useState('');
  const [lastIdea, setLastIdea] = useState('');
  const [checkedCount, setCheckedCount] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const hydrated = useRef(false);

  const palette = useMemo(() => ({
    surface: dark ? '#17232C' : '#FFFFFF',
    border: dark ? '#30414A' : '#E6E9E2',
    muted: textColor(dark, 'muted'),
    secondary: textColor(dark, 'secondary'),
    text: textColor(dark),
    field: dark ? '#101A21' : '#F7F8F4',
    linkyBubble: dark ? '#1E2A24' : '#F4F6EA',
    chip: dark ? '#1D2830' : '#F0EFE8',
  }), [dark]);

  const firstName = useMemo(() => {
    const raw = String(profile?.displayName || '').trim().split(/\s+/)[0] || '';
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : '';
  }, [profile?.displayName]);

  // What Linky already knows before the member types a single character: their
  // name, their build, and the chair they cannot fill. Onboarding captured all
  // of it, so the thread never opens with "so, what are you working on?".
  const facts = useMemo(() => buildFacts(profile as any), [profile]);

  // The chips are the member's own brief read back to them.
  useEffect(() => {
    setChips((current) => {
      const generic = !current.length || current === STARTER_CHIPS || current.every((chip) => STARTER_CHIPS.includes(chip));
      return generic ? LINKY_VOICE.chips(facts) : current;
    });
  }, [facts]);

  // The thread survives app restarts; the server keeps the same cap so a
  // reinstall never resurrects a conversation the member cleared.
  useEffect(() => {
    let active = true;
    (async () => {
      const raw = await AsyncStorage.getItem(storageKey(uid)).catch(() => null);
      if (!active) return;
      let restored: ChatMessage[] = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) restored = parsed.filter((item: ChatMessage) => item?.text);
        } catch {
          restored = [];
        }
      }
      setMessages(restored.length ? restored.slice(-MAX_MESSAGES) : [{ id: messageId(), role: 'linky', text: LINKY_VOICE.greeting(facts), at: Date.now() }]);
      hydrated.current = true;
    })();
    return () => { active = false; };
  }, [uid, facts]);

  useEffect(() => {
    if (!hydrated.current) return;
    void AsyncStorage.setItem(storageKey(uid), JSON.stringify(messages.slice(-MAX_MESSAGES))).catch(() => {});
  }, [messages, uid]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => { scrollToEnd(); }, [messages.length, busy, scrollToEnd]);

  const send = useCallback(async (
    rawText?: string,
    extra?: { search?: boolean; mode?: 'find' | 'assign'; memberUids?: string[]; idea?: string },
  ) => {
    if (busy) return;
    const typed = String(rawText ?? draft).trim().slice(0, MAX_INPUT);
    const manual = !!extra?.search;
    if (!typed && !manual) return;
    const outgoing = typed || 'Search the whole LINKUP database for my team.';
    setDraft('');
    const userMessage: ChatMessage = { id: messageId(), role: 'user', text: outgoing, at: Date.now() };
    const history: LinkyChatTurn[] = messages.slice(-10).map((item) => ({ role: item.role, text: item.text }));
    setMessages((prev) => [...prev, userMessage]);
    setBusy(true);
    setPaywall('');
    try {
      const out = await linkyTeamChat({
        message: typed,
        history,
        search: manual,
        mode: extra?.mode,
        memberUids: extra?.memberUids,
        // Only an explicit search reuses the brief Linky already has; a typed
        // message is its own brief, so a stale idea can never hijack it.
        idea: extra?.idea || '',
      });
      if (out.messageQuota) setQuota(out.messageQuota);
      if (out.idea) setLastIdea(out.idea);
      if (typeof out.checked === 'number' && out.checked > 0) setCheckedCount(out.checked);
      setChips(out.suggestions?.length ? out.suggestions.slice(0, 4) : LINKY_VOICE.chips(facts));
      setMessages((prev) => [...prev, {
        id: messageId(),
        role: 'linky',
        text: out.reply || 'I am here — tell me what you are building.',
        at: Date.now(),
        teams: out.teams || [],
        roles: out.roles || [],
        checked: out.checked || 0,
        noMatchReason: out.noMatchReason || '',
      }]);
    } catch (err) {
      if (err instanceof LinkyApiError && err.status === 402) {
        setPaywall(err.message);
        if (err.messageQuota) setQuota(err.messageQuota);
        setMessages((prev) => [...prev, {
          id: messageId(),
          role: 'linky',
          text: `That is today’s free messages used up — my ledger is strict about it. I am still holding your brief on ${facts.projectName || 'your build'}; LINKUP PLUS keeps me searching all day.`,
          at: Date.now(),
          failed: true,
        }]);
      } else {
        setMessages((prev) => [...prev, {
          id: messageId(),
          role: 'linky',
          text: err instanceof Error ? err.message : 'That search hit a snag. Say it again and I will rerun it.',
          at: Date.now(),
          failed: true,
        }]);
      }
    } finally {
      setBusy(false);
      scrollToEnd();
    }
  }, [busy, draft, lastIdea, messages, scrollToEnd]);

  const onChip = useCallback((chip: string) => {
    if (busy) return;
    if (/^(find teammates|find my teammates)$/i.test(chip)) {
      // The brief is already in Linky's hands — profile build, empty seat,
      // stakes — so this is one tap to the hunt, not another questionnaire.
      void send(
        `Go. Find the teammates ${facts.projectName || 'my build'} is still missing${
          facts.seat ? ` — the ${facts.seat} seat` : ''
        }.`,
        { search: true, idea: lastIdea || facts.oneLiner },
      );
      return;
    }
    void send(chip);
  }, [busy, facts, lastIdea, send]);

  const clearChat = useCallback(async () => {
    if (busy) return;
    setMessages([{ id: messageId(), role: 'linky', text: LINKY_VOICE.greeting(facts), at: Date.now() }]);
    setChips(LINKY_VOICE.chips(facts));
    setLastIdea('');
    setCheckedCount(0);
    await AsyncStorage.removeItem(storageKey(uid)).catch(() => {});
    void linkyTeamChat({ clear: true }).catch(() => {});
  }, [busy, facts, uid]);

  const memberRow = (member: TeamMatchMember, index: number) => (
    <View key={`${member.uid}-${index}`} style={[styles.member, { borderColor: palette.border, backgroundColor: palette.surface }]}>
      {member.image
        ? <Image source={{ uri: member.image }} style={styles.avatar} />
        : <View style={[styles.avatar, styles.initials]}><Text style={styles.initialsText}>{initialsOf(member.name || '?')}</Text></View>}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.memberNameRow}>
          <Text style={[styles.memberName, { color: palette.text }]}>{member.name}</Text>
          <MemberBadges userId={member.uid} verified={member.verified} size={14} />
        </View>
        {!!member.title && <Text style={[styles.memberMeta, { color: palette.secondary }]}>{[member.title, member.company].filter(Boolean).join(' · ')}</Text>}
        {!!member.city && <Text style={[styles.memberMeta, { color: palette.muted }]}>{member.city}</Text>}
        <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{member.recommendedRole}</Text></View>
        {!!member.why && <Text style={[styles.reason, { color: palette.text }]}>{member.why}</Text>}
        {!!member.unknowns?.length && <Text style={[styles.memberMeta, { color: palette.muted }]}>Still to verify: {member.unknowns.slice(0, 2).join(' · ')}</Text>}
        <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate('Profile', { userId: member.uid })} style={styles.profileLink}>
          <Text style={[styles.profileLinkText, { color: dark ? '#9ED8FF' : '#075EA8' }]}>View profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const teamBlock = (team: TeamMatchTeam, messageId: string) => (
    <View key={`${messageId}-${team.id}`} style={[styles.team, { borderColor: palette.border, backgroundColor: dark ? '#131C23' : '#FBFBF6' }]}>
      <View style={styles.teamHeading}>
        <View style={styles.teamHeadingLeft}>
          <Users size={14} color={palette.secondary} />
          <Text style={[styles.teamTitle, { color: palette.text }]}>Squad found</Text>
        </View>
        <Text style={styles.fitPill}>{team.score}% fit</Text>
      </View>
      {team.members.map(memberRow)}
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => void send('Put these three on the team and give each one a role.', { mode: 'assign', memberUids: team.members.map((member) => member.uid), idea: lastIdea })}
        disabled={busy}
        style={[styles.secondaryButton, { borderColor: palette.border, opacity: busy ? 0.5 : 1 }]}
      >
        <Text style={{ color: palette.text, fontWeight: '800', fontSize: 13 }}>Assign roles to this team</Text>
      </TouchableOpacity>
    </View>
  );

  const linkyBubble = (message: ChatMessage) => (
    <View key={message.id} style={styles.linkyRow}>
      <View style={styles.linkyAvatar}>
        <MessageCircle size={15} color={COLORS.inkButtonText} />
      </View>
      <View style={styles.linkyColumn}>
        <View style={[styles.linkyBubble, { backgroundColor: palette.linkyBubble, borderColor: palette.border }, message.failed && styles.failedBubble]}>
          <Text style={[styles.linkyText, { color: palette.text }]}>{message.text}</Text>
          {!!message.roles?.length && (
            <Text style={[styles.searchMeta, { color: palette.muted }]}>Searching roles: {message.roles.join(' · ')}</Text>
          )}
          {!!message.checked && (
            <Text style={[styles.searchMeta, { color: palette.muted }]}>Checked {message.checked} public LINKUP profiles · every name is backed by profile evidence</Text>
          )}
        </View>
        {!!message.teams?.length && message.teams.map((team) => teamBlock(team, message.id))}
      </View>
    </View>
  );

  const userBubble = (message: ChatMessage) => (
    <View key={message.id} style={styles.userRow}>
      <View style={[styles.userBubble, { backgroundColor: COLORS.inkButton }]}>
        <Text style={[styles.userText, { color: COLORS.inkButtonText }]}>{message.text}</Text>
      </View>
    </View>
  );

  const quotaLine = quota
    ? quota.unlimited
      ? 'PLUS · unlimited messages and searches'
      : `${quota.remaining ?? 0} free message${quota.remaining === 1 ? '' : 's'} left today · resets at midnight UTC`
    : LINKY_VOICE.quotaFallback;

  return (
    <View style={[styles.root, appBackground(dark), { paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to LINKUP" onPress={() => navigation.navigate('Dashboard')} style={styles.headerButton}>
          <ArrowLeft size={21} color={palette.text} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: palette.text }]}>Linky · Team chat</Text>
            <View style={styles.liveDot} />
          </View>
          <Text style={[styles.subtitle, { color: palette.muted }]} numberOfLines={1}>
            {checkedCount > 0
              ? `${checkedCount} public builders searched · still holding your brief`
              : facts.projectName
                ? `${facts.projectName} · ${facts.seat} still missing`
                : 'The cat with your whole build in its head'}
          </Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear this conversation" onPress={() => void clearChat()} style={styles.headerButton}>
          <Trash2 size={18} color={palette.muted} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={insets.top + 8}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.thread}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToEnd}
        >
          {messages.map((message) => (message.role === 'user' ? userBubble(message) : linkyBubble(message)))}
          {busy && (
            <View style={styles.linkyRow}>
              <View style={styles.linkyAvatar}><MessageCircle size={15} color={COLORS.inkButtonText} /></View>
              <View style={[styles.linkyBubble, { backgroundColor: palette.linkyBubble, borderColor: palette.border, flexDirection: 'row', alignItems: 'center', gap: 9 }]}>
                <ActivityIndicator size="small" color={palette.secondary} />
                <Text style={[styles.linkyText, { color: palette.secondary }]}>{LINKY_VOICE.working}</Text>
              </View>
            </View>
          )}
          <Text style={[styles.disclaimer, { color: palette.muted }]}>
            {LINKY_VOICE.disclaimer}
          </Text>
        </ScrollView>

        <View style={[styles.composerWrap, { borderTopColor: palette.border, backgroundColor: dark ? '#0D1519' : '#FBFAF5', paddingBottom: Math.max(insets.bottom, 10) }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
            <TouchableOpacity accessibilityRole="button" onPress={() => onChip('Find my teammates')} disabled={busy} style={[styles.searchChip, busy && { opacity: 0.5 }]}>
              <Search size={13} color={COLORS.inkButtonText} />
              <Text style={styles.searchChipText}>{facts.seat ? `Find my ${facts.seat}` : 'Find my teammates'}</Text>
            </TouchableOpacity>
            {chips.map((chip) => (
              <TouchableOpacity key={chip} accessibilityRole="button" onPress={() => onChip(chip)} disabled={busy} style={[styles.chip, { backgroundColor: palette.chip, borderColor: palette.border, opacity: busy ? 0.5 : 1 }]}>
                <Text style={[styles.chipText, { color: palette.text }]} numberOfLines={1}>{chip}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={[styles.composer, { borderColor: palette.border, backgroundColor: palette.field }]}>
            <TextInput
              accessibilityLabel="Message Linky"
              value={draft}
              onChangeText={setDraft}
              placeholder={LINKY_VOICE.placeholder(facts)}
              placeholderTextColor={palette.muted}
              maxLength={MAX_INPUT}
              multiline
              style={[styles.input, { color: palette.text }]}
              onSubmitEditing={() => void send()}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Send to Linky"
              accessibilityState={{ disabled: busy || !draft.trim() }}
              disabled={busy || !draft.trim()}
              onPress={() => void send()}
              style={[styles.sendButton, { backgroundColor: COLORS.inkButton, opacity: busy || !draft.trim() ? 0.4 : 1 }]}
            >
              {busy ? <ActivityIndicator size="small" color={COLORS.inkButtonText} /> : <Send size={17} color={COLORS.inkButtonText} />}
            </TouchableOpacity>
          </View>
          <Text style={[styles.quotaLine, { color: palette.muted }]} numberOfLines={2}>{quotaLine}</Text>
        </View>
      </KeyboardAvoidingView>

      <LinkyCatIntro profile={profile as any} visible={introOpen} onDone={() => setIntroOpen(false)} />

      <PaywallModal
        visible={!!paywall}
        onClose={() => setPaywall('')}
        feature="Linky team chat"
        description={paywall || 'Upgrade to keep chatting with Linky and searching the LINKUP database.'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 62, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1 },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { fontSize: 18, fontWeight: '900' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.success },
  subtitle: { marginTop: 2, fontSize: 11.5, fontWeight: '600' },
  thread: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 18, gap: 10 },
  linkyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  linkyAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.inkButton, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  linkyColumn: { flex: 1, gap: 9 },
  linkyBubble: { borderWidth: 1, borderRadius: RADIUS.md, borderTopLeftRadius: 5, paddingHorizontal: 13, paddingVertical: 11, alignSelf: 'flex-start', maxWidth: '100%' },
  failedBubble: { borderColor: '#E9B4B8' },
  linkyText: { fontSize: 14, lineHeight: 21, fontWeight: '600' },
  searchMeta: { marginTop: 7, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  userRow: { alignItems: 'flex-end' },
  userBubble: { borderRadius: RADIUS.md, borderTopRightRadius: 5, paddingHorizontal: 13, paddingVertical: 10, maxWidth: '86%' },
  userText: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  team: { borderWidth: 1, borderRadius: RADIUS.lg, padding: 12, gap: 9 },
  teamHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  teamHeadingLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  teamTitle: { fontSize: 13, fontWeight: '900' },
  fitPill: { backgroundColor: '#E8F3E5', color: '#214B2A', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '900', overflow: 'hidden' },
  member: { borderWidth: 1, borderRadius: RADIUS.md, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#273642' },
  initials: { alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: COLORS.inkButtonText, fontWeight: '900', fontSize: 15 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  memberName: { fontSize: 14, fontWeight: '900' },
  memberMeta: { fontSize: 11.5, lineHeight: 16 },
  roleBadge: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9, backgroundColor: COLORS.inkButton, marginTop: 2 },
  roleBadgeText: { color: COLORS.inkButtonText, fontSize: 11, fontWeight: '900' },
  reason: { fontSize: 12, lineHeight: 18, marginTop: 1 },
  profileLink: { alignSelf: 'flex-start', paddingVertical: 3 },
  profileLinkText: { fontWeight: '800', fontSize: 12 },
  secondaryButton: { minHeight: 40, borderWidth: 1, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  disclaimer: { textAlign: 'center', fontSize: 10.5, lineHeight: 16, paddingHorizontal: 8, marginTop: 6 },
  composerWrap: { borderTopWidth: 1, paddingHorizontal: 12, paddingTop: 8, gap: 7 },
  chipRow: { gap: 7, paddingRight: 4 },
  searchChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: COLORS.inkButton },
  searchChipText: { color: COLORS.inkButtonText, fontSize: 12, fontWeight: '900' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, maxWidth: 230 },
  chipText: { fontSize: 12, fontWeight: '700' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderWidth: 1, borderRadius: RADIUS.lg, paddingHorizontal: 10, paddingVertical: 7 },
  input: { flex: 1, fontSize: 14, lineHeight: 20, maxHeight: 118, paddingTop: Platform.OS === 'web' ? 8 : 6, paddingBottom: 6 },
  sendButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  quotaLine: { textAlign: 'center', fontSize: 10.5, lineHeight: 15, fontWeight: '600' },
});
