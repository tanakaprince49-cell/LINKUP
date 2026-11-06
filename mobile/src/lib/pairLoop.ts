import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  composeCard,
  computeVitals,
  nextPairAction,
  scorePair,
  vitalityState,
  type Vitals,
} from '../../../shared/linkup-match';
import { UserProfile } from '../types';
import { localCommonalityRank } from './matchmaking';

/**
 * The pair loop: what LINKUP should suggest next inside an existing
 * introduction (docs/LINKUP_ALGORITHM_DESIGN.md §21, §23).
 *
 * Two rules this file obeys:
 *   1. Nothing here reads message text. Vitals are computed from counts,
 *      timings and lengths, on the device, and are never uploaded.
 *   2. One nudge per state, ever. The suggestion is offered, never sent.
 */

export type PairMove = {
  pairId: string;
  state: string;
  action: string;
  statusId: string;
  statusLabel: string;
  suggestion: string;
  opener: string;
  tinyTask: string;
  tempoNote: string | null;
  band: string;
  vitals: Vitals;
};

const hour = 3600000;

const toMillis = (value: any): number => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const pairId = (a: string, b: string) => [a, b].filter(Boolean).sort().join('__');

const hasQuestion = (text: unknown) => typeof text === 'string' && text.includes('?');

/**
 * Message metadata only: who, when, how long, did it ask something.
 * The text itself is read for the `?` and the length, then dropped.
 */
export const messageMetadata = (messages: any[] = [], now = Date.now()) =>
  messages
    .map((message) => ({
      from: String(message?.senderId || message?.from || ''),
      at: toMillis(message?.createdAt ?? message?.at) || now,
      length: typeof message?.text === 'string' ? message.text.length : 0,
      hasQuestion: hasQuestion(message?.text),
    }))
    .filter((message) => !!message.from);

/**
 * Which state the introduction is in, from metadata alone.
 * Deliberately conservative: we only claim `sparked` when both people answered.
 */
export const inferPairState = (metadata: ReturnType<typeof messageMetadata>, myUid: string) => {
  if (!metadata.length) return { state: 'mutual_yes', greetedAt: null as number | null, lastMessageAt: null as number | null };

  const mine = metadata.filter((message) => message.from === myUid).length;
  const theirs = metadata.length - mine;
  const lastMessageAt = Math.max(...metadata.map((message) => message.at));
  const greetedAt = Math.min(...metadata.map((message) => message.at));

  if (mine > 0 && theirs > 0) {
    if (mine >= 2 && theirs >= 2) return { state: 'sparked', greetedAt, lastMessageAt };
    return { state: 'greeted', greetedAt, lastMessageAt };
  }
  return { state: 'greeted', greetedAt, lastMessageAt };
};

const nudgedKey = (id: string) => `linkup:pair-nudge:${id}`;
const dismissedKey = (id: string) => `linkup:pair-move-dismissed:${id}`;

const readNudged = async (id: string): Promise<string[]> => {
  try {
    const raw = await AsyncStorage.getItem(nudgedKey(id));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const rememberNudge = async (id: string, action: string) => {
  try {
    const nudged = await readNudged(id);
    if (!nudged.includes(action)) nudged.push(action);
    await AsyncStorage.setItem(nudgedKey(id), JSON.stringify(nudged.slice(-8)));
  } catch {
    /* a failed write only costs a repeat suggestion */
  }
};

/** A member can put the strip away for a day without any penalty. */
export const dismissPairMove = async (id: string) => {
  try {
    await AsyncStorage.setItem(dismissedKey(id), String(Date.now()));
  } catch {
    /* no-op */
  }
};

export const isPairMoveDismissed = async (id: string) => {
  try {
    const raw = await AsyncStorage.getItem(dismissedKey(id));
    if (!raw) return false;
    return Date.now() - Number(raw) < 24 * hour;
  } catch {
    return false;
  }
};

/**
 * The next move for one introduction, end to end. Deterministic, offline, and
 * safe to call on every render of a thread.
 */
export const pairNextMove = (args: {
  me: UserProfile | null | undefined;
  other: UserProfile | null | undefined;
  messages: any[];
  nudged?: string[];
  now?: number;
}): PairMove | null => {
  const { me, other, messages } = args;
  const now = args.now ?? Date.now();
  if (!me?.uid || !other?.uid) return null;

  const id = pairId(me.uid, other.uid);
  const metadata = messageMetadata(messages, now);
  const vitals = computeVitals(metadata, now);
  const status = vitalityState(vitals);
  const { state, greetedAt, lastMessageAt } = inferPairState(metadata, me.uid);

  const action = nextPairAction(
    { state, greetedAt: greetedAt ?? undefined, lastMessageAt: lastMessageAt ?? undefined, nudged: args.nudged || [] },
    now
  );

  // The card carries the two reasons and the smallest thing worth making.
  let opener = '';
  let tinyTask = '';
  let tempoNote: string | null = null;
  let band = '';
  try {
    const score = scorePair(me as any, other as any);
    const card = composeCard(score);
    opener = card.opener;
    tinyTask = card.tiny_task;
    tempoNote = card.tempo_note;
    band = score.band.label;
  } catch {
    const fallback = localCommonalityRank(me, [other], 1)[0];
    tinyTask = fallback?.tinyTask || '';
    opener = fallback?.opener || '';
    band = fallback?.band?.label || '';
  }

  return {
    pairId: id,
    state: action.state,
    action: action.action,
    statusId: status.id,
    statusLabel: status.label,
    suggestion: action.copy,
    opener,
    tinyTask,
    tempoNote,
    band,
    vitals,
  };
};

/** Actions worth surfacing in the thread. `wait` and `nothing` are not. */
export const isActionableMove = (move: PairMove | null) =>
  !!move && !['wait', 'nothing', 'stay_parked'].includes(move.action);
