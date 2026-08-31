import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { finishTransaction, getAvailablePurchases, type Purchase, useIAP } from 'expo-iap';
import { serverTimestamp } from 'firebase/firestore';
import {
  BarChart3,
  Check,
  CheckCircle2,
  Eye,
  Lock,
  Megaphone,
  Package,
  Pause,
  Play,
  Pencil,
  Plus,
  Rocket,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Zap,
} from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, RADIUS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
import { ikAvatar } from '../lib/ikImage';
import { isAdminIdentity } from '../lib/admin';
import ScreenHeader from '../components/ScreenHeader';
import {
  CAMPAIGNS_PRODUCT_IDS,
  CAMPAIGN_PLACEMENT_OPTIONS,
  Campaign,
  CampaignsAccount,
  LINKUP_CAMPAIGNS_MONTHLY_PRICE,
  LINKUP_CAMPAIGNS_PRODUCT_ID,
  LINKUP_CAMPAIGNS_YEARLY_PRICE,
  LINKUP_CAMPAIGNS_YEARLY_PRODUCT_ID,
  MAX_ACTIVE_CAMPAIGNS,
  campaignStatusMeta,
  countLiveCampaigns,
  fetchCampaignsAccount,
  hasCampaignsPlan,
  isCampaignAdmin,
  saveCampaignsAccount,
  setCampaignStatus,
  subscribeMyCampaigns,
  subscribePendingCampaigns,
} from '../lib/campaigns';
import { startPaynowCheckout, checkPaynowPayment, takePendingReference } from '../lib/webCheckout';
import { webCampaignsActive } from '../lib/webSubscription';
import {
  TRIAL_DAYS,
  describeSubscriptionOffer,
  offerTokenFor,
  pickSubscriptionOffer,
  readActiveTrial,
  saveTrialStart,
  trialStatusLabel,
  trialThenPrice,
  type TrialRecord,
} from '../lib/trial';

const CAMPAIGNS_PERKS = [
  'Showcase your product on Idea Deck, Discover, Search, Hub & Linky picks',
  '3 active campaigns at once — swap creatives anytime',
  'Sponsored cards with your logo and your website as the call-to-action',
  'Live impressions, clicks & CTR on every campaign',
  'Reach verified founders, builders & early adopters only',
  'Edit creatives while in review, pause or resume in one tap',
  'Priority human review — live within 24 hours',
];

const CAMPAIGNS_PLANS = [
  {
    id: 'monthly',
    productId: LINKUP_CAMPAIGNS_PRODUCT_ID,
    webPlanKey: 'campaigns_1m',
    label: 'Monthly',
    price: LINKUP_CAMPAIGNS_MONTHLY_PRICE,
    cadence: '/mo',
    helper: '7-day free trial, then monthly',
    badge: 'FREE TRIAL',
  },
  {
    id: 'yearly',
    productId: LINKUP_CAMPAIGNS_YEARLY_PRODUCT_ID,
    webPlanKey: 'campaigns_12m',
    label: 'Yearly',
    price: LINKUP_CAMPAIGNS_YEARLY_PRICE,
    cadence: '/yr',
    helper: 'Two months free for committed builders',
    badge: 'SAVE 30%',
  },
] as const;

type CampaignsPlan = (typeof CAMPAIGNS_PLANS)[number];

const isCampaignsPurchase = (purchase: Purchase) => {
  const productIds = purchase.ids?.length ? purchase.ids : [purchase.productId];
  return productIds.some((productId) => CAMPAIGNS_PRODUCT_IDS.includes(productId as any));
};

const getPurchaseProductId = (purchase: Purchase) => {
  const productIds = purchase.ids?.length ? purchase.ids : [purchase.productId];
  return productIds.find((productId) => CAMPAIGNS_PRODUCT_IDS.includes(productId as any)) || purchase.productId;
};

const ctrFor = (impressions: number, clicks: number) =>
  impressions > 0 ? `${((clicks / impressions) * 100).toFixed(1)}%` : '0.0%';

const compactNumber = (value: number) => {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

const STATUS_MAP: Record<string, { bg: string; fg: string; icon: typeof Check }> = {
  active: { bg: 'rgba(22,163,74,0.12)', fg: '#16A34A', icon: Check },
  paused: { bg: 'rgba(217,119,6,0.12)', fg: '#D97706', icon: Pause },
  pending_review: { bg: 'rgba(59,130,246,0.12)', fg: '#3B82F6', icon: Eye },
  rejected: { bg: 'rgba(225,29,72,0.12)', fg: '#E11D48', icon: ThumbsDown },
};

const STAT_COLORS = ['#16A34A', '#3B82F6', '#8B5CF6', '#F59E0B'];

export default function CampaignsScreen({ navigation }: any) {
  const { user, profile, webSubscription } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [account, setAccount] = useState<CampaignsAccount | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pending, setPending] = useState<Campaign[]>([]);
  const [remoteAdmin, setRemoteAdmin] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [storeError, setStoreError] = useState('');
  const [moderationBusy, setModerationBusy] = useState('');
  const [rejectTarget, setRejectTarget] = useState<Campaign | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);
  const [campaignsTrial, setCampaignsTrial] = useState<TrialRecord | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<CampaignsPlan['id']>('monthly');
  const processedPurchases = useRef(new Set<string>());

  const identity = { email: user?.email, isAdmin: (profile as any)?.isAdmin };
  const isAdmin = isAdminIdentity(identity);
  const admin = isAdmin || remoteAdmin;

  const hasPlan = isAdmin || hasCampaignsPlan(account, webCampaignsActive(webSubscription));
  const liveCount = countLiveCampaigns(campaigns);
  const totalImpressions = campaigns.reduce((sum, c) => sum + (c.statsImpressions || 0), 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + (c.statsClicks || 0), 0);
  const totalCtr = ctrFor(totalImpressions, totalClicks);
  const trialLabel = trialStatusLabel(campaignsTrial);

  const { connected, subscriptions, fetchProducts, requestPurchase, restorePurchases, reconnect } = useIAP({
    onPurchaseSuccess: (purchase) => { void handlePurchaseSuccess(purchase); },
    onPurchaseError: (error) => {
      setPurchaseBusy(false);
      const code = String(error?.code || '').toLowerCase();
      if (code.includes('user') || code.includes('cancel')) return;
      Alert.alert('Purchase failed', error?.message || 'Google Play could not complete the purchase.');
    },
    onError: (error) => { setStoreError(error?.message || 'Google Play billing is not ready yet.'); },
  });

  async function unlockCampaignsPlan(purchase: Purchase) {
    if (!user?.uid) return;
    const purchasedProductId = getPurchaseProductId(purchase);
    const purchasedPlan = CAMPAIGNS_PLANS.find((plan) => plan.productId === purchasedProductId) || CAMPAIGNS_PLANS[0];
    const product = subscriptions.find((entry: any) => entry.id === purchasedProductId);
    const offer = pickSubscriptionOffer(product);
    const trialDays = describeSubscriptionOffer(offer, purchasedPlan.price, TRIAL_DAYS).trialDays;
    const trial = await saveTrialStart(user.uid, purchasedProductId, trialDays).catch(() => null);
    const patch = {
      plan: 'campaigns', status: 'active', planProductId: purchasedProductId,
      isTrial: !!trial && trial.endsAt > Date.now(), trialEndsAt: trial?.endsAt || null,
      transactionId: purchase.transactionId || purchase.id || null,
      purchaseToken: purchase.purchaseToken || null,
      billingProvider: purchase.store || (Platform.OS === 'android' ? 'google-play' : 'app-store'),
      unlockedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    await saveCampaignsAccount(user.uid, patch);
    setAccount((current) => ({ ...(current || {}), ...patch }));
    if (trial) setCampaignsTrial(trial);
  }

  async function handlePurchaseSuccess(purchase: Purchase) {
    if (!isCampaignsPurchase(purchase)) return;
    const purchaseKey = purchase.transactionId || purchase.purchaseToken || purchase.id;
    if (purchaseKey && processedPurchases.current.has(purchaseKey)) return;
    if (purchaseKey) processedPurchases.current.add(purchaseKey);
    if (purchase.purchaseState === 'pending') {
      setPurchaseBusy(false);
      Alert.alert('Payment pending', 'Google Play is still processing. Campaigns unlocks when it completes.');
      return;
    }
    try {
      await unlockCampaignsPlan(purchase);
      await finishTransaction({ purchase, isConsumable: false });
      setPurchaseBusy(false);
      Alert.alert('CAMPAIGNS UNLOCKED', 'You can now launch sponsored campaigns across LinkUp.');
    } catch (error: any) {
      setPurchaseBusy(false);
      Alert.alert('Purchase recorded', error?.message || 'Your purchase completed, syncing your plan now.');
    }
  }

  useEffect(() => {
    let mounted = true;
    if (!user?.uid) { setLoadingAccount(false); return; }
    fetchCampaignsAccount(user.uid).then((data) => {
      if (!mounted) return; setAccount(data); setLoadingAccount(false);
    });
    if (isAdminIdentity({ email: user?.email, isAdmin: (profile as any)?.isAdmin })) {
      setRemoteAdmin(true);
    } else {
      isCampaignAdmin(user.uid, { email: user?.email, isAdmin: (profile as any)?.isAdmin }).then((flag) => {
        if (mounted) setRemoteAdmin(flag);
      });
    }
    const unsub = subscribeMyCampaigns(user.uid, (rows) => {
      if (mounted) setCampaigns(rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)));
    }, () => {});
    return () => { mounted = false; unsub(); };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) { setCampaignsTrial(null); return; }
    let c = false;
    readActiveTrial(user.uid, [...CAMPAIGNS_PRODUCT_IDS]).then((r) => { if (!c) setCampaignsTrial(r); });
    return () => { c = true; };
  }, [user?.uid, hasPlan]);

  useEffect(() => {
    if (!admin) return;
    return subscribePendingCampaigns((rows) => setPending(rows), () => {});
  }, [admin]);

  useEffect(() => {
    if (hasPlan || loadingAccount || !user?.uid) return;
    let c = false;
    (async () => {
      setStoreError('');
      try {
        if (!connected) await reconnect();
        if (!c) await fetchProducts({ skus: [...CAMPAIGNS_PRODUCT_IDS], type: 'subs' });
      } catch (e: any) { if (!c) setStoreError(e?.message || 'Could not load Campaigns.'); }
    })();
    return () => { c = true; };
  }, [connected, fetchProducts, hasPlan, loadingAccount, reconnect, user?.uid]);

  const productForPlan = useCallback(
    (plan: CampaignsPlan) => subscriptions.find((product) => product.id === plan.productId), [subscriptions]);
  const offerForPlan = useCallback(
    (plan: CampaignsPlan) => pickSubscriptionOffer(productForPlan(plan)), [productForPlan]);
  const trialForPlan = useCallback(
    (plan: CampaignsPlan) => describeSubscriptionOffer(offerForPlan(plan), plan.price, TRIAL_DAYS), [offerForPlan]);

  const selectedCampaignsPlan = CAMPAIGNS_PLANS.find((plan) => plan.id === selectedPlan) || CAMPAIGNS_PLANS[0];

  const handleStartCampaigns = async () => {
    if (!user?.uid) { Alert.alert('Sign in required', 'Sign in first.'); return; }
    const plan = CAMPAIGNS_PLANS.find((item) => item.id === selectedPlan) || CAMPAIGNS_PLANS[0];
    if (Platform.OS === 'web') {
      setPurchaseBusy(true); setStoreError('');
      try {
        const { redirectUrl } = await startPaynowCheckout(plan.webPlanKey);
        (window as any)?.location?.assign?.(redirectUrl);
      } catch (e: any) { setPurchaseBusy(false); Alert.alert('Checkout failed', e?.message || 'Could not start checkout.'); }
      return;
    }
    const offerToken = offerTokenFor(offerForPlan(plan));
    if (Platform.OS === 'android' && !offerToken) {
      Alert.alert('Google Play product missing', storeError || 'Campaigns is not ready in Google Play yet.');
      return;
    }
    setPurchaseBusy(true); setStoreError('');
    try {
      await requestPurchase({
        type: 'subs',
        request: {
          apple: { sku: plan.productId },
          google: {
            skus: [plan.productId], obfuscatedAccountId: user.uid, obfuscatedProfileId: user.uid,
            subscriptionOffers: offerToken ? [{ sku: plan.productId, offerToken }] : undefined,
          },
        },
      });
    } catch (e: any) { setPurchaseBusy(false); Alert.alert('Purchase failed', e?.message || 'Could not start checkout.'); }
  };

  const handleRestore = async () => {
    if (Platform.OS === 'web') {
      setPurchaseBusy(true); setStoreError('');
      try {
        const p = takePendingReference();
        if (p) await checkPaynowPayment(p);
        Alert.alert('Restore', p ? 'We checked your latest payment.' : 'Campaigns is tied to your account.');
      } catch (e: any) { Alert.alert('Restore failed', e?.message || 'Could not check payment.'); }
      finally { setPurchaseBusy(false); }
      return;
    }
    setPurchaseBusy(true);
    try {
      await restorePurchases();
      const purchases = await getAvailablePurchases();
      const cp = purchases.find(isCampaignsPurchase);
      if (cp) await handlePurchaseSuccess(cp);
      else { Alert.alert('Restore', 'No active Campaigns purchase found.'); setPurchaseBusy(false); }
    } catch (e: any) { setPurchaseBusy(false); Alert.alert('Restore failed', e?.message || 'Could not restore.'); }
  };

  const moderate = async (campaign: Campaign, status: 'active' | 'rejected', note: string = '') => {
    if (moderationBusy) return; setModerationBusy(campaign.id);
    try { await setCampaignStatus(campaign.id, status, note); }
    catch (e: any) { notifyUser('Moderation failed', e?.message || 'Try again.'); }
    finally { setModerationBusy(''); }
  };

  const submitRejection = async () => {
    if (!rejectTarget) return;
    const note = rejectReason.trim() || 'Does not meet LinkUp campaign guidelines.';
    setRejectBusy(true); await moderate(rejectTarget, 'rejected', note);
    setRejectBusy(false); setRejectTarget(null); setRejectReason('');
  };

  const placementsLabel = (c: Campaign) =>
    (c.placements || []).map((id) => CAMPAIGN_PLACEMENT_OPTIONS.find((o) => o.id === id)?.label || id).join(' ');

  const capacityPct = Math.round((Math.min(liveCount, MAX_ACTIVE_CAMPAIGNS) / MAX_ACTIVE_CAMPAIGNS) * 100);

  const shareOfVoice = [...campaigns]
    .map((c) => ({ id: c.id, name: c.creative?.productName || c.creative?.title || c.name || 'Untitled', views: c.statsImpressions || 0 }))
    .filter((e) => e.views > 0).sort((a, b) => b.views - a.views).slice(0, 5);
  const shareLead = shareOfVoice[0]?.views || 1;

  const tileBg = (i: number) => isDark
    ? `rgba(${i === 0 ? '22,163,74' : i === 1 ? '59,130,246' : i === 2 ? '139,92,246' : '245,158,11'},0.14)`
    : `rgba(${i === 0 ? '22,163,74' : i === 1 ? '59,130,246' : i === 2 ? '139,92,246' : '245,158,11'},0.08)`;

  // ─── Dashboard ─────────────────────────────────────────────
  const renderDashboard = () => (
    <View>
      {/* Live badge + slots */}
      <View style={s.badgeRow}>
        <View style={s.livePulse}>
          <View style={s.liveDot} />
          <Text style={s.liveText}>{trialLabel || 'CAMPAIGNS LIVE'}</Text>
        </View>
        <Text style={[s.slotText, { color: textColor(isDark, 'muted') }]}>
          {liveCount}/{MAX_ACTIVE_CAMPAIGNS} slots
        </Text>
      </View>

      {/* Stat tiles */}
      <View style={s.tileRow}>
        {[
          { val: compactNumber(totalImpressions), label: 'Impressions', icon: Eye },
          { val: compactNumber(totalClicks), label: 'Clicks', icon: Zap },
          { val: totalCtr, label: 'CTR', icon: TrendingUp },
          { val: String(liveCount), label: 'Active', icon: Rocket },
        ].map((stat, i) => (
          <View key={stat.label} style={[s.tile, { backgroundColor: tileBg(i) }]}>
            <stat.icon size={14} color={STAT_COLORS[i]} />
            <Text style={[s.tileVal, { color: textColor(isDark) }]}>{stat.val}</Text>
            <Text style={[s.tileLbl, { color: textColor(isDark, 'muted') }]}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* Capacity bar */}
      <View style={[s.capacityCard, liquidGlass(isDark, false)]}>
        <View style={s.capacityHeader}>
          <Text style={[s.capacityTitle, { color: textColor(isDark) }]}>Campaign Capacity</Text>
          <Text style={[s.capacityPct, { color: COLORS.primaryStrong }]}>{capacityPct}%</Text>
        </View>
        <View style={[s.capacityTrack, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBg }]}>
          <View style={[s.capacityFill, { width: `${capacityPct}%`, backgroundColor: capacityPct >= 100 ? '#E11D48' : capacityPct >= 66 ? '#F59E0B' : '#16A34A' }]} />
        </View>
        <Text style={[s.capacitySub, { color: textColor(isDark, 'muted') }]}>
          {liveCount} of {MAX_ACTIVE_CAMPAIGNS} slots in use
        </Text>
      </View>

      {/* Share of voice */}
      {shareOfVoice.length > 0 && (
        <View style={[s.sovCard, liquidGlass(isDark, false)]}>
          <View style={s.cardHeader}>
            <BarChart3 size={14} color={COLORS.primaryStrong} />
            <Text style={[s.cardTitle, { color: textColor(isDark) }]}>Share of Voice</Text>
          </View>
          {shareOfVoice.map((entry) => (
            <View key={entry.id} style={s.sovRow}>
              <Text style={[s.sovName, { color: textColor(isDark) }]} numberOfLines={1}>{entry.name}</Text>
              <View style={s.sovBarWrap}>
                <View style={[s.sovTrack, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBg }]}>
                  <View style={[s.sovFill, { width: `${Math.max(4, Math.round((entry.views / shareLead) * 100))}%` }]} />
                </View>
                <Text style={[s.sovVal, { color: textColor(isDark, 'muted') }]}>{compactNumber(entry.views)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* New campaign button */}
      <TouchableOpacity
        style={[s.ctaBtn, liveCount >= MAX_ACTIVE_CAMPAIGNS && s.ctaDisabled]}
        activeOpacity={0.86}
        disabled={liveCount >= MAX_ACTIVE_CAMPAIGNS}
        onPress={() => navigation.navigate('CreateCampaign')}
      >
        <Plus size={16} color="#FFF" />
        <Text style={s.ctaText}>NEW CAMPAIGN</Text>
      </TouchableOpacity>
      {liveCount >= MAX_ACTIVE_CAMPAIGNS && (
        <Text style={[s.capHint, { color: textColor(isDark, 'muted') }]}>
          All {MAX_ACTIVE_CAMPAIGNS} slots in use — pause one to free a slot.
        </Text>
      )}

      {/* Campaign list */}
      <View style={s.sectionRow}>
        <Rocket size={14} color={COLORS.primaryStrong} />
        <Text style={[s.sectionTitle, { color: textColor(isDark) }]}>My Campaigns</Text>
        <Text style={[s.sectionCount, { color: textColor(isDark, 'muted') }]}>{campaigns.length}</Text>
      </View>

      {campaigns.length === 0 ? (
        <View style={[s.emptyCard, liquidGlass(isDark, false)]}>
          <View style={s.emptyIconWrap}>
            <Megaphone size={22} color={COLORS.primaryStrong} />
          </View>
          <Text style={[s.emptyTitle, { color: textColor(isDark) }]}>No campaigns yet</Text>
          <Text style={[s.emptySub, { color: textColor(isDark, 'muted') }]}>
            Put your product in the deck where founders decide what to build next.
          </Text>
        </View>
      ) : (
        campaigns.map((campaign) => {
          const meta = campaignStatusMeta(campaign.status);
          const sc = STATUS_MAP[campaign.status] || STATUS_MAP.pending_review;
          const StatusIcon = sc.icon;
          const logo = campaign.creative?.logoUrl || '';
          const ctr = ctrFor(campaign.statsImpressions || 0, campaign.statsClicks || 0);

          const togglePause = () => {
            const next = campaign.status === 'active' ? 'paused' : 'active';
            void setCampaignStatus(campaign.id, next as any).catch(() =>
              notifyUser('Could not update', 'We could not change this campaign.')
            );
          };

          return (
            <TouchableOpacity
              key={campaign.id}
              activeOpacity={0.86}
              onPress={() => navigation.navigate('CampaignDetail', { campaignId: campaign.id })}
              style={[s.campCard, liquidGlass(isDark, false)]}
            >
              <View style={[s.campAccent, { backgroundColor: meta.color }]} />
              <View style={s.campBody}>
                <View style={s.campTop}>
                  <View style={s.campLogoWrap}>
                    {logo ? (
                      <Image source={{ uri: ikAvatar(logo) }} style={s.campLogo} resizeMode="cover" />
                    ) : (
                      <Package size={18} color={COLORS.primaryStrong} />
                    )}
                  </View>
                  <View style={s.campInfo}>
                    <Text style={[s.campName, { color: textColor(isDark) }]} numberOfLines={1}>
                      {campaign.creative?.productName || campaign.creative?.title || campaign.name}
                    </Text>
                    <Text style={[s.campMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
                      {placementsLabel(campaign) || 'Idea Deck'}
                    </Text>
                  </View>
                  <View style={[s.statusChip, { backgroundColor: sc.bg }]}>
                    <StatusIcon size={10} color={sc.fg} />
                    <Text style={[s.chipText, { color: sc.fg }]}>{meta.label}</Text>
                  </View>
                </View>

                <View style={s.campStatsRow}>
                  <View style={s.campStat}>
                    <Text style={[s.campStatVal, { color: textColor(isDark) }]}>{ctr}</Text>
                    <Text style={[s.campStatLbl, { color: textColor(isDark, 'muted') }]}>CTR</Text>
                  </View>
                  <View style={[s.campSep, { backgroundColor: textColor(isDark, 'muted') + '20' }]} />
                  <View style={s.campStat}>
                    <Text style={[s.campStatVal, { color: textColor(isDark) }]}>{compactNumber(campaign.statsImpressions || 0)}</Text>
                    <Text style={[s.campStatLbl, { color: textColor(isDark, 'muted') }]}>views</Text>
                  </View>
                  <View style={[s.campSep, { backgroundColor: textColor(isDark, 'muted') + '20' }]} />
                  <View style={s.campStat}>
                    <Text style={[s.campStatVal, { color: textColor(isDark) }]}>{compactNumber(campaign.statsClicks || 0)}</Text>
                    <Text style={[s.campStatLbl, { color: textColor(isDark, 'muted') }]}>clicks</Text>
                  </View>
                  <View style={s.campActions}>
                    {(campaign.status === 'active' || campaign.status === 'paused') && (
                      <TouchableOpacity onPress={togglePause} style={s.campActionBtn} activeOpacity={0.8}>
                        {campaign.status === 'active'
                          ? <Pause size={13} color={textColor(isDark, 'secondary')} />
                          : <Play size={13} color={textColor(isDark, 'secondary')} />}
                      </TouchableOpacity>
                    )}
                    {campaign.status === 'pending_review' && (
                      <TouchableOpacity
                        onPress={() => navigation.navigate('CreateCampaign', { editCampaign: campaign })}
                        style={s.campActionBtn} activeOpacity={0.8}
                      >
                        <Pencil size={13} color={textColor(isDark, 'secondary')} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );

  // ─── Paywall ───────────────────────────────────────────────
  const renderPaywall = () => (
    <View>
      {/* Hero banner */}
      <View style={s.payHero}>
        <View style={s.payHeroGlow} />
        <View style={s.payIconRow}>
          <View style={s.payIconWrap}>
            <Megaphone size={24} color={COLORS.primaryStrong} />
          </View>
          <View style={s.trialBadge}>
            <Sparkles size={10} color={COLORS.primaryStrong} />
            <Text style={s.trialBadgeText}>{`${trialForPlan(selectedCampaignsPlan).trialDays} DAYS FREE`}</Text>
          </View>
        </View>
        <Text style={[s.payTitle, { color: textColor(isDark) }]}>
          Put your product in front of every founder
        </Text>
        <Text style={[s.paySub, { color: textColor(isDark, 'muted') }]}>
          Sponsored cards with your logo and website — placed natively across Idea Deck, Discover, Search, Hub and Linky's picks.
        </Text>
      </View>

      {/* Plan cards */}
      <View style={s.planRow}>
        {CAMPAIGNS_PLANS.map((plan) => {
          const selected = selectedPlan === plan.id;
          const trial = trialForPlan(plan);
          const product = productForPlan(plan) as any;
          const storePrice = trial.priceLabel || product?.displayPrice || plan.price;
          return (
            <TouchableOpacity
              key={plan.id}
              onPress={() => setSelectedPlan(plan.id)}
              activeOpacity={0.86}
              style={[s.planCard, liquidGlass(isDark, false), selected && s.planCardSel]}
            >
              <View style={s.planTop}>
                <Text style={[s.planLabel, { color: textColor(isDark, 'muted') }]}>{plan.label}</Text>
                {selected ? (
                  <View style={s.planCheck}><Check size={10} color="#000" /></View>
                ) : (
                  <Text style={[s.planBadge, { color: COLORS.primaryStrong }]}>{plan.badge}</Text>
                )}
              </View>
              <View style={s.planPriceRow}>
                <Text style={[s.planPrice, { color: textColor(isDark) }]}>{storePrice}</Text>
                <Text style={[s.planCadence, { color: textColor(isDark, 'muted') }]}>{plan.cadence}</Text>
              </View>
              <Text style={[s.planHelper, { color: textColor(isDark, 'muted') }]} numberOfLines={2}>
                {trial.hasTrial ? trialThenPrice(trial, plan.cadence) : plan.helper}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Perks */}
      <View style={[s.perksCard, liquidGlass(isDark, false)]}>
        <View style={s.cardHeader}>
          <Zap size={14} color={COLORS.primaryStrong} />
          <Text style={[s.cardTitle, { color: textColor(isDark) }]}>Everything Included</Text>
        </View>
        {CAMPAIGNS_PERKS.map((perk) => (
          <View key={perk} style={s.perkRow}>
            <CheckCircle2 size={15} color={COLORS.primaryStrong} />
            <Text style={[s.perkText, { color: textColor(isDark, 'secondary') }]}>{perk}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[s.ctaBtn, { backgroundColor: COLORS.primary }]}
        activeOpacity={0.86}
        onPress={handleStartCampaigns}
        disabled={purchaseBusy}
      >
        {purchaseBusy ? (
          <ActivityIndicator color={COLORS.lightTextPrimary} />
        ) : (
          <Text style={[s.ctaText, { color: COLORS.lightTextPrimary }]}>
            {`START ${trialForPlan(selectedCampaignsPlan).trialDays}-DAY FREE TRIAL`}
          </Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={handleRestore} style={s.restoreBtn} activeOpacity={0.8} disabled={purchaseBusy}>
        <Lock size={12} color={textColor(isDark, 'muted')} />
        <Text style={[s.restoreText, { color: textColor(isDark, 'muted') }]}>Restore purchases</Text>
      </TouchableOpacity>
    </View>
  );

  // ─── Admin ─────────────────────────────────────────────────
  const renderAdmin = () => {
    if (!admin) return null;
    return (
      <View>
        <View style={s.adminHeader}>
          <View style={s.adminDot} />
          <Text style={[s.sectionTitle, { color: textColor(isDark) }]}>
            Review Queue{pending.length > 0 ? ` · ${pending.length}` : ''}
          </Text>
        </View>
        {pending.length === 0 ? (
          <Text style={[s.adminEmpty, { color: textColor(isDark, 'muted') }]}>Queue is clear</Text>
        ) : (
          pending.map((campaign) => (
            <View key={campaign.id} style={[s.campCard, liquidGlass(isDark, false), { marginBottom: 8 }]}>
              <View style={[s.campAccent, { backgroundColor: '#3B82F6' }]} />
              <View style={s.campBody}>
                <View style={s.campTop}>
                  <View style={s.campLogoWrap}>
                    {campaign.creative?.logoUrl ? (
                      <Image source={{ uri: ikAvatar(campaign.creative.logoUrl) }} style={s.campLogo} resizeMode="cover" />
                    ) : (
                      <Package size={18} color={COLORS.primaryStrong} />
                    )}
                  </View>
                  <View style={s.campInfo}>
                    <Text style={[s.campName, { color: textColor(isDark) }]} numberOfLines={1}>
                      {campaign.creative?.productName || campaign.creative?.title || campaign.name}
                    </Text>
                    <Text style={[s.campMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
                      {campaign.creative?.tagline || campaign.creative?.description}
                    </Text>
                    <Text style={[s.campMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
                      by {campaign.ownerName} · {placementsLabel(campaign)}
                    </Text>
                  </View>
                </View>
                <View style={s.adminActions}>
                  <TouchableOpacity
                    onPress={() => moderate(campaign, 'active')}
                    disabled={moderationBusy === campaign.id}
                    style={[s.adminBtn, { backgroundColor: 'rgba(22,163,74,0.14)' }]}
                  >
                    {moderationBusy === campaign.id
                      ? <ActivityIndicator size="small" color="#16A34A" />
                      : <ThumbsUp size={15} color="#16A34A" />}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setRejectTarget(campaign); setRejectReason(''); }}
                    disabled={moderationBusy === campaign.id}
                    style={[s.adminBtn, { backgroundColor: 'rgba(220,38,38,0.12)' }]}
                  >
                    <ThumbsDown size={15} color="#DC2626" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[s.container, appBackground(isDark)]}>
      <ScreenHeader
        title="Campaigns"
        subtitle={
          hasPlan
            ? `${liveCount} of ${MAX_ACTIVE_CAMPAIGNS} live · ${compactNumber(totalImpressions)} views`
            : 'Advertise your product to every founder on LinkUp'
        }
        onBack={() => navigation.goBack()}
        isDark={isDark}
      />

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {loadingAccount ? (
          <View style={s.center}>
            <ActivityIndicator color={COLORS.primaryStrong} />
          </View>
        ) : hasPlan ? (
          renderDashboard()
        ) : (
          renderPaywall()
        )}
        {renderAdmin()}
      </ScrollView>

      <Modal visible={!!rejectTarget} transparent animationType="fade" onRequestClose={() => setRejectTarget(null)}>
        <View style={s.modalBackdrop}>
          <View style={[s.modalCard, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
            <Text style={[s.modalTitle, { color: textColor(isDark) }]}>Reject this campaign?</Text>
            <Text style={[s.modalSub, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>
              {rejectTarget?.creative?.productName || rejectTarget?.creative?.title || rejectTarget?.name || 'Untitled'}
              {rejectTarget?.ownerName ? ` · ${rejectTarget.ownerName}` : ''}
            </Text>
            <TextInput
              value={rejectReason}
              onChangeText={(v) => setRejectReason(v.slice(0, 280))}
              placeholder="Why is it rejected? The advertiser sees this note..."
              placeholderTextColor={textColor(isDark, 'muted')}
              multiline maxLength={280}
              style={[s.rejectInput, {
                backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec,
                borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
                color: textColor(isDark),
              }]}
            />
            <Text style={[s.rejectHint, { color: textColor(isDark, 'muted') }]}>{rejectReason.length}/280</Text>
            <TouchableOpacity style={s.rejectBtn} activeOpacity={0.86} onPress={submitRejection} disabled={rejectBusy}>
              {rejectBusy ? <ActivityIndicator color="#FFF" /> : <Text style={s.rejectBtnText}>REJECT CAMPAIGN</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setRejectTarget(null); setRejectReason(''); }} style={s.cancelBtn} activeOpacity={0.8}>
              <Text style={[s.cancelBtnText, { color: textColor(isDark, 'secondary') }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { paddingVertical: 80, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingBottom: 48, gap: 10 },

  /* ── Live badge ────────────────────────── */
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  livePulse: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#16A34A' },
  liveText: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, color: COLORS.primaryStrong, textTransform: 'uppercase' },
  slotText: { fontSize: 11, fontWeight: '800' },

  /* ── Stat tiles ────────────────────────── */
  tileRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  tile: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  tileVal: { fontSize: 18, fontWeight: '900', letterSpacing: -0.5 },
  tileLbl: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },

  /* ── Capacity ──────────────────────────── */
  capacityCard: { borderRadius: 18, padding: 14, gap: 10, marginBottom: 10 },
  capacityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  capacityTitle: { fontSize: 13, fontWeight: '800' },
  capacityPct: { fontSize: 13, fontWeight: '900' },
  capacityTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  capacityFill: { height: 6, borderRadius: 3 },
  capacitySub: { fontSize: 10, fontWeight: '700' },

  /* ── Share of voice ────────────────────── */
  sovCard: { borderRadius: 18, padding: 14, gap: 12, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 13, fontWeight: '800', letterSpacing: -0.1 },
  sovRow: { gap: 5 },
  sovName: { fontSize: 11, fontWeight: '700' },
  sovBarWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sovTrack: { flex: 1, height: 7, borderRadius: 4, overflow: 'hidden' },
  sovFill: { height: 7, borderRadius: 4, backgroundColor: COLORS.primaryStrong },
  sovVal: { minWidth: 32, textAlign: 'right', fontSize: 9, fontWeight: '800' },

  /* ── Section headers ───────────────────── */
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 2 },
  sectionTitle: { flex: 1, fontSize: 13, fontWeight: '800', letterSpacing: -0.1 },
  sectionCount: { fontSize: 11, fontWeight: '800' },

  /* ── Campaign cards ────────────────────── */
  campCard: { flexDirection: 'row', borderRadius: 18, overflow: 'hidden', marginBottom: 10 },
  campAccent: { width: 3 },
  campBody: { flex: 1, padding: 12, gap: 10 },
  campTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campLogoWrap: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: COLORS.primaryGlow,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  campLogo: { width: '100%', height: '100%' },
  campInfo: { flex: 1, minWidth: 0 },
  campName: { fontSize: 14, fontWeight: '800', letterSpacing: -0.1 },
  campMeta: { marginTop: 1, fontSize: 11, fontWeight: '600' },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  chipText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },
  campStatsRow: { flexDirection: 'row', alignItems: 'center' },
  campStat: { flex: 1, alignItems: 'center' },
  campStatVal: { fontSize: 14, fontWeight: '900' },
  campStatLbl: { marginTop: 1, fontSize: 9, fontWeight: '700' },
  campSep: { width: 1, height: 18 },
  campActions: { flexDirection: 'row', gap: 6 },
  campActionBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: COLORS.primaryGlow, alignItems: 'center', justifyContent: 'center' },

  /* ── Empty ─────────────────────────────── */
  emptyCard: { borderRadius: 20, padding: 28, alignItems: 'center', gap: 6 },
  emptyIconWrap: { width: 48, height: 48, borderRadius: 15, backgroundColor: COLORS.primaryGlow, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '900' },
  emptySub: { fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 18 },

  /* ── Paywall ───────────────────────────── */
  payHero: { borderRadius: 22, padding: 20, marginBottom: 10, overflow: 'hidden', backgroundColor: COLORS.primaryGlow },
  payHeroGlow: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 22 },
  payIconRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  payIconWrap: { width: 44, height: 44, borderRadius: 14, backgroundColor: COLORS.primaryStrong, alignItems: 'center', justifyContent: 'center' },
  trialBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999,
    backgroundColor: COLORS.primaryGlow, borderWidth: 1, borderColor: COLORS.primaryStrong,
  },
  trialBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 1, color: COLORS.primaryStrong },
  payTitle: { marginTop: 14, fontSize: 22, lineHeight: 28, fontWeight: '900', letterSpacing: -0.4 },
  paySub: { marginTop: 6, fontSize: 12, lineHeight: 18, fontWeight: '600' },

  planRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  planCard: { flex: 1, borderRadius: 16, padding: 12, gap: 6, borderWidth: 1, borderColor: 'transparent' },
  planCardSel: { borderColor: COLORS.primaryStrong, backgroundColor: COLORS.primaryGlow },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  planCheck: { width: 16, height: 16, borderRadius: 8, backgroundColor: COLORS.primaryStrong, alignItems: 'center', justifyContent: 'center' },
  planBadge: { fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  planPriceRow: { flexDirection: 'row', alignItems: 'flex-end' },
  planPrice: { fontSize: 20, lineHeight: 24, fontWeight: '900', letterSpacing: -0.5 },
  planCadence: { fontSize: 10, fontWeight: '800', marginLeft: 2, marginBottom: 2 },
  planHelper: { fontSize: 9, lineHeight: 13, fontWeight: '700' },

  perksCard: { borderRadius: 18, padding: 14, gap: 10, marginBottom: 10 },
  perkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  perkText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '600' },

  /* ── CTA ───────────────────────────────── */
  ctaBtn: {
    marginTop: 14, height: 50, borderRadius: 16,
    backgroundColor: COLORS.inkButton,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontSize: 12, fontWeight: '900', letterSpacing: 1.1, color: COLORS.inkButtonText },
  capHint: { marginTop: 8, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  restoreBtn: { marginTop: 10, height: 38, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  restoreText: { fontSize: 10, fontWeight: '900' },

  /* ── Admin ─────────────────────────────── */
  adminHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 10 },
  adminDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#DC2626' },
  adminEmpty: { fontSize: 11, fontWeight: '700' },
  adminActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  adminBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  /* ── Modal ─────────────────────────────── */
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 420, borderRadius: 24, borderWidth: 1, padding: 20 },
  modalTitle: { fontSize: 19, fontWeight: '900', letterSpacing: -0.3 },
  modalSub: { marginTop: 6, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  rejectInput: { marginTop: 16, minHeight: 96, maxHeight: 150, borderRadius: 16, borderWidth: 1, padding: 14, fontSize: 13, lineHeight: 19, fontWeight: '600', textAlignVertical: 'top' },
  rejectHint: { marginTop: 8, fontSize: 10, fontWeight: '800' },
  rejectBtn: { marginTop: 16, height: 50, borderRadius: 16, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center' },
  rejectBtnText: { color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  cancelBtn: { marginTop: 12, height: 40, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 12, fontWeight: '900' },
});
