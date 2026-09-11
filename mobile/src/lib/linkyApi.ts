// Client for /api/linky (ask -> immediate cited answer, intro cards, double
// opt-in intros, audit, editable facts, bot linking). Server-side only writes:
// the app never touches the introSuggestions / intros collections directly.
import { Platform } from 'react-native';
import { auth } from './firebase';
import { linkupWebBaseUrl } from './profileLinks';

export type IntentOffer = 'paid' | 'equity' | 'advisory' | 'coffee';

/** Proof of work, straight off a real record. `checked` means LINKUP holds the
 *  thing itself (a published project, a handle on their profile, a verification
 *  stamp); otherwise it is their own words and `quote` is the sentence. */
export type LinkyBadge = {
  kind: string;
  label: string;
  url?: string;
  quote?: string;
  checked?: boolean;
  source?: string;
};

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
  badges?: LinkyBadge[];
  /** Turbo Connect: this member is on LINKUP PLUS and Linky boosted them */
  plus?: boolean;
  /** a card from a squad answer: which trio it belongs to and the part they play */
  squadId?: string;
  squadRole?: string;
  squadSize?: number;
  squadIndex?: number;
  /** what the member told Linky about the last time these two met */
  pairNote?: string;
  why: string;
  opener: string;
  score: number;
  status: 'new' | 'saved' | 'skip' | 'meet' | 'declined' | 'accepted';
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
  /** `check` = Linky asked before searching; answer it with yes / no. */
  kind?: 'found' | 'close' | 'none' | 'person' | 'ambiguous' | 'chat' | 'draft' | 'check' | 'squad';
  askingFirst?: boolean;
  /** What decided the turn - `ai:chat` (the model) or `words:chat` (offline lists). */
  intent?: string;
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
  /** proof of work from the public result: stars, users, a raise, an alum link */
  proof?: LinkyBadge[];
  url: string;
  why?: string;
  fit?: number;
  resolved?: boolean;
  /** who this person is to Linky: the same key across searches, so "not
      interested" can mean "never show me this human again". */
  key?: string;
};

/** A message Linky wrote that the member has not approved yet. */
export type LinkyDraft = {
  cardId?: string;
  targetUid?: string;
  targetName?: string;
  need?: string;
  pitch: string;
  opener?: string;
  usedAi?: boolean;
};

export type LinkyOutreachEntry = {
  kind: 'intro' | 'lead';
  key?: string;
  name?: string;
  need?: string;
  status: string;
  at: number;
  edited?: boolean;
  intentId?: string;
  targetUid?: string;
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
  /** "yes, look outside LINKUP" -> LinkedIn leads come back on the ask itself. */
  leads?: LinkyLead[];
  pointerIntro?: string;
  routes?: string[];
  searches?: number;
  skipped?: number;
  place?: string;
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

/** The 48-hour question Linky asks after an intro is accepted. */
export type LinkyLoopChoice = 'met' | 'touch' | 'quiet' | 'nope';
export type LinkyLoop = {
  introId: string;
  otherName: string;
  need: string;
  talked: boolean;
  at: number;
  question: string;
  choices: { key: LinkyLoopChoice; label: string }[];
};
export type LinkySquad = {
  id: string;
  size: number;
  members: { cardId: string; uid: string; name: string; role: string; part: string; status: string }[];
};
/** The one-pager Linky writes into a new chat, for the two people who said yes. */
export type LinkyBrief = {
  headline?: string;
  why: string[];
  icebreakers: string[];
  agenda: { span: string; title: string; ask: string }[];
  text?: string;
  usedAi?: boolean;
};

export type LinkyHome = {
  name: string;
  plus: boolean;
  limits: { meetsPerDay: number | null; meetsUsedToday: number; asksPerDay: number; asksUsedToday: number; asksResetAt?: string };
  cards: LinkyCard[];
  inbound: LinkyIntro[];
  sent: LinkyIntro[];
  prefs: { openTo: IntentOffer[]; inboundCap: number };
  channels: { telegram: boolean; whatsapp: boolean };
  lastAsk: LinkyAsk | null;
  thread?: LinkyTurn[];
  facts: LinkyToldFacts;
  brief: string;
  /** the open 48-hour question, if there is one */
  loop?: LinkyLoop | null;
  /** squad answers, grouped by the trio they belong to */
  squads?: LinkySquad[];
  /** who the member already wrote to, and who they said never mind about */
  outreach?: LinkyOutreachEntry[];
  pending?: { meet?: LinkyDraft | null; lead?: { key: string; lead: LinkyLead; text: string; need?: string } | null };
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
/** Stage 1: Linky drafts the intro. Nothing reaches the other person yet. */
export const linkyMeet = (cardId: string) => linkyCall<{
  introId?: string; matchId?: string; pending?: boolean; awaitingThem?: boolean; opener?: string;
  meetsLeft?: number | null; alreadyRequested?: boolean;
  needsApproval?: boolean; draftId?: string; pitch?: string; targetName?: string; note?: string;
  target?: { uid: string; name: string; role?: string; city?: string };
}>('meet', { cardId });

/** Stage 2: the member approves it - optionally in their own words - and it goes. */
export const linkyApproveMeet = (cardId: string, text?: string) => linkyCall<{
  introId?: string; matchId?: string; pending?: boolean; meetsLeft?: number | null; sent?: boolean; edited?: boolean;
}>('approveMeet', text ? { cardId, text } : { cardId });

export const linkyCancelMeet = (cardId: string) => linkyCall<{ cancelled: boolean; targetName?: string }>('cancelMeet', { cardId });
export const linkyCard = (cardId: string, status: 'skip' | 'saved') => linkyCall<LinkyCard>('card', { cardId, status });
export const linkyRespond = (introId: string, decision: 'accept' | 'decline' | 'later') => linkyCall<{ status: string; matchId?: string; brief?: LinkyBrief | null }>('respond', { introId, decision });

/** Answering Linky's "how did it go?" - one of the four, or in your own words. */
export const linkyLoopAnswer = (choice: LinkyLoopChoice | '', words?: string) => linkyCall<{
  ok: boolean; answered: boolean; choice?: string; label?: string; note: string; otherName?: string;
}>('loop', words ? { choice, words } : { choice });

/** One approval, one message each, still double opt-in per person. */
export const linkyMeetSquad = (squadId: string) => linkyCall<{
  needsApproval?: boolean; squadId: string; pitch: string; members: { name: string; uid: string }[];
  meetsLeft?: number | null; note?: string;
}>('meetSquad', { squadId });
export const linkyApproveSquad = (squadId: string, text?: string) => linkyCall<{
  ok: boolean; sent: number; names: string[]; waiting: string[]; note: string;
}>('approveSquad', text ? { squadId, text } : { squadId });
export const linkyCancelSquad = (squadId: string) => linkyCall<{ ok: boolean; cancelled: boolean; names?: string[] }>('cancelSquad', { squadId });
export const linkyPrefs = (prefs: { openTo?: IntentOffer[]; inboundCap?: number }) => linkyCall<{ ok: boolean }>('prefs', prefs);
export const linkyPointers = (need: string) => linkyCall<{
  text: string; cached: boolean; leads?: LinkyLead[]; searches?: number; note?: string;
  intro?: string; routes?: string[]; found?: number; skipped?: number; oneSearch?: boolean; place?: string;
}>('pointers', { need });

/** "draft 2" - Linky writes the message for one of the people he just found. */
export const linkyDraftLead = (args: { index?: number; lead?: LinkyLead; key?: string; need?: string }) => linkyCall<{
  ok: boolean; key: string; lead: LinkyLead; text: string; url: string; usedAi?: boolean; howTo?: string;
}>('draftLead', args);

/** Approving an off-network message is a record, not a send: the member pastes it. */
export const linkyApproveLead = (text?: string) => linkyCall<{
  ok: boolean; intentId: string; text: string; url?: string; edited?: boolean; note?: string; lead?: LinkyLead;
}>('approveLead', text ? { text } : {});

export const linkyMarkLead = (key: string, status: 'sent' | 'not_interested', intentId?: string) =>
  linkyCall<{ ok: boolean; status: string; muted?: boolean; note?: string }>('markLead', intentId ? { key, status, intentId } : { key, status });
/** "Which Fred?" -> "the first one". Turns a picked member into a real card. */
export const linkyPickPerson = (targetUid: string) => linkyCall<LinkyCard>('pickPerson', { targetUid });
export const linkyFacts = (facts: { notes: string; skills: string[]; lookingFor: string[]; hidden?: LinkyHidden }) =>
  linkyCall<{ ok: boolean; facts: LinkyToldFacts }>('facts', facts);
/** One fact at a time: hide it from Linky (their profile keeps it) or give it back. */
export const linkyHideFact = (kind: string, value: string, hide: boolean) =>
  linkyCall<{ ok: boolean; hidden: LinkyHidden }>('hideFact', { kind, value, hide });
/** "and forget that I ever asked" */
export const linkyRemoveAsk = (id: string) => linkyCall<{ ok: boolean; forgotten: number }>('removeAsk', { id });
/** "clear the chat" — wipe the whole conversation in one go, keep budget & cards. */
export const linkyClearChat = () => linkyCall<{ ok: boolean; cleared: number }>('clearChat');
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
