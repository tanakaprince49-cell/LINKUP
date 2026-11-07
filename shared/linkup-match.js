/**
 * LINKUP matching engine — the running implementation of
 * docs/LINKUP_ALGORITHM_DESIGN.md (Part I fit, Part II chemistry, Part III making).
 *
 * Rules this file obeys, because the design document says so:
 *
 *   1. Every score is a deterministic function of features. No LLM decides a
 *      number. The LLM may only reorder inside a band and write copy from an
 *      evidence ledger (see api/rankCandidates.js).
 *   2. Members see a band ("Strong fit"), never a percentage.
 *   3. A pair is scored in both directions and published as a harmonic mean, so
 *      a popular founder cannot appear on everybody's rail.
 *   4. Activity is never treated as skill. Build days raise reliability, never
 *      competence, and the copy never implies otherwise.
 *   5. Missing data is neutral (0.5) *and* its weight is renormalised away, so a
 *      two-field profile can never look like a five-dimensional fit.
 *   6. Nothing here reads message text. Vitals are computed from metadata only.
 *
 * Pure ES module: no imports, no I/O, no clock except the `now` you pass in.
 */

export const MODEL_VERSION = 'linkup-match/1.1.0';

/* ------------------------------------------------------------------ *
 * Small maths helpers
 * ------------------------------------------------------------------ */

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clamp01 = (value) => clamp(Number.isFinite(value) ? value : 0, 0, 1);
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const round3 = (value) => Math.round(value * 1000) / 1000;

/** Harmonic mean, the design's "brutal in the right way" combination. */
export function harmonic(a, b) {
  const x = clamp01(a);
  const y = clamp01(b);
  if (x <= 0 || y <= 0) return 0;
  return round3((2 * x * y) / (x + y));
}

/** Saturating count curve: 10 shared skills ≈ 0.8, 60 skills can't farm the top. */
export function saturate(count, k = 3) {
  const n = Math.max(0, Number(count) || 0);
  return round3(n / (n + k));
}

/** Exponential half-life decay in days. */
export function decay(days, halfLifeDays = 30) {
  if (!Number.isFinite(days)) return 0.5;
  if (days <= 0) return 1;
  return round3(Math.pow(0.5, days / halfLifeDays));
}

const unique = (list) => Array.from(new Set(list));

const asArray = (value) => {
  if (Array.isArray(value)) return value.filter((entry) => entry !== null && entry !== undefined);
  if (value === null || value === undefined || value === '') return [];
  return [value];
};

export const normalizeText = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const STOPWORDS = new Set(
  `a an the and or but if then than that this those these i me my we our you your he she it its they them
   to of in on at for with without from by as is are was were be been being am do does did doing have has
   had having will would can could should may might must not no yes so very just really also about into over
   under again more most some such only own same too s t don now here there when where why how all any both
   each few other while because through during before after above below up down out off between against
   who whom whose which what whats im ive id ill youre weve theyre want wanted need needs looking look
   building build builds built work working works like make making get getting got use using
   everyone everything something anything someone somebody people person stuff things thing way ways
   lot bit new better best good great big small long short early late first last next own again
   across without within around over under behind beyond toward towards per via etc really quite
   building builds built start started starting keep keeps kept try trying tried going gone come
   came coming take takes taken give gives given says said tell tells told know knows known think
   thought see sees seen find finds found put puts place places part parts point points`
    .split(/\s+/)
    .filter(Boolean)
);

/** Tokenise free text into 2..40 char word tokens, stopwords removed. */
export function tokenize(text) {
  return unique(
    normalizeText(text)
      .replace(/[^a-z0-9+#./\-\s]/g, ' ')
      .split(/\s+/)
      .map((word) => word.replace(/^[.\-/]+/, '').replace(/[.\-/]+$/, ''))
      .filter((word) => word.length >= 3 && word.length <= 40 && !STOPWORDS.has(word))
  );
}

const toMillis = (value) => {
  if (!value) return null;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const daysSince = (value, now) => {
  const ms = toMillis(value);
  if (!ms) return null;
  return Math.max(0, (now - ms) / 86400000);
};

/* ------------------------------------------------------------------ *
 * Taxonomy — the versioned extractor (Part I §3 L4a)
 * ------------------------------------------------------------------ */

/** "How" skills: the craft. These are what `functionGap` compares. */
export const FUNCTION_SKILLS = new Set(
  `react react native next.js vue svelte angular node node.js express django flask rails laravel php
   python java kotlin swift objective-c flutter dart golang rust typescript javascript sql nosql graphql
   rest api firebase supabase aws gcp azure docker kubernetes terraform devops ci/cd
   figma sketch adobe xd photoshop illustrator after effects blender motion design ux ui research
   user research wireframing prototyping design systems branding illustration animation
   seo sem content marketing growth hacking paid ads facebook ads google ads tiktok ads email marketing
   copywriting social media community management pr partnerships business development sales
   b2b sales enterprise sales cold outreach account management crm hubspot salesforce
   financial modelling bookkeeping accounting payroll legal compliance contracts fundraising
   investor relations recruiting hiring people ops project management scrum agile operations
   logistics supply chain procurement customer success support qa testing automation data analysis
   data engineering analytics tableau power bi excel statistics machine learning deep learning
   nlp computer vision llm prompt engineering mlops`
    .split(/\s+/)
    .filter(Boolean)
);

/** "What" domains: the market. These are what `domainOverlap` compares. */
export const DOMAIN_SKILLS = new Set(
  `fintech payments banking lending insurance insurtech credit savings remittances cross-border
   agritech agriculture farming foodtech livestock cold chain
   healthtech health medical telehealth pharmacy biotech mental health
   edtech education learning schools universities
   ecommerce retail marketplace logistics delivery transport mobility ridesharing
   proptech real estate construction housing energy solar climate sustainability
   saas b2b software infrastructure developer tools
   media entertainment gaming sports music streaming content creator
   travel hospitality tourism government civic tech public sector ngo nonprofit
   crypto blockchain web3 defi nft web development mobile apps ai artificial intelligence
   hardware iot robotics manufacturing mining gig work hr recruiting legaltech regtech cybersecurity
   zimbabwe africa emerging markets sme informal economy`
    .split(/\s+/)
    .filter(Boolean)
);

const ROLE_LABELS = [
  'cofounder',
  'founder',
  'developer',
  'engineer',
  'designer',
  'marketer',
  'growth',
  'sales',
  'operator',
  'investor',
  'mentor',
  'advisor',
  'hiring',
  'talent',
  'capital',
  'funding',
  'product',
  'data',
  'legal',
  'finance',
  'community',
  'partner',
  'customer',
  'user',
  'feedback',
];

/** Which archetypes satisfy a stated need. Directional: a need is not a skill. */
export const NEED_SATISFIED_BY = {
  cofounder: ['Visionary', 'Architect', 'Builder', 'Artisan', 'Operator', 'Connector', 'Analyst', 'Steward'],
  founder: ['Visionary', 'Operator'],
  developer: ['Builder', 'Architect'],
  engineer: ['Builder', 'Architect'],
  technical: ['Builder', 'Architect'],
  designer: ['Artisan'],
  marketer: ['Connector'],
  growth: ['Connector'],
  sales: ['Connector', 'Operator'],
  operator: ['Operator'],
  investor: ['Steward'],
  capital: ['Steward'],
  funding: ['Steward', 'Visionary'],
  mentor: ['Operator', 'Visionary', 'Steward'],
  advisor: ['Operator', 'Steward', 'Analyst'],
  hiring: ['Builder', 'Artisan', 'Operator'],
  talent: ['Builder', 'Artisan', 'Operator'],
  product: ['Visionary', 'Architect', 'Artisan'],
  data: ['Analyst'],
  legal: ['Steward'],
  finance: ['Steward'],
  community: ['Connector'],
  partner: ['Connector', 'Operator'],
  partnerhip: ['Connector', 'Operator'],
  customer: ['Connector', 'Operator'],
  user: ['Analyst', 'Artisan'],
  feedback: ['Analyst', 'Artisan'],
};

export const ARCHETYPES = [
  'Visionary',
  'Architect',
  'Builder',
  'Artisan',
  'Operator',
  'Connector',
  'Analyst',
  'Steward',
];

const ARCHETYPE_SIGNALS = {
  Visionary: ['founder', 'cofounder', 'co-founder', 'ceo', 'vision', 'strategy', 'storytelling', 'pitch', 'visionary', 'product manager', 'product lead'],
  Architect: ['architect', 'systems', 'platform', 'infrastructure', 'technical lead', 'cto', 'scalability', 'backend architect', 'solution architect'],
  Builder: ['developer', 'engineer', 'programmer', 'software', 'react', 'node', 'python', 'flutter', 'android', 'ios', 'fullstack', 'full stack', 'typescript', 'golang', 'rust'],
  Artisan: ['designer', 'design', 'figma', 'ux', 'ui', 'brand', 'creative', 'illustrator', 'motion'],
  Operator: ['operator', 'operations', 'ops', 'project manager', 'process', 'delivery', 'scrum', 'chief of staff', 'hiring', 'people ops', 'customer success'],
  Connector: ['marketing', 'growth', 'sales', 'community', 'partnerships', 'content', 'social media', 'distribution', 'pr', 'business development'],
  Analyst: ['data', 'analyst', 'research', 'analytics', 'scientist', 'machine learning', 'statistics', 'economics', 'insight'],
  Steward: ['finance', 'legal', 'cfo', 'accountant', 'investor', 'risk', 'compliance', 'audit', 'law', 'fundraising'],
};

/**
 * Compatibility prior matrix (§18.3). Symmetric, diagonal deliberately < 1:
 * two of the same craft need a third thing to work.
 */
export const ARCHETYPE_PRIOR = {
  Visionary: { Visionary: 0.35, Architect: 0.8, Builder: 0.85, Artisan: 0.7, Operator: 0.75, Connector: 0.8, Analyst: 0.55, Steward: 0.5 },
  Architect: { Visionary: 0.8, Architect: 0.4, Builder: 0.7, Artisan: 0.55, Operator: 0.8, Connector: 0.6, Analyst: 0.75, Steward: 0.65 },
  Builder: { Visionary: 0.85, Architect: 0.7, Builder: 0.3, Artisan: 0.75, Operator: 0.7, Connector: 0.65, Analyst: 0.6, Steward: 0.45 },
  Artisan: { Visionary: 0.7, Architect: 0.55, Builder: 0.75, Artisan: 0.35, Operator: 0.6, Connector: 0.8, Analyst: 0.45, Steward: 0.4 },
  Operator: { Visionary: 0.75, Architect: 0.8, Builder: 0.7, Artisan: 0.6, Operator: 0.3, Connector: 0.75, Analyst: 0.65, Steward: 0.8 },
  Connector: { Visionary: 0.8, Architect: 0.6, Builder: 0.65, Artisan: 0.8, Operator: 0.75, Connector: 0.3, Analyst: 0.5, Steward: 0.45 },
  Analyst: { Visionary: 0.55, Architect: 0.75, Builder: 0.6, Artisan: 0.45, Operator: 0.65, Connector: 0.5, Analyst: 0.35, Steward: 0.7 },
  Steward: { Visionary: 0.5, Architect: 0.65, Builder: 0.45, Artisan: 0.4, Operator: 0.8, Connector: 0.45, Analyst: 0.7, Steward: 0.4 },
};

const EXEC_ARCHETYPES = new Set(['Builder', 'Operator', 'Architect']);

/* ------------------------------------------------------------------ *
 * Corpus / IDF (§3 L2: "intent features are weighted by rarity")
 * ------------------------------------------------------------------ */

const EMPTY_CORPUS = {
  n: 0,
  df: new Map(),
  idf(token) {
    return 1;
  },
};

/**
 * Build the document-frequency table over a pool of profiles. Rare tokens
 * ("cold-chain") earn a high idf; "ai" sits on the floor. This single change is
 * what stops every card reading the same generic 20%.
 */
export function buildCorpus(profiles = [], { now = Date.now() } = {}) {
  return buildCorpusFromFacets(profiles.filter(Boolean).map((profile) => profile.__facets || deriveFacets(profile, { now })));
}

/** Same table, from facets you already extracted (the common case in rankPool). */
export function buildCorpusFromFacets(facetsList = []) {
  const df = new Map();
  let n = 0;
  for (const facets of facetsList) {
    if (!facets) continue;
    n += 1;
    const seen = new Set([
      ...facets.voltageTokens.map((token) => token.token),
      ...facets.domains,
      ...facets.functionSkills,
      ...facets.needs,
    ]);
    for (const token of seen) df.set(token, (df.get(token) || 0) + 1);
  }
  return {
    n,
    df,
    idf(token) {
      if (!n) return 1;
      const frequency = df.get(token) || 1;
      return round3(clamp(Math.log(1 + n / frequency), 0.2, 3));
    },
  };
}

/* ------------------------------------------------------------------ *
 * Facet extraction — free text into structure, once per profile
 * ------------------------------------------------------------------ */

const CAPACITY_RANK = { fulltime: 0, 'full-time': 0, allin: 0, 'all in': 0, parttime: 2, 'part-time': 2, sideproject: 3, 'side project': 3, weekends: 3 };

const SCALE_BUCKET = {
  unicorn: 'venture',
  venture: 'venture',
  'venture-scale': 'venture',
  high: 'venture',
  lifestyle: 'small',
  'small business': 'small',
  bootstrap: 'small',
  impact: 'impact',
  'not sure': 'unsure',
  unsure: 'unsure',
};

const RISK_RANK = { cautious: 0, balanced: 1, moderate: 1, aggressive: 2, bold: 2 };

const capRankOf = (profile) => {
  const commitment = normalizeText(profile?.commitmentLevel);
  const availability = normalizeText(profile?.availability);
  if (availability.includes('25') || availability.includes('20+') || availability.includes('30')) return 1;
  if (availability.includes('all in') || availability.includes('full')) return 0;
  if (availability.includes('weekend') || availability.includes('5 h')) return 3;
  if (availability.includes('10-15') || availability.includes('10–15') || availability.includes('part')) return 2;
  if (commitment in CAPACITY_RANK) return CAPACITY_RANK[commitment];
  const squashed = commitment.replace(/[\s-]/g, '');
  if (squashed in CAPACITY_RANK) return CAPACITY_RANK[squashed];
  return null;
};

const timezoneOffsetOf = (profile) => {
  const raw = normalizeText(profile?.timezone);
  const match = raw.match(/utc\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/);
  if (match) {
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) + Number(match[3] || 0) / 60);
  }
  const numeric = Number(raw);
  return Number.isFinite(numeric) && raw !== '' ? numeric : null;
};

const archetypeOf = (profile, skillTokens) => {
  const haystack = [
    profile?.occupation,
    profile?.company,
    profile?.bio,
    ...asArray(profile?.skills),
    ...Object.values(profile?.roleAnswers || {}).flatMap((value) => asArray(value)),
  ]
    .map(normalizeText)
    .join(' | ');
  const tokens = new Set([...tokenize(haystack), ...skillTokens]);

  let best = null;
  let bestScore = 0;
  for (const archetype of ARCHETYPES) {
    const signals = ARCHETYPE_SIGNALS[archetype];
    let score = 0;
    for (const signal of signals) {
      if (signal.includes(' ')) {
        if (haystack.includes(signal)) score += 2;
      } else if (tokens.has(signal)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      best = archetype;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
};

const classifySkills = (rawSkills) => {
  const functionSkills = [];
  const domains = [];
  for (const raw of rawSkills) {
    const value = normalizeText(raw);
    if (!value) continue;
    if (FUNCTION_SKILLS.has(value)) functionSkills.push(value);
    else if (DOMAIN_SKILLS.has(value)) domains.push(value);
    else {
      const words = value.split(' ');
      if (words.some((word) => FUNCTION_SKILLS.has(word))) functionSkills.push(value);
      else domains.push(value);
    }
  }
  return { functionSkills: unique(functionSkills), skillDomains: unique(domains) };
};

/**
 * Turn a LINKUP `UserProfile` into the facet bundle the scorer consumes.
 * Cached by the caller; pure here.
 */
export function deriveFacets(profile = {}, { now = Date.now() } = {}) {
  const skills = asArray(profile.skills).map(normalizeText).filter(Boolean);
  const interests = asArray(profile.interests).map(normalizeText).filter(Boolean);
  const industries = asArray(profile.industries).map(normalizeText).filter(Boolean);
  const lookingFor = asArray(profile.lookingFor).map(normalizeText).filter(Boolean);

  const { functionSkills, skillDomains } = classifySkills([...skills, ...interests]);
  const domains = unique([...industries, ...skillDomains]);

  const projects = asArray(profile.projects);
  const projectText = projects
    .map((project) => `${project?.title || ''} ${project?.description || ''} ${asArray(project?.tags).join(' ')}`)
    .join(' ');

  const goalsText = [profile.goals, profile.bio, projectText].filter(Boolean).join(' ');
  const goalTokens = tokenize(profile.goals);
  const bioTokens = tokenize(profile.bio);
  const projectTokens = tokenize(projectText);
  const interestTokens = tokenize(interests.join(' '));

  /** Voltage tokens: the concrete nouns a person chooses about their own work. */
  const voltage = new Map();
  const addVoltage = (tokens, weight) => {
    for (const token of tokens) voltage.set(token, Math.max(voltage.get(token) || 0, weight));
  };
  addVoltage([...goalTokens, ...projectTokens], 1.0);
  addVoltage(tokenize(skills.join(' ')), 0.6);
  addVoltage(bioTokens, 0.3);
  addVoltage([...industries, ...interestTokens], 0.2);
  const voltageTokens = Array.from(voltage, ([token, weight]) => ({ token, weight })).sort((a, b) => b.weight - a.weight);

  const needs = unique([
    ...lookingFor,
    ...tokenize(profile.goals).filter((token) => ROLE_LABELS.includes(token)),
    ...Object.values(profile.roleAnswers || {})
      .flatMap((value) => asArray(value))
      .map(normalizeText)
      .filter((value) => ROLE_LABELS.includes(value)),
  ]);

  const offers = unique([...functionSkills, ...domains, ...(profile.occupation ? [normalizeText(profile.occupation)] : [])]).filter(Boolean);

  const archetype = archetypeOf(profile, [...functionSkills, ...skills]);

  const streak = Number(profile.streakCount) || 0;
  const shipCount = Number(profile.shipCount) || 0;
  const shipLogs = asArray(profile.shipLogs).length;
  const shipped = Math.max(shipCount, shipLogs, asArray(profile.resume?.shippedProducts).length);
  const lastShippedDays = daysSince(profile.lastShippedAt, now);
  const lastActiveDays = daysSince(profile.lastActiveAt, now);
  const createdAtDays = daysSince(profile.createdAt, now);

  return {
    uid: String(profile.uid || ''),
    displayName: String(profile.displayName || profile.name || 'this builder').trim(),
    archetype,
    occupation: normalizeText(profile.occupation),
    company: normalizeText(profile.company),
    city: normalizeText(profile.city),
    country: normalizeText(profile.country),
    timezoneOffset: timezoneOffsetOf(profile),
    remoteOnly: profile.remoteOnly === true,
    willingToRelocate: profile.willingToRelocate === true,

    functionSkills,
    domains,
    offers,
    needs,

    voltageTokens,
    voltageSet: new Set(voltageTokens.map((token) => token.token)),

    // The Work Style Card (§19.1), when the member opted in. Its capacity answer
    // beats the profile's coarse commitment level, because they chose it on purpose.
    workStyleCard: profile.workStyleCard ? workStyleAxes(profile.workStyleCard) : null,
    capacityRank: profile.workStyleCard?.capacity
      ? CAPACITY_FROM_CARD[profile.workStyleCard.capacity] ?? capRankOf(profile)
      : capRankOf(profile),
    asyncTolerant: /async|remote|written/.test(normalizeText(profile.workStyle)) || profile.remoteOnly === true,
    workStyle: normalizeText(profile.workStyle),
    roleAnswers: Object.values(profile.roleAnswers || {}).flatMap((value) => asArray(value)).map(normalizeText).filter(Boolean),
    stage: normalizeText(profile.startupStage),
    fundingStage: normalizeText(profile.fundingStage),
    teamSize: normalizeText(profile.teamSizePreference),
    personalityType: normalizeText(profile.personalityType),

    scale: SCALE_BUCKET[normalizeText(profile.ambition)] || SCALE_BUCKET[normalizeText(profile.fundingStage)] || null,
    riskRank: normalizeText(profile.ambition) in RISK_RANK ? RISK_RANK[normalizeText(profile.ambition)] : null,

    execution: {
      streak,
      shipped,
      shipLogs,
      hasExit: profile.hasExit === true,
      verified: profile.isVerified === true,
      lastShippedDays,
      lastActiveDays,
      createdAtDays,
      responseRate: Number(profile.reputationMetrics?.responseRate),
      reliability: Number(profile.reputationMetrics?.reliability),
      evidence: {
        activity: Number(profile.streakCount) > 0 || !!profile.lastActiveAt,
        shipping: Number(profile.shipCount) > 0 || asArray(profile.shipLogs).length > 0 || !!profile.lastShippedAt || asArray(profile.resume?.shippedProducts).length > 0,
        trust: (profile.reputationMetrics?.responseRate !== undefined && profile.reputationMetrics?.responseRate !== null) || (profile.reputationMetrics?.reliability !== undefined && profile.reputationMetrics?.reliability !== null),
      },
    },

    // Values are opt-in data. When absent they stay null and the axis is
    // renormalised away, so nobody is judged on a question they never answered.
    redLines: unique(
      [
        ...asArray(profile.redLines),
        ...asArray(profile.wontBuild),
        ...asArray(profile.roleAnswers?.wontBuild),
      ]
        .map(normalizeText)
        .filter(Boolean)
    ),
    audience: asArray(profile.audience).map(normalizeText).filter(Boolean),
    qualityBar: Number.isFinite(Number(profile.qualityBar)) && profile.qualityBar !== undefined
      ? clamp01(Number(profile.qualityBar))
      : null,

    learnFor: {
      lookingFor,
      networkingIntent: normalizeText(profile.networkingIntent),
    },
  };
}

/* ------------------------------------------------------------------ *
 * L0 — eligibility. Never learned, never purchased, never LLM-decided.
 * ------------------------------------------------------------------ */

export function eligibility(viewer, candidate, options = {}) {
  const { contactedWithinDays = 30, now = Date.now() } = options;
  const reject = (reason) => ({ eligible: false, reason });

  if (!candidate || !candidate.uid) return reject('no_candidate');
  if (!viewer || !viewer.uid) return reject('no_viewer');
  if (candidate.uid === viewer.uid) return reject('self');
  if (candidate.onboarded === false) return reject('not_onboarded');
  if (candidate.isVisible === false) return reject('not_visible');
  if (candidate.isStealthMode === true) return reject('stealth');
  if (candidate.settings?.stealthMode === true) return reject('stealth');
  if (candidate.isBot === true) return reject('bot');
  if (candidate.banned === true || candidate.deleted === true) return reject('removed');
  if (Array.isArray(viewer.blocked) && viewer.blocked.includes(candidate.uid)) return reject('blocked');
  if (Array.isArray(candidate.blocked) && candidate.blocked.includes(viewer.uid)) return reject('blocked');

  const contactedAt = toMillis(options.contactedAt);
  if (contactedAt && now - contactedAt < contactedWithinDays * 86400000) {
    // Demoted, not removed: they may still be worth a second reason.
    return { eligible: true, reason: 'recently_contacted', demote: true };
  }
  return { eligible: true, reason: 'ok', demote: false };
}

/**
 * Cheap multi-channel recall over an already-fetched pool. The deterministic
 * scorer still decides the final order; this stage prevents a large pool from
 * being truncated by one signal and reserves a fixed exploration slice.
 */
export function selectRecallCandidates(viewer, candidates = [], { limit = 300, now = Date.now() } = {}) {
  const valid = candidates.filter((candidate) => candidate?.uid && candidate.uid !== viewer?.uid);
  const target = Math.max(1, Math.floor(limit));
  if (valid.length <= target) return valid;

  const vf = deriveFacets(viewer, { now });
  const facets = new Map(valid.map((candidate) => [candidate.uid, deriveFacets(candidate, { now })]));
  const corpus = buildCorpusFromFacets([vf, ...facets.values()]);
  const domainScore = (a, b) => weightedJaccard(new Set(a.domains), new Set(b.domains), (token) => corpus.idf(token)) ?? 0;
  const intentRows = [];
  const roleRows = [];
  const localRows = [];
  const explorationRows = [];
  const day = Math.floor(now / 86400000);
  const hash = (value) => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
    return h >>> 0;
  };

  for (const candidate of valid) {
    const f = facets.get(candidate.uid);
    intentRows.push({ candidate, score: needFit(vf, f) ?? 0 });
    const sharedDomain = domainScore(vf, f);
    const functionGap = jaccard(vf.functionSkills, f.functionSkills);
    const rolePrior = vf.archetype && f.archetype ? ARCHETYPE_PRIOR[vf.archetype]?.[f.archetype] ?? 0.5 : 0.5;
    roleRows.push({ candidate, score: (0.4 * sharedDomain) + (0.35 * (functionGap === null ? 0.5 : 1 - functionGap)) + 0.25 * rolePrior });
    const geo = geographyScore(vf, f);
    localRows.push({ candidate, score: geo ?? 0 });
    explorationRows.push({ candidate, score: hash(`${viewer?.uid || ''}:${day}:${candidate.uid}`) });
  }

  const chosen = new Map();
  const take = (rows, count, descending = true) => {
    rows.sort((a, b) => descending ? b.score - a.score : a.score - b.score);
    for (const row of rows) {
      if (chosen.size >= target || chosen.size >= count) break;
      if (chosen.has(row.candidate.uid)) continue;
      chosen.set(row.candidate.uid, row.candidate);
    }
  };
  const intentBudget = Math.floor(target * 0.3);
  const roleBudget = Math.floor(target * 0.25);
  const localBudget = Math.floor(target * 0.1);
  const explorationBudget = Math.floor(target * 0.15);
  take(intentRows, intentBudget);
  take(roleRows, intentBudget + roleBudget);
  take(localRows, intentBudget + roleBudget + localBudget);
  take(explorationRows, intentBudget + roleBudget + localBudget + explorationBudget, false);
  take([...roleRows, ...intentRows, ...localRows], target);
  return Array.from(chosen.values());
}

/* ------------------------------------------------------------------ *
 * Feature families (Part I §3 L2)
 * ------------------------------------------------------------------ */

export const FIT_WEIGHTS = {
  intent: 0.26,
  complement: 0.18,
  domain: 0.12,
  execution: 0.12,
  commitment: 0.1,
  style: 0.06,
  geo: 0.06,
  social: 0.06,
  freshness: 0.04,
  trust: 0.15, // penalty magnitude
  fatigue: 0.1, // penalty magnitude
};

/** Probability calibration: features are centred on 0.5 before the sigmoid. */
const FIT_SCALE = 6.0;
const FIT_BIAS = -0.7;

const weightedJaccard = (leftSet, rightSet, idf) => {
  if (!leftSet.size || !rightSet.size) return null;
  let intersection = 0;
  let union = 0;
  for (const token of leftSet) {
    const weight = idf(token);
    union += weight;
    if (rightSet.has(token)) intersection += weight;
  }
  for (const token of rightSet) {
    if (!leftSet.has(token)) union += idf(token);
  }
  if (union <= 0) return null;
  return round3(intersection / union);
};

const jaccard = (left, right) => {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return null;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return round3(intersection / (a.size + b.size - intersection));
};

const needFit = (from, to) => {
  if (!from.needs.length) return null;
  let total = 0;
  let sum = 0;
  for (const need of from.needs) {
    const satisfiers = NEED_SATISFIED_BY[need];
    const weight = 1;
    sum += weight;
    if (!to.archetype) {
      total += weight * 0.5;
      continue;
    }
    if (!satisfiers) {
      // An unknown need still counts: a cofounder ask should not be ignored
      // just because the label is new.
      total += weight * (to.archetype === from.archetype ? 0.45 : 0.7);
      continue;
    }
    if (satisfiers.includes(to.archetype)) {
      const prior = from.archetype ? ARCHETYPE_PRIOR[from.archetype]?.[to.archetype] ?? 0.7 : 0.75;
      total += weight * prior;
    } else {
      total += weight * 0.25;
    }
  }
  return round3(total / sum);
};

const executionScore = (facets) => {
  const e = facets.execution;
  const parts = [];
  if (e.evidence?.activity) parts.push([0.34, saturate(e.streak, 10) * decay(e.lastActiveDays ?? 30, 30)]);
  if (e.evidence?.shipping) parts.push([0.3, saturate(e.shipped, 2) * decay(e.lastShippedDays ?? 60, 45)]);
  if (e.evidence?.trust) {
    const values = [e.responseRate, e.reliability].filter(Number.isFinite).map((value) => clamp01(value / 100));
    if (values.length) parts.push([0.22, values.reduce((sum, value) => sum + value, 0) / values.length]);
  }
  const weight = parts.reduce((sum, [w]) => sum + w, 0);
  return weight ? round3(clamp01(parts.reduce((sum, [w, value]) => sum + w * value, 0) / weight)) : null;
};

const timezoneOverlap = (a, b) => {
  if (a.timezoneOffset === null || b.timezoneOffset === null) return null;
  const delta = Math.abs(a.timezoneOffset - b.timezoneOffset);
  // Waking hours 08:00–22:00 = 14 h; a 4 h shared window saturates.
  return round3(clamp01(1 - Math.max(0, delta - 0) / 8));
};

const capacityFit = (a, b) => {
  if (a.capacityRank === null || b.capacityRank === null) return null;
  return round3(clamp01(1 - Math.abs(a.capacityRank - b.capacityRank) / 3));
};

const geographyScore = (a, b) => {
  if (a.city && b.city && a.city === b.city) return 1;
  if (a.country && b.country && a.country === b.country) return 0.8;
  const tz = timezoneOverlap(a, b);
  if (tz !== null) return round3(clamp01(0.45 + 0.25 * tz));
  if ((!a.city || !b.city) && (!a.country || !b.country)) return null;
  return 0.4;
};

const styleScore = (a, b) => {
  const parts = [];
  if (a.workStyle && b.workStyle) parts.push(a.workStyle === b.workStyle ? 1 : 0.55);
  const shared = jaccard(a.roleAnswers, b.roleAnswers);
  if (shared !== null) parts.push(shared);
  if (a.personalityType && b.personalityType) parts.push(a.personalityType === b.personalityType ? 0.9 : 0.6);
  if (!parts.length) return null;
  return round3(parts.reduce((sum, value) => sum + value, 0) / parts.length);
};

const freshnessScore = (facets) => {
  const { lastActiveDays, createdAtDays } = facets.execution;
  const parts = [];
  if (lastActiveDays !== null) parts.push([0.6, decay(lastActiveDays, 14)]);
  if (createdAtDays !== null) parts.push([0.4, createdAtDays <= 14 ? 1 : decay(createdAtDays - 14, 45)]);
  const weight = parts.reduce((sum, [w]) => sum + w, 0);
  return weight ? round3(clamp01(parts.reduce((sum, [w, value]) => sum + w * value, 0) / weight)) : null;
};

/**
 * The nine families, each in [0,1], plus a `known` flag so unknown families are
 * renormalised away rather than silently counted as neutral.
 */
export function featureFamilies(a, b, context = {}) {
  const corpus = context.corpus || EMPTY_CORPUS;
  const idf = (token) => corpus.idf(token);

  const domainOverlap = weightedJaccard(new Set(a.domains), new Set(b.domains), idf);
  const functionGapRaw = jaccard(a.functionSkills, b.functionSkills);
  const functionGap = functionGapRaw === null ? null : round3(clamp01(1 - functionGapRaw));

  const complement =
    domainOverlap === null && functionGap === null
      ? null
      : round3(clamp01((0.45 + 0.55 * (domainOverlap ?? 0.5)) * Math.min(0.9, functionGap ?? 0.6)));

  const intentAB = needFit(a, b);
  const intentBA = needFit(b, a);
  const intent = intentAB === null && intentBA === null ? null : round3(((intentAB ?? 0.5) + (intentBA ?? 0.5)) / 2);

  const social = Number.isFinite(context.mutualConnections)
    ? round3(clamp01(context.mutualConnections / 3))
    : null;

  const trustSource = [
    a.execution.responseRate,
    b.execution.responseRate,
    a.execution.reliability,
    b.execution.reliability,
  ].filter((value) => Number.isFinite(value));
  const trust = trustSource.length
    ? round3(clamp01(Math.sqrt(Math.max(...trustSource) / 100) * 0.5 + Math.sqrt(trustSource.reduce((sum, v) => sum + v, 0) / trustSource.length / 100) * 0.5))
    : null;

  const ignores = Number(context.impressionsIgnored) || 0;
  const fatigue = ignores > 0 ? round3(clamp01(ignores / 4)) : 0;

  const families = {
    intent,
    complement,
    domain: domainOverlap,
    execution: (() => {
      const known = [executionScore(a), executionScore(b)].filter(Number.isFinite);
      return known.length ? round3(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
    })(),
    commitment: capacityFit(a, b),
    style: styleScore(a, b),
    geo: geographyScore(a, b),
    social,
    freshness: (() => {
      const known = [freshnessScore(a), freshnessScore(b)].filter(Number.isFinite);
      return known.length ? round3(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
    })(),
  };

  const penalties = {
    trust,
    fatigue,
  };

  return { families, penalties, directional: { intentAB, intentBA }, extras: { domainOverlap, functionGap } };
}

/**
 * Fit probability for one direction: "how much would `viewer` act on `candidate`".
 * `side` selects which directional intent feature to use.
 */
export function fitProbability(features, side = 'ab') {
  const { families, penalties } = features;
  let weightSum = 0;
  let total = 0;

  for (const [key, value] of Object.entries(families)) {
    if (key === 'intent') continue;
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    const weight = FIT_WEIGHTS[key] || 0;
    weightSum += weight;
    total += weight * (value - 0.5);
  }

  // Directional intent replaces the averaged one.
  const directional = side === 'ab' ? features.directional.intentAB : features.directional.intentBA;
  const intentValue = directional === null || directional === undefined ? families.intent : directional;
  if (intentValue !== null && intentValue !== undefined && Number.isFinite(intentValue)) {
    weightSum += FIT_WEIGHTS.intent;
    total += FIT_WEIGHTS.intent * (intentValue - 0.5);
  }

  if (weightSum <= 0) return 0.5;

  // Renormalise so a sparse profile cannot look like a perfect fit.
  let z = (total / weightSum) * FIT_SCALE + FIT_BIAS;

  // Penalty applies to the *absence* of trust, never to its presence.
  if (penalties.trust !== null && penalties.trust !== undefined) z -= FIT_WEIGHTS.trust * (1 - penalties.trust) * 2;
  z -= FIT_WEIGHTS.fatigue * (penalties.fatigue || 0) * 2;

  // Weak-evidence cap: fewer than 2 overlapping dimensions maps to ≤ 25 %.
  const overlapping = [features.extras.domainOverlap, families.commitment, families.style].filter(
    (value) => value !== null && value !== undefined && value > 0.5
  ).length;
  if (overlapping < 2) z = Math.min(z, Math.log(0.25 / 0.75));

  return round3(clamp01(sigmoid(z)));
}

/* ------------------------------------------------------------------ *
 * Chemistry axes (Part II §17) — the "will they keep choosing each other" half
 * ------------------------------------------------------------------ */

export const CHEM_WEIGHTS = {
  voltage: 0.2,
  shape: 0.18,
  rhythm: 0.16,
  safety: 0.12,
  ambition: 0.12,
  values: 0.12,
  effort: 0.1,
  ghostRisk: 0.1, // penalty
  crowding: 0.06, // penalty
};

const CHEM_SCALE = 5.5;
const CHEM_BIAS = -0.45;

const repairScore = { defend: 0.2, curious: 1, quiet: 0.5, test: 1 };

/** C1 — Voltage: rarity-weighted overlap of the concrete nouns they chose. */
export function voltageScore(a, b, corpus = EMPTY_CORPUS) {
  if (!a.voltageTokens.length || !b.voltageTokens.length) return null;
  // Rarity-weighted Jaccard over the union. Each side's weight says how
  // deliberately they chose the word (goals 1.0, skills 0.6, bio 0.3,
  // industries 0.2), so "AI" on both profiles is worth almost nothing while
  // "cold-chain" on both profiles is worth a lot.
  const weightA = new Map(a.voltageTokens.map((entry) => [entry.token, entry.weight]));
  const weightB = new Map(b.voltageTokens.map((entry) => [entry.token, entry.weight]));
  const tokens = new Set([...weightA.keys(), ...weightB.keys()]);
  let intersection = 0;
  let massA = 0;
  let massB = 0;
  for (const token of tokens) {
    if (!token || token.length < 3) continue;
    const idf = corpus.idf(token) || 1;
    const wa = weightA.get(token) || 0;
    const wb = weightB.get(token) || 0;
    intersection += idf * Math.min(wa, wb);
    massA += idf * wa;
    massB += idf * wb;
  }
  const smaller = Math.min(massA, massB);
  if (smaller <= 0) return null;
  // Overlap coefficient, not Jaccard: "how much of the smaller person's own
  // vocabulary does the other share". A shared long tail should not drown a
  // shared niche, which is exactly what plain Jaccard does on real bios.
  const overlap = clamp01(intersection / smaller);
  // Confidence: two people whose whole vocabulary is two shared words have not
  // demonstrated shared voltage, however tidy the ratio looks.
  const confidence = clamp01(smaller / 4);
  // Mild stretch: two people in the same niche should feel *seen*, and the axis
  // is only 20% of chemistry, so it must not be muted into meaninglessness.
  return round3(clamp01(Math.pow(overlap, 0.8) * confidence));
}

/** C2 — Shape: shared "what", different "how". The T-junction. */
export function shapeScore(a, b, corpus = EMPTY_CORPUS) {
  const domainOverlap = weightedJaccard(new Set(a.domains), new Set(b.domains), (token) => corpus.idf(token)) ?? 0.5;
  const functionGapRaw = jaccard(a.functionSkills, b.functionSkills);
  const functionGap = Math.min(0.9, functionGapRaw === null ? 0.6 : 1 - functionGapRaw);
  const rolePrior = a.archetype && b.archetype ? ARCHETYPE_PRIOR[a.archetype][b.archetype] : 0.65;
  return round3(clamp01((0.45 + 0.55 * domainOverlap) * functionGap * rolePrior));
}

/** C3 — Rhythm. The axis that kills more partnerships than skill ever does. */
export function rhythmScore(a, b) {
  const capacity = capacityFit(a, b);
  const tz = timezoneOverlap(a, b);
  const cadence = (() => {
    const aHours = Number.isFinite(a.cadenceHours) ? Math.max(1, a.cadenceHours) : null;
    const bHours = Number.isFinite(b.cadenceHours) ? Math.max(1, b.cadenceHours) : null;
    if (aHours === null || bHours === null) return null;
    return round3(clamp01(1 - Math.min(1, Math.abs(Math.log2(aHours / bHours)) / 2)));
  })();
  const asyncFit = a.asyncTolerant && b.asyncTolerant ? 1 : a.asyncTolerant || b.asyncTolerant ? 0.6 : 0.3;

  const parts = [
    [0.4, capacity],
    [0.3, tz],
    [0.2, this_safe(cadence, 0.5)],
    [0.1, asyncFit],
  ];
  let weightSum = 0;
  let total = 0;
  for (const [weight, value] of parts) {
    weightSum += weight;
    total += weight * (value === null || value === undefined ? 0.5 : value);
  }
  return round3(clamp01(total / weightSum));
}

const this_safe = (value, fallback) => (value === null || value === undefined || !Number.isFinite(value) ? fallback : value);

/** C4 — Safety: can they disagree without it becoming a thing? */
export function safetyScore(a, b) {
  const ca = a.workStyleCard;
  const cb = b.workStyleCard;
  const parts = [];

  if (ca?.feedbackStyle && cb?.feedbackStyle) {
    const same = ca.feedbackStyle === cb.feedbackStyle;
    const adjacent = ['direct|questions', 'questions|direct', 'careful|questions', 'questions|careful'].includes(`${ca.feedbackStyle}|${cb.feedbackStyle}`);
    parts.push([0.35, same ? 1 : adjacent ? 0.75 : 0.45]);
  }
  if (ca?.repair && cb?.repair) {
    parts.push([0.3, (repairScore[ca.repair] ?? 0.5) * (repairScore[cb.repair] ?? 0.5)]);
  }
  if (ca?.roleFlex !== undefined && cb?.roleFlex !== undefined) {
    parts.push([0.2, round3(clamp01(1 - Math.abs(ca.roleFlex - cb.roleFlex)))]);
  }
  const followA = clamp01(a.followThrough ?? 0.5);
  const followB = clamp01(b.followThrough ?? 0.5);
  parts.push([0.15, Math.min(followA, followB)]);

  let weightSum = 0;
  let total = 0;
  for (const [weight, value] of parts) {
    weightSum += weight;
    total += weight * value;
  }
  return weightSum ? round3(clamp01(total / weightSum)) : null;
}

/** C5 — Ambition symmetry: same size of dream, not the same dream. */
export function ambitionSymmetry(a, b) {
  const parts = [];
  if (a.scale && b.scale) {
    if (a.scale === b.scale) parts.push([0.35, 1]);
    else if (a.scale === 'unsure' || b.scale === 'unsure') parts.push([0.35, 0.85]);
    else if ((a.scale === 'venture' && b.scale === 'small') || (a.scale === 'small' && b.scale === 'venture')) parts.push([0.35, 0.35]);
    else parts.push([0.35, 0.7]);
  }
  if (Number.isFinite(a.runwayMonths) && Number.isFinite(b.runwayMonths)) {
    parts.push([0.25, round3(clamp01(1 - Math.min(1, Math.abs(Math.log10((a.runwayMonths + 1) / (b.runwayMonths + 1))))))]);
  }
  if (Number.isFinite(a.monthsToRevenue) && Number.isFinite(b.monthsToRevenue)) {
    parts.push([0.2, round3(clamp01(1 - Math.min(1, Math.abs(a.monthsToRevenue - b.monthsToRevenue) / 18)))]);
  }
  if (a.riskRank !== null && b.riskRank !== null) {
    parts.push([0.2, round3(clamp01(1 - Math.abs(a.riskRank - b.riskRank) / 2))]);
  }
  if (!parts.length) return null;
  const weightSum = parts.reduce((sum, [weight]) => sum + weight, 0);
  const total = parts.reduce((sum, [weight, value]) => sum + weight * value, 0);
  return round3(clamp01(total / weightSum));
}

/** C6 — Values adjacency. Red lines veto; taste is allowed to differ. */
export function valuesAdjacency(a, b) {
  const redA = new Set(a.redLines || []);
  const redB = new Set(b.redLines || []);
  let redLine = null;
  if (redA.size || redB.size) {
    let conflicts = 0;
    for (const line of redA) if (redB.has(line)) conflicts += 1;
    redLine = conflicts === 0 ? 1 : Math.max(0, 1 - conflicts / Math.max(redA.size, redB.size));
  }
  const audience = jaccard(a.audience || [], b.audience || []);
  const qualityA = Number.isFinite(a.qualityBar) ? a.qualityBar : null;
  const qualityB = Number.isFinite(b.qualityBar) ? b.qualityBar : null;
  const quality = qualityA !== null && qualityB !== null ? round3(clamp01(1 - Math.abs(qualityA - qualityB))) : null;

  const parts = [
    [0.5, redLine],
    [0.3, audience],
    [0.2, quality],
  ].filter(([, value]) => value !== null && value !== undefined);
  if (!parts.length) return null;
  const weightSum = parts.reduce((sum, [weight]) => sum + weight, 0);
  const total = parts.reduce((sum, [weight, value]) => sum + weight * value, 0);
  return round3(clamp01(total / weightSum));
}

/** C7 — Effort symmetry, measured from vitals once a pair has interacted. */
export function effortSymmetry(vitals) {
  if (!vitals) return null;
  const a = Number(vitals.initiativeShareA);
  const b = Number(vitals.initiativeShareB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // Harmonic, again: 0.9 / 0.2 reads as 0.33, which is the correct emotional read.
  return harmonic(clamp01(a), clamp01(b));
}

/** §18.4 — Chemistry killers, named so the copy can name them. */
export function detectKillers(a, b, axes) {
  const killers = [];

  const bothGenerals =
    ['Visionary', 'Connector'].includes(a.archetype) &&
    ['Visionary', 'Connector'].includes(b.archetype) &&
    !EXEC_ARCHETYPES.has(a.archetype) &&
    !EXEC_ARCHETYPES.has(b.archetype);
  if (bothGenerals) {
    killers.push({ id: 'two_generals', penalty: 0.18, repair: 'You both sell. Bring one builder into the first call.' });
  }

  const functionGapRaw = jaccard(a.functionSkills, b.functionSkills);
  if (functionGapRaw !== null && 1 - functionGapRaw < 0.25) {
    killers.push({ id: 'mirror_twins', penalty: 0.15, repair: 'Same craft — good for peer review, not a founding team.' });
  }

  if (axes.rhythm !== null && axes.rhythm < 0.4) {
    killers.push({ id: 'pace_collision', penalty: 0.12, repair: 'You two work at different speeds — decide a date, not a "let\'s see".' });
  }

  if (axes.safety !== null && axes.safety < 0.4 && a.workStyleCard?.repair === 'quiet' && b.workStyleCard?.repair === 'quiet') {
    killers.push({ id: 'politeness_trap', penalty: 0.1, repair: 'Neither of you says the hard thing first. Give your first task a real trade-off.' });
  }

  if (axes.ambition !== null && axes.ambition < 0.45) {
    killers.push({ id: 'runway_mismatch', penalty: 0.14, repair: 'Different scale in mind — make this an advice relationship, not a cofounder one.' });
  }

  if (a.archetype && a.archetype === b.archetype && a.occupation && a.occupation === b.occupation) {
    killers.push({ id: 'title_collision', penalty: 0.16, repair: 'Same title. Label this a peer intro, not a founding team.' });
  }

  return killers;
}

/** §18.5 — Bridging: a bonus for productive difference, never for demographics. */
export function bridgingBonus(a, b, corpus = EMPTY_CORPUS, mutualConnections = null) {
  const overlap = weightedJaccard(new Set(a.domains), new Set(b.domains), (token) => corpus.idf(token));
  if (overlap === null) return 0;
  const distance = 1 - overlap;
  if (distance < 0.45 || distance > 0.85) return 0;
  const density = Number.isFinite(mutualConnections) ? clamp01(mutualConnections / 3) : 0.5;
  return round3(0.06 * distance * (1 - density));
}

/**
 * The whole chemistry read for a pair: seven axes, killers, bridge, and the
 * two heads (spark / artifact) the ranker actually orders by.
 */
export function chemistryPair(a, b, context = {}) {
  const corpus = context.corpus || EMPTY_CORPUS;
  const vitals = context.vitals || null;

  const axes = {
    voltage: voltageScore(a, b, corpus),
    shape: shapeScore(a, b, corpus),
    rhythm: rhythmScore(a, b),
    safety: safetyScore(a, b),
    ambition: ambitionSymmetry(a, b),
    values: valuesAdjacency(a, b),
    effort: effortSymmetry(vitals),
  };

  if (axes.values === 0) {
    return { veto: 'red_lines', axes, killers: [], bridge: 0, chem: 0, spark: 0, artifact: 0, vitality: null };
  }

  const killers = detectKillers(a, b, axes);
  const bridge = bridgingBonus(a, b, corpus, context.mutualConnections);

  const entries = Object.entries(axes).filter(([, value]) => value !== null && value !== undefined && Number.isFinite(value));
  let weightSum = 0;
  let total = 0;
  for (const [key, value] of entries) {
    const weight = CHEM_WEIGHTS[key] || 0;
    weightSum += weight;
    total += weight * (value - 0.5);
  }
  const ghostRisk = Number(context.ghostRisk);
  let z = (weightSum ? total / weightSum : 0) * CHEM_SCALE + CHEM_BIAS + bridge;
  if (Number.isFinite(ghostRisk)) z -= CHEM_WEIGHTS.ghostRisk * ghostRisk * 2;

  for (const killer of killers) z -= killer.penalty;

  const chem = round3(clamp01(sigmoid(z)));

  // Two heads, one encoder (§18.2). Priors until R1–R4 labels exist.
  const sparkMix =
    0.34 * (axes.voltage ?? 0.5) +
    0.22 * (axes.rhythm ?? 0.5) +
    0.18 * (axes.safety ?? 0.5) +
    0.14 * (axes.values ?? 0.5) +
    0.12 * (axes.effort ?? 0.5);
  const sparkZ = CHEM_SCALE * (sparkMix - 0.5) + CHEM_BIAS - (Number.isFinite(ghostRisk) ? ghostRisk * 1.2 : 0);
  const spark = round3(clamp01(sigmoid(sparkZ)));

  const artifactMix =
    0.3 * (axes.shape ?? 0.5) +
    0.24 * (axes.ambition ?? 0.5) +
    0.2 * (axes.rhythm ?? 0.5) +
    0.16 * (axes.safety ?? 0.5) +
    0.1 * (executionScore(a) ?? 0.5) * (executionScore(b) ?? 0.5);
  const artifact = round3(clamp01(sigmoid(CHEM_SCALE * (artifactMix - 0.5) + CHEM_BIAS)));

  return {
    veto: null,
    axes,
    killers,
    bridge,
    chem,
    spark,
    artifact,
    vitality: vitals ? round3(clamp01(vitals.vitality)) : null,
  };
}

/* ------------------------------------------------------------------ *
 * L3 — Reciprocity
 * ------------------------------------------------------------------ */

/**
 * A match is only good if both people would act. Harmonic mean, then a gentle
 * guard, so a 95/30 pair lands at 45 rather than 62.
 */
export function reciprocityGuard(fitAB, fitBA) {
  const sym = harmonic(fitAB, fitBA);
  // The harmonic mean already punishes one-sided pairs. The guard is a light
  // multiplier in [0.62, 1] so we do not punish the same asymmetry twice.
  return round3(0.62 + 0.38 * sym);
}

/**
 * Monotone recalibration applied once, to the *displayed band only*.
 * The priors above are deliberately conservative; this single number is what a
 * founder tunes first when real R1–R4 labels arrive. It cannot change the
 * order of two candidates (it is strictly increasing), only the band cut.
 */
export const DISPLAY_CALIBRATION = { scale: 1.45, shift: 0.3 };

export function calibrateDisplay(probability) {
  const p = clamp01(Number(probability) || 0);
  return round3(clamp01(sigmoid(Math.log(p / (1 - p || 1e-6)) * DISPLAY_CALIBRATION.scale + DISPLAY_CALIBRATION.shift)));
}

/* ------------------------------------------------------------------ *
 * The pair score — fit + chemistry + gating (§16)
 * ------------------------------------------------------------------ */

export const UTILITY_WEIGHTS = { fit: 0.35, spark: 0.25, artifact: 0.4 };

/**
 * Score one pair. Returns everything the rail, the card and the debug panel need.
 *
 * @param {object} a  viewer profile
 * @param {object} b  candidate profile
 * @param {object} [context] { corpus, now, vitals, mutualConnections, impressionsIgnored, contactedAt, ghostRisk }
 */
export function scorePair(a, b, context = {}) {
  const now = context.now || Date.now();
  const corpus = context.corpus || EMPTY_CORPUS;

  const facetsA = context.facetsA || a?.__facets || deriveFacets(a, { now });
  const facetsB = context.facetsB || b?.__facets || deriveFacets(b, { now });

  const features = featureFamilies(facetsA, facetsB, { ...context, corpus });
  const fitAB = fitProbability(features, 'ab');
  const fitBA = fitProbability(features, 'ba');
  const fit = harmonic(fitAB, fitBA);

  const chemistry = chemistryPair(facetsA, facetsB, { ...context, corpus });

  let utility = reciprocityGuard(fitAB, fitBA) *
    (UTILITY_WEIGHTS.fit * fit + UTILITY_WEIGHTS.spark * chemistry.spark + UTILITY_WEIGHTS.artifact * chemistry.artifact);
  const feedbackStatus = context.feedback?.status;
  if (feedbackStatus === 'not_relevant') utility *= 0.65;
  else if (feedbackStatus === 'contacted') utility *= 0.9;
  else if (feedbackStatus === 'relevant') utility *= 1.05;
  utility = round3(clamp01(utility));

  const gated = fit < 0.3 || chemistry.veto !== null;
  const display = calibrateDisplay(utility);
  const band = bandOf(chemistry.veto ? 0 : display);

  const result = {
    uid: facetsB.uid,
    viewerUid: facetsA.uid,
    modelVersion: MODEL_VERSION,
    fit: round3(fit),
    fitAB,
    fitBA,
    direction: { ab: fitAB, ba: fitBA },
    chem: chemistry.chem,
    spark: chemistry.spark,
    artifact: chemistry.artifact,
    utility,
    axes: chemistry.axes,
    killers: chemistry.killers,
    bridge: chemistry.bridge,
    veto: chemistry.veto,
    gated,
    display,
    band,
    slot: null,
    features: features.families,
    penalties: features.penalties,
    facetsA,
    facetsB,
    ledger: buildLedger(facetsA, facetsB, features, chemistry, corpus),
  };
  result.slot = slotFor(result);
  return result;
}

/* ------------------------------------------------------------------ *
 * L5 — Display: bands, never percentages
 * ------------------------------------------------------------------ */

export const BANDS = [
  { id: 'strong', min: 0.7, label: 'Strong fit', line: 'Both of you are looking for exactly this' },
  { id: 'good', min: 0.45, label: 'Good fit', line: 'Complementary skills, same market' },
  { id: 'worth_a_look', min: 0.25, label: 'Worth a look', line: 'One shared signal worth a question' },
  { id: 'hidden', min: 0, label: 'Not a fit yet', line: '' },
];

export function bandOf(probability) {
  const value = clamp01(Number(probability) || 0);
  return BANDS.find((band) => value >= band.min) || BANDS[BANDS.length - 1];
}

/* ------------------------------------------------------------------ *
 * L4 — The evidence ledger. The only thing copy may cite.
 * ------------------------------------------------------------------ */

const quoteFor = (value, limit = 90) => String(value || '').trim().slice(0, limit);

export function buildLedger(a, b, features, chemistry, corpus = EMPTY_CORPUS) {
  const atoms = [];
  const push = (atom) => {
    if (atom) atoms.push({ id: atoms.length ? `${atom.type}:${atoms.length}` : `${atom.type}:0`, ...atom });
  };

  // Shared vocabulary — rarest first, because "AI" is not a shared signal.
  const shared = [];
  const aTokens = new Map(a.voltageTokens.map((entry) => [entry.token, entry.weight]));
  for (const entry of b.voltageTokens) {
    if (!aTokens.has(entry.token)) continue;
    const idf = corpus.idf(entry.token);
    if (idf < 0.6) continue;
    shared.push({ token: entry.token, weight: round3(idf * Math.min(entry.weight, aTokens.get(entry.token))) });
  }
  shared.sort((left, right) => right.weight - left.weight);
  for (const entry of shared.slice(0, 3)) {
    push({ type: 'shared_voltage', value: entry.token, weight: entry.weight, kind: 'shared' });
  }

  const sharedDomains = a.domains.filter((domain) => b.domains.includes(domain));
  for (const domain of sharedDomains.slice(0, 2)) {
    push({ type: 'shared_domain', value: domain, weight: corpus.idf(domain), kind: 'shared' });
  }

  // Complement — the gap each one fills, which is the reason to talk.
  const onlyA = a.functionSkills.filter((skill) => !b.functionSkills.includes(skill));
  const onlyB = b.functionSkills.filter((skill) => !a.functionSkills.includes(skill));
  if (onlyA.length && onlyB.length) {
    push({
      type: 'complementary_craft',
      value: `${a.functionSkills[0] || a.archetype || 'build'} ↔ ${b.functionSkills[0] || b.archetype || 'build'}`,
      aOffers: onlyA.slice(0, 3),
      bOffers: onlyB.slice(0, 3),
      weight: features.extras.functionGap ?? 0.5,
      kind: 'complement',
    });
  }

  if (a.archetype && b.archetype) {
    push({
      type: 'archetype_pair',
      value: `${a.archetype} × ${b.archetype}`,
      weight: ARCHETYPE_PRIOR[a.archetype]?.[b.archetype] ?? 0.6,
      kind: 'complement',
    });
  }

  if (features.directional.intentAB !== null && features.directional.intentAB > 0.55) {
    push({ type: 'need_met', value: a.needs.slice(0, 2).join(', ') || 'what you asked for', weight: features.directional.intentAB, kind: 'complement' });
  }
  if (features.directional.intentBA !== null && features.directional.intentBA > 0.55) {
    push({ type: 'need_met_reverse', value: b.needs.slice(0, 2).join(', ') || 'what they asked for', weight: features.directional.intentBA, kind: 'shared' });
  }

  if (Number.isFinite(features.families.social)) {
    push({ type: 'mutual_connections', value: Math.round(features.families.social * 3), weight: features.families.social, kind: 'shared' });
  }
  if (features.families.geo >= 0.8) {
    push({ type: 'same_place', value: a.city && a.city === b.city ? a.city : a.country || 'same country', weight: features.families.geo, kind: 'shared' });
  }
  if (a.capacityRank !== null && b.capacityRank !== null) {
    push({ type: 'capacity', value: `${capacityLabel(a.capacityRank)} × ${capacityLabel(b.capacityRank)}`, weight: features.families.commitment, kind: 'shared' });
  }

  if (Math.abs(a.cadenceHours || 0) && Math.abs(b.cadenceHours || 0)) {
    const ratio = Math.abs(Math.log2(Math.max(1, a.cadenceHours) / Math.max(1, b.cadenceHours)));
    if (ratio > 1) push({ type: 'tempo_gap', value: `${Math.round(a.cadenceHours)}h × ${Math.round(b.cadenceHours)}h`, weight: round3(clamp01(ratio / 2)), kind: 'difference' });
  }

  for (const killer of chemistry.killers || []) {
    push({ type: 'killer', value: killer.id, repair: killer.repair, weight: killer.penalty, kind: 'difference' });
  }

  if (chemistry.bridge > 0) {
    push({ type: 'bridge', value: 'different field, same ambition', weight: chemistry.bridge, kind: 'difference' });
  }

  return atoms;
}

export const capacityLabel = (rank) =>
  ({ 0: 'all in', 1: '25 h+/week', 2: '10–15 h/week', 3: 'a few hours at weekends' }[rank] ?? 'unspecified capacity');

export const BANNED_COPY = [
  'match',
  '%',
  'perfect',
  'soulmate',
  'synergy',
  'chemistry',
  'vibes',
  'compatible',
  'destined',
  'ai-powered',
  'revolutionary',
  'astrology',
];


/* ------------------------------------------------------------------ *
 * L4 — what a language model is allowed to do with the ranking
 * ------------------------------------------------------------------ */

export const TIE_BREAK_BAND = 6; // display points (0–100)

/**
 * Apply a proposed order, but only as a sequence of swaps between neighbours
 * whose scores are inside the tie-break band. A model can shuffle a tie; it
 * can never promote a weak card over a strong one.
 */
export function applyBandedOrder(rows, order, band = TIE_BREAK_BAND) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(order) || !order.length) return [...(rows || [])];
  const ranked = [...rows];
  const desired = new Map(order.map((uid, index) => [uid, index]));
  const displayOf = (row) => (Number.isFinite(row.display) ? row.display : Number.isFinite(row.score) ? row.score : Math.round((row.utility || 0) * 100));

  const original = new Map(rows.map((row, index) => [row.uid, index]));
  let changed = true;
  let guard = 0;
  while (changed && guard < ranked.length * ranked.length) {
    changed = false;
    guard += 1;
    for (let index = 0; index < ranked.length - 1; index += 1) {
      const left = ranked[index];
      const right = ranked[index + 1];
      const leftWant = desired.get(left.uid) ?? original.get(left.uid) ?? index;
      const rightWant = desired.get(right.uid) ?? original.get(right.uid) ?? index + 1;
      const withinBand = Math.abs(displayOf(left) - displayOf(right)) <= band;
      const sameBand = !left.band?.id || !right.band?.id || left.band.id === right.band.id;
      const oneStepEach = Math.abs(index + 1 - original.get(left.uid)) <= 1 && Math.abs(index - original.get(right.uid)) <= 1;
      if (leftWant > rightWant && withinBand && sameBand && oneStepEach) {
        ranked[index] = right;
        ranked[index + 1] = left;
        changed = true;
      }
    }
  }
  return ranked;
}

/**
 * A reason survives only if it cites an atom from the pair's own ledger and
 * carries no banned token. A reason that cites nothing is worse than no reason.
 */
export function citesLedger(reason, atoms = []) {
  const value = normalizeText(reason);
  if (!value || value.length < 12) return false;
  if (BANNED_COPY.some((token) => value.includes(token))) return false;
  const reasonWords = new Set(value.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  return atoms.some((atom) => {
    const evidence = normalizeText(atom?.value).replace(/[^a-z0-9\s]/g, ' ').trim();
    if (!evidence) return false;
    if (evidence.includes(' ')) return value.includes(evidence);
    return evidence.length > 4 && reasonWords.has(evidence);
  });
}

/**
 * Parse the model's answer and keep only the defensible parts: known uids, a
 * permutation (no invented people), and reasons that cite real evidence.
 */
export function parseModelAnswer(text, rows = []) {
  const start = String(text || '').indexOf('{');
  const end = String(text || '').lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  let parsed;
  try {
    parsed = JSON.parse(String(text).slice(start, end + 1));
  } catch {
    return null;
  }

  const allowed = new Set(rows.map((row) => row.uid));
  if (!Array.isArray(parsed?.order) || parsed.order.length !== rows.length) return null;
  const order = parsed.order.map(String);
  if (new Set(order).size !== rows.length || order.some((uid) => !allowed.has(uid))) return null;
  const reasons = parsed?.reasons && typeof parsed.reasons === 'object' ? parsed.reasons : {};

  const cleanReasons = {};
  for (const row of rows) {
    const candidate = reasons[row.uid];
    if (typeof candidate === 'string' && citesLedger(candidate, row.ledger || [])) {
      cleanReasons[row.uid] = candidate.trim().slice(0, 160);
    }
  }

  return { order, reasons: cleanReasons };
}

/* ------------------------------------------------------------------ *
 * Copy — deterministic templates. The LLM may replace these, never invent past them.
 * ------------------------------------------------------------------ */


export function assertCopyClean(text) {
  const value = normalizeText(text);
  const hit = BANNED_COPY.find((token) => value.includes(token));
  return hit ? { clean: false, token: hit } : { clean: true, token: null };
}

const firstName = (facets) => String(facets?.displayName || 'this builder').trim().split(/\s+/)[0] || 'this builder';

const sharedLine = (ledger) => {
  const atom = ledger.find((entry) => entry.type === 'shared_voltage') || ledger.find((entry) => entry.type === 'shared_domain');
  if (!atom) return null;
  return atom.value;
};

const complementLine = (ledger) => {
  const atom = ledger.find((entry) => entry.type === 'complementary_craft') || ledger.find((entry) => entry.type === 'archetype_pair');
  if (!atom) return null;
  return atom;
};

/**
 * Which portfolio slot a pair belongs in (§24), decided once at scoring time:
 *  - wildcard  = different field, same ambition (a surprise, not a bug)
 *  - mirror    = same craft, different context (peer review)
 *  - complement = shared "what", different "how"
 */
export function slotFor(score) {
  const complementScore = score.features?.complement ?? 0.5;
  const domainOverlap = score.features?.domain ?? null;
  const differentField = domainOverlap !== null && domainOverlap <= 0.34;
  if (differentField && score.bridge > 0 && score.fit >= 0.25) return 'wildcard';
  if (complementScore < 0.45) return 'mirror';
  return 'complement';
}

const TINY_TASKS = {
  mirror: (name) => `Swap one number each: ${name} sends their hardest metric, you send yours. 20 minutes, then compare.`,
  complement: (name) => `Each writes the three biggest blockers you'd hit in the other's shoes. ${name} goes first. 20 minutes.`,
  wildcard: (name) => `A 10-minute call where ${name} describes the last time a tool like yours failed them. Record it.`,
};

export function composeCard(score, options = {}) {
  const a = score.facetsA;
  const b = score.facetsB;
  const ledger = score.ledger || [];
  const name = firstName(b);
  const slot = options.slot || score.slot || slotFor(score);
  const sharedAtom = ledger.find((entry) => entry.type === 'shared_voltage') || ledger.find((entry) => entry.type === 'shared_domain');
  const complementAtom = ledger.find((entry) => entry.type === 'complementary_craft') || ledger.find((entry) => entry.type === 'archetype_pair');
  const killer = ledger.find((entry) => entry.type === 'killer');
  const tempo = ledger.find((entry) => entry.type === 'tempo_gap');

  const phrase = (token) => String(token || '').replace(/-/g, ' ');
  const sharedSubject = sharedAtom ? phrase(sharedAtom.value) : phrase(a.domains[0] || b.domains[0] || 'the same problem');
  const theirCraft = complementAtom?.bOffers?.[0] || b.functionSkills[0] || b.archetype?.toLowerCase() || 'a different craft';
  const yourCraft = complementAtom?.aOffers?.[0] || a.functionSkills[0] || a.archetype?.toLowerCase() || 'yours';

  const why = {
    shared: sharedAtom
      ? `You both keep coming back to ${sharedSubject}.`
      : `You're both building in ${sharedSubject}.`,
    complement: complementAtom
      ? `${name} brings ${theirCraft}; you bring ${yourCraft}.`
      : `${name} covers the part you'd otherwise have to learn alone.`,
  };

  // The opener must end on a specific, low-cost ask (design §22.1).
  const opener = `${name} has spent real time on ${sharedSubject}. Ask what they'd do differently about ${phrase(yourCraft)} — 15 minutes, one question?`

  const tinyTask =
    score.fit >= 0.45
      ? `Each writes the three biggest blockers you'd hit in the other's shoes. ${name} goes first. 20 minutes.`
      : TINY_TASKS[slot](name);

  const cites = [sharedAtom?.id, complementAtom?.id].filter(Boolean);

  const card = {
    slot,
    headline: killer ? 'Different shapes, worth a question' : bandOf(score.display ?? score.utility).label,
    why,
    opener: opener.slice(0, 240),
    tiny_task: tinyTask.slice(0, 120),
    agenda: [
      `What each of you is stuck on this week`,
      `One thing ${name} tried that you haven't`,
      `A date for the next step — not a "let's see"`,
    ],
    tempo_note: tempo
      ? `You work at different speeds — ${name} answers on a different clock. End the first call with a date.`
      : null,
    repair: killer?.repair || null,
    cites,
    tone: 'warm',
  };

  // Belt and braces: no copy leaves this file with a banned token in it.
  for (const value of [card.opener, card.why.shared, card.why.complement, card.tiny_task, card.headline]) {
    const check = assertCopyClean(value);
    if (!check.clean) {
      card.headline = 'Worth a conversation';
      card.opener = `${name} is working on ${sharedSubject}. Worth 15 minutes to compare notes?`;
      card.why.shared = `You share ${sharedSubject}.`;
      card.why.complement = `${name} brings a craft you don't.`;
      card.tiny_task = TINY_TASKS[slot](name);
      break;
    }
  }

  return card;
}

/* ------------------------------------------------------------------ *
 * Portfolio composition (§24) and diversity (§3 L5)
 * ------------------------------------------------------------------ */

const similar = (left, right) => {
  const a = left.facetsB;
  const b = right.facetsB;
  const overlap = (x, y) => {
    if (!x.length || !y.length) return 0;
    const set = new Set(y);
    return x.filter((value) => set.has(value)).length / Math.max(x.length, y.length);
  };
  return 0.5 * overlap(a.domains, b.domains) + 0.3 * overlap(a.functionSkills, b.functionSkills) + 0.2 * (a.archetype === b.archetype ? 1 : 0);
};

/** Maximal marginal relevance: two clones back to back is a bug, not fate. */
export function mmr(scored, { k = 20, lambda = 0.75 } = {}) {
  const pool = [...scored];
  const picked = [];
  while (pool.length && picked.length < k) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      const redundancy = picked.length ? Math.max(...picked.map((item) => similar(item, candidate))) : 0;
      const value = lambda * candidate.utility - (1 - lambda) * redundancy;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    picked.push(pool.splice(bestIndex, 1)[0]);
  }
  return picked;
}

/**
 * Mirror / Complement / Wildcard. Three different reasons, not three near-copies.
 * Degrades to two honest cards under ~30 eligible people rather than padding.
 */
export function composePortfolio(scored, { k = 3, poolSize = scored.length } = {}) {
  const eligible = scored.filter((score) => !score.gated && score.veto === null && score.band.id !== 'hidden');
  if (!eligible.length) return [];

  const ranked = mmr(eligible, { k: Math.max(k * 3, 12) });

  const mirror = ranked
    .filter((score) => (score.features.complement ?? 1) < 0.45)
    .sort((left, right) => right.fit - left.fit)[0];

  const complement = ranked
    .filter((score) => (score.features.complement ?? 0) >= 0.55 && (score.features.commitment ?? 0.5) >= 0.6)
    .sort((left, right) => right.utility - left.utility)[0];

  const wildcard = ranked
    .filter((score) => score.bridge > 0 && score.fit >= 0.25)
    .sort((left, right) => right.spark - left.spark)[0];

  const chosen = [];
  const seen = new Set();
  const add = (score, slot) => {
    if (!score || seen.has(score.uid)) return;
    seen.add(score.uid);
    chosen.push({ ...score, slot });
  };

  add(complement, 'complement');
  add(mirror, 'mirror');
  if (poolSize >= 30) add(wildcard, 'wildcard');

  // Fill to k with the highest-utility leftovers, still avoiding an archetype repeat.
  for (const score of ranked) {
    if (chosen.length >= k) break;
    if (seen.has(score.uid)) continue;
    const repeated = chosen.some(
      (item) =>
        item.facetsB.archetype &&
        score.facetsB.archetype &&
        item.facetsB.archetype === score.facetsB.archetype &&
        item.slot !== 'wildcard'
    );
    if (repeated && poolSize >= 30) continue;
    add(score, score.bridge > 0 ? 'wildcard' : 'complement');
  }

  return chosen.slice(0, k);
}

/**
 * Stable allocation (§3 L3): with capacity k per viewer, the same three people
 * cannot be handed to everybody. Greedy over the global best edges — deterministic
 * for a given input, which is what makes "your pick refreshed" a rotation not a lottery.
 */
export function stableAllocation(edges, { capacity = 3 } = {}) {
  const sorted = [...edges].sort((left, right) => right.score - left.score);
  const taken = new Map();
  const used = new Map();
  const result = [];

  for (const edge of sorted) {
    const forViewer = used.get(edge.viewer) || new Set();
    if (forViewer.has(edge.candidate)) continue;
    const load = taken.get(edge.candidate) || 0;
    if (load >= capacity) continue;
    taken.set(edge.candidate, load + 1);
    forViewer.add(edge.candidate);
    used.set(edge.viewer, forViewer);
    result.push(edge);
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Part II §21 — the courtship state machine
 * ------------------------------------------------------------------ */

export const PAIR_STATES = [
  'mutual_yes',
  'greeted',
  'sparked',
  'scheduled',
  'met',
  'building',
  'compounding',
  'parked',
  'declined',
];

const HOUR = 3600000;
const DAY = 86400000;

/**
 * Next best action for a pair. One nudge per stalled state, ever — no escalation.
 * Returns `{ state, action, dueAt, copy }` where action is a verb the UI can render.
 */
export function nextPairAction(pair = {}, now = Date.now()) {
  const state = PAIR_STATES.includes(pair.state) ? pair.state : 'mutual_yes';
  const nudged = new Set(pair.nudged || []);
  const at = (value) => (Number.isFinite(value) ? value : toMillis(value));

  switch (state) {
    case 'mutual_yes':
      return {
        state,
        action: 'open_thread',
        dueAt: now,
        copy: 'Open with the one question you actually want answered.',
      };
    case 'greeted': {
      const greetedAt = at(pair.greetedAt) || now;
      if (now - greetedAt > 36 * HOUR && !nudged.has('greeted')) {
        return {
          state,
          action: 'nudge_silent_side',
          dueAt: greetedAt + 36 * HOUR,
          copy: 'One nudge, aimed at the quiet side, that adds something small to reply to.',
        };
      }
      return { state, action: 'wait', dueAt: greetedAt + 36 * HOUR, copy: 'Give it a day.' };
    }
    case 'sparked': {
      const lastMsg = at(pair.lastMessageAt) || now;
      if (now - lastMsg > 72 * HOUR) {
        return {
          state: 'parked',
          action: 'graceful_close',
          dueAt: lastMsg + 72 * HOUR,
          copy: "This one didn't catch — which happens more than anyone admits. Closing the thread so nobody is left hanging.",
        };
      }
      return { state, action: 'propose_first_object', dueAt: lastMsg + 72 * HOUR, copy: 'Propose the smallest thing worth making together (20 minutes).' };
    }
    case 'scheduled': {
      const scheduledAt = at(pair.scheduledAt) || now;
      return { state, action: 'supply_agenda', dueAt: scheduledAt + 7 * DAY, copy: 'Five lines of agenda, so the call is not a vibe check.' };
    }
    case 'met': {
      const metAt = at(pair.metAt) || now;
      if (now - metAt > 48 * HOUR && !nudged.has('met')) {
        return { state, action: 'ask_outcome', dueAt: metAt + 48 * HOUR, copy: 'Would you work with them again? Yes / maybe in a different shape / no.' };
      }
      return { state, action: 'propose_w2', dueAt: metAt + 48 * HOUR, copy: 'Propose one shared object: a one-page spec, a frame, an API stub.' };
    }
    case 'building': {
      const artefactAt = at(pair.artefactAt) || now;
      if (now - artefactAt > 30 * DAY) {
        return { state, action: 'propose_w3', dueAt: artefactAt + 30 * DAY, copy: 'A joint experiment with a deadline: five user interviews, a paid pilot, a demo by Friday.' };
      }
      return { state, action: 'celebrate_object', dueAt: artefactAt + 30 * DAY, copy: 'Name the object they made. Not the streak — the object.' };
    }
    case 'compounding':
      return { state, action: 'propose_bigger_commitment', dueAt: now + 30 * DAY, copy: 'They have made two things. Ask about a scope and an end date.' };
    case 'parked': {
      const reviveAt = at(pair.reviveAt);
      if (reviveAt && reviveAt <= now && pair.revivalSignal) {
        return { state: 'mutual_yes', action: 'revive_once', dueAt: now, copy: 'Something concrete changed. Reopen with the change, not with "it has been a while".' };
      }
      return { state, action: 'stay_parked', dueAt: reviveAt || now + 90 * DAY, copy: 'Parked. Nothing lost, and nothing owed.' };
    }
    case 'declined':
      return { state, action: 'nothing', dueAt: null, copy: 'Nothing to the other side beyond "not this time".' };
    default:
      return { state, action: 'wait', dueAt: now, copy: '' };
  }
}

/** §46 — the four endings. All graceful, all recorded. */
export function endingFor(pair = {}) {
  if (pair.state === 'complete') return { id: 'complete', copy: "You two made a thing. That's the whole point." };
  if (pair.state === 'parked') return { id: 'paused', copy: 'Parked. Nothing lost.' };
  if (pair.state === 'closed_well') return { id: 'closed_well', copy: "Ended because it wasn't the right shape. Nothing about you is on record." };
  if (pair.state === 'closed_hard') return { id: 'closed_hard', copy: '' };
  return null;
}

/* ------------------------------------------------------------------ *
 * §20 — Conversation vitals. Metadata only. Never text.
 * ------------------------------------------------------------------ */

/**
 * @param {Array<{from:string, at:number, length?:number, hasQuestion?:boolean}>} messages
 */
export function computeVitals(messages = [], now = Date.now()) {
  if (!Array.isArray(messages) || messages.length < 2) {
    return { turnBalance: 0, questionDensity: 0, latencyFit: 0, momentum: 0, followThrough: 0, vitality: 0, asOf: now, empty: true };
  }

  const sorted = [...messages].sort((left, right) => (left.at || 0) - (right.at || 0));
  const bySender = new Map();
  for (const message of sorted) {
    const key = String(message.from || 'unknown');
    bySender.set(key, (bySender.get(key) || 0) + 1);
  }
  const counts = Array.from(bySender.values());
  const turnBalance = counts.length < 2 ? 0 : round3(Math.min(...counts) / Math.max(...counts));

  const questions = sorted.filter((message) => message.hasQuestion === true).length;
  const questionDensity = round3(questions / sorted.length);

  const latencyFor = (sender) => {
    const latency = [];
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].from === sender) latency.push((sorted[index].at || 0) - (sorted[index - 1].at || 0));
    }
    if (!latency.length) return null;
    latency.sort((left, right) => left - right);
    return Math.max(1, latency[Math.floor(latency.length / 2)]);
  };
  const senders = Array.from(bySender.keys());
  const latA = latencyFor(senders[0]);
  const latB = senders[1] ? latencyFor(senders[1]) : null;
  const latencyFit = latA && latB ? round3(clamp01(1 - Math.min(1, Math.abs(Math.log2(latA / latB)) / 2))) : null;

  const lengths = sorted.map((message) => Number(message.length) || 0);
  const head = lengths.slice(0, 3);
  const tail = lengths.slice(-4);
  const avg = (list) => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0);
  const momentum = head.length && tail.length && avg(head) > 0 ? round3(clamp01(avg(tail) / avg(head) / 2)) : 0;

  const promises = Number(messages.promisesDetected ?? 0);
  const followed = Number(messages.promisesKept ?? 0);
  const followThrough = promises > 0 ? round3(clamp01(followed / promises)) : null;

  const vitality = round3(
    clamp01(
      0.3 * turnBalance +
        0.25 * Math.min(1, questionDensity / 0.35) +
        0.2 * (latencyFit ?? 0.5) +
        0.15 * momentum +
        0.1 * (followThrough ?? 0.5)
    )
  );

  return {
    turnBalance,
    questionDensity,
    latencyFit,
    momentum,
    followThrough,
    vitality,
    asOf: now,
    empty: false,
  };
}

/** Three human states. Never a number in front of a member (§20). */
export function vitalityState(vitals) {
  if (!vitals || vitals.empty) return { id: 'warming_up', label: 'Warming up' };
  if (vitals.vitality >= 0.55) return { id: 'in_motion', label: 'In motion' };
  if (vitals.vitality >= 0.3) return { id: 'warming_up', label: 'Warming up' };
  return { id: 'gone_quiet', label: 'Gone quiet' };
}

/* ------------------------------------------------------------------ *
 * §19.1 — The Work Style Card (8 forced choices, opt-in, influence capped)
 * ------------------------------------------------------------------ */

export const WORK_STYLE_QUESTIONS = [
  {
    id: 'rebuild',
    prompt: 'When the plan breaks, I first…',
    options: [
      { id: 'rebuild', label: 'Rebuild the plan' },
      { id: 'build', label: 'Start building' },
      { id: 'ask', label: "Call someone who's done it" },
      { id: 'dig', label: 'Dig into why it broke' },
    ],
  },
  {
    id: 'focus',
    prompt: 'My best work happens…',
    options: [
      { id: 'blocks', label: 'In long uninterrupted blocks' },
      { id: 'bursts', label: 'In short bursts between conversations' },
      { id: 'deadline', label: 'Under a hard deadline' },
      { id: 'together', label: 'With someone else in the room' },
    ],
  },
  {
    id: 'role',
    prompt: "I'd rather be the one who…",
    options: [
      { id: 'owns', label: 'Decides and owns it' },
      { id: 'proposes', label: 'Proposes and lets others refine' },
      { id: 'implements', label: 'Implements what is decided' },
      { id: 'stress', label: 'Stress-tests everything' },
    ],
  },
  {
    id: 'feedback',
    prompt: 'My feedback tends to be…',
    options: [
      { id: 'direct', label: 'Blunt and fast' },
      { id: 'careful', label: 'Careful and specific' },
      { id: 'questions', label: 'Questions first' },
      { id: 'written', label: 'In writing, later' },
    ],
  },
  {
    id: 'repair',
    prompt: 'When a cofounder disagrees with me in front of others, my first instinct is to…',
    options: [
      { id: 'defend', label: 'Defend the decision' },
      { id: 'curious', label: 'Get curious' },
      { id: 'quiet', label: 'Go quiet and follow up 1:1' },
      { id: 'test', label: 'Suggest we test it' },
    ],
  },
  {
    id: 'ending',
    prompt: 'The thing that would end a partnership for me…',
    options: [
      { id: 'commitments', label: 'Missed commitments' },
      { id: 'honesty', label: 'Dishonesty' },
      { id: 'ambition', label: 'No ambition' },
      { id: 'respect', label: 'Disrespect' },
    ],
  },
  {
    id: 'twelve',
    prompt: 'In 12 months I want to be able to say…',
    options: [
      { id: 'customers', label: 'We have paying customers' },
      { id: 'product', label: 'We have the best product in the category' },
      { id: 'raised', label: 'We raised and hired' },
      { id: 'proud', label: "We built something we're proud of, whatever its size" },
    ],
  },
  {
    id: 'capacity',
    prompt: 'My honest capacity for the next 3 months…',
    options: [
      { id: 'allin', label: 'All in' },
      { id: 'twentyfive', label: '25 h+/week' },
      { id: 'fifteen', label: '10–15 h/week' },
      { id: 'weekends', label: 'A few hours at weekends' },
    ],
  },
];

export const WORK_STYLE_CARD_INTRO =
  'Eight taps. They only affect who we introduce you to and what we suggest you do first — never your visibility, your score, or what other people see.';

const CAPACITY_FROM_CARD = { allin: 0, twentyfive: 1, fifteen: 2, weekends: 3 };

/** Turn the card into the axes C4/C5 read. Unknown answers stay neutral. */
export function workStyleAxes(answers = {}) {
  const pick = (id) => answers?.[id] || null;
  return {
    feedbackStyle: pick('feedback'),
    repair: pick('repair'),
    roleFlex: null, // needs history; the app fills it once a card is edited twice
    capacityRank: CAPACITY_FROM_CARD[pick('capacity')] ?? null,
    scale: pick('twelve'),
    redLine: pick('ending'),
  };
}

/** ±3 positions inside the band, never more (§19.1). */
export const WORK_STYLE_MAX_POSITION_SHIFT = 3;

export function applyWorkStyleShift(position, shift) {
  const bounded = clamp(Math.round(shift), -WORK_STYLE_MAX_POSITION_SHIFT, WORK_STYLE_MAX_POSITION_SHIFT);
  return Math.max(0, position + bounded);
}

/* ------------------------------------------------------------------ *
 * One-call convenience for the app: rank a pool for one viewer.
 * ------------------------------------------------------------------ */

/**
 * Rank a candidate pool for a viewer, end to end: eligibility → score →
 * reciprocity → MMR → portfolio. Deterministic; no network, no model.
 */
export function rankPool(viewer, candidates = [], options = {}) {
  const now = options.now || Date.now();
  const limit = options.limit || 30;

  // Extract once, score many. Facet extraction is the only expensive step here.
  const viewerFacets = options.viewerFacets || deriveFacets(viewer, { now });
  const eligibleCandidates = candidates.filter((candidate) => candidate && eligibility(viewer, candidate, {
    now,
    contactedAt: options.contactedAt?.[candidate.uid],
    contactedWithinDays: options.contactedWithinDays ?? 30,
  }).eligible);
  const recalled = selectRecallCandidates(viewer, eligibleCandidates, { limit: options.recallLimit ?? 300, now });
  const pool = recalled.filter(Boolean).map((candidate) => ({
    profile: candidate,
    facets: deriveFacets(candidate, { now }),
  }));

  const corpus = options.corpus || buildCorpusFromFacets([viewerFacets, ...pool.map((entry) => entry.facets)]);

  const scored = [];
  for (const { profile: candidate, facets } of pool) {
    const gate = eligibility(viewer, candidate, {
      now,
      contactedAt: options.contactedAt?.[candidate.uid],
      contactedWithinDays: options.contactedWithinDays ?? 30,
    });
    if (!gate.eligible) continue;

    const score = scorePair(viewer, candidate, {
      corpus,
      now,
      facetsA: viewerFacets,
      facetsB: facets,
      mutualConnections: options.mutualConnections?.[candidate.uid],
      impressionsIgnored: options.impressionsIgnored?.[candidate.uid],
      vitals: options.vitals?.[candidate.uid],
      ghostRisk: options.ghostRisk?.[candidate.uid],
      feedback: options.feedback?.[candidate.uid],
    });

    if (gate.demote) score.utility = round3(score.utility * 0.6);
    score.recentlyContacted = !!gate.demote;
    scored.push(score);
  }

  scored.sort((left, right) => right.utility - left.utility);
  const diverse = mmr(scored, { k: limit, lambda: options.lambda ?? 0.75 });

  return {
    modelVersion: MODEL_VERSION,
    viewer: viewerFacets,
    corpusSize: corpus.n,
    scored,
    ranked: diverse,
    poolSize: scored.length,
  };
}

/* ------------------------------------------------------------------ *
 * Weekly 1-of-1 Mutual Co-Founder Matching
 *
 * Rules:
 *   1. Exactly ONE potential co-founder per week per builder.
 *   2. Strict symmetry: if A is shown to B as a potential co-founder,
 *      B is shown to A as their potential co-founder.
 *   3. Scored strictly by the LINKUP algorithm (fit + chemistry +
 *      reciprocity + evidence ledger) with bounded AI tie-breaking
 *      and explanation — never random or unvetted matches.
 * ------------------------------------------------------------------ */

const WEEK_MS = 7 * DAY;

/**
 * Compute the canonical Monday-to-Monday UTC week window and key (e.g. "2026-W45").
 */
export function cofounderWeekWindow(now = Date.now()) {
  const ts = Number.isFinite(now) ? now : Date.now();
  const date = new Date(ts);
  const utcDay = date.getUTCDay(); // 0 = Sun, 1 = Mon, ...
  const daysSinceMonday = (utcDay + 6) % 7;
  const start = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceMonday,
    0, 0, 0, 0
  );
  const end = start + WEEK_MS;
  // ISO week number calculation
  const thursday = new Date(start + 3 * DAY);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const weekNo = Math.ceil((((thursday.getTime() - yearStart) / DAY) + 1) / 7);
  const key = `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  const daysRemaining = Math.max(1, Math.ceil((end - ts) / DAY));
  return { key, start, end, daysRemaining };
}

export function cofounderPairId(uidA, uidB) {
  const a = String(uidA || '').trim();
  const b = String(uidB || '').trim();
  if (!a || !b || a === b) return '';
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

function fnv1aUnit(input) {
  const str = String(input || '');
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

const COFOUNDER_INTENT_RE = /\b(co-?founder|cofounder|technical partner|growth partner|cto|ceo|cpo|founding|partner|builder|startup)\b/i;

/**
 * Symmetrically score an unordered candidate pair {A, B} as potential co-founders.
 * Rejects any pair that fails eligibility, triggers a chemistry veto, or falls in the hidden band.
 */
export function scoreMutualCofounderPair(profileA, profileB, context = {}) {
  const now = context.now || Date.now();
  if (!profileA?.uid || !profileB?.uid || String(profileA.uid) === String(profileB.uid)) {
    return { eligible: false, reason: 'same_or_missing_uid' };
  }

  // Canonical ordering so {A, B} and {B, A} always produce identical pair metrics
  const [first, second] = String(profileA.uid) < String(profileB.uid)
    ? [profileA, profileB]
    : [profileB, profileA];

  const gateAB = eligibility(first, second, { now });
  if (!gateAB.eligible) return { eligible: false, reason: gateAB.reason };
  const gateBA = eligibility(second, first, { now });
  if (!gateBA.eligible) return { eligible: false, reason: gateBA.reason };

  const corpus = context.corpus || EMPTY_CORPUS;
  const facetsFirst = context.facetsMap?.get(first.uid) || first.__facets || deriveFacets(first, { now });
  const facetsSecond = context.facetsMap?.get(second.uid) || second.__facets || deriveFacets(second, { now });

  const scoreAB = scorePair(first, second, {
    ...context,
    now,
    corpus,
    facetsA: facetsFirst,
    facetsB: facetsSecond,
  });
  const scoreBA = scorePair(second, first, {
    ...context,
    now,
    corpus,
    facetsA: facetsSecond,
    facetsB: facetsFirst,
  });

  // Strict quality gate: no chemistry vetoes and must have real evidence in the ledger
  if (scoreAB.veto !== null || scoreBA.veto !== null) {
    return { eligible: false, reason: scoreAB.veto || scoreBA.veto || 'veto' };
  }

  const evidenceAtoms = [
    ...(scoreAB.ledger || []),
    ...(scoreBA.ledger || []),
  ].filter((atom) => atom.kind === 'shared' || atom.kind === 'complement');
  if (evidenceAtoms.length === 0) {
    return { eligible: false, reason: 'no_evidence' };
  }

  const mutualFit = round3(harmonic(scoreAB.fit, scoreBA.fit));
  const mutualUtility = round3(harmonic(scoreAB.utility, scoreBA.utility));

  // Co-founder complementarity bonus grounded in the pair's evidence ledger
  const ledgerTypes = new Set([
    ...(scoreAB.ledger || []).map((atom) => atom.type),
    ...(scoreBA.ledger || []).map((atom) => atom.type),
  ]);
  let complementBonus = 0;
  if (ledgerTypes.has('complementary_craft')) complementBonus += 0.08;
  if (ledgerTypes.has('archetype_pair')) complementBonus += 0.05;
  if (ledgerTypes.has('need_met') && ledgerTypes.has('need_met_reverse')) {
    complementBonus += 0.12;
  } else if (ledgerTypes.has('need_met') || ledgerTypes.has('need_met_reverse')) {
    complementBonus += 0.06;
  }
  if (ledgerTypes.has('shared_domain')) complementBonus += 0.07;
  if (ledgerTypes.has('shared_voltage')) complementBonus += 0.05;
  if (ledgerTypes.has('same_place')) complementBonus += 0.03;
  if (ledgerTypes.has('capacity')) complementBonus += 0.03;

  const aSeeksCofounder = COFOUNDER_INTENT_RE.test(
    `${(first.lookingFor || []).join(' ')} ${first.goals || ''} ${first.bio || ''}`
  );
  const bSeeksCofounder = COFOUNDER_INTENT_RE.test(
    `${(second.lookingFor || []).join(' ')} ${second.goals || ''} ${second.bio || ''}`
  );
  if (aSeeksCofounder && bSeeksCofounder) complementBonus += 0.04;

  const cofounderSynergy = round3(clamp01(mutualUtility + Math.min(0.32, complementBonus)));
  const display = Math.max(calibrateDisplay(cofounderSynergy), round3(clamp01(cofounderSynergy * 1.15)));
  const band = bandOf(display);
  if (band.id === 'hidden') {
    return { eligible: false, reason: 'below_quality_threshold' };
  }

  const cardForFirst = composeCard(scoreAB);
  const cardForSecond = composeCard(scoreBA);

  const firstOffers = (facetsFirst.functionSkills.length
    ? facetsFirst.functionSkills
    : [facetsFirst.archetype || first.occupation || 'Product & Execution']
  ).slice(0, 3);
  const secondOffers = (facetsSecond.functionSkills.length
    ? facetsSecond.functionSkills
    : [facetsSecond.archetype || second.occupation || 'Product & Execution']
  ).slice(0, 3);
  const sharedDomains = facetsFirst.domains
    .filter((domain) => facetsSecond.domains.includes(domain))
    .slice(0, 3);

  const pairId = cofounderPairId(first.uid, second.uid);

  return {
    eligible: true,
    pairId,
    uidA: first.uid,
    uidB: second.uid,
    profileA: first,
    profileB: second,
    mutualFit,
    mutualUtility,
    cofounderSynergy,
    display,
    score: Math.max(1, Math.min(100, Math.round(display * 100))),
    band,
    scoreAB,
    scoreBA,
    cardForA: cardForFirst,
    cardForB: cardForSecond,
    aOffers: firstOffers,
    bOffers: secondOffers,
    sharedDomains,
    whyMutual: [cardForFirst.why.shared, cardForFirst.why.complement].filter(Boolean).join(' '),
    firstSprintTask: cardForFirst.tiny_task || cardForSecond.tiny_task,
  };
}

/**
 * Global 1-to-1 symmetric co-founder assignment for a given week.
 *
 * Guarantees:
 *   - Capacity = 1 per person (at most one co-founder match per week).
 *   - Strict symmetry: if A is paired with B, B is paired with A.
 *   - Order-invariant: sorting profiles by uid first ensures the exact same
 *     disjoint pairs regardless of input array order.
 */
export function assignWeeklyCofounderPairs(profiles = [], options = {}) {
  const now = options.now || Date.now();
  const window = cofounderWeekWindow(now);
  const weekKey = String(options.weekKey || window.key);
  const previousPairIds = new Set(
    Array.isArray(options.previousPairIds)
      ? options.previousPairIds
      : options.previousPairIds instanceof Set
        ? Array.from(options.previousPairIds)
        : []
  );

  // Deduplicate and sort canonically by uid for order invariance
  const byId = new Map();
  for (const raw of profiles || []) {
    if (!raw?.uid) continue;
    const uid = String(raw.uid).trim();
    if (!uid || byId.has(uid)) continue;
    if (raw.deleted || raw.banned || raw.isStealthMode || raw.isVisible === false || raw.onboarded === false) continue;
    byId.set(uid, { ...raw, uid });
  }

  const canonicalProfiles = Array.from(byId.values()).sort((a, b) => a.uid.localeCompare(b.uid));
  const facetsMap = new Map();
  for (const profile of canonicalProfiles) {
    facetsMap.set(profile.uid, deriveFacets(profile, { now }));
  }
  const corpus = options.corpus || buildCorpusFromFacets(Array.from(facetsMap.values()));

  // Score all unordered pairs {u_i, u_j} with i < j
  const candidateEdges = [];
  for (let i = 0; i < canonicalProfiles.length; i += 1) {
    for (let j = i + 1; j < canonicalProfiles.length; j += 1) {
      const pA = canonicalProfiles[i];
      const pB = canonicalProfiles[j];
      const evaluated = scoreMutualCofounderPair(pA, pB, { now, corpus, facetsMap });
      if (!evaluated.eligible) continue;

      const repeatPenalty = previousPairIds.has(evaluated.pairId) ? 0.18 : 0;
      const weeklyTieBreak = fnv1aUnit(`${weekKey}:${evaluated.pairId}`) * 0.004;
      const effectiveUtility = round3(Math.max(0.01, evaluated.cofounderSynergy - repeatPenalty + weeklyTieBreak));

      candidateEdges.push({
        ...evaluated,
        effectiveUtility,
        effectiveDisplay: Math.round(effectiveUtility * 100),
      });
    }
  }

  // Primary sort by effectiveUtility descending, deterministic fallback by pairId
  candidateEdges.sort((left, right) => {
    if (right.effectiveUtility !== left.effectiveUtility) {
      return right.effectiveUtility - left.effectiveUtility;
    }
    return left.pairId.localeCompare(right.pairId);
  });

  // Optional bounded AI tie-break order on pairIds (within TIE_BREAK_BAND points)
  let orderedEdges = candidateEdges;
  if (Array.isArray(options.aiTieBreakOrder) && options.aiTieBreakOrder.length > 0) {
    const withUid = candidateEdges.map((edge) => ({ ...edge, uid: edge.pairId, display: edge.effectiveDisplay }));
    orderedEdges = applyBandedOrder(withUid, options.aiTieBreakOrder, TIE_BREAK_BAND);
  }

  const assignedUid = new Set();
  const selectedEdges = [];

  // Lock any pre-committed pairs for this week first
  if (Array.isArray(options.lockedPairs)) {
    for (const locked of options.lockedPairs) {
      const pid = cofounderPairId(locked?.uidA, locked?.uidB);
      if (!pid) continue;
      const found = orderedEdges.find((edge) => edge.pairId === pid);
      if (found && !assignedUid.has(found.uidA) && !assignedUid.has(found.uidB)) {
        assignedUid.add(found.uidA);
        assignedUid.add(found.uidB);
        selectedEdges.push(found);
      }
    }
  }

  // Greedy 1-to-1 symmetric matching over remaining builders
  for (const edge of orderedEdges) {
    if (assignedUid.has(edge.uidA) || assignedUid.has(edge.uidB)) continue;
    assignedUid.add(edge.uidA);
    assignedUid.add(edge.uidB);
    selectedEdges.push(edge);
  }

  // 1-pass augmenting swap to avoid stranding an unmatched builder when a 2-swap improves total utility
  const unmatchedUids = canonicalProfiles.map((p) => p.uid).filter((uid) => !assignedUid.has(uid));
  if (unmatchedUids.length > 0 && selectedEdges.length > 0) {
    const edgeLookup = new Map(orderedEdges.map((edge) => [edge.pairId, edge]));
    for (const u of unmatchedUids) {
      if (assignedUid.has(u)) continue;
      let bestSwap = null;
      for (let idx = 0; idx < selectedEdges.length; idx += 1) {
        const current = selectedEdges[idx];
        // Locked pairs cannot be swapped
        if (Array.isArray(options.lockedPairs) && options.lockedPairs.some((l) => cofounderPairId(l?.uidA, l?.uidB) === current.pairId)) {
          continue;
        }
        for (const [keepUid, freeUid] of [[current.uidA, current.uidB], [current.uidB, current.uidA]]) {
          const edgeUKeep = edgeLookup.get(cofounderPairId(u, keepUid));
          if (!edgeUKeep) continue;
          // See if freeUid can pair with another unmatched v != u
          for (const v of unmatchedUids) {
            if (v === u || assignedUid.has(v)) continue;
            const edgeFreeV = edgeLookup.get(cofounderPairId(freeUid, v));
            if (!edgeFreeV) continue;
            const gain = (edgeUKeep.effectiveUtility + edgeFreeV.effectiveUtility) - current.effectiveUtility;
            if (gain > 0 && (!bestSwap || gain > bestSwap.gain)) {
              bestSwap = { idx, edgeUKeep, edgeFreeV, u, v, gain };
            }
          }
        }
      }
      if (bestSwap) {
        selectedEdges.splice(bestSwap.idx, 1, bestSwap.edgeUKeep, bestSwap.edgeFreeV);
        assignedUid.add(bestSwap.u);
        assignedUid.add(bestSwap.v);
      }
    }
  }

  const byUid = {};
  for (const edge of selectedEdges) {
    const baseView = {
      pairId: edge.pairId,
      weekKey,
      weekStart: window.start,
      weekEnd: window.end,
      daysRemaining: window.daysRemaining,
      score: edge.score,
      display: edge.display,
      mutualFit: edge.mutualFit,
      mutualUtility: edge.mutualUtility,
      cofounderSynergy: edge.cofounderSynergy,
      band: edge.band,
      sharedDomains: edge.sharedDomains,
      symmetryVerified: true,
    };

    byUid[edge.uidA] = {
      ...baseView,
      viewerUid: edge.uidA,
      partnerUid: edge.uidB,
      partner: edge.profileB,
      why: edge.cardForA.why,
      reason: [edge.cardForA.why.shared, edge.cardForA.why.complement].filter(Boolean).join(' '),
      opener: edge.cardForA.opener,
      tinyTask: edge.cardForA.tiny_task,
      agenda: edge.cardForA.agenda,
      slot: edge.cardForA.slot,
      cites: edge.cardForA.cites,
      myOffers: edge.aOffers,
      partnerOffers: edge.bOffers,
    };

    byUid[edge.uidB] = {
      ...baseView,
      viewerUid: edge.uidB,
      partnerUid: edge.uidA,
      partner: edge.profileA,
      why: edge.cardForB.why,
      reason: [edge.cardForB.why.shared, edge.cardForB.why.complement].filter(Boolean).join(' '),
      opener: edge.cardForB.opener,
      tinyTask: edge.cardForB.tiny_task,
      agenda: edge.cardForB.agenda,
      slot: edge.cardForB.slot,
      cites: edge.cardForB.cites,
      myOffers: edge.bOffers,
      partnerOffers: edge.aOffers,
    };
  }

  return {
    weekKey,
    weekStart: window.start,
    weekEnd: window.end,
    daysRemaining: window.daysRemaining,
    pairs: selectedEdges,
    byUid,
  };
}

/**
 * Convenience helper: returns the viewer's single 1-of-1 mutual co-founder
 * for the current week from the pool `[viewer, ...candidates]`.
 */
export function selectWeeklyCofounderForViewer(viewer, candidates = [], options = {}) {
  if (!viewer?.uid) return null;
  const all = [viewer, ...(Array.isArray(candidates) ? candidates : [])];
  const assigned = assignWeeklyCofounderPairs(all, options);
  return assigned.byUid[String(viewer.uid)] || null;
}

