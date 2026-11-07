import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasLinkupPro } from './paywall';
import {
  INVITES_PER_DAY,
  evaluateInviteForProfile,
  inviteDayKey,
  inviteFeatureOrder,
  inviteCopy,
  type InviteCopyProfile,
  type InviteDecision,
  type InviteExposure,
} from './plusInviteSchedule';

/**
 * Storage-backed half of the PLUS invitation: who was shown what today, so the
 * three-per-day rule survives a reload, a second device and a cold start.
 *
 * All the judgement lives in plusInviteSchedule.ts (pure, tested). This file
 * only reads and writes the little state that makes it idempotent.
 */

type InviteState = { day: string; exposures: InviteExposure[] };

const stateKey = (uid: string) => `linkup:plus-invite:${uid}`;

const emptyState = (now: number): InviteState => ({ day: inviteDayKey(now), exposures: [] });

export const readInviteState = async (uid: string, now: number = Date.now()): Promise<InviteState> => {
  if (!uid) return emptyState(now);
  try {
    const raw = await AsyncStorage.getItem(stateKey(uid));
    const parsed = raw ? JSON.parse(raw) : null;
    const day = inviteDayKey(now);
    if (!parsed || parsed.day !== day || !Array.isArray(parsed.exposures)) return { day, exposures: [] };
    return {
      day,
      exposures: parsed.exposures
        .filter((entry: any) => Number.isFinite(Number(entry?.at)) && Number.isFinite(Number(entry?.slot)))
        .map((entry: any) => ({ slot: Number(entry.slot), at: Number(entry.at) }))
        .slice(0, INVITES_PER_DAY),
    };
  } catch {
    return { day: inviteDayKey(now), exposures: [] };
  }
};

const writeInviteState = async (uid: string, state: InviteState) => {
  if (!uid) return;
  await AsyncStorage.setItem(stateKey(uid), JSON.stringify(state)).catch(() => {});
};

/** The invitation that is due right now, if any. */
export const currentInvite = async ({
  uid,
  profile,
  now = Date.now(),
  appActive = true,
}: {
  uid?: string;
  profile?: any;
  now?: number;
  appActive?: boolean;
}): Promise<InviteDecision> => {
  if (!uid) return { due: false, reason: 'no-uid' };
  if (hasLinkupPro(profile)) return { due: false, reason: 'plus' };
  const state = await readInviteState(uid, now);
  return evaluateInviteForProfile({
    uid,
    profile: (profile || {}) as InviteCopyProfile,
    isPlus: false,
    onboarded: profile?.onboarded !== false,
    appActive,
    now,
    exposures: state.exposures,
  });
};

/**
 * A paywall the member asked for (the "?plus=1" link in a PLUS email, or a
 * button that opens it deliberately). Ignores the clock and the daily cap — the
 * member knocked — but never opens for somebody who already has PLUS.
 */
export const manualInvite = ({
  uid,
  profile,
  now = Date.now(),
}: {
  uid?: string;
  profile?: any;
  now?: number;
}): InviteDecision => {
  if (!uid) return { due: false, reason: 'no-uid' };
  if (hasLinkupPro(profile)) return { due: false, reason: 'plus' };
  const order = inviteFeatureOrder(uid, inviteDayKey(now));
  const feature = order[0];
  return { due: true, slot: 0, feature, ...inviteCopy((profile || {}) as InviteCopyProfile, feature, 7) };
};

/** Count one exposure. Called when the invitation actually opens. */
export const recordInviteShown = async (uid: string, slot: number, now: number = Date.now()) => {
  if (!uid) return;
  const state = await readInviteState(uid, now);
  if (state.exposures.some((entry) => entry.slot === slot)) return;
  await writeInviteState(uid, {
    day: state.day,
    exposures: [...state.exposures, { slot, at: now }].slice(0, INVITES_PER_DAY),
  });
};

/**
 * "Not now." It is an answer, not a mistake: it still counts against the three,
 * because a member who said no twice has told us not to ask a fourth time today.
 */
export const snoozeInvite = async (uid: string, slot: number, now: number = Date.now()) => {
  await recordInviteShown(uid, slot, now);
};
