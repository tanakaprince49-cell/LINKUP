import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator, Linking, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExternalLink, RefreshCw, Bell } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { NewsArticle, fetchAINews } from '../lib/newsService';
import { db } from '../lib/firebase';
import { COLORS, liquidGlass, textColor } from '../theme/theme';
import { SponsoredCard, useSponsoredSlot } from '../components/SponsoredCard';
import { hasLinkupPro } from '../lib/paywall';

const CATEGORIES = ['all', 'startup', 'tech', 'company', 'research'] as const;

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
  const isPro = hasLinkupPro(profile);
  // One sponsored card at a time, and never for PLUS members.
  const sponsored = useSponsoredSlot('news', user?.uid, !isPro);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
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

  // One sponsored card woven into the feed a few stories down, so it reads as
  // part of the list rather than an ad bolted onto the top.
  const feedData = React.useMemo<Array<{ kind: 'article'; article: NewsArticle } | { kind: 'sponsored' }>>(() => {
    const rows: Array<{ kind: 'article'; article: NewsArticle } | { kind: 'sponsored' }> = filtered.map((article) => ({
      kind: 'article',
      article,
    }));
    if (sponsored) rows.splice(Math.min(3, rows.length), 0, { kind: 'sponsored' });
    return rows;
  }, [filtered, sponsored]);

  const renderRow = ({ item }: { item: (typeof feedData)[number] }) => {
    if (item.kind === 'sponsored') {
      return sponsored ? <SponsoredCard campaign={sponsored} viewerUid={user?.uid} /> : null;
    }
    return renderArticle({ item: item.article });
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
          keyExtractor={(item, index) => (item.kind === 'sponsored' ? `sponsored-${sponsored?.id}` : item.article.id || String(index))}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
