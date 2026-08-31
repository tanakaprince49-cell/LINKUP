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
  Rocket,
  ShieldCheck,
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

const STATUS_COLORS: Record<string, { bg: string; fg: string; icon: typeof Check }> = {
  active: { bg: 'rgba(22,163,74,0.12)', fg: '#16A34A', icon: Check },
  paused: { bg: 'rgba(217,119,6,0.12)', fg: '#D97706', icon: Pause },
  pending_review: { bg: 'rgba(59,130,246,0.12)', fg: '#3B82F6', icon: Eye },
  rejected: { bg: 'rgba(225,29,72,0.12)', fg: '#E11D48', icon: ThumbsDown },
};

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
    onPurchaseSuccess: (purchase) => {
      void handlePurchaseSuccess(purchase);
    },
    onPurchaseError: (error) => {
      setPurchaseBusy(false);
      const code = String(error?.code || '').toLowerCase();
      if (code.includes('user') || code.includes('cancel')) return;
      Alert.alert('Purchase failed', error?.message || 'Google Play could not complete the Campaigns purchase.');
    },
    onError: (error) => {
      setStoreError(error?.message || 'Google Play billing is not ready yet.');
    },
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
      plan: 'campaigns',
      status: 'active',
      planProductId: purchasedProductId,
      isTrial: !!trial && trial.endsAt > Date.now(),
      trialEndsAt: trial?.endsAt || null,
      transactionId: purchase.transactionId || purchase.id || null,
      purchaseToken: purchase.purchaseToken || null,
      billingProvider: purchase.store || (Platform.OS === 'android' ? 'google-play' : 'app-store'),
      unlockedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
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
    if (!user?.uid) {
      setLoadingAccount(false);
      return;
    }
    fetchCampaignsAccount(user.uid).then((data) => {
      if (!mounted) return;
      setAccount(data);
      setLoadingAccount(false);
    });
    if (isAdminIdentity({ email: user?.email, isAdmin: (profile as any)?.isAdmin })) {
      setRemoteAdmin(true);
    } else {
      isCampaignAdmin(user.uid, { email: user?.email, isAdmin: (profile as any)?.isAdmin }).then((flag) => {
        if (mounted) setRemoteAdmin(flag);
      });
    }
    const unsubscribeMine = subscribeMyCampaigns(user.uid, (rows) => {
      if (mounted) setCampaigns(rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)));
    }, () => {});
    return () => { mounted = false; unsubscribeMine(); };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) { setCampaignsTrial(null); return; }
    let cancelled = false;
    readActiveTrial(user.uid, [...CAMPAIGNS_PRODUCT_IDS]).then((record) => {
      if (!cancelled) setCampaignsTrial(record);
    });
    return () => { cancelled = true; };
  }, [user?.uid, hasPlan]);

  useEffect(() => {
    if (!admin) return;
    return subscribePendingCampaigns((rows) => setPending(rows), () => {});
  }, [admin]);

  useEffect(() => {
    if (hasPlan || loadingAccount || !user?.uid) return;
    let cancelled = false;
    const loadProducts = async () => {
      setStoreError('');
      try {
        if (!connected) await reconnect();
        if (!cancelled) await fetchProducts({ skus: [...CAMPAIGNS_PRODUCT_IDS], type: 'subs' });
      } catch (error: any) {
        if (!cancelled) setStoreError(error?.message || 'Could not load Campaigns from Google Play.');
      }
    };
    void loadProducts();
    return () => { cancelled = true; };
  }, [connected, fetchProducts, hasPlan, loadingAccount, reconnect, user?.uid]);

  const productForPlan = useCallback(
    (plan: CampaignsPlan) => subscriptions.find((product) => product.id === plan.productId),
    [subscriptions]
  );

  const offerForPlan = useCallback(
    (plan: CampaignsPlan) => pickSubscriptionOffer(productForPlan(plan)),
    [productForPlan]
  );

  const trialForPlan = useCallback(
    (plan: CampaignsPlan) => describeSubscriptionOffer(offerForPlan(plan), plan.price, TRIAL_DAYS),
    [offerForPlan]
  );

  const selectedCampaignsPlan = CAMPAIGNS_PLANS.find((plan) => plan.id === selectedPlan) || CAMPAIGNS_PLANS[0];

  const handleStartCampaigns = async () => {
    if (!user?.uid) {
      Alert.alert('Sign in required', 'Sign in first, then start LinkUp Campaigns.');
      return;
    }
    const plan = CAMPAIGNS_PLANS.find((item) => item.id === selectedPlan) || CAMPAIGNS_PLANS[0];
    if (Platform.OS === 'web') {
      setPurchaseBusy(true);
      setStoreError('');
      try {
        const { redirectUrl } = await startPaynowCheckout(plan.webPlanKey);
        (window as any)?.location?.assign?.(redirectUrl);
      } catch (error: any) {
        setPurchaseBusy(false);
        Alert.alert('Checkout failed', error?.message || 'Paynow could not start checkout right now.');
      }
      return;
    }
    const offerToken = offerTokenFor(offerForPlan(plan));
    if (Platform.OS === 'android' && !offerToken) {
      Alert.alert(
        'Google Play product missing',
        storeError || 'Campaigns is not ready in Google Play yet.'
      );
      return;
    }
    setPurchaseBusy(true);
    setStoreError('');
    try {
      await requestPurchase({
        type: 'subs',
        request: {
          apple: { sku: plan.productId },
          google: {
            skus: [plan.productId],
            obfuscatedAccountId: user.uid,
            obfuscatedProfileId: user.uid,
            subscriptionOffers: offerToken ? [{ sku: plan.productId, offerToken }] : undefined,
          },
        },
      });
    } catch (error: any) {
      setPurchaseBusy(false);
      Alert.alert('Purchase failed', error?.message || 'Google Play could not start checkout for Campaigns.');
    }
  };

  const handleRestore = async () => {
    if (Platform.OS === 'web') {
      setPurchaseBusy(true);
      setStoreError('');
      try {
        const pending = takePendingReference();
        if (pending) await checkPaynowPayment(pending);
        Alert.alert(
          'Restore purchases',
          pending
            ? 'We checked your latest Paynow payment. If it completed, Campaigns is now active.'
            : 'Campaigns is tied to your LINKUP account, so it is already active here if you have paid.'
        );
      } catch (error: any) {
        Alert.alert('Restore failed', error?.message || 'We could not check your Paynow payment right now.');
      } finally {
        setPurchaseBusy(false);
      }
      return;
    }
    setPurchaseBusy(true);
    try {
      await restorePurchases();
      const purchases = await getAvailablePurchases();
      const campaignsPurchase = purchases.find(isCampaignsPurchase);
      if (campaignsPurchase) {
        await handlePurchaseSuccess(campaignsPurchase);
      } else {
        Alert.alert('Restore purchases', 'No active Campaigns purchase was found for this Google Play account.');
        setPurchaseBusy(false);
      }
    } catch (error: any) {
      setPurchaseBusy(false);
      Alert.alert('Restore failed', error?.message || 'Google Play could not restore purchases right now.');
    }
  };

  const moderate = async (campaign: Campaign, status: 'active' | 'rejected', note: string = '') => {
    if (moderationBusy) return;
    setModerationBusy(campaign.id);
    try {
      await setCampaignStatus(campaign.id, status, note);
    } catch (error: any) {
      notifyUser('Moderation failed', error?.message || 'Try again.');
    } finally {
      setModerationBusy('');
    }
  };

  const submitRejection = async () => {
    if (!rejectTarget) return;
    const note = rejectReason.trim() || 'Does not meet LinkUp campaign guidelines. Update the creative and resubmit.';
    setRejectBusy(true);
    await moderate(rejectTarget, 'rejected', note);
    setRejectBusy(false);
    setRejectTarget(null);
    setRejectReason('');
  };

  const placementsLabel = (campaign: Campaign) =>
    (campaign.placements || [])
      .map((id) => CAMPAIGN_PLACEMENT_OPTIONS.find((option) => option.id === id)?.label || id)
      .join(' ');

  const capacityPct = Math.round((Math.min(liveCount, MAX_ACTIVE_CAMPAIGNS) / MAX_ACTIVE_CAMPAIGNS) * 100);

  const shareOfVoice = [...campaigns]
    .map((c) => ({
      id: c.id,
      name: c.creative?.productName || c.creative?.title || c.name || 'Untitled',
      views: c.statsImpressions || 0,
    }))
    .filter((e) => e.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);
  const shareLead = shareOfVoice[0]?.views || 1;

  // ─── Dashboard ───────────────────────────────────────────────
  const renderDashboard = () => (
    <View>
      {/* Hero card */}
      <View style={[s.hero, { backgroundColor: isDark ? COLORS.darkCard : '#0A0B0D' }]}>
        <View style={s.heroTopRow}>
          <View style={s.heroPill}>
            <View style={s.heroPillDot} />
            <Text style={s.heroPillText}>{trialLabel || 'LIVE'}</Text>
          </View>
          <Text style={s.heroSlots}>
            {liveCount}/{MAX_ACTIVE_CAMPAIGNS}
          </Text>
        </View>

        <Text style={s.heroBig}>{compactNumber(totalImpressions)}</Text>
        <Text style={s.heroSub}>total impressions</Text>

        <View style={s.heroMeterWrap}>
          <View style={s.heroMeterTrack}>
            <View style={[s.heroMeterFill, { width: `${capacityPct}%` }]} />
          </View>
        </View>
        <Text style={s.heroMeterLabel}>{capacityPct}% capacity used</Text>

        <View style={s.heroDivider} />

        <View style={s.heroStatsRow}>
          <View style={s.heroStat}>
            <Text style={s.heroStatVal}>{compactNumber(totalClicks)}</Text>
            <Text style={s.heroStatLbl}>CLICKS</Text>
          </View>
          <View style={s.heroStatDivider} />
          <View style={s.heroStat}>
            <Text style={s.heroStatVal}>{totalCtr}</Text>
            <Text style={s.heroStatLbl}>CTR</Text>
          </View>
          <View style={s.heroStatDivider} />
          <View style={s.heroStat}>
            <Text style={s.heroStatVal}>{String(liveCount)}</Text>
            <Text style={s.heroStatLbl}>ACTIVE</Text>
          </View>
        </View>
      </View>

      {/* Share of voice */}
      {shareOfVoice.length > 0 && (
        <View style={[s.card, liquidGlass(isDark, false)]}>
          <View style={s.cardHeader}>
            <BarChart3 size={14} color={COLORS.primaryStrong} />
            <Text style={[s.cardTitle, { color: textColor(isDark) }]}>Share of Voice</Text>
          </View>
          {shareOfVoice.map((entry) => (
            <View key={entry.id} style={s.sovRow}>
              <Text style={[s.sovName, { color: textColor(isDark) }]} numberOfLines={1}>
                {entry.name}
              </Text>
              <View style={s.sovBarWrap}>
                <View style={[s.sovBarTrack, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBg }]}>
                  <View
                    style={[
                      s.sovBarFill,
                      { width: `${Math.max(4, Math.round((entry.views / shareLead) * 100))}%` },
                    ]}
                  />
                </View>
                <Text style={[s.sovVal, { color: textColor(isDark, 'muted') }]}>{compactNumber(entry.views)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* New campaign */}
      <TouchableOpacity
        style={[s.primaryBtn, liveCount >= MAX_ACTIVE_CAMPAIGNS && s.primaryBtnDisabled]}
        activeOpacity={0.86}
        disabled={liveCount >= MAX_ACTIVE_CAMPAIGNS}
        onPress={() => navigation.navigate('CreateCampaign')}
      >
        <Plus size={16} color="#FFF" />
        <Text style={s.primaryBtnText}>NEW CAMPAIGN</Text>
      </TouchableOpacity>
      {liveCount >= MAX_ACTIVE_CAMPAIGNS && (
        <Text style={[s.capHint, { color: textColor(isDark, 'muted') }]}>
          All {MAX_ACTIVE_CAMPAIGNS} slots in use — pause one to free a slot.
        </Text>
      )}

      {/* Campaign list */}
      <View style={s.listHeader}>
        <Rocket size={14} color={COLORS.primaryStrong} />
        <Text style={[s.listTitle, { color: textColor(isDark) }]}>My Campaigns</Text>
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
          const sc = STATUS_COLORS[campaign.status] || STATUS_COLORS.pending_review;
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
                    <Text style={[s.statusChipText, { color: sc.fg }]}>{meta.label}</Text>
                  </View>
                </View>

                <View style={s.campStatsRow}>
                  <View style={s.campStatItem}>
                    <Text style={[s.campStatVal, { color: textColor(isDark) }]}>{ctr}</Text>
                    <Text style={[s.campStatLbl, { color: textColor(isDark, 'muted') }]}>CTR</Text>
                  </View>
                  <View style={[s.campStatSep, { backgroundColor: textColor(isDark, 'muted') + '20' }]} />
                  <View style={s.campStatItem}>
                    <Text style={[s.campStatVal, { color: textColor(isDark) }]}>
                      {compactNumber(campaign.statsImpressions || 0)}
                    </Text>
                    <Text style={[s.campStatLbl, { color: textColor(isDark, 'muted') }]}>views</Text>
                  </View>
                  <View style={[s.campStatSep, { backgroundColor: textColor(isDark, 'muted') + '20' }]} />
                  <View style={s.campStatItem}>
                    <Text style={[s.campStatVal, { color: textColor(isDark) }]}>
                      {compactNumber(campaign.statsClicks || 0)}
                    </Text>
                    <Text style={[s.campStatLbl, { color: textColor(isDark, 'muted') }]}>clicks</Text>
                  </View>

                  <View style={s.campActions}>
                    {(campaign.status === 'active' || campaign.status === 'paused') && (
                      <TouchableOpacity onPress={togglePause} style={s.campActionBtn} activeOpacity={0.8}>
                        {campaign.status === 'active' ? (
                          <Pause size={13} color={textColor(isDark, 'secondary')} />
                        ) : (
                          <Play size={13} color={textColor(isDark, 'secondary')} />
                        )}
                      </TouchableOpacity>
                    )}
                    {campaign.status === 'pending_review' && (
                      <TouchableOpacity
                        onPress={() => navigation.navigate('CreateCampaign', { editCampaign: campaign })}
                        style={s.campActionBtn}
                        activeOpacity={0.8}
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

  // ─── Paywall ─────────────────────────────────────────────────
  const renderPaywall = () => (
    <View>
      <View style={[s.hero, { backgroundColor: isDark ? COLORS.darkCard : '#0A0B0D' }]}>
        <View style={s.paywallIconRow}>
          <View style={s.paywallIconWrap}>
            <Megaphone size={22} color="#FFF" />
          </View>
          <View style={s.heroPill}>
            <Sparkles size={10} color="#FFF" />
            <Text style={s.heroPillText}>{`${trialForPlan(selectedCampaignsPlan).trialDays} DAYS FREE`}</Text>
          </View>
        </View>

        <Text style={[s.heroBig, { fontSize: 26, lineHeight: 32 }]}>
          Put your product in front of every founder
        </Text>
        <Text style={s.heroSub}>
          Sponsored cards with your logo and website as the call-to-action — placed natively across Idea Deck,
          Discover, Search, Hub and Linky's picks. No banner blindness.
        </Text>

        <View style={s.pricingRow}>
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
                style={[s.planCard, selected && s.planCardSelected]}
              >
                <View style={s.planTop}>
                  <Text style={s.planLabel}>{plan.label}</Text>
                  {selected ? (
                    <View style={s.planCheck}>
                      <Check size={10} color="#000" />
                    </View>
                  ) : (
                    <Text style={s.planBadge}>{plan.badge}</Text>
                  )}
                </View>
                <View style={s.planPriceRow}>
                  <Text style={s.planPrice}>{storePrice}</Text>
                  <Text style={s.planCadence}>{plan.cadence}</Text>
                </View>
                <Text style={s.planHelper} numberOfLines={2}>
                  {trial.hasTrial ? trialThenPrice(trial, plan.cadence) : plan.helper}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={[s.card, liquidGlass(isDark, false)]}>
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
        style={[s.primaryBtn, { backgroundColor: COLORS.primary }]}
        activeOpacity={0.86}
        onPress={handleStartCampaigns}
        disabled={purchaseBusy}
      >
        {purchaseBusy ? (
          <ActivityIndicator color={COLORS.lightTextPrimary} />
        ) : (
          <Text style={[s.primaryBtnText, { color: COLORS.lightTextPrimary }]}>
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

  // ─── Admin ───────────────────────────────────────────────────
  const renderAdmin = () => {
    if (!admin) return null;
    return (
      <View>
        <View style={s.adminHeader}>
          <View style={s.adminDot} />
          <Text style={[s.listTitle, { color: textColor(isDark) }]}>
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
                    {moderationBusy === campaign.id ? (
                      <ActivityIndicator size="small" color="#16A34A" />
                    ) : (
                      <ThumbsUp size={15} color="#16A34A" />
                    )}
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
          <View
            style={[
              s.modalCard,
              {
                backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard,
                borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
              },
            ]}
          >
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
              multiline
              maxLength={280}
              style={[
                s.rejectInput,
                {
                  backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec,
                  borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
                  color: textColor(isDark),
                },
              ]}
            />
            <Text style={[s.rejectHint, { color: textColor(isDark, 'muted') }]}>
              {rejectReason.length}/280
            </Text>

            <TouchableOpacity style={s.rejectBtn} activeOpacity={0.86} onPress={submitRejection} disabled={rejectBusy}>
              {rejectBusy ? <ActivityIndicator color="#FFF" /> : <Text style={s.rejectBtnText}>REJECT CAMPAIGN</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setRejectTarget(null); setRejectReason(''); }}
              style={s.cancelBtn}
              activeOpacity={0.8}
            >
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

  /* ── Hero ─────────────────────────────── */
  hero: { borderRadius: 22, padding: 20, overflow: 'hidden' },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroPillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#16A34A' },
  heroPillText: { fontSize: 9, fontWeight: '900', letterSpacing: 1, color: '#FFF', textTransform: 'uppercase' },
  heroSlots: { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.5)' },
  heroBig: { marginTop: 16, fontSize: 44, lineHeight: 48, fontWeight: '900', letterSpacing: -1.5, color: '#FFF' },
  heroSub: { marginTop: 4, fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  heroMeterWrap: { marginTop: 16 },
  heroMeterTrack: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  heroMeterFill: { height: 5, borderRadius: 3, backgroundColor: '#FFF' },
  heroMeterLabel: { marginTop: 6, fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.45)' },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.10)', marginVertical: 16 },
  heroStatsRow: { flexDirection: 'row', alignItems: 'center' },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatDivider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.10)' },
  heroStatVal: { fontSize: 18, fontWeight: '900', color: '#FFF' },
  heroStatLbl: { marginTop: 2, fontSize: 9, fontWeight: '900', letterSpacing: 1, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' },

  /* ── Card ─────────────────────────────── */
  card: { borderRadius: 18, padding: 14, gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 13, fontWeight: '800', letterSpacing: -0.1 },

  /* ── Share of voice ───────────────────── */
  sovRow: { gap: 5 },
  sovName: { fontSize: 11, fontWeight: '700' },
  sovBarWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sovBarTrack: { flex: 1, height: 7, borderRadius: 4, overflow: 'hidden' },
  sovBarFill: { height: 7, borderRadius: 4, backgroundColor: COLORS.primaryStrong },
  sovVal: { minWidth: 32, textAlign: 'right', fontSize: 9, fontWeight: '800' },

  /* ── Campaign cards ───────────────────── */
  listHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 2 },
  listTitle: { fontSize: 13, fontWeight: '800', letterSpacing: -0.1 },

  campCard: {
    flexDirection: 'row',
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 10,
  },
  campAccent: { width: 3 },
  campBody: { flex: 1, padding: 12, gap: 10 },
  campTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campLogoWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: COLORS.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  campLogo: { width: '100%', height: '100%' },
  campInfo: { flex: 1, minWidth: 0 },
  campName: { fontSize: 14, fontWeight: '800', letterSpacing: -0.1 },
  campMeta: { marginTop: 1, fontSize: 11, fontWeight: '600' },

  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusChipText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase' },

  campStatsRow: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  campStatItem: { flex: 1, alignItems: 'center' },
  campStatVal: { fontSize: 14, fontWeight: '900' },
  campStatLbl: { marginTop: 1, fontSize: 9, fontWeight: '700' },
  campStatSep: { width: 1, height: 18 },
  campActions: { flexDirection: 'row', gap: 6 },
  campActionBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: COLORS.primaryGlow, alignItems: 'center', justifyContent: 'center' },

  /* ── Empty ────────────────────────────── */
  emptyCard: { borderRadius: 20, padding: 28, alignItems: 'center', gap: 6 },
  emptyIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: COLORS.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 16, fontWeight: '900' },
  emptySub: { fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 18 },

  /* ── Paywall ──────────────────────────── */
  paywallIconRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  paywallIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pricingRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  planCard: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  planCardSelected: { borderColor: '#FFF', backgroundColor: 'rgba(255,255,255,0.16)' },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' },
  planCheck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planBadge: { fontSize: 8, fontWeight: '900', color: 'rgba(255,255,255,0.5)' },
  planPriceRow: { flexDirection: 'row', alignItems: 'flex-end' },
  planPrice: { fontSize: 20, lineHeight: 24, fontWeight: '900', color: '#FFF', letterSpacing: -0.5 },
  planCadence: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', marginLeft: 2, marginBottom: 2 },
  planHelper: { fontSize: 9, lineHeight: 13, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },

  perkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  perkText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '600' },

  /* ── Buttons ──────────────────────────── */
  primaryBtn: {
    marginTop: 14,
    height: 50,
    borderRadius: 16,
    backgroundColor: COLORS.inkButton,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: 12, fontWeight: '900', letterSpacing: 1.1, color: COLORS.inkButtonText },
  capHint: { marginTop: 8, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  restoreBtn: { marginTop: 10, height: 38, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  restoreText: { fontSize: 10, fontWeight: '900' },

  /* ── Admin ────────────────────────────── */
  adminHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 10 },
  adminDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#DC2626' },
  adminEmpty: { fontSize: 11, fontWeight: '700' },
  adminActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  adminBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  /* ── Modal ────────────────────────────── */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: { width: '100%', maxWidth: 420, borderRadius: 24, borderWidth: 1, padding: 20 },
  modalTitle: { fontSize: 19, fontWeight: '900', letterSpacing: -0.3 },
  modalSub: { marginTop: 6, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  rejectInput: {
    marginTop: 16,
    minHeight: 96,
    maxHeight: 150,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    textAlignVertical: 'top',
  },
  rejectHint: { marginTop: 8, fontSize: 10, fontWeight: '800' },
  rejectBtn: {
    marginTop: 16,
    height: 50,
    borderRadius: 16,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtnText: { color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  cancelBtn: { marginTop: 12, height: 40, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 12, fontWeight: '900' },
});
