import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { ChevronLeft, Briefcase, MapPin, Target, Clock, MessageSquare, User, Sparkles } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile } from '../types';
import { earnedScore, handleFor, opportunityDetails } from '../lib/discovery';
import { ensureDirectMatch } from '../lib/chat';
import VerifiedBadge from '../components/VerifiedBadge';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';

export default function ActiveOpportunityScreen({ route, navigation }: any) {
  const userId = route?.params?.userId;
  const projectId = route?.params?.projectId;
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingChat, setOpeningChat] = useState(false);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    let alive = true;
    getDoc(doc(db, 'users', userId))
      .then((snap) => {
        if (!alive) return;
        if (snap.exists()) setProfile({ uid: snap.id, ...(snap.data() as any) } as UserProfile);
      })
      .catch((error) => {
        console.warn('Opportunity unavailable:', error);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [userId]);

  const selectedProject = useMemo(() => {
    const projects = Array.isArray((profile as any)?.projects) ? (profile as any).projects : [];
    return projects.find((project: any) => String(project?.id || '') === String(projectId || '')) || null;
  }, [profile, projectId]);
  const details = useMemo(() => opportunityDetails(profile, selectedProject), [profile, selectedProject]);
  const score = useMemo(() => earnedScore(profile), [profile]);

  const openChat = async () => {
    if (!user?.uid) {
      Alert.alert('Sign in to message', 'Create or sign in to a LINKUP account to message this builder.');
      navigation.navigate('EmailAuth');
      return;
    }
    if (!profile?.uid) return;
    setOpeningChat(true);
    try {
      const matchId = await ensureDirectMatch(user.uid, profile.uid);
      navigation.navigate('Chat', { matchId, otherUser: profile });
    } catch (error) {
      console.error('Opportunity chat error:', error);
      Alert.alert('Chat unavailable', 'Could not open this opportunity chat.');
    } finally {
      setOpeningChat(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={[styles.container, appBackground(isDark)]}>
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView edges={['top']} style={[styles.container, appBackground(isDark)]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ChevronLeft size={24} color={textColor(isDark)} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>OPPORTUNITY</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: textColor(isDark) }]}>Opportunity not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.container, appBackground(isDark)]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backButton, liquidGlass(isDark, false)]}>
          <ChevronLeft size={24} color={textColor(isDark)} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>ACTIVE OPPORTUNITY</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.heroCard, liquidGlass(isDark)]}>
          <View style={styles.heroTop}>
            <Image source={{ uri: profile.profilePic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' }} style={styles.avatar} />
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={[styles.name, { color: textColor(isDark) }]} numberOfLines={1}>{profile?.displayName || 'Builder'}</Text>
                {!!profile?.isVerified && <VerifiedBadge size={22} />}
              </View>
              <Text style={styles.handle}>{handleFor(profile)}</Text>
            </View>
            <View style={styles.scorePill}>
              <Text style={styles.scoreText}>{score}</Text>
            </View>
          </View>

          <Text style={[styles.title, { color: textColor(isDark) }]}>{details.title}</Text>
          <Text style={[styles.summary, { color: textColor(isDark, 'secondary') }]}>{details.summary}</Text>

          <View style={styles.grid}>
            <InfoTile icon={<Target size={16} color={COLORS.primary} />} label="Looking For" value={details.roleNeed} isDark={isDark} />
            <InfoTile icon={<Briefcase size={16} color={COLORS.primary} />} label="Stage" value={details.stage} isDark={isDark} />
            <InfoTile icon={<Clock size={16} color="#4ADE80" />} label="Availability" value={details.availability} isDark={isDark} />
            <InfoTile icon={<MapPin size={16} color="#EF4444" />} label="Location" value={details.location} isDark={isDark} />
          </View>

          {!!details.tags.length && (
            <View style={styles.tagsRow}>
              {details.tags.map((tag, index) => (
                <View key={`${tag}-${index}`} style={[styles.tagChip, liquidGlass(isDark, false)]}>
                  <Text style={[styles.tagText, { color: textColor(isDark) }]}>{tag.toUpperCase()}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={[styles.insightCard, liquidGlass(isDark)]}>
          <Sparkles size={18} color={COLORS.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.insightTitle, { color: textColor(isDark) }]}>Why this matters</Text>
            <Text style={styles.insightText}>
              This builder is actively signaling intent. Reach out if your skills, network, or capital can help them move faster.
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity onPress={() => navigation.navigate('Profile', { userId: profile.uid })} style={[styles.actionBtn, liquidGlass(isDark, false), { borderWidth: 1 }]}>
            <User size={18} color={textColor(isDark)} />
            <Text style={[styles.actionText, { color: textColor(isDark) }]}>PROFILE</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={openingChat} onPress={openChat} style={[styles.actionBtn, { backgroundColor: COLORS.primary, opacity: openingChat ? 0.6 : 1 }]}>
            {openingChat ? <ActivityIndicator size="small" color="#000" /> : <MessageSquare size={18} color="#000" />}
            <Text style={[styles.actionText, { color: '#000' }]}>MESSAGE</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const InfoTile = ({ icon, label, value, isDark }: any) => (
  <View style={[styles.infoTile, liquidGlass(isDark, false)]}>
    {icon}
    <Text style={styles.infoLabel}>{label.toUpperCase()}</Text>
    <Text style={[styles.infoValue, { color: textColor(isDark) }]} numberOfLines={2}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
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
  },
  headerTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 2 },
  content: { padding: 16, paddingBottom: 130, gap: 14 },
  heroCard: { borderRadius: 26, borderWidth: 1, padding: 16 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 58, height: 58, borderRadius: 20 },
  name: { fontSize: 18, fontWeight: '900', textTransform: 'uppercase', fontStyle: 'italic', flexShrink: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  verifiedMiniBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  handle: { marginTop: 2, fontSize: 11, fontWeight: '900', color: COLORS.primary },
  scorePill: { width: 48, height: 48, borderRadius: 18, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  scoreText: { fontSize: 16, fontWeight: '900', color: '#000' },
  title: { marginTop: 18, fontSize: 24, lineHeight: 29, fontWeight: '900', letterSpacing: 0.5 },
  summary: { marginTop: 10, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  infoTile: { width: '48%', minHeight: 104, borderRadius: 20, borderWidth: 1, padding: 12, gap: 6 },
  infoLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.5, color: '#666' },
  infoValue: { fontSize: 12, fontWeight: '900', lineHeight: 17 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  tagChip: { borderRadius: 13, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  tagText: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  insightCard: { flexDirection: 'row', gap: 12, borderRadius: 22, borderWidth: 1, padding: 14 },
  insightTitle: { fontSize: 13, fontWeight: '900', textTransform: 'uppercase' },
  insightText: { marginTop: 4, fontSize: 12, lineHeight: 18, fontWeight: '700', color: '#666' },
  actionBtn: { flex: 1, height: 52, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionText: { fontSize: 11, fontWeight: '900', letterSpacing: 1.8 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, fontWeight: '900', letterSpacing: 1 },
});
