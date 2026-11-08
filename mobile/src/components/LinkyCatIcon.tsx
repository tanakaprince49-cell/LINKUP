import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * THE CAT, AS A LINE.
 *
 * Drawn from the hand sketch the founder sent: a cat sitting square inside a
 * rounded frame — two tall ears, a straight back, a tail hooking up the right
 * side. Redrawn on a 24-unit grid so it holds at 18px in a tab bar and at 96px
 * on an empty state, and so every stroke ends on a half pixel instead of
 * wobbling the way a traced bitmap does.
 *
 * It is a mark, not a mascot: the 3D launch cat is the character (chat, weekly
 * reveal, onboarding), this is the glyph (navigation, meters, chips). No face
 * detail below 24px — the eyes are the only feature, and they are drawn as
 * filled dots so they survive the scale-down.
 */
type Props = {
  size?: number;
  color?: string;
  /** Line weight in grid units. 1.7 is right at tab size; drop to 1.5 for tiny. */
  weight?: number;
  /** Draw the two eye dots. Off for very small sizes and for pure outlines. */
  eyes?: boolean;
  /** Appended to the SVG so a caller can keep the accessibility story coherent. */
  testID?: string;
};

export default function LinkyCatIcon({
  size = 24,
  color = '#0A0B0D',
  weight = 1.7,
  eyes = true,
  testID,
}: Props) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Back, ears and shoulders in one line — the silhouette is the shape
          people recognise from across a room, so it is never broken up. */}
      <Path d="M7 19.8C6.2 16.4 6.5 12.6 7.8 10.4L8.6 5L11.4 8.4L12.6 8.4L15.4 5L16.2 10.4C17.1 12.7 17.2 16 16.5 19.2" />
      {/* The tail, with a real gap from the body so it reads as a tail and not
          as a lump at 22px. */}
      <Path d="M17.9 18.2C20 17 20.5 14.2 19.1 13C18.1 12.2 17.3 13 17.8 14.1" />
      {eyes ? (
        <>
          <Circle cx="10.5" cy="11.6" r="0.62" fill={color} stroke="none" />
          <Circle cx="13.5" cy="11.6" r="0.62" fill={color} stroke="none" />
        </>
      ) : null}
    </Svg>
  );
}
