// Client for /api/linky (ask -> immediate cited answer, intro cards, double
// opt-in intros, audit, editable facts, bot linking). Server-side only writes:
// the app never touches the introSuggestions / intros collections directly.
import { Platform } from 'react-native';
import { auth } from './firebase';
import { linkupWebBaseUrl } from './profileLinks';

export type IntentOffer = 'paid' | 'equity' | 'advisory' | 'coffee';

export type LinkyCard = {
  id: string;
  askId: string;
  need: string;
  targetUid: string;
  targetName: string;
  targetPic: string;
  targetRole: string;
  targetCompany: string;
  targetCity: string;
  targetSkills: string[];
  why: string;
  opener: string;
  score: number;
  status: 'new' | 'saved' | 'skip' | 'meet' | 'declined';
  introId?: string;
  createdAt: number;
  updatedAt?: number;
};

export type LinkyIntro = {
  id: string;
  requesterId: string;
  targetId: string;
  requesterName: string;
  requesterPic: string;
  requesterRole: string;
  requesterCity: string;
  targetName: string;
  targetPic: string;
  need: string;
  why: string;
  opener: string;
  status: 'pending' | 'accepted' | 'declined' | 'snoozed' | 'expired';
  matchId: string;
  createdAt: number;
};

export type LinkyNearest = { uid: string; name: string; pic: string; role: string; city: string };

export type LinkyAsk = {
  id: string;
  need: string;
  reply: string;
  cardIds: string[];
  none: boolean;
  nearest: LinkyNearest[];
  checked: number;
  expansion: 'none' | 'local' | 'ai';
  kind?: 'chat' | 'coach' | 'name' | 'people' | 'none';
  createdAt: number;
};
export type LinkyScoutPerson = { name: string; headline: string; url: string; snippet: string; matched: string[]; opener: string };
export type LinkyScout = { configured: boolean; people: LinkyScoutPerson[]; query: string; cached: boolean; usedAi?: boolean; raw?: number; filtered?: number; reply: string; budget?: string | { monthUsed: number; cap: number } };

export type LinkyAskResult = LinkyAsk & { cards: LinkyCard[]; cached: boolean; usedAi?: boolean; asksLeft: number };

export type LinkyToldFacts = { notes: string; skills: string[]; lookingFor: string[]; updatedAt: number | null };

export type LinkyHome = {
  name: string;
  plus: boolean;
  limits: { meetsPerDay: number | null; meetsUsedToday: number; asksPerDay: number; asksUsedToday: number };
  cards: LinkyCard[];
  inbound: LinkyIntro[];
  sent: LinkyIntro[];
  prefs: { openTo: IntentOffer[]; inboundCap: number };
  channels: { telegram: boolean; whatsapp: boolean };
  lastAsk: LinkyAsk | null;
  facts: LinkyToldFacts;
  brief: string;
};

export type LinkyAudit = {
  facts: Record<string, any>;
  told: LinkyToldFacts;
  signals: Record<string, any>;
  asks: Array<{ id: string; need: string; cards: number; none: boolean; source: string; createdAt: number }>;
  cards: Array<{ id: string; targetName: string; why: string; status: string; createdAt: number }>;
  introsSent: LinkyIntro[];
  introsReceived: LinkyIntro[];
  sources: string[];
  notUsed: string[];
};

export class LinkyApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const endpoint = () => (Platform.OS === 'web' ? '/api/linky' : `${linkupWebBaseUrl()}/api/linky`);

export async function linkyCall<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new LinkyApiError('Sign in to talk to Linky.', 401);
  const token = await user.getIdToken();
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new LinkyApiError(String(data?.error || `Linky is unavailable (${res.status}).`), res.status);
  return data as T;
}

export const linkyHome = () => linkyCall<LinkyHome>('home');
export const linkyAsk = (message: string) => linkyCall<LinkyAskResult>('ask', { message });
export const linkyMeet = (cardId: string) => linkyCall<{ introId?: string; matchId?: string; pending?: boolean; opener?: string; meetsLeft?: number | null; alreadyRequested?: boolean }>('meet', { cardId });
export const linkyCard = (cardId: string, status: 'skip' | 'saved') => linkyCall<LinkyCard>('card', { cardId, status });
export const linkyRespond = (introId: string, decision: 'accept' | 'decline' | 'later') => linkyCall<{ status: string; matchId?: string }>('respond', { introId, decision });
export const linkyPrefs = (prefs: { openTo?: IntentOffer[]; inboundCap?: number }) => linkyCall<{ ok: boolean }>('prefs', prefs);
export const linkyPointers = (need: string) => linkyCall<{ text: string; cached: boolean }>('pointers', { need });
export const linkyScout = (need: string) => linkyCall<LinkyScout>('scout', { need });
export const linkyFacts = (facts: { notes: string; skills: string[]; lookingFor: string[] }) => linkyCall<{ ok: boolean; facts: LinkyToldFacts }>('facts', facts);
export const linkyAudit = () => linkyCall<LinkyAudit>('audit');
export const linkyForget = () => linkyCall<{ ok: boolean }>('forget');
export const linkyLinkCode = () => linkyCall<{ code: string; expiresInMinutes: number }>('linkCode');
export const linkyUnlinkChannel = (channel: 'telegram' | 'whatsapp') => linkyCall<{ ok: boolean }>('unlinkChannel', { channel });

export const OFFER_LABELS: Record<IntentOffer, string> = {
  paid: 'Paid work',
  equity: 'Equity',
  advisory: 'Advisory',
  coffee: 'Coffee',
};
