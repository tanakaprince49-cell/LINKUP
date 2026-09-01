import React from 'react';
import { Platform, StyleProp, ImageStyle, View } from 'react-native';
import { Image } from 'expo-image';
import { LOCAL_PLACEHOLDER_URI } from '../lib/defaultAvatar';

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
 *
 * It also never paints nothing. A photo that 404s used to leave an empty
 * layer, because the stand-in (placeholder and FALLBACK_PHOTO alike) was
 * another REMOTE url that could fail the same way — so one bad photo turned
 * a whole card into an empty rectangle. On error we drop to an inlined PNG
 * that needs no network, and if even that fails we paint a flat tile. A
 * missing photo must be a grey square, never a hole.
 */
type Props = {
  uri: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  transitionMs?: number;
  /** Opt in for recycled list rows only — see note above. */
  recycle?: boolean;
};

const TILE = { backgroundColor: '#E5E7EB' } as const;

export const AppImage = ({ uri, style, contentFit = 'cover', transitionMs = 0, recycle = false }: Props) => {
  const [source, setSource] = React.useState(uri);
  const [dead, setDead] = React.useState(false);

  React.useEffect(() => {
    setSource(uri);
    setDead(false);
  }, [uri]);

  // No uri at all: still hold the slot, so the layer above it has something
  // to cover and the card never shows through as an empty frame.
  if (!uri || dead) return <View style={[style as any, TILE]} />;

  return (
    <Image
      source={{ uri: source }}
      style={style}
      contentFit={contentFit}
      cachePolicy="memory-disk"
      transition={0}
      recyclingKey={recycle ? uri : undefined}
      // Local, so the stand-in shows even when the network cannot reach
      // either the CDN or the old remote avatar service.
      placeholder={LOCAL_PLACEHOLDER_URI}
      placeholderContentFit={contentFit}
      onError={(event: any) => {
        console.warn('[LINKUP IMG] failed to load:', source, event?.error);
        if (source !== LOCAL_PLACEHOLDER_URI) {
          setSource(LOCAL_PLACEHOLDER_URI);
          return;
        }
        setDead(true);
      }}
    />
  );
};

export default AppImage;
