import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Briefcase, MapPin } from 'lucide-react-native';
import MemberBadges from './MemberBadges';
import { AppImage } from './AppImage';
import { ikAvatar } from '../lib/ikImage';
import { MOBILE_LIST_IMAGE_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';
import { textColor } from '../theme/theme';
import ChosenCrown from './ChosenCrown';

/**
 * THE CHOSEN ONE — how the week's person is introduced.
 *
 * The crown sits on top of the picture, not beside the name: the point of the
 * card is that one specific person was picked for you. The portrait is large,
 * framed in brand yellow with a halo, and stamped 1 OF 1 — the picture is the
 * first thing you see, before a single claim is made about them.
 *
 * Split out of the dashboard so the real thing can be rendered and proved in a
 * browser, and so the weekly card stays readable.
 */

const GOLD = '#FBE618';
const GOLD_DEEP = '#6E5B00';
const INK = '#0A0B0D';
const PLACEHOLDER = 'https://ui-avatars.com/api/?name=+&background=E5E7EB&color=9CA3AF&size=256';

type Props = {
  uid: string;
  name: string;
  handle: string;
  roleLine: string;
  location: string;
  stage?: string;
  profilePic?: string;
  verified?: boolean;
  isDark?: boolean;
};

export default function WeeklyPortrait({
  uid,
  name,
  handle,
  roleLine,
  location,
  stage,
  profilePic,
  verified,
  isDark = false,
}: Props) {
  const uri = ikAvatar(safeProfileImageUri(profilePic, MOBILE_LIST_IMAGE_LIMIT)) || PLACEHOLDER;

  return (
    <View testID="weekly-portrait" style={styles.stage}>
      <View style={styles.crownStage}>
        <ChosenCrown size={46} />
      </View>

      <View testID="weekly-portrait-frame" style={styles.halo}>
        <View style={[styles.frame, { backgroundColor: isDark ? '#12151E' : '#FFFFFF' }]}>
          <AppImage uri={uri} style={styles.image} />
        </View>
        <View style={styles.flag}>
          <Text style={styles.flagText}>1 OF 1</Text>
        </View>
      </View>

      <View style={styles.nameRow}>
        <Text testID="weekly-portrait-name" style={[styles.name, { color: textColor(isDark) }]} numberOfLines={1}>
          {name}
        </Text>
        <MemberBadges userId={uid} verified={!!verified} size={18} />
      </View>
      <Text style={[styles.handle, { color: GOLD_DEEP }]} numberOfLines={1}>
        {handle}
      </Text>
      <Text style={[styles.role, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>
        {roleLine}
      </Text>

      <View style={styles.metaRow}>
        <View style={styles.metaChip}>
          <MapPin size={11} color="#4ADE80" />
          <Text style={[styles.metaChipText, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
            {location}
          </Text>
        </View>
        {!!stage && (
          <View style={styles.metaChip}>
            <Briefcase size={11} color={INK} />
            <Text style={[styles.metaChipText, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
              {stage}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { marginTop: 18, alignItems: 'center' },
  // Negative margin pulls the crown onto the top edge of the portrait.
  crownStage: { marginBottom: -9, zIndex: 3, alignItems: 'center' },
  halo: {
    padding: 4,
    borderRadius: 42,
    backgroundColor: 'rgba(251,230,24,0.18)',
    shadowColor: GOLD,
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  frame: { padding: 3, borderRadius: 38, borderWidth: 3, borderColor: GOLD },
  image: { width: 116, height: 116, borderRadius: 30 },
  flag: {
    position: 'absolute',
    bottom: -9,
    right: -8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: INK,
    borderWidth: 1,
    borderColor: GOLD,
  },
  flagText: { color: GOLD, fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  nameRow: { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  name: { fontSize: 22, fontWeight: '900', letterSpacing: -0.6, textAlign: 'center', flexShrink: 1 },
  handle: { marginTop: 2, fontSize: 12, fontWeight: '900', textAlign: 'center' },
  role: { marginTop: 6, fontSize: 13, fontWeight: '800', textAlign: 'center', lineHeight: 18 },
  metaRow: { marginTop: 11, flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaChipText: { fontSize: 10.5, fontWeight: '800' },
});
