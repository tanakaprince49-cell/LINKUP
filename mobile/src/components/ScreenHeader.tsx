import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { COLORS, hairline, textColor } from '../theme/theme';
import ProCrownBadge from './ProCrownBadge';

export default function ScreenHeader({
  title,
  subtitle,
  onBack,
  isDark,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  isDark: boolean;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      {onBack ? (
        <TouchableOpacity
          onPress={onBack}
          style={[styles.back, { borderColor: hairline(isDark) }]}
          activeOpacity={0.8}
        >
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
      ) : (
        <View style={{ width: 44 }} />
      )}
      <View style={styles.mid}>
        <Text style={[styles.title, { color: textColor(isDark) }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.sub, { color: textColor(isDark, 'muted') }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>
        <View style={styles.rightRow}>
          <ProCrownBadge />
          {right || <View style={{ width: 44 }} />}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 12,
    gap: 10,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mid: { flex: 1 },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  sub: { marginTop: 2, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  right: { minWidth: 44, alignItems: 'flex-end' },
  rightRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
