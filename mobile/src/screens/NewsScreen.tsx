import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator, Linking, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExternalLink, RefreshCw, Bell, Sparkles } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { NewsArticle, fetchAINews } from '../lib/newsService';
import { db } from '../lib/firebase';
import { COLORS, liquidGlass, textColor } from '../theme/theme';
import { SponsoredCard, useSponsoredSlots } from '../components/SponsoredCard';
import { Campaign, interleaveSponsored, isSponsoredHiddenForViewer } from '../lib/campaigns';
import PaywallModal from '../components/PaywallModal';

const CATEGORIES = ['all', 'startup', 'tech', 'company', 'research'] as const;

/** Ad density for the News feed: first card after this many stories... */
const NEWS_FIRST_AD_AFTER = 1;
/** ...then one after every N stories to the bottom of the list. */
const NEWS_AD_EVERY = 2;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function NewsScreen() {
  const { theme } = useTheme();
  const { user, profile } = useAuth();
  const isDark = theme === 'dark';
  // News is the heaviest ad surface in the app: a sponsored card after the
  // first story and then after every NEWS_AD_EVERY stories, all the way down
  // the feed. PLUS members are ad-free, except founder/admin accounts, who
  // need to see the placement to review it.
  const adsHidden = isSponsoredHiddenForViewer(profile, {
    email: user?.email,
    isAdmin: (profile as any)?.isAdmin,
  });
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState<string>('all');
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const notifiedRef = useRef(false);

  const loadNews = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    const data = await fetchAINews();
    setArticles(data);
    setLastUpdated(Date.now());
    setLoading(false);
    setRefreshing(false);

    if (!notifiedRef.current && user?.uid && data.length > 0) {
      const notifiedKey = `news_notified_${new Date().toDateString()}`;
      const already = await AsyncStorage.getItem(notifiedKey).catch(() => null);
      if (!already) {
        const top = data[0];
        const notificationId = `news_${user.uid}_${Date.now()}`;
        await setDoc(doc(db, 'notifications', notificationId), {
          userId: user.uid,
          fromId: 'linky',
          fromName: 'AI News',
          fromPic: '',
          type: 'system',
          content: `${top.title}`.slice(0, 480),
          isRead: false,
          timestamp: serverTimestamp(),
        }).catch(() => {});
        await AsyncStorage.setItem(notifiedKey, '1').catch(() => {});
      }
      notifiedRef.current = true;
    }
  }, [user?.uid]);

  useEffect(() => { loadNews(); }, [loadNews]);

  const filtered = category === 'all' ? articles : articles.filter(a => a.category === category);

  // How many ad slots this feed has: one after the first story, then one
  // after every NEWS_AD_EVERY stories. Sized from the article count so the
  // list never ends on a run of ads, and at least one so a short feed still
  // carries a card.
  const adSlotCount = filtered.length
    ? 1 + Math.floor(Math.max(0, filtered.length - NEWS_FIRST_AD_AFTER) / NEWS_AD_EVERY)
    : 0;
  const sponsoredAds = useSponsoredSlots('news', user?.uid, adSlotCount, !adsHidden);

  type FeedRow = { kind: 'row'; row: NewsArticle } | { kind: 'ad'; ad: Campaign | null; slot: number };
  const feedData = React.useMemo<FeedRow[]>(() => {
    if (adsHidden || !adSlotCount) return filtered.map((row) => ({ kind: 'row', row }));
    // No paid inventory at all: every slot becomes a Linky house card so the
    // cadence (and the upgrade prompt) is the same whether or not an
    // advertiser is live. `null` marks a house slot.
    const ads: Array<Campaign | null> = sponsoredAds.length
      ? sponsoredAds
      : Array.from({ length: adSlotCount }, () => null);
    return interleaveSponsored(filtered, ads, NEWS_AD_EVERY, NEWS_FIRST_AD_AFTER);
  }, [filtered, sponsoredAds, adsHidden, adSlotCount]);

  const renderRow = ({ item }: { item: FeedRow }) => {
    if (item.kind === 'ad') {
      return item.ad ? (
        <SponsoredCard campaign={item.ad} viewerUid={user?.uid} />
      ) : (
        <LinkyHouseCard isDark={isDark} onPress={() => setPaywallOpen(true)} />
      );
    }
    return renderArticle({ item: item.row });
  };

  const renderArticle = ({ item }: { item: NewsArticle }) => (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => Linking.openURL(item.url).catch(() => {})}
      style={[styles.card, liquidGlass(isDark)]}
    >
      {item.imageUrl && <Image source={{ uri: item.imageUrl }} style={styles.cardImage} />}
      <View style={styles.cardBody}>
        <View style={styles.cardMeta}>
          <Text style={styles.sourceText}>{item.sourceName}</Text>
          <Text style={styles.timeText}>{timeAgo(item.publishedAt)}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: textColor(isDark) }]} numberOfLines={2}>
          {item.title}
        </Text>
        {item.description ? (
          <Text style={[styles.cardDesc, { color: textColor(isDark, 'muted') }]} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.cardFooter}>
          <View style={[styles.categoryChip, { backgroundColor: isDark ? 'rgba(17, 24, 39,0.1)' : 'rgba(17, 24, 39,0.15)' }]}>
            <Text style={styles.categoryText}>{item.category}</Text>
          </View>
          <ExternalLink size={14} color={textColor(isDark, 'muted')} />
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}>
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              onPress={() => setCategory(cat)}
              style={[styles.filterChip, category === cat && { backgroundColor: COLORS.primary }]}
            >
              <Text style={[styles.filterText, { color: category === cat ? '#000' : textColor(isDark, 'muted') }]}>
                {cat === 'all' ? 'All' : cat[0].toUpperCase() + cat.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity onPress={() => loadNews(true)} style={styles.refreshBtn} disabled={refreshing}>
          <RefreshCw size={16} color={COLORS.primaryStrong} />
        </TouchableOpacity>
        <Text style={[styles.updatedText, { color: textColor(isDark, 'muted') }]}>
          {refreshing ? 'Updating…' : `Updated ${timeAgo(new Date(lastUpdated).toISOString())} ago`}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.primaryStrong} style={{ marginTop: 80 }} />
      ) : (
        <FlatList
          data={feedData}
          keyExtractor={(item, index) => (item.kind === 'ad' ? `ad-${item.slot}-${item.ad?.id || 'house'}` : item.row.id || String(index))}
          renderItem={renderRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={() => loadNews(true)}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Bell size={32} color={textColor(isDark, 'muted')} />
              <Text style={[styles.emptyText, { color: textColor(isDark, 'muted') }]}>No articles found.</Text>
            </View>
          }
        />
      )}
      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        feature="Linky AI Assistant"
        description="Unlock Linky and he finds your co-founder, your investor or your next teammate, then writes the intro for you. Unlimited discovery and warm intros included — and no more sponsored cards."
      />
    </SafeAreaView>
  );
}

/**
 * House card for News when no advertiser is live. Linky in first person,
 * matching the house promo in the decks; tapping opens the PLUS paywall.
 */
function LinkyHouseCard({ isDark, onPress }: { isDark: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={[styles.houseCard, liquidGlass(isDark)]}>
      <View style={styles.housePill}>
        <Text style={styles.housePillText}>SPONSORED · LINKY</Text>
      </View>
      <View style={styles.houseBody}>
        <View style={styles.houseAvatar}>
          <Text style={styles.houseAvatarText}>AI</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={[styles.houseTitle, { color: textColor(isDark) }]} numberOfLines={2}>
            Linky found people for you
          </Text>
          <Text style={[styles.houseBlurb, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>
            I've read every builder here. Unlock me and I'll introduce you to the ones who fit.
          </Text>
          <View style={styles.houseCtaRow}>
            <Sparkles size={12} color={COLORS.primaryStrong} />
            <Text style={[styles.houseCta, { color: COLORS.primaryStrong }]}>Unlock Linky</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  houseCard: { borderRadius: 16, padding: 14, marginBottom: 16, gap: 10 },
  housePill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: 'rgba(128,128,128,0.14)' },
  housePillText: { fontSize: 8, fontWeight: '900', letterSpacing: 1.1, color: '#8A8A93' },
  houseBody: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  houseAvatar: { width: 52, height: 52, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  houseAvatarText: { fontSize: 18, fontWeight: '900', color: '#000', letterSpacing: 1 },
  houseTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  houseBlurb: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  houseCtaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  houseCta: { fontSize: 10, fontWeight: '800' },
  filterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  filterScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  filterContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(128,128,128,0.1)',
  },
  filterText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  card: {
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.06)',
  },
  cardImage: {
    width: '100%',
    height: 200,
    resizeMode: 'cover',
  },
  cardBody: {
    padding: 16,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sourceText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primaryStrong,
    letterSpacing: 0.5,
  },
  timeText: {
    fontSize: 11,
    color: '#999',
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 22,
    marginBottom: 6,
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  categoryText: {
    fontSize: 9,
    fontWeight: '900',
    color: COLORS.primaryStrong,
    letterSpacing: 1,
  },
  updatedText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginRight: 16,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 100,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
