// LINKY WRITES YOUR PROFILE — a LINKUP PLUS feature.
//
// The member already told LINKUP everything: what they are building, the seat
// that is empty, their skills, their stage. What they cannot do is write about
// themselves well at 23:40 after a day of building. So Linky writes it, in the
// member's own voice, from the member's own facts — and the member reviews it
// before anything is saved.
//
// Rules, in order:
//   1. PLUS only. The gate is server-side (isPlusUser), never the UI alone.
//   2. Nothing invented. Every sentence has to be traceable to a field the
//      member filled in; when a field is empty the draft leaves it empty rather
//      than inventing a company, a traction number or a city.
//   3. The member's own words win. If they wrote a bio they like, Linky edits
//      it — tighter, in order, no added claims — rather than replacing it.
//   4. One save, explicit. `save: false` drafts; `save: true` writes only the
//      four profile fields plus a marker, so a rewrite can never touch tier,
//      matches, streak or settings.
//   5. Read before you write. The profile is graded first (assessProfileQuality).
//      A strong profile is told it is strong and left alone; a weak one hears
//      its gaps named, then Linky asks permission before drafting anything.
//      "Rewrite it anyway" is the only override, and it is the member's call.
//   6. Ask everything. Before drafting, Linky asks every onboarding question
//      the member never answered (missingProfileQuestions) — each with its
//      reason, because a complete brief earns a sharper profile and sharper
//      matches. Skipping is allowed; guessing instead of asking is not.
import { aiText } from './_gemini.js';

/** Words the model must not smuggle in. A paywall promise is not a fact. */
const BANNED = /\b(revolutionary|world-class|game-changing|disrupt|synergy|cutting-edge|visionary|serial entrepreneur|10x|guaranteed)\b/gi;

export const PROFILE_WRITER_FIELDS = Object.freeze(['headline', 'bio', 'skills', 'lookingFor']);

const clean = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

const list = (value, max, each = 40) => (Array.isArray(value) ? value : [])
  .map((entry) => clean(entry, each))
  .filter(Boolean)
  .slice(0, max);

export function profileWriterFacts(profile = {}) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const project = Array.isArray(p.projects) && p.projects[0] && typeof p.projects[0] === 'object' ? p.projects[0] : {};
  return {
    name: clean(p.displayName || p.fullName || '', 60),
    role: clean(p.occupation || '', 80),
    building: clean(p.buildingName || p.startupName || project.title || project.name || p.company || '', 90),
    oneLiner: clean(p.buildingOneLiner || p.tagline || project.oneLiner || project.description || '', 200),
    seat: clean(p.missingSeat || (Array.isArray(p.lookingFor) ? p.lookingFor[0] : ''), 90),
    stage: clean(p.startupStage || p.fundingStage || project.status || '', 40),
    city: clean(p.city, 60),
    country: clean(p.country, 60),
    skills: list(p.skills, 10),
    lookingFor: list(p.lookingFor, 4),
    goals: clean(p.goals, 400),
    bio: clean(p.bio, 700),
    industries: list(p.industries || p.interests, 8),
    experience: clean(p.experience, 60),
    fundingStage: clean(p.fundingStage, 40),
    commitmentLevel: clean(p.commitmentLevel, 60),
    workStyle: clean(p.workStyle, 60),
  };
}

/**
 * READ BEFORE YOU WRITE. Before Linky rewrites anything, it grades what is
 * already on the profile — the same four fields it would write (headline, bio,
 * skills, lookingFor) plus the facts a stranger reads beside them (what they
 * are building, their role, where they are, their stage). The verdict drives
 * the whole conversation:
 *
 *   strong  the profile already does its job. Linky says so, recommends
 *           keeping it, and will not draft a rewrite unless the member
 *           explicitly insists ("rewrite it anyway" → allowRewrite).
 *   patchy  the bones are there; the wording is not doing them justice.
 *   thin    there is not enough here for a stranger to trust yet.
 *
 * Deterministic and pure on purpose: the verdict costs no model call, so
 * Linky can always afford to look before it writes.
 */
export function assessProfileQuality(profile = {}) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const facts = profileWriterFacts(p);
  const headline = clean(p.headline, 90);
  const strengths = [];
  const gaps = [];
  let score = 0;

  // The one line a stranger reads before anything else. (16)
  if (headline.length >= 30) { score += 16; strengths.push(`A headline is doing the first-impression work: “${headline}”`); }
  else if (headline.length >= 12) { score += 10; gaps.push('The headline is short — it does not yet say what you are building and for whom.'); }
  else if (headline) { score += 5; gaps.push('The headline is only a few words — a stranger still has to guess what you do.'); }
  else gaps.push('No headline — the one line a stranger reads before anything else is blank.');

  // The bio: can a stranger trust this person after ten seconds? (26)
  if (facts.bio.length >= 160) { score += 26; strengths.push('The bio gives a stranger enough to start a real conversation.'); }
  else if (facts.bio.length >= 80) { score += 20; gaps.push('The bio is close — it stops just before it says who this is all for.'); }
  else if (facts.bio.length >= 40) { score += 12; gaps.push('The bio is a start, but it stops before it says who it is for.'); }
  else if (facts.bio) { score += 6; gaps.push('The bio is only a sentence — too thin for a stranger to trust it.'); }
  else gaps.push('No bio yet. A co-founder reads it before they read anything else.');

  // Skills: the proof the matcher can actually match on. (16)
  if (facts.skills.length >= 4) { score += 16; strengths.push(`${facts.skills.length} skills are listed, so the matcher has something real to match on.`); }
  else if (facts.skills.length === 3) { score += 13; strengths.push('Three skills are listed.'); }
  else if (facts.skills.length === 2) { score += 9; gaps.push('Only two skills are listed — the matcher needs more proof to work with.'); }
  else if (facts.skills.length === 1) { score += 5; gaps.push('Only one skill is listed — the matcher needs more proof to work with.'); }
  else gaps.push('No skills listed — the matcher cannot prove you fit any seat.');

  // The empty seat: can a visitor tell which chair is open? (14)
  if (facts.lookingFor.length >= 2) { score += 14; strengths.push(`The empty seats are named: ${facts.lookingFor.join(' and ')}.`); }
  else if (facts.lookingFor.length === 1) { score += 12; strengths.push(`The empty seat is named: ${facts.lookingFor[0]}.`); }
  else gaps.push('The empty seat is not named, so nobody knows which chair is open.');

  // The facts around the four fields. (12 + 6 + 5 + 5)
  if (facts.building) { score += 12; strengths.push(`${facts.building} is named, so nobody has to guess the project.`); }
  else gaps.push('The project is not named — people match with builds, not vibes.');
  if (facts.role) score += 6;
  else gaps.push('Your role is not stated.');
  if (facts.city || facts.country) { score += 5; strengths.push(`Based in ${facts.city || facts.country}${facts.city && facts.country ? `, ${facts.country}` : ''}.`); }
  else gaps.push('No city — builders nearby cannot find you.');
  if (facts.stage) score += 5;
  else gaps.push('Your stage is not stated, so nobody knows how far along this is.');

  const verdict = score >= 78 ? 'strong' : score >= 45 ? 'patchy' : 'thin';
  const recommendation = verdict === 'strong'
    ? 'Linky recommends keeping this profile. It already says what you are building, what you can do, and which seat is empty — a rewrite would trade your words for Linky’s.'
    : verdict === 'patchy'
      ? 'The bones are here. The wording is not doing them justice yet — Linky can tighten it without changing a single fact.'
      : 'There is not enough here for a stranger to trust yet. Linky can write it from what LINKUP already knows — and will not invent the rest.';

  const completeness = profileCompleteness(profile);
  return { verdict, score, strengths, gaps, recommendation, completeness, questions: missingProfileQuestions(profile) };
}

/**
 * ASK EVERYTHING. Before Linky writes, it asks for everything onboarding
 * asked — not just a bio. Every question below is a field onboarding
 * collects and the writer/matcher reads; every one carries its reason, so
 * the member hears why answering pays: a complete brief gets a sharper
 * profile AND sharper matches. Linky asks, encourages, and lets the member
 * skip — but it never writes from a half-empty brief without asking first.
 */
const QUESTION_DEFS = [
  { id: 'role', keys: ['occupation'], kind: 'text', prompt: 'What do you do?', why: 'Your role is the first filter every co-founder applies.', done: (p, f) => !!f.role },
  { id: 'building', keys: ['buildingName'], kind: 'text', prompt: 'What are you building?', why: 'People match with a build, not a vibe — Linky cannot write about a project it cannot name.', done: (p, f) => !!f.building },
  { id: 'oneLiner', keys: ['buildingOneLiner'], kind: 'text', prompt: 'Describe it in one line — what does it do, and for whom?', why: 'Your one-liner becomes the spine of your bio.', done: (p, f) => !!f.oneLiner },
  { id: 'seat', keys: ['missingSeat'], kind: 'text', prompt: 'Which seat is empty on your team?', why: 'Naming the empty seat is how the right person recognises themselves.', done: (p, f) => !!f.seat },
  { id: 'lookingFor', keys: ['lookingFor'], kind: 'list', prompt: 'Who are you looking for? (roles, separated by commas)', why: 'These roles tell LINKUP who to put in front of you.', done: (p, f) => f.lookingFor.length > 0 },
  { id: 'skills', keys: ['skills'], kind: 'list', prompt: 'What can you do? List at least three skills (separated by commas).', why: 'Skills are the proof the matcher matches on — no skills, no evidence, weak matches.', done: (p, f) => f.skills.length >= 3 },
  { id: 'industries', keys: ['industries'], kind: 'list', prompt: 'Which industries are you in? (separated by commas)', why: 'Industry overlap is one of the strongest signals for a good pairing.', done: (p, f) => f.industries.length > 0 },
  { id: 'stage', keys: ['startupStage'], kind: 'text', prompt: 'Where is your startup today — idea, MVP, live, revenue?', why: 'Stage tells people how far along they would be joining.', done: (p, f) => !!f.stage },
  { id: 'funding', keys: ['fundingStage'], kind: 'text', prompt: 'What is your funding stage — bootstrapped, pre-seed, seed?', why: 'Funding stage sets expectations before anyone says hello.', done: (p, f) => !!f.fundingStage },
  { id: 'goals', keys: ['goals'], kind: 'text', prompt: 'What is your main goal right now?', why: 'A stated goal keeps your profile pointed at one outcome.', done: (p, f) => !!f.goals },
  { id: 'city', keys: ['city'], kind: 'text', prompt: 'Which city are you based in?', why: 'Builders nearby find you — and can actually meet you — first.', done: (p, f) => !!f.city },
  { id: 'country', keys: ['country'], kind: 'text', prompt: 'Which country?', why: 'Country completes your place on the map people search.', done: (p, f) => !!f.country },
  { id: 'experience', keys: ['experience'], kind: 'text', prompt: 'How would you describe your experience level?', why: 'Experience level stops mismatched seniority before it starts.', done: (p, f) => !!f.experience },
  { id: 'commitment', keys: ['commitmentLevel'], kind: 'text', prompt: 'How committed are you — full-time, part-time, weekends?', why: 'Commitment mismatch kills more co-founder pairs than skill gaps do.', done: (p, f) => !!f.commitmentLevel },
  { id: 'workStyle', keys: ['workStyle'], kind: 'text', prompt: 'How do you like to work — solo, in pairs, in a team?', why: 'Work style is half of whether a pairing survives month two.', done: (p, f) => !!f.workStyle },
  { id: 'bio', keys: ['bio'], kind: 'text', prompt: 'Already have a bio? Paste it here.', why: 'Your own words in your own voice beat a cold start — Linky will tighten them, not replace them.', done: (p, f) => !!f.bio },
];

export const PROFILE_WRITER_QUESTION_COUNT = QUESTION_DEFS.length;

/** The onboarding questions this member has not answered yet. */
export function missingProfileQuestions(profile = {}) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const facts = profileWriterFacts(p);
  return QUESTION_DEFS
    .filter((q) => { try { return !q.done(p, facts); } catch { return true; } })
    .map(({ id, keys, kind, prompt, why }) => ({ id, keys, kind, prompt, why }));
}

/** How much of the onboarding brief is actually filled in. */
export function profileCompleteness(profile = {}) {
  const total = QUESTION_DEFS.length;
  const answered = total - missingProfileQuestions(profile).length;
  return { answered, total, percent: total ? Math.round((answered / total) * 100) : 0 };
}

/**
 * The prompt. Pure and exported so the "never invent" rule is testable without
 * a model call — the same discipline as the rest of this repo.
 */
export function buildProfileWriterPrompt(profile = {}) {
  const facts = profileWriterFacts(profile);
  const known = Object.entries(facts).filter(([, value]) => (Array.isArray(value) ? value.length : !!value));
  return [
    "You are Linky, the connector at LINKUP, writing a member's professional profile FOR them.",
    'Write in the first person, in plain English a busy founder would actually use. No adjectives that cannot be proved, no marketing register, no emoji, no markdown.',
    'HARD RULE: invent nothing. Every claim must come from FACTS below. If a fact is missing, leave it out — do not guess a company, a city, a customer, a number or a stage.',
    `FACTS: ${JSON.stringify(Object.fromEntries(known))}.`,
    facts.bio ? 'They already wrote a bio of their own. Keep their meaning and their voice, make it tighter and better ordered. Do not replace their story with yours.' : 'They have no bio yet. Write one from the facts.',
    'Return STRICT JSON only, no prose around it:',
    '{"headline":"one line, max 90 characters, what they are building and for whom","bio":"3 to 5 sentences, max 600 characters","skills":["3 to 8 short skills, drawn only from FACTS"],"lookingFor":["1 to 3 roles they need beside them, drawn only from FACTS"]}',
  ].join('\n');
}

/** Coerce whatever the model said back into a profile we are willing to save. */
export function sanitizeProfileDraft(raw, profile = {}) {
  const facts = profileWriterFacts(profile);
  const source = raw && typeof raw === 'object' ? raw : {};
  const strip = (value, max) => clean(String(value == null ? '' : value).replace(BANNED, '').replace(/\s{2,}/g, ' '), max);

  const headline = strip(source.headline, 90);
  const bio = strip(source.bio, 600);
  // The banned words are stripped from the lists too: "revolutionary growth" in
  // a skills row is the same empty claim as it is in a bio.
  const skills = list(source.skills, 8, 32).map((skill) => strip(skill, 32)).filter((skill) => skill.length > 1);
  const lookingFor = list(source.lookingFor, 3, 40).map((role) => strip(role, 40)).filter((role) => role.length > 1);

  // A draft that says nothing new is rejected, not saved over good data.
  const useful = headline.length >= 12 || bio.length >= 80;
  if (!useful) return { ok: false, reason: 'empty_draft', draft: null };

  return {
    ok: true,
    reason: 'ok',
    draft: {
      headline,
      bio,
      // Never let a rewrite delete skills the member typed themselves.
      skills: skills.length ? skills : facts.skills,
      lookingFor: lookingFor.length ? lookingFor : facts.lookingFor,
    },
  };
}

/**
 * Draft (and optionally save) a rewritten profile.
 *
 * `save` writes exactly four fields plus the marker. Everything else about the
 * member — tier, matches, streak, settings, verification — is untouched by
 * construction, not by carefulness.
 */
export async function writeMyProfile({ uid, profile, save = false, approved = null, allowRewrite = false, db = null, text = aiText, now = Date.now() } = {}) {
  if (!uid) return { ok: false, reason: 'missing_uid' };

  // The member approved a draft Linky already wrote. Save exactly that — do not
  // spend a second model call and do not quietly rewrite the words they read.
  if (approved && typeof approved === 'object') {
    const checkedApproved = sanitizeProfileDraft(approved, profile);
    if (!checkedApproved.ok) return { ok: false, reason: checkedApproved.reason };
    if (!save || !db) return { ok: true, reason: 'ok', draft: checkedApproved.draft, saved: false, source: 'linky' };
    try {
      await db.collection('users').doc(uid).set({
        headline: checkedApproved.draft.headline,
        bio: checkedApproved.draft.bio,
        skills: checkedApproved.draft.skills,
        lookingFor: checkedApproved.draft.lookingFor,
        profileWrittenByLinkyAt: now,
      }, { merge: true });
    } catch {
      return { ok: false, reason: 'save_failed', draft: checkedApproved.draft };
    }
    return { ok: true, reason: 'ok', draft: checkedApproved.draft, saved: true, source: 'linky' };
  }
  const facts = profileWriterFacts(profile);
  if (!facts.building && !facts.bio && !facts.goals && !facts.skills.length) {
    return { ok: false, reason: 'nothing_to_write_from' };
  }

  // A profile that already reads well is told so — not quietly rewritten over.
  // Only the member's explicit "rewrite it anyway" (allowRewrite) overrides
  // Linky's own verdict, and even then the draft still waits for approval.
  const assessment = assessProfileQuality(profile);
  if (assessment.verdict === 'strong' && !allowRewrite) {
    return { ok: true, reason: 'already_good', draft: null, saved: false, assessment, source: 'linky' };
  }

  const prompt = buildProfileWriterPrompt(profile);
  let parsed = null;
  try {
    const result = await text(prompt, { temperature: 0.6, maxOutputTokens: 700, responseMimeType: 'application/json', timeoutMs: 20000 });
    const rawText = String(result?.text || '').trim();
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    parsed = jsonStart >= 0 && jsonEnd > jsonStart ? JSON.parse(rawText.slice(jsonStart, jsonEnd + 1)) : null;
  } catch {
    return { ok: false, reason: 'ai_unavailable' };
  }

  const checked = sanitizeProfileDraft(parsed, profile);
  if (!checked.ok) return { ok: false, reason: checked.reason };

  let saved = false;
  if (save && db) {
    try {
      await db.collection('users').doc(uid).set({
        headline: checked.draft.headline,
        bio: checked.draft.bio,
        skills: checked.draft.skills,
        lookingFor: checked.draft.lookingFor,
        profileWrittenByLinkyAt: now,
      }, { merge: true });
      saved = true;
    } catch {
      return { ok: false, reason: 'save_failed', draft: checked.draft };
    }
  }

  return { ok: true, reason: 'ok', draft: checked.draft, saved, assessment, source: 'linky' };
}
