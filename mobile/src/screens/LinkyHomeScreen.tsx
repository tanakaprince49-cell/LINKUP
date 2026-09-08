// Linky tab — replaces the swipe deck.
//
// Home = today's intro cards (Meet / Skip / Save), intro requests waiting on
// you (Accept / Decline / Not now), your open intents, and a composer that
// either interviews you into a new intent or hands off to the Linky chat.
// Everything here goes through /api/linky; the app never writes the intent /
// intro collections itself.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { ArrowUp, Check, Clock, MessageSquare, Plus, Send, Settings2, ShieldCheck, X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
import PaywallModal from '../components/PaywallModal';
import {
  LinkyApiError,
  LinkyCard,
  LinkyHome,
  LinkyIntro,
  OFFER_LABELS,
  URGENCY_LABELS,
  linkyCard,
  linkyCloseIntent,
  linkyHome,
  linkyIntake,
  linkyIntakeReset,
  linkyMeet,
  linkyRespond,
  linkySaveIntent,
} from '../lib/linkyApi';

const FALLBACK_AVATAR = 'https://ui-avatars.com/api/?name=U&background=DFFB3F&color=000&size=80';

type IntakeTurn = { role: 'user' | 'assistant'; content: string };

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
  const [turns, setTurns] = useState<IntakeTurn[]>([]);
  const [draft, setDraft] = useState<any>(null);
  const [saving, setSaving] = useState(false);
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
      if (h.intake?.history?.length) {
        setTurns(h.intake.history);
        setDraft(h.intake.draft || null);
      } else {
        setTurns([]);
        setDraft(null);
      }
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

  const onCloseIntent = (intentId: string, need: string) => {
    notifyUser('Close this intent?', need, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Close', style: 'destructive', onPress: async () => { try { await linkyCloseIntent(intentId); await load(true); } catch (err) { fail(err, 'Could not close'); } } },
    ]);
  };

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || thinking) return;
    setInput('');
    setTurns((t) => [...t, { role: 'user', content: msg }]);
    setThinking(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    try {
      const out = await linkyIntake(msg);
      setTurns((t) => [...t, { role: 'assistant', content: out.reply }]);
      setDraft(out.ready ? out.intent : null);
    } catch (err) {
      if (err instanceof LinkyApiError && err.status === 402) setPaywall(err.message);
      setTurns((t) => [...t, { role: 'assistant', content: err instanceof Error ? err.message : 'I am offline right now. Try again in a moment.' }]);
    } finally {
      setThinking(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  const saveDraft = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const r = await linkySaveIntent(draft);
      setTurns([]);
      setDraft(null);
      await load(true);
      notifyUser('Intent saved', r.cards.length ? `Linky already found ${r.cards.length} ${r.cards.length === 1 ? 'person' : 'people'} with a cited reason. Cards are below.` : 'Nothing cited yet. Linky checks every hour and sends you one brief a day when someone fits.');
    } catch (err) {
      fail(err, 'Could not save intent');
    } finally {
      setSaving(false);
    }
  };

  const cancelIntake = async () => {
    setTurns([]);
    setDraft(null);
    try { await linkyIntakeReset(); } catch {}
  };

  const fresh = useMemo(() => (home?.cards || []).filter((c) => c.status === 'new' || c.status === 'saved'), [home?.cards]);
  const asked = useMemo(() => (home?.cards || []).filter((c) => c.status === 'meet' || c.status === 'declined'), [home?.cards]);
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
                Tell me who you need. I check the network every hour and only bring you people I can cite a reason for.
              </Text>
            </View>
          </View>
          <View style={styles.heroLinks}>
            <TouchableOpacity style={[styles.heroLink, { borderColor: border }]} onPress={() => navigation.navigate('Linky')}>
              <MessageSquare size={13} color={textColor(isDark, 'secondary')} />
              <Text style={[styles.heroLinkText, { color: textColor(isDark, 'secondary') }]}>Ask Linky</Text>
            </TouchableOpacity>
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

            <SectionTitle
              title="Today's intros"
              hint={home.limits.meetsPerDay == null ? 'Unlimited Meets · PLUS' : `${Math.max(0, home.limits.meetsPerDay - home.limits.meetsUsedToday)} of ${home.limits.meetsPerDay} Meets left today`}
              isDark={isDark}
            />
            {fresh.length ? fresh.map((card) => (
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
            )) : (
              <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
                <Text style={[styles.whyText, { color: textColor(isDark) }]}>
                  {home.intents.length
                    ? 'Nothing worth your time yet. Linky re-checks every hour and will send one brief a day when someone fits. No filler.'
                    : 'No open intent. Tell Linky who you need below and he starts looking.'}
                </Text>
              </View>
            )}

            {asked.length ? (
              <>
                <SectionTitle title="Asked" isDark={isDark} />
                {asked.slice(0, 5).map((card) => (
                  <CardView key={card.id} card={card} isDark={isDark} busy={false} onMeet={() => {}} onSkip={() => {}} onSave={() => {}} onOpen={() => navigation.navigate('Profile', { userId: card.targetUid })} />
                ))}
              </>
            ) : null}

            <SectionTitle title="Your intents" hint={`${home.intents.length} of ${home.limits.activeIntents} open`} isDark={isDark} />
            {home.intents.map((intent) => (
              <View key={intent.id} style={[styles.intentRow, { backgroundColor: surface, borderColor: border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.intentNeed, { color: textColor(isDark) }]}>{intent.need}</Text>
                  <Text style={[styles.intentMeta, { color: textColor(isDark, 'muted') }]}>
                    {[OFFER_LABELS[intent.offer], URGENCY_LABELS[intent.urgency], intent.location || (intent.remote ? 'Remote' : ''), `${intent.matchCount} ${intent.matchCount === 1 ? 'card' : 'cards'}`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => onCloseIntent(intent.id, intent.need)} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <X size={14} color={textColor(isDark, 'muted')} />
                </TouchableOpacity>
              </View>
            ))}
            {!home.intents.length ? (
              <Text style={[styles.emptyLine, { color: textColor(isDark, 'muted') }]}>
                {home.plus ? 'Up to 3 open intents on PLUS.' : 'Free members run 1 open intent at a time. PLUS runs 3 with unlimited Meets.'}
              </Text>
            ) : null}

            {turns.length ? (
              <>
                <SectionTitle title="New intent" hint="Linky interviews you so the match is precise" isDark={isDark} />
                <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
                  {turns.map((t, i) => (
                    <View key={`${i}-${t.role}`} style={[styles.turn, t.role === 'user' ? styles.turnUser : null]}>
                      <Text style={[styles.turnText, { color: textColor(isDark), backgroundColor: t.role === 'user' ? COLORS.primary : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)') }, t.role === 'user' && COLORS.primary === '#FFFFFF' ? { borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)', color: '#000' } : t.role === 'user' ? { color: '#000' } : null]}>
                        {t.content}
                      </Text>
                    </View>
                  ))}
                  {thinking ? <Text style={[styles.turnThinking, { color: textColor(isDark, 'muted') }]}>Linky is thinking…</Text> : null}
                  {draft ? (
                    <View style={styles.draftActions}>
                      <TouchableOpacity style={[styles.ghostBtn, { borderColor: border }]} onPress={cancelIntake} disabled={saving}>
                        <Text style={[styles.ghostBtnText, { color: textColor(isDark, 'secondary') }]}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.primary, borderColor: isDark ? 'transparent' : 'rgba(0,0,0,0.12)' }]} onPress={saveDraft} disabled={saving} activeOpacity={0.85}>
                        {saving ? <ActivityIndicator size="small" color="#000" /> : (
                          <>
                            <Plus size={13} color="#000" />
                            <Text style={styles.primaryBtnText}>Save intent</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={cancelIntake} style={{ alignSelf: 'flex-end', marginTop: 6 }}>
                      <Text style={[styles.ghostBtnText, { color: textColor(isDark, 'muted') }]}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            ) : null}

            {!turns.length ? (
              <View style={styles.chips}>
                {['I need a Flutter developer for a fintech MVP, paid, Harare', 'Looking for a co-founder with sales experience, equity', 'Want 20 minutes with someone who has raised from local angels'].map((s) => (
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
            placeholder={turns.length ? 'Answer Linky…' : 'Who do you need? Tell Linky…'}
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
        feature="Linky intents & intros"
        description={paywall || 'PLUS runs 3 open intents and unlimited Meets.'}
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
  intentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
  intentNeed: { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  intentMeta: { fontSize: 11, fontWeight: '600', marginTop: 3 },
  closeBtn: { padding: 4 },
  emptyLine: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  turn: { marginBottom: 8, alignItems: 'flex-start' },
  turnUser: { alignItems: 'flex-end' },
  turnText: { fontSize: 13, lineHeight: 19, fontWeight: '600', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, maxWidth: '88%', overflow: 'hidden' },
  turnThinking: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  draftActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 8 },
  chips: { marginTop: 16, gap: 8 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11 },
  chipText: { fontSize: 12, fontWeight: '700', lineHeight: 17 },
  composerWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderRadius: 18, borderWidth: 1, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, fontSize: 14, fontWeight: '500', maxHeight: 96, paddingVertical: 6 },
  sendBtn: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
