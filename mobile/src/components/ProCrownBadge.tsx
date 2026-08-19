import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Crown } from 'lucide-react-native';
import { COLORS } from '../theme/theme';
import { useAuth } from '../contexts/AuthContext';
import { hasPaidLinkupPro } from '../lib/paywall';

/**
 * Renders a small royal crown chip for members with PAID LINKUP PLUS.
 * Drop it into any header — it hides itself for everyone else.
 * Gated on the paid entitlement (like the verified tick), so free-web
 * access never fakes Pro status.
 */
export default function ProCrownBadge({ size = 15 }: { size?: number }) {
  const { profile } = useAuth();
  if (!hasPaidLinkupPro(profile)) return null;

  return (
    <View style={[styles.chip, { width: size + 16, height: size + 16, borderRadius: (size + 16) / 2.4 }]}>
      <Crown size={size} color="#000" fill={COLORS.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
