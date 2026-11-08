import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, RefreshControl, ScrollView, Share, StyleSheet,
  Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  Check, ChevronLeft, Copy, Link2, MousePointerClick, Pencil, Plus,
  Share2, Trash2, UserPlus, Users, X,
} from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { isAdminIdentity } from '../lib/admin';
import {
  copyReferralUrl, createReferralLink, deleteReferralLink, fetchReferralLinks,
  renameReferralLink, setReferralLinkActive, type ReferralLink,
} from '../lib/referral';

const ACCENT = '#FBE618';

export default function ReferralAdminScreen({ navigation }: any) {
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const isAdmin = isAdminIdentity({ email: user?.email, isAdmin: (profile as any)?.isAdmin });

  const [links, setLinks] = useState<ReferralLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [internName, setInternName] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingCode, setEditingCode] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [busyCode, setBusyCode] = useState('');

  const colors = {
    bg: isDark ? '#0A0B0D' : '#F6F7F9',
    card: isDark ? '#12141A' : '#FFFFFF',
    border: isDark ? '#23262F' : '#E4E7EC',
    text: isDark ? '#F4F6FB' : '#101828',
    muted: isDark ? '#8A93A6' : '#667085',
    input: isDark ? '#0D0F14' : '#F9FAFB',
  };

  const load = useCallback(async (quiet = false) => {
    if (!isAdmin) { setLoading(false); return; }
    if (!quiet) setLoading(true);
    setError('');
    try {
      setLinks(await fetchReferralLinks());
    } catch (e: any) {
      setError(String(e?.message || 'Could not load referral links.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(true); }, [load]));

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 2600);
  };

  const replaceLink = (next: ReferralLink) =>
    setLinks((current) => current.map((l) => (l.code === next.code ? next : l)));

  const onCreate = async () => {
    const label = internName.trim();
    if (label.length < 2) { Alert.alert('Name needed', "Enter the intern's name first."); return; }
    setCreating(true);
    try {
      const link = await createReferralLink(label, customCode.trim() || undefined);
      setLinks((current) => [link, ...current]);
      setInternName('');
      setCustomCode('');
      await copyReferralUrl(link.url).catch(() => {});
      flash(`Link created for ${link.label} — copied to clipboard.`);
    } catch (e: any) {
      Alert.alert('Could not create link', String(e?.message || 'Please try again.'));
    } finally {
      setCreating(false);
    }
  };

  const onCopy = async (link: ReferralLink) => {
    try {
      await copyReferralUrl(link.url);
      flash('Link copied — send it to ' + link.label + '.');
    } catch {
      Alert.alert('Copy failed', link.url);
    }
  };

  const onShare = (link: ReferralLink) => {
    Share.share({ message: `Join me on LINKUP: ${link.url}`, url: link.url }).catch(() => {});
  };

  const onToggle = async (link: ReferralLink, active: boolean) => {
    setBusyCode(link.code);
    try {
      replaceLink(await setReferralLinkActive(link.code, active));
    } catch (e: any) {
      Alert.alert('Could not update link', String(e?.message || 'Please try again.'));
    } finally {
      setBusyCode('');
    }
  };

  const onSaveRename = async (link: ReferralLink) => {
    const label = editLabel.trim();
    if (label.length < 2) { Alert.alert('Name too short', 'Use at least 2 characters.'); return; }
    setBusyCode(link.code);
    try {
      replaceLink(await renameReferralLink(link.code, label));
      setEditingCode('');
      flash('Link renamed.');
    } catch (e: any) {
      Alert.alert('Could not rename', String(e?.message || 'Please try again.'));
    } finally {
      setBusyCode('');
    }
  };

  const onDelete = (link: ReferralLink) => {
    Alert.alert(
      'Delete this link?',
      `${link.label}'s link (${link.url}) will stop counting new clicks. Signups already recorded stay recorded.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setBusyCode(link.code);
            try {
              await deleteReferralLink(link.code);
              setLinks((current) => current.filter((l) => l.code !== link.code));
              flash('Link deleted.');
            } catch (e: any) {
              Alert.alert('Could not delete', String(e?.message || 'Please try again.'));
            } finally {
              setBusyCode('');
            }
          },
        },
      ],
    );
  };

  const totals = links.reduce(
    (acc, l) => ({ clicks: acc.clicks + l.clicks, signups: acc.signups + l.signups }),
    { clicks: 0, signups: 0 },
  );

  const conversion = (link: ReferralLink) =>
    link.clicks > 0 ? `${Math.round((link.signups / link.clicks) * 100)}%` : '—';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityLabel="Back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Referral links</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>One link per intern. Clicks and signups, measured.</Text>
        </View>
      </View>

      {!isAdmin ? (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Admins only</Text>
          <Text style={[styles.emptyText, { color: colors.muted }]}>
            This is your private referral control room. It only opens for admin accounts.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={ACCENT} />}
        >
          {!!notice && (
            <View style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Check size={15} color={ACCENT === '#FBE618' && isDark ? ACCENT : '#6E5B00'} />
              <Text style={[styles.noticeText, { color: colors.text }]}>{notice}</Text>
            </View>
          )}

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHead}>
              <Users size={17} color={isDark ? ACCENT : '#6E5B00'} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Team totals</Text>
            </View>
            <View style={styles.totalsRow}>
              <View style={styles.totalBox}>
                <Text style={[styles.totalNum, { color: colors.text }]}>{links.length}</Text>
                <Text style={[styles.totalLabel, { color: colors.muted }]}>Links</Text>
              </View>
              <View style={styles.totalBox}>
                <Text style={[styles.totalNum, { color: colors.text }]}>{totals.clicks}</Text>
                <Text style={[styles.totalLabel, { color: colors.muted }]}>Clicks</Text>
              </View>
              <View style={styles.totalBox}>
                <Text style={[styles.totalNum, { color: colors.text }]}>{totals.signups}</Text>
                <Text style={[styles.totalLabel, { color: colors.muted }]}>Signups</Text>
              </View>
              <View style={styles.totalBox}>
                <Text style={[styles.totalNum, { color: colors.text }]}>
                  {totals.clicks > 0 ? `${Math.round((totals.signups / totals.clicks) * 100)}%` : '—'}
                </Text>
                <Text style={[styles.totalLabel, { color: colors.muted }]}>Conversion</Text>
              </View>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHead}>
              <Plus size={17} color={isDark ? ACCENT : '#6E5B00'} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>New intern link</Text>
            </View>
            <TextInput
              value={internName}
              onChangeText={setInternName}
              placeholder="Intern's name (e.g. Maya K)"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
              autoCapitalize="words"
              returnKeyType="next"
            />
            <TextInput
              value={customCode}
              onChangeText={setCustomCode}
              placeholder="Custom link ending (optional, e.g. maya-k)"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={onCreate}
            />
            <TouchableOpacity
              style={[styles.createBtn, { opacity: creating ? 0.6 : 1 }]}
              onPress={onCreate}
              disabled={creating}
              activeOpacity={0.85}
            >
              {creating ? <ActivityIndicator color="#0A0B0D" /> : <Link2 size={16} color="#0A0B0D" />}
              <Text style={styles.createBtnText}>{creating ? 'Creating…' : 'Create link'}</Text>
            </TouchableOpacity>
            <Text style={[styles.hint, { color: colors.muted }]}>
              The link looks like linkupbuild.com/r/maya-k. Leave the ending blank and we will make it from the name.
            </Text>
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}
          {loading ? (
            <ActivityIndicator color={isDark ? ACCENT : '#6E5B00'} style={{ marginTop: 28 }} />
          ) : links.length === 0 ? (
            <View style={styles.center}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No links yet</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                Create the first intern link above, send it to them, and watch clicks and signups land here.
              </Text>
            </View>
          ) : (
            links.map((link) => (
              <View key={link.code} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: link.active ? 1 : 0.62 }]}>
                <View style={styles.linkHead}>
                  {editingCode === link.code ? (
                    <View style={styles.renameRow}>
                      <TextInput
                        value={editLabel}
                        onChangeText={setEditLabel}
                        style={[styles.renameInput, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }]}
                        autoFocus
                        onSubmitEditing={() => onSaveRename(link)}
                      />
                      <TouchableOpacity onPress={() => onSaveRename(link)} style={styles.iconBtn} accessibilityLabel="Save name">
                        <Check size={17} color={isDark ? ACCENT : '#6E5B00'} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditingCode('')} style={styles.iconBtn} accessibilityLabel="Cancel rename">
                        <X size={17} color={colors.muted} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <Text style={[styles.linkLabel, { color: colors.text }]} numberOfLines={1}>{link.label}</Text>
                      <TouchableOpacity
                        onPress={() => { setEditingCode(link.code); setEditLabel(link.label); }}
                        style={styles.iconBtn}
                        accessibilityLabel={`Rename ${link.label}`}
                      >
                        <Pencil size={15} color={colors.muted} />
                      </TouchableOpacity>
                    </>
                  )}
                  <View style={{ flex: 1 }} />
                  <Text style={[styles.activeLabel, { color: colors.muted }]}>{link.active ? 'Live' : 'Paused'}</Text>
                  <Switch
                    value={link.active}
                    onValueChange={(v) => onToggle(link, v)}
                    disabled={busyCode === link.code}
                    trackColor={{ true: ACCENT, false: isDark ? '#2A2E38' : '#D0D5DD' }}
                    thumbColor={link.active ? '#0A0B0D' : '#FFFFFF'}
                  />
                </View>

                <Text style={[styles.linkUrl, { color: isDark ? ACCENT : '#6E5B00' }]} selectable>
                  {link.url.replace('https://www.', '')}
                </Text>

                <View style={styles.statsRow}>
                  <View style={styles.stat}>
                    <MousePointerClick size={14} color={colors.muted} />
                    <Text style={[styles.statText, { color: colors.text }]}>{link.clicks} clicks</Text>
                  </View>
                  <View style={styles.stat}>
                    <UserPlus size={14} color={colors.muted} />
                    <Text style={[styles.statText, { color: colors.text }]}>{link.signups} signups</Text>
                  </View>
                  <Text style={[styles.statText, { color: colors.muted }]}>{conversion(link)} conv.</Text>
                  {!!link.createdAt && (
                    <Text style={[styles.statText, { color: colors.muted }]}>
                      since {new Date(link.createdAt).toLocaleDateString()}
                    </Text>
                  )}
                </View>

                <View style={styles.actionsRow}>
                  <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.border }]} onPress={() => onCopy(link)} activeOpacity={0.8}>
                    <Copy size={14} color={colors.text} />
                    <Text style={[styles.actionText, { color: colors.text }]}>Copy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.border }]} onPress={() => onShare(link)} activeOpacity={0.8}>
                    <Share2 size={14} color={colors.text} />
                    <Text style={[styles.actionText, { color: colors.text }]}>Share</Text>
                  </TouchableOpacity>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: colors.border }]}
                    onPress={() => onDelete(link)}
                    disabled={busyCode === link.code}
                    activeOpacity={0.8}
                  >
                    <Trash2 size={14} color="#E5484D" />
                    <Text style={[styles.actionText, { color: '#E5484D' }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          <Text style={[styles.footnote, { color: colors.muted }]}>
            A click is counted the moment someone opens the link. A signup is counted when a new account created
            within 7 days of opening the link finishes signing in — it is stamped onto their profile, so counts
            never drift.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19 },
  title: { fontSize: 22, fontWeight: '800' },
  subtitle: { fontSize: 12.5, marginTop: 2 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  center: { padding: 32, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptyText: { fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  noticeText: { fontSize: 13, fontWeight: '600', flex: 1 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalBox: { alignItems: 'center', flex: 1 },
  totalNum: { fontSize: 20, fontWeight: '800' },
  totalLabel: { fontSize: 11, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14.5,
  },
  createBtn: {
    backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  createBtnText: { color: '#0A0B0D', fontSize: 14.5, fontWeight: '800' },
  hint: { fontSize: 12, lineHeight: 16 },
  error: { color: '#E5484D', fontSize: 13.5, textAlign: 'center' },
  linkHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkLabel: { fontSize: 16, fontWeight: '700', maxWidth: '55%' },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  renameInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14 },
  iconBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  activeLabel: { fontSize: 11.5, fontWeight: '600', marginRight: 2 },
  linkUrl: { fontSize: 13.5, fontWeight: '600' },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statText: { fontSize: 12.5, fontWeight: '600' },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
  },
  actionText: { fontSize: 12.5, fontWeight: '700' },
  footnote: { fontSize: 11.5, lineHeight: 16, textAlign: 'center', paddingHorizontal: 8 },
});
