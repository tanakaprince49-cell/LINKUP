export type PlusBenefitGroupId = 'see' | 'do' | 'look';

export type PlusBenefitCopy = { feature: string; line: string };

export type PlusBenefit = {
  id: string;
  group: PlusBenefitGroupId;
  /** The claim, short enough to read mid-scroll. */
  title: string;
  /** The number or surface it changes. Never an adjective. */
  proof: string;
  /** One benefit, written to the member, for the three-a-day invitation. */
  invite: PlusBenefitCopy;
  /** The same, for the block at the bottom of an email. */
  email: PlusBenefitCopy;
};

export declare const PLUS_BENEFIT_GROUPS: Record<PlusBenefitGroupId, string>;
export declare const PLUS_BENEFITS: readonly PlusBenefit[];
export declare const PLUS_BENEFIT_COUNT: number;
export declare const PLUS_MORE_COUNT: number;
export declare function plusBenefitGroups(): Array<{ id: PlusBenefitGroupId; label: string; items: PlusBenefit[] }>;
export declare function plusBenefitById(id: string): PlusBenefit | null;

/** The paywall header, built from the member's own onboarding answers. */
export type PlusPitch = {
  name: string;
  headline: string;
  setup: string;
  stake: string;
  matches: number;
  personalised: boolean;
};

export declare function plusPitch(profile?: Record<string, unknown>): PlusPitch;
