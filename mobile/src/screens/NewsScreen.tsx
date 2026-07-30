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
  const { user } = useAuth();
  const isDark = theme === 'dark';
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState<string>('all');
  const notifiedRef = useRef(false);

  const loadNews = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    const data = await fetchAINews();
    setArticles(data);
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
          <View style={[styles.categoryChip, { backgroundColor: isDark ? 'rgba(251,230,24,0.1)' : 'rgba(251,230,24,0.15)' }]}>
            <Text style={styles.categoryText}>{item.category.toUpperCase()}</Text>
          </View>
          <ExternalLink size={14} color={textColor(isDark, 'muted')} />
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
        <View style={styles.filterRow}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              onPress={() => setCategory(cat)}
              style={[styles.filterChip, category === cat && { backgroundColor: COLORS.primary }]}
            >
              <Text style={[styles.filterText, { color: category === cat ? '#000' : textColor(isDark, 'muted') }]}>
                {cat === 'all' ? 'ALL' : cat.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => loadNews(true)} style={styles.refreshBtn}>
            <RefreshCw size={16} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 80 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderArticle}
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
  filterScroll: {
    flexGrow: 0,
    marginVertical: 10,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
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
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  card: {
    borderRadius: 24,
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
    color: COLORS.primary,
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
    color: COLORS.primary,
    letterSpacing: 1,
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
