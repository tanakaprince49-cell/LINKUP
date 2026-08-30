/**
 * Founder / super-admin allowlist.
 *
 * These accounts own the product: LINKUP PLUS and Campaigns are free for them,
 * and they moderate the campaign review queue.
 *
 * Matched on EMAIL, not uid, on purpose. Every other admin signal lives in
 * Firestore — `config/admins`.uids and `users/{uid}.isAdmin` — and those reads
 * are exactly what failed and demoted the founder: offline, permission denied,
 * a recreated user doc, a reinstall, a device that never got the console
 * update. The signed-in Firebase user always carries its email, so an
 * allowlisted owner can never lose admin to a missing document.
 *
 * Keep this list in sync with `isCampaignAdmin()` in ../../firestore.rules —
 * that is the same check enforced server-side, and Firestore does not care
 * what the UI decided.
 */

export const ADMIN_EMAILS: readonly string[] = ['tanakaprince49@gmail.com'];

export const normalizeEmail = (email?: string | null): string => String(email || '').trim().toLowerCase();

/** Sync + offline-safe: is this email on the founder allowlist? */
export const isAdminEmail = (email?: string | null): boolean => {
  const value = normalizeEmail(email);
  return !!value && ADMIN_EMAILS.includes(value);
};

export type AdminIdentity = { email?: string | null; isAdmin?: boolean | null } | null | undefined;

/**
 * Sync admin check for anything that can be decided without Firestore.
 * `isAdmin` covers accounts granted admin straight onto their user doc.
 */
export const isAdminIdentity = (identity: AdminIdentity): boolean =>
  !!identity && (identity.isAdmin === true || isAdminEmail(identity.email));

/**
 * Fold founder/admin entitlements onto a profile.
 *
 * Additive only — we grant, never revoke — mirroring `withWebEntitlements`.
 * Applied once in AuthContext, which is the single funnel every gate reads
 * (`hasLinkupPro`, the free-limit counters, Campaigns, the paywall), so no
 * individual screen has to know the allowlist exists.
 */
export function withAdminEntitlements(profile: any, identity: AdminIdentity): any {
  const isAdmin = isAdminIdentity(identity) || profile?.isAdmin === true;
  if (!isAdmin) return profile;

  const base: any = profile || {};
  const status = String(base.subscriptionStatus || '').toLowerCase();
  const lapsed = ['inactive', 'canceled', 'cancelled', 'expired', 'free'].includes(status);

  return {
    ...base,
    isAdmin: true,
    isPro: true,
    plan: base.plan || 'plus',
    subscriptionPlan: base.subscriptionPlan || 'plus',
    // A founder with no purchase has no status at all; someone who bought and
    // then lapsed still counts as PLUS because the allowlist outranks billing.
    subscriptionStatus: lapsed || !status ? 'active' : base.subscriptionStatus,
    linkupPlus: 'paid',
    proUnlockedAt: base.proUnlockedAt || new Date().toISOString(),
    webCampaigns: true,
    entitlements: {
      ...(base.entitlements || {}),
      pro: true,
      linkupPro: true,
      linkupPlus: true,
      unlimitedSwipes: true,
      unlimitedIdeaSwipes: true,
      advancedSearch: true,
      aiSearch: true,
      savedSearchAlerts: true,
      profileViewers: true,
      unlimitedSavedProfiles: true,
    },
  };
}
