/**
 * PLUS invitations: when they fire, which benefit leads, and what they say.
 *
 * Pure on purpose — no imports, no AsyncStorage, no React. Same inputs, same
 * answers, which is the only way the "three times a day, at no fixed time" rule
 * can be tested instead of hoped for.
 *
 * The rules, in order:
 *   1. never to a PLUS member, never to somebody who has not finished setup
 *   2. three per local day, inside a waking window, never on a fixed clock time
 *   3. at least MIN_GAP apart, so they cannot stack up if the app was closed
 *   4. each exposure leads with ONE benefit and says there are more
 *   5. the same benefit does not lead twice in one day
 */

export const INVITES_PER_DAY = 3;
export const MIN_INVITE_GAP_MS = 90 * 60 * 1000;
export const INVITE_WINDOW_START_HOUR = 8;
export const INVITE_WINDOW_END_HOUR = 21;

export type InviteExposure = { slot: number; at: number };

export type InviteDecision =
  | { due: false; reason: 'plus' | 'not-onboarded' | 'app-inactive' | 'outside-window' | 'all-shown' | 'gap' | 'not-yet' | 'no-uid' }
  | { due: true; slot: number; feature: InviteFeature; headline: string; subline: string; moreLine: string; personalised: boolean };

export type InviteFeature = {
  id: string;
  /** The one thing this exposure shows off. Short, concrete, no adjectives. */
  feature: string;
  /** Why it matters to *this* member, in one sentence. May use {first}/{building}. */
  line: string;
};

/**
 * What PLUS actually unlocks today. Every line is traceable to code that reads
 * hasLinkupPro(): campaigns.ts hides sponsored cards, ViewersScreen shows the
 * viewer list, RecommendedMatchesScreen and CreatePostScreen lift their limits,
 * ProfileScreen shows the tick + crown, DynamicAppearanceController unlocks
 * themes, and Turbo Connect is the discover boost.
 *
 * Do not add a benefit before the feature exists. A paywall that promises a
 * feature you have not shipped is the fastest way to lose the member who pays.
 */
export const INVITE_FEATURES: InviteFeature[] = [
  {
    id: 'noads',
    feature: 'No sponsored cards. Anywhere. Ever.',
    line: "You're the one person on this app who should not be sold to, {first} — PLUS members never see a sponsored card, on any surface, or in any email.",
  },
  {
    id: 'viewers',
    feature: 'See exactly who opened your profile',
    line: 'Three people looked at what you are building this week. Right now you can see the number. With PLUS you see the names.',
  },
  {
    id: 'recommendations',
    feature: 'Every recommendation, not three a week',
    line: 'The algorithm finds more people for you than it is allowed to show you. Free stops at three. PLUS does not stop.',
  },
  {
    id: 'saved',
    feature: 'Save every profile you want to come back to',
    line: 'Five saves is not enough for anyone actually building something, {first}. PLUS makes the shelf infinite.',
  },
  {
    id: 'posts',
    feature: 'Post as often as you ship',
    line: 'You ship more than you post. Free caps it; PLUS does not. The builders who get matched are the ones who keep showing up.',
  },
  {
    id: 'turbo',
    feature: 'Turbo Connect — stand at the front of Discover',
    line: 'Somebody is looking for exactly what you are building. Turbo Connect is how they find you before they find the next person.',
  },
  {
    id: 'badge',
    feature: 'The blue check and the PLUS crown',
    line: 'A verified tick and a crown beside your name, everywhere you appear — because being chosen starts with looking chosen.',
  },
  {
    id: 'themes',
    feature: 'The PLUS themes',
    line: 'Your app, your palette. The themes live behind PLUS, along with everything else on this list.',
  },
];

const pad = (value: number) => String(value).padStart(2, '0');

/** Local calendar day, because the rhythm should follow the member's day, not UTC. */
export const inviteDayKey = (now: number | Date = Date.now()): string => {
  const date = now instanceof Date ? now : new Date(now);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** FNV-1a: small, stable, good enough to make the day's times look arbitrary. */
const hash32 = (text: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededUnit = (seed: string): number => hash32(seed) / 0xffffffff;

/**
 * The three moments for a given member on a given day, as epoch millis.
 *
 * The waking window is cut into three bands and each band gets its own seeded
 * offset, so the times are never the same twice — not day to day, and not
 * between two members on the same day. Deterministic per (uid, day) so a reload,
 * a second device or a re-render cannot reshuffle them or double-fire.
 */
export const inviteSchedule = (uid: string, now: number | Date = Date.now()): number[] => {
  const date = now instanceof Date ? now : new Date(now);
  const day = inviteDayKey(date);
  const windowStart = new Date(date);
  windowStart.setHours(INVITE_WINDOW_START_HOUR, 0, 0, 0);
  const windowEnd = new Date(date);
  windowEnd.setHours(INVITE_WINDOW_END_HOUR, 0, 0, 0);
  const span = Math.max(1, windowEnd.getTime() - windowStart.getTime());
  const band = span / INVITES_PER_DAY;
  return Array.from({ length: INVITES_PER_DAY }, (_, slot) => {
    const offset = Math.floor(seededUnit(`${uid}:${day}:${slot}`) * band);
    return windowStart.getTime() + Math.round(slot * band) + offset;
  });
};

/**
 * Which benefit leads each exposure. A seeded shuffle per member per day keeps
 * the three in a day distinct and stops two members seeing the same order.
 */
export const inviteFeatureOrder = (uid: string, dayKey: string): InviteFeature[] => {
  const pool = [...INVITE_FEATURES];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(seededUnit(`${uid}:${dayKey}:feature:${index}`) * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool;
};

export const firstNameOf = (name: unknown): string => {
  const raw = String(name == null ? '' : name).trim().split(/\s+/)[0] || '';
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
};

const fill = (text: string, values: Record<string, string>): string =>
  text.replace(/\{(\w+)\}/g, (whole, key) => (values[key] ? values[key] : whole));

const settle = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();

export type InviteCopyProfile = {
  displayName?: unknown;
  buildingName?: unknown;
  buildingOneLiner?: unknown;
  company?: unknown;
  missingSeat?: unknown;
  lookingFor?: unknown;
  onboarded?: unknown;
  totalMatches?: unknown;
};

/**
 * The pitch, written for one member.
 *
 * "Are you ready to move beyond" is the spine; everything after it is their own
 * facts — what they are building, the seat they said is empty, how many intros
 * they have had — so it reads like Linky noticed them, not like a banner.
 */
export const inviteCopy = (
  profile: InviteCopyProfile,
  feature: InviteFeature,
  moreCount: number
): { headline: string; subline: string; moreLine: string; personalised: boolean } => {
  const first = firstNameOf(profile?.displayName);
  const building = String(profile?.buildingName || profile?.company || '').trim();
  const seat = String(profile?.missingSeat || '').trim() || (Array.isArray(profile?.lookingFor) ? String(profile.lookingFor[0] || '').trim() : '');
  const oneLiner = String(profile?.buildingOneLiner || '').trim();

  const values: Record<string, string> = { first, building, seat };
  const greeting = first ? `${first}, are you ready to move beyond?` : 'Are you ready to move beyond?';

  const context = building
    ? oneLiner
      ? `You told us you're building ${building} — ${oneLiner.replace(/[.!]+$/, '')}.`
      : `You told us you're building ${building}.`
    : '';
  const seatLine = seat ? `The seat you said is empty is a ${seat.toLowerCase()}.` : '';

  const line = settle(fill(feature.line, values));
  const subline = settle([context, seatLine, line, 'This is one thing. There is more.'].filter(Boolean).join(' '));

  return {
    headline: greeting,
    subline,
    moreLine: moreCount > 0 ? `And ${moreCount} more things you don't have yet — all in one plan.` : '',
    personalised: Boolean(first || building || seat),
  };
};

export type InviteEvaluationInput = {
  uid?: string;
  isPlus?: boolean;
  onboarded?: boolean;
  appActive?: boolean;
  /** Local timestamp. Required — the schedule is defined against the member's day. */
  now: number;
  /** What this member has already been shown today (see readInviteState). */
  exposures?: InviteExposure[];
  /** Slots already evaluated today and rejected, so a dismissal doesn't re-open. */
  dismissed?: number[];
};

/**
 * Should a paywall invite open right now, and which one.
 *
 * Deliberately conservative: one missed slot is fine, an invite that fires while
 * somebody is mid-task is not. If the app was closed during a slot, the catch-up
 * happens on the next open — that is what makes the timing feel like it has no
 * fixed time rather than like a cron job.
 */
export const evaluateInvite = ({
  uid,
  isPlus,
  onboarded,
  appActive = true,
  now,
  exposures = [],
  dismissed = [],
}: InviteEvaluationInput): InviteDecision => {
  if (!uid) return { due: false, reason: 'no-uid' };
  if (isPlus) return { due: false, reason: 'plus' };
  if (onboarded === false) return { due: false, reason: 'not-onboarded' };
  if (!appActive) return { due: false, reason: 'app-inactive' };

  const day = inviteDayKey(now);
  const today = exposures.filter((entry) => inviteDayKey(entry.at) === day);
  if (today.length >= INVITES_PER_DAY) return { due: false, reason: 'all-shown' };

  const date = new Date(now);
  const start = new Date(date);
  start.setHours(INVITE_WINDOW_START_HOUR, 0, 0, 0);
  const end = new Date(date);
  end.setHours(INVITE_WINDOW_END_HOUR, 0, 0, 0);
  if (now < start.getTime() || now > end.getTime()) return { due: false, reason: 'outside-window' };

  const lastAt = today.length ? Math.max(...today.map((entry) => entry.at)) : 0;
  if (lastAt && now - lastAt < MIN_INVITE_GAP_MS) return { due: false, reason: 'gap' };

  const schedule = inviteSchedule(uid, now);
  // The latest slot whose moment has arrived and that has not been used yet.
  const pending = schedule
    .map((at, slot) => ({ at, slot }))
    .filter(({ at, slot }) => at <= now && !today.some((entry) => entry.slot === slot) && !dismissed.includes(slot))
    .sort((a, b) => b.at - a.at);
  if (!pending.length) return { due: false, reason: 'not-yet' };

  const slot = pending[0].slot;
  const order = inviteFeatureOrder(uid, day);
  const usedIds = new Set(today.map((entry) => (order[entry.slot % order.length] || order[0]).id));
  const feature = order.find((entry) => !usedIds.has(entry.id)) || order[slot % order.length];
  const copy = inviteCopy({}, feature, INVITE_FEATURES.length - 1);

  return { due: true, slot, feature, headline: copy.headline, subline: copy.subline, moreLine: copy.moreLine, personalised: false };
};

/** Same decision, but with the real profile threaded through the copy. */
export const evaluateInviteForProfile = (
  input: InviteEvaluationInput & { profile?: InviteCopyProfile }
): InviteDecision => {
  const decision = evaluateInvite(input);
  if (!decision.due) return decision;
  const copy = inviteCopy(input.profile || {}, decision.feature, INVITE_FEATURES.length - 1);
  return { ...decision, ...copy };
};
