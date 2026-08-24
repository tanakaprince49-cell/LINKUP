import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { loadLeaguePool } from '../lib/leaguePool';
import { displayNameFor } from '../lib/discovery';
import { decayingRepScore, daysSince, normalizeShipLogs } from '../lib/dailyLoop';
import { MOBILE_LIST_IMAGE_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';
import { AppImage } from '../components/AppImage';
import { ikAvatar } from '../lib/ikImage';
import VerifiedBadge from '../components/VerifiedBadge';
import ScreenHeader from '../components/ScreenHeader';

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
    let alive = true;
    setLoading(true);
    loadLeaguePool()
      .then((rows) => {
        if (!alive) return;
        setPeople(rows);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user?.uid]);

  const league = useMemo(() => {
    // JUDGED BY COUNTRY/CITY (user decree): the league is LOCAL to what's in
    // your profile settings. Same-city + same-country builders only, ranked
    // by decaying Rep. The old code silently fell back to the GLOBAL pool
    // when locals were < 3 — so everyone worldwide saw the same faces and it
    // was a fake "city" league. Now: you set a location, you get YOUR local
    // table, even if it's small (honest beats fake). No location set at all?
    // Then and only then it's the Global league.
    const hasLocation = !!(city || country);
    const locals = people.filter((p) => {
      const pCity = String(p.city || '').toLowerCase();
      const pCountry = String(p.country || '').toLowerCase();
      if (city && pCity === city.toLowerCase()) return true;
      if (country && pCountry === country.toLowerCase()) return true;
      return false;
    });
    const pool = hasLocation ? locals : people;
    return [...pool]
      .map((p) => {
        const logs = normalizeShipLogs(p.shipLogs);
        const score = decayingRepScore(p, { shipCount: logs.length || Number(p.shipCount || 0), idleDays: daysSince(logs[0]?.createdAt || p.lastShippedAt) });
        return { ...p, leagueScore: score };
      })
      .sort((a, b) => {
        const diff = b.leagueScore - a.leagueScore;
        return diff !== 0 ? diff : String(a.uid).localeCompare(String(b.uid));
      })
      .slice(0, 25);
  }, [people, city, country]);

  return (
    <SafeAreaView style={[styles.root, appBackground(isDark)]}>
      <ScreenHeader
        title={city || country ? 'City league' : 'Global league'}
        subtitle={`${city ? `${city}${country ? `, ${country}` : ''}` : country || 'Global'} · ranked by Rep that can decay`}
        onBack={() => navigation.goBack()}
        isDark={isDark}
      />
      {loading ? (
        <ActivityIndicator color={COLORS.primaryStrong} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={league}
          keyExtractor={(item) => item.uid}
          contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: 40 }}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: textColor(isDark, 'muted') }]}>
              {city || country
                ? `No ranked builders in ${city || country} yet — invite builders from your area and take the crown first.`
                : 'No ranked builders yet.'}
            </Text>
          }
          renderItem={({ item, index }) => (
            <TouchableOpacity onPress={() => navigation.navigate('Profile', { userId: item.uid })} style={[styles.row, liquidGlass(isDark, false)]}>
              <Text style={[styles.rank, { color: index < 3 ? COLORS.primaryStrong : textColor(isDark) }]}>{index + 1}</Text>
              <AppImage uri={ikAvatar(safeProfileImageUri(item.profilePic, MOBILE_LIST_IMAGE_LIMIT)) || 'https://ui-avatars.com/api/?name=+&background=E5E7EB&color=9CA3AF&size=256'} style={styles.pic} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.name, { color: textColor(isDark) }]} numberOfLines={1}>{displayNameFor(item)}</Text>
                  {item.isVerified ? <VerifiedBadge size={16} /> : null}
                </View>
                <Text style={[styles.meta, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>{item.occupation || 'Builder'} · {item.city || item.country || 'Remote'}</Text>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  rank: { width: 24, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  pic: { width: 40, height: 40, borderRadius: 12 },
  name: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  meta: { marginTop: 2, fontSize: 13, fontWeight: '600' },
  score: { fontSize: 16, fontWeight: '800', color: COLORS.primaryStrong },
  empty: { textAlign: 'center', marginTop: 40, fontWeight: '600', fontSize: 15 },
});
