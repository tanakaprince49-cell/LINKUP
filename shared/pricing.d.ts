export declare const CURRENCY: string;
export declare const PLUS_PRICES: { monthly: number; yearly: number };
export declare const CAMPAIGNS_PRICES: { monthly: number; yearly: number };
export declare const TIERS: { PLUS: string; CAMPAIGNS: string };
export declare const WEB_TERMS: Record<
  string,
  { label: string; amount: number; months: number; tier: string }
>;
export declare function formatUsd(amount: number): string;
