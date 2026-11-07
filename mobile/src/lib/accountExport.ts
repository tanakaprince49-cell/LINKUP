/**
 * THE ACCOUNT EXPORT — pure data, no platform code.
 *
 * Kept apart from the saving logic so it can be run in a test, and reused by
 * the web build, without dragging Firebase or React Native into it.
 *
 * Deleting an account is the one door in this app that must never feel like a
 * trap. Before anything is removed we offer — never force — one readable JSON
 * file containing everything LINKUP holds about the member: the profile they
 * filled in, the private workspace state, and the brief the algorithm and Linky
 * were reading. No reformatting, no marketing. Just the file.
 */

export const EXPORT_SCHEMA = 'linkup.account-export.v1';

export type AccountExport = {
  schema: string;
  exportedAt: string;
  account: { uid: string; email: string; createdAt?: string };
  profile: Record<string, unknown> | null;
  private: Record<string, unknown> | null;
  /** The brief, lifted out so it is readable without decoding the profile. */
  brief: {
    buildingName?: string;
    buildingOneLiner?: string;
    buildingTraction?: string;
    missingSeat?: string;
    seatWhy?: string;
    stakes?: string;
    urgency?: string;
    workPace?: string;
    conflictStyle?: string;
    decisionStyle?: string;
    riskAppetite?: string;
    equityView?: string;
    weeklyHours?: string;
    relocateView?: string;
    matchingSignals?: string[];
  };
  notes: string;
};

/** Firestore Timestamps do not survive JSON.stringify usefully, so unwrap them. */
export const plain = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    const anyValue = value as Record<string, unknown> & { toDate?: () => Date; seconds?: number };
    if (typeof anyValue.toDate === 'function') {
      try {
        return anyValue.toDate().toISOString();
      } catch {
        return null;
      }
    }
    if (typeof anyValue.seconds === 'number' && Object.keys(anyValue).length <= 2) {
      return new Date(anyValue.seconds * 1000).toISOString();
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(anyValue)) out[key] = plain(entry);
    return out;
  }
  return value;
};

export function buildAccountExport(input: {
  uid: string;
  email?: string | null;
  profile?: Record<string, any> | null;
  private?: Record<string, unknown> | null;
  now?: Date;
}): AccountExport {
  const profile = (input.profile || null) as Record<string, any> | null;
  const createdAt = profile?.createdAt ? plain(profile.createdAt) : undefined;
  return {
    schema: EXPORT_SCHEMA,
    exportedAt: (input.now || new Date()).toISOString(),
    account: {
      uid: input.uid,
      email: String(input.email || ''),
      ...(typeof createdAt === 'string' ? { createdAt } : {}),
    },
    profile: profile ? (plain(profile) as Record<string, unknown>) : null,
    private: input.private ? (plain(input.private) as Record<string, unknown>) : null,
    brief: {
      buildingName: profile?.buildingName,
      buildingOneLiner: profile?.buildingOneLiner,
      buildingTraction: profile?.buildingTraction,
      missingSeat: profile?.missingSeat,
      seatWhy: profile?.seatWhy,
      stakes: profile?.stakes,
      urgency: profile?.urgency,
      workPace: profile?.workPace,
      conflictStyle: profile?.conflictStyle,
      decisionStyle: profile?.decisionStyle,
      riskAppetite: profile?.riskAppetite,
      equityView: profile?.equityView,
      weeklyHours: profile?.weeklyHours,
      relocateView: profile?.relocateView,
      matchingSignals: Array.isArray(profile?.matchingSignals) ? profile.matchingSignals : undefined,
    },
    notes:
      'This file is everything LINKUP stored about you. Deleting your account removes the profile, the brief and the private workspace on our side — this copy stays wherever you save it.',
  };
}

export const exportFileName = (uid: string, now = new Date()): string =>
  `linkup-data-${String(uid).slice(0, 8)}-${now.toISOString().slice(0, 10)}.json`;
