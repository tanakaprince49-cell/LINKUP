// Social links: single source of truth for which networks LINKUP supports,
// how their chips look, and how messy user input becomes a real https URL.

export type SocialGlyphName = 'linkedin' | 'github' | 'tiktok' | 'instagram' | 'x' | 'website';

export type SocialField = {
  key: string; // key stored on profile.socialLinks
  network: SocialGlyphName;
  label: string;
  placeholder: string;
};

export const SOCIAL_FIELDS: SocialField[] = [
  { key: 'linkedin', network: 'linkedin', label: 'LinkedIn', placeholder: 'linkedin.com/in/you' },
  { key: 'github', network: 'github', label: 'GitHub', placeholder: 'github.com/you' },
  { key: 'tiktok', network: 'tiktok', label: 'TikTok', placeholder: 'tiktok.com/@you' },
  { key: 'instagram', network: 'instagram', label: 'Instagram', placeholder: 'instagram.com/you' },
  { key: 'twitter', network: 'x', label: 'X (Twitter)', placeholder: 'x.com/you' },
  { key: 'portfolio', network: 'website', label: 'Website', placeholder: 'yoursite.com' },
];

export const SOCIAL_CHIP_STYLE: Record<SocialGlyphName, { bg: string; fg: string }> = {
  linkedin: { bg: '#0A66C2', fg: '#FFFFFF' },
  github: { bg: '#1B1F24', fg: '#FFFFFF' },
  tiktok: { bg: '#010101', fg: '#FFFFFF' },
  instagram: { bg: '#E1306C', fg: '#FFFFFF' },
  x: { bg: '#000000', fg: '#FFFFFF' },
  website: { bg: '#FFFFFF', fg: '#111111' },
};

const SOCIAL_KEYS = SOCIAL_FIELDS.map((field) => field.key);

// Accepts full URLs, bare domains, or plain handles and returns a safe https URL.
export function normalizeSocialUrl(key: string, value?: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const noAt = raw.replace(/^@/, '');
  if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(noAt)) return `https://${noAt}`;
  const handle = noAt.replace(/^\/+|\/+$/g, '');
  if (!handle) return '';
  switch (key) {
    case 'linkedin':
      return `https://www.linkedin.com/in/${handle.replace(/^in\//i, '')}`;
    case 'github':
      return `https://github.com/${handle}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${handle.replace(/^@/, '')}`;
    case 'instagram':
      return `https://www.instagram.com/${handle}`;
    case 'twitter':
      return `https://x.com/${handle}`;
    default:
      return `https://${raw}`;
  }
}

export type SocialLinkEntry = {
  key: string;
  network: SocialGlyphName;
  label: string;
  url: string;
  bg: string;
  fg: string;
};

// The tappable chips for a profile's socialLinks map; empty/invalid ones drop out.
export function socialLinkEntries(socialLinks: unknown): SocialLinkEntry[] {
  if (!socialLinks || typeof socialLinks !== 'object') return [];
  const source = socialLinks as Record<string, unknown>;
  return SOCIAL_FIELDS.map((field) => {
    const url = normalizeSocialUrl(field.key, source[field.key]);
    if (!url) return null;
    const style = SOCIAL_CHIP_STYLE[field.network];
    return { key: field.key, network: field.network, label: field.label, url, bg: style.bg, fg: style.fg };
  }).filter((entry): entry is SocialLinkEntry => !!entry);
}

// Slim, capped copy safe for the public profile index + Firestore payloads.
export function sanitizeSocialLinks(socialLinks: unknown): Record<string, string> {
  if (!socialLinks || typeof socialLinks !== 'object') return {};
  const source = socialLinks as Record<string, unknown>;
  const out: Record<string, string> = {};
  SOCIAL_KEYS.forEach((key) => {
    const value = String(source[key] || '').trim().slice(0, 240);
    if (value) out[key] = value;
  });
  return out;
}
