import useDailyPicks from '../hooks/useDailyPicks';
import {useIsFocused} from '@react-navigation/native';
import { builderCall } from '../lib/builder';
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { SponsoredSlot } from '../components/SponsoredCard';
import { isSponsoredHiddenForViewer } from '../lib/campaigns';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, hairline, liquidGlass, textColor } from '../theme/theme';
import { subscribeToDiscoveryProfiles } from '../lib/discoveryProfiles';
import { isDiscoverableProfile } from '../lib/discovery';
import { DailyFiveCard, loadDailyFiveProgress, saveDailyFiveProgress } from '../lib/dailyLoop';
import { MOBILE_LIST_IMAGE_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';
import ScreenHeader from '../components/ScreenHeader';

export default function DailyFiveScreen({ navigation }: any) {
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const focused=useIsFocused(),daily=useDailyPicks(user?.uid,focused),loading=daily.loading;

  useEffect(()=>{let active=true;setDoneIds([]);if(user?.uid&&daily.day)void loadDailyFiveProgress(user.uid).then(p=>{if(active)setDoneIds(p.doneIds);});return()=>{active=false;};},[user?.uid,daily.day]);
  const cards=useMemo<DailyFiveCard[]>(()=>daily.people.map((p:any)=>({id:`person_${p.uid}`,kind:'person' as const,title:p.name,subtitle:p.why,userId:p.uid,pic:p.image})),[daily.people]);
  const markDone = async (id: string) => {
    if (!user?.uid || doneIds.includes(id)) return;
    const next = [...doneIds, id];
    setDoneIds(next);
    const completed = next.length >= Math.min(2, cards.length || 2);
    await saveDailyFiveProgress(user.uid, next, completed);
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

  const remaining = cards.filter(card => !doneIds.includes(card.id)).length;

  return (
    <SafeAreaView style={[styles.root, appBackground(isDark)]}>
      <ScreenHeader
        title="Today’s 2 picks"
        subtitle={daily.error||daily.note|| (cards.length === 0 ? 'Set your building context to find relevant people.' : remaining === 0 ? "You have reviewed these suggestions. Matching stays available all week." : `${remaining} left · about 90 seconds`)}
        onBack={() => navigation.goBack()}
        isDark={isDark}
      />
      {loading ? (
        <ActivityIndicator color={COLORS.primaryStrong} style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.list}>{daily.error&&<TouchableOpacity accessibilityRole="button" onPress={()=>void daily.refresh()}><Text>Retry today’s picks</Text></TouchableOpacity>}
          {/* Free plan sees a rotating sponsored card above the loop.
              PLUS is ad-free (founder/admin accounts excepted, for QA). */}
          <SponsoredSlot
            placement="daily"
            viewerUid={user?.uid}
            enabled={!isSponsoredHiddenForViewer(profile, { email: user?.email, isAdmin: (profile as any)?.isAdmin })}
          />
          <TouchableOpacity onPress={() => navigation.navigate('BuilderWorkspace', {section:'People'})} style={{padding:16,borderRadius:14,backgroundColor:'#e6f0be'}}>
            <Text style={{fontWeight:'800',color:'#17332b'}}>Refine my needs, availability & recommendations →</Text>
          </TouchableOpacity>
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
