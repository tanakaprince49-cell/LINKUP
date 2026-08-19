import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import type { SocialGlyphName } from '../lib/socialLinks';

// Brand glyphs drawn as SVG so they work identically on Android, iOS and web
// (lucide-react-native ships no brand icons).

const LINKED_IN_PATH =
  'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z';

const GITHUB_PATH =
  'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';

const TIKTOK_PATH =
  'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z';

const X_PATH =
  'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z';

// Instagram and the generic website globe read cleaner as primitives at small sizes.
const InstagramGlyph = ({ color }: { color: string }) => (
  <>
    <Rect x={3} y={3} width={18} height={18} rx={5.2} fill="none" stroke={color} strokeWidth={2.2} />
    <Circle cx={12} cy={12} r={4.1} fill="none" stroke={color} strokeWidth={2.2} />
    <Circle cx={17.35} cy={6.65} r={1.45} fill={color} />
  </>
);

const WebsiteGlyph = ({ color }: { color: string }) => (
  <>
    <Circle cx={12} cy={12} r={9} fill="none" stroke={color} strokeWidth={2.2} />
    <Line x1={3.4} y1={12} x2={20.6} y2={12} stroke={color} strokeWidth={2.2} />
    <Path d="M12 3c3.4 3.3 3.4 14.7 0 18" fill="none" stroke={color} strokeWidth={2.2} />
    <Path d="M12 3c-3.4 3.3-3.4 14.7 0 18" fill="none" stroke={color} strokeWidth={2.2} />
  </>
);

type Props = {
  network: SocialGlyphName;
  size?: number;
  color?: string;
};

export default function SocialGlyph({ network, size = 18, color = '#FFFFFF' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {network === 'linkedin' ? <Path d={LINKED_IN_PATH} fill={color} /> : null}
      {network === 'github' ? <Path d={GITHUB_PATH} fill={color} /> : null}
      {network === 'tiktok' ? <Path d={TIKTOK_PATH} fill={color} /> : null}
      {network === 'x' ? <Path d={X_PATH} fill={color} /> : null}
      {network === 'instagram' ? <InstagramGlyph color={color} /> : null}
      {network === 'website' ? <WebsiteGlyph color={color} /> : null}
    </Svg>
  );
}
