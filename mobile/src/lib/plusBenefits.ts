/**
 * The PLUS benefit list, typed for the app.
 *
 * The answers live in shared/plus-benefits.js so the paywall, the three-a-day
 * invitation and the email nudge cannot drift apart. This file only re-exports,
 * so a surface never re-types a claim of its own.
 */
export {
  PLUS_BENEFIT_GROUPS,
  PLUS_BENEFITS,
  PLUS_BENEFIT_COUNT,
  PLUS_MORE_COUNT,
  plusBenefitGroups,
  plusBenefitById,
} from '../../../shared/plus-benefits';
export type { PlusBenefit, PlusBenefitGroupId, PlusBenefitCopy } from '../../../shared/plus-benefits';
