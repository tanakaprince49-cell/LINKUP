import React from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';

const CAT = require('../../assets/logo-cat.png');

/**
 * The "Linky" tab is the cat.
 *
 * Linky is the only tab that is a character rather than a feature, so it is the
 * only tab that gets a face instead of a line icon: the LINKUP cat, sitting in
 * a gold-ringed tile. Focused, the ring lights up and the tile lifts — the cat
 * notices you looking at it.
 */
export default function LinkyCatTabIcon({
  focused = false,
  size = 22,
}: {
  focused?: boolean;
  size?: number;
}) {
  const radius = size * 0.3;
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: radius,
          borderColor: focused ? '#FBE618' : 'transparent',
          transform: [{ scale: focused ? 1.08 : 1 }],
        },
        focused && styles.tileFocused,
      ]}
    >
      <Image
        source={CAT}
        style={{ width: '100%', height: '100%', borderRadius: radius - 1 }}
        resizeMode="cover"
        fadeDuration={Platform.OS === 'android' ? 0 : undefined}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderWidth: 1.5,
    overflow: 'hidden',
    backgroundColor: '#FBE618',
  },
  tileFocused: {
    shadowColor: '#FBE618',
    shadowOpacity: 0.65,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: Platform.OS === 'android' ? 6 : 0,
  },
});
