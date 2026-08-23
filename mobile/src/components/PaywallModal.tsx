import React from 'react';
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { finishTransaction, getAvailablePurchases, type Purchase, useIAP } from 'expo-iap';
import { CheckCircle2, Crown, Lock, X } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, liquidGlass, textColor } from '../theme/theme';
import { db } from '../lib/firebase';
import {
  LINKUP_PLUS_PRODUCT_ID,
  LINKUP_PLUS_MONTHLY_PRICE,
  LINKUP_PLUS_YEARLY_PRODUCT_ID,
  LINKUP_PLUS_YEARLY_PRICE,
  buildLocalProEntitlement,
  hasLinkupPro,
  saveLocalProEntitlement,
} from '../lib/paywall';
import { publicProfileLink } from '../lib/profileLinks';

type PaywallModalProps = {
  visible: boolean;
  feature?: string;
  description?: string;
  onClose: () => void;
  onUpgrade?: () => void;
  onUnlocked?: () => void;
  onRestore?: () => void;
  restoreDisabled?: boolean;
};

const LOGO = require('../../assets/logo-square.png');

const PRO_PERKS = [
  'AI-powered warm intros to start conversations',
  'Linky AI assistant for smart networking',
  'Verified blue check badge',
  'AI startup analyzer',
  'Priority AI matching',
  'Early access to new AI tools',
  'Exclusive founder community',
];

const PRICING_PLANS = [
  {
    id: 'monthly',
    productId: LINKUP_PLUS_PRODUCT_ID,
    label: 'Monthly',
    originalPrice: '$25.00',
    price: LINKUP_PLUS_MONTHLY_PRICE,
    cadence: '/mo',
    helper: 'Launch discount price',
    badge: 'DISCOUNT',
  },
  {
    id: 'yearly',
    productId: LINKUP_PLUS_YEARLY_PRODUCT_ID,
    label: 'Yearly',
    price: LINKUP_PLUS_YEARLY_PRICE,
    cadence: '/yr',
    helper: 'Best value for founders and teams',
    badge: 'SAVE $89.89',
  },
] as const;

type PlusPlan = (typeof PRICING_PLANS)[number];

const PLUS_PRODUCT_IDS = PRICING_PLANS.map((plan) => plan.productId);

const isPlusPurchase = (purchase: Purchase) => {
  const productIds = purchase.ids?.length ? purchase.ids : [purchase.productId];
  return productIds.some((productId) => PLUS_PRODUCT_IDS.includes(productId as any));
};

const getPurchaseProductId = (purchase: Purchase) => {
  const productIds = purchase.ids?.length ? purchase.ids : [purchase.productId];
  return productIds.find((productId) => PLUS_PRODUCT_IDS.includes(productId as any)) || purchase.productId;
};

export default function PaywallModal({
  visible,
  feature = 'PLUS feature',
  description,
  onClose,
  onUpgrade,
  onUnlocked,
  onRestore,
  restoreDisabled = false,
}: PaywallModalProps) {
  const { user, profile, updateLocalProfile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { height } = useWindowDimensions();
  const [isUnlocking, setIsUnlocking] = React.useState(false);
  const [isPurchasing, setIsPurchasing] = React.useState(false);
  const [isRestoring, setIsRestoring] = React.useState(false);
  const [storeError, setStoreError] = React.useState('');
  const processedPurchases = React.useRef(new Set<string>());
  const [selectedPlan, setSelectedPlan] = React.useState<PlusPlan['id']>('monthly');
  const isPro = hasLinkupPro(profile);
  const selectedPrice = PRICING_PLANS.find((plan) => plan.id === selectedPlan) || PRICING_PLANS[0];
  // No maxHeight needed — whole sheet scrolls
  const {
    connected,
    subscriptions,
    availablePurchases,
    fetchProducts,
    requestPurchase,
    restorePurchases,
    reconnect,
  } = useIAP({
    onPurchaseSuccess: (purchase) => {
      void handlePurchaseSuccess(purchase);
    },
    onPurchaseError: (error) => {
      setIsPurchasing(false);
      const code = String(error?.code || '').toLowerCase();
      if (code.includes('user') || code.includes('cancel')) return;
      Alert.alert('Purchase failed', error?.message || 'Google Play could not complete this LINKUP PLUS purchase.');
    },
    onError: (error) => {
      setStoreError(error?.message || 'Google Play billing is not ready yet.');
    },
  });

  const productForPlan = React.useCallback(
    (plan: PlusPlan) => subscriptions.find((product) => product.id === plan.productId),
    [subscriptions]
  );

  const getPlanPrice = React.useCallback(
    (plan: PlusPlan) => {
      const product = productForPlan(plan);
      const offerPrice = product?.subscriptionOffers?.find((offer) => !!offer.displayPrice)?.displayPrice;
      return offerPrice || product?.displayPrice || plan.price;
    },
    [productForPlan]
  );

  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const loadProducts = async () => {
      setStoreError('');
      try {
        if (!connected) {
          await reconnect();
        }
        if (!cancelled) {
          await fetchProducts({ skus: [...PLUS_PRODUCT_IDS], type: 'subs' });
        }
      } catch (error: any) {
        if (!cancelled) {
          setStoreError(error?.message || 'Could not load LINKUP PLUS from Google Play.');
        }
      }
    };
    void loadProducts();
    return () => {
      cancelled = true;
    };
  }, [connected, fetchProducts, reconnect, visible]);

  const finishUnlock = () => {
    if (onUnlocked) {
      onUnlocked();
      return;
    }
    onClose();
  };

  const unlockPurchasedPlan = async (purchase: Purchase) => {
    if (!user?.uid) {
      Alert.alert('Sign in required', 'Sign in first, then unlock LINKUP PLUS.');
      return;
    }

    const fallbackDisplayName = String(
      profile?.displayName || user.displayName || user.email?.split('@')[0] || 'LINKUP Member'
    ).trim();
    const displayName =
      fallbackDisplayName && !fallbackDisplayName.toLowerCase().startsWith('new ')
        ? fallbackDisplayName.slice(0, 100)
        : 'LINKUP Member';
    const unlockedAt = new Date().toISOString();
    const existingSettings =
      profile?.settings && typeof profile.settings === 'object'
        ? profile.settings
        : {};
    const proSettings = {
      publicDiscovery:
        typeof existingSettings.publicDiscovery === 'boolean'
          ? existingSettings.publicDiscovery
          : profile?.isVisible !== false,
      stealthMode:
        typeof existingSettings.stealthMode === 'boolean'
          ? existingSettings.stealthMode
          : !!profile?.isStealthMode,
      turboConnect: true,
      hideOnlineStatus:
        typeof existingSettings.hideOnlineStatus === 'boolean'
          ? existingSettings.hideOnlineStatus
          : !!profile?.hideOnlineStatus,
      darkMode: !!existingSettings.darkMode,
    };
    const localProPatch = {
      ...buildLocalProEntitlement(unlockedAt),
      billingProvider: purchase.store || (Platform.OS === 'android' ? 'google-play' : 'app-store'),
      subscriptionProductId: getPurchaseProductId(purchase),
      subscriptionTransactionId: purchase.transactionId || purchase.id || null,
      subscriptionPurchaseToken: purchase.purchaseToken || null,
      settings: proSettings,
    };

    setIsUnlocking(true);
    await saveLocalProEntitlement(user.uid, localProPatch).catch(() => {});
    updateLocalProfile(localProPatch);

    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          uid: user.uid,
          displayName,
          profileLink: publicProfileLink(user.uid),
          isPro: true,
          plan: 'plus',
          subscriptionPlan: 'plus',
          subscriptionStatus: 'active',
          subscriptionProductId: getPurchaseProductId(purchase),
          subscriptionTransactionId: purchase.transactionId || purchase.id || null,
          subscriptionPurchaseToken: purchase.purchaseToken || null,
          billingProvider: purchase.store || (Platform.OS === 'android' ? 'google-play' : 'app-store'),
          isVerified: true,
          verificationProgram: 'LINKUP PLUS',
          verifiedBy: 'LINKUP PLUS',
          verifiedAt: serverTimestamp(),
          turboConnect: true,
          settings: proSettings,
          proUnlockedAt: serverTimestamp(),
          subscriptionUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      Alert.alert('LINKUP PLUS UNLOCKED', 'All LINKUP PLUS perks are active now.');
      finishUnlock();
    } catch (error: any) {
      Alert.alert('LINKUP PLUS UNLOCKED', 'All PLUS perks are active on this device.');
      finishUnlock();
    } finally {
      setIsUnlocking(false);
      setIsPurchasing(false);
      setIsRestoring(false);
    }
  };

  async function handlePurchaseSuccess(purchase: Purchase) {
    if (!isPlusPurchase(purchase)) return;
    const purchaseKey = purchase.transactionId || purchase.purchaseToken || purchase.id;
    if (purchaseKey && processedPurchases.current.has(purchaseKey)) return;
    if (purchaseKey) processedPurchases.current.add(purchaseKey);

    if (purchase.purchaseState === 'pending') {
      setIsPurchasing(false);
      Alert.alert('Payment pending', 'Google Play is still processing this LINKUP PLUS purchase. You will be unlocked when it completes.');
      return;
    }

    if ((purchase as any).isSuspendedAndroid) {
      setIsPurchasing(false);
      Alert.alert('Billing needs attention', 'Open Google Play subscriptions and update your payment method to keep LINKUP PLUS active.');
      return;
    }

    try {
      await unlockPurchasedPlan(purchase);
      await finishTransaction({ purchase, isConsumable: false });
    } catch (error: any) {
      setIsPurchasing(false);
      setIsRestoring(false);
      Alert.alert('Purchase recorded', error?.message || 'Your purchase completed, but LINKUP could not finish activating PLUS.');
    }
  }

  React.useEffect(() => {
    if (!visible || !availablePurchases.length) return;
    const plusPurchase = availablePurchases.find(isPlusPurchase);
    if (plusPurchase) {
      void handlePurchaseSuccess(plusPurchase);
    }
  }, [availablePurchases, visible]);

  const handleUpgrade = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('LINKUP PLUS is free on web 🎉', 'Every feature is already unlocked on the web app — no purchase needed.');
      return;
    }

    if (isPro) {
      Alert.alert('LINKUP PLUS active', 'Your account already has LINKUP PLUS.');
      return;
    }

    if (!user?.uid) {
      Alert.alert('Sign in required', 'Sign in first, then unlock LINKUP PLUS.');
      return;
    }

    const plan = PRICING_PLANS.find((item) => item.id === selectedPlan) || PRICING_PLANS[0];
    const product = productForPlan(plan);
    const offerToken = product?.subscriptionOffers?.find((offer) => !!offer.offerTokenAndroid)?.offerTokenAndroid;

    if (Platform.OS === 'android' && !offerToken) {
      const message = storeError || 'LINKUP PLUS is not ready in Google Play yet. Check the subscription product IDs and base-plan offers in Play Console.';
      Alert.alert('Google Play product missing', message);
      return;
    }

    setIsPurchasing(true);
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
      if (onUpgrade) onUpgrade();
    } catch (error: any) {
      setIsPurchasing(false);
      Alert.alert('Purchase failed', error?.message || 'Google Play could not start checkout for LINKUP PLUS.');
    }
  };

  const handleRestore = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Nothing to restore', 'Purchases only exist on the mobile apps. LINKUP PLUS is free on web.');
      return;
    }
    if (restoreDisabled) return;
    if (onRestore) {
      onRestore();
      return;
    }
    setIsRestoring(true);
    setStoreError('');
    try {
      await restorePurchases();
      const purchases = await getAvailablePurchases();
      const plusPurchase = purchases.find(isPlusPurchase);
      if (plusPurchase) {
        await handlePurchaseSuccess(plusPurchase);
      } else {
        Alert.alert('Restore purchases', 'No active LINKUP PLUS purchase was found for this Google Play account.');
      }
    } catch (error: any) {
      Alert.alert('Restore failed', error?.message || 'Google Play could not restore purchases right now.');
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, liquidGlass(isDark), { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg, borderColor: isDark ? COLORS.darkBorderActive : COLORS.lightBorderActive }]}> 
        <ScrollView
          style={styles.scrollBody}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.hero, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard }]}> 
            <View style={styles.headerRow}>
              <View style={styles.brandRow}>
                <Image source={LOGO} style={[styles.logo, { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]} resizeMode="contain" />
                <View>
                  <Text style={[styles.brandName, { color: textColor(isDark) }]}>LINKUP</Text>
                  <Text style={[styles.brandPlan, { color: textColor(isDark, 'secondary') }]}>PLUS PLAN</Text>
                </View>
              </View>
              <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]} activeOpacity={0.8}>
                <X size={18} color={textColor(isDark)} />
              </TouchableOpacity>
            </View>

            <View style={[styles.popularBadge, { backgroundColor: isDark ? 'rgba(223, 251, 63, 0.14)' : COLORS.primaryGlow }]}> 
              <Crown size={13} color={COLORS.primaryStrong} />
              <Text style={[styles.popularText, { color: COLORS.lightTextPrimary }]}>FOR FOUNDERS, CREATORS & TEAMS</Text>
            </View>

            <Text style={[styles.title, { color: textColor(isDark) }]}>Build your startup faster</Text>
            <Text style={[styles.copy, { color: textColor(isDark, 'secondary') }]}>
              {description || 'Free members can explore a limited number of builders every 12 hours. LINKUP PLUS unlocks unlimited discovery, smarter AI recommendations, and premium tools to help you find the right co-founder, developer, designer, or investor faster.'}
            </Text>
            <View style={[styles.featurePill, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}> 
              <Text style={[styles.feature, { color: textColor(isDark) }]}>{feature}</Text>
            </View>

            <View style={styles.pricingGrid}>
              {PRICING_PLANS.map((plan) => {
                const selected = selectedPlan === plan.id;
                const storePrice = getPlanPrice(plan);
                return (
                  <TouchableOpacity
                    key={plan.id}
                    onPress={() => setSelectedPlan(plan.id)}
                    activeOpacity={0.86}
                    style={[
                      styles.priceCard,
                      selected && styles.priceCardSelected,
                      {
                        backgroundColor: selected ? (isDark ? 'rgba(223, 251, 63, 0.16)' : COLORS.primaryGlow) : isDark ? COLORS.darkCard : COLORS.lightCard,
                        borderColor: selected ? COLORS.primary : isDark ? COLORS.darkBorder : COLORS.lightBorder,
                      },
                    ]}
                  >
                    <View style={styles.priceTopRow}>
                      <Text style={[styles.priceLabel, selected && styles.priceLabelSelected, { color: selected ? (isDark ? COLORS.darkTextPrimary : COLORS.lightTextPrimary) : textColor(isDark, 'secondary') }]}>{plan.label}</Text>
                      {'badge' in plan && plan.badge ? (
                        <Text style={[styles.priceBadge, { backgroundColor: COLORS.primary, color: COLORS.lightTextPrimary }]}>{plan.badge}</Text>
                      ) : null}
                    </View>
                    <View style={styles.priceRow}>
                      {'originalPrice' in plan && plan.originalPrice ? (
                        <Text style={[styles.originalPrice, { color: textColor(isDark, 'muted') }]}>{plan.originalPrice}</Text>
                      ) : null}
                      <Text style={[styles.priceValue, selected && styles.priceValueSelected, { color: selected ? (isDark ? COLORS.darkTextPrimary : COLORS.lightTextPrimary) : textColor(isDark) }]}>{storePrice}</Text>
                      <Text style={[styles.priceCadence, selected && styles.priceCadenceSelected, { color: selected ? (isDark ? COLORS.darkTextPrimary : COLORS.lightTextPrimary) : textColor(isDark, 'secondary') }]}>{plan.cadence}</Text>
                    </View>
                    <Text style={[styles.priceHelper, selected && styles.priceHelperSelected, { color: selected ? (isDark ? COLORS.darkTextPrimary : COLORS.lightTextPrimary) : textColor(isDark, 'secondary') }]}>{plan.helper}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={[styles.perksSection, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
            <View style={styles.perksHeader}>
              <Text style={[styles.perksTitle, { color: textColor(isDark) }]}>Everything included in LINKUP PLUS</Text>
              <Text style={[styles.perksCount, { backgroundColor: COLORS.primary, color: COLORS.lightTextPrimary }]}>{PRO_PERKS.length} PLUS PERKS</Text>
            </View>
            {PRO_PERKS.map((perk) => (
              <View key={perk} style={styles.perkRow}>
                <CheckCircle2 size={18} color={COLORS.primaryStrong} />
                <Text style={[styles.perkText, { color: textColor(isDark, 'secondary') }]}>{perk}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.planBtn, { backgroundColor: COLORS.primary }]}
            activeOpacity={0.86}
            onPress={handleUpgrade}
            disabled={isPurchasing || isUnlocking}
          >
            <Text style={[styles.planText, { color: COLORS.lightTextPrimary }]}>
              {isPurchasing || isUnlocking
                ? 'OPENING GOOGLE PLAY...'
                : isPro
                  ? 'PLUS ACTIVE'
                  : 'Build Faster with PLUS'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleRestore}
            style={[styles.restoreBtn, { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }, (restoreDisabled || isRestoring) && styles.restoreBtnDisabled]}
            activeOpacity={0.8}
            disabled={restoreDisabled || isRestoring}
            accessibilityState={{ disabled: restoreDisabled || isRestoring }}
          >
            <Lock size={13} color={restoreDisabled || isRestoring ? COLORS.lightTextMuted : COLORS.secondary} />
            <Text style={[styles.restoreText, (restoreDisabled || isRestoring) && styles.restoreTextDisabled]}>
              {isRestoring ? 'RESTORING...' : 'RESTORE PURCHASES'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={[styles.laterBtn, { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]} activeOpacity={0.8}>
            <Text style={[styles.laterText, { color: textColor(isDark, 'secondary') }]}>NOT NOW</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  sheet: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 18,
    maxHeight: '94%',
    borderRadius: 24,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 18,
  },
  hero: {
    padding: 18,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
  },
  brandName: {
    color: COLORS.darkTextPrimary,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  brandPlan: {
    marginTop: 2,
    color: COLORS.darkTextSecondary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popularBadge: {
    marginTop: 18,
    alignSelf: 'flex-start',
    minHeight: 32,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  popularText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    marginTop: 12,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
    letterSpacing: 0,
  },
  copy: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
  },
  featurePill: {
    marginTop: 16,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  feature: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  pricingGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  priceCard: {
    flex: 1,
    minHeight: 110,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    justifyContent: 'space-between',
  },
  priceCardSelected: {
    shadowColor: COLORS.primary,
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  priceTopRow: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  priceLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  priceLabelSelected: {
  },
  priceBadge: {
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 9,
    fontWeight: '900',
  },
  priceRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
  },
  originalPrice: {
    fontSize: 12,
    lineHeight: 20,
    fontWeight: '900',
    marginRight: 8,
    marginBottom: 3,
    textDecorationLine: 'line-through',
  },
  originalPriceSelected: {
    opacity: 0.72,
  },
  priceValue: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  priceValueSelected: {
  },
  priceCadence: {
    fontSize: 10,
    fontWeight: '900',
    marginLeft: 4,
    marginBottom: 3,
  },
  priceCadenceSelected: {
  },
  priceHelper: {
    marginTop: 8,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  priceHelperSelected: {
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  perksSection: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginTop: 0,
    padding: 18,
    gap: 12,
  },
  perksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  perksTitle: {
    fontSize: 16,
    fontWeight: '900',
    flexShrink: 1,
  },
  perksCount: {
    fontSize: 12,
    fontWeight: '900',
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    minHeight: 36,
  },
  perkText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
  },
  planBtn: {
    marginHorizontal: 16,
    marginTop: 18,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  restoreBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  restoreBtnDisabled: {
    opacity: 0.58,
  },
  restoreText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  restoreTextDisabled: {
    opacity: 0.68,
  },
  laterBtn: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 14,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
