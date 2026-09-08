// Client for /api/linky (intents, intro cards, double opt-in intros, brief,
// audit, bot linking). Server-side only writes: the app never touches the
// intents / introSuggestions / intros collections directly.
import { Platform } from 'react-native';
import { auth } from './firebase';
import { linkupWebBaseUrl } from './profileLinks';

export type IntentOffer = 'paid' | 'equity' | 'advisory' | 'coffee';
export type IntentUrgency = 'this_week' | 'this_month' | 'whenever';

export type LinkyIntent = {
  id: string;
  need: string;
  constraints: string[];
  offer: IntentOffer;
  location: string;
  remote: boolean;
  urgency: IntentUrgency;
  status: 'active' | 'closed' | 'expired';
  source: string;
  matchCount: number;
  createdAt: number;
  expiresAt: number;
  lastMatchedAt: number | null;
};

export type LinkyCard = {
  id: string;
  intentId: string;
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

export type LinkyHome = {
  name: string;
  plus: boolean;
  limits: { activeIntents: number; meetsPerDay: number | null; meetsUsedToday: number };
  intents: LinkyIntent[];
  cards: LinkyCard[];
  inbound: LinkyIntro[];
  sent: LinkyIntro[];
  prefs: { openTo: IntentOffer[]; inboundCap: number };
  channels: { telegram: boolean; whatsapp: boolean };
  intake: { history: Array<{ role: 'user' | 'assistant'; content: string }>; draft: Partial<LinkyIntent> | null } | null;
  brief: string;
};

export type IntakeResult = { reply: string; ready: boolean; intent?: Partial<LinkyIntent> | null };

export type LinkyAudit = {
  facts: Record<string, any>;
  signals: Record<string, any>;
  intents: LinkyIntent[];
  cards: Array<{ id: string; targetName: string; why: string; status: string; createdAt: number }>;
  introsSent: LinkyIntro[];
  introsReceived: LinkyIntro[];
  intakeTurns: number;
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
export const linkyIntake = (message: string) => linkyCall<IntakeResult>('intake', { message });
export const linkyIntakeReset = () => linkyCall<{ ok: boolean }>('intakeReset');
export const linkySaveIntent = (intent: Partial<LinkyIntent>) => linkyCall<{ intent: LinkyIntent; cards: LinkyCard[] }>('saveIntent', { intent });
export const linkyCloseIntent = (intentId: string) => linkyCall<{ ok: boolean }>('closeIntent', { intentId });
export const linkyMeet = (cardId: string) => linkyCall<{ introId?: string; matchId?: string; pending?: boolean; opener?: string; meetsLeft?: number | null; alreadyRequested?: boolean }>('meet', { cardId });
export const linkyCard = (cardId: string, status: 'skip' | 'saved') => linkyCall<LinkyCard>('card', { cardId, status });
export const linkyRespond = (introId: string, decision: 'accept' | 'decline' | 'later') => linkyCall<{ status: string; matchId?: string }>('respond', { introId, decision });
export const linkyPrefs = (prefs: { openTo?: IntentOffer[]; inboundCap?: number }) => linkyCall<{ ok: boolean }>('prefs', prefs);
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
export const URGENCY_LABELS: Record<IntentUrgency, string> = {
  this_week: 'This week',
  this_month: 'This month',
  whenever: 'Whenever',
};
