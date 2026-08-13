import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useGamification } from '../contexts/GamificationContext';
import { COLORS, appBackground, hairline, liquidGlass, textColor } from '../theme/theme';
import { subscribeToDiscoveryProfiles } from '../lib/discoveryProfiles';
import { isDiscoverableProfile } from '../lib/discovery';
import { buildDailyFive, DailyFiveCard, loadDailyFiveProgress, saveDailyFiveProgress } from '../lib/dailyLoop';
import { MOBILE_LIST_IMAGE_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';
import ScreenHeader from '../components/ScreenHeader';

export default function DailyFiveScreen({ navigation }: any) {
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const { trackAction } = useGamification();
  const isDark = theme === 'dark';
  const [cards, setCards] = useState<DailyFiveCard[]>([]);
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    let mounted = true;
    loadDailyFiveProgress(user.uid).then((progress) => {
      if (mounted) setDoneIds(progress.doneIds);
    });
    const unsub = subscribeToDiscoveryProfiles({
      userId: user.uid,
      onData: (profiles) => {
        const people = profiles.filter((p: any) => p.uid !== user.uid && isDiscoverableProfile(p));
        setCards(buildDailyFive(profile, people));
        setLoading(false);
      },
      onError: () => {
        setCards(buildDailyFive(profile, []));
        setLoading(false);
      },
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [user?.uid, profile?.uid]);

  const markDone = async (id: string) => {
    if (!user?.uid || doneIds.includes(id)) return;
    const next = [...doneIds, id];
    setDoneIds(next);
    const completed = next.length >= Math.min(5, cards.length || 5);
    await saveDailyFiveProgress(user.uid, next, completed);
    trackAction('daily_login');
  };

  const openCard = (card: DailyFiveCard) => {
    void markDone(card.id);
    if (card.kind === 'person' || card.kind === 'opportunity') {
      navigation.navigate(card.kind === 'opportunity' ? 'ActiveOpportunity' : 'Profile', { userId: card.userId });
      return;
    }
    if (card.kind === 'idea') {
      navigation.navigate('IdeaDeck', { habit: true });
      return;
    }
    navigation.navigate('ShipLog');
  };

  const remaining = Math.max(0, (cards.length || 5) - doneIds.length);

  return (
    <SafeAreaView style={[styles.root, appBackground(isDark)]}>
      <ScreenHeader
        title="Daily 5"
        subtitle={remaining === 0 ? 'Done. Come back tomorrow.' : `${remaining} left · about 90 seconds`}
        onBack={() => navigation.goBack()}
        isDark={isDark}
      />
      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.list}>
          {cards.map((card, index) => {
            const done = doneIds.includes(card.id);
            return (
              <TouchableOpacity
                key={card.id}
                onPress={() => openCard(card)}
                style={[styles.card, liquidGlass(isDark, false), { opacity: done ? 0.55 : 1 }]}
              >
                <View style={[styles.index, { backgroundColor: done ? COLORS.success : COLORS.primary }]}>
                  {done ? <Check size={14} color="#FFF" /> : <Text style={styles.indexText}>{index + 1}</Text>}
                </View>
                {'pic' in card && card.pic ? (
                  <Image source={{ uri: safeProfileImageUri(card.pic, MOBILE_LIST_IMAGE_LIMIT) || undefined }} style={styles.pic} />
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: textColor(isDark) }]} numberOfLines={1}>{card.title}</Text>
                  <Text style={[styles.cardSub, { color: textColor(isDark, 'muted') }]} numberOfLines={2}>{card.subtitle}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingHorizontal: 20, gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  index: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  indexText: { fontSize: 13, fontWeight: '800', color: '#111' },
  pic: { width: 40, height: 40, borderRadius: 12 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardSub: { marginTop: 3, fontSize: 13, fontWeight: '600', lineHeight: 18 },
});
