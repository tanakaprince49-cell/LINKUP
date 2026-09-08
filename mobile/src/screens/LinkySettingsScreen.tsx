// Linky preferences: what you are open to, weekly inbound intro cap, and
// linking this account to the Telegram / WhatsApp bots with a 6-char code.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check, Copy, Link2, Minus, Plus } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
import { IntentOffer, LinkyHome, OFFER_LABELS, linkyHome, linkyLinkCode, linkyPrefs, linkyUnlinkChannel } from '../lib/linkyApi';

const OFFERS: IntentOffer[] = ['paid', 'equity', 'advisory', 'coffee'];
const TELEGRAM_BOT = String(process.env.EXPO_PUBLIC_LINKY_TELEGRAM_BOT || 'LinkyLinkupBot').replace(/^@/, '');
const WHATSAPP_NUMBER = String(process.env.EXPO_PUBLIC_LINKY_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');

export default function LinkySettingsScreen({ navigation }: any) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [home, setHome] = useState<LinkyHome | null>(null);
  const [openTo, setOpenTo] = useState<IntentOffer[]>(OFFERS);
  const [cap, setCap] = useState(5);
  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState<{ code: string; channel: 'telegram' | 'whatsapp' } | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const border = isDark ? COLORS.darkBorder : COLORS.lightBorder;
  const surface = isDark ? COLORS.darkBgSec : '#FFFFFF';

  const load = useCallback(async () => {
    try {
      const h = await linkyHome();
      setHome(h);
      setOpenTo(h.prefs.openTo.length ? h.prefs.openTo : OFFERS);
      setCap(h.prefs.inboundCap);
    } catch (err) {
      notifyUser('Linky is unavailable', err instanceof Error ? err.message : undefined);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (next: { openTo?: IntentOffer[]; inboundCap?: number }) => {
    setSaving(true);
    try { await linkyPrefs(next); } catch (err) { notifyUser('Could not save', err instanceof Error ? err.message : undefined); } finally { setSaving(false); }
  };

  const toggle = (o: IntentOffer) => {
    const next = openTo.includes(o) ? openTo.filter((x) => x !== o) : [...openTo, o];
    if (!next.length) { notifyUser('Keep at least one', 'Turn the weekly cap to 0 if you want no intros at all.'); return; }
    setOpenTo(next);
    save({ openTo: next });
  };
  const bumpCap = (d: number) => {
    const next = Math.max(0, Math.min(20, cap + d));
    setCap(next);
    save({ inboundCap: next });
  };

  const getCode = async (channel: 'telegram' | 'whatsapp') => {
    setCodeBusy(true);
    try {
      const r = await linkyLinkCode();
      setCode({ code: r.code, channel });
    } catch (err) {
      notifyUser('Could not create a code', err instanceof Error ? err.message : undefined);
    } finally {
      setCodeBusy(false);
    }
  };
  const openBot = () => {
    if (!code) return;
    const url = code.channel === 'telegram'
      ? `https://t.me/${TELEGRAM_BOT}?start=${code.code}`
      : WHATSAPP_NUMBER ? `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(code.code)}` : '';
    if (!url) { notifyUser('WhatsApp number not set yet', 'Send the code to the LINKUP WhatsApp bot once it is announced.'); return; }
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
    else Linking.openURL(url).catch(() => {});
  };
  const copyCode = async () => {
    if (!code) return;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) await navigator.clipboard.writeText(code.code);
      else {
        const Clipboard = await import('expo-clipboard').catch(() => null);
        if (Clipboard?.setStringAsync) await Clipboard.setStringAsync(code.code);
      }
      notifyUser('Copied', code.code);
    } catch {
      notifyUser('Your code', code.code);
    }
  };
  const unlink = async (channel: 'telegram' | 'whatsapp') => {
    try { await linkyUnlinkChannel(channel); await load(); } catch (err) { notifyUser('Could not unlink', err instanceof Error ? err.message : undefined); }
  };

  const Row = ({ title, body, right }: { title: string; body?: string; right?: React.ReactNode }) => (
    <View style={[styles.row, { borderColor: border, backgroundColor: surface }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: textColor(isDark) }]}>{title}</Text>
        {body ? <Text style={[styles.rowBody, { color: textColor(isDark, 'muted') }]}>{body}</Text> : null}
      </View>
      {right}
    </View>
  );

  return (
    <View style={[styles.root, appBackground(isDark)]}>
      <SafeAreaView edges={['top']} style={[styles.header, { borderBottomColor: border }]}>
        <TouchableOpacity onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))} style={styles.headerBtn}>
          <ArrowLeft size={20} color={textColor(isDark)} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>Linky preferences</Text>
        {saving ? <ActivityIndicator size="small" color={textColor(isDark, 'muted')} /> : <View style={styles.headerBtn} />}
      </SafeAreaView>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.section, { color: textColor(isDark, 'muted') }]}>I AM OPEN TO</Text>
        <View style={styles.chips}>
          {OFFERS.map((o) => {
            const on = openTo.includes(o);
            return (
              <TouchableOpacity key={o} onPress={() => toggle(o)} style={[styles.chip, { borderColor: on ? COLORS.primaryStrong : border, backgroundColor: on ? COLORS.primary : surface }]}>
                {on ? <Check size={12} color="#000" /> : null}
                <Text style={[styles.chipText, { color: on ? '#000' : textColor(isDark, 'secondary') }]}>{OFFER_LABELS[o]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[styles.fine, { color: textColor(isDark, 'muted') }]}>Linky only shows you to people whose ask matches one of these.</Text>

        <Text style={[styles.section, { color: textColor(isDark, 'muted') }]}>INBOUND INTROS PER WEEK</Text>
        <Row
          title={cap === 0 ? 'Paused' : `${cap} per week`}
          body="Declining an intro mutes that person for you. Nobody is told."
          right={(
            <View style={styles.stepper}>
              <TouchableOpacity onPress={() => bumpCap(-1)} style={[styles.stepBtn, { borderColor: border }]}><Minus size={14} color={textColor(isDark)} /></TouchableOpacity>
              <TouchableOpacity onPress={() => bumpCap(1)} style={[styles.stepBtn, { borderColor: border }]}><Plus size={14} color={textColor(isDark)} /></TouchableOpacity>
            </View>
          )}
        />

        <Text style={[styles.section, { color: textColor(isDark, 'muted') }]}>LINKY ON TELEGRAM & WHATSAPP</Text>
        <Text style={[styles.fine, { color: textColor(isDark, 'muted'), marginBottom: 8 }]}>Same Linky, in your chat app: ask who you need and get the answer right there, Meet / Accept with one tap. Link with a 6-character code (valid 15 minutes).</Text>
        {(['telegram', 'whatsapp'] as const).map((channel) => {
          const linked = !!home?.channels?.[channel];
          return (
            <Row
              key={channel}
              title={channel === 'telegram' ? `Telegram · @${TELEGRAM_BOT}` : 'WhatsApp'}
              body={linked ? 'Linked to this account.' : channel === 'whatsapp' && !WHATSAPP_NUMBER ? 'Coming online soon.' : 'Not linked.'}
              right={linked ? (
                <TouchableOpacity onPress={() => unlink(channel)} style={[styles.smallBtn, { borderColor: border }]}>
                  <Text style={[styles.smallBtnText, { color: textColor(isDark, 'secondary') }]}>Unlink</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={() => getCode(channel)} disabled={codeBusy} style={[styles.smallBtn, { borderColor: border, backgroundColor: COLORS.primary }]}>
                  <Link2 size={12} color="#000" />
                  <Text style={[styles.smallBtnText, { color: '#000' }]}>Connect</Text>
                </TouchableOpacity>
              )}
            />
          );
        })}
        {code ? (
          <View style={[styles.codeBox, { borderColor: border, backgroundColor: surface }]}>
            <Text style={[styles.rowBody, { color: textColor(isDark, 'muted') }]}>Send this code to Linky on {code.channel === 'telegram' ? 'Telegram' : 'WhatsApp'}:</Text>
            <Text style={[styles.code, { color: textColor(isDark) }]}>{code.code}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={copyCode} style={[styles.smallBtn, { borderColor: border }]}>
                <Copy size={12} color={textColor(isDark)} />
                <Text style={[styles.smallBtnText, { color: textColor(isDark) }]}>Copy</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={openBot} style={[styles.smallBtn, { borderColor: border, backgroundColor: COLORS.primary }]}>
                <Text style={[styles.smallBtnText, { color: '#000' }]}>Open {code.channel === 'telegram' ? 'Telegram' : 'WhatsApp'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={load} style={[styles.smallBtn, { borderColor: border }]}>
                <Text style={[styles.smallBtnText, { color: textColor(isDark, 'secondary') }]}>I sent it</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 10, borderBottomWidth: 1, gap: 6 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '900' },
  content: { padding: 16, paddingBottom: 60 },
  section: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginTop: 18, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontSize: 12, fontWeight: '800' },
  fine: { fontSize: 11, fontWeight: '600', lineHeight: 16, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 8 },
  rowTitle: { fontSize: 14, fontWeight: '800' },
  rowBody: { fontSize: 11, fontWeight: '600', lineHeight: 16, marginTop: 2 },
  stepper: { flexDirection: 'row', gap: 6 },
  stepBtn: { width: 32, height: 32, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  smallBtnText: { fontSize: 11, fontWeight: '900' },
  codeBox: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 4, gap: 8 },
  code: { fontSize: 30, fontWeight: '900', letterSpacing: 6 },
});
