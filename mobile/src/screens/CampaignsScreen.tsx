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
  ChevronLeft,
  Eye,
  Flame,
  Layers,
  Lock,
  Megaphone,
  MousePointerClick,
  Package,
  Pause,
  Play,
  Pencil,
  Plus,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
} from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
import { ikAvatar } from '../lib/ikImage';
import ProCrownBadge from '../components/ProCrownBadge';
import { isAdminIdentity } from '../lib/admin';
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
  syncCampaignsAccountFromStore,
} from '../lib/campaigns';
import { startPayonifyCheckout, checkPayonifyPayment, takePendingReference } from '../lib/webCheckout';
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

// Builder League identity — same acid yellow, cream and heat orange the league
// screen uses. The rest of the app is white monochrome; this page is not.
const LEAGUE_YELLOW = '#FBE618';
const INK = '#111111';
const HEAT = '#FF4D2E';

const medal = (index: number) => {
  if (index === 0) return { bg: LEAGUE_YELLOW, fg: INK, label: '1ST' };
  if (index === 1) return { bg: '#D7DCE3', fg: INK, label: '2ND' };
  if (index === 2) return { bg: '#E08A3A', fg: INK, label: '3RD' };
  return { bg: 'rgba(251,230,24,0.14)', fg: LEAGUE_YELLOW, label: `#${index + 1}` };
};

const BAR_PALETTE = ['#16A34A', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899'];

export default function CampaignsScreen({ navigation }: any) {
  const { user, profile, webSubscription } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  // League surfaces: cream, not white. Cards are solid, not glass.
  const bg = isDark ? '#0B0B0B' : '#F6F4EA';
  const cardBg = isDark ? '#161616' : '#FFFFFF';
  const border = isDark ? '#2A2A2A' : '#EFEFEF';

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

  // Re-verify the Play subscription every time the screen opens.
  //
  // Google does not push lapses to this app, so without this a cancelled
  // subscriber's campaignAccounts doc read `active` forever and the sweep
  // kept extending their campaigns. Now the store is the authority: if Play
  // no longer lists a Campaigns purchase we stamp the account expired, and
  // the hourly sweep ends the ads on its next pass. Admins are exempt (they
  // hold no purchase), and a store error changes nothing - we only write
  // when Play answered.
  useEffect(() => {
    if (Platform.OS === 'web' || !user?.uid || !connected) return;
    if (isAdminIdentity({ email: user?.email, isAdmin: (profile as any)?.isAdmin })) return;
    let cancelled = false;
    (async () => {
      let purchases: Purchase[];
      try {
        purchases = await getAvailablePurchases();
      } catch {
        return; // store unreachable: leave the account exactly as it is
      }
      if (cancelled) return;
      const cp = purchases.find(isCampaignsPurchase);
      const current = await fetchCampaignsAccount(user.uid).catch(() => null);
      if (cancelled) return;
      const wasActive = String(current?.status || '').toLowerCase() === 'active';
      if (cp) {
        await syncCampaignsAccountFromStore(user.uid, true, {
          productId: getPurchaseProductId(cp),
          autoRenewing: (cp as any).autoRenewingAndroid ?? (cp as any).isAutoRenewing ?? null,
        }).catch(() => {});
      } else if (wasActive && current?.billingProvider !== 'web') {
        await syncCampaignsAccountFromStore(user.uid, false).catch(() => {});
        if (!cancelled) setAccount((prev) => ({ ...(prev || {}), status: 'expired' }));
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid, connected]);

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
    // Web buys through Payonify, not Google Play. expo-iap has no web
    // module, so reconnect()/fetchProducts() on web throw "Cannot find
    // native module 'ExpoIap'" and "Unsupported platform: web" straight into
    // the console every time this screen opens.
    if (Platform.OS === 'web') return;
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
  // Web sells prepaid terms through Payonify: no Play offer, no free trial.
  const trialForPlan = useCallback(
    (plan: CampaignsPlan) =>
      Platform.OS === 'web'
        ? { hasTrial: false, trialDays: 0, priceLabel: plan.price }
        : describeSubscriptionOffer(offerForPlan(plan), plan.price, TRIAL_DAYS),
    [offerForPlan]
  );

  const selectedCampaignsPlan = CAMPAIGNS_PLANS.find((plan) => plan.id === selectedPlan) || CAMPAIGNS_PLANS[0];

  const handleStartCampaigns = async () => {
    if (!user?.uid) { notifyUser('Sign in required', 'Sign in first.'); return; }
    const plan = CAMPAIGNS_PLANS.find((item) => item.id === selectedPlan) || CAMPAIGNS_PLANS[0];
    if (Platform.OS === 'web') {
      setPurchaseBusy(true); setStoreError('');
      try {
        const { checkoutUrl } = await startPayonifyCheckout(plan.webPlanKey);
        if (typeof window !== 'undefined') window.location.href = checkoutUrl;
        return;
      } catch (e: any) {
        setPurchaseBusy(false);
        const message = e?.message || 'Could not start checkout.';
        // Alert.alert is a no-op on react-native-web - show the reason inline too.
        setStoreError(message);
        notifyUser('Checkout failed', message);
      }
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
        const result = await checkPayonifyPayment(takePendingReference());
        const c = result?.entitlement?.campaigns;
        const active = c?.status === 'active' && Number(c?.endsAt || 0) > Date.now();
        notifyUser('Restore', active ? 'Campaigns is active on this account.' : result?.status === 'pending' ? 'Your latest payment is still being confirmed. Try again in a moment.' : 'No completed Campaigns payment found on this account.');
      } catch (e: any) { notifyUser('Restore failed', e?.message || 'Could not check payment.'); }
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
    try { await setCampaignStatus(campaign.id, status, note, { revalidateExpiry: status === 'active' }); }
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
      {/* The arena — the same acid-yellow hero block the Builder League opens with */}
      <View style={s.arena}>
        <View style={s.liveRow}>
          <View style={s.liveDot} />
          <Text style={s.liveText}>LIVE CAMPAIGNS</Text>
          <Megaphone size={12} color={INK} />
        </View>
        <Text style={s.arenaTitle}>Your product is in the deck</Text>
        <Text style={s.arenaSub}>
          Sponsored cards running across Idea Deck, Discover, Search, Hub and Linky picks.
        </Text>
        <View style={s.statRow}>
          <View style={s.statChip}>
            <Eye size={13} color={INK} />
            <Text style={s.statText}>{compactNumber(totalImpressions)} views</Text>
          </View>
          <View style={s.statChip}>
            <MousePointerClick size={13} color={INK} />
            <Text style={s.statText}>{compactNumber(totalClicks)} clicks</Text>
          </View>
        </View>
        <View style={[s.statRow, { marginTop: 8 }]}>
          <View style={s.statChip}>
            <TrendingUp size={13} color={INK} />
            <Text style={s.statText}>{totalCtr} ctr</Text>
          </View>
          <View style={s.statChip}>
            <Flame size={13} color={HEAT} />
            <Text style={s.statText}>{liveCount}/{MAX_ACTIVE_CAMPAIGNS} slots live</Text>
          </View>
        </View>
      </View>

      {/* Slot capacity — league heat-track styling */}
      <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
        <View style={s.cardTop}>
          <Text style={[s.cardTitle, { color: textColor(isDark) }]}>Slot capacity</Text>
          <Text style={[s.cardValue, { color: textColor(isDark) }]}>{capacityPct}%</Text>
        </View>
        <View style={[s.heatTrack, { backgroundColor: HEAT + '1F' }]}>
          <View style={[s.heatFill, { width: `${capacityPct}%` }]} />
        </View>
        <Text style={[s.cardHint, { color: textColor(isDark, 'muted') }]}>
          {liveCount} of {MAX_ACTIVE_CAMPAIGNS} slots in use — pause one to free a slot.
        </Text>
      </View>

      {/* Share of voice — the league's ranked heat rows */}
      {shareOfVoice.length > 0 && (
        <View>
          <Text style={[s.sectionLabel, { color: textColor(isDark) }]}>SHARE OF VOICE</Text>
          {shareOfVoice.map((entry, index) => {
            const chip = medal(index);
            return (
              <TouchableOpacity
                key={entry.id}
                activeOpacity={0.88}
                onPress={() => navigation.navigate('CampaignDetail', { campaignId: entry.id })}
                style={[s.row, { backgroundColor: cardBg, borderColor: index === 0 ? LEAGUE_YELLOW : border }]}
              >
                <View style={[s.rankBox, { backgroundColor: chip.bg }]}>
                  <Text style={[s.rankText, { color: chip.fg }]}>{chip.label}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.name, { color: textColor(isDark) }]} numberOfLines={1}>{entry.name}</Text>
                  <Text style={s.meta} numberOfLines={1}>{compactNumber(entry.views)} impressions</Text>
                  <View style={[s.heatTrack, { marginTop: 8 }]}>
                    <View style={[s.heatFill, { width: `${Math.max(3, Math.round((entry.views / shareLead) * 100))}%` }]} />
                  </View>
                </View>
                <View style={s.heatCol}>
                  <Flame size={14} color={HEAT} />
                  <Text style={s.heatNum}>{compactNumber(entry.views)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <TouchableOpacity
        style={[s.ctaBtn, liveCount >= MAX_ACTIVE_CAMPAIGNS && s.ctaDisabled]}
        activeOpacity={0.86}
        disabled={liveCount >= MAX_ACTIVE_CAMPAIGNS}
        onPress={() => navigation.navigate('CreateCampaign')}
      >
        <Plus size={16} color={INK} />
        <Text style={s.ctaText}>New Campaign</Text>
      </TouchableOpacity>

      <Text style={[s.sectionLabel, { color: textColor(isDark), marginTop: 18 }]}>MY CAMPAIGNS</Text>

      {campaigns.length === 0 ? (
        <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
          <Megaphone size={22} color={LEAGUE_YELLOW} />
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
          const reachPct =
            totalImpressions > 0
              ? Math.max(2, Math.min(100, Math.round(((campaign.statsImpressions || 0) / totalImpressions) * 100)))
              : 0;

          const togglePause = () => {
            const next = campaign.status === 'active' ? 'paused' : 'active';
            void setCampaignStatus(campaign.id, next as any).catch(() =>
              notifyUser('Could not update', 'We could not change this campaign.')
            );
          };

          return (
            <TouchableOpacity
              key={campaign.id}
              activeOpacity={0.88}
              onPress={() => navigation.navigate('CampaignDetail', { campaignId: campaign.id })}
              style={[s.row, { backgroundColor: cardBg, borderColor: campaign.status === 'active' ? LEAGUE_YELLOW : border }]}
            >
              <View style={[s.rankBox, { backgroundColor: sc.bg }]}>
                <StatusIcon size={14} color={sc.fg} />
              </View>
              {logo ? (
                <Image source={{ uri: ikAvatar(logo) }} style={s.avatar} resizeMode="cover" />
              ) : (
                <View style={[s.avatar, s.avatarFallback]}>
                  <Package size={16} color={LEAGUE_YELLOW} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View style={s.nameRow}>
                  <Text style={[s.name, { color: textColor(isDark) }]} numberOfLines={1}>
                    {campaign.creative?.productName || campaign.creative?.title || campaign.name}
                  </Text>
                </View>
                <Text style={s.meta} numberOfLines={1}>
                  {`${meta.label} · ${placementsLabel(campaign) || 'Idea Deck'}`}
                </Text>
                <View style={s.heatTrack}>
                  <View style={[s.heatFill, { width: `${reachPct}%` }]} />
                </View>
              </View>
              <View style={s.statCol}>
                <Text style={[s.statVal, { color: textColor(isDark) }]}>{ctr}</Text>
                <Text style={s.statLbl}>CTR</Text>
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
      <View style={s.arena}>
        {/* No black pill and no sparkle here — just a microphone and the
            words, in ink so they read against the yellow arena. */}
        <View style={s.trialRow}>
          <Megaphone size={14} color={INK} strokeWidth={2.5} />
          <Text style={s.trialText}>
            {Platform.OS === 'web' ? 'PAY ONCE · NO AUTO-RENEWAL' : `${trialForPlan(selectedCampaignsPlan).trialDays} DAYS FREE`}
          </Text>
        </View>
        <Text style={s.arenaTitle}>Put your product in front of every founder</Text>
        <Text style={s.arenaSub}>
          Sponsored cards placed natively across Idea Deck, Discover, Search, Hub and Linky's picks.
        </Text>
        <View style={s.statRow}>
          <View style={s.statChip}>
            <Layers size={13} color={INK} />
            <Text style={s.statText}>3 placements</Text>
          </View>
          <View style={s.statChip}>
            <Eye size={13} color={INK} />
            <Text style={s.statText}>Priority review</Text>
          </View>
        </View>
        <View style={[s.statRow, { marginTop: 8 }]}>
          <View style={s.statChip}>
            <BarChart3 size={13} color={INK} />
            <Text style={s.statText}>Live CTR stats</Text>
          </View>
          <View style={s.statChip}>
            <Pause size={13} color={INK} />
            <Text style={s.statText}>Pause anytime</Text>
          </View>
        </View>
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
              style={[s.planCard, { backgroundColor: cardBg, borderColor: selected ? LEAGUE_YELLOW : border }]}
            >
              <View style={s.planTop}>
                <Text style={[s.planLabel, { color: textColor(isDark, 'muted') }]}>{plan.label}</Text>
                {selected ? (
                  <View style={s.planCheck}><Check size={11} color={INK} /></View>
                ) : (
                  <View style={s.planBadge}><Text style={s.planBadgeText}>{plan.badge}</Text></View>
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

      <View style={[s.perksCard, { backgroundColor: cardBg, borderColor: border }]}>
        <Text style={[s.perksTitle, { color: textColor(isDark) }]}>EVERYTHING INCLUDED</Text>
        {CAMPAIGNS_PERKS.map((perk) => (
          <View key={perk} style={s.perkRow}>
            <View style={s.perkDot}><Check size={10} color={INK} /></View>
            <Text style={[s.perkText, { color: textColor(isDark, 'secondary') }]}>{perk}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={s.ctaBtn}
        activeOpacity={0.86}
        onPress={handleStartCampaigns}
        disabled={purchaseBusy}
      >
        {purchaseBusy ? (
          <ActivityIndicator color={INK} />
        ) : (
          <Text style={s.ctaText}>
            {Platform.OS === 'web'
              ? `Start Campaigns — ${selectedCampaignsPlan.price}${selectedCampaignsPlan.cadence}`
              : `Start ${trialForPlan(selectedCampaignsPlan).trialDays}-Day Free Trial`}
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
        <Text style={[s.sectionLabel, { color: textColor(isDark), marginTop: 18 }]}>
          REVIEW QUEUE{pending.length > 0 ? ` · ${pending.length}` : ''}
        </Text>
        {pending.length === 0 ? (
          <Text style={[s.adminEmpty, { color: textColor(isDark, 'muted') }]}>Queue is clear</Text>
        ) : (
          pending.map((campaign) => (
            <View key={campaign.id} style={[s.row, { backgroundColor: cardBg, borderColor: border }]}>
              <View style={[s.rankBox, { backgroundColor: STATUS_MAP.pending_review.bg }]}>
                <Eye size={14} color={STATUS_MAP.pending_review.fg} />
              </View>
              {campaign.creative?.logoUrl ? (
                <Image source={{ uri: ikAvatar(campaign.creative.logoUrl) }} style={s.avatar} resizeMode="cover" />
              ) : (
                <View style={[s.avatar, s.avatarFallback]}>
                  <Package size={16} color={LEAGUE_YELLOW} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[s.name, { color: textColor(isDark) }]} numberOfLines={1}>
                  {campaign.creative?.productName || campaign.creative?.title || campaign.name}
                </Text>
                <Text style={s.meta} numberOfLines={1}>
                  {campaign.creative?.tagline || campaign.creative?.description}
                </Text>
                <Text style={s.meta} numberOfLines={1}>{`by ${campaign.ownerName}`}</Text>
              </View>
              <View style={s.adminActions}>
                <TouchableOpacity
                  onPress={() => moderate(campaign, 'active')}
                  disabled={moderationBusy === campaign.id}
                  style={[s.adminBtn, { backgroundColor: 'rgba(22,163,74,0.14)' }]}
                >
                  {moderationBusy === campaign.id
                    ? <ActivityIndicator size="small" color="#16A34A" />
                    : <ThumbsUp size={14} color="#16A34A" />}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setRejectTarget(campaign); setRejectReason(''); }}
                  disabled={moderationBusy === campaign.id}
                  style={[s.adminBtn, { backgroundColor: 'rgba(255,77,46,0.14)' }]}
                >
                  <ThumbsDown size={14} color={HEAT} />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={[s.container, { backgroundColor: bg }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backButton}>
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: textColor(isDark) }]}>CAMPAIGNS</Text>
        <ProCrownBadge />
        <View style={s.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {loadingAccount ? (
          <View style={s.center}>
            <ActivityIndicator color={LEAGUE_YELLOW} />
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
          <View style={[s.modalCard, { backgroundColor: cardBg, borderColor: border }]}>
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
                backgroundColor: isDark ? '#0B0B0B' : '#F6F4EA',
                borderColor: border,
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
  scroll: { paddingHorizontal: 16, paddingBottom: 60, gap: 10 },

  /* ── Header (Builder League) ───────────── */
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  headerSpacer: { width: 42, height: 42 },
  headerTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 2 },

  /* ── The arena (acid-yellow hero) ──────── */
  arena: {
    marginTop: 4,
    borderRadius: 22,
    backgroundColor: LEAGUE_YELLOW,
    padding: 18,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#111',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF3B30' },
  liveText: { color: '#FFF', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  arenaTitle: {
    marginTop: 14,
    fontSize: 26,
    fontWeight: '900',
    color: '#111',
    letterSpacing: -0.8,
    lineHeight: 30,
  },
  arenaSub: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '700',
    color: '#3A3A3A',
    lineHeight: 18,
  },
  // The paywall trial line. Deliberately not the black pill: ink on the
  // yellow arena is the highest-contrast pairing on this screen.
  trialRow: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start' },
  trialText: { fontSize: 12, fontWeight: '900', letterSpacing: 1.8, color: INK },
  statRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  statChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  statText: { fontSize: 11, fontWeight: '800', color: '#111' },

  /* ── Plain card ────────────────────────── */
  card: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 13, fontWeight: '900', letterSpacing: -0.2 },
  cardValue: { fontSize: 13, fontWeight: '900' },
  cardHint: { fontSize: 11, fontWeight: '700', lineHeight: 16 },

  /* ── Heat track (league bar) ───────────── */
  heatTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,77,46,0.12)',
    overflow: 'hidden',
  },
  heatFill: { height: '100%', backgroundColor: HEAT, borderRadius: 999 },
  heatCol: { alignItems: 'center', width: 40 },
  heatNum: { marginTop: 2, fontSize: 12, fontWeight: '900', color: HEAT },

  /* ── Section labels ────────────────────── */
  sectionLabel: { marginTop: 12, marginBottom: 8, fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },

  /* ── Ranked rows ───────────────────────── */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  rankBox: {
    minWidth: 46,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  rankText: { fontSize: 11, fontWeight: '900' },
  avatar: { width: 48, height: 48, borderRadius: 16, borderWidth: 2, borderColor: LEAGUE_YELLOW },
  avatarFallback: {
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 14, fontWeight: '900', flexShrink: 1 },
  meta: { marginTop: 2, fontSize: 11, fontWeight: '700', color: '#777' },
  statCol: { alignItems: 'center', width: 52 },
  statVal: { fontSize: 13, fontWeight: '900' },
  statLbl: { marginTop: 1, fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  campActions: { flexDirection: 'row', gap: 4, marginTop: 8 },
  campActionBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Empty ─────────────────────────────── */
  emptyCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  emptyTitle: { fontSize: 14, fontWeight: '900' },
  emptySub: { fontSize: 12, fontWeight: '700', textAlign: 'center', lineHeight: 18 },

  /* ── Plans ─────────────────────────────── */
  planRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  planCard: { flex: 1, borderRadius: 18, borderWidth: 2, padding: 12, gap: 6 },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  planCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: LEAGUE_YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planBadge: {
    backgroundColor: 'rgba(251,230,24,0.18)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  planBadgeText: { fontSize: 8, fontWeight: '900', color: LEAGUE_YELLOW, letterSpacing: 0.4 },
  planPriceRow: { flexDirection: 'row', alignItems: 'flex-end' },
  planPrice: { fontSize: 22, lineHeight: 26, fontWeight: '900', letterSpacing: -0.6 },
  planCadence: { fontSize: 10, fontWeight: '800', marginLeft: 2, marginBottom: 3 },
  planHelper: { fontSize: 9, lineHeight: 13, fontWeight: '700' },

  /* ── Perks ─────────────────────────────── */
  perksCard: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 10, marginTop: 4 },
  perksTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6, marginBottom: 2 },
  perkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  perkDot: {
    width: 18,
    height: 18,
    borderRadius: 6,
    marginTop: 2,
    backgroundColor: LEAGUE_YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '600' },

  /* ── CTA ───────────────────────────────── */
  ctaBtn: {
    marginTop: 14,
    height: 50,
    borderRadius: 16,
    backgroundColor: LEAGUE_YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { fontSize: 13, fontWeight: '900', color: INK },
  restoreBtn: { marginTop: 10, height: 36, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  restoreText: { fontSize: 10, fontWeight: '800' },

  /* ── Admin ─────────────────────────────── */
  adminEmpty: { fontSize: 11, fontWeight: '700', marginBottom: 10 },
  adminActions: { flexDirection: 'row', gap: 6 },
  adminBtn: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  /* ── Modal ─────────────────────────────── */
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 400, borderRadius: 22, borderWidth: 1, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
  modalSub: { marginTop: 4, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  rejectInput: {
    marginTop: 14,
    minHeight: 80,
    maxHeight: 140,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    textAlignVertical: 'top',
  },
  rejectHint: { marginTop: 6, fontSize: 10, fontWeight: '800' },
  rejectBtn: { marginTop: 14, height: 46, borderRadius: 14, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center' },
  rejectBtnText: { color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  cancelBtn: { marginTop: 10, height: 36, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 12, fontWeight: '800' },
});
