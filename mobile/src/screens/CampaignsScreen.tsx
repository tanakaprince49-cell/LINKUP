import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
} from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
import { ikAvatar } from '../lib/ikImage';
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

export default function CampaignsScreen({ navigation }: any) {
  const { user, webSubscription } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [account, setAccount] = useState<CampaignsAccount | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pending, setPending] = useState<Campaign[]>([]);
  const [admin, setAdmin] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [storeError, setStoreError] = useState('');
  const [moderationBusy, setModerationBusy] = useState('');
  const [rejectTarget, setRejectTarget] = useState<Campaign | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);
  const [campaignsTrial, setCampaignsTrial] = useState<TrialRecord | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<CampaignsPlan['id']>('monthly');
  const processedPurchases = useRef(new Set<string>());

  const hasPlan = hasCampaignsPlan(account, webCampaignsActive(webSubscription));
  const liveCount = countLiveCampaigns(campaigns);
  const totalImpressions = campaigns.reduce((sum, campaign) => sum + (campaign.statsImpressions || 0), 0);
  const totalClicks = campaigns.reduce((sum, campaign) => sum + (campaign.statsClicks || 0), 0);
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
    const purchasedPlan =
      CAMPAIGNS_PLANS.find((plan) => plan.productId === purchasedProductId) || CAMPAIGNS_PLANS[0];
    // Play owns the billing clock; the local record only powers the countdown.
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
      Alert.alert('Payment pending', 'Google Play is still processing this purchase. Campaigns unlocks when it completes.');
      return;
    }
    try {
      await unlockCampaignsPlan(purchase);
      await finishTransaction({ purchase, isConsumable: false });
      setPurchaseBusy(false);
      Alert.alert('CAMPAIGNS UNLOCKED 🎉', 'You can now launch sponsored campaigns across LinkUp.');
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
    isCampaignAdmin(user.uid).then((flag) => {
      if (mounted) setAdmin(flag);
    });
    const unsubscribeMine = subscribeMyCampaigns(
      user.uid,
      (rows) => {
        if (mounted) {
          setCampaigns(rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)));
        }
      },
      () => {}
    );
    return () => {
      mounted = false;
      unsubscribeMine();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setCampaignsTrial(null);
      return;
    }
    let cancelled = false;
    readActiveTrial(user.uid, [...CAMPAIGNS_PRODUCT_IDS]).then((record) => {
      if (!cancelled) setCampaignsTrial(record);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.uid, hasPlan]);

  useEffect(() => {
    if (!admin) return;
    const unsubscribePending = subscribePendingCampaigns(
      (rows) => setPending(rows),
      () => {}
    );
    return () => unsubscribePending();
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
    return () => {
      cancelled = true;
    };
  }, [connected, fetchProducts, hasPlan, loadingAccount, reconnect, user?.uid]);

  const productForPlan = useCallback(
    (plan: CampaignsPlan) => subscriptions.find((product) => product.id === plan.productId),
    [subscriptions]
  );

  /** The offer to actually buy — prefers the free-trial offer over the bare base plan. */
  const offerForPlan = useCallback(
    (plan: CampaignsPlan) => pickSubscriptionOffer(productForPlan(plan)),
    [productForPlan]
  );

  /** Real trial length + post-trial price straight from Play's pricing phases. */
  const trialForPlan = useCallback(
    (plan: CampaignsPlan) => describeSubscriptionOffer(offerForPlan(plan), plan.price, TRIAL_DAYS),
    [offerForPlan]
  );

  const selectedCampaignsPlan =
    CAMPAIGNS_PLANS.find((plan) => plan.id === selectedPlan) || CAMPAIGNS_PLANS[0];

  const handleStartCampaigns = async () => {
    if (!user?.uid) {
      Alert.alert('Sign in required', 'Sign in first, then start LinkUp Campaigns.');
      return;
    }
    const plan = CAMPAIGNS_PLANS.find((item) => item.id === selectedPlan) || CAMPAIGNS_PLANS[0];

    // WEB BILLING: Paynow, at the same price as Google Play (shared/pricing.js).
    // Play policy: guarded by Platform.OS, never shown inside the Android app.
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

    // Buy the TRIAL offer, not the bare base plan — same subscription, $0 for 7 days.
    const offerToken = offerTokenFor(offerForPlan(plan));
    if (Platform.OS === 'android' && !offerToken) {
      Alert.alert(
        'Google Play product missing',
        storeError || 'Campaigns is not ready in Google Play yet. Check linkup_campaigns_monthly / linkup_campaigns_yearly base plans in Play Console.'
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
        // The entitlement already streams from webSubscriptions/{uid}; all a
        // restore can do is force the server to reconcile a missed webhook.
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
    const note =
      rejectReason.trim() ||
      'Does not meet LinkUp campaign guidelines. Update the creative and resubmit.';
    setRejectBusy(true);
    await moderate(rejectTarget, 'rejected', note);
    setRejectBusy(false);
    setRejectTarget(null);
    setRejectReason('');
  };

  const placementsLabel = (campaign: Campaign) =>
    (campaign.placements || [])
      .map((id) => CAMPAIGN_PLACEMENT_OPTIONS.find((option) => option.id === id)?.label || id)
      .join(' · ');

  // ------------------------------------------------------------
  // Stat tile — the league's score column, reused three ways
  // ------------------------------------------------------------
  // ------------------------------------------------------------
  // Launch Console hero
  //
  // The dashboard used to be one more white card with three small tiles on
  // it, indistinguishable from every other screen. This inverts the block
  // instead: solid ink on paper in light mode, paper on ink in dark. It is
  // the one place on the page that is not a card, which is what makes the
  // page feel designed rather than stacked.
  // ------------------------------------------------------------
  const heroBg = isDark ? '#FFFFFF' : COLORS.inkButton;
  const heroInk = isDark ? '#0A0B0D' : '#FFFFFF';
  const heroMuted = isDark ? 'rgba(10, 11, 13, 0.55)' : 'rgba(255, 255, 255, 0.62)';
  const heroRule = isDark ? 'rgba(10, 11, 13, 0.12)' : 'rgba(255, 255, 255, 0.16)';
  const heroSoft = isDark ? 'rgba(10, 11, 13, 0.08)' : 'rgba(255, 255, 255, 0.14)';
  const capacityPct = Math.round((Math.min(liveCount, MAX_ACTIVE_CAMPAIGNS) / MAX_ACTIVE_CAMPAIGNS) * 100);

  // Share of voice: each campaign's slice of the advertiser's own reach.
  // Ranked, top five, and drawn from real per-campaign counters — no
  // invented timeseries.
  const shareOfVoice = [...campaigns]
    .map((campaign) => ({
      id: campaign.id,
      name: campaign.creative?.productName || campaign.creative?.title || campaign.name || 'Untitled',
      views: campaign.statsImpressions || 0,
    }))
    .filter((entry) => entry.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);
  const shareLead = shareOfVoice[0]?.views || 1;

  const HeroStat = ({ value, label }: { value: string; label: string }) => (
    <View style={styles.heroStatItem}>
      <Text style={[styles.heroStatValue, { color: heroInk }]}>{value}</Text>
      <Text style={[styles.heroStatLabel, { color: heroMuted }]}>{label}</Text>
    </View>
  );

  // ------------------------------------------------------------
  // Campaign row — league row language: tile, name, meta, score
  // ------------------------------------------------------------
  const renderCampaignRow = (campaign: Campaign) => {
    const meta = campaignStatusMeta(campaign.status);
    const editable = campaign.status === 'pending_review';
    const logo = campaign.creative?.logoUrl || '';
    const ctr = ctrFor(campaign.statsImpressions || 0, campaign.statsClicks || 0);

    // Pause/resume straight from the console — no detour into a detail screen.
    const togglePause = () => {
      const nextStatus = campaign.status === 'active' ? 'paused' : 'active';
      void setCampaignStatus(campaign.id, nextStatus as any).catch(() =>
        notifyUser('Could not update', 'We could not change this campaign. Try again in a moment.')
      );
    };

    return (
      <TouchableOpacity
        key={campaign.id}
        activeOpacity={0.86}
        onPress={() => navigation.navigate('CampaignDetail', { campaignId: campaign.id })}
        style={[styles.row, liquidGlass(isDark, false)]}
      >
        <View style={[styles.rowAccent, { backgroundColor: meta.color }]} />
        <View style={styles.rowTile}>
          {logo ? (
            <Image source={{ uri: ikAvatar(logo) }} style={styles.rowLogo} resizeMode="cover" />
          ) : (
            <Package size={17} color={COLORS.primaryStrong} />
          )}
        </View>

        <View style={styles.rowBody}>
          <Text style={[styles.rowName, { color: textColor(isDark) }]} numberOfLines={1}>
            {campaign.creative?.productName || campaign.creative?.title || campaign.name}
          </Text>
          <Text style={[styles.rowMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
            {placementsLabel(campaign) || 'Idea Deck'}
          </Text>
          <View style={styles.rowStatusRow}>
            <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
              <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
            </View>
          </View>
        </View>

        <View style={styles.rowStats}>
          <Text style={[styles.rowScore, { color: COLORS.primaryStrong }]}>{ctr}</Text>
          <Text style={[styles.rowScoreLabel, { color: textColor(isDark, 'muted') }]}>CTR</Text>
          <Text style={[styles.rowSub, { color: textColor(isDark, 'muted') }]}>
            {compactNumber(campaign.statsImpressions || 0)} views
          </Text>
        </View>

        {(campaign.status === 'active' || campaign.status === 'paused') && (
          <TouchableOpacity
            onPress={togglePause}
            style={styles.editBtn}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {campaign.status === 'active' ? (
              <Pause size={13} color={textColor(isDark, 'secondary')} />
            ) : (
              <Play size={13} color={textColor(isDark, 'secondary')} />
            )}
          </TouchableOpacity>
        )}
        {editable && (
          <TouchableOpacity
            onPress={() => navigation.navigate('CreateCampaign', { editCampaign: campaign })}
            style={styles.editBtn}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Pencil size={13} color={textColor(isDark, 'secondary')} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  // ------------------------------------------------------------
  // Dashboard (plan active)
  // ------------------------------------------------------------
  const renderDashboard = () => (
    <View>
      <View style={[styles.hero, { backgroundColor: heroBg }]}>
        <View style={styles.heroTop}>
          <View style={[styles.heroPill, { backgroundColor: heroSoft }]}>
            <View style={[styles.heroPulse, { backgroundColor: heroInk }]} />
            <Text style={[styles.heroPillText, { color: heroInk }]}>{trialLabel || 'CAMPAIGNS LIVE'}</Text>
          </View>
          <Text style={[styles.heroSlot, { color: heroMuted }]}>
            {liveCount}/{MAX_ACTIVE_CAMPAIGNS} SLOTS
          </Text>
        </View>

        <Text style={[styles.heroReach, { color: heroInk }]}>{compactNumber(totalImpressions)}</Text>
        <Text style={[styles.heroReachLabel, { color: heroMuted }]}>total views across your campaigns</Text>

        <View style={styles.heroMeterRow}>
          <View style={[styles.heroMeterTrack, { backgroundColor: heroRule }]}>
            <View style={[styles.heroMeterFill, { backgroundColor: heroInk, width: `${capacityPct}%` }]} />
          </View>
        </View>
        <Text style={[styles.heroMeterText, { color: heroMuted }]}>{capacityPct}% of your slots in use</Text>

        <View style={[styles.heroDivider, { backgroundColor: heroRule }]} />

        <View style={styles.heroStats}>
          <HeroStat value={compactNumber(totalClicks)} label="Clicks" />
          <HeroStat value={totalCtr} label="CTR" />
          <HeroStat value={String(liveCount)} label="Live" />
        </View>
      </View>

      {shareOfVoice.length > 0 && (
        <View>
          <Text style={[styles.sectionLabel, { color: textColor(isDark, 'muted') }]}>SHARE OF VOICE</Text>
          <View style={[styles.shareCard, liquidGlass(isDark, false)]}>
            {shareOfVoice.map((entry) => (
              <View key={entry.id} style={styles.shareRow}>
                <Text style={[styles.shareName, { color: textColor(isDark) }]} numberOfLines={1}>
                  {entry.name}
                </Text>
                <View style={styles.shareBarRow}>
                  <View style={[styles.shareTrack, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBg }]}>
                    <View
                      style={[
                        styles.shareFill,
                        {
                          backgroundColor: COLORS.primaryStrong,
                          width: `${Math.max(4, Math.round((entry.views / shareLead) * 100))}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.shareValue, { color: textColor(isDark, 'muted') }]}>
                    {compactNumber(entry.views)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.primaryBtn,
          { backgroundColor: COLORS.inkButton },
          liveCount >= MAX_ACTIVE_CAMPAIGNS && styles.primaryBtnDisabled,
        ]}
        activeOpacity={0.86}
        disabled={liveCount >= MAX_ACTIVE_CAMPAIGNS}
        onPress={() => navigation.navigate('CreateCampaign')}
      >
        <Plus size={16} color={COLORS.inkButtonText} />
        <Text style={[styles.primaryBtnText, { color: COLORS.inkButtonText }]}>NEW CAMPAIGN</Text>
      </TouchableOpacity>
      {liveCount >= MAX_ACTIVE_CAMPAIGNS && (
        <Text style={[styles.capHint, { color: textColor(isDark, 'muted') }]}>
          All {MAX_ACTIVE_CAMPAIGNS} slots in use — end or pause one to free a slot.
        </Text>
      )}

      <Text style={[styles.sectionLabel, { color: textColor(isDark, 'muted') }]}>MY CAMPAIGNS</Text>
      {campaigns.length === 0 ? (
        <View style={[styles.emptyCard, liquidGlass(isDark, false)]}>
          <View style={styles.emptyIconWrap}>
            <Megaphone size={22} color={COLORS.primaryStrong} />
          </View>
          <Text style={[styles.emptyTitle, { color: textColor(isDark) }]}>No campaigns yet</Text>
          <Text style={[styles.emptyCopy, { color: textColor(isDark, 'muted') }]}>
            Put your product in the deck where founders decide what to build next.
          </Text>
        </View>
      ) : (
        campaigns.map(renderCampaignRow)
      )}
    </View>
  );

  // ------------------------------------------------------------
  // Paywall (no plan yet)
  // ------------------------------------------------------------
  const renderPaywall = () => (
    <View>
      <View style={[styles.leagueCard, liquidGlass(isDark, false)]}>
        <View style={styles.leagueTopRow}>
          <View style={styles.leagueIconWrap}>
            <Megaphone size={20} color={COLORS.lightTextPrimary} />
          </View>
          <View style={styles.paywallRibbon}>
            <Text style={styles.paywallRibbonText}>{`${trialForPlan(selectedCampaignsPlan).trialDays} DAYS FREE`}</Text>
          </View>
        </View>

        <Text style={[styles.leagueTitle, { color: textColor(isDark) }]}>
          Put your product in front of every founder
        </Text>
        <Text style={[styles.leagueCopy, { color: textColor(isDark, 'muted') }]}>
          Sponsored cards with your logo and your website as the call-to-action — placed natively across the Idea
          Deck, Discover, Search, the Hub and Linky's picks. No banner blindness.
        </Text>

        <View style={styles.pricingGrid}>
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
                style={[
                  styles.priceCard,
                  liquidGlass(isDark, false),
                  selected && styles.priceCardSelected,
                ]}
              >
                <View style={styles.priceTopRow}>
                  <Text style={[styles.priceLabel, { color: textColor(isDark, 'muted') }]}>{plan.label}</Text>
                  {selected ? (
                    <View style={styles.priceSelectedDot}>
                      <Check size={11} color="#000" />
                    </View>
                  ) : (
                    <Text style={[styles.priceBadge, { color: COLORS.primaryStrong }]}>{plan.badge}</Text>
                  )}
                </View>
                <View style={styles.priceRow}>
                  <Text style={[styles.priceValue, { color: textColor(isDark) }]}>{storePrice}</Text>
                  <Text style={[styles.priceCadence, { color: textColor(isDark, 'muted') }]}>{plan.cadence}</Text>
                </View>
                <Text style={[styles.priceHelper, { color: textColor(isDark, 'muted') }]} numberOfLines={2}>
                  {trial.hasTrial ? trialThenPrice(trial, plan.cadence) : plan.helper}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <Text style={[styles.sectionLabel, { color: textColor(isDark, 'muted') }]}>EVERYTHING INCLUDED</Text>
      <View style={[styles.perksCard, liquidGlass(isDark, false)]}>
        {CAMPAIGNS_PERKS.map((perk) => (
          <View key={perk} style={styles.perkRow}>
            <CheckCircle2 size={15} color={COLORS.primaryStrong} />
            <Text style={[styles.perkText, { color: textColor(isDark, 'secondary') }]}>{perk}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: COLORS.primary }]}
        activeOpacity={0.86}
        onPress={handleStartCampaigns}
        disabled={purchaseBusy}
      >
        {purchaseBusy ? (
          <ActivityIndicator color={COLORS.lightTextPrimary} />
        ) : (
          <Text style={[styles.primaryBtnText, { color: COLORS.lightTextPrimary }]}>
            {`START ${trialForPlan(selectedCampaignsPlan).trialDays}-DAY FREE TRIAL`}
          </Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={handleRestore} style={styles.restoreBtn} activeOpacity={0.8} disabled={purchaseBusy}>
        <Lock size={12} color={textColor(isDark, 'muted')} />
        <Text style={[styles.restoreText, { color: textColor(isDark, 'muted') }]}>Restore purchases</Text>
      </TouchableOpacity>
    </View>
  );

  // ------------------------------------------------------------
  // Admin review queue (only for admins)
  // ------------------------------------------------------------
  const renderAdmin = () => {
    if (!admin) return null;
    return (
      <View style={styles.adminWrap}>
        <View style={styles.adminHeaderRow}>
          <View style={styles.adminDot} />
          <Text style={[styles.sectionLabel, { color: textColor(isDark, 'muted'), marginTop: 0, marginBottom: 0 }]}>
            REVIEW QUEUE{pending.length > 0 ? ` · ${pending.length}` : ''}
          </Text>
        </View>
        {pending.length === 0 ? (
          <Text style={[styles.adminEmpty, { color: textColor(isDark, 'muted') }]}>Queue is clear ✔</Text>
        ) : (
          pending.map((campaign) => (
            <View key={campaign.id} style={[styles.row, styles.adminRow, liquidGlass(isDark, false)]}>
              <View style={styles.rowTile}>
                {campaign.creative?.logoUrl ? (
                  <Image source={{ uri: ikAvatar(campaign.creative.logoUrl) }} style={styles.rowLogo} resizeMode="cover" />
                ) : (
                  <Package size={17} color={COLORS.primaryStrong} />
                )}
              </View>
              <View style={styles.rowBody}>
                <Text style={[styles.rowName, { color: textColor(isDark) }]} numberOfLines={1}>
                  {campaign.creative?.productName || campaign.creative?.title || campaign.name}
                </Text>
                <Text style={[styles.rowMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
                  {campaign.creative?.tagline || campaign.creative?.description}
                </Text>
                <Text style={[styles.rowMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
                  by {campaign.ownerName} · {placementsLabel(campaign)}
                </Text>
              </View>
              <View style={styles.adminActions}>
                <TouchableOpacity
                  onPress={() => moderate(campaign, 'active')}
                  disabled={moderationBusy === campaign.id}
                  style={[styles.adminBtn, { backgroundColor: 'rgba(22,163,74,0.14)' }]}
                >
                  {moderationBusy === campaign.id ? <ActivityIndicator size="small" color="#16A34A" /> : <ThumbsUp size={15} color="#16A34A" />}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setRejectTarget(campaign);
                    setRejectReason('');
                  }}
                  disabled={moderationBusy === campaign.id}
                  style={[styles.adminBtn, { backgroundColor: 'rgba(220,38,38,0.12)' }]}
                >
                  <ThumbsDown size={15} color="#DC2626" />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <ScreenHeader
        title="Campaigns"
        subtitle={
          hasPlan
            ? `${liveCount} of ${MAX_ACTIVE_CAMPAIGNS} slots live · ${compactNumber(totalImpressions)} views`
            : 'Advertise your product to every founder on LinkUp'
        }
        onBack={() => navigation.goBack()}
        isDark={isDark}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {loadingAccount ? (
          <View style={styles.center}>
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
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard,
                borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: textColor(isDark) }]}>Reject this campaign?</Text>
            <Text style={[styles.modalSub, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>
              {rejectTarget?.creative?.productName || rejectTarget?.creative?.title || rejectTarget?.name || 'Untitled product'}
              {rejectTarget?.ownerName ? ` · ${rejectTarget.ownerName}` : ''}
            </Text>

            <TextInput
              value={rejectReason}
              onChangeText={(value) => setRejectReason(value.slice(0, 280))}
              placeholder="Why is it rejected? The advertiser sees this note…"
              placeholderTextColor={textColor(isDark, 'muted')}
              multiline
              maxLength={280}
              style={[
                styles.rejectInput,
                {
                  backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec,
                  borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
                  color: textColor(isDark),
                },
              ]}
            />
            <Text style={[styles.rejectHint, { color: textColor(isDark, 'muted') }]}>
              {rejectReason.length}/280 · Leave blank to use the standard guidelines message.
            </Text>

            <TouchableOpacity
              style={styles.rejectBtn}
              activeOpacity={0.86}
              onPress={submitRejection}
              disabled={rejectBusy}
            >
              {rejectBusy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.rejectBtnText}>REJECT CAMPAIGN</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setRejectTarget(null);
                setRejectReason('');
              }}
              style={styles.cancelBtn}
              activeOpacity={0.8}
            >
              <Text style={[styles.cancelBtnText, { color: textColor(isDark, 'secondary') }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { paddingVertical: 80, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingBottom: 48, gap: 10 },

  sectionLabel: {
    marginTop: 12,
    marginBottom: 4,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
  },

  // --- hero: the league card, reused by the dashboard and the paywall ---
  leagueCard: { borderRadius: 24, padding: 16 },
  leagueTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  leagueIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leagueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: COLORS.primaryGlow,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  leagueBadgeText: { color: COLORS.primaryStrong, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  paywallRibbon: { borderRadius: 999, backgroundColor: COLORS.primary, paddingHorizontal: 11, paddingVertical: 7 },
  paywallRibbonText: { color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  slotDots: { flexDirection: 'row', gap: 6 },
  slotDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: 'transparent',
  },
  slotDotFilled: { backgroundColor: COLORS.primary },
  leagueTitle: { marginTop: 14, fontSize: 21, lineHeight: 27, fontWeight: '900', letterSpacing: -0.3 },
  leagueCopy: { marginTop: 6, fontSize: 12, lineHeight: 18, fontWeight: '600' },

  // --- campaign rows ---
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 18,
    overflow: 'hidden',
  },
  rowAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  rowTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rowLogo: { width: '100%', height: '100%' },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: '800', letterSpacing: -0.1 },
  rowMeta: { marginTop: 2, fontSize: 11, fontWeight: '600' },
  rowStatusRow: { marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  rowStats: { alignItems: 'flex-end', minWidth: 58 },
  rowScore: { fontSize: 16, fontWeight: '900' },
  rowScoreLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  rowSub: { marginTop: 3, fontSize: 9, fontWeight: '700' },
  editBtn: { padding: 4 },

  // --- empty state ---
  hero: { borderRadius: 26, padding: 20 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  heroPulse: { width: 6, height: 6, borderRadius: 3 },
  heroPillText: { fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  heroSlot: { fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  heroReach: { marginTop: 18, fontSize: 46, lineHeight: 50, fontWeight: '900', letterSpacing: -1.6 },
  heroReachLabel: { marginTop: 2, fontSize: 11, fontWeight: '700' },
  heroMeterRow: { marginTop: 16 },
  heroMeterTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  heroMeterFill: { height: 6, borderRadius: 3 },
  heroMeterText: { marginTop: 7, fontSize: 10, fontWeight: '800' },
  heroDivider: { height: 1, marginVertical: 16 },
  heroStats: { flexDirection: 'row', gap: 10 },
  heroStatItem: { flex: 1 },
  heroStatValue: { fontSize: 19, fontWeight: '900', letterSpacing: -0.4 },
  heroStatLabel: { marginTop: 1, fontSize: 9, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },

  shareCard: { borderRadius: 20, padding: 14, gap: 12 },
  shareRow: { gap: 6 },
  shareName: { fontSize: 11, fontWeight: '800' },
  shareBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shareTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  shareFill: { height: 8, borderRadius: 4 },
  shareValue: { minWidth: 34, textAlign: 'right', fontSize: 9, fontWeight: '800' },

  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },

  emptyCard: { borderRadius: 20, padding: 24, alignItems: 'center', gap: 6 },
  emptyIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: COLORS.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 16, fontWeight: '900' },
  emptyCopy: { fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 18 },

  // --- paywall ---
  pricingGrid: { flexDirection: 'row', gap: 8, marginTop: 16 },
  priceCard: { flex: 1, borderRadius: 16, padding: 12, gap: 6, borderWidth: 1, borderColor: 'transparent' },
  priceCardSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryGlow },
  priceTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  priceLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  priceSelectedDot: {
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceBadge: { fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end' },
  priceValue: { fontSize: 21, lineHeight: 25, fontWeight: '900', letterSpacing: -0.5 },
  priceCadence: { fontSize: 10, fontWeight: '800', marginLeft: 3, marginBottom: 3 },
  priceHelper: { fontSize: 9, lineHeight: 13, fontWeight: '700' },

  perksCard: { borderRadius: 20, padding: 14, gap: 10 },
  perkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  perkText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '600' },

  // --- buttons ---
  primaryBtn: {
    marginTop: 14,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  capHint: { marginTop: 8, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  restoreBtn: { marginTop: 10, height: 38, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  restoreText: { fontSize: 10, fontWeight: '900' },

  // --- admin ---
  adminWrap: { marginTop: 18, paddingBottom: 12 },
  adminHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  adminDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#DC2626' },
  adminEmpty: { fontSize: 11, fontWeight: '700' },
  adminRow: { marginBottom: 8 },
  adminActions: { flexDirection: 'row', gap: 7 },
  adminBtn: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  // --- reject modal ---
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
  rejectBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  cancelBtn: { marginTop: 12, height: 40, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 12, fontWeight: '900' },
});
