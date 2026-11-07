/**
 * Types for shared/linkup-match.js — the LINKUP matching engine.
 * Keep this file in sync with the JS implementation; the app imports the JS.
 */

export declare const MODEL_VERSION: string;

export declare const ARCHETYPES: string[];
export declare const ARCHETYPE_PRIOR: Record<string, Record<string, number>>;
export declare const FUNCTION_SKILLS: Set<string>;
export declare const DOMAIN_SKILLS: Set<string>;
export declare const NEED_SATISFIED_BY: Record<string, string[]>;

export declare const FIT_WEIGHTS: Record<string, number>;
export declare const CHEM_WEIGHTS: Record<string, number>;
export declare const UTILITY_WEIGHTS: { fit: number; spark: number; artifact: number };
export declare const DISPLAY_CALIBRATION: { scale: number; shift: number };
export declare const BANDS: Array<{ id: string; min: number; label: string; line: string }>;
export declare const BANNED_COPY: string[];
export declare const WORK_STYLE_MAX_POSITION_SHIFT: number;
export declare const WORK_STYLE_CARD_INTRO: string;
export declare const PAIR_STATES: string[];

export declare const WORK_STYLE_QUESTIONS: Array<{
  id: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
}>;

export interface Corpus {
  n: number;
  df: Map<string, number>;
  idf(token: string): number;
}

export interface VoltageToken {
  token: string;
  weight: number;
}

export interface Facets {
  uid: string;
  displayName: string;
  archetype: string | null;
  occupation: string;
  company: string;
  city: string;
  country: string;
  timezoneOffset: number | null;
  remoteOnly: boolean;
  willingToRelocate: boolean;
  functionSkills: string[];
  domains: string[];
  offers: string[];
  needs: string[];
  voltageTokens: VoltageToken[];
  voltageSet: Set<string>;
  capacityRank: number | null;
  asyncTolerant: boolean;
  workStyle: string;
  roleAnswers: string[];
  stage: string;
  fundingStage: string;
  teamSize: string;
  personalityType: string;
  scale: string | null;
  riskRank: number | null;
  cadenceHours?: number;
  followThrough?: number;
  runwayMonths?: number;
  monthsToRevenue?: number;
  redLines?: string[];
  audience?: string[];
  qualityBar?: number;
  workStyleCard?: WorkStyleAxes;
  execution: {
    streak: number;
    shipped: number;
    shipLogs: number;
    hasExit: boolean;
    verified: boolean;
    lastShippedDays: number | null;
    lastActiveDays: number | null;
    createdAtDays: number | null;
    responseRate: number;
    reliability: number;
    evidence?: { activity: boolean; shipping: boolean; trust: boolean };
  };
  learnFor: { lookingFor: string[]; networkingIntent: string };
}

export interface WorkStyleAxes {
  feedbackStyle: string | null;
  repair: string | null;
  roleFlex: number | null;
  capacityRank: number | null;
  scale: string | null;
  redLine: string | null;
}

export interface Vitals {
  turnBalance: number;
  questionDensity: number;
  latencyFit: number | null;
  momentum: number;
  followThrough: number | null;
  vitality: number;
  asOf: number;
  empty: boolean;
}

export interface LedgerAtom {
  id: string;
  type: string;
  value: string | number;
  weight: number;
  kind?: 'shared' | 'complement' | 'difference';
  aOffers?: string[];
  bOffers?: string[];
  repair?: string;
}

export interface PairScore {
  uid: string;
  viewerUid: string;
  modelVersion: string;
  fit: number;
  fitAB: number;
  fitBA: number;
  direction: { ab: number; ba: number };
  chem: number;
  spark: number;
  artifact: number;
  utility: number;
  display: number;
  axes: Record<string, number | null>;
  killers: Array<{ id: string; penalty: number; repair: string }>;
  bridge: number;
  veto: string | null;
  gated: boolean;
  band: { id: string; min: number; label: string; line: string };
  slot: 'mirror' | 'complement' | 'wildcard' | null;
  features: Record<string, number | null>;
  penalties: { trust: number | null; fatigue: number };
  facetsA: Facets;
  facetsB: Facets;
  ledger: LedgerAtom[];
  recentlyContacted?: boolean;
}

export interface MatchCard {
  slot: 'mirror' | 'complement' | 'wildcard';
  headline: string;
  why: { shared: string; complement: string };
  opener: string;
  tiny_task: string;
  agenda: string[];
  tempo_note: string | null;
  repair: string | null;
  cites: string[];
  tone: string;
}

export interface ScoreContext {
  corpus?: Corpus;
  now?: number;
  vitals?: Vitals | null;
  mutualConnections?: number;
  impressionsIgnored?: number;
  contactedAt?: number | { toMillis?: () => number };
  ghostRisk?: number;
  feedback?: { status?: 'relevant' | 'not_relevant' | 'contacted' } | null;
}

export declare function buildCorpus(profiles: Array<Record<string, any>>, options?: { now?: number }): Corpus;
export declare function deriveFacets(profile: Record<string, any>, options?: { now?: number }): Facets;
export declare function selectRecallCandidates(viewer: Record<string, any>, candidates: Array<Record<string, any>>, options?: { limit?: number; now?: number }): Array<Record<string, any>>;

export declare function eligibility(
  viewer: Record<string, any>,
  candidate: Record<string, any>,
  options?: { contactedWithinDays?: number; now?: number; contactedAt?: number }
): { eligible: boolean; reason: string; demote?: boolean };

export declare function featureFamilies(a: Facets, b: Facets, context?: ScoreContext): {
  families: Record<string, number | null>;
  penalties: { trust: number | null; fatigue: number };
  directional: { intentAB: number | null; intentBA: number | null };
  extras: { domainOverlap: number | null; functionGap: number | null };
};

export declare function fitProbability(
  features: ReturnType<typeof featureFamilies>,
  side?: 'ab' | 'ba'
): number;

export declare function voltageScore(a: Facets, b: Facets, corpus?: Corpus): number | null;
export declare function shapeScore(a: Facets, b: Facets, corpus?: Corpus): number;
export declare function rhythmScore(a: Facets, b: Facets): number;
export declare function safetyScore(a: Facets, b: Facets): number | null;
export declare function ambitionSymmetry(a: Facets, b: Facets): number | null;
export declare function valuesAdjacency(a: Facets, b: Facets): number | null;
export declare function effortSymmetry(vitals?: Vitals | null): number | null;

export declare function detectKillers(
  a: Facets,
  b: Facets,
  axes: Record<string, number | null>
): Array<{ id: string; penalty: number; repair: string }>;

export declare function bridgingBonus(
  a: Facets,
  b: Facets,
  corpus?: Corpus,
  mutualConnections?: number | null
): number;

export declare function chemistryPair(
  a: Facets,
  b: Facets,
  context?: ScoreContext
): {
  veto: string | null;
  axes: Record<string, number | null>;
  killers: Array<{ id: string; penalty: number; repair: string }>;
  bridge: number;
  chem: number;
  spark: number;
  artifact: number;
  vitality: number | null;
};

export declare function reciprocityGuard(fitAB: number, fitBA: number): number;
export declare function calibrateDisplay(probability: number): number;
export declare function bandOf(probability: number): { id: string; min: number; label: string; line: string };
export declare function harmonic(a: number, b: number): number;
export declare function saturate(count: number, k?: number): number;
export declare function decay(days: number, halfLifeDays?: number): number;

export declare function scorePair(
  a: Record<string, any>,
  b: Record<string, any>,
  context?: ScoreContext
): PairScore;

export declare function buildLedger(
  a: Facets,
  b: Facets,
  features: ReturnType<typeof featureFamilies>,
  chemistry: ReturnType<typeof chemistryPair>,
  corpus?: Corpus
): LedgerAtom[];

export declare function slotFor(score: PairScore): 'mirror' | 'complement' | 'wildcard';
export declare function composeCard(score: PairScore, options?: { slot?: string }): MatchCard;
export declare function assertCopyClean(text: string): { clean: boolean; token: string | null };

export declare function mmr(scored: PairScore[], options?: { k?: number; lambda?: number }): PairScore[];
export declare function composePortfolio(
  scored: PairScore[],
  options?: { k?: number; poolSize?: number }
): Array<PairScore & { slot: 'mirror' | 'complement' | 'wildcard' }>;

export declare function stableAllocation<T extends { viewer: string; candidate: string; score: number }>(
  edges: T[],
  options?: { capacity?: number }
): T[];

export declare function rankPool(
  viewer: Record<string, any>,
  candidates: Array<Record<string, any>>,
  options?: {
    now?: number;
    corpus?: Corpus;
    limit?: number;
    lambda?: number;
    contactedWithinDays?: number;
    contactedAt?: Record<string, number>;
    mutualConnections?: Record<string, number>;
    impressionsIgnored?: Record<string, number>;
    vitals?: Record<string, Vitals>;
    ghostRisk?: Record<string, number>;
    feedback?: Record<string, { status: 'relevant' | 'not_relevant' | 'contacted'; at?: number }>;
  }
): {
  modelVersion: string;
  viewer: Facets;
  corpusSize: number;
  scored: PairScore[];
  ranked: PairScore[];
  poolSize: number;
};

export declare function nextPairAction(
  pair?: Record<string, any>,
  now?: number
): { state: string; action: string; dueAt: number | null; copy: string };

export declare function endingFor(
  pair?: Record<string, any>
): { id: string; copy: string } | null;

export declare function computeVitals(
  messages?: Array<{ from: string; at: number; length?: number; hasQuestion?: boolean }>,
  now?: number
): Vitals;

export declare function vitalityState(vitals?: Vitals | null): { id: string; label: string };

export declare function workStyleAxes(answers?: Record<string, string>): WorkStyleAxes;
export declare function applyWorkStyleShift(position: number, shift: number): number;

export declare const TIE_BREAK_BAND: number;

export declare function applyBandedOrder<T extends { uid: string; display?: number; utility?: number }>(
  rows: T[],
  order: string[],
  band?: number
): T[];

export declare function citesLedger(
  reason: string,
  atoms?: ReadonlyArray<{ value: string | number }>
): boolean;

export declare function parseModelAnswer(
  text: string,
  rows?: Array<{ uid: string; ledger?: LedgerAtom[] }>
): { order: string[]; reasons: Record<string, string> } | null;
export declare function tokenize(text: string): string[];
export declare function normalizeText(value: unknown): string;
