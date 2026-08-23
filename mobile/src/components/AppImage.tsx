import React from 'react';
import { StyleProp, ImageStyle } from 'react-native';
import { Image } from 'expo-image';

/**
 * AppImage — expo-image wrapper with DISK cache (memory-disk). RN's stock
 * Image has no persistent cache: on a ~1Mbps link every cold start re-
 * downloaded every face. With disk cache, a photo downloaded once renders
 * instantly forever, even fully offline.
 *
 * Rollback = this one file (swap back to react-native Image).
 */
type Props = {
  uri: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  transitionMs?: number;
};

export const AppImage = ({ uri, style, contentFit = 'cover', transitionMs = 100 }: Props) => {
  if (!uri) return null;
  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit={contentFit}
      cachePolicy="memory-disk"
      transition={transitionMs}
      recyclingKey={uri}
    />
  );
};

export default AppImage;
