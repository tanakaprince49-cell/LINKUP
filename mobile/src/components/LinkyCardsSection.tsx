// "Asked" - the Linky card list that lives on the Explore page now instead of
// the Linky tab. Self-contained: it loads its own data,
// runs the Meet -> review/edit -> send flow (the same double opt-in the Linky
// tab uses), and only ever writes through /api/linky.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { COLORS, textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
import PaywallModal from './PaywallModal';
import { Trophy, Clock, Send, X, Zap } from 'lucide-react-native';
import {
  LinkyApiError,
  LinkyCard,
  linkyApproveMeet,
  linkyCancelMeet,
  linkyCard,
  linkyHome,
  linkyMeet,
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

export default function LinkyCardsSection() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const isDark = theme === 'dark';
  const isFocused = useIsFocused();
  const [cards, setCards] = useState<LinkyCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ cardId: string; title: string; body: string; note?: string } | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [paywall, setPaywall] = useState<string | null>(null);

  const surface = isDark ? COLORS.darkBgSec : '#FFFFFF';
  const border = isDark ? COLORS.darkBorder : COLORS.lightBorder;
  const inputBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';

  const load = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const h = await linkyHome();
      setCards(h.cards || []);
      setLoaded(true);
    } catch {
      // the Explore page must never break because Linky is slow - show nothing
      setLoaded(true);
    }
  }, [user?.uid]);

  useEffect(() => { if (isFocused) void load(); }, [isFocused, load]);

  const fail = (err: unknown, title: string) => {
    if (err instanceof LinkyApiError && err.status === 402) setPaywall(err.message);
    else notifyUser(title, err instanceof Error ? err.message : 'Please try again.');
  };

  const onMeet = async (card: LinkyCard) => {
    if (busyId) return;
    setBusyId(card.id);
    try {
      const r = await linkyMeet(card.id);
      if (r.matchId) {
        navigation.navigate('Chat', { matchId: r.matchId, otherUser: { uid: card.targetUid, displayName: card.targetName, profilePic: card.targetPic }, draftMessage: r.opener || card.opener || '' });
      } else if (r.needsApproval) {
        setDraft({ cardId: card.id, title: `To ${r.targetName || card.targetName}`, body: r.pitch || r.opener || '', note: r.note });
      } else {
        notifyUser('Asked', `Linky asked ${card.targetName}. You will hear back here.`);
      }
      await load();
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
      setCards((list) => (status === 'skip' ? list.filter((c) => c.id !== card.id) : list.map((c) => (c.id === card.id ? { ...c, status } : c))));
    } catch (err) {
      fail(err, 'Could not update card');
    } finally {
      setBusyId(null);
    }
  };

  const sendDraft = async () => {
    if (!draft || draftBusy) return;
    setDraftBusy(true);
    try {
      const r = await linkyApproveMeet(draft.cardId, draft.body.trim());
      setDraft(null);
      notifyUser(r.matchId ? 'You two are already connected' : 'Sent', r.matchId ? 'No intro needed - open the chat.' : `Linky passed your words to them${r.meetsLeft != null ? ` (${r.meetsLeft} Meets left today)` : '.'}`);
      await load();
    } catch (err) {
      notifyUser('Nothing was sent', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setDraftBusy(false);
    }
  };

  const dropDraft = async () => {
    if (!draft) return;
    const cardId = draft.cardId;
    setDraft(null);
    try { await linkyCancelMeet(cardId); } catch { /* nothing was sent anyway */ }
    await load();
  };

  const asked = cards.filter((c) => c.status === 'meet' || c.status === 'declined');

  if (!loaded) return null;
  if (!asked.length) return null;

  const renderCard = (card: LinkyCard, readonly: boolean) => {
    const requested = card.status === 'meet';
    const declined = card.status === 'declined';
    return (
      <View key={card.id} style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
        <TouchableOpacity style={styles.cardTop} onPress={() => navigation.navigate('Profile', { userId: card.targetUid })} activeOpacity={0.75}>
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
          <Text style={[styles.squadTag, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>
            {`Squad${(card.squadSize || 0) > 1 ? ` of ${card.squadSize}` : ''} - ${card.squadRole}`}
          </Text>
        ) : null}
        {card.plus ? (
          <View style={styles.plusTagRow}>
            <View style={styles.plusTag}>
              <Zap size={11} color="#000" />
              <Text style={styles.plusTagText} numberOfLines={1}>PLUS member</Text>
            </View>
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
        {card.why ? (
          <View style={[styles.whyBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
            <Text style={[styles.whyLabel, { color: textColor(isDark, 'muted') }]}>WHY LINKY PICKED THEM</Text>
            <Text style={[styles.whyText, { color: textColor(isDark) }]}>{card.why}</Text>
          </View>
        ) : null}
        {readonly || requested ? (
          <View style={styles.stateRow}>
            {requested ? <Clock size={13} color={textColor(isDark, 'muted')} /> : <X size={13} color={textColor(isDark, 'muted')} />}
            <Text style={[styles.stateText, { color: textColor(isDark, 'muted') }]}>
              {requested ? 'Asked. Linky will tell you when they answer.' : declined ? 'Not this time.' : 'On your list.'}
            </Text>
          </View>
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.ghostBtn, { borderColor: border }]} onPress={() => onCardStatus(card, 'skip')} disabled={busyId === card.id}>
              <Text style={[styles.ghostBtnText, { color: textColor(isDark, 'secondary') }]}>Skip</Text>
            </TouchableOpacity>
            {card.status !== 'saved' ? (
              <TouchableOpacity style={[styles.ghostBtn, { borderColor: border }]} onPress={() => onCardStatus(card, 'saved')} disabled={busyId === card.id}>
                <Text style={[styles.ghostBtnText, { color: textColor(isDark, 'secondary') }]}>Save</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.primary, borderColor: isDark ? 'transparent' : 'rgba(0,0,0,0.12)' }]} onPress={() => onMeet(card)} disabled={busyId === card.id} activeOpacity={0.85}>
              {busyId === card.id ? <ActivityIndicator size="small" color="#000" /> : (
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

  return (
    <View style={styles.wrap}>
      {asked.length ? (
        <View style={{ paddingHorizontal: 16 }}>
          <SectionTitle title="Asked" hint={`${asked.length} ${asked.length === 1 ? 'intro' : 'intros'} out`} isDark={isDark} />
          {asked.slice(0, 5).map((card) => renderCard(card, true))}
        </View>
      ) : null}

      <Modal visible={!!draft} transparent animationType="fade" onRequestClose={() => void dropDraft()}>
        {draft ? (
          <View style={styles.sheetWrap}>
            <View style={[styles.sheet, { borderColor: border, backgroundColor: surface }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[styles.sheetTitle, { color: textColor(isDark) }]} numberOfLines={2}>Before it goes to them</Text>
                <TouchableOpacity onPress={() => void dropDraft()} style={{ marginLeft: 'auto', padding: 4 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
                {draft.note || 'Nothing has been sent yet - this reaches them only when you press send. Edit it freely; it is your voice, not mine.'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <TouchableOpacity
                  onPress={() => void sendDraft()}
                  disabled={draftBusy || draft.body.trim().length < 24}
                  style={[styles.sheetBtn, { backgroundColor: COLORS.primary, opacity: draftBusy || draft.body.trim().length < 24 ? 0.5 : 1 }]}
                >
                  {draftBusy ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.sheetBtnText}>SEND IT</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => void dropDraft()} style={[styles.sheetGhost, { borderColor: border }]}>
                  <Text style={[styles.sheetGhostText, { color: textColor(isDark, 'secondary') }]}>Not now</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}
      </Modal>

      <PaywallModal visible={!!paywall} onClose={() => setPaywall(null)} feature="Linky asks & intros" description={paywall || 'PLUS gets 60 asks a day and unlimited Meets.'} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
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
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  squadTag: { fontSize: 11, fontWeight: '800', marginTop: 8 },
  plusTagRow: { flexDirection: 'row', marginTop: 8 },
  plusTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#DFFB3F', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  plusTagText: { fontSize: 10, fontWeight: '900', color: '#000', letterSpacing: 0.4 },
  pairNote: { fontSize: 11.5, marginTop: 8, fontStyle: 'italic' },
  whyBox: { borderRadius: 12, padding: 10, marginTop: 12 },
  whyLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  whyText: { fontSize: 13, lineHeight: 19, fontWeight: '600', marginTop: 3 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'flex-end' },
  ghostBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1 },
  ghostBtnText: { fontSize: 12, fontWeight: '800' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 12, borderWidth: 1, minWidth: 84, justifyContent: 'center' },
  primaryBtnText: { fontSize: 12, fontWeight: '900', color: '#000' },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  stateText: { fontSize: 12, fontWeight: '700' },
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
});
