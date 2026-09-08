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
  Image,
  Linking,
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
import { useFocusEffect } from '@react-navigation/native';
import { ArrowUp, Check, Clock, Compass, ExternalLink, Globe, Send, Settings2, ShieldCheck, X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
import PaywallModal from '../components/PaywallModal';
import {
  LinkyApiError,
  LinkyAsk,
  LinkyCard,
  LinkyHome,
  LinkyIntro,
  LinkyScout,
  linkyAsk,
  linkyCard,
  linkyHome,
  linkyMeet,
  linkyPointers,
  linkyRespond,
  linkyScout,
} from '../lib/linkyApi';

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
  const { user } = useAuth();
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
  const [answer, setAnswer] = useState<LinkyAsk | null>(null);
  const [pointerText, setPointerText] = useState('');
  const [pointerBusy, setPointerBusy] = useState(false);
  const [scoutResult, setScoutResult] = useState<LinkyScout | null>(null);
  const [scoutBusy, setScoutBusy] = useState(false);
  const [paywall, setPaywall] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
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
      setAnswer((a) => a || h.lastAsk);
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

  const onMeet = async (card: LinkyCard) => {
    if (busyId) return;
    setBusyId(card.id);
    try {
      const r = await linkyMeet(card.id);
      if (r.matchId) {
        navigation.navigate('Chat', { matchId: r.matchId, otherUser: { uid: card.targetUid, displayName: card.targetName, profilePic: card.targetPic }, draftMessage: r.opener || card.opener || '' });
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
      setScoutResult(null);
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

  const searchOutside = async () => {
    if (!answer?.need || scoutBusy) return;
    setScoutBusy(true);
    try {
      const r = await linkyScout(answer.need);
      setScoutResult(r);
    } catch (err) {
      notifyUser('Outside search failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setScoutBusy(false);
    }
  };

  const copyLine = async (line: string) => {
    try {
      const Clipboard = await import('expo-clipboard').catch(() => null);
      if (Clipboard?.setStringAsync) { await Clipboard.setStringAsync(line); notifyUser('Copied', 'First line copied - paste it into your message.'); }
    } catch {}
  };

  const askOutside = async () => {
    if (!answer?.need || pointerBusy) return;
    setPointerBusy(true);
    try {
      const r = await linkyPointers(answer.need);
      setPointerText(r.text);
    } catch (err) {
      notifyUser('Could not fetch pointers', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setPointerBusy(false);
    }
  };

  const answerIds = useMemo(() => new Set(answer?.cardIds || []), [answer?.cardIds]);
  const answerCards = useMemo(() => (answer?.cardIds || []).map((id) => (home?.cards || []).find((c) => c.id === id)).filter((c): c is LinkyCard => !!c && c.status !== 'skip'), [answer?.cardIds, home?.cards]);
  const otherCards = useMemo(() => (home?.cards || []).filter((c) => !answerIds.has(c.id) && (c.status === 'new' || c.status === 'saved')), [home?.cards, answerIds]);
  const asked = useMemo(() => (home?.cards || []).filter((c) => !answerIds.has(c.id) && (c.status === 'meet' || c.status === 'declined')), [home?.cards, answerIds]);
  const firstName = (home?.name || '').split(' ')[0];
  const surface = isDark ? COLORS.darkBgSec : '#FFFFFF';
  const border = isDark ? COLORS.darkBorder : COLORS.lightBorder;

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
                A role, a skill or just a name - I answer right away with the people on LINKUP I can cite a reason for, and I search the open web when nobody here fits.
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

            {(pendingAsk || answer) ? (
              <>
                <SectionTitle title="Your ask" hint={home.limits.asksPerDay ? `${Math.max(0, home.limits.asksPerDay - home.limits.asksUsedToday)} of ${home.limits.asksPerDay} asks left today` : undefined} isDark={isDark} />
                <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
                  <View style={[styles.turn, styles.turnUser]}>
                    <Text style={[styles.turnText, { backgroundColor: COLORS.primary, color: '#000' }, COLORS.primary === '#FFFFFF' ? { borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' } : null]}>
                      {pendingAsk || answer?.need}
                    </Text>
                  </View>
                  {thinking ? (
                    <Text style={[styles.turnThinking, { color: textColor(isDark, 'muted') }]}>Linky is checking the network…</Text>
                  ) : answer ? (
                    <View style={styles.turn}>
                      <Text style={[styles.turnText, { color: textColor(isDark), backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }]}>
                        {answer.reply}
                      </Text>
                    </View>
                  ) : null}
                  {!thinking && answer?.none && answer.need && answer.kind !== 'chat' && answer.kind !== 'coach' ? (
                    scoutResult ? (
                      <View style={[styles.whyBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
                        <Text style={[styles.whyLabel, { color: textColor(isDark, 'muted') }]}>OUTSIDE LINKUP{scoutResult.cached ? ' · FROM MY NOTES' : ''}</Text>
                        <Text style={[styles.whyText, { color: textColor(isDark) }]}>{scoutResult.reply}</Text>
                      </View>
                    ) : (
                      <TouchableOpacity style={[styles.ghostBtn, { borderColor: border, alignSelf: 'flex-start', marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={searchOutside} disabled={scoutBusy}>
                        {scoutBusy ? <ActivityIndicator size="small" color={textColor(isDark, 'muted')} /> : <Globe size={13} color={textColor(isDark, 'secondary')} />}
                        <Text style={[styles.ghostBtnText, { color: textColor(isDark, 'secondary') }]}>{scoutBusy ? 'Searching the open web…' : 'Search outside LINKUP'}</Text>
                      </TouchableOpacity>
                    )
                  ) : null}
                  {!thinking && answer?.none && answer.need && answer.kind !== 'chat' && answer.kind !== 'coach' && answer.kind !== 'name' ? (
                    pointerText ? (
                      <View style={[styles.whyBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
                        <Text style={[styles.whyLabel, { color: textColor(isDark, 'muted') }]}>OUTSIDE LINKUP</Text>
                        <Text style={[styles.whyText, { color: textColor(isDark) }]}>{pointerText}</Text>
                      </View>
                    ) : (
                      <TouchableOpacity style={[styles.ghostBtn, { borderColor: border, alignSelf: 'flex-start', marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={askOutside} disabled={pointerBusy}>
                        {pointerBusy ? <ActivityIndicator size="small" color={textColor(isDark, 'muted')} /> : <Compass size={13} color={textColor(isDark, 'secondary')} />}
                        <Text style={[styles.ghostBtnText, { color: textColor(isDark, 'secondary') }]}>Where else to look</Text>
                      </TouchableOpacity>
                    )
                  ) : null}
                  {!thinking && answer?.none && answer.nearest.length ? (
                    <View style={styles.nearestRow}>
                      {answer.nearest.map((n) => (
                        <TouchableOpacity key={n.uid} style={[styles.nearest, { borderColor: border }]} onPress={() => navigation.navigate('Profile', { userId: n.uid })} activeOpacity={0.75}>
                          <Avatar uri={n.pic} size={30} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.nearestName, { color: textColor(isDark) }]} numberOfLines={1}>{n.name}</Text>
                            <Text style={[styles.nearestMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>{[n.role, n.city].filter(Boolean).join(' · ') || 'On LINKUP'}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
                {!thinking && scoutResult?.people?.length ? scoutResult.people.map((p) => (
                  <View key={p.url} style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
                    <View style={styles.cardTop}>
                      <View style={[styles.extBadge, { borderColor: border }]}><Globe size={16} color={textColor(isDark, 'secondary')} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.cardName, { color: textColor(isDark) }]} numberOfLines={1}>{p.name}</Text>
                        {p.headline ? <Text style={[styles.cardRole, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>{p.headline}</Text> : null}
                        <Text style={[styles.cardMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>{p.url.replace(/^https?:\/\//, '')}</Text>
                      </View>
                      <Text style={[styles.pill, { color: textColor(isDark, 'muted'), borderColor: border }]}>Not a member</Text>
                    </View>
                    {p.snippet ? (
                      <View style={[styles.whyBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
                        <Text style={[styles.whyLabel, { color: textColor(isDark, 'muted') }]}>WHAT GOOGLE SHOWS{p.matched?.length ? ` · matched: ${p.matched.slice(0, 3).join(', ')}` : ''}</Text>
                        <Text style={[styles.whyText, { color: textColor(isDark) }]} numberOfLines={4}>{p.snippet}</Text>
                      </View>
                    ) : null}
                    <View style={styles.actions}>
                      <TouchableOpacity style={[styles.ghostBtn, { borderColor: border }]} onPress={() => copyLine(p.opener)}>
                        <Text style={[styles.ghostBtnText, { color: textColor(isDark) }]}>Copy first line</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.primary, borderColor: isDark ? 'transparent' : 'rgba(0,0,0,0.12)' }]} onPress={() => Linking.openURL(p.url).catch(() => {})}>
                        <ExternalLink size={14} color="#000" />
                        <Text style={styles.primaryBtnText}>Open profile</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )) : null}
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

            {otherCards.length ? (
              <>
                <SectionTitle
                  title={answer ? 'Earlier cards' : 'Your cards'}
                  hint={home.limits.meetsPerDay == null ? 'Unlimited Meets · PLUS' : `${Math.max(0, home.limits.meetsPerDay - home.limits.meetsUsedToday)} of ${home.limits.meetsPerDay} Meets left today`}
                  isDark={isDark}
                />
                {otherCards.map((card) => (
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
                ))}
              </>
            ) : null}

            {asked.length ? (
              <>
                <SectionTitle title="Asked" isDark={isDark} />
                {asked.slice(0, 5).map((card) => (
                  <CardView key={card.id} card={card} isDark={isDark} busy={false} onMeet={() => {}} onSkip={() => {}} onSave={() => {}} onOpen={() => navigation.navigate('Profile', { userId: card.targetUid })} />
                ))}
              </>
            ) : null}

            {!pendingAsk && !answer && !otherCards.length ? (
              <View style={styles.chips}>
                <Text style={[styles.emptyLine, { color: textColor(isDark, 'muted') }]}>Try one of these, or type your own below.</Text>
                {['A Flutter developer in Harare for a paid fintech MVP', 'Someone who understands math', 'A co-founder with sales experience, equity'].map((s) => (
                  <TouchableOpacity key={s} style={[styles.chip, { borderColor: border, backgroundColor: surface }]} onPress={() => send(s)} activeOpacity={0.75}>
                    <Text style={[styles.chipText, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <View style={[styles.composerWrap, { paddingBottom: Math.max(10, insets.bottom + 6), backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg, borderTopColor: border }]}>
        <View style={[styles.composer, { backgroundColor: surface, borderColor: border }]}>
          <TextInput
            style={[styles.input, { color: textColor(isDark) }]}
            placeholder="Who do you need? A role, a skill or a name…"
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

      <PaywallModal
        visible={!!paywall}
        onClose={() => setPaywall(null)}
        feature="Linky asks & intros"
        description={paywall || 'PLUS gets 60 asks a day and unlimited Meets.'}
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
  extBadge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
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
  chips: { marginTop: 16, gap: 8 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  chipText: { fontSize: 12, fontWeight: '700', lineHeight: 17 },
  composerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderRadius: 18, borderWidth: 1, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, fontSize: 14, fontWeight: '500', maxHeight: 96, paddingVertical: 6 },
  sendBtn: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
