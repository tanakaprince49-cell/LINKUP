import { Platform } from 'react-native';

const DEFAULT_LINKUP_WEB_URL = 'https://linkup-muqu.vercel.app';

const cleanBaseUrl = (value: string) => value.trim().replace(/\/+$/, '');

export function linkupWebBaseUrl() {
  if (Platform.OS === 'web') {
    const origin = String((globalThis as any)?.location?.origin || '');
    if (origin.startsWith('http')) return cleanBaseUrl(origin);
  }

  return cleanBaseUrl(String(process.env.EXPO_PUBLIC_LINKUP_WEB_URL || DEFAULT_LINKUP_WEB_URL));
}

export function profileIdFromLink(value?: string | null) {
  const raw = String(value || '').trim();
  const match = raw.match(/(?:\/profile\/|linkup:\/\/profile\/)([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export function publicProfileLink(userId?: string | null) {
  const uid = String(userId || '').trim();
  return uid ? `${linkupWebBaseUrl()}/profile/${encodeURIComponent(uid)}` : '';
}

export function profileLinkFor(profile: { uid?: string | null; profileLink?: string | null } | null | undefined) {
  return publicProfileLink(profile?.uid || profileIdFromLink(profile?.profileLink));
}
