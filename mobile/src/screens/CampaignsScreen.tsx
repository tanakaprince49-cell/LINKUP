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
  MousePointerClick,
  Package,
  Pause,
  Play,
  Pencil,
  Plus,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Users,
} from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
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

const BAR_PALETTE = ['#16A34A', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899'];

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
    (c.placements || []).map((id) => CAMPAIGN_PLACEMENT_OPTIONS.find((o) => o.id === id)?.label || id).join(', ');

  const capacityPct = Math.round((Math.min(liveCount, MAX_ACTIVE_CAMPAIGNS) / MAX_ACTIVE_CAMPAIGNS) * 100);

  const shareOfVoice = [...campaigns]
    .map((c, i) => ({ id: c.id, name: c.creative?.productName || c.creative?.title || c.name || 'Untitled', views: c.statsImpressions || 0, color: BAR_PALETTE[i % BAR_PALETTE.length] }))
    .filter((e) => e.views > 0).sort((a, b) => b.views - a.views).slice(0, 5);
  const shareLead = shareOfVoice[0]?.views || 1;

  // ─── Dashboard ─────────────────────────────────────────────
  const renderDashboard = () => (
    <View>
      {/* Metrics overview */}
      <View style={[s.metricsCard, liquidGlass(isDark, false)]}>
        <View style={s.metricsTop}>
          <View style={s.livePulse}>
            <View style={s.liveDot} />
            <Text style={[s.liveLabel, { color: textColor(isDark) }]}>{trialLabel || 'Campaigns Live'}</Text>
          </View>
          <Text style={[s.slotLabel, { color: textColor(isDark, 'muted') }]}>
            {liveCount}/{MAX_ACTIVE_CAMPAIGNS} slots
          </Text>
        </View>
        <View style={s.metricsGrid}>
          <View style={s.metricCell}>
            <Text style={[s.metricVal, { color: textColor(isDark) }]}>{compactNumber(totalImpressions)}</Text>
            <Text style={[s.metricLbl, { color: textColor(isDark, 'muted') }]}>Impressions</Text>
          </View>
          <View style={[s.metricSep, { backgroundColor: textColor(isDark, 'muted') + '18' }]} />
          <View style={s.metricCell}>
            <Text style={[s.metricVal, { color: textColor(isDark) }]}>{compactNumber(totalClicks)}</Text>
            <Text style={[s.metricLbl, { color: textColor(isDark, 'muted') }]}>Clicks</Text>
          </View>
          <View style={[s.metricSep, { backgroundColor: textColor(isDark, 'muted') + '18' }]} />
          <View style={s.metricCell}>
            <Text style={[s.metricVal, { color: textColor(isDark) }]}>{totalCtr}</Text>
            <Text style={[s.metricLbl, { color: textColor(isDark, 'muted') }]}>CTR</Text>
          </View>
        </View>
        <View style={[s.capacityTrack, { backgroundColor: textColor(isDark, 'muted') + '18' }]}>
          <View style={[s.capacityFill, { width: `${capacityPct}%`, backgroundColor: capacityPct >= 100 ? '#E11D48' : capacityPct >= 66 ? '#D97706' : '#16A34A' }]} />
        </View>
        <Text style={[s.capacityHint, { color: textColor(isDark, 'muted') }]}>{capacityPct}% capacity used</Text>
      </View>

      {/* Share of voice chart */}
      {shareOfVoice.length > 0 && (
        <View style={[s.chartCard, liquidGlass(isDark, false)]}>
          <View style={s.chartHeader}>
            <BarChart3 size={14} color={COLORS.primaryStrong} />
            <Text style={[s.chartTitle, { color: textColor(isDark) }]}>Share of Voice</Text>
          </View>
          {shareOfVoice.map((entry) => (
            <View key={entry.id} style={s.barRow}>
              <Text style={[s.barName, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>{entry.name}</Text>
              <View style={s.barTrack}>
                <View style={[s.barFill, { width: `${Math.max(3, Math.round((entry.views / shareLead) * 100))}%`, backgroundColor: entry.color }]} />
              </View>
              <Text style={[s.barVal, { color: textColor(isDark, 'muted') }]}>{compactNumber(entry.views)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* New campaign */}
      <TouchableOpacity
        style={[s.ctaBtn, liveCount >= MAX_ACTIVE_CAMPAIGNS && s.ctaDisabled]}
        activeOpacity={0.86}
        disabled={liveCount >= MAX_ACTIVE_CAMPAIGNS}
        onPress={() => navigation.navigate('CreateCampaign')}
      >
        <Plus size={16} color="#FFF" />
        <Text style={s.ctaText}>New Campaign</Text>
      </TouchableOpacity>
      {liveCount >= MAX_ACTIVE_CAMPAIGNS && (
        <Text style={[s.capHint, { color: textColor(isDark, 'muted') }]}>
          All {MAX_ACTIVE_CAMPAIGNS} slots in use — pause one to free a slot.
        </Text>
      )}

      {/* Campaign list */}
      <Text style={[s.sectionLabel, { color: textColor(isDark, 'muted') }]}>MY CAMPAIGNS</Text>

      {campaigns.length === 0 ? (
        <View style={[s.emptyCard, liquidGlass(isDark, false)]}>
          <Megaphone size={20} color={COLORS.primaryStrong} />
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
              <View style={s.campTop}>
                <View style={s.campLogoWrap}>
                  {logo ? (
                    <Image source={{ uri: ikAvatar(logo) }} style={s.campLogo} resizeMode="cover" />
                  ) : (
                    <Package size={16} color={COLORS.primaryStrong} />
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
                  <StatusIcon size={9} color={sc.fg} />
                  <Text style={[s.chipText, { color: sc.fg }]}>{meta.label}</Text>
                </View>
              </View>

              <View style={s.campBottom}>
                <View style={s.campStats}>
                  <Text style={[s.campStatVal, { color: textColor(isDark) }]}>{ctr}</Text>
                  <Text style={[s.campStatLbl, { color: textColor(isDark, 'muted') }]}>CTR</Text>
                </View>
                <View style={[s.campStatSep, { backgroundColor: textColor(isDark, 'muted') + '18' }]} />
                <View style={s.campStats}>
                  <Text style={[s.campStatVal, { color: textColor(isDark) }]}>{compactNumber(campaign.statsImpressions || 0)}</Text>
                  <Text style={[s.campStatLbl, { color: textColor(isDark, 'muted') }]}>views</Text>
                </View>
                <View style={[s.campStatSep, { backgroundColor: textColor(isDark, 'muted') + '18' }]} />
                <View style={s.campStats}>
                  <Text style={[s.campStatVal, { color: textColor(isDark) }]}>{compactNumber(campaign.statsClicks || 0)}</Text>
                  <Text style={[s.campStatLbl, { color: textColor(isDark, 'muted') }]}>clicks</Text>
                </View>
                <View style={s.campActions}>
                  {(campaign.status === 'active' || campaign.status === 'paused') && (
                    <TouchableOpacity onPress={togglePause} style={s.campActionBtn} activeOpacity={0.8}>
                      {campaign.status === 'active'
                        ? <Pause size={12} color={textColor(isDark, 'secondary')} />
                        : <Play size={12} color={textColor(isDark, 'secondary')} />}
                    </TouchableOpacity>
                  )}
                  {campaign.status === 'pending_review' && (
                    <TouchableOpacity
                      onPress={() => navigation.navigate('CreateCampaign', { editCampaign: campaign })}
                      style={s.campActionBtn} activeOpacity={0.8}
                    >
                      <Pencil size={12} color={textColor(isDark, 'secondary')} />
                    </TouchableOpacity>
                  )}
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
      <View style={s.payHero}>
        <View style={s.payIconRow}>
          <View style={s.payIconWrap}>
            <Megaphone size={20} color="#FFF" />
          </View>
          <View style={s.trialBadge}>
            <Sparkles size={10} color={COLORS.primaryStrong} />
            <Text style={[s.trialBadgeText, { color: textColor(isDark) }]}>{`${trialForPlan(selectedCampaignsPlan).trialDays} DAYS FREE`}</Text>
          </View>
        </View>
        <Text style={[s.payTitle, { color: textColor(isDark) }]}>
          Put your product in front of every founder
        </Text>
        <Text style={[s.paySub, { color: textColor(isDark, 'muted') }]}>
          Sponsored cards placed natively across Idea Deck, Discover, Search, Hub and Linky's picks.
        </Text>
      </View>

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
                  <View style={s.planCheck}><Check size={10} color="#FFF" /></View>
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

      <View style={[s.perksCard, liquidGlass(isDark, false)]}>
        <Text style={[s.perksTitle, { color: textColor(isDark) }]}>Everything Included</Text>
        {CAMPAIGNS_PERKS.map((perk) => (
          <View key={perk} style={s.perkRow}>
            <CheckCircle2 size={14} color={COLORS.primaryStrong} />
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
            {`Start ${trialForPlan(selectedCampaignsPlan).trialDays}-Day Free Trial`}
          </Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={handleRestore} style={s.restoreBtn} activeOpacity={0.8} disabled={purchaseBusy}>
        <Lock size={11} color={textColor(isDark, 'muted')} />
        <Text style={[s.restoreText, { color: textColor(isDark, 'muted') }]}>Restore purchases</Text>
      </TouchableOpacity>
    </View>
  );

  // ─── Admin ─────────────────────────────────────────────────
  const renderAdmin = () => {
    if (!admin) return null;
    return (
      <View>
        <Text style={[s.sectionLabel, { color: textColor(isDark, 'muted'), marginTop: 16 }]}>
          REVIEW QUEUE{pending.length > 0 ? ` · ${pending.length}` : ''}
        </Text>
        {pending.length === 0 ? (
          <Text style={[s.adminEmpty, { color: textColor(isDark, 'muted') }]}>Queue is clear</Text>
        ) : (
          pending.map((campaign) => (
            <View key={campaign.id} style={[s.campCard, liquidGlass(isDark, false), { marginBottom: 8 }]}>
              <View style={s.campTop}>
                <View style={s.campLogoWrap}>
                  {campaign.creative?.logoUrl ? (
                    <Image source={{ uri: ikAvatar(campaign.creative.logoUrl) }} style={s.campLogo} resizeMode="cover" />
                  ) : (
                    <Package size={16} color={COLORS.primaryStrong} />
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
                    by {campaign.ownerName}
                  </Text>
                </View>
              </View>
              <View style={s.adminActions}>
                <TouchableOpacity
                  onPress={() => moderate(campaign, 'active')}
                  disabled={moderationBusy === campaign.id}
                  style={[s.adminBtn, { backgroundColor: 'rgba(22,163,74,0.12)' }]}
                >
                  {moderationBusy === campaign.id
                    ? <ActivityIndicator size="small" color="#16A34A" />
                    : <ThumbsUp size={14} color="#16A34A" />}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setRejectTarget(campaign); setRejectReason(''); }}
                  disabled={moderationBusy === campaign.id}
                  style={[s.adminBtn, { backgroundColor: 'rgba(220,38,38,0.10)' }]}
                >
                  <ThumbsDown size={14} color="#DC2626" />
                </TouchableOpacity>
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
              placeholder="Reason for rejection..."
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
              {rejectBusy ? <ActivityIndicator color="#FFF" /> : <Text style={s.rejectBtnText}>Reject Campaign</Text>}
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

  /* ── Metrics card ──────────────────────── */
  metricsCard: { borderRadius: 16, padding: 16, gap: 14, marginBottom: 2 },
  metricsTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  livePulse: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#16A34A' },
  liveLabel: { fontSize: 13, fontWeight: '700' },
  slotLabel: { fontSize: 11, fontWeight: '700' },
  metricsGrid: { flexDirection: 'row', alignItems: 'center' },
  metricCell: { flex: 1, alignItems: 'center' },
  metricSep: { width: 1, height: 28 },
  metricVal: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  metricLbl: { marginTop: 2, fontSize: 10, fontWeight: '600' },
  capacityTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  capacityFill: { height: 4, borderRadius: 2 },
  capacityHint: { fontSize: 10, fontWeight: '600' },

  /* ── Chart card ────────────────────────── */
  chartCard: { borderRadius: 16, padding: 16, gap: 12, marginBottom: 2 },
  chartHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chartTitle: { fontSize: 13, fontWeight: '700' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barName: { width: 80, fontSize: 11, fontWeight: '600' },
  barTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: 'transparent' },
  barFill: { height: 8, borderRadius: 4 },
  barVal: { width: 36, textAlign: 'right', fontSize: 10, fontWeight: '700' },

  /* ── Section labels ────────────────────── */
  sectionLabel: { marginTop: 12, marginBottom: 4, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' },

  /* ── Campaign cards ────────────────────── */
  campCard: { borderRadius: 14, padding: 14, gap: 12, marginBottom: 8 },
  campTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campLogoWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.primaryGlow,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  campLogo: { width: '100%', height: '100%' },
  campInfo: { flex: 1, minWidth: 0 },
  campName: { fontSize: 13, fontWeight: '700', letterSpacing: -0.1 },
  campMeta: { marginTop: 1, fontSize: 11, fontWeight: '500' },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  chipText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  campBottom: { flexDirection: 'row', alignItems: 'center' },
  campStats: { flex: 1, alignItems: 'center' },
  campStatVal: { fontSize: 13, fontWeight: '800' },
  campStatLbl: { marginTop: 1, fontSize: 9, fontWeight: '600' },
  campStatSep: { width: 1, height: 16 },
  campActions: { flexDirection: 'row', gap: 6 },
  campActionBtn: { width: 30, height: 30, borderRadius: 9, backgroundColor: COLORS.primaryGlow, alignItems: 'center', justifyContent: 'center' },

  /* ── Empty ─────────────────────────────── */
  emptyCard: { borderRadius: 16, padding: 28, alignItems: 'center', gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: '700' },
  emptySub: { fontSize: 12, fontWeight: '500', textAlign: 'center', lineHeight: 18 },

  /* ── Paywall ───────────────────────────── */
  payHero: { borderRadius: 16, padding: 18, marginBottom: 2 },
  payIconRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  payIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.primaryStrong, alignItems: 'center', justifyContent: 'center' },
  trialBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: COLORS.primaryGlow, borderWidth: 1, borderColor: textColor(false, 'muted') + '20',
  },
  trialBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  payTitle: { marginTop: 14, fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.3 },
  paySub: { marginTop: 6, fontSize: 12, lineHeight: 18, fontWeight: '500' },

  planRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  planCard: { flex: 1, borderRadius: 14, padding: 12, gap: 6, borderWidth: 1, borderColor: 'transparent' },
  planCardSel: { borderColor: COLORS.primaryStrong, backgroundColor: COLORS.primaryGlow },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  planCheck: { width: 16, height: 16, borderRadius: 8, backgroundColor: COLORS.primaryStrong, alignItems: 'center', justifyContent: 'center' },
  planBadge: { fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },
  planPriceRow: { flexDirection: 'row', alignItems: 'flex-end' },
  planPrice: { fontSize: 20, lineHeight: 24, fontWeight: '800', letterSpacing: -0.5 },
  planCadence: { fontSize: 10, fontWeight: '700', marginLeft: 2, marginBottom: 2 },
  planHelper: { fontSize: 9, lineHeight: 13, fontWeight: '600' },

  perksCard: { borderRadius: 16, padding: 16, gap: 10, marginBottom: 2 },
  perksTitle: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  perkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  perkText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '500' },

  /* ── CTA ───────────────────────────────── */
  ctaBtn: {
    marginTop: 12, height: 48, borderRadius: 14,
    backgroundColor: COLORS.inkButton,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { fontSize: 13, fontWeight: '700', color: COLORS.inkButtonText },
  capHint: { marginTop: 6, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  restoreBtn: { marginTop: 8, height: 36, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  restoreText: { fontSize: 10, fontWeight: '700' },

  /* ── Admin ─────────────────────────────── */
  adminEmpty: { fontSize: 11, fontWeight: '600' },
  adminActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  adminBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  /* ── Modal ─────────────────────────────── */
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 400, borderRadius: 20, borderWidth: 1, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  modalSub: { marginTop: 4, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  rejectInput: { marginTop: 14, minHeight: 80, maxHeight: 140, borderRadius: 12, borderWidth: 1, padding: 12, fontSize: 13, lineHeight: 19, fontWeight: '500', textAlignVertical: 'top' },
  rejectHint: { marginTop: 6, fontSize: 10, fontWeight: '700' },
  rejectBtn: { marginTop: 14, height: 44, borderRadius: 12, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center' },
  rejectBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  cancelBtn: { marginTop: 10, height: 36, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 12, fontWeight: '700' },
});
