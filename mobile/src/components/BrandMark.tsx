import React from 'react';
import { Image, ImageStyle, Platform, StyleProp, View } from 'react-native';

interface BrandMarkProps {
  size?: number;
  style?: StyleProp<ImageStyle>;
}

const LOGO = require('../../assets/logo-cat.png');

/**
 * LINKUP brand mark — the cat plugging the cable into the socket.
 * Offline page shows the cable pulled out; the brand shows it going in:
 * the cat gets you connected.
 *
 * Android hardening: lime backing view (so the mark is a solid tile even
 * while the PNG decodes) + fadeDuration 0 (Android fades images in by
 * default, which can make cold-start logos look "missing").
 */
export default function BrandMark({ size = 24, style }: BrandMarkProps) {
  const radius = size * 0.24;
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: '#FBE618',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Image
        source={LOGO}
        style={{ width: '100%', height: '100%' }}
        resizeMode="cover"
        fadeDuration={Platform.OS === 'android' ? 0 : undefined}
      />
    </View>
  );
}
