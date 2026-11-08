import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import LinkyCatIcon from './LinkyCatIcon';

/**
 * The "Linky" tab is the cat.
 *
 * Linky is the only tab that is a character rather than a feature, so it is the
 * only tab that wears a mark instead of a line icon: the gold rounded tile from
 * the founder's sketch, with the cat drawn inside it as a single ink line. The
 * tile is the frame in that sketch — the glyph and the frame are one object, so
 * it reads the same at 20px on a phone tab bar as it does at 96px anywhere else.
 *
 * Unfocused the cat is ink at 60% and the frame is not drawn; focused the frame
 * closes to a full ink ring, the cat comes to full strength and the tile lifts
 * a hair. Nothing here animates — a tab bar that moves is a tab bar you notice
 * instead of the screen.
 */
export default function LinkyCatTabIcon({
  focused = false,
  size = 24,
}: {
  focused?: boolean;
  size?: number;
}) {
  const radius = Math.round(size * 0.31);
  // The cat sits inside the tile with a hair of breathing room, exactly like the
  // sketch: frame, gap, cat — in that order.
  const glyph = Math.round(size * (focused ? 0.86 : 0.8));

  return (
    <View
      testID="linky-cat-tab-icon"
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: radius,
          borderColor: focused ? '#0A0B0D' : 'transparent',
          transform: [{ scale: focused ? 1.08 : 1 }],
        },
        focused && styles.tileFocused,
      ]}
    >
      <LinkyCatIcon
        size={glyph}
        color={focused ? '#0A0B0D' : 'rgba(10,11,13,0.62)'}
        weight={focused ? 1.8 : 1.7}
        eyes={size >= 20}
        testID="linky-cat-glyph"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
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
