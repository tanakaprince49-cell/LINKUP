export interface DemandSignal {
  searching: number;
  matchedOnPaper: number;
  topNeed: string;
  poolSize: number;
}
export declare function demandSignal(
  me: Record<string, any> | null | undefined,
  people: Array<Record<string, any>> | null | undefined,
  options?: { minimumPool?: number }
): DemandSignal | null;
