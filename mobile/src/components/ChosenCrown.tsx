import React from 'react';
import { View } from 'react-native';

/**
 * The crown for the one person LINKUP picked this week.
 *
 * Drawn with plain views on purpose: it has to render identically on Android,
 * iOS and web without pulling an icon font, and it has to sit *on top of* the
 * profile picture rather than beside the name. Silence, no animation.
 */

const GOLD = '#FBE618';
const INK = '#0A0B0D';

type Props = { size?: number; testID?: string };

export default function ChosenCrown({ size = 40, testID = 'chosen-crown' }: Props) {
  const s = size / 40;
  const spike = (h: number, w: number) => ({
    width: 0,
    height: 0,
    borderLeftWidth: w * s,
    borderRightWidth: w * s,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomWidth: h * s,
    borderBottomColor: GOLD,
  });

  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel="Chosen this week"
      style={{ width: 40 * s, height: 30 * s, alignItems: 'center', justifyContent: 'flex-end' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 * s }}>
        {/* left spike */}
        <View style={{ alignItems: 'center' }}>
          <View style={{ width: 4 * s, height: 4 * s, borderRadius: 2 * s, backgroundColor: GOLD, marginBottom: -1 * s }} />
          <View style={spike(12, 6)} />
        </View>
        {/* centre spike, taller: this is the chosen one */}
        <View style={{ alignItems: 'center' }}>
          <View style={{ width: 5 * s, height: 5 * s, borderRadius: 2.5 * s, backgroundColor: GOLD, marginBottom: -1 * s }} />
          <View style={spike(17, 7)} />
        </View>
        {/* right spike */}
        <View style={{ alignItems: 'center' }}>
          <View style={{ width: 4 * s, height: 4 * s, borderRadius: 2 * s, backgroundColor: GOLD, marginBottom: -1 * s }} />
          <View style={spike(12, 6)} />
        </View>
      </View>
      <View
        style={{
          width: 38 * s,
          height: 7 * s,
          borderRadius: 2 * s,
          backgroundColor: GOLD,
          borderWidth: 1,
          borderColor: INK,
          marginTop: -0.5 * s,
        }}
      />
    </View>
  );
}
