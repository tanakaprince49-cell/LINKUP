// Exclusive identity badge. Never infer this entitlement from a display name,
// email, PLUS subscription or a client-editable gold/isCEO flag.
export const GOLD_MEMBER_UID = 'FvxIfciyHMfQZbLwziZpseMNKxC3';
export const GOLD_MEMBER_LABEL = 'GOLD member CEO';
export function isGoldMember(uid) {
  return typeof uid === 'string' && uid === GOLD_MEMBER_UID;
}
