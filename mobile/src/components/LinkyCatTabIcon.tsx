import React from 'react';
import LinkyCatIcon from './LinkyCatIcon';
import { useTheme } from '../contexts/ThemeContext';

/**
 * The "Linky" tab is the cat — as a plain grey outline, like every other
 * tab in the bar.
 *
 * The founder's call: no yellow tile behind it. The cat is a line icon
 * first and a character second — the 3D cat still lives in the chat, the
 * opening and the weekly reveal, but in the tab bar Linky stands in line
 * with Discover, Startups, Workspace and Blogs: one grey outline each.
 *
 * Unfocused it wears the exact grey the other line icons use (#9CA3AF on
 * light, #6B7280 on dark); focused it comes up to full ink and a touch
 * more weight, the same "you are here" the label gets.
 */
export default function LinkyCatTabIcon({
  focused = false,
  size = 24,
}: {
  focused?: boolean;
  size?: number;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <LinkyCatIcon
      size={size}
      color={focused ? '#0A0B0D' : isDark ? '#6B7280' : '#9CA3AF'}
      weight={focused ? 1.8 : 1.7}
      eyes={size >= 20}
      testID="linky-cat-glyph"
    />
  );
}
