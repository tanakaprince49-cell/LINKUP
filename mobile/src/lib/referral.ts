import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { Platform } from 'react-native';
import { auth, db } from './firebase';
import { doc, serverTimestamp, setDoc } from './firestoreCompat';
import { linkupWebBaseUrl } from './profileLinks';
import { webAppPath } from './webPaths';

// Referral attribution, client half.
// 1. /r/:code 302s into the app as /app/?ref=:code (see api/_referrals.js).
// 2. captureReferralFromUrl() parks the code in storage at app boot.
// 3. When a FRESH account signs in, stampReferralIfFreshAccount() writes the
//    code onto its user doc (users/{uid}.referralCode) exactly once, which is
//    what the admin dashboard counts as that link's signups.
// The freshness guard (account created within the last 7 days) stops a
// long-time member who merely clicks an intern's link from being re-counted
// as that intern's signup.
export const REFERRAL_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;
const REFERRAL_STORAGE_KEY = 'linkup.referralCode';
const FRESH_ACCOUNT_MS = 7 * 24 * 3600 * 1000;

export function captureReferralFromUrl(): void {
  if (Platform.OS !== 'web') return;
  try {
    const code = (new URLSearchParams(window.location.search).get('ref') || '').trim().toLowerCase();
    if (REFERRAL_CODE_PATTERN.test(code)) {
      AsyncStorage.setItem(REFERRAL_STORAGE_KEY, code).catch(() => {});
    }
  } catch {
    // Storage blocked — attribution is best-effort, never break boot.
  }
}

export async function getStoredReferralCode(): Promise<string | null> {
  try {
    const code = ((await AsyncStorage.getItem(REFERRAL_STORAGE_KEY)) || '').trim().toLowerCase();
    return REFERRAL_CODE_PATTERN.test(code) ? code : null;
  } catch {
    return null;
  }
}

export async function clearStoredReferralCode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export async function stampReferralIfFreshAccount(authUser: any, currentReferralCode?: unknown): Promise<void> {
  try {
    if (typeof currentReferralCode === 'string' && currentReferralCode) return;
    if (!authUser?.uid) return;
    const createdMs = authUser?.metadata?.creationTime ? Date.parse(authUser.metadata.creationTime) : NaN;
    if (!Number.isFinite(createdMs) || Date.now() - createdMs > FRESH_ACCOUNT_MS) return;
    const code = await getStoredReferralCode();
    if (!code) return;
    await setDoc(
      doc(db, 'users', authUser.uid),
      { referralCode: code, referralStampedAt: serverTimestamp() },
      { merge: true },
    );
    await clearStoredReferralCode();
  } catch {
    // Attribution must never break sign-in.
  }
}

export type ReferralLink = {
  code: string;
  label: string;
  url: string;
  clicks: number;
  signups: number;
  active: boolean;
  createdAt: number | null;
  lastClickAt: number | null;
};

async function referralAdminApi(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const token = await auth.currentUser?.getIdToken().catch(() => '');
  if (!token) throw new Error('Please sign in again to manage referral links.');
  const path = '/api/publicSeo?mode=ref-admin';
  const url = Platform.OS === 'web' ? webAppPath(path) : `${linkupWebBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Referral request failed (${res.status}).`);
  return data;
}

export async function fetchReferralLinks(): Promise<ReferralLink[]> {
  const data = await referralAdminApi('list');
  return Array.isArray(data?.links) ? data.links : [];
}

export async function createReferralLink(label: string, code?: string): Promise<ReferralLink> {
  const data = await referralAdminApi('create', { label, ...(code ? { code } : {}) });
  return data.link as ReferralLink;
}

export async function renameReferralLink(code: string, label: string): Promise<ReferralLink> {
  const data = await referralAdminApi('rename', { code, label });
  return data.link as ReferralLink;
}

export async function setReferralLinkActive(code: string, active: boolean): Promise<ReferralLink> {
  const data = await referralAdminApi('setActive', { code, active });
  return data.link as ReferralLink;
}

export async function deleteReferralLink(code: string): Promise<void> {
  await referralAdminApi('delete', { code });
}

export async function copyReferralUrl(url: string): Promise<void> {
  await Clipboard.setStringAsync(url);
}
