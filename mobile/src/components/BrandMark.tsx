import React from 'react';
import { View, ViewStyle } from 'react-native';
import Svg, { Rect, Path } from 'react-native-svg';

interface BrandMarkProps {
  size?: number;
  style?: ViewStyle;
}

/**
 * LINKUP brand mark — Lime square with the "L + rising arrow" glyph.
 * Plain geometry drawn in code: an L that climbs into an up-right arrow
 * (link up / level up). No stock imagery, no generated texture, crisp at
 * every size.
 */
export default function BrandMark({ size = 24, style }: BrandMarkProps) {
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Rect x={0} y={0} width={100} height={100} rx={24} fill="#FBE618" />
        {/* L shape whose foot rises into an arrow */}
        <Path
          d="M33 28 V62 H48 L70 40"
          stroke="#000000"
          strokeWidth={9}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Arrowhead */}
        <Path
          d="M57 40 H70 M70 40 V53"
          stroke="#000000"
          strokeWidth={9}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}
