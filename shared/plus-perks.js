// THE PLUS PERK LIST — one source of truth for the paywall, the invite, the
// email and the release notes.
//
// Every line must be a thing PLUS actually gates today. If a limit is not
// enforced in code, it does not belong here: a paywall that sells a promise the
// product does not keep is how you lose the member who says yes. Each perk
// carries three strings — what free gets, what PLUS gets, and why it matters —
// so no surface can quietly invent a fourth claim.
//
// Provenance (keep these true or delete the perk):
//   linky      → shared/linky-budget.js (freePerDay 4), api/_linky.js reserveMessage
//   meets      → api/_linky.js LIMITS.plus.meetsPerDay
//   writer     → api/_profileWriter.js (server-gated on isPlusUser)
//   warmIntro  → mobile/src/lib/paywall.ts FREE_LIMITS.warmIntrosPerMonth
//   viewers    → mobile/src/screens/ViewersScreen.tsx hasLinkupPro
//   recs       → FREE_LIMITS.weeklyRecommendations
//   posts      → WEEKLY_POST_LIMITS in CreatePostScreen.tsx
//   turbo      → RecommendedMatchesScreen.tsx turboConnect +8
//   noads      → mobile/src/lib/campaigns.ts isSponsoredHiddenForViewer
//   badge      → paywall.ts buildLocalProEntitlement (isVerified + crown)

export const PLUS_PERKS = Object.freeze([
  {
    id: 'linky',
    title: 'Talk to Linky without counting',
    free: '4 messages a day',
    plus: 'No limit',
    line: 'The fourth message is where the good question usually happens.',
  },
  {
    id: 'meets',
    title: 'Ask to meet as many builders as you find',
    free: '2 Meet requests a day',
    plus: 'No limit',
    line: 'Every builder Linky shows you has a seat open. Free lets you knock on two doors a day.',
  },
  {
    id: 'writer',
    title: 'Linky writes your profile for you',
    free: 'You write all of it',
    plus: 'Linky writes it, you approve it',
    line: 'Linky takes everything you have already told it and writes the bio, the headline and the signals the matcher actually reads.',
  },
  {
    id: 'warmIntro',
    title: 'Unlimited AI warm intros',
    free: '1 a month',
    plus: 'No limit',
    line: 'The first message decides whether a good person replies. Linky drafts it from both profiles.',
  },
  {
    id: 'viewers',
    title: 'See exactly who opened your profile',
    free: 'The number only',
    plus: 'Names, photos and what they did',
    line: 'You already know people are looking. PLUS tells you who, so you can move first.',
  },
  {
    id: 'recommendations',
    title: 'Every weekly recommendation',
    free: '3 a week',
    plus: 'The whole ranked pool',
    line: 'The algorithm finds more people for you than the free plan is allowed to show.',
  },
  {
    id: 'posts',
    title: 'Post as often as you ship',
    free: '1 startup a week',
    plus: '10 a week',
    line: 'The builders who get matched are the ones who keep showing up.',
  },
  {
    id: 'turbo',
    title: 'Turbo Connect — the visibility boost',
    free: 'Standard ranking',
    plus: 'A +8 boost in Discover and search',
    line: 'Somebody is looking for exactly what you are building. Turbo is how they find you first.',
  },
  {
    id: 'noads',
    title: 'No sponsored cards. Anywhere. Ever.',
    free: 'One sponsored card per four',
    plus: 'None, on any surface',
    line: 'You should not be sold to inside the room where you are building.',
  },
  {
    id: 'badge',
    title: 'The verified tick and the PLUS crown',
    free: 'Hidden',
    plus: 'Beside your name everywhere',
    line: 'Being chosen starts with looking chosen.',
  },
]);

export const PLUS_PERK_COUNT = PLUS_PERKS.length;

export const plusPerkById = (id) => PLUS_PERKS.find((perk) => perk.id === id) || null;

/** How many perks a member does not yet have — the "and N more" number. */
export const plusPerksNotShown = (shownIds = []) =>
  PLUS_PERKS.filter((perk) => !shownIds.includes(perk.id)).length;

const first = (name) => {
  const raw = String(name == null ? '' : name).trim().split(/\s+/)[0] || '';
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
};

/**
 * The paywall's own copy, written for one member.
 *
 * Three levers, all of them honest:
 *   1. loss aversion — say exactly what they are hitting now, in numbers;
 *   2. personal relevance — their name, their project, the seat they said is empty;
 *   3. specificity — every claim is a number or a surface, never an adjective.
 */
export function paywallCopy(profile = {}) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const name = first(p.displayName || p.fullName || '');
  const project = Array.isArray(p.projects) && p.projects[0] && typeof p.projects[0] === 'object' ? p.projects[0] : {};
  const building = String(p.buildingName || p.startupName || project.title || project.name || p.company || '').trim();
  const seat = String(p.missingSeat || (Array.isArray(p.lookingFor) ? p.lookingFor[0] : '') || '').trim();

  const headline = name ? `${name}, this is everything LINKUP can do` : 'This is everything LINKUP can do';
  const opening = building
    ? `You are building ${building}${seat ? ` and you said the seat you need filled is a ${seat.toLowerCase()}` : ''}.`
    : seat
      ? `You said the seat you need filled is a ${seat.toLowerCase()}.`
      : '';
  const subline = [
    opening,
    'Right now LINKUP is stopping at 4 Linky messages a day, 3 recommendations a week, one startup post a week, and it will not tell you who opened your profile. PLUS removes every one of those.',
  ].filter(Boolean).join(' ');

  return { headline, subline, personalised: Boolean(name || building || seat) };
}
