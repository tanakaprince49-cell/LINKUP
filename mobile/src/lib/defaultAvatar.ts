/**
 * Neutral "no profile picture yet" placeholders.
 * Never show a stock photo of a random person as someone's avatar:
 * render a clean initials tile (or a blank one when no name is known).
 */

const PLACEHOLDER_BG = 'E5E7EB'; // neutral gray
const PLACEHOLDER_FG = '4B5563'; // darker gray for the initial

export const avatarPlaceholderUri = (name?: unknown, size = 256): string => {
  const initial = String(typeof name === 'string' ? name : '')
    .trim()
    .charAt(0)
    .toUpperCase();
  const label = /^[A-Z0-9]$/.test(initial) ? initial : '+';
  return `https://ui-avatars.com/api/?name=${label}&background=${PLACEHOLDER_BG}&color=${PLACEHOLDER_FG}&size=${Math.max(
    16,
    Math.min(512, Math.round(size) || 256)
  )}&bold=true`;
};

/** Blank tile for small avatars where no name context exists. */
export const DEFAULT_AVATAR_URI = avatarPlaceholderUri();

/** Larger blank tile for full-card fallbacks (swipe deck etc). */
export const DEFAULT_CARD_PHOTO_URI = avatarPlaceholderUri('', 512);
