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
 *
 * `active` lets a surface that is showing somebody ELSE's profile pass the
 * viewed person's paid status in directly, instead of the logged-in user's
 * (the default). A profile screen must crown the person on screen, not the
 * person holding the phone.
 */
export default function ProCrownBadge({ size = 15, active }: { size?: number; active?: boolean }) {
  const { profile } = useAuth();
  const show = typeof active === 'boolean' ? active : hasPaidLinkupPro(profile);
  if (!show) return null;

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
