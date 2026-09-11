// PLUS identity repair.
//
// Web PLUS purchases live in webSubscriptions/{uid}, which only the server
// (and the owner) may read. The server stamps the outward identity flags
// (isPro / plan / subscriptionStatus / isVerified / turboConnect) onto
// users/{uid} + publicProfiles/{uid}, which is what other members read on the
// Android app. This helper asks the server to (re)stamp a uid and returns the
// authoritative public flags, so a viewer can render the tick / crown even
// when the target's docs predate the server-side stamping.
import { Platform } from 'react-native';
import { auth } from './firebase';
import { linkupWebBaseUrl } from './profileLinks';

export type PlusIdentityFlags = {
  isPro: boolean;
  isVerified: boolean;
  plan: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  turboConnect: boolean;
};

export type PlusRepairResult = {
  ok: boolean;
  repaired: boolean;
  plus: boolean;
  flags: PlusIdentityFlags | null;
};

const endpoint = () =>
  Platform.OS === 'web' ? '/api/plusRepair' : `${linkupWebBaseUrl()}/api/plusRepair`;

export async function repairPlusIdentity(uid?: string): Promise<PlusRepairResult> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to check PLUS identity.');
  const token = await user.getIdToken();
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(uid ? { uid } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data?.error || `Could not check PLUS identity (${res.status}).`));
  return data as PlusRepairResult;
}

/** Merge the public PLUS flags onto a profile object (additive only). */
export function applyPlusIdentityFlags(profile: any, flags: PlusIdentityFlags | null | undefined): any {
  if (!flags || !flags.isPro) return profile || null;
  const next: any = { ...(profile || {}) };
  if (!next.isPro) next.isPro = true;
  if (flags.plan) next.plan = next.plan || flags.plan;
  if (flags.subscriptionPlan) next.subscriptionPlan = next.subscriptionPlan || flags.subscriptionPlan;
  if (flags.subscriptionStatus) next.subscriptionStatus = next.subscriptionStatus || flags.subscriptionStatus;
  if (flags.isVerified) {
    next.isVerified = true;
    next.verificationProgram = next.verificationProgram || 'LINKUP PLUS';
  }
  if (flags.turboConnect) next.turboConnect = true;
  return next;
}
