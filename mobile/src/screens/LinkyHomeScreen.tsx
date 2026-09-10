// Linky tab — replaces the swipe deck.
//
// Ask Linky who you need and he answers in the same request with the people
// on LINKUP he can cite a reason for (Meet / Skip / Save), or says plainly
// that nobody fits yet. Intro requests waiting on you sit at the top
// (Accept / Decline / Not now). Everything goes through /api/linky; the app
// never writes the intro collections itself.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Link2, ArrowUp, Check, Clock, Compass, Send, Settings2, ShieldCheck, Trophy, X, Zap } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
import PaywallModal from '../components/PaywallModal';
import { SponsoredSlot } from '../components/SponsoredCard';
import { isSponsoredHiddenForViewer } from '../lib/campaigns';
import {
  LinkyApiError,
  LinkyAsk,
  LinkyCard,
  LinkyHome,
  LinkyIntro,
  LinkyLead,
  LinkyDraft,
  LinkyAskResult,
  LinkyTurn,
  LinkyBadge,
  LinkyLoopChoice,
  linkyAsk,
  linkyLoopAnswer,
  linkyMeetSquad,
  linkyApproveSquad,
  linkyCancelSquad,
  linkyCard,
  linkyHome,
  linkyApproveLead,
  linkyApproveMeet,
  linkyCancelMeet,
  linkyDraftLead,
  linkyMarkLead,
  linkyMeet,
  linkyPickPerson,
  linkyRespond,
} from '../lib/linkyApi';

// Cosmetic only - the server answers when it answers. This just keeps the
// bubble alive with a different line every couple of seconds while it works.
const THINKING_LINES = ['Linky is reading profiles…', 'Checking who this could be…', 'Almost - comparing two or three…'];

// Live countdown to the moment today's daily Linky budget resets (the server
// hands back `asksResetAt` as an ISO instant; dayKey is UTC, so it is the next
// UTC midnight). Formats as "5h 12m 03s" -> "12m 03s" -> "3s".
const formatCountdown = (resetAtIso?: string, now = Date.now()) => {
  if (!resetAtIso) return '';
  const diff = Math.max(0, Date.parse(resetAtIso) - now);
  if (diff <= 0) return '';
  const total = Math.floor(diff / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}h ${m}m ${pad(s)}s` : m > 0 ? `${m}m ${pad(s)}s` : `${s}s`;
};

const FALLBACK_AVATAR = 'https://ui-avatars.com/api/?name=U&background=DFFB3F&color=000&size=80';

const Avatar = ({ uri, size = 44 }: { uri?: string; size?: number }) => (
  <Image source={{ uri: uri || FALLBACK_AVATAR }} style={{ width: size, height: size, borderRadius: size / 3.2, backgroundColor: '#E0E0E0' }} />
);

const SectionTitle = ({ title, hint, isDark }: { title: string; hint?: string; isDark: boolean }) => (
  <View style={styles.sectionHead}>
    <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>{title}</Text>
    {hint ? <Text style={[styles.sectionHint, { color: textColor(isDark, 'muted') }]}>{hint}</Text> : null}
  </View>
);

const CardView = ({
  card, isDark, busy, onMeet, onSkip, onSave, onOpen,
}: { card: LinkyCard; isDark: boolean; busy: boolean; onMeet: () => void; onSkip: () => void; onSave: () => void; onOpen: () => void }) => {
  const surface = isDark ? COLORS.darkBgSec : '#FFFFFF';
  const border = isDark ? COLORS.darkBorder : COLORS.lightBorder;
  const requested = card.status === 'meet';
  const declined = card.status === 'declined';
  return (
    <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
      <TouchableOpacity style={styles.cardTop} onPress={onOpen} activeOpacity={0.75}>
        <Avatar uri={card.targetPic} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardName, { color: textColor(isDark) }]} numberOfLines={1}>{card.targetName}</Text>
          {card.targetRole || card.targetCompany ? (
            <Text style={[styles.cardRole, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>
              {[card.targetRole, card.targetCompany].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          {card.targetCity ? <Text style={[styles.cardMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>{card.targetCity}</Text> : null}
        </View>
        {card.status === 'saved' ? <Text style={[styles.pill, { color: textColor(isDark, 'muted'), borderColor: border }]}>Saved</Text> : null}
      </TouchableOpacity>
      {card.squadId && card.squadRole ? (
        <View style={styles.squadRow}>
          <Compass size={12} color={COLORS.primaryStrong} />
          <Text style={[styles.squadText, { color: textColor(isDark, 'secondary') }]}>
            {`Squad${(card.squadSize || 0) > 1 ? ` of ${card.squadSize}` : ''} - ${card.squadRole}`}
          </Text>
        </View>
      ) : null}
      {card.plus ? (
        <View style={styles.squadRow}>
          <Zap size={12} color={COLORS.primaryStrong} />
          <Text style={[styles.plusText, { color: textColor(isDark, 'secondary') }]}>PLUS member</Text>
        </View>
      ) : null}
      {card.badges && card.badges.length ? (
        <View style={styles.badgeRow}>
          {card.badges.slice(0, 3).map((b) => (
            <TouchableOpacity
              key={`${b.kind}-${b.label}`}
              style={[styles.badge, { backgroundColor: isDark ? 'rgba(223,251,63,0.10)' : 'rgba(223,251,63,0.22)', borderColor: border }]}
              onPress={() => { if (b.url) Linking.openURL(b.url).catch(() => {}); }}
              disabled={!b.url}
              activeOpacity={0.8}
            >
              <Trophy size={11} color={textColor(isDark, 'secondary')} />
              <Text style={[styles.badgeText, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>
                {b.label}{b.checked ? '' : ' (their words)'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {card.pairNote ? (
        <Text style={[styles.pairNote, { color: textColor(isDark, 'muted') }]} numberOfLines={2}>{card.pairNote}</Text>
      ) : null}
      <View style={[styles.whyBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
        <Text style={[styles.whyLabel, { color: textColor(isDark, 'muted') }]}>WHY LINKY PICKED THEM</Text>
        <Text style={[styles.whyText, { color: textColor(isDark) }]}>{card.why}</Text>
        <Text style={[styles.forText, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>For: {card.need}</Text>
      </View>
      {requested ? (
        <View style={styles.stateRow}>
          <Clock size={13} color={textColor(isDark, 'muted')} />
          <Text style={[styles.stateText, { color: textColor(isDark, 'muted') }]}>Asked. Linky will tell you when they answer.</Text>
        </View>
      ) : declined ? (
        <View style={styles.stateRow}>
          <X size={13} color={textColor(isDark, 'muted')} />
          <Text style={[styles.stateText, { color: textColor(isDark, 'muted') }]}>Not this time.</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.ghostBtn, { borderColor: border }]} onPress={onSkip} disabled={busy}>
            <Text style={[styles.ghostBtnText, { color: textColor(isDark, 'secondary') }]}>Skip</Text>
          </TouchableOpacity>
          {card.status !== 'saved' ? (
            <TouchableOpacity style={[styles.ghostBtn, { borderColor: border }]} onPress={onSave} disabled={busy}>
              <Text style={[styles.ghostBtnText, { color: textColor(isDark, 'secondary') }]}>Save</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.primary, borderColor: isDark ? 'transparent' : 'rgba(0,0,0,0.12)' }]} onPress={onMeet} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator size="small" color="#000" /> : (
              <>
                <Send size={13} color="#000" />
                <Text style={styles.primaryBtnText}>Meet</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const InboundView = ({
  intro, isDark, busy, onDecision, onOpen,
}: { intro: LinkyIntro; isDark: boolean; busy: boolean; onDecision: (d: 'accept' | 'decline' | 'later') => void; onOpen: () => void }) => {
  const surface = isDark ? COLORS.darkBgSec : '#FFFFFF';
  const border = isDark ? COLORS.darkBorder : COLORS.lightBorder;
  return (
    <View style={[styles.card, { backgroundColor: surface, borderColor: COLORS.primaryStrong === '#0A0B0D' ? border : COLORS.primaryStrong }]}>
      <TouchableOpacity style={styles.cardTop} onPress={onOpen} activeOpacity={0.75}>
        <Avatar uri={intro.requesterPic} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardName, { color: textColor(isDark) }]} numberOfLines={1}>{intro.requesterName}</Text>
          <Text style={[styles.cardRole, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>
            {[intro.requesterRole, intro.requesterCity].filter(Boolean).join(' · ') || 'wants to meet you'}
          </Text>
        </View>
      </TouchableOpacity>
      <View style={[styles.whyBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
        <Text style={[styles.whyLabel, { color: textColor(isDark, 'muted') }]}>THEY NEED</Text>
        <Text style={[styles.whyText, { color: textColor(isDark) }]}>{intro.need}</Text>
        <Text style={[styles.whyLabel, { color: textColor(isDark, 'muted'), marginTop: 8 }]}>WHY YOU</Text>
        <Text style={[styles.whyText, { color: textColor(isDark) }]}>{intro.why}</Text>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.ghostBtn, { borderColor: border }]} onPress={() => onDecision('decline')} disabled={busy}>
          <Text style={[styles.ghostBtnText, { color: textColor(isDark, 'secondary') }]}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.ghostBtn, { borderColor: border }]} onPress={() => onDecision('later')} disabled={busy}>
          <Text style={[styles.ghostBtnText, { color: textColor(isDark, 'secondary') }]}>Not now</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.primary, borderColor: isDark ? 'transparent' : 'rgba(0,0,0,0.12)' }]} onPress={() => onDecision('accept')} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator size="small" color="#000" /> : (
            <>
              <Check size={13} color="#000" />
              <Text style={styles.primaryBtnText}>Accept</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default function LinkyHomeScreen({ navigation }: any) {
  const { theme } = useTheme();
  const { user, profile } = useAuth();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const [home, setHome] = useState<LinkyHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [pendingAsk, setPendingAsk] = useState('');
  // the chips and the lead list only ever arrive on an ask result, so the state
  // is the richer type; a lastAsk restored from home gets an empty shell around it
  const [answer, setAnswer] = useState<LinkyAskResult | null>(null);
  const [pointerText, setPointerText] = useState('');
  // The approval step: Linky writes it, the member sends it. `draft` is that
  // editable bubble - for a member's intro and for an off-network lead alike.
  const [draft, setDraft] = useState<{
    kind: 'meet' | 'lead' | 'squad'; cardId?: string; leadKey?: string; title: string; body: string; note?: string; url?: string; index?: number;
  } | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [leadBusy, setLeadBusy] = useState('');
  const [pointerRoutes, setPointerRoutes] = useState<string[]>([]);
  const [pointerMeta, setPointerMeta] = useState({ searches: 0, skipped: 0, cached: false, place: '' });
  const [leads, setLeads] = useState<LinkyLead[]>([]);
  const [pickedBusy, setPickedBusy] = useState('');
  const [paywall, setPaywall] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [thinkingTick, setThinkingTick] = useState(0);
  useEffect(() => {
    if (!thinking) return;
    const t = setInterval(() => setThinkingTick((x) => x + 1), 2200);
    return () => clearInterval(t);
  }, [thinking]);

  // One-second tick so the daily-limit countdown actually counts down on
  // screen instead of sitting frozen at the value it rendered with. Gated on
  // focus so a background tab is not re-rendering every second.
  const isFocused = useIsFocused();
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!isFocused) return;
    setNowTick(Date.now());
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isFocused]);

  // Derived: how many free asks are left today and, once it is zero, how long
  // until the budget refreshes. PLUS never sees this (no counter, no cap).
  const asksUsed = home?.limits?.asksUsedToday ?? 0;
  const asksPerDay = home?.limits?.asksPerDay ?? 0;
  const asksLeft = Math.max(0, asksPerDay - asksUsed);
  const resetCountdown = formatCountdown(home?.limits?.asksResetAt, nowTick);
  const atDailyLimit = !!home && !home.plus && asksPerDay > 0 && asksLeft <= 0;
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async (silent = false) => {
    if (!user?.uid) return;
    if (!silent) setLoading(true);
    try {
      const h = await linkyHome();
      if (!mounted.current) return;
      setHome(h);
      setError('');
      // a lastAsk restored from home carries no ask budget of its own; the home
      // payload's limits are the same numbers, so derive it rather than fake it
      setAnswer((a) => a || (h.lastAsk
        ? { ...h.lastAsk, cards: [], cached: false, asksLeft: Math.max(0, h.limits.asksPerDay - h.limits.asksUsedToday) }
        : null));
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Linky is unavailable right now.');
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, [user?.uid]);

  useFocusEffect(useCallback(() => { load(true); }, [load]));
  useEffect(() => { load(); }, [load]);

  const fail = (err: unknown, fallbackTitle: string) => {
    if (err instanceof LinkyApiError && err.status === 402) {
      setPaywall(err.message);
      return;
    }
    notifyUser(fallbackTitle, err instanceof Error ? err.message : 'Please try again.');
  };

  const onLoop = async (choice: LinkyLoopChoice) => {
    setBusyId('loop');
    try {
      const r = await linkyLoopAnswer(choice);
      setHome((h) => (h ? { ...h, loop: null } : h));
      notifyUser('Answered', r.note);
    } catch (e: any) {
      notifyUser('Linky', e?.message || 'That did not go through.');
    } finally {
      setBusyId('');
    }
  };

  const onMeetSquad = async (squadId: string) => {
    setBusyId(squadId);
    try {
      const r = await linkyMeetSquad(squadId);
      if (r.needsApproval) {
        setDraft({
          kind: 'squad',
          cardId: squadId,
          title: `To ${(r.members || []).map((x) => x.name).filter(Boolean).join(', ')}`,
          body: r.pitch || '',
          note: r.note,
          url: '',
        });
        return;
      }
      notifyUser('Asked', `Linky asked all of them. Each one answers for themselves.`);
    } catch (e: any) {
      notifyUser('Linky', e?.message || 'That did not go through.');
    } finally {
      setBusyId('');
    }
  };

  const onMeet = async (card: LinkyCard) => {
    if (busyId) return;
    setBusyId(card.id);
    try {
      const r = await linkyMeet(card.id);
      if (r.matchId) {
        navigation.navigate('Chat', { matchId: r.matchId, otherUser: { uid: card.targetUid, displayName: card.targetName, profilePic: card.targetPic }, draftMessage: r.opener || card.opener || '' });
      } else if (r.needsApproval) {
        setDraft({ kind: 'meet', cardId: card.id, title: `To ${r.targetName || card.targetName}`, body: r.pitch || r.opener || '', note: r.note, url: '' });
      } else {
        notifyUser('Asked', `Linky asked ${card.targetName}. You will hear back here${r.meetsLeft != null ? ` (${r.meetsLeft} Meets left today).` : '.'}`);
      }
      await load(true);
    } catch (err) {
      fail(err, 'Could not ask');
    } finally {
      setBusyId(null);
    }
  };

  const onCardStatus = async (card: LinkyCard, status: 'skip' | 'saved') => {
    if (busyId) return;
    setBusyId(card.id);
    try {
      await linkyCard(card.id, status);
      setHome((h) => h ? { ...h, cards: status === 'skip' ? h.cards.filter((c) => c.id !== card.id) : h.cards.map((c) => (c.id === card.id ? { ...c, status } : c)) } : h);
    } catch (err) {
      fail(err, 'Could not update card');
    } finally {
      setBusyId(null);
    }
  };

  const onDecision = async (intro: LinkyIntro, decision: 'accept' | 'decline' | 'later') => {
    if (busyId) return;
    setBusyId(intro.id);
    try {
      const r = await linkyRespond(intro.id, decision);
      if (r.status === 'accepted' && r.matchId) {
        navigation.navigate('Chat', { matchId: r.matchId, otherUser: { uid: intro.requesterId, displayName: intro.requesterName, profilePic: intro.requesterPic } });
      }
      await load(true);
    } catch (err) {
      fail(err, 'Could not answer');
    } finally {
      setBusyId(null);
    }
  };

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || thinking) return;
    setInput('');
    setPendingAsk(msg);
    setThinking(true);
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 60);
    try {
      const out = await linkyAsk(msg);
      setAnswer(out);
      setPointerText('');
      setLeads([]);
      setPointerRoutes([]);
      // "yes, look outside LINKUP" -> the LinkedIn leads arrive on the ask
      // itself, so render them the same way the old button did.
      if (out.leads && out.leads.length) {
        setPointerText(out.pointerIntro || out.reply || '');
        setPointerRoutes(Array.isArray(out.routes) ? out.routes : []);
        setLeads(out.leads);
        setPointerMeta({ searches: Number(out.searches || 0), skipped: Number(out.skipped || 0), cached: !!out.cached, place: out.place || '' });
      }
      if (out.thread) setHome((h) => (h ? { ...h, thread: out.thread } : h));
      setHome((h) => {
        if (!h) return h;
        const byId = new Map(out.cards.map((c) => [c.id, c]));
        const merged = h.cards.map((c) => byId.get(c.id) || c);
        out.cards.forEach((c) => { if (!merged.some((m) => m.id === c.id)) merged.push(c); });
        return { ...h, cards: merged, lastAsk: out, limits: { ...h.limits, asksUsedToday: Math.max(h.limits.asksUsedToday, h.limits.asksPerDay - out.asksLeft) } };
      });
    } catch (err) {
      if (err instanceof LinkyApiError && err.status === 402) setPaywall(err.message);
      else notifyUser('Linky could not answer', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setThinking(false);
      setPendingAsk('');
    }
  };

  // A draft left half-finished (on Telegram, or by a previous visit) is still the
  // most important thing on this screen, so it gets a line of its own.
  const openPending = () => {
    const p = home?.pending?.meet;
    if (p?.cardId) {
      setDraft({
        kind: 'meet', cardId: p.cardId, title: `To ${p.targetName || 'them'}`,
        body: p.pitch || p.opener || '',
        note: 'Nothing has been sent yet - this reaches them only when you press send. Edit it freely; it is your voice, not mine.',
      });
      return;
    }
    const l = home?.pending?.lead;
    if (l?.key) {
      setDraft({
        kind: 'lead', leadKey: l.key, title: `To ${l.lead?.name || 'them'}`, body: l.text || '', url: l.lead?.url || '',
        note: 'Linky cannot post to LinkedIn for you, and would not. Approve it, open the profile, paste it in.',
      });
    }
  };

  const openLeadDraft = async (lead: LinkyLead, index: number) => {
    if (leadBusy) return;
    setLeadBusy(lead.url || lead.name);
    try {
      const r = await linkyDraftLead({ index, key: lead.key, lead, need: answer?.need });
      setDraft({
        kind: 'lead', leadKey: r.key || lead.key, index,
        title: `To ${r.lead?.name || lead.name}`, body: r.text, note: r.howTo, url: r.url || lead.url,
      });
    } catch (err) {
      notifyUser('Could not write that', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setLeadBusy('');
    }
  };

  const sendDraft = async () => {
    if (!draft || draftBusy) return;
    setDraftBusy(true);
    try {
      if (draft.kind === 'squad' && draft.cardId) {
        // one approval, one message each - and each of them still says yes alone
        const r = await linkyApproveSquad(draft.cardId, draft.body.trim());
        setDraft(null);
        notifyUser(r.sent ? `Asked ${r.names.join(', ')}` : 'Nothing went out', r.note);
        await load(true);
        return;
      }
      if (draft.kind === 'meet' && draft.cardId) {
        const r = await linkyApproveMeet(draft.cardId, draft.body.trim());
        setDraft(null);
        notifyUser(r.matchId ? 'You two are already connected' : 'Sent', r.matchId ? 'No intro needed - open the chat.' : `Linky passed your words to them${r.meetsLeft != null ? ` (${r.meetsLeft} Meets left today)` : '.'}`);
        await load(true);
      } else {
        const r = await linkyApproveLead(draft.body.trim());
        setDraft(null);
        notifyUser('Kept for you to send', r.note || 'Open their profile, paste it, send it from your own account.');
        if (r.url) Linking.openURL(r.url).catch(() => null);
      }
    } catch (err) {
      notifyUser('Nothing was sent', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setDraftBusy(false);
    }
  };

  const dropDraft = async () => {
    if (!draft) return;
    const { kind, cardId } = draft;
    setDraft(null);
    try {
      if (kind === 'meet' && cardId) await linkyCancelMeet(cardId);
      if (kind === 'squad' && cardId) await linkyCancelSquad(cardId);
    } catch { /* dropping a draft must never fail loudly - nothing was sent anyway */ }
    // "Not now" means not now: the waiting banner must go away too, not linger
    // at the top as if a message were still about to be sent.
    setHome((h) => (h ? { ...h, pending: { ...h.pending, meet: null } } : h));
    if (kind === 'meet') await load(true);
  };

  const notInterested = async (lead: LinkyLead) => {
    const key = lead.key || '';
    if (!key || leadBusy) return;
    setLeadBusy(key);
    try {
      const r = await linkyMarkLead(key, 'not_interested');
      setLeads((list) => list.filter((x) => (x.key || '') !== key));
      notifyUser('Gone', r.note || 'Linky will not show them again.');
    } catch (err) {
      notifyUser('Could not do that', err instanceof Error ? err.message : undefined);
    } finally {
      setLeadBusy('');
    }
  };

  // Linky writes the reply; the app shows it as a conversation, oldest first.
  const turns: LinkyTurn[] = useMemo(() => {
    const t = (home?.thread || []).filter((x) => x && x.text);
    if (t.length) return t.slice(-10);
    if (answer?.need) {
      return [
        { id: answer.id, role: 'user', text: answer.need, at: answer.createdAt },
        { id: answer.id, role: 'linky', text: answer.reply, kind: answer.kind, cardIds: answer.cardIds, at: answer.createdAt + 1 },
      ];
    }
    return [];
  }, [home?.thread, answer]);
  const lastLinkyTurn = [...turns].reverse().find((t) => t.role === 'linky');
  const chips = (lastLinkyTurn?.id === answer?.id ? answer?.suggest : undefined) || [];
  const onChip = (chip: string) => {
    if (!chip || thinking) return;
    const meet = chip.match(/^meet\s*(\d+)/i);
    if (meet) {
      const card = answerCards[Number(meet[1]) - 1] || answerCards[0];
      if (card) { onMeet(card); return; }
    }
    if (/what linky knows/i.test(chip)) { navigation.navigate('LinkyAudit'); return; }
    if (/preferences/i.test(chip)) { navigation.navigate('LinkySettings'); return; }
    send(chip);
  };

  // "Which Fred?" - tapping the face is faster than typing the surname.
  const onPickPerson = async (uid: string) => {
    if (pickedBusy) return;
    setPickedBusy(uid);
    try {
      const card = await linkyPickPerson(uid);
      await load(true);
      setAnswer((a) => (a ? { ...a, kind: 'person', none: false, cardIds: [...(a.cardIds || []), card.id], reply: `${card.targetName}, yes. I put them on a card for you.` } : a));
    } catch (err) {
      notifyUser('Could not open that one', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setPickedBusy('');
    }
  };

  const answerIds = useMemo(() => new Set(answer?.cardIds || []), [answer?.cardIds]);
  const answerCards = useMemo(() => (answer?.cardIds || []).map((id) => (home?.cards || []).find((c) => c.id === id)).filter((c): c is LinkyCard => !!c && c.status !== 'skip'), [answer?.cardIds, home?.cards]);
  const firstName = (home?.name || '').split(' ')[0];
  const surface = isDark ? COLORS.darkBgSec : '#FFFFFF';
  const border = isDark ? COLORS.darkBorder : COLORS.lightBorder;
  const inputBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const outreachCount = (home?.outreach || []).length;

  return (
    <View style={[styles.root, appBackground(isDark)]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingBottom: 140 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={textColor(isDark, 'muted')} />}
      >
        <View style={styles.hero}>
          <View style={styles.heroRow}>
            <View style={[styles.linkyBadge, { backgroundColor: COLORS.primary, borderColor: isDark ? 'transparent' : 'rgba(0,0,0,0.12)' }]}>
              <Text style={styles.linkyBadgeText}>AI</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.heroTitle, { color: textColor(isDark) }]}>{firstName ? `Hey ${firstName}.` : 'Hey.'} I'm Linky.</Text>
              <Text style={[styles.heroSub, { color: textColor(isDark, 'secondary') }]}>
                Tell me who you need and I answer right away with the people on LINKUP I can cite a reason for. No guessing, no waiting.
              </Text>
            </View>
          </View>
          <View style={styles.heroLinks}>
            <TouchableOpacity style={[styles.heroLink, { borderColor: border }]} onPress={() => navigation.navigate('LinkySettings')}>
              <Settings2 size={13} color={textColor(isDark, 'secondary')} />
              <Text style={[styles.heroLinkText, { color: textColor(isDark, 'secondary') }]}>Preferences & bots</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.heroLink, { borderColor: border }]} onPress={() => navigation.navigate('LinkyAudit')}>
              <ShieldCheck size={13} color={textColor(isDark, 'secondary')} />
              <Text style={[styles.heroLinkText, { color: textColor(isDark, 'secondary') }]}>What Linky knows</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading && !home ? (
          <View style={styles.center}><ActivityIndicator color={textColor(isDark, 'muted')} /></View>
        ) : error && !home ? (
          <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
            <Text style={[styles.whyText, { color: textColor(isDark) }]}>{error}</Text>
            <TouchableOpacity style={[styles.ghostBtn, { borderColor: border, alignSelf: 'flex-start', marginTop: 10 }]} onPress={() => load()}>
              <Text style={[styles.ghostBtnText, { color: textColor(isDark) }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : home ? (
          <>
            {home.inbound.length ? (
              <>
                <SectionTitle title="Waiting on you" hint={`${home.inbound.length} intro ${home.inbound.length === 1 ? 'request' : 'requests'}`} isDark={isDark} />
                {home.inbound.map((intro) => (
                  <InboundView key={intro.id} intro={intro} isDark={isDark} busy={busyId === intro.id} onDecision={(d) => onDecision(intro, d)} onOpen={() => navigation.navigate('Profile', { userId: intro.requesterId })} />
                ))}
              </>
            ) : null}

            {(home.pending?.meet || home.pending?.lead) && !draft ? (
              <TouchableOpacity
                style={[styles.pendingBar, { borderColor: border, backgroundColor: isDark ? 'rgba(223,251,63,0.1)' : 'rgba(223,251,63,0.22)' }]}
                onPress={openPending}
                activeOpacity={0.85}
              >
                <Send size={14} color={textColor(isDark)} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pendingBarTitle, { color: textColor(isDark) }]}>
                    {home.pending?.meet
                      ? `A message to ${home.pending.meet.targetName || 'them'} is waiting on you`
                      : `A message to ${home.pending?.lead?.lead?.name || 'them'} is written and waiting`}
                  </Text>
                  <Text style={[styles.pendingBarSub, { color: textColor(isDark, 'secondary') }]}>Nothing has been sent. Tap to read it, change it if you want, then send it yourself.</Text>
                </View>
              </TouchableOpacity>
            ) : null}

            {home.loop ? (
              <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
                <View style={styles.loopHead}>
                  <Clock size={14} color={COLORS.primaryStrong} />
                  <Text style={[styles.sectionTitle, { color: textColor(isDark), marginLeft: 6 }]}>How did it go?</Text>
                </View>
                <Text style={[styles.whyText, { color: textColor(isDark), marginTop: 6 }]}>{home.loop.question}</Text>
                <View style={styles.loopChoices}>
                  {home.loop.choices.map((c) => (
                    <TouchableOpacity
                      key={c.key}
                      style={[styles.loopBtn, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]}
                      onPress={() => onLoop(c.key)}
                      disabled={busyId === 'loop'}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.loopBtnText, { color: textColor(isDark) }]}>{c.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[styles.loopFoot, { color: textColor(isDark, 'muted') }]}>
                  One answer, 20 seconds. It is how Linky learns who to put in front of you next.
                </Text>
              </View>
            ) : null}

            {(pendingAsk || turns.length) ? (
              <>
                <SectionTitle title="Linky" hint={!home.plus && asksPerDay ? (asksLeft > 0 ? `${asksLeft} of ${asksPerDay} free messages left today` : `0 of ${asksPerDay} free messages left today · resets in ${resetCountdown || '…'}`) : undefined} isDark={isDark} />
                <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
                  {turns.map((t, i) => (t.role === 'user' ? (
                    <View key={`u${t.at}-${i}`} style={[styles.turn, styles.turnUser]}>
                      <Text style={[styles.turnText, { backgroundColor: COLORS.primary, color: '#000' }, COLORS.primary === '#FFFFFF' ? { borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' } : null]}>
                        {t.text}
                      </Text>
                    </View>
                  ) : (
                    <View key={`l${t.at}-${i}`} style={styles.msgRow}>
                      <View style={[styles.msgDot, { backgroundColor: COLORS.primary }]}><Text style={styles.msgDotText}>L</Text></View>
                      <Text style={[styles.turnText, { flexShrink: 1, color: textColor(isDark), backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }]}>{t.text}</Text>
                    </View>
                  )))}
                  {thinking && pendingAsk ? (
                    <View style={[styles.turn, styles.turnUser]}>
                      <Text style={[styles.turnText, { backgroundColor: COLORS.primary, color: '#000' }]}>{pendingAsk}</Text>
                    </View>
                  ) : null}
                  {thinking ? (
                    <View style={styles.msgRow}>
                      <View style={[styles.msgDot, { backgroundColor: COLORS.primary }]}><Text style={styles.msgDotText}>L</Text></View>
                      <Text style={[styles.turnThinking, { color: textColor(isDark, 'muted') }]}>{THINKING_LINES[thinkingTick % THINKING_LINES.length]}</Text>
                    </View>
                  ) : null}

                  {!thinking && answer?.nearest?.length ? (
                    <View style={styles.nearestRow}>
                      {answer.nearest.map((n) => (
                        <TouchableOpacity
                          key={n.uid}
                          style={[styles.nearest, { borderColor: border }]}
                          onPress={() => (answer.kind === 'ambiguous' ? onPickPerson(n.uid) : navigation.navigate('Profile', { userId: n.uid }))}
                          disabled={!!pickedBusy}
                          activeOpacity={0.75}
                        >
                          <Avatar uri={n.pic} size={30} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.nearestName, { color: textColor(isDark) }]} numberOfLines={1}>{n.name}</Text>
                            <Text style={[styles.nearestMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
                              {answer.kind === 'ambiguous' ? 'Tap - this one' : [n.role, n.city].filter(Boolean).join(' · ') || 'On LINKUP'}
                            </Text>
                          </View>
                          {pickedBusy === n.uid ? <ActivityIndicator size="small" color={textColor(isDark, 'muted')} /> : null}
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}

                  {!thinking && (pointerText || leads.length) ? (
                    <View style={[styles.whyBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
                        <Text style={[styles.whyLabel, { color: textColor(isDark, 'muted') }]}>OUTSIDE LINKUP</Text>
                        <Text style={[styles.whyText, { color: textColor(isDark) }]}>{pointerText}</Text>
                        {pointerRoutes.length ? (
                          <View style={{ marginTop: 8, gap: 6 }}>
                            {pointerRoutes.map((rt, i) => (
                              <Text key={'r' + i} style={[styles.leadLine, { color: textColor(isDark, 'secondary') }]}>{i + 1}) {rt}</Text>
                            ))}
                          </View>
                        ) : null}
                        {leads.length ? (
                          <View style={{ marginTop: 10, gap: 8 }}>
                            {leads.map((l, i) => (
                              <View key={l.url + '-' + i} style={[styles.lead, { borderColor: border }]}>
                                <View style={{ flex: 1, gap: 2 }}>
                                  <Text style={[styles.nearestName, { color: textColor(isDark) }]} numberOfLines={1}>{l.name}</Text>
                                  {l.title ? <Text style={[styles.nearestMeta, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>{l.title}</Text> : null}
                                  {l.why ? <Text style={[styles.nearestMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={2}>{l.why}</Text> : null}
                                  {l.proof && l.proof.length ? (
                                    <Text style={[styles.nearestMeta, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>
                                      {`Proof: ${l.proof.slice(0, 2).map((b) => b.label).join(' - ')}`}
                                    </Text>
                                  ) : null}
                                  <Text style={[styles.leadUrl, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
                                    {l.resolved === false ? 'no direct link - opens a search: ' : ''}
                                    {l.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                                  </Text>
                                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                                    <TouchableOpacity style={[styles.leadBtn, { borderColor: border }]} onPress={() => { Linking.openURL(l.url).catch(() => notifyUser('Could not open that link', 'Copy it from a browser instead.')); }} activeOpacity={0.75}>
                                      <Link2 size={12} color={textColor(isDark, 'secondary')} />
                                      <Text style={[styles.leadBtnText, { color: textColor(isDark) }]}>Profile</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={[styles.leadBtn, { backgroundColor: isDark ? 'rgba(223,251,63,0.14)' : 'rgba(223,251,63,0.24)' }]} onPress={() => openLeadDraft(l, i + 1)} disabled={!!leadBusy} activeOpacity={0.8}>
                                      <Send size={12} color={textColor(isDark)} />
                                      <Text style={[styles.leadBtnText, { color: textColor(isDark) }]}>{leadBusy === (l.url || l.name) ? 'Writing...' : 'Draft a message'}</Text>
                                    </TouchableOpacity>
                                    {l.key ? (
                                      <TouchableOpacity style={[styles.leadBtn, { borderColor: border }]} onPress={() => notInterested(l)} disabled={!!leadBusy} activeOpacity={0.75}>
                                        <X size={12} color={textColor(isDark, 'muted')} />
                                      </TouchableOpacity>
                                    ) : null}
                                  </View>
                                </View>
                              </View>
                            ))}
                            <Text style={[styles.nearestMeta, { color: textColor(isDark, 'muted') }]}>
                              Public profiles from {pointerMeta.searches ? 'one LinkedIn search, run just now' : 'a search Linky ran a moment ago'} - no contact details, and Linky has not written to anybody. Open a profile, paste the message, send it from your own account.{pointerMeta.skipped ? ' ' + pointerMeta.skipped + ' you already saw or wrote to were left out.' : ''}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                  ) : null}

                  {!thinking && chips.length ? (
                    <View style={styles.chipsRow}>
                      {chips.slice(0, 3).map((c) => (
                        <TouchableOpacity key={c} style={[styles.chip, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }]} onPress={() => onChip(c)} activeOpacity={0.75}>
                          <Text style={[styles.chipText, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>{c}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
                {!thinking ? answerCards.map((card) => (
                  <CardView
                    key={card.id}
                    card={card}
                    isDark={isDark}
                    busy={busyId === card.id}
                    onMeet={() => onMeet(card)}
                    onSkip={() => onCardStatus(card, 'skip')}
                    onSave={() => onCardStatus(card, 'saved')}
                    onOpen={() => navigation.navigate('Profile', { userId: card.targetUid })}
                  />
                )) : null}
              </>
            ) : null}

            {!pendingAsk && !answer ? (
              <View style={styles.chips}>
                <Text style={[styles.emptyLine, { color: textColor(isDark, 'muted') }]}>Try one of these, or type your own below.</Text>
                {['A Flutter developer in Harare for a paid fintech MVP', 'A co-founder with sales experience, equity', 'Someone who has raised from local angels, coffee'].map((s) => (
                  <TouchableOpacity key={s} style={[styles.chip, { borderColor: border, backgroundColor: surface }]} onPress={() => send(s)} activeOpacity={0.75}>
                    <Text style={[styles.chipText, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {/* Free plan sees a single rotating sponsored card here (never stacked);
            PLUS is ad-free. Profile stays exempt by the global rule. */}
        <View style={{ marginTop: 14 }}>
          <SponsoredSlot
            placement="linky"
            viewerUid={user?.uid}
            enabled={!isSponsoredHiddenForViewer(profile, { email: user?.email, isAdmin: (profile as any)?.isAdmin })}
          />
        </View>
      </ScrollView>

      <View style={[styles.composerWrap, { paddingBottom: Math.max(10, insets.bottom + 6), backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg, borderTopColor: border }]}>
        {atDailyLimit && resetCountdown ? (
          <Text style={[styles.resetLine, { color: textColor(isDark, 'muted') }]}>
            Today's free messages are used up — resets in {resetCountdown}.
          </Text>
        ) : null}
        <View style={[styles.composer, { backgroundColor: surface, borderColor: border }]}>
          <TextInput
            style={[styles.input, { color: textColor(isDark) }]}
            placeholder="Who do you need? Ask Linky…"
            placeholderTextColor="#999"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send()}
            returnKeyType="send"
            multiline={Platform.OS !== 'web'}
            maxLength={600}
            editable={!thinking}
          />
          <TouchableOpacity style={[styles.sendBtn, { backgroundColor: COLORS.primary, borderColor: isDark ? 'transparent' : 'rgba(0,0,0,0.12)', opacity: input.trim() && !thinking ? 1 : 0.4 }]} onPress={() => send()} disabled={!input.trim() || thinking}>
            {thinking ? <ActivityIndicator size="small" color="#000" /> : <ArrowUp size={16} color="#000" />}
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={!!draft} transparent animationType="fade" onRequestClose={dropDraft}>
        {draft ? (
          <View style={styles.sheetWrap}>
            <View style={[styles.sheet, { borderColor: border, backgroundColor: surface }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[styles.sheetTitle, { color: textColor(isDark) }]} numberOfLines={2}>
                  {draft.kind === 'lead' ? 'Your message, in your words' : draft.kind === 'squad' ? 'Before it goes to the three of them' : 'Before it goes to them'}
                </Text>
                <TouchableOpacity onPress={dropDraft} style={{ marginLeft: 'auto', padding: 4 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <X size={16} color={textColor(isDark, 'muted')} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.sheetSub, { color: textColor(isDark, 'secondary') }]}>{draft.title}</Text>
              <TextInput
                style={[styles.sheetInput, { color: textColor(isDark), backgroundColor: inputBg, borderColor: border }]}
                value={draft.body}
                onChangeText={(v) => setDraft({ ...draft, body: v })}
                multiline
                maxLength={900}
                autoFocus={Platform.OS !== 'web'}
              />
              <Text style={[styles.sheetNote, { color: textColor(isDark, 'muted') }]}>
                {draft.note || (draft.kind === 'meet'
                  ? 'Nothing has been sent yet - this reaches them only when you press send. Edit it freely; it is your voice, not mine.'
                  : 'Linky cannot post to LinkedIn for you, and would not. Approve it, open the profile, paste it in.')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <TouchableOpacity
                  onPress={sendDraft}
                  disabled={draftBusy || draft.body.trim().length < 24}
                  style={[styles.sheetBtn, { backgroundColor: COLORS.primary, opacity: draftBusy || draft.body.trim().length < 24 ? 0.5 : 1 }]}
                >
                  {draftBusy ? <ActivityIndicator size="small" color="#000" /> : (
                    <Text style={styles.sheetBtnText}>{draft.kind === 'lead' ? 'APPROVE & OPEN PROFILE' : draft.kind === 'squad' ? 'SEND TO ALL THREE' : 'SEND IT'}</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={dropDraft} style={[styles.sheetGhost, { borderColor: border }]}>
                  <Text style={[styles.sheetGhostText, { color: textColor(isDark, 'secondary') }]}>{draft.kind === 'meet' ? 'Not now' : 'Drop it'}</Text>
                </TouchableOpacity>
              </View>
              {draft.kind === 'lead' && outreachCount ? (
                <Text style={[styles.sheetFoot, { color: textColor(isDark, 'muted') }]}>{outreachCount} outreach {outreachCount === 1 ? 'message' : 'messages'} Linky has handed you so far. Each one you approve is remembered, so the same person is not shown to you twice.</Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </Modal>
      <PaywallModal
        visible={!!paywall}
        onClose={() => setPaywall(null)}
        feature="Linky asks & intros"
        description={(() => {
          const base = paywall || 'You have exhausted your 2 free messages today. Upgrade to LINKUP PLUS — $19.99/month or $149.99/year.';
          return resetCountdown ? `${base}\n\nDaily messages reset in ${resetCountdown}.` : base;
        })()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 14 },
  center: { paddingVertical: 40, alignItems: 'center' },
  hero: { marginBottom: 14 },
  heroRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  linkyBadge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  linkyBadgeText: { fontSize: 15, fontWeight: '900', color: '#000', letterSpacing: 1 },
  heroTitle: { fontSize: 20, fontWeight: '900', letterSpacing: -0.3 },
  heroSub: { fontSize: 13, lineHeight: 19, fontWeight: '500', marginTop: 4 },
  heroLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  heroLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  heroLinkText: { fontSize: 11, fontWeight: '800' },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' },
  sectionHint: { fontSize: 11, fontWeight: '700' },
  card: { borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  cardName: { fontSize: 15, fontWeight: '900' },
  cardRole: { fontSize: 12, fontWeight: '600', marginTop: 1 },
  cardMeta: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  pill: { fontSize: 10, fontWeight: '800', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, maxWidth: '100%' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  squadRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  squadText: { fontSize: 11, fontWeight: '800' },
  plusText: { fontSize: 11, fontWeight: '900' },
  pairNote: { fontSize: 11.5, marginTop: 8, fontStyle: 'italic' },
  loopHead: { flexDirection: 'row', alignItems: 'center' },
  loopChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  loopBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, flexGrow: 1, flexBasis: '46%' },
  loopBtnText: { fontSize: 13, fontWeight: '800' },
  loopFoot: { fontSize: 11, marginTop: 10 },
  whyBox: { borderRadius: 12, padding: 10, marginTop: 12 },
  whyLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  whyText: { fontSize: 13, lineHeight: 19, fontWeight: '600', marginTop: 3 },
  forText: { fontSize: 11, fontWeight: '600', marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'flex-end' },
  ghostBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1 },
  ghostBtnText: { fontSize: 12, fontWeight: '800' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 12, borderWidth: 1, minWidth: 84, justifyContent: 'center' },
  primaryBtnText: { fontSize: 12, fontWeight: '900', color: '#000' },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  stateText: { fontSize: 12, fontWeight: '700' },
  emptyLine: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  turn: { marginBottom: 8, alignItems: 'flex-start' },
  turnUser: { alignItems: 'flex-end' },
  turnText: { fontSize: 13, lineHeight: 19, fontWeight: '600', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, maxWidth: '88%', overflow: 'hidden' },
  turnThinking: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  nearestRow: { gap: 8, marginTop: 4 },
  nearest: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  nearestName: { fontSize: 13, fontWeight: '800' },
  nearestMeta: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  msgDot: { width: 24, height: 24, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  msgDotText: { fontSize: 11, fontWeight: '900', color: '#000' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  lead: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9 },
  leadUrl: { fontSize: 10.5, fontWeight: '600', marginTop: 2, opacity: 0.75 },
  leadLine: { fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
  leadBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  leadBtnText: { fontSize: 11, fontWeight: '800' },
  sheetWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { margin: 12, padding: 16, borderRadius: 18, borderWidth: 1, gap: 8 },
  sheetTitle: { fontSize: 15, fontWeight: '900', flexShrink: 1 },
  sheetSub: { fontSize: 12, fontWeight: '700' },
  sheetInput: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 150, fontSize: 14, lineHeight: 21, fontWeight: '600', textAlignVertical: 'top' },
  sheetNote: { fontSize: 11.5, lineHeight: 17, fontWeight: '600' },
  sheetBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  sheetBtnText: { fontSize: 12, fontWeight: '900', color: '#000', letterSpacing: 0.4 },
  sheetGhost: { borderWidth: 1, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' },
  sheetGhostText: { fontSize: 12, fontWeight: '800' },
  sheetFoot: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
  pendingBar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 10 },
  pendingBarTitle: { fontSize: 13, fontWeight: '900' },
  pendingBarSub: { fontSize: 11.5, lineHeight: 16, fontWeight: '600', marginTop: 1 },
  leadOpen: { fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  chips: { marginTop: 16, gap: 8 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  chipText: { fontSize: 12, fontWeight: '700', lineHeight: 17 },
  composerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1 },
  resetLine: { fontSize: 11, fontWeight: '800', textAlign: 'center', paddingBottom: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderRadius: 18, borderWidth: 1, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, fontSize: 14, fontWeight: '500', maxHeight: 96, paddingVertical: 6 },
  sendBtn: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
