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
  /** What the answer was, so the UI can dress it: search, a name, chit-chat. */
  kind?: 'found' | 'close' | 'none' | 'person' | 'ambiguous' | 'chat' | 'draft';
  cardIds: string[];
  none: boolean;
  nearest: LinkyNearest[];
  checked: number;
  expansion: 'none' | 'local' | 'ai';
  createdAt: number;
};

/** One message in the Linky thread - both directions. */
export type LinkyTurn = {
  id: string;
  role: 'user' | 'linky';
  text: string;
  kind?: string;
  cardIds?: string[];
  at: number;
};

/** Anything the member can tap instead of typing. */
export type LinkySuggestion = string;

export type LinkyLead = {
  name: string;
  title?: string;
  url: string;
  why?: string;
  fit?: number;
  resolved?: boolean;
};

export type LinkyAskResult = LinkyAsk & {
  cards: LinkyCard[];
  cached: boolean;
  usedAi?: boolean;
  asksLeft: number;
  /** Free / instant: a name lookup, chit-chat, a drafted message. */
  free?: boolean;
  /** Quick replies to render as chips under Linky's bubble. */
  suggest?: LinkySuggestion[];
  /** Newest whole thread, so the app can swap in one round trip. */
  thread?: LinkyTurn[];
  /** Set when the member asked for somebody they are already connected to. */
  matchId?: string;
  blocked?: string;
};

export type LinkyToldFacts = { notes: string; skills: string[]; lookingFor: string[]; hidden?: LinkyHidden; updatedAt: number | null };
/** What the member told Linky NOT to use. Hiding never edits their LINKUP profile. */
export type LinkyHidden = {
  skills: string[];
  industries: string[];
  lookingFor: string[];
  notes?: boolean;
  bio?: boolean;
  company?: boolean;
  city?: boolean;
};

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
  thread?: LinkyTurn[];
  facts: LinkyToldFacts;
  brief: string;
};

export type LinkyAudit = {
  facts: Record<string, any>;
  told: LinkyToldFacts;
  hidden?: LinkyHidden;
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
export const linkyPointers = (need: string) => linkyCall<{ text: string; cached: boolean; leads?: LinkyLead[]; searches?: number; note?: string }>('pointers', { need });
/** "Which Fred?" -> "the first one". Turns a picked member into a real card. */
export const linkyPickPerson = (targetUid: string) => linkyCall<LinkyCard>('pickPerson', { targetUid });
export const linkyFacts = (facts: { notes: string; skills: string[]; lookingFor: string[]; hidden?: LinkyHidden }) =>
  linkyCall<{ ok: boolean; facts: LinkyToldFacts }>('facts', facts);
/** One fact at a time: hide it from Linky (their profile keeps it) or give it back. */
export const linkyHideFact = (kind: string, value: string, hide: boolean) =>
  linkyCall<{ ok: boolean; hidden: LinkyHidden }>('hideFact', { kind, value, hide });
/** "and forget that I ever asked" */
export const linkyRemoveAsk = (id: string) => linkyCall<{ ok: boolean; forgotten: number }>('removeAsk', { id });
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
