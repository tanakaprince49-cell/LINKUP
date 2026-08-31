import React from 'react';
import { Platform, StyleProp, ImageStyle } from 'react-native';
import { Image } from 'expo-image';

/**
 * AppImage — expo-image wrapper with DISK cache (memory-disk). RN's stock
 * Image has no persistent cache: on a ~1Mbps link every cold start re-
 * downloaded every face. With disk cache, a photo downloaded once renders
 * instantly forever, even fully offline.
 *
 * Rollback = this one file (swap back to react-native Image).
 *
 * Two anti-flicker rules live here, and both matter:
 *
 *  1. `transition` defaults to 0. A fade-in on every image change reads as a
 *     blink — on the swipe deck it fired on every single swipe.
 *  2. `recycle` defaults to false. `recyclingKey` tells expo-image to blank
 *     the frame the moment the uri changes, which is right for a recycled
 *     list row (never show the previous row's face) and wrong everywhere
 *     else: on the deck the view is reused for the next person, so blanking
 *     painted an empty card for a frame before the cached photo appeared.
 *     Surfaces that genuinely recycle rows opt in with `recycle`.
 */
type Props = {
  uri: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  transitionMs?: number;
  /** Opt in for recycled list rows only — see note above. */
  recycle?: boolean;
};

export const AppImage = ({ uri, style, contentFit = 'cover', transitionMs = 0, recycle = false }: Props) => {
  if (!uri) return null;
  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit={contentFit}
      cachePolicy="memory-disk"
      transition={Platform.OS === 'android' ? 0 : transitionMs}
      recyclingKey={recycle ? uri : undefined}
    />
  );
};

export default AppImage;
