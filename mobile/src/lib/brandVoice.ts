/**
 * LINKUP VOICE — the one place the words live.
 *
 * The register is deliberate and it is not corporate. LINKUP exists because a
 * person is stuck: they can see the company in their head, they can feel the
 * clock, and the only thing standing between them and it is a human being they
 * have not met. Every line written here talks to that person, by name, about
 * their actual build, as if the next twelve months are on the table — because
 * for them they are.
 *
 * Rules of the voice:
 *  - Second person, present tense. "You are building it. You are not building
 *    it alone."
 *  - Name the person and their project whenever we know them. No generic copy
 *    when a fact is available.
 *  - Stakes, never threats. We say what is at risk; we never invent scarcity,
 *    countdowns, or fake numbers.
 *  - Short sentences. One idea per line. Read it out loud and it should feel
 *    like someone who believes in you, leaning across the table.
 *
 * Nothing in this file touches React Native, so it can be unit tested and
 * reused by web, native and email surfaces alike.
 */

export type VoiceProfile = {
  uid?: string;
  displayName?: string;
  occupation?: string;
  roles?: string[];
  bio?: string;
  goals?: string;
  lookingFor?: string[];
  industries?: string[];
  skills?: string[];
  projects?: { title?: string; description?: string; status?: string }[];
  startupIdeas?: { title?: string; description?: string; stage?: string }[];
  startupStage?: string;
  fundingStage?: string;
  buildingName?: string;
  buildingOneLiner?: string;
  buildingTraction?: string;
  missingSeat?: string;
  stakes?: string;
  urgency?: string;
  city?: string;
  country?: string;
} | null;

export type BuildFacts = {
  firstName: string;
  hasName: boolean;
  projectName: string;
  oneLiner: string;
  stage: string;
  seat: string;
  city: string;
  knownBuild: boolean;
};

const clean = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

/** First name, title-cased, or '' when we genuinely don't know it yet. */
export function firstNameOf(name: unknown): string {
  const raw = clean(name).split(' ')[0] || '';
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

const SEAT_WORDS: Record<string, string> = {
  cofounder: 'co-founder',
  'co-founder': 'co-founder',
  'startup team': 'founding team',
  'startup team members': 'founding team',
  networking: 'person who opens doors',
  hiring: 'first great hire',
  investment: 'the investor who gets it',
  investor: 'the investor who gets it',
  mentorship: 'mentor who has done it before',
  'freelance work': 'freelancer who can actually ship',
  'a technical cofounder': 'technical co-founder',
  'a designer': 'designer',
  designer: 'designer',
  developer: 'engineer who can build it',
  engineer: 'engineer who can build it',
  marketer: 'growth person',
  sales: 'seller who can close',
  operator: 'operator who runs the machine',
  'gym buddy': 'training partner',
  'language partner': 'language partner',
};

/** The missing ingredient, in human words. Never "N/A" — always something to hunt. */
export function seatOf(profile: VoiceProfile, fallback = 'the person who finishes this'): string {
  const explicit = clean((profile as any)?.missingSeat);
  if (explicit) return explicit;
  const looking = Array.isArray(profile?.lookingFor) ? profile?.lookingFor ?? [] : [];
  for (const raw of looking) {
    const key = clean(raw).toLowerCase().replace(/^a\s+/, '');
    if (SEAT_WORDS[key]) return SEAT_WORDS[key];
  }
  const first = clean(looking[0]);
  if (first) return first.toLowerCase();
  return fallback;
}

/** What they are building, from wherever it was captured. */
export function projectNameOf(profile: VoiceProfile): string {
  const explicit = clean((profile as any)?.buildingName);
  if (explicit) return explicit;
  const project = Array.isArray(profile?.projects) ? profile?.projects?.[0] : undefined;
  if (clean(project?.title)) return clean(project?.title);
  const idea = Array.isArray(profile?.startupIdeas) ? profile?.startupIdeas?.[0] : undefined;
  if (clean(idea?.title)) return clean(idea?.title);
  return '';
}

export function oneLinerOf(profile: VoiceProfile): string {
  const explicit = clean((profile as any)?.buildingOneLiner);
  if (explicit) return explicit;
  const project = Array.isArray(profile?.projects) ? profile?.projects?.[0] : undefined;
  if (clean(project?.description)) return clean(project?.description);
  const idea = Array.isArray(profile?.startupIdeas) ? profile?.startupIdeas?.[0] : undefined;
  if (clean(idea?.description)) return clean(idea?.description);
  const bio = clean(profile?.bio);
  if (bio) {
    const sentence = bio.split(/(?<=[.!?])\s/)[0] || bio;
    return sentence.length > 180 ? `${sentence.slice(0, 177)}…` : sentence;
  }
  return '';
}

export function stageOf(profile: VoiceProfile): string {
  return clean((profile as any)?.buildingTraction) || clean(profile?.startupStage) || '';
}

/** Everything the personalised surfaces need, derived once. */
export function buildFacts(profile: VoiceProfile): BuildFacts {
  const firstName = firstNameOf(profile?.displayName);
  const projectName = projectNameOf(profile);
  const oneLiner = oneLinerOf(profile);
  return {
    firstName,
    hasName: !!firstName,
    projectName,
    oneLiner,
    stage: stageOf(profile),
    seat: seatOf(profile),
    city: clean(profile?.city),
    knownBuild: !!projectName || !!oneLiner,
  };
}

export function daypart(date = new Date()): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = date.getHours();
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/* ------------------------------------------------------------------ *
 * LANDING — the first 5 seconds. This is where someone decides
 * whether the thing they've been carrying alone is worth one tap.
 * ------------------------------------------------------------------ */

export const LANDING_VOICE = {
  eyebrow: 'ONE PERSON AWAY',
  headline: 'You are one person away from the version of this that works.',
  sub: "You have carried it on your own long enough — the late nights, the half-built thing in your head, the sentence that starts with 'if I just had someone who…'. Someone else is already looking for you. LINKUP introduces you both, by name, once a week, and emails you the same minute.",
  handoff: 'No swiping. No cold DMs. One person, chosen for you, who is choosing you back.',
  primaryCta: 'Find the person I have been missing',
  orDivider: 'or',
  secondaryCta: 'Continue with email',
  explore: 'See the people already building →',
  proof: [
    'Real profiles, not promises.',
    'Matched by the LINKUP algorithm and read by LINKUP AI.',
    'Both people get the same email, the same minute.',
  ],
  footNote: 'Three minutes with Linky is usually enough to know whether this is your week.',
};

/* ------------------------------------------------------------------ *
 * ONBOARDING — every question is a gift to the algorithm. The copy
 * makes the cost of a vague answer obvious without ever scolding.
 * ------------------------------------------------------------------ */

export const ONBOARDING_VOICE = {
  introLine: 'Everything you answer here is ammunition for the person hunt. Vague answers find vague people.',
  stepOneTitle: 'First — the name they will remember.',
  stepOneSub: 'The person who changes your trajectory will read this name before they read anything else about you. Use the real one.',
  ageTitle: 'How long have you had to prepare for this?',
  ageSub: 'We only introduce you to people in a range that makes sense. You must be 16 or older.',
  placeTitle: 'Where in the world are you building from?',
  placeSub: 'Your co-founder may be across the street or four time zones away. Location decides who you can actually build beside — tell us the truth.',
  identityTitle: 'Which room do you walk into?',
  identitySub: 'Pick everything that is true about you. Your first pick leads: it decides where Linky starts hunting.',
  goalsTitle: 'Who is missing at your table?',
  goalsSub: 'Name the missing ingredient for success. Everything after this exists to find the person who brings it.',
  photoTitle: 'Show them your face.',
  photoSub: 'The person about to trust you with their next five years needs to see you first. A photo is required — this is not vanity, it is trust.',
  photoAdded: 'That is you. They will know exactly who they are talking to.',
  photoMissing: 'Tap the circle. Nobody commits five years to a silhouette.',
  finalCta: 'Enter LINKUP',
  finalNote: 'Everything here stays under your control. You can change it the moment it changes you.',
} as const;

/** The new recruitment-style questions — the data the algorithm actually eats. */
export const BUILD_QUESTIONS = {
  build: {
    title: 'What are you building — even if it is only a folder on your laptop?',
    sub: 'Name it and describe it in your own words. Linky reads this before you ever type a message, so you never have to explain yourself twice.',
    namePlaceholder: 'Project name (e.g. Linkup, FarmLink, Northstar)',
    oneLinerPlaceholder: 'One line: what does it do, and who is it for?',
    tractionLegend: 'How far along is it, honestly?',
  },
  seat: {
    title: 'Who is missing, and why are you stuck without them?',
    sub: 'Pick the seat you cannot fill yourself. The algorithm hunts the shape you name — the sharper the shape, the better the human.',
    whyPlaceholder: 'What exactly can they do that you cannot? (one line)',
  },
  stakes: {
    title: 'What happens if this is still true in twelve months?',
    sub: 'This is not a guilt question. Urgency tells LINKUP how hard to work for you — and who to put in front of you first.',
  },
  fit: {
    title: 'How do you want to be built with?',
    sub: 'The best founders fail on working style, not on skill. These answers stop us introducing you to someone brilliant you would grow to resent.',
  },
  mirror: {
    title: 'Here is who you just described.',
    sub: 'Check it. If any of this is wrong, go back — this is the brief the algorithm will hunt with, and it is the brief Linky will quote back to you.',
  },
} as const;

export const STAKES_CHOICES = [
  { id: 'same-place', label: 'I am in exactly the same place. That is the fear.' },
  { id: 'someone-else-ships', label: 'Someone else ships it first and I watch.' },
  { id: 'fold', label: 'I quietly fold it and go back to a job.' },
  { id: 'burnout', label: 'I burn out pretending I can do every seat myself.' },
  { id: 'money-runs-out', label: 'The money runs out before the product exists.' },
  { id: 'different-person', label: 'Nothing dramatic — I just never become the person I said I would.' },
] as const;

export const URGENCY_CHOICES = [
  { id: 'now', label: 'Now. Every week without them is a week lost.' },
  { id: '30', label: 'Within 30 days.' },
  { id: '90', label: 'Within 3 months.' },
  { id: '180', label: 'Within 6 months.' },
] as const;

export const TRACTION_CHOICES = [
  { id: 'nothing', label: 'Nothing yet — it lives in my head and a notebook.' },
  { id: 'build', label: 'Something half-built that I cannot finish alone.' },
  { id: 'beta', label: 'Real people using a rough version.' },
  { id: 'revenue', label: 'People are paying us.' },
  { id: 'scaling', label: 'It works. It needs more hands than I have.' },
] as const;

export const PACE_CHOICES = [
  { id: 'sprint', label: 'Sprint — ship this month or die trying.' },
  { id: 'steady', label: 'Steady — every single week, no heroics.' },
  { id: 'nights', label: 'Nights and weekends until it pays.' },
  { id: 'seasonal', label: 'In bursts around the rest of my life.' },
] as const;

export const CONFLICT_CHOICES = [
  { id: 'straight', label: 'Say it straight, in the room, immediately.' },
  { id: 'written', label: 'Write it down first, then talk.' },
  { id: 'private', label: 'One to one, never in front of the team.' },
  { id: 'data', label: 'Bring evidence or let it go.' },
] as const;

export const DECISION_CHOICES = [
  { id: 'fast-reversible', label: 'Move fast on anything reversible.' },
  { id: 'consensus', label: 'Get the room aligned, then move.' },
  { id: 'owner', label: 'Whoever owns it decides it.' },
  { id: 'evidence', label: 'Decide on numbers, not opinions.' },
] as const;

export const RISK_CHOICES = [
  { id: 'all-in', label: 'All in. No plan B, no soft landing.' },
  { id: 'calculated', label: 'Big bets, but never with the rent money.' },
  { id: 'careful', label: 'Slow and certain beats fast and dead.' },
] as const;

export const EQUITY_CHOICES = [
  { id: 'equal', label: 'Split it as close to even as the work allows.' },
  { id: 'sweat', label: 'Vest it — earn it over years, not days.' },
  { id: 'dependent', label: 'Depends entirely on what they bring.' },
  { id: 'not-yet', label: 'I have not thought about it yet. (Be honest.)' },
] as const;

export const HOURS_CHOICES = [
  { id: '10', label: 'Around 10 hours a week.' },
  { id: '20', label: 'Around 20 hours a week.' },
  { id: '40', label: 'Full time — 40 hours or more.' },
  { id: '80', label: 'Every waking hour. This is the only thing.' },
] as const;

export const RELOCATE_CHOICES = [
  { id: 'remote', label: 'Remote only. Do not ask me to move.' },
  { id: 'sometimes', label: 'Remote first, but I will travel for the right person.' },
  { id: 'relocate', label: 'I will move for the right co-founder.' },
  { id: 'together', label: 'Wherever the build takes us.' },
] as const;

/* ------------------------------------------------------------------ *
 * DISCOVER — the weekly card. The hero below is the first thing a
 * member reads on the home page, and it is written to sound like a
 * scout who found them, not a dashboard that greeted them.
 * ------------------------------------------------------------------ */

export const DISCOVERY_VOICE = {
  hero: {
    /** By name, by the actual time of day. Never "Hello, user". */
    greeting: (facts: BuildFacts, when = new Date()): string =>
      facts.hasName ? `Good ${daypart(when)}, ${facts.firstName}.` : `Good ${daypart(when)}.`,
    /** The whole sentence, exactly as asked for — used by email and tests. */
    lead: "We've been looking. And we found some A-PLAYERS.",
    /** Set on two lines so "A-PLAYERS" never breaks across a hyphen. */
    leadLine1: "We've been looking.",
    leadLine2: 'And we found some',
    leadHighlight: 'A-PLAYERS',
    body: 'People building ambitious things, making bold moves, and bringing serious talent to the table.',
    /** The line that is set in bold — the one the whole page is selling. */
    promise: 'Your next introduction could be the one that changes everything.',
    cta: 'Ready to meet your people?',
  },
  cardLabel: (partnerFirst: string) => `WHY ${partnerFirst.toUpperCase()} AND YOU ARE THE SAME STORY`,
  /**
   * The dossier: the long, specific reasoning behind the week's one pick.
   * Labels only — the substance comes from the AI, grounded in profile facts.
   */
  dossier: {
    kicker: 'THE FULL READ',
    whyLabel: 'WHY YOU, WHY THEM, WHY NOW',
    partnerBrings: (partnerFirst: string) => `WHAT ${partnerFirst.toUpperCase()} BRINGS YOU`,
    youBring: (partnerFirst: string) => `WHAT YOU BRING ${partnerFirst.toUpperCase()}`,
    sharedGround: 'SHARED GROUND',
    sprint: (task: string) => `Your first twenty minutes together: ${task}`,
    engineNote: 'Written from the profile facts the algorithm verified.',
  },
  youBring: 'YOU BRING',
  theyBring: (partnerFirst: string) => `${partnerFirst.toUpperCase()} BRINGS`,
  sprint: (task: string) => `Your first twenty minutes together: ${task}`,
  interestCta: (partnerFirst: string) => `Yes — introduce me to ${partnerFirst}`,
  waiting: (partnerFirst: string) => `Introduction requested · waiting on ${partnerFirst}`,
  mutualCta: (partnerFirst: string) => `Accept & meet ${partnerFirst}`,
  emailed: (partnerFirst: string) =>
    `It is in both inboxes. You and ${partnerFirst} have the same email, the same week, the same sentence: this might be it.`,
  emptyTitle: 'This week the algorithm has nobody for you yet.',
  emptyBody:
    'That is not a compliment. It means it does not have enough of you to hunt with. Give it your build, the missing ingredient, and the stakes — then come back and watch what it drags in.',
  emptyCta: 'Sharpen my profile',
  fullProfile: 'Read their whole story',
} as const;

/* ------------------------------------------------------------------ *
 * THE WEEKLY REVEAL — four seconds of the cat thinking before the one
 * person of the week appears. This is deliberately slow: the wait is
 * the point. It has to feel like something is being decided about you.
 * ------------------------------------------------------------------ */

export const WEEKLY_REVEAL_VOICE = {
  /** The wait, in four beats, each one tightening the screw. */
  thinkingLines: (facts: BuildFacts): string[] => [
    'The cat is thinking.',
    facts.projectName ? `Reading every profile that could build ${facts.projectName}.` : 'Reading every public profile in the database.',
    facts.seat ? `Weighing who could actually hold the ${facts.seat} seat.` : 'Weighing who could be your missing ingredient.',
    'One person. Chosen for you. About to appear.',
  ],
  /** Stamped under the cat while it thinks. */
  status: (facts: BuildFacts): string[] => [
    'scanning',
    'weighing fit',
    'checking they are looking for you too',
    facts.hasName ? `deciding, ${facts.firstName}` : 'deciding',
  ],
  /** The moment it lands. */
  revealLabel: (partnerFirst: string) => `This is this week's person — ${partnerFirst}.`,
  skip: 'Tap to see them now',
  /** Screen readers and the reduced-motion path still get the whole story. */
  reducedMotionNote: (facts: BuildFacts): string =>
    facts.projectName
      ? `Choosing one person for ${facts.projectName} this week.`
      : 'Choosing one person for you this week.',
} as const;

/* ------------------------------------------------------------------ *
 * LEAVING — deleting an account is the one place we never hold a
 * grudge. Take your data with you; the door works both ways.
 * ------------------------------------------------------------------ */

export const ACCOUNT_VOICE = {
  exportTitle: 'Take your data with you',
  exportBody:
    'This is yours. Everything LINKUP knows about you — your profile, your build, your brief, your private workspace notes — in one file you can open, keep or delete yourself.',
  exportButton: 'Download my data (optional)',
  deleteTitle: 'Delete my account',
  deleteBody:
    'Deleting removes your profile, your build and every thread that came with it. Nothing is recoverable afterwards, and the algorithm forgets you the same day.',
  deleteConfirm: 'Delete everything',
  cancel: 'Stay',
  exported: 'Your data is downloaded. Delete whenever you are ready — or do not.',
  exportFailed: 'The download could not finish. You can still delete, or try the export again.',
} as const;

/* ------------------------------------------------------------------ *
 * LINKY — the cat that shows up when you open the page, says your
 * name, and tells you the truth about your build before you speak.
 * ------------------------------------------------------------------ */

export const LINKY_VOICE = {
  /** The three beats of the opening: who, what, what happens next. */
  introLines: (facts: BuildFacts): string[] => {
    const lines: string[] = [];
    lines.push(facts.hasName ? `Hi ${facts.firstName}.` : 'Hi. You made it.');
    if (facts.projectName && facts.seat) {
      lines.push(`I know about ${facts.projectName}. I know you are still missing ${facts.seat}.`);
    } else if (facts.projectName) {
      lines.push(`I know about ${facts.projectName}. I know what it is still missing.`);
    } else if (facts.seat) {
      lines.push(`I already know the chair you cannot fill: ${facts.seat}.`);
    } else {
      lines.push('I read your profile before you walked in.');
    }
    lines.push('Give me three minutes. I will find the teammates who finish this.');
    return lines;
  },
  skip: 'Tap to skip',
  replayLabel: 'Replay the Linky opening',
  /** The first bubble in the thread — never asks what it already knows. */
  greeting: (facts: BuildFacts): string => {
    if (facts.projectName && facts.seat) {
      return `It is me — Linky. You are building ${facts.projectName}${
        facts.oneLiner ? `: ${facts.oneLiner}` : ''
      } And the seat that is still empty is ${facts.seat}. I have every public LINKUP profile open in front of me. Say the word and I start searching — or tell me what changed.`;
    }
    if (facts.projectName) {
      return `It is me — Linky. You are building ${facts.projectName}${
        facts.oneLiner ? `: ${facts.oneLiner}` : ''
      }. Tell me which seat is still empty and I will find the humans who fill it — three minutes, tops.`;
    }
    return `It is me — Linky. Your profile says you have a build and one ingredient missing for success. Tell me what you are making and who is missing, and I will go through every public LINKUP profile until I find them. Three minutes, no more.`;
  },
  placeholder: (facts: BuildFacts): string =>
    facts.projectName ? `Tell me what changed about ${facts.projectName}…` : 'What are you building, and who is missing?',
  chips: (facts: BuildFacts): string[] => {
    const chips: string[] = [];
    if (facts.seat) chips.push(`Find my ${facts.seat}`);
    if (facts.projectName) chips.push(`Who can build ${facts.projectName} with me?`);
    chips.push('Find teammates', 'Who is the one person I am missing?');
    return chips.slice(0, 4);
  },
  /**
   * While a search runs, Linky thinks out loud: complete, specific thoughts
   * about THIS member's brief — what they are building, the seat they need,
   * and how the list is being cut. Never one spinner word on repeat.
   */
  thinkingLines: (facts: BuildFacts): string[] => [
    facts.projectName
      ? `Reading your brief — ${facts.projectName}${facts.oneLiner ? `, ${facts.oneLiner}` : ''}.`
      : 'Reading your brief — what you are building and who is still missing.',
    facts.seat
      ? `Searching every public LINKUP profile for your ${facts.seat}.`
      : 'Searching every public LINKUP profile for your missing ingredient.',
    'Checking the real evidence — skills, builds, and who is already looking for someone like you.',
    'Cutting everyone who only sounds right on paper.',
    'Keeping the people whose strengths complete yours instead of copying them.',
    'Ranking the strongest fits — names in a moment.',
  ],
  working: 'Going through every public LINKUP profile. Give me a second…',
  clock: 'Three minutes started the moment you opened this page.',
  disclaimer:
    'Every name comes from a real public profile. A match is my best suggestion — a human decision, not a guarantee. You choose who to trust.',
  quotaFallback: 'One message is one search across the whole LINKUP database.',
} as const;
