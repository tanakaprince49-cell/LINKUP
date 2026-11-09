import { webAppPath } from './webPaths';
import { Platform } from 'react-native';
import { auth } from './firebase';
import { linkupWebBaseUrl } from './profileLinks';

export type TeamMatchQuota = {
  period: 'day';
  periodKey: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  resetAt: string;
  exhausted: boolean;
  upgradeRequired: boolean;
  unlimited?: boolean;
};

export class LinkyApiError extends Error {
  status: number;
  messageQuota?: TeamMatchQuota;
  constructor(message: string, status: number, messageQuota?: TeamMatchQuota) {
    super(message);
    this.name = 'LinkyApiError';
    this.status = status;
    this.messageQuota = messageQuota;
  }
}

export type TeamMatchMember = {
  uid: string;
  name: string;
  image: string;
  title: string;
  company: string;
  city: string;
  verified?: boolean;
  recommendedRole: string;
  why: string;
  evidence: { requirement: string; field: string; value: string }[];
  unknowns: string[];
  score: number;
};
export type TeamMatchTeam = { id: string; score: number; members: TeamMatchMember[] };
export type TeamMatchResult = {
  mode: 'find' | 'assign';
  idea: string;
  ownerRole: string;
  ownerName: string;
  roles: string[];
  teams: TeamMatchTeam[];
  checked: number;
  usedAi: boolean;
  message: string;
  messageQuota?: TeamMatchQuota;
  upgradeRequired?: boolean;
};

export type LinkyChatTurn = { role: 'user' | 'linky'; text: string; at?: number };
export type LinkyChatResult = {
  action: 'search' | 'chat';
  reply: string;
  idea: string;
  ownerRole: string;
  ownerName?: string;
  roles: string[];
  teams: TeamMatchTeam[];
  checked: number;
  noMatchReason: string;
  suggestions: string[];
  thread: LinkyChatTurn[];
  cleared?: boolean;
  askedForBrief?: boolean;
  usedAi?: boolean;
  messageQuota?: TeamMatchQuota;
  upgradeRequired?: boolean;
};

export type LinkyAction = 'teamMatch' | 'chat' | 'writeProfile' | 'assessProfile' | 'pushNotify' | 'clientError' | 'webPushKey' | 'webPushSubscribe' | 'builder';

const endpoint = () => Platform.OS === 'web'
  ? webAppPath('/api/linky')
  : `${linkupWebBaseUrl()}/api/linky`;

export type LinkyProfileDraft = {
  headline: string;
  bio: string;
  skills: string[];
  lookingFor: string[];
};

export type LinkyProfileAssessment = {
  verdict: 'strong' | 'patchy' | 'thin';
  score: number;
  strengths: string[];
  gaps: string[];
  recommendation: string;
};

export type LinkyProfileWriteResult = {
  ok: boolean;
  reason: string;
  saved?: boolean;
  draft?: LinkyProfileDraft | null;
  assessment?: LinkyProfileAssessment | null;
  source?: string;
};

export type LinkyProfileAssessResult = {
  ok: boolean;
  assessment: LinkyProfileAssessment;
  building?: string;
  seat?: string;
};

/**
 * LINKUP PLUS: Linky reads the member's profile before writing a word of it.
 *
 * Cheap and deterministic on the server — no model call — so the member hears
 * the honest verdict first: a strong profile is told it is strong, a weak one
 * hears its gaps named. Only after that does anyone ask permission to write.
 * A 402 here means they are not PLUS, and the caller should open the paywall.
 */
export const assessMyProfileWithLinky = () =>
  linkyCall<LinkyProfileAssessResult>('assessProfile', {});

/**
 * LINKUP PLUS: Linky writes the member's profile.
 *
 * Called twice, deliberately. Once with no draft to generate, then again with the
 * draft the member actually approved — so what gets saved is the words they read
 * on screen, not a second generation they never saw. A 402 here means they are
 * not PLUS, and the caller should open the paywall instead of a generic error.
 *
 * `allowRewrite` is the member's explicit "rewrite it anyway" after Linky said
 * the profile already reads well. Without it the server answers already_good.
 */
export const writeMyProfileWithLinky = (options: { save?: boolean; draft?: LinkyProfileDraft | null; allowRewrite?: boolean } = {}) =>
  linkyCall<LinkyProfileWriteResult>('writeProfile', {
    save: options.save === true,
    ...(options.draft ? { draft: options.draft } : {}),
    ...(options.allowRewrite ? { allowRewrite: true } : {}),
  });

export async function linkyCall<T = any>(action: LinkyAction, payload: Record<string, unknown> = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new LinkyApiError(action === 'teamMatch' ? 'Sign in to use team matching.' : 'Sign in to your LINKUP account.', 401);
  const token = await user.getIdToken();
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new LinkyApiError(String(data?.error || `Team matching is unavailable (${response.status}).`), response.status, data?.messageQuota);
  }
  return data as T;
}

/**
 * The Linky surface is one conversation. Every call is one message: Linky
 * replies, and when the message is asking for people Linky searches the live
 * public member database in the same turn and returns the evidence-backed team.
 */
export const linkyTeamChat = (input: {
  message?: string;
  history?: LinkyChatTurn[];
  search?: boolean;
  mode?: 'find' | 'assign';
  idea?: string;
  ownRole?: string;
  roles?: string[];
  memberUids?: string[];
  teamSize?: 2 | 3;
  clear?: boolean;
}) => linkyCall<LinkyChatResult>('chat', input as unknown as Record<string, unknown>);

export const linkyTeamMatch = (input: {
  mode?: 'find' | 'assign';
  idea: string;
  ownRole?: string;
  roles?: string[];
  memberUids?: string[];
  teamSize?: 2 | 3;
}) => linkyCall<TeamMatchResult>('teamMatch', input as unknown as Record<string, unknown>);


/** PLUS only: Linky rewrites the whole profile from what LINKUP already knows. */
export type WrittenProfile = {
  status: 'ready' | 'needs_more';
  source: 'ai' | 'local';
  fields: Record<string, any>;
  evidence: { field: string; from: string }[];
  missing: string[];
  headline: string;
  message: string;
};

export const linkyWriteProfile = () => linkyCall<WrittenProfile>('writeProfile', {});
