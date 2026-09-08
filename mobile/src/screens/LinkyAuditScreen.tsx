// "What Linky knows about you" — every fact and signal the matcher uses, the
// history of intents / cards / intros, what is NOT used, and a Forget button.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Trash2 } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
import { LinkyAudit, OFFER_LABELS, URGENCY_LABELS, linkyAudit, linkyForget } from '../lib/linkyApi';

const fmtDate = (ms?: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

export default function LinkyAuditScreen({ navigation }: any) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [data, setData] = useState<LinkyAudit | null>(null);
  const [error, setError] = useState('');
  const border = isDark ? COLORS.darkBorder : COLORS.lightBorder;
  const surface = isDark ? COLORS.darkBgSec : '#FFFFFF';

  const load = useCallback(async () => {
    try { setData(await linkyAudit()); setError(''); } catch (err) { setError(err instanceof Error ? err.message : 'Linky is unavailable.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const forget = () => {
    notifyUser('Forget everything?', 'Closes your intents, deletes your cards, unlinks Telegram / WhatsApp. Your LINKUP profile and chats stay.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: async () => { try { await linkyForget(); await load(); notifyUser('Done', 'Linky forgot your intents and cards.'); } catch (err) { notifyUser('Could not forget', err instanceof Error ? err.message : undefined); } } },
    ]);
  };

  const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={{ marginTop: 18 }}>
      <Text style={[styles.section, { color: textColor(isDark, 'muted') }]}>{title}</Text>
      <View style={[styles.box, { borderColor: border, backgroundColor: surface }]}>{children}</View>
    </View>
  );
  const Line = ({ k, v }: { k: string; v: string }) => (
    v ? (
      <View style={styles.line}>
        <Text style={[styles.k, { color: textColor(isDark, 'muted') }]}>{k}</Text>
        <Text style={[styles.v, { color: textColor(isDark) }]}>{v}</Text>
      </View>
    ) : null
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
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!data && !error ? <ActivityIndicator style={{ marginTop: 40 }} color={textColor(isDark, 'muted')} /> : null}
        {error ? <Text style={[styles.v, { color: textColor(isDark) }]}>{error}</Text> : null}
        {data ? (
          <>
            <Text style={[styles.intro, { color: textColor(isDark, 'secondary') }]}>
              Linky matches on the facts below and nothing else. If something is wrong, fix it on your profile and the next hourly pass uses the new version.
            </Text>
            <Block title="PROFILE FACTS LINKY MATCHES ON">
              <Line k="Name" v={data.facts.name} />
              <Line k="Role" v={[data.facts.role, data.facts.company].filter(Boolean).join(' at ')} />
              <Line k="Location" v={[data.facts.city, data.facts.country].filter(Boolean).join(', ')} />
              <Line k="Skills" v={(data.facts.skills || []).join(', ')} />
              <Line k="Industries" v={(data.facts.industries || []).join(', ')} />
              <Line k="Looking for" v={(data.facts.lookingFor || []).join(', ')} />
              <Line k="Goals" v={data.facts.goals} />
              <Line k="Bio" v={data.facts.bio} />
            </Block>
            <Block title="SIGNALS">
              <Line k="Plan" v={data.signals.plus ? 'PLUS (3 intents, unlimited Meets)' : 'Free (1 intent, 3 Meets a day)'} />
              <Line k="Meets used today" v={String(data.signals.meetsUsedToday)} />
              <Line k="Inbound intros this week" v={`${data.signals.inboundThisWeek} of ${data.signals.inboundCap}`} />
              <Line k="Open to" v={(data.signals.openTo || []).map((o: string) => (OFFER_LABELS as any)[o] || o).join(', ')} />
              <Line k="People you muted" v={String(data.signals.mutedCount)} />
              <Line k="Last brief" v={data.signals.lastBriefDay || 'never'} />
              <Line k="Bots" v={[data.signals.channels?.telegram ? 'Telegram' : '', data.signals.channels?.whatsapp ? 'WhatsApp' : ''].filter(Boolean).join(', ') || 'none linked'} />
              <Line k="Intake turns stored" v={String(data.intakeTurns)} />
            </Block>
            <Block title={`INTENTS (${data.intents.length})`}>
              {data.intents.length ? data.intents.map((i) => (
                <Line key={i.id} k={`${i.status} · ${fmtDate(i.createdAt)}`} v={`${i.need} — ${OFFER_LABELS[i.offer]}, ${URGENCY_LABELS[i.urgency]}${i.location ? `, ${i.location}` : ''}`} />
              )) : <Text style={[styles.v, { color: textColor(isDark, 'muted') }]}>None yet.</Text>}
            </Block>
            <Block title={`CARDS LINKY SHOWED YOU (${data.cards.length})`}>
              {data.cards.length ? data.cards.slice(0, 30).map((c) => (
                <Line key={c.id} k={`${c.status} · ${fmtDate(c.createdAt)}`} v={`${c.targetName}: ${c.why}`} />
              )) : <Text style={[styles.v, { color: textColor(isDark, 'muted') }]}>None yet.</Text>}
            </Block>
            <Block title={`INTROS (${data.introsSent.length} sent · ${data.introsReceived.length} received)`}>
              {[...data.introsSent, ...data.introsReceived].length ? [...data.introsSent, ...data.introsReceived].map((i) => (
                <Line key={i.id} k={`${i.status} · ${fmtDate(i.createdAt)}`} v={`${i.requesterName} → ${i.targetName}: ${i.need}`} />
              )) : <Text style={[styles.v, { color: textColor(isDark, 'muted') }]}>None yet.</Text>}
            </Block>
            <Block title="WHERE THIS COMES FROM">
              {data.sources.map((s) => <Text key={s} style={[styles.v, { color: textColor(isDark) }]}>• {s}</Text>)}
            </Block>
            <Block title="WHAT LINKY DOES NOT USE">
              {data.notUsed.map((s) => <Text key={s} style={[styles.v, { color: textColor(isDark) }]}>• {s}</Text>)}
            </Block>
            <TouchableOpacity onPress={forget} style={[styles.forget, { borderColor: border }]}>
              <Trash2 size={14} color={COLORS.danger} />
              <Text style={[styles.forgetText, { color: COLORS.danger }]}>Forget my intents, cards and bot links</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 10, borderBottomWidth: 1, gap: 6 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '900' },
  content: { padding: 16, paddingBottom: 60 },
  intro: { fontSize: 13, lineHeight: 19, fontWeight: '500' },
  section: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginBottom: 8 },
  box: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  line: { gap: 2 },
  k: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  v: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  forget: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 24 },
  forgetText: { fontSize: 12, fontWeight: '900' },
});
