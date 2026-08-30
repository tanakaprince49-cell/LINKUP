import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  ChevronLeft,
  Eye,
  Lightbulb,
  Megaphone,
  MousePointerClick,
  Pause,
  Play,
  Square,
  TrendingUp,
} from 'lucide-react-native';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
import { Campaign, campaignStatusMeta, setCampaignStatus } from '../lib/campaigns';

export default function CampaignDetailScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const campaignId: string = route?.params?.campaignId || '';

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!campaignId) {
      setLoading(false);
      return;
    }
    const unsubscribe = onSnapshot(
      doc(db, 'campaigns', campaignId),
      (snap) => {
        setCampaign(snap.exists() ? ({ id: snap.id, ...snap.data() } as Campaign) : null);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsubscribe();
  }, [campaignId]);

  const isOwner = !!campaign && campaign.ownerId === user?.uid;
  const impressions = campaign?.statsImpressions || 0;
  const clicks = campaign?.statsClicks || 0;
  const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) : '0.0';
  const statusMeta = campaignStatusMeta(campaign?.status || 'ended');

  const changeStatus = async (status: 'active' | 'paused' | 'ended') => {
    if (!campaign || busy) return;
    setBusy(true);
    try {
      await setCampaignStatus(campaign.id, status);
    } catch (error: any) {
      notifyUser('Update failed', error?.message || 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmEnd = () =>
    Alert.alert('End this campaign?', 'It stops showing immediately and frees a slot. Stats stay on record.', [
      { text: 'Keep running', style: 'cancel' },
      { text: 'End campaign', style: 'destructive', onPress: () => changeStatus('ended') },
    ]);

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.headerBtn, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec }]}>
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={[styles.headerTitle, { color: textColor(isDark) }]} numberOfLines={1}>
            Campaign
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {campaign?.name || ''}
          </Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primaryStrong} />
        </View>
      ) : !campaign ? (
        <View style={styles.center}>
          <Megaphone size={34} color={COLORS.primaryStrong} />
          <Text style={[styles.missingText, { color: textColor(isDark, 'secondary') }]}>Campaign not found.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.statusHero, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
            <View style={[styles.statusPill, { backgroundColor: statusMeta.bg }]}>
              <Text style={[styles.statusPillText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
            </View>
            <Text style={[styles.heroName, { color: textColor(isDark) }]}>{campaign.name}</Text>
            <Text style={[styles.heroSub, { color: textColor(isDark, 'secondary') }]}>
              {campaign.status === 'pending_review'
                ? 'In human review — goes live within 24 hours.'
                : campaign.status === 'active'
                  ? 'Live in the Idea Deck for eligible founders.'
                  : campaign.status === 'paused'
                    ? 'Paused — not showing anywhere right now.'
                    : campaign.status === 'rejected'
                      ? campaign.reviewNote || 'This campaign was not approved.'
                      : 'This campaign has ended.'}
            </Text>
          </View>

          <View style={styles.statRow}>
            <View style={[styles.statCard, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
              <Eye size={15} color={COLORS.primaryStrong} />
              <Text style={[styles.statValue, { color: textColor(isDark) }]}>{impressions}</Text>
              <Text style={[styles.statLabel, { color: textColor(isDark, 'muted') }]}>Impressions</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
              <MousePointerClick size={15} color={COLORS.primaryStrong} />
              <Text style={[styles.statValue, { color: textColor(isDark) }]}>{clicks}</Text>
              <Text style={[styles.statLabel, { color: textColor(isDark, 'muted') }]}>Clicks</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
              <TrendingUp size={15} color={COLORS.primaryStrong} />
              <Text style={[styles.statValue, { color: textColor(isDark) }]}>{ctr}%</Text>
              <Text style={[styles.statLabel, { color: textColor(isDark, 'muted') }]}>CTR</Text>
            </View>
          </View>

          <Text style={[styles.sectionLabel, { color: textColor(isDark, 'muted') }]}>CREATIVE</Text>
          <View style={[styles.creativeCard, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
            <View style={styles.creativeHeader}>
              <View style={[styles.creativeIcon, { backgroundColor: COLORS.primary }]}>
                <Lightbulb size={18} color={COLORS.lightTextPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.creativeTitle, { color: textColor(isDark) }]} numberOfLines={2}>
                  {campaign.creative?.title}
                </Text>
                <Text style={[styles.creativeStage, { color: textColor(isDark, 'muted') }]}>
                  {campaign.creative?.stage || 'Idea Stage'} · Idea Deck
                </Text>
              </View>
            </View>
            <Text style={[styles.creativeDesc, { color: textColor(isDark, 'secondary') }]}>{campaign.creative?.description}</Text>
            {(campaign.industries || []).length > 0 && (
              <View style={styles.tagsRow}>
                {campaign.industries.slice(0, 6).map((tag) => (
                  <View key={tag} style={styles.tagPill}>
                    <Text style={styles.tagText}>{String(tag).toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {isOwner && ['active', 'paused'].includes(campaign.status) && (
            <View style={styles.actionsWrap}>
              {campaign.status === 'active' ? (
                <TouchableOpacity
                  onPress={() => changeStatus('paused')}
                  disabled={busy}
                  style={[styles.actionBtn, { backgroundColor: 'rgba(245,158,11,0.16)' }]}
                >
                  {busy ? <ActivityIndicator color="#B45309" /> : <Pause size={16} color="#B45309" />}
                  <Text style={[styles.actionText, { color: '#B45309' }]}>PAUSE</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => changeStatus('active')}
                  disabled={busy}
                  style={[styles.actionBtn, { backgroundColor: 'rgba(22,163,74,0.14)' }]}
                >
                  {busy ? <ActivityIndicator color="#16A34A" /> : <Play size={16} color="#16A34A" />}
                  <Text style={[styles.actionText, { color: '#16A34A' }]}>RESUME</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={confirmEnd}
                disabled={busy}
                style={[styles.actionBtn, { backgroundColor: 'rgba(220,38,38,0.12)' }]}
              >
                <Square size={15} color="#DC2626" />
                <Text style={[styles.actionText, { color: '#DC2626' }]}>END</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 74,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '900', letterSpacing: 4 },
  headerSub: { marginTop: 4, color: '#666', fontSize: 10, fontWeight: '900' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  missingText: { fontSize: 13, fontWeight: '800' },
  scroll: { padding: 16, paddingTop: 6, paddingBottom: 48 },
  statusHero: { borderWidth: 1, borderRadius: 24, padding: 18, alignItems: 'flex-start', gap: 10 },
  statusPill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  statusPillText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  heroName: { fontSize: 22, fontWeight: '900' },
  heroSub: { fontSize: 12, lineHeight: 18, fontWeight: '700' },
  statRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  statCard: { flex: 1, borderWidth: 1, borderRadius: 18, padding: 14, gap: 6 },
  statValue: { fontSize: 20, fontWeight: '900' },
  statLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  sectionLabel: { marginTop: 22, marginBottom: 10, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  creativeCard: { borderWidth: 1, borderRadius: 20, padding: 14 },
  creativeHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  creativeIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  creativeTitle: { fontSize: 15, fontWeight: '900' },
  creativeStage: { marginTop: 3, fontSize: 10, fontWeight: '800' },
  creativeDesc: { marginTop: 12, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  tagPill: {
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.27)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tagText: { fontSize: 9, fontWeight: '900', color: '#8A7900', letterSpacing: 0.9 },
  actionsWrap: { flexDirection: 'row', gap: 10, marginTop: 20 },
  actionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  actionText: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
});
