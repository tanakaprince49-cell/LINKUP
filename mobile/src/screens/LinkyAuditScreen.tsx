// "What Linky knows about you" — every fact the matcher uses, an editable
// "tell Linky more" section (notes, extra skills, what you are after), the
// history of asks / cards / intros, what is NOT used, and a Forget button.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check, EyeOff, Eye, Trash2, X } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
import { LinkyAudit, LinkyHidden, OFFER_LABELS, linkyAudit, linkyFacts, linkyForget, linkyHideFact, linkyRemoveAsk } from '../lib/linkyApi';

const fmtDate = (ms?: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
const splitTags = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
const EMPTY_HIDDEN: LinkyHidden = { skills: [], industries: [], lookingFor: [] };
const isHidden = (value: string, hide: string[] = []) =>
  hide.some((h) => String(h).toLowerCase() === String(value).toLowerCase());
const countHidden = (h: LinkyHidden = EMPTY_HIDDEN) =>
  (h.skills?.length || 0) + (h.industries?.length || 0) + (h.lookingFor?.length || 0) +
  [h.notes, h.bio, h.company, h.city].filter(Boolean).length;

type Ui = { isDark: boolean; border: string; surface: string; inputBg: string };

// Module-level so their identity is stable across renders (an inline
// component type would remount the TextInputs on every keystroke).
const BlockView = ({ title, children, hint, isDark, border, surface }: Ui & { title: string; children: React.ReactNode; hint?: string }) => (
  <View style={{ marginTop: 18 }}>
    <Text style={[styles.section, { color: textColor(isDark, 'muted') }]}>{title}</Text>
    {hint ? <Text style={[styles.hint, { color: textColor(isDark, 'secondary') }]}>{hint}</Text> : null}
    <View style={[styles.box, { borderColor: border, backgroundColor: surface }]}>{children}</View>
  </View>
);
const LineView = ({ k, v, isDark }: { k: string; v: string; isDark: boolean }) => (
  v ? (
    <View style={styles.line}>
      <Text style={[styles.k, { color: textColor(isDark, 'muted') }]}>{k}</Text>
      <Text style={[styles.v, { color: textColor(isDark) }]}>{v}</Text>
    </View>
  ) : null
);
const FieldView = ({ label, value, onChange, placeholder, multiline, isDark, border, inputBg }: Ui & { label: string; value: string; onChange: (v: string) => void; placeholder: string; multiline?: boolean }) => (
  <View style={styles.line}>
    <Text style={[styles.k, { color: textColor(isDark, 'muted') }]}>{label}</Text>
    <TextInput
      style={[styles.input, { color: textColor(isDark), backgroundColor: inputBg, borderColor: border }, multiline ? styles.inputMulti : null]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor="#999"
      multiline={multiline}
      maxLength={multiline ? 800 : 400}
    />
  </View>
);

// A fact Linky can see, with the affordance to take it away. Tapping is the
// whole interaction: no edit mode, no confirm dialog for something reversible.
const FactChip = ({ label, hidden, onToggle, isDark, border, surface }: { label: string; hidden: boolean; onToggle: () => void; isDark: boolean; border: string; surface: string }) => (
  <TouchableOpacity
    onPress={onToggle}
    activeOpacity={0.75}
    accessibilityRole="button"
    accessibilityLabel={hidden ? `Let Linky use ${label} again` : `Hide ${label} from Linky`}
    style={[styles.chip, { borderColor: border, backgroundColor: hidden ? (isDark ? 'rgba(225,29,72,0.14)' : 'rgba(225,29,72,0.07)') : surface }]}
  >
    {hidden ? <EyeOff size={12} color={COLORS.danger} /> : <Eye size={12} color={textColor(isDark, 'muted')} />}
    <Text style={[styles.chipText, { color: hidden ? COLORS.danger : textColor(isDark), textDecorationLine: hidden ? 'line-through' : 'none' }]}>{label}</Text>
  </TouchableOpacity>
);

export default function LinkyAuditScreen({ navigation }: any) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [data, setData] = useState<LinkyAudit | null>(null);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [skills, setSkills] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busyFact, setBusyFact] = useState('');
  const border = isDark ? COLORS.darkBorder : COLORS.lightBorder;
  const surface = isDark ? COLORS.darkBgSec : '#FFFFFF';
  const inputBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';

  const load = useCallback(async () => {
    try {
      const a = await linkyAudit();
      setData(a);
      setError('');
      setNotes(a.told?.notes || '');
      setSkills((a.told?.skills || []).join(', '));
      setLookingFor((a.told?.lookingFor || []).join(', '));
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Linky is unavailable.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const r = await linkyFacts({ notes: notes.trim(), skills: splitTags(skills), lookingFor: splitTags(lookingFor) });
      setData((d) => (d ? { ...d, told: r.facts } : d));
      setDirty(false);
      notifyUser('Saved', 'Linky uses this from your next ask, and when he checks other people\'s asks against you.');
    } catch (err) {
      notifyUser('Could not save', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const forget = () => {
    notifyUser('Forget everything?', 'Deletes your cards and what you told Linky, unlinks Telegram / WhatsApp. Your LINKUP profile and chats stay.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: async () => { try { await linkyForget(); await load(); notifyUser('Done', 'Linky forgot your cards and notes.'); } catch (err) { notifyUser('Could not forget', err instanceof Error ? err.message : undefined); } } },
    ]);
  };

  const hidden = data?.hidden || EMPTY_HIDDEN;
  const toggleFact = async (kind: string, value: string, willHide: boolean) => {
    const key = `${kind}:${value}`;
    if (busyFact) return;
    setBusyFact(key);
    try {
      const r = await linkyHideFact(kind, value, willHide);
      setData((d) => (d ? { ...d, hidden: r.hidden, told: { ...(d.told || ({} as any)), hidden: r.hidden } } : d));
      notifyUser(
        willHide ? 'Linky will not use that' : 'Back in play',
        willHide
          ? `He stops matching and quoting "${value}". Your LINKUP profile still shows it - this only changes what Linky knows.`
          : `He can use "${value}" again from the next ask.`
      );
    } catch (err) {
      notifyUser('Could not change that', err instanceof Error ? err.message : undefined);
    } finally {
      setBusyFact('');
    }
  };
  const forgetAsk = async (id: string, need: string) => {
    if (busyFact) return;
    setBusyFact(`ask:${id}`);
    try {
      await linkyRemoveAsk(id);
      setData((d) => (d ? { ...d, asks: (d.asks || []).filter((a) => a.id !== id) } : d));
      notifyUser('Forgotten', `Linky dropped "${need.slice(0, 40)}" from what he remembers about you.`);
    } catch (err) {
      notifyUser('Could not forget that', err instanceof Error ? err.message : undefined);
    } finally {
      setBusyFact('');
    }
  };

  const ui = { isDark, border, surface, inputBg };
  const field = (label: string, value: string, onChange: (v: string) => void, placeholder: string, multiline?: boolean) => (
    <FieldView label={label} value={value} onChange={(v) => { onChange(v); setDirty(true); }} placeholder={placeholder} multiline={multiline} {...ui} />
  );

  return (
    <View style={[styles.root, appBackground(isDark)]}>
      <SafeAreaView edges={['top']} style={[styles.header, { borderBottomColor: border }]}>
        <TouchableOpacity onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))} style={styles.headerBtn}>
          <ArrowLeft size={20} color={textColor(isDark)} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>What Linky knows about you</Text>
        <View style={styles.headerBtn} />
      </SafeAreaView>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {!data && !error ? <ActivityIndicator style={{ marginTop: 40 }} color={textColor(isDark, 'muted')} /> : null}
          {error ? <Text style={[styles.v, { color: textColor(isDark) }]}>{error}</Text> : null}
          {data ? (
            <>
              <Text style={[styles.intro, { color: textColor(isDark, 'secondary') }]}>
                Linky matches on the facts below and nothing else. Your profile facts come from your LINKUP profile; the "Tell Linky more" section is yours to edit any time.
              </Text>
              <BlockView {...ui} title="TELL LINKY MORE" hint="Anything your profile does not say: what you are building, what you can help with, who you want to meet. Linky cites these when he matches you.">
                {field('Notes for Linky', notes, setNotes, 'e.g. Building a payments app for informal traders in Mbare. Strong on sales and ops, need technical people. Happy to advise first-time founders on pricing.', true)}
                {field('Extra skills (comma separated)', skills, setSkills, 'e.g. Flutter, mobile money integrations, B2B sales')}
                {field('Who you want to meet (comma separated)', lookingFor, setLookingFor, 'e.g. Angel investors in Harare, Flutter developers, agritech founders')}
                <TouchableOpacity onPress={save} disabled={saving || !dirty} style={[styles.saveBtn, { backgroundColor: COLORS.primary, borderColor: isDark ? 'transparent' : 'rgba(0,0,0,0.12)', opacity: saving || !dirty ? 0.5 : 1 }]} activeOpacity={0.85}>
                  {saving ? <ActivityIndicator size="small" color="#000" /> : (
                    <>
                      <Check size={14} color="#000" />
                      <Text style={styles.saveText}>{dirty ? 'Save' : data.told?.updatedAt ? `Saved ${fmtDate(data.told.updatedAt)}` : 'Save'}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </BlockView>
              <BlockView
                {...ui}
                title="PROFILE FACTS LINKY MATCHES ON"
                hint="Tap any fact to take it away from Linky. Your LINKUP profile keeps showing it - he just stops matching on it and quoting it. Tap it again to give it back."
              >
                <LineView isDark={isDark} k="Name" v={data.facts.name} />
                <LineView isDark={isDark} k="Role" v={data.facts.role} />
                <View style={styles.line}>
                  <Text style={[styles.k, { color: textColor(isDark, 'muted') }]}>Company · City</Text>
                  <View style={styles.chipRow}>
                    {data.facts.company ? <FactChip label={`at ${data.facts.company}`} hidden={!!hidden.company} onToggle={() => toggleFact('company', data.facts.company, !hidden.company)} isDark={isDark} border={border} surface={surface} /> : null}
                    {data.facts.city ? <FactChip label={data.facts.city} hidden={!!hidden.city} onToggle={() => toggleFact('city', data.facts.city, !hidden.city)} isDark={isDark} border={border} surface={surface} /> : null}
                  </View>
                </View>
                {['skills', 'industries', 'lookingFor'].map((kind) => {
                  const values = (data.facts[kind === 'lookingFor' ? 'lookingFor' : kind] || []) as string[];
                  const extra = kind === 'skills' ? (data.told?.skills || []) : kind === 'lookingFor' ? (data.told?.lookingFor || []) : [];
                  const all = Array.from(new Set([...values, ...extra]));
                  if (!all.length) return null;
                  return (
                    <View style={styles.line} key={kind}>
                      <Text style={[styles.k, { color: textColor(isDark, 'muted') }]}>
                        {kind === 'lookingFor' ? 'Looking for' : kind.charAt(0).toUpperCase() + kind.slice(1)}
                      </Text>
                      <View style={styles.chipRow}>
                        {all.map((v) => (
                          <FactChip
                            key={`${kind}:${v}`}
                            label={v}
                            hidden={isHidden(v, (hidden as any)[kind] || [])}
                            onToggle={() => toggleFact(kind, v, !isHidden(v, (hidden as any)[kind] || []))}
                            isDark={isDark}
                            border={border}
                            surface={surface}
                          />
                        ))}
                      </View>
                    </View>
                  );
                })}
                <LineView isDark={isDark} k="Goals" v={data.facts.goals} />
                {data.facts.bio ? (
                  <View style={styles.line}>
                    <Text style={[styles.k, { color: textColor(isDark, 'muted') }]}>Bio {hidden.bio ? '· hidden from Linky' : ''}</Text>
                    <Text style={[styles.v, { color: textColor(isDark), opacity: hidden.bio ? 0.45 : 1 }]}>{data.facts.bio}</Text>
                    <TouchableOpacity onPress={() => toggleFact('bio', data.facts.bio, !hidden.bio)} style={styles.inlineAction} accessibilityRole="button">
                      <Text style={[styles.inlineActionText, { color: COLORS.primary }]}>{hidden.bio ? 'Let him read it again' : 'Hide this from Linky'}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                {data.told?.notes ? (
                  <View style={styles.line}>
                    <Text style={[styles.k, { color: textColor(isDark, 'muted') }]}>Your notes for Linky {hidden.notes ? '· hidden' : ''}</Text>
                    <Text style={[styles.v, { color: textColor(isDark), opacity: hidden.notes ? 0.45 : 1 }]}>{data.told.notes}</Text>
                    <TouchableOpacity onPress={() => toggleFact('notes', 'notes', !hidden.notes)} style={styles.inlineAction} accessibilityRole="button">
                      <Text style={[styles.inlineActionText, { color: COLORS.primary }]}>{hidden.notes ? 'Use my notes again' : 'Hide my notes from Linky'}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                {!data.facts.role && !(data.facts.skills || []).length && !data.facts.bio ? (
                  <Text style={[styles.v, { color: textColor(isDark, 'muted') }]}>Your profile is nearly empty, so Linky has little to cite. Add a role, skills and a bio.</Text>
                ) : null}
              </BlockView>
              {countHidden(hidden) ? (
                <BlockView {...ui} title={`HELD BACK FROM LINKY (${countHidden(hidden)})`} hint="These are the facts he is not allowed to use. Tap one to give it back, or clear them all in one go.">
                  {['skills', 'industries', 'lookingFor'].flatMap((kind) => ((hidden as any)[kind] || []).map((v: string) => (
                    <FactChip key={`h:${kind}:${v}`} label={`${v} · ${kind === 'lookingFor' ? 'looking for' : kind}`} hidden onToggle={() => toggleFact(kind, v, false)} isDark={isDark} border={border} surface={surface} />
                  )))}
                  {(['notes', 'bio', 'company', 'city'] as const).filter((k) => (hidden as any)[k]).map((k) => (
                    <FactChip key={`f:${k}`} label={k.charAt(0).toUpperCase() + k.slice(1)} hidden onToggle={() => toggleFact(k, k, false)} isDark={isDark} border={border} surface={surface} />
                  ))}
                </BlockView>
              ) : null}
              <BlockView {...ui} title="SIGNALS">
                <LineView isDark={isDark} k="Plan" v={data.signals.plus ? 'PLUS (60 searches a day, unlimited Meets)' : 'Free (2 searches a day, 2 Meets a day)'} />
                <LineView isDark={isDark} k="Free on any plan" v="Looking someone up by name, chit-chat, drafting a message, hiding a fact" />
                <LineView isDark={isDark} k="Asks used today" v={String(data.signals.asksUsedToday ?? 0)} />
                <LineView isDark={isDark} k="Meets used today" v={String(data.signals.meetsUsedToday)} />
                <LineView isDark={isDark} k="Inbound intros this week" v={`${data.signals.inboundThisWeek} of ${data.signals.inboundCap}`} />
                <LineView isDark={isDark} k="Open to" v={(data.signals.openTo || []).map((o: string) => (OFFER_LABELS as any)[o] || o).join(', ')} />
                <LineView isDark={isDark} k="People you muted" v={String(data.signals.mutedCount)} />
                <LineView isDark={isDark} k="Bots" v={[data.signals.channels?.telegram ? 'Telegram' : '', data.signals.channels?.whatsapp ? 'WhatsApp' : ''].filter(Boolean).join(', ') || 'none linked'} />
              </BlockView>
              <BlockView {...ui} title={`THINGS YOU ASKED (${data.asks.length})`}>
                {data.asks.length ? data.asks.slice(0, 20).map((a) => (
                  <View style={styles.askRow} key={a.id}>
                    <LineView isDark={isDark} k={`${fmtDate(a.createdAt)} · ${a.none ? 'nobody fit' : `${a.cards} ${a.cards === 1 ? 'person' : 'people'}`}${a.source !== 'app' ? ` · ${a.source}` : ''}`} v={a.need} />
                    <TouchableOpacity onPress={() => forgetAsk(a.id, a.need)} disabled={busyFact === `ask:${a.id}`} style={styles.forgetOne} accessibilityRole="button" accessibilityLabel={`Forget this ask`}>
                      <X size={14} color={textColor(isDark, 'muted')} />
                    </TouchableOpacity>
                  </View>
                )) : <Text style={[styles.v, { color: textColor(isDark, 'muted') }]}>None yet.</Text>}
              </BlockView>
              <BlockView {...ui} title={`CARDS LINKY SHOWED YOU (${data.cards.length})`}>
                {data.cards.length ? data.cards.slice(0, 30).map((c) => (
                  <LineView isDark={isDark} key={c.id} k={`${c.status} · ${fmtDate(c.createdAt)}`} v={`${c.targetName}: ${c.why}`} />
                )) : <Text style={[styles.v, { color: textColor(isDark, 'muted') }]}>None yet.</Text>}
              </BlockView>
              <BlockView {...ui} title={`INTROS (${data.introsSent.length} sent · ${data.introsReceived.length} received)`}>
                {[...data.introsSent, ...data.introsReceived].length ? [...data.introsSent, ...data.introsReceived].map((i) => (
                  <LineView isDark={isDark} key={i.id} k={`${i.status} · ${fmtDate(i.createdAt)}`} v={`${i.requesterName} → ${i.targetName}: ${i.need}`} />
                )) : <Text style={[styles.v, { color: textColor(isDark, 'muted') }]}>None yet.</Text>}
              </BlockView>
              <BlockView {...ui} title="WHERE THIS COMES FROM">
                {data.sources.map((s) => <Text key={s} style={[styles.v, { color: textColor(isDark) }]}>• {s}</Text>)}
              </BlockView>
              <BlockView {...ui} title="WHAT LINKY DOES NOT USE">
                {data.notUsed.map((s) => <Text key={s} style={[styles.v, { color: textColor(isDark) }]}>• {s}</Text>)}
              </BlockView>
              <TouchableOpacity onPress={forget} style={[styles.forget, { borderColor: border }]}>
                <Trash2 size={14} color={COLORS.danger} />
                <Text style={[styles.forgetText, { color: COLORS.danger }]}>Forget my cards, notes and bot links</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 10, borderBottomWidth: 1, gap: 6 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '900' },
  content: { padding: 16, paddingBottom: 80 },
  intro: { fontSize: 13, lineHeight: 19, fontWeight: '500' },
  section: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginBottom: 8 },
  hint: { fontSize: 12, lineHeight: 17, fontWeight: '500', marginTop: -4, marginBottom: 8 },
  box: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  line: { gap: 4 },
  k: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  v: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, fontWeight: '600' },
  inputMulti: { minHeight: 96, textAlignVertical: 'top' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 12, paddingVertical: 11, marginTop: 2 },
  saveText: { fontSize: 12, fontWeight: '900', color: '#000' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: '700' },
  inlineAction: { alignSelf: 'flex-start', marginTop: 2 },
  inlineActionText: { fontSize: 11, fontWeight: '900' },
  askRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  forgetOne: { padding: 6, marginTop: 14 },
  forget: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 24 },
  forgetText: { fontSize: 12, fontWeight: '900' },
});
