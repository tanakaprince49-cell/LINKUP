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

export type LinkyAction = 'teamMatch' | 'pushNotify' | 'clientError' | 'webPushKey' | 'webPushSubscribe' | 'builder';

const endpoint = () => Platform.OS === 'web'
  ? webAppPath('/api/linky')
  : `${linkupWebBaseUrl()}/api/linky`;

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

export const linkyTeamMatch = (input: {
  mode?: 'find' | 'assign';
  idea: string;
  ownRole?: string;
  roles?: string[];
  memberUids?: string[];
  teamSize?: 2 | 3;
}) => linkyCall<TeamMatchResult>('teamMatch', input as unknown as Record<string, unknown>);
