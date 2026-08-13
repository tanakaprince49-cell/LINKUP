import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Trophy } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { subscribeToDiscoveryProfiles } from '../lib/discoveryProfiles';
import { displayNameFor, isDiscoverableProfile } from '../lib/discovery';
import { decayingRepScore, daysSince, normalizeShipLogs } from '../lib/dailyLoop';
import { MOBILE_LIST_IMAGE_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';
import VerifiedBadge from '../components/VerifiedBadge';

export default function CityLeagueScreen({ navigation }: any) {
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [people, setPeople] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const city = String(profile?.city || '').trim();
  const country = String(profile?.country || '').trim();

  useEffect(() => {
    if (!user?.uid) return;
    return subscribeToDiscoveryProfiles({
      userId: user.uid,
      onData: (profiles) => {
        setPeople(profiles.filter((p: any) => isDiscoverableProfile(p)));
        setLoading(false);
      },
      onError: () => setLoading(false),
    });
  }, [user?.uid]);

  const league = useMemo(() => {
    const samePlace = people.filter((p) => {
      const pCity = String(p.city || '').toLowerCase();
      const pCountry = String(p.country || '').toLowerCase();
      if (city && pCity === city.toLowerCase()) return true;
      if (!city && country && pCountry === country.toLowerCase()) return true;
      return false;
    });
    const pool = samePlace.length >= 3 ? samePlace : people;
    return [...pool]
      .map((p) => {
        const logs = normalizeShipLogs(p.shipLogs);
        const score = decayingRepScore(p, { shipCount: logs.length || Number(p.shipCount || 0), idleDays: daysSince(logs[0]?.createdAt || p.lastShippedAt) });
        return { ...p, leagueScore: score };
      })
      .sort((a, b) => b.leagueScore - a.leagueScore)
      .slice(0, 25);
  }, [people, city, country]);

  return (
    <SafeAreaView style={[styles.root, appBackground(isDark)]}>
      <View style={styles.top}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: textColor(isDark) }]}>CITY LEAGUE</Text>
          <Text style={styles.sub}>{city || country || 'Global'} · ranked by Rep that can decay</Text>
        </View>
        <Trophy size={18} color={COLORS.primary} />
      </View>
      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={league}
          keyExtractor={(item) => item.uid}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
          ListEmptyComponent={<Text style={styles.empty}>Not enough builders in your city yet. Invite them.</Text>}
          renderItem={({ item, index }) => (
            <TouchableOpacity onPress={() => navigation.navigate('Profile', { userId: item.uid })} style={[styles.row, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#FFF' }]}>
              <Text style={[styles.rank, { color: index < 3 ? COLORS.primary : textColor(isDark) }]}>{index + 1}</Text>
              <Image source={{ uri: safeProfileImageUri(item.profilePic, MOBILE_LIST_IMAGE_LIMIT) || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80' }} style={styles.pic} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.name, { color: textColor(isDark) }]} numberOfLines={1}>{displayNameFor(item)}</Text>
                  {item.isVerified ? <VerifiedBadge size={16} /> : null}
                </View>
                <Text style={styles.meta} numberOfLines={1}>{item.occupation || 'Builder'} · {item.city || item.country || 'Remote'}</Text>
              </View>
              <Text style={styles.score}>{item.leagueScore}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '900' },
  sub: { marginTop: 3, fontSize: 11, fontWeight: '700', color: '#777' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, padding: 12 },
  rank: { width: 24, fontSize: 16, fontWeight: '900', textAlign: 'center' },
  pic: { width: 40, height: 40, borderRadius: 14 },
  name: { fontSize: 14, fontWeight: '900', flexShrink: 1 },
  meta: { marginTop: 2, fontSize: 11, fontWeight: '600', color: '#888' },
  score: { fontSize: 16, fontWeight: '900', color: COLORS.primary },
  empty: { textAlign: 'center', marginTop: 40, color: '#888', fontWeight: '700' },
});
