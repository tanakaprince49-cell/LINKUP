import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Group invite links: https://www.linkupbuild.com/app/g/<code>
 *
 * The code is the 12-hex-char `inviteCode` minted server-side (see
 * api/_groups.js). Possession of the link is the invitation, so it works
 * for unlisted groups too; joining still passes the server rails (live
 * onboarded profile, not banned, no blocked members, 32-seat cap).
 *
 * Flow: the link opens the app (web /app/g/<code>, native linkup://g/<code>),
 * App.tsx parks the code, and once the visitor is signed in and onboarded
 * it calls groupJoinLink and lands them inside the group.
 */
export const GROUP_INVITE_CODE_PATTERN = /^[a-f0-9]{12}$/;
const PENDING_GROUP_INVITE_KEY = 'linkup.pendingGroupInvite';

export function groupInviteUrl(code: string): string {
  return `https://www.linkupbuild.com/app/g/${String(code || '').trim().toLowerCase()}`;
}

/** Pull the invite code out of any spelling of the link, or '' if none. */
export function groupInviteCodeFromUrl(value?: string | null): string {
  const raw = String(value || '');
  const match = raw.match(/(?:^|[\/:])g\/([a-f0-9]{12})(?:[/?#]|$)/i);
  const code = (match?.[1] || '').toLowerCase();
  return GROUP_INVITE_CODE_PATTERN.test(code) ? code : '';
}

export async function parkGroupInviteCode(code: string): Promise<void> {
  if (!GROUP_INVITE_CODE_PATTERN.test(code)) return;
  try {
    await AsyncStorage.setItem(PENDING_GROUP_INVITE_KEY, code);
  } catch {
    // Best-effort: a blocked store just means the link needs a live session.
  }
}

export async function readPendingGroupInviteCode(): Promise<string> {
  try {
    const code = String((await AsyncStorage.getItem(PENDING_GROUP_INVITE_KEY)) || '').trim().toLowerCase();
    return GROUP_INVITE_CODE_PATTERN.test(code) ? code : '';
  } catch {
    return '';
  }
}

export async function clearPendingGroupInviteCode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_GROUP_INVITE_KEY);
  } catch {
    // ignore
  }
}
