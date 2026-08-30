import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { finishTransaction, getAvailablePurchases, type Purchase, useIAP } from 'expo-iap';
import { serverTimestamp } from 'firebase/firestore';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Lock,
  Megaphone,
  MousePointerClick,
  Package,
  Pencil,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
} from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { notifyUser } from '../lib/notify';
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

const CAMPAIGNS_PERKS = [
  'Showcase your product on Idea Deck, Discover, Search, Hub & Linky picks',
  '3 active campaigns at once — swap creatives anytime',
  'Sponsored cards with your website as the call-to-action',
  'Live impressions, clicks & CTR on every campaign',
  'Reach verified founders, builders & early adopters only',
  'Edit creatives while in review, pause or resume in one tap',
  'Priority human review — live within 24 hours',
];

const CAMPAIGNS_PLANS = [
  {
    id: 'monthly',
    productId: LINKUP_CAMPAIGNS_PRODUCT_ID,
    label: 'Monthly',
    price: LINKUP_CAMPAIGNS_MONTHLY_PRICE,
    cadence: '/mo',
    helper: '7-day free trial, then monthly',
    badge: 'FREE TRIAL',
  },
  {
    id: 'yearly',
    productId: LINKUP_CAMPAIGNS_YEARLY_PRODUCT_ID,
    label: 'Yearly',
    price: LINKUP_CAMPAIGNS_YEARLY_PRICE,
    cadence: '/yr',
    helper: 'Two months free for committed builders',
    badge: 'SAVE 30%',
  },
] as const;

type CampaignsPlan = (typeof CAMPAIGNS_PLANS)[number];

const DARK_CARD = '#101116';
const DARK_LINE = 'rgba(255,255,255,0.08)';
const DARK_TEXT = '#F4F4F6';
const DARK_SUB = '#9C9CA6';

const isCampaignsPurchase = (purchase: Purchase) => {
  const productIds = purchase.ids?.length ? purchase.ids : [purchase.productId];
  return productIds.some((productId) => CAMPAIGNS_PRODUCT_IDS.includes(productId as any));
};

const getPurchaseProductId = (purchase: Purchase) => {
  const productIds = purchase.ids?.length ? purchase.ids : [purchase.productId];
  return productIds.find((productId) => CAMPAIGNS_PRODUCT_IDS.includes(productId as any)) || purchase.productId;
};

export default function CampaignsScreen({ navigation }: any) {
  const { user } = useAuth();
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
  const [selectedPlan, setSelectedPlan] = useState<CampaignsPlan['id']>('monthly');
  const processedPurchases = useRef(new Set<string>());

  const hasPlan = hasCampaignsPlan(account);
  const liveCount = countLiveCampaigns(campaigns);
  const totalImpressions = campaigns.reduce((sum, campaign) => sum + (campaign.statsImpressions || 0), 0);
  const totalClicks = campaigns.reduce((sum, campaign) => sum + (campaign.statsClicks || 0), 0);
  const totalCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(1) : '0.0';

  const unlockCampaignsPlan = useCallback(
    async (purchase: Purchase) => {
      if (!user?.uid) return;
      const patch = {
        plan: 'campaigns',
        status: 'active',
        planProductId: getPurchaseProductId(purchase),
        transactionId: purchase.transactionId || purchase.id || null,
        purchaseToken: purchase.purchaseToken || null,
        billingProvider: purchase.store || (Platform.OS === 'android' ? 'google-play' : 'app-store'),
        unlockedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await saveCampaignsAccount(user.uid, patch);
      setAccount((current) => ({ ...(current || {}), ...patch }));
    },
    [user?.uid]
  );

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

  const handleStartCampaigns = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Campaigns are free on web 🎉', 'Purchases only happen on the Android app.');
      return;
    }
    if (!user?.uid) {
      Alert.alert('Sign in required', 'Sign in first, then start LinkUp Campaigns.');
      return;
    }
    const plan = CAMPAIGNS_PLANS.find((item) => item.id === selectedPlan) || CAMPAIGNS_PLANS[0];
    const product = productForPlan(plan);
    const offerToken = product?.subscriptionOffers?.find((offer) => !!offer.offerTokenAndroid)?.offerTokenAndroid;
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
      Alert.alert('Nothing to restore', 'Purchases only exist on the mobile apps.');
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

  const moderate = async (campaign: Campaign, status: 'active' | 'rejected') => {
    if (moderationBusy) return;
    setModerationBusy(campaign.id);
    try {
      await setCampaignStatus(
        campaign.id,
        status,
        status === 'rejected' ? 'Does not meet LinkUp campaign guidelines. Update the creative and resubmit.' : ''
      );
    } catch (error: any) {
      notifyUser('Moderation failed', error?.message || 'Try again.');
    } finally {
      setModerationBusy('');
    }
  };

  const placementsLabel = (campaign: Campaign) =>
    (campaign.placements || [])
      .map((id) => CAMPAIGN_PLACEMENT_OPTIONS.find((option) => option.id === id)?.label || id)
      .join(' · ');

  // ------------------------------------------------------------
  // Paywall (no plan yet)
  // ------------------------------------------------------------
  const renderPaywall = () => (
    <View>
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroIconWrap}>
            <Megaphone size={26} color={COLORS.lightTextPrimary} />
          </View>
          <View style={styles.trialRibbon}>
            <Text style={styles.trialRibbonText}>7 DAYS FREE</Text>
          </View>
        </View>
        <Text style={styles.heroTitle}>Put your product in front of every founder</Text>
        <Text style={styles.heroCopy}>
          Sponsored cards with your website as the call-to-action — placed natively across the Idea Deck, Discover swipes, Search, the Hub and Linky's picks. No banner blindness, no ad soup.
        </Text>

        <View style={styles.pricingGrid}>
          {CAMPAIGNS_PLANS.map((plan) => {
            const selected = selectedPlan === plan.id;
            const product = productForPlan(plan);
            const storePrice = product?.subscriptionOffers?.find((offer) => !!offer.displayPrice)?.displayPrice || product?.displayPrice || plan.price;
            return (
              <TouchableOpacity
                key={plan.id}
                onPress={() => setSelectedPlan(plan.id)}
                activeOpacity={0.86}
                style={[styles.priceCard, selected && styles.priceCardSelected]}
              >
                <View style={styles.priceTopRow}>
                  <Text style={[styles.priceLabel, { color: selected ? DARK_TEXT : DARK_SUB }]}>{plan.label}</Text>
                  {selected ? (
                    <View style={styles.priceSelectedDot}>
                      <Check size={11} color="#000" />
                    </View>
                  ) : (
                    <Text style={styles.priceBadge}>{plan.badge}</Text>
                  )}
                </View>
                <View style={styles.priceRow}>
                  <Text style={styles.priceValue}>{storePrice}</Text>
                  <Text style={styles.priceCadence}>{plan.cadence}</Text>
                </View>
                <Text style={styles.priceHelper}>{plan.helper}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={[styles.perksSection, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
        <Text style={[styles.perksTitle, { color: textColor(isDark) }]}>Everything included</Text>
        {CAMPAIGNS_PERKS.map((perk) => (
          <View key={perk} style={styles.perkRow}>
            <CheckCircle2 size={16} color={COLORS.primaryStrong} />
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
          <Text style={[styles.primaryBtnText, { color: COLORS.lightTextPrimary }]}>START 7-DAY FREE TRIAL</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={handleRestore} style={styles.restoreBtn} activeOpacity={0.8} disabled={purchaseBusy}>
        <Lock size={12} color={textColor(isDark, 'muted')} />
        <Text style={[styles.restoreText, { color: textColor(isDark, 'muted') }]}>Restore purchases</Text>
      </TouchableOpacity>
    </View>
  );

  // ------------------------------------------------------------
  // Dashboard (plan active)
  // ------------------------------------------------------------
  const renderCampaignRow = (campaign: Campaign) => {
    const meta = campaignStatusMeta(campaign.status);
    const editable = campaign.status === 'pending_review';
    return (
      <TouchableOpacity
        key={campaign.id}
        activeOpacity={0.88}
        onPress={() => navigation.navigate('CampaignDetail', { campaignId: campaign.id })}
        style={[styles.campaignRow, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
      >
        <View style={[styles.campaignAccent, { backgroundColor: meta.color }]} />
        <View style={[styles.campaignIcon, { backgroundColor: isDark ? 'rgba(223,251,63,0.14)' : COLORS.primaryGlow }]}>
          <Package size={17} color={COLORS.primaryStrong} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.campaignName, { color: textColor(isDark) }]} numberOfLines={1}>
            {campaign.creative?.productName || campaign.creative?.title || 'Untitled product'}
          </Text>
          <Text style={[styles.campaignMeta, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>
            {placementsLabel(campaign) || 'Idea Deck'}
          </Text>
          <View style={styles.campaignStatRow}>
            <Text style={[styles.campaignStat, { color: textColor(isDark, 'muted') }]}>👁 {campaign.statsImpressions || 0}</Text>
            <Text style={[styles.campaignStat, { color: textColor(isDark, 'muted') }]}>👆 {campaign.statsClicks || 0}</Text>
            <Text style={[styles.campaignStat, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>
        {editable && (
          <TouchableOpacity
            onPress={() => navigation.navigate('CreateCampaign', { editCampaign: campaign })}
            style={[styles.editBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)' }]}
            activeOpacity={0.8}
          >
            <Pencil size={14} color={textColor(isDark, 'secondary')} />
          </TouchableOpacity>
        )}
        <ChevronRight size={16} color={textColor(isDark, 'muted')} />
      </TouchableOpacity>
    );
  };

  const renderDashboard = () => (
    <View>
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={styles.planBadge}>
            <ShieldCheck size={13} color={COLORS.primaryStrong} />
            <Text style={styles.planBadgeText}>CAMPAIGNS ACTIVE</Text>
          </View>
          <View style={styles.slotDots}>
            {Array.from({ length: MAX_ACTIVE_CAMPAIGNS }).map((_, index) => (
              <View key={index} style={[styles.slotDot, index < liveCount && styles.slotDotFilled]} />
            ))}
          </View>
        </View>
        <Text style={styles.heroTitle}>{liveCount === 0 ? 'Ready to get seen?' : `${liveCount} of ${MAX_ACTIVE_CAMPAIGNS} slots live`}</Text>
        <Text style={styles.heroCopy}>
          {liveCount === 0
            ? 'Your dashboards, stats and placements are armed. Launch your first sponsored card in 2 minutes.'
            : 'Your products are earning attention across LinkUp placements right now.'}
        </Text>
        <View style={styles.heroStatGrid}>
          {[
            { Icon: Eye, value: totalImpressions, label: 'Views' },
            { Icon: MousePointerClick, value: totalClicks, label: 'Clicks' },
            { Icon: TrendingUp, value: `${totalCtr}%`, label: 'CTR' },
          ].map(({ Icon, value, label }) => (
            <View key={label} style={styles.heroStat}>
              <Icon size={14} color={COLORS.primaryStrong} />
              <Text style={styles.heroStatValue}>{value}</Text>
              <Text style={styles.heroStatLabel}>{label}</Text>
            </View>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: COLORS.primary }, liveCount >= MAX_ACTIVE_CAMPAIGNS && styles.primaryBtnDisabled]}
        activeOpacity={0.86}
        disabled={liveCount >= MAX_ACTIVE_CAMPAIGNS}
        onPress={() => navigation.navigate('CreateCampaign')}
      >
        <Megaphone size={15} color={COLORS.lightTextPrimary} />
        <Text style={[styles.primaryBtnText, { color: COLORS.lightTextPrimary }]}>NEW CAMPAIGN</Text>
      </TouchableOpacity>
      {liveCount >= MAX_ACTIVE_CAMPAIGNS && (
        <Text style={[styles.capHint, { color: textColor(isDark, 'muted') }]}>
          All {MAX_ACTIVE_CAMPAIGNS} slots in use — end or pause one to free a slot.
        </Text>
      )}

      <Text style={[styles.sectionLabel, { color: textColor(isDark, 'muted') }]}>MY CAMPAIGNS</Text>
      {campaigns.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
          <View style={[styles.emptyIconWrap, { backgroundColor: isDark ? 'rgba(223,251,63,0.14)' : COLORS.primaryGlow }]}>
            <Megaphone size={24} color={COLORS.primaryStrong} />
          </View>
          <Text style={[styles.emptyTitle, { color: textColor(isDark) }]}>No campaigns yet</Text>
          <Text style={[styles.emptyCopy, { color: textColor(isDark, 'secondary') }]}>
            Put your product in the deck where founders decide what to build next.
          </Text>
        </View>
      ) : (
        campaigns.map(renderCampaignRow)
      )}
    </View>
  );

  // ------------------------------------------------------------
  // Admin review queue (only for uids in config/admins)
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
            <View
              key={campaign.id}
              style={[styles.adminCard, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.campaignName, { color: textColor(isDark) }]} numberOfLines={1}>
                  {campaign.creative?.productName || campaign.creative?.title || campaign.name}
                </Text>
                <Text style={[styles.campaignMeta, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>
                  {campaign.creative?.tagline || campaign.creative?.description}
                </Text>
                <Text style={[styles.campaignMeta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
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
                  onPress={() => moderate(campaign, 'rejected')}
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.headerBtn, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec }]}>
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>Campaigns</Text>
          <Text style={styles.headerSub}>Advertise to every founder</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

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
  center: { paddingVertical: 80, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, paddingTop: 6, paddingBottom: 48 },

  heroCard: {
    backgroundColor: DARK_CARD,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: DARK_LINE,
    padding: 20,
    overflow: 'hidden',
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 19,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  trialRibbon: {
    borderRadius: 999,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  trialRibbonText: { color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  planBadge: {
    borderRadius: 999,
    backgroundColor: 'rgba(223,251,63,0.14)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  planBadgeText: { color: '#DFFB3F', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  slotDots: { flexDirection: 'row', gap: 6 },
  slotDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: 'rgba(223,251,63,0.45)',
    backgroundColor: 'transparent',
  },
  slotDotFilled: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  heroTitle: { marginTop: 16, fontSize: 24, lineHeight: 30, fontWeight: '900', color: DARK_TEXT },
  heroCopy: { marginTop: 8, fontSize: 12, lineHeight: 19, fontWeight: '700', color: DARK_SUB },
  heroStatGrid: { flexDirection: 'row', gap: 10, marginTop: 18 },
  heroStat: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: DARK_LINE,
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 12,
    gap: 5,
  },
  heroStatValue: { fontSize: 19, fontWeight: '900', color: DARK_TEXT },
  heroStatLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: DARK_SUB, textTransform: 'uppercase' },

  pricingGrid: { flexDirection: 'row', gap: 10, marginTop: 18 },
  priceCard: {
    flex: 1,
    minHeight: 106,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: DARK_LINE,
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 14,
    justifyContent: 'space-between',
  },
  priceCardSelected: { borderColor: COLORS.primary, backgroundColor: 'rgba(223,251,63,0.10)' },
  priceTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  priceLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  priceSelectedDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceBadge: {
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 8,
    fontWeight: '900',
    backgroundColor: 'rgba(223,251,63,0.16)',
    color: '#DFFB3F',
  },
  priceRow: { marginTop: 8, flexDirection: 'row', alignItems: 'flex-end' },
  priceValue: { fontSize: 22, lineHeight: 26, fontWeight: '900', letterSpacing: -0.5, color: DARK_TEXT },
  priceCadence: { fontSize: 10, fontWeight: '900', marginLeft: 4, marginBottom: 3, color: DARK_SUB },
  priceHelper: { marginTop: 6, fontSize: 9, lineHeight: 13, fontWeight: '800', color: DARK_SUB },

  perksSection: { borderWidth: 1, marginTop: 14, borderRadius: 28, padding: 18, gap: 11 },
  perksTitle: { fontSize: 15, fontWeight: '900' },
  perkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  perkText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '700' },

  primaryBtn: {
    marginTop: 16,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnText: { fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
  restoreBtn: { marginTop: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6 },
  restoreText: { fontSize: 11, fontWeight: '800' },
  capHint: { marginTop: 8, fontSize: 10, fontWeight: '800', textAlign: 'center' },

  sectionLabel: { marginTop: 22, marginBottom: 10, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  emptyCard: { borderWidth: 1, borderRadius: 28, padding: 28, alignItems: 'center', gap: 10 },
  emptyIconWrap: { width: 54, height: 54, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '900' },
  emptyCopy: { fontSize: 12, lineHeight: 18, fontWeight: '700', textAlign: 'center' },

  campaignRow: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 12,
    paddingLeft: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  campaignAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  campaignIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  campaignName: { fontSize: 14, fontWeight: '900' },
  campaignMeta: { marginTop: 2, fontSize: 10, fontWeight: '800' },
  campaignStatRow: { flexDirection: 'row', gap: 12, marginTop: 5 },
  campaignStat: { fontSize: 10, fontWeight: '900' },
  editBtn: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  adminWrap: { marginTop: 18, paddingBottom: 12 },
  adminHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  adminDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#DC2626' },
  adminEmpty: { fontSize: 11, fontWeight: '800' },
  adminCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  adminActions: { flexDirection: 'row', gap: 8 },
  adminBtn: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
