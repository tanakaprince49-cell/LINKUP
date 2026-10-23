export const CONTRIBUTION_POINTS: number;
export const CONTRIBUTION_HISTORY_DAYS: number;
export const contributionDay: (now: number) => string;
export const normalizeUpdate: (text: unknown) => string;
export const containsCredential: (text: unknown) => boolean;
export const contributionInsight: (text: string) => string;
export type ContributionCell = {day: string; active: boolean; today: boolean; future: boolean};
export function calendarWeeks(days: string[], now?: number, count?: number): ContributionCell[][];
