import React from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';

interface BrandMarkProps {
  size?: number;
  style?: StyleProp<ImageStyle>;
}

const LOGO = require('../../assets/logo-cat.png');

/**
 * LINKUP brand mark — the cat plugging the cable into the socket.
 * Offline page shows the cable pulled out; the brand shows it going in:
 * the cat gets you connected.
 */
export default function BrandMark({ size = 24, style }: BrandMarkProps) {
  return (
    <Image
      source={LOGO}
      style={[
        { width: size, height: size, borderRadius: size * 0.24 },
        style,
      ]}
      resizeMode="cover"
    />
  );
}
