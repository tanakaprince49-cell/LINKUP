import BuildHabitCard from '../components/BuildHabitCard';
import LinkyRichText from '../components/LinkyRichText';
import { linkyShortlist } from '../lib/linkyShortlist';
import VerifiedBadge from '../components/VerifiedBadge';
import MemberBadges from '../components/MemberBadges';
import { recordReviewAction } from '../lib/appReview';
import { FREE_LINKY_LIMIT_MESSAGE, quotaFromHome, homeWithQuota } from '../lib/linkyQuota';
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
  Keyboard,
  KeyboardAvoidingView,
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
import { Users, MessageCircle, ArrowLeft, Bell, Link2, ArrowUp, Check, Clock, Compass, Send, Settings2, ShieldCheck, Trash2, Trophy, X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
import PaywallModal from '../components/PaywallModal';
import BrandMark from '../components/BrandMark';
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
  linkyClearChat,
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
const THINKING_LINES = ['Thinking that through…', 'Putting a reply together…', 'One moment…'];

// Live countdown to the moment today's daily Linky budget resets (the server
// hands back `asksResetAt` as an ISO instant; dayKey is UTC, so it is the next
// UTC midnight). Formats as "5h 12m 03s" -> "12m 03s" -> "3s".
const formatCountdown = (resetAtIso?: string, now = Date.now()) => {
  if (!resetAtIso) return '';
  const diff = Math.max(0, Date.parse(resetAtIso) - now);
  if (diff <= 0) return '';
  const total = Math.floor(diff / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return h > 0 ? `${h}h ${m}m ${pad(s)}s` : m > 0 ? `${m}m ${pad(s)}s` : `${s}s`;
};

const FALLBACK_AVATAR = 'https://ui-avatars.com/api/?name=U&background=DFFB3F&color=000&size=80';

const Avatar = ({ uri, size = 44 }: { uri?: string; size?: number }) => (
  <Image source={{ uri: uri || FALLBACK_AVATAR }} style={{ width: size, height: size, borderRadius: size / 3.2, backgroundColor: '#E0E0E0' }} />
);

const SectionTitle = ({ title, hint, action, isDark }: { title: string; hint?: string; action?: React.ReactNode; isDark: boolean }) => (
  <View style={styles.sectionHead}>
    <View style={styles.sectionHeadRow}>
      <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>{title}</Text>
      {action ? <View style={styles.sectionRight}>{action}</View> : null}
    </View>
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
  const accepted = card.status === 'accepted';
  return (
    <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open ${card.targetName}’s profile`} style={styles.cardTop} onPress={onOpen} activeOpacity={0.75}>
        <Avatar uri={card.targetPic} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={[styles.cardName, { color: isDark ? '#9ED8FF' : '#075EA8', backgroundColor: isDark ? '#203F56' : '#E4F1FF', textDecorationLine: 'underline', flexShrink: 1 }]} numberOfLines={1}>{card.targetName}</Text><MemberBadges userId={card.targetUid} size={18} /></View>
          {card.targetRole || card.targetCompany ? (
            <Text style={[styles.cardRole, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>
              {[card.targetRole, card.targetCompany].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          {card.targetCity ? <Text style={[styles.cardMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>{card.targetCity}</Text> : null}
          <Text style={{fontSize:11,fontWeight:'700',color:isDark?'#8BC9F9':'#176BA6',marginTop:4}}>View profile →</Text>
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
          <Trophy size={14} color={COLORS.primaryStrong} />
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
              <Text style={[styles.badgeText, { color: b.url ? (isDark ? '#9ED8FF' : '#075EA8') : textColor(isDark, 'secondary'), textDecorationLine: b.url ? 'underline' : 'none' }]} numberOfLines={1}>
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
        <Text style={[styles.whyLabel, { color: textColor(isDark, 'muted') }]}>WHY THIS PERSON</Text>
        <LinkyRichText text={card.why} isDark={isDark} profiles={[{name:card.targetName,uid:card.targetUid}]} onProfile={onOpen} style={[styles.whyText, { color: textColor(isDark) }]} />
        {card.unknowns?.length ? <Text style={[styles.forText, { color: textColor(isDark, 'muted') }]}>Still to check: {card.unknowns[0]}</Text> : null}
        <Text style={[styles.forText, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>For: {card.need}</Text>
      </View>
      {requested ? (
        <View style={styles.stateRow}>
          <Clock size={13} color={textColor(isDark, 'muted')} />
          <Text style={[styles.stateText, { color: textColor(isDark, 'muted') }]}>Introduction requested. You will be notified when they respond.</Text>
        </View>
      ) : accepted ? (
        <View style={styles.stateRow}>
          <Check size={13} color="#16A34A" />
          <Text style={[styles.stateText, { color: '#16A34A' }]}>Introduction accepted. You can now start a conversation.</Text>
        </View>
      ) : declined ? (
        <View style={styles.stateRow}>
          <X size={13} color={textColor(isDark, 'muted')} />
          <Text style={[styles.stateText, { color: textColor(isDark, 'muted') }]}>Introduction declined.</Text>
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={[styles.cardName, { color: textColor(isDark), flexShrink: 1 }]} numberOfLines={1}>{intro.requesterName}</Text><MemberBadges userId={intro.requesterId} size={18} /></View>
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
  // On Android 15+ (edge-to-edge) the window does NOT resize when the keyboard
  // opens — the keyboard simply draws over the bottom of the screen, at the bottom of this full-screen view. KeyboardAvoidingView's 'height' behaviour is unreliable there,
  // so we measure the keyboard directly and lift the composer by the exact
  // amount it overlaps the full-screen conversation.
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setAndroidKeyboardHeight(e.endCoordinates.height);
      // keep the newest message in view above the keyboard
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setAndroidKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const [home, setHome] = useState<LinkyHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [activityOpen, setActivityOpen] = useState(false);
  const [composerHeight, setComposerHeight] = useState(96);
  const inputRef = useRef<TextInput>(null);
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

  // One-second tick so the allowance countdown actually counts down on
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

  const quota = home ? quotaFromHome(home) : null;
  const messageLimit = quota?.limit ?? 15;
  const asksLeft = quota?.remaining ?? 0;
  const resetCountdown = formatCountdown(quota?.resetAt, nowTick);
  const atMessageLimit = !!home && !home.plus && !!quota?.upgradeRequired && (!quota.resetAt || Date.parse(quota.resetAt) > nowTick);
  const quotaPaywallShown = useRef('');
  useEffect(() => {
    if (!isFocused || !atMessageLimit || !quota) return;
    const key = `${user?.uid}:${quota.periodKey}`;
    if (quotaPaywallShown.current === key) return;
    quotaPaywallShown.current = key;
    setPaywall(FREE_LINKY_LIMIT_MESSAGE);
  }, [isFocused, atMessageLimit, quota?.periodKey, user?.uid]);
  useEffect(() => {
    if (quota && quota.remaining > 0 && paywall === FREE_LINKY_LIMIT_MESSAGE) setPaywall(null);
  }, [quota?.remaining, paywall]);
  const mounted = useRef(true);
  const hydratedRef = useRef(false);

  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async (silent = false) => {
    if (!user?.uid) return;
    if (!silent) setLoading(true);
    try {
      const h = await linkyHome();
      if (!mounted.current) return;
      hydratedRef.current = true;
      setHome(h);
      setError('');
      // a lastAsk restored from home carries no ask budget of its own; the home
      // payload's limits are the same numbers, so derive it rather than fake it
      setAnswer((a) => a || (h.lastAsk
        ? { ...h.lastAsk, cards: [], cached: false, asksLeft: quotaFromHome(h).remaining }
        : null));
    } catch (err) {
      if (!mounted.current) return;
      setHome(h => h ? {...h,cards:[]} : h);
      setError(err instanceof Error ? err.message : 'Linky is unavailable right now.');
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, [user?.uid]);

  const resetRefreshBusy = useRef(false);
  useEffect(() => {
    if (!isFocused || !quota?.resetAt || resetRefreshBusy.current || Date.parse(quota.resetAt) > nowTick) return;
    resetRefreshBusy.current = true;
    void load(true).finally(() => { resetRefreshBusy.current = false; });
  }, [isFocused, quota?.resetAt, Math.floor(nowTick / 60_000), load]);

  useFocusEffect(useCallback(() => { load(true); }, [load]));
  useEffect(() => { load(); }, [load]);

  const fail = (err: unknown, fallbackTitle: string) => {
    if (err instanceof LinkyApiError && err.status === 402) {
      if (err.messageQuota) setHome((h) => h ? homeWithQuota(h, err.messageQuota!) : h);
      if (err.messageQuota?.period === 'day' || home?.plus) notifyUser('Daily allowance reached', err.message);
      else setPaywall(err.message);
      return;
    }
    notifyUser(fallbackTitle, err instanceof Error ? err.message : 'Please try again.');
  };

  const onLoop = async (choice: LinkyLoopChoice) => {
    setActivityOpen(false);
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
      notifyUser('Asked', "Introduction requests have been sent. Each recipient will respond independently.");
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
    setActivityOpen(false);
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
    if (!msg || thinking || !home) return;
    if (atMessageLimit && (!quota?.resetAt || Date.parse(quota.resetAt) > Date.now())) {
      setPaywall(FREE_LINKY_LIMIT_MESSAGE);
      return;
    }
    setInput('');
    setPendingAsk(msg);
    setThinking(true);
    // No manual scroll here — the effect below follows `thinking` and the
    // growing turn count so the newest message stays in view (previously this
    // scrolled to y:0, dumping the user at the top of the page every send).
    try {
      const out = await linkyAsk(msg);
      if (user?.uid) void recordReviewAction(user.uid);
      setAnswer(out);
      if (out.kind !== 'chat') {
        setPointerText('');
        setLeads([]);
        setPointerRoutes([]);
      }
      // "yes, look outside LINKUP" -> the LinkedIn leads arrive on the ask
      // itself, so render them the same way the old button did.
      if (out.kind === 'outside' || out.leads?.length) {
        setPointerText(out.pointerIntro || out.reply || '');
        setPointerRoutes(Array.isArray(out.routes) ? out.routes : []);
        setLeads(out.leads || []);
        setPointerMeta({ searches: Number(out.searches || 0), skipped: Number(out.skipped || 0), cached: !!out.cached, place: out.place || '' });
      }
      if (out.thread) setHome((h) => (h ? { ...h, thread: out.thread } : h));
      setHome((h) => {
        if (!h) return h;
        const byId = new Map(out.cards.map((c) => [c.id, c]));
        const merged = h.cards.map((c) => byId.get(c.id) || c);
        out.cards.forEach((c) => { if (!merged.some((m) => m.id === c.id)) merged.push(c); });
        const updated = { ...h, cards: merged, ...(out.kind === 'chat' ? {} : { lastAsk: out }) };
        return out.messageQuota ? homeWithQuota(updated, out.messageQuota) : { ...updated, limits: { ...h.limits, asksUsedToday: Math.max(h.limits.asksUsedToday, h.limits.asksPerDay - out.asksLeft) } };
      });
      // Refresh source-checked cards after chat so the last shortlist remains
      // usable without reviving a profile hidden or blocked since that search.
      if (out.kind === 'chat') await load(true);
    } catch (err) {
      fail(err, 'Linky could not answer');
      // A server failure can refund a reserved message. Refresh authoritative use.
      if (!(err instanceof LinkyApiError && err.status === 402)) void load(true);
    } finally {
      setThinking(false);
      setPendingAsk('');
    }
  };

  // "Delete the chat at once": wipe the whole conversation. The server clears
  // the thread + last answer only — the daily message counter, what Linky
  // knows and the cards he found all stay put.
  const clearConversation = () => {
    if (!user?.uid || busyId === 'clearChat') return;
    notifyUser(
      'Clear the chat?',
      "Delete this Linky conversation? Your message allowance, profile preferences, and saved recommendations remain unchanged.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear chat',
          style: 'destructive',
          onPress: async () => {
            setBusyId('clearChat');
            try {
              await linkyClearChat();
              setAnswer(null);
              setPendingAsk('');
              setPointerText('');
              setLeads([]);
              setPointerRoutes([]);
              setHome((h) => (h ? { ...h, thread: [], lastAsk: null } : h));
              notifyUser('Cleared', "Your Linky conversation has been deleted.");
            } catch (e) {
              notifyUser('Could not clear the chat', e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  // A draft left half-finished (on Telegram, or by a previous visit) is still the
  // most important thing on this screen, so it gets a line of its own.
  const openPending = () => {
    setActivityOpen(false);
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
        notifyUser(r.matchId ? 'You two are already connected' : 'Sent', r.matchId ? "You are already connected. Open the conversation to continue." : `Linky passed your words to them${r.meetsLeft != null ? ` (${r.meetsLeft} Meets left today)` : '.'}`);
        await load(true);
      } else {
        const r = await linkyApproveLead(draft.body.trim());
        setDraft(null);
        notifyUser('Kept for you to send', r.note || "Review the draft and send it from your own account after opening the recipient’s profile.");
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
      notifyUser('Gone', r.note || "This profile has been excluded from future recommendations.");
    } catch (err) {
      notifyUser('Could not do that', err instanceof Error ? err.message : undefined);
    } finally {
      setLeadBusy('');
    }
  };

  // Linky writes the reply; the app shows it as a conversation, oldest first.
  const turns: LinkyTurn[] = useMemo(() => {
    const t = (home?.thread || []).filter((x) => x && x.text);
    if (t.length) return t;
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

  // A dedicated chat opens at its latest message, including restored history.
  // Follow turn identity (not just count) because the server caps the thread.
  const lastTurnKey = turns.length ? `${turns[turns.length - 1].id}:${turns[turns.length - 1].at}` : '';
  useEffect(() => {
    if (!hydratedRef.current) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    return () => clearTimeout(timer);
  }, [lastTurnKey, thinking]);

  const onChip = (chip: string) => {
    if (!chip || thinking) return;
    const meet = chip.match(/^meet\s*(\d+)/i);
    if (meet) {
      const card = answerCards[Number(meet[1]) - 1];
      if (card) { onMeet(card); return; }
      notifyUser('Choose a current card', 'That number is not in these results. I will not choose someone else for you.');
      return;
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

  const shortlist = useMemo(() => linkyShortlist(answer, home), [answer, home]);
  const answerCards = shortlist.cards;
  const prepareInput = (prompt: string) => {
    setInput(prompt);
    inputRef.current?.focus();
  };
  const textProfiles = useMemo(()=> (home?.cards || []).filter(c=>['new','saved','meet','accepted'].includes(c.status)).map(c=>({name:c.targetName,uid:c.targetUid})),[home?.cards]);
  const openProfile = (uid: string) => navigation.navigate('Profile', {userId:uid});
  const firstName = (home?.name || '').split(' ')[0];
  const surface = isDark ? '#182A36' : '#FFFFFF';
  const border = isDark ? '#2A4250' : '#E5E9DF';
  const inputBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const outreachCount = (home?.outreach || []).length;

  return (
    <View style={[styles.root, appBackground(isDark), {backgroundColor: isDark ? '#101E29' : '#FFFBEE'}]}>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.playfulBackdrop}>
        <View style={[styles.backdropCircle, {top: 80, left: -85, backgroundColor: isDark ? '#234A45' : '#E2F3DF'}]} />
        <View style={[styles.backdropCircle, {bottom: 70, right: -100, backgroundColor: isDark ? '#342F48' : '#EEE7FF'}]} />
      </View>
      <View style={[styles.chatHeader, { paddingTop: insets.top + 6, borderBottomColor: border, backgroundColor: isDark ? '#142530' : '#FFFDF6' }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to network" onPress={() => navigation.navigate('Dashboard')} style={styles.headerIcon}>
          <ArrowLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
            <Text style={[styles.chatTitle, { color: textColor(isDark) }]}>Linky</Text>
            <VerifiedBadge size={18} accessibilityLabel="Verified Linky AI" />
          </View>
          <Text style={[styles.chatSubtitle, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
            {home ? 'AI connector · Big ideas welcome' : 'Getting ready…'}
          </Text>
          {home ? <Text accessibilityLabel="Linky message allowance" accessibilityLiveRegion="polite" style={[styles.allowanceText,{color:textColor(isDark,'secondary'),marginTop:3}]}>
            {home.plus ? `${asksLeft} messages left today · PLUS` : `${asksLeft} of ${messageLimit} free messages left this month`}
          </Text> : null}
          {atMessageLimit && resetCountdown ? <Text style={[styles.allowanceText,{color:textColor(isDark,'muted'),marginTop:2}]}>Resets in {resetCountdown}</Text> : null}
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Preferences & bots" onPress={() => navigation.navigate('LinkySettings')} style={styles.headerIcon}>
          <Settings2 size={20} color={textColor(isDark)} />
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="What Linky knows" onPress={() => navigation.navigate('LinkyAudit')} style={styles.headerIcon}>
          <ShieldCheck size={20} color={textColor(isDark)} />
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Linky activity and chat tools" onPress={() => setActivityOpen(true)} style={styles.headerIcon}>
          <Bell size={20} color={textColor(isDark)} />
          {home && (home.inbound.length > 0 || home.pending?.meet || home.pending?.lead || home.loop) ? <View style={styles.activityDot} /> : null}
        </TouchableOpacity>
      </View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open your builder workspace" onPress={() => navigation.navigate('BuilderWorkspace', { section: 'Today' })}
        style={{marginHorizontal:14,marginBottom:6,paddingHorizontal:14,paddingVertical:11,borderRadius:16,backgroundColor:isDark?'#25483b':'#e6f0be',flexDirection:'row',justifyContent:'space-between'}}>
        <Text style={{fontWeight:'800',color:textColor(isDark)}}>Your next move · progress & groups</Text>
        <Text style={{fontWeight:'900',color:textColor(isDark)}}>↗</Text>
      </TouchableOpacity>
      {home&&!home.thread?.length&&<View style={{paddingHorizontal:14,paddingBottom:8}}>
        <Text style={{color:textColor(isDark),fontWeight:'800',marginBottom:8}}>What would help you move forward today?</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>
          {[{label:'Find a collaborator',intent:'cofounder',section:'Plan'},{label:'Find investors',intent:'investors',section:'Plan'},{label:'Get launch feedback',intent:'build',section:'Help board'}].map(goal=><TouchableOpacity key={goal.label} accessibilityRole="button" onPress={()=>navigation.navigate('BuilderWorkspace',goal)} style={{padding:11,borderRadius:15,backgroundColor:isDark?'#263649':'#eef2f6'}}><Text style={{color:textColor(isDark),fontWeight:'700'}}>{goal.label}</Text></TouchableOpacity>)}
        </ScrollView>
      </View>}
      {/* Keyboard keeps the composer visible:
          - iOS: KeyboardAvoidingView 'height' shrinks the container so the
            absolute-bottom composer ends at the keyboard top. The offset is
            the custom header height (insets.top + 56).
          - Android: edge-to-edge means the window never resizes, so the KAV
            is disabled and the composer is lifted manually by the measured
            keyboard height (see androidKeyboardHeight above). */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior="height"
        enabled={Platform.OS !== 'android'}
        keyboardVerticalOffset={insets.top + 56}
      >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingBottom: composerHeight + 16 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={textColor(isDark, 'muted')} />}
      >
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
            {(pendingAsk || turns.length) ? (
              <>
                <View style={styles.conversation}>
                  {turns.map((t, i) => (t.role === 'user' ? (
                    <View key={`u${t.at}-${i}`} style={[styles.turn, styles.turnUser]}>
                      <LinkyRichText text={t.text} isDark={isDark} profiles={textProfiles} onProfile={openProfile} style={[styles.turnText, { backgroundColor: isDark ? '#285246' : '#DBF4DC', color: isDark ? '#E6FFEF' : '#183E2C' }]} />
                    </View>
                  ) : (
                    <View key={`l${t.at}-${i}`} style={styles.msgRow}>
                      <BrandMark size={28} style={{borderRadius: 10}} />
                      <LinkyRichText text={t.text} isDark={isDark} profiles={textProfiles} onProfile={openProfile} style={[styles.turnText, { flexShrink: 1, color: textColor(isDark), backgroundColor: isDark ? '#203744' : '#FFFFFF', borderWidth: 1, borderColor: border }]} />
                    </View>
                  )))}
                  {thinking && pendingAsk ? (
                    <View style={[styles.turn, styles.turnUser]}>
                      <Text style={[styles.turnText, { backgroundColor: isDark ? '#285246' : '#DBF4DC', color: isDark ? '#E6FFEF' : '#183E2C' }]}>{pendingAsk}</Text>
                    </View>
                  ) : null}
                  {thinking ? (
                    <View style={styles.msgRow}>
                      <BrandMark size={28} style={{borderRadius: 10}} />
                      <Text style={[styles.turnThinking, { color: textColor(isDark, 'muted') }]}>{THINKING_LINES[thinkingTick % THINKING_LINES.length]}</Text>
                    </View>
                  ) : null}

                  {!thinking && answer?.kind === 'ambiguous' && answer?.nearest?.length ? (
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
                        <LinkyRichText text={pointerText} isDark={isDark} style={[styles.whyText, { color: textColor(isDark) }]} />
                        {pointerRoutes.length ? (
                          <View style={{ marginTop: 8, gap: 6 }}>
                            {pointerRoutes.map((rt, i) => (
                              <LinkyRichText key={'r' + i} text={`${i + 1}) ${rt}`} isDark={isDark} style={[styles.leadLine, { color: textColor(isDark, 'secondary') }]} />
                            ))}
                          </View>
                        ) : null}
                        {leads.length ? (
                          <View style={{ marginTop: 10, gap: 8 }}>
                            {leads.map((l, i) => (
                              <View key={l.url + '-' + i} style={[styles.lead, { borderColor: border }]}>
                                <View style={{ flex: 1, gap: 2 }}>
                                  <LinkyRichText text={`[${l.name}](${l.url})`} isDark={isDark} style={styles.nearestName} />
                                  {l.title ? <Text style={[styles.nearestMeta, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>{l.title}</Text> : null}
                                  {l.why ? <Text style={[styles.nearestMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={2}>{l.why}</Text> : null}
                                  {l.proof && l.proof.length ? (
                                    <Text style={[styles.nearestMeta, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>
                                      {`Proof: ${l.proof.slice(0, 2).map((b) => b.label).join(' - ')}`}
                                    </Text>
                                  ) : null}
                                  <LinkyRichText text={l.url} isDark={isDark} style={styles.leadUrl} />
                                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                                    <TouchableOpacity accessibilityRole="link" accessibilityLabel={`Open ${l.name} on LinkedIn`} style={[styles.leadBtn, { borderColor: border, backgroundColor: isDark ? '#203F56' : '#E4F1FF' }]} onPress={() => { Linking.openURL(l.url).catch(() => notifyUser('Could not open that link', 'Copy it from a browser instead.')); }} activeOpacity={0.75}>
                                      <Link2 size={12} color={textColor(isDark, 'secondary')} />
                                      <Text style={[styles.leadBtnText, { color: textColor(isDark) }]}>Open LinkedIn profile ↗</Text>
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
                {!thinking && answerCards.length ? (
                  <View style={styles.resultHeading}>
                    <View style={styles.resultCount}><Users size={14} color="#305C45" /><Text style={styles.resultCountText}>{answerCards.length} {answerCards.length === 1 ? 'profile' : 'profiles'}</Text></View>
                    <Text style={[styles.resultCaption,{color:textColor(isDark,'muted')}]}>{shortlist.previous ? 'Your last shortlist' : 'Real people. Your next step.'}</Text>
                  </View>
                ) : null}
                {!thinking && answer?.kind === 'none' ? (
                  <View style={[styles.noMatchCard,{backgroundColor:isDark?'#25352D':'#F2F7E7',borderColor:border}]}>
                    <Text style={[styles.cardName,{color:textColor(isDark)}]}>No solid match yet</Text>
                    <Text style={[styles.welcomeSub,{color:textColor(isDark,'secondary'),textAlign:'left',marginTop:6}]}>I won’t fill the gap with random people. Tweak the search, or choose to browse the network.</Text>
                    <Text style={[styles.welcomeSub,{color:textColor(isDark,'secondary'),textAlign:'left',marginTop:8}]}>Want me to search public LinkedIn profiles for this person or skill? I’ll only search after you choose below.</Text>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Yes, search LinkedIn" onPress={()=>send('yes, search LinkedIn')} style={[styles.ghostBtn,{alignSelf:'flex-start',marginTop:12,backgroundColor:'#E4F1FF',borderColor:'#B9D9F4'}]}><Link2 size={15} color="#075EA8" /><Text style={[styles.ghostBtnText,{color:'#075EA8'}]}>Yes, search LinkedIn ↗</Text></TouchableOpacity>
                    <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:12}}>
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit this search" onPress={()=>prepareInput(answer.need)} style={[styles.ghostBtn,{borderColor:border}]}><Text style={[styles.ghostBtnText,{color:textColor(isDark)}]}>Edit search</Text></TouchableOpacity>
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Browse builders" onPress={()=>send('show me profiles')} style={[styles.ghostBtn,{backgroundColor:'#FBE618',borderColor:'#E5D31B'}]}><Text style={[styles.ghostBtnText,{color:'#243A2E'}]}>Browse builders</Text></TouchableOpacity>
                    </View>
                  </View>
                ) : null}
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

            {!pendingAsk && !answer && !turns.length ? (
              <View style={styles.emptyState}>
                <BuildHabitCard navigation={navigation} isDark={isDark} compact/>
                <View style={styles.welcome}>
                  <View style={styles.brandOrbit}>
                    <View style={[styles.orbitDot,{left:0,top:16,backgroundColor:'#BBDDB0'}]} />
                    <View style={[styles.orbitDot,{right:0,bottom:15,backgroundColor:'#CFC1F4',width:19,height:19}]} />
                    <BrandMark size={76} style={{borderRadius:25,transform:[{rotate:'-7deg'}]}} />

                  </View>
                  <View style={styles.welcomePill}><Text style={styles.welcomePillText}>{firstName ? `HEY ${firstName.toUpperCase()}, LET’S CONNECT` : 'SMALL WORLD. BIG IDEAS.'}</Text></View>
                  <Text style={[styles.welcomeTitle, { color: textColor(isDark) }]}>Let’s find your people.</Text>
                  <Text style={[styles.welcomeSub, { color: textColor(isDark, 'muted') }]}>A collaborator, a fresh perspective, or just a good chat. What’s the move?</Text>
                </View>
                <View style={styles.starterGrid}>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Meet builders — browse LINKUP profiles" onPress={()=>send('show me profiles')} style={[styles.starterTile,{backgroundColor:isDark?'#243F38':'#E2F3DC'}]}>
                    <Users size={23} color={isDark?'#C9EDCE':'#305C45'} />
                    <Text style={[styles.starterTitle,{color:isDark?'#E2F7E4':'#244330'}]}>Meet builders</Text>
                    <Text style={[styles.starterSub,{color:isDark?'#B7CFC2':'#57705E'}]}>Browse real profiles</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Find people by skill" onPress={()=>prepareInput('Find a ')} style={[styles.starterTile,{backgroundColor:isDark?'#35324E':'#EDE6FF'}]}>
                    <Compass size={23} color={isDark?'#DDD1FA':'#65518A'} />
                    <Text style={[styles.starterTitle,{color:isDark?'#F1EAFF':'#4C3C6A'}]}>Find a skill</Text>
                    <Text style={[styles.starterSub,{color:isDark?'#C6BBD9':'#76638E'}]}>Who does your idea need?</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Find someone by name" onPress={()=>prepareInput('Find ')} style={[styles.starterTile,{backgroundColor:isDark?'#443629':'#FFF0D9'}]}>
                    <Check size={23} color={isDark?'#F5D4AC':'#947047'} />
                    <Text style={[styles.starterTitle,{color:isDark?'#FFEAD4':'#795534'}]}>Got a name?</Text>
                    <Text style={[styles.starterSub,{color:isDark?'#D6BEA3':'#8F775D'}]}>Let’s look them up</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Just chat with Linky" onPress={()=>send('How’s it going?')} style={[styles.starterTile,{backgroundColor:isDark?'#253C49':'#E2F1FA'}]}>
                    <MessageCircle size={23} color={isDark?'#C2E1F5':'#43738A'} />
                    <Text style={[styles.starterTitle,{color:isDark?'#E3F5FF':'#2D5F78'}]}>Just talk</Text>
                    <Text style={[styles.starterSub,{color:isDark?'#B9D5E4':'#608498'}]}>Big idea or tiny question</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </>
        ) : null}

      </ScrollView>

      <View onLayout={event => setComposerHeight(event.nativeEvent.layout.height)} style={[styles.composerWrap, {
        // Android edge-to-edge: lift the composer above the keyboard by the
        // amount covered by the keyboard; this dedicated screen has no tab bar.
        bottom: Platform.OS === 'android' ? androidKeyboardHeight : 0,
        paddingBottom: androidKeyboardHeight ? 10 : Math.max(10, insets.bottom + 6),
        backgroundColor: isDark ? '#142530' : '#FFFDF6',
        borderTopColor: border,
      }]}>
        <View style={[styles.composer, { backgroundColor: surface, borderColor: border }]}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: textColor(isDark) }]}
            accessibilityLabel="Message Linky"
            placeholder="An idea, a name, a skill…"
            placeholderTextColor="#999"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send()}
            returnKeyType="send"
            multiline={Platform.OS !== 'web'}
            maxLength={600}
            editable={!!home && !thinking}
          />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Send message" style={[styles.sendBtn, { backgroundColor: '#FBE618', borderColor: '#E3D01B', opacity: input.trim() && !thinking && home ? 1 : 0.5 }]} onPress={() => send()} disabled={!home || !input.trim() || thinking}>
            {thinking ? <ActivityIndicator size="small" color="#000" /> : <ArrowUp size={19} color="#263A2E" />}
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardAvoidingView>

      <Modal visible={activityOpen} transparent animationType="fade" onRequestClose={() => setActivityOpen(false)}>
        <View style={styles.sheetWrap}>
          <View style={[styles.sheet, { borderColor: border, backgroundColor: surface }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[styles.sheetTitle, { color: textColor(isDark) }]}>Linky activity</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close Linky activity" onPress={() => setActivityOpen(false)} style={styles.headerIcon}><X size={22} color={textColor(isDark)} /></TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
              {home ? <>
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
                  <Text style={[styles.pendingBarSub, { color: textColor(isDark, 'secondary') }]}>This draft has not been sent. Review and edit it before sending from your own account.</Text>
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
                  Share brief feedback to help Linky improve future introduction recommendations.
                </Text>
              </View>
            ) : null}

              </> : null}
              <TouchableOpacity onPress={() => { setActivityOpen(false); clearConversation(); }} disabled={thinking || !turns.length || busyId === 'clearChat'} style={[styles.ghostBtn, {borderColor: border}]} accessibilityRole="button" accessibilityLabel="Clear chat">
                <Text style={[styles.ghostBtnText, {color: textColor(isDark)}]}>Clear chat</Text>
              </TouchableOpacity>
            {!thinking ? (
              <View style={styles.chips}>
                {['search brief', 'tone warm', 'tone direct', 'tone playful'].map(command => (
                  <TouchableOpacity key={command} accessibilityRole="button" accessibilityLabel={command} style={[styles.chip, {borderColor: border, backgroundColor: surface}]} onPress={() => { setActivityOpen(false); send(command); }}>
                    <Text style={[styles.chipText, {color: textColor(isDark, 'secondary')}]}>{command}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            </ScrollView>
          </View>
        </View>
      </Modal>

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
        onClose={() => { setPaywall(null); void load(true); }}
        onUnlocked={() => { setPaywall(null); void load(true); }}
        feature="Linky monthly message allowance"
        description={(() => {
          const base = paywall || FREE_LINKY_LIMIT_MESSAGE;
          return resetCountdown ? `${base}\n\nYour monthly allowance resets in ${resetCountdown} (00:00 UTC on the first of the month).` : base;
        })()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  playfulBackdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, overflow: 'hidden' },
  backdropCircle: { position: 'absolute', width: 230, height: 230, borderRadius: 115, opacity: 0.55 },
  emptyState: { flexGrow: 1, justifyContent: 'center', paddingVertical: 18 },
  brandOrbit: { width: 128, height: 102, alignItems: 'center', justifyContent: 'center' },
  orbitDot: { position: 'absolute', width: 13, height: 13, borderRadius: 10 },
  welcomePill: { backgroundColor: '#FFF0AD', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  welcomePillText: { fontSize: 9, fontWeight: '900', color: '#78682B', letterSpacing: 0.7 },
  starterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  starterTile: { width: '48%', flexGrow: 1, borderRadius: 20, padding: 16, minHeight: 116, gap: 7 },
  starterTitle: { fontSize: 15, fontWeight: '800' },
  starterSub: { fontSize: 11, lineHeight: 16 },
  allowanceText: { fontSize: 10, fontWeight: '600' },
  resultHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, marginTop: 10 },
  resultCount: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#E2F3DC' },
  resultCountText: { fontSize: 11, fontWeight: '800', color: '#305C45' },
  resultCaption: { fontSize: 10, flexShrink: 1 },
  noMatchCard: { borderWidth: 1, padding: 16, borderRadius: 20, marginBottom: 12 },
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 16 },
  chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 6, borderBottomWidth: 1 },
  headerIcon: { width: 40, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chatTitle: { fontSize: 19, fontWeight: '900' },
  chatSubtitle: { fontSize: 10, marginTop: 2 },
  activityDot: { position: 'absolute', right: 8, top: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: '#D6A329' },
  conversation: { paddingVertical: 8, marginBottom: 8 },
  welcome: { alignItems: 'center', paddingTop: 8, paddingBottom: 26, gap: 12 },
  welcomeTitle: { fontSize: 29, fontWeight: '800', textAlign: 'center' },
  welcomeSub: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 300 },
  center: { paddingVertical: 40, alignItems: 'center' },
  hero: { marginBottom: 14 },
  heroRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  heroTitle: { fontSize: 20, fontWeight: '900', letterSpacing: -0.3 },
  heroSub: { fontSize: 13, lineHeight: 19, fontWeight: '500', marginTop: 4 },
  heroLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  heroLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  heroLinkText: { fontSize: 11, fontWeight: '800' },
  sectionHead: { marginTop: 16, marginBottom: 8 },
  sectionHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' },
  sectionHint: { fontSize: 11, fontWeight: '700', marginTop: 3 },
  sectionRight: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  clearBtnText: { fontSize: 11, fontWeight: '800' },
  card: { borderRadius: 22, borderWidth: 1, padding: 14, marginBottom: 10 },
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
  turnText: { fontSize: 14, lineHeight: 21, fontWeight: '500', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, maxWidth: '88%', overflow: 'hidden' },
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
  sheet: { maxHeight: '88%', margin: 12, padding: 16, borderRadius: 18, borderWidth: 1, gap: 8 },
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
