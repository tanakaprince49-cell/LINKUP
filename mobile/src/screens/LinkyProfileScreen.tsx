import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, MessageSquare, Sparkles, Zap, Globe, Lightbulb, Target } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, liquidGlass, textColor } from '../theme/theme';
import VerifiedBadge from '../components/VerifiedBadge';

export default function LinkyProfileScreen({ navigation }: any) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.backButton, liquidGlass(isDark, false)]}>
          <ChevronLeft size={24} color={textColor(isDark)} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>PROFILE</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.heroCard, liquidGlass(isDark)]}>
          <View style={styles.heroTop}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>AI</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={[styles.name, { color: textColor(isDark) }]}>Linky AI</Text>
                <VerifiedBadge size={22} />
              </View>
              <Text style={styles.handle}>@linky</Text>
            </View>
            <View style={styles.scorePill}>
              <Text style={styles.scoreText}>AI</Text>
            </View>
          </View>

          <Text style={[styles.title, { color: textColor(isDark) }]}>Your AI assistant & matchmaker</Text>
          <Text style={[styles.summary, { color: textColor(isDark, 'secondary') }]}>
            I help you discover the right connections, craft warm intros, and navigate the LINKUP ecosystem.
          </Text>

          <View style={styles.grid}>
            <InfoTile icon={<Zap size={16} color="#22C55E" />} label="Role" value="AI Assistant" isDark={isDark} />
            <InfoTile icon={<Globe size={16} color={COLORS.primary} />} label="Network" value="Everywhere" isDark={isDark} />
            <InfoTile icon={<Lightbulb size={16} color="#F59E0B" />} label="Specialty" value="Matchmaking" isDark={isDark} />
            <InfoTile icon={<Target size={16} color="#EF4444" />} label="Focus" value="Founder connections" isDark={isDark} />
          </View>

          <View style={styles.tagsRow}>
            {['AI', 'MATCHMAKING', 'INTROS', 'NETWORK', 'ADVISOR', 'ZEN'].map((tag) => (
              <View key={tag} style={[styles.tagChip, liquidGlass(isDark, false)]}>
                <Text style={[styles.tagText, { color: textColor(isDark) }]}>{tag}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.insightCard, liquidGlass(isDark)]}>
          <Sparkles size={18} color={COLORS.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.insightTitle, { color: textColor(isDark) }]}>Why Linky AI</Text>
            <Text style={styles.insightText}>
              Linky AI scans the builder graph to find your perfect co-founder, first customer, or next investor. 
              Available 24/7 to draft warm intros and recommend who to meet next.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => navigation.replace('Linky')}
          style={styles.chatBtn}
        >
          <MessageSquare size={18} color="#000" />
          <Text style={styles.chatBtnText}>START CHAT</Text>
        </TouchableOpacity>
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
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22C55E',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  avatarText: { fontSize: 22, fontWeight: '900', color: '#FFF', letterSpacing: 1 },
  name: { fontSize: 20, fontWeight: '900', textTransform: 'uppercase', fontStyle: 'italic', flexShrink: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  handle: { marginTop: 2, fontSize: 12, fontWeight: '900', color: COLORS.primary },
  scorePill: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  scoreText: { fontSize: 14, fontWeight: '900', color: '#000' },
  title: { marginTop: 18, fontSize: 24, lineHeight: 29, fontWeight: '900', letterSpacing: 0.5 },
  summary: { marginTop: 10, fontSize: 14, lineHeight: 21, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  infoTile: {
    width: '48%',
    minHeight: 104,
    borderRadius: 20,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  infoLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.5, color: '#666' },
  infoValue: { fontSize: 12, fontWeight: '900', lineHeight: 17 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  tagChip: { borderRadius: 13, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  tagText: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  insightCard: { flexDirection: 'row', gap: 12, borderRadius: 22, borderWidth: 1, padding: 14 },
  insightTitle: { fontSize: 13, fontWeight: '900', textTransform: 'uppercase' },
  insightText: { marginTop: 4, fontSize: 12, lineHeight: 18, fontWeight: '700', color: '#666' },
  chatBtn: {
    height: 54,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  chatBtnText: { fontSize: 12, fontWeight: '900', letterSpacing: 2, color: '#000' },
});
