import React from 'react';
import { View, ViewStyle } from 'react-native';
import VerifiedBadge from './VerifiedBadge';
import { isGoldMember } from '../../../shared/member-badges';
export { isGoldMember } from '../../../shared/member-badges';

type Props = {
  userId?: string | null;
  verified?: boolean;
  size?: number;
  style?: ViewStyle;
};

// One identity-aware renderer for member names on every surface. The exclusive
// owner retains blue verification too, even when an old snapshot lacks the flag.
export default function MemberBadges({ userId, verified = false, size = 20, style }: Props) {
  const gold = isGoldMember(userId);
  if (!gold && !verified) return null;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }, style]}>
      <VerifiedBadge size={size} />
      {gold ? <VerifiedBadge size={size} color="#F1E5AC" checkColor="#FFFFFF" accessibilityLabel="Gold verified — LINKUP CEO" /> : null}
    </View>
  );
}
