/**
 * LINKY WRITES YOUR PROFILE — the PLUS-only rewrite.
 *
 * The whole promise of PLUS is that the matcher reads a person, not a form
 * somebody filled in at midnight. So Linky takes what the member has ALREADY
 * told LINKUP — onboarding answers, projects, the seat they said was empty — and
 * writes it in the words the matcher scores against.
 *
 * Two rules, both tested:
 *   1. NEVER INVENT. Every sentence traces to a fact the member supplied. The
 *      draft carries `evidence` so the member can see which answer each line
 *      came from, and a model-polished draft is rejected outright if it
 *      introduces a name, company, city or number that was not in the source.
 *   2. SAY WHAT IS MISSING. If the member has not told us something, Linky asks
 *      for it in one short line instead of writing a guess around the hole.
 */

const sx = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

const words = (list, max = 8) => (Array.isArray(list) ? list : [])
  .map(sx)
  .filter(Boolean)
  .slice(0, max);

const firstSentence = (value) => sx(value).replace(/[.!?]+$/, '');

const STAGE_COPY = {
  idea: 'idea stage',
  mvp: 'MVP stage',
  beta: 'beta',
  launch: 'live',
  live: 'live',
  revenue: 'revenue',
  scaling: 'scaling',
};

/**
 * The facts Linky is allowed to use, in one object.
 * @param {Record<string, any>} profile
 */
export function writerFacts(profile = {}) {
  const p = profile || {};
  const project = Array.isArray(p.projects) && p.projects.length ? p.projects[0] || {} : {};
  const building = sx(p.buildingName) || sx(p.company) || sx(project.title);
  const oneLiner = sx(p.buildingOneLiner) || sx(project.description);
  const seat = sx(p.missingSeat) || sx((Array.isArray(p.lookingFor) ? p.lookingFor : [])[0]);
  return {
    name: sx(p.displayName).split(/\s+/)[0] || '',
    role: sx(p.occupation),
    company: sx(p.company),
    building,
    oneLiner: firstSentence(oneLiner),
    seat,
    skills: words(p.skills, 10),
    industries: words(p.industries, 6),
    lookingFor: words(p.lookingFor, 4),
    bio: sx(p.bio),
    goals: sx(p.goals),
    stage: sx(p.startupStage || project.status || ''),
    traction: sx(p.buildingTraction || p.traction),
    city: sx(p.city),
    country: sx(p.country),
    availability: sx(p.availability || p.weeklyHours),
    commitment: sx(p.commitmentLevel),
    audience: sx(p.targetAudience || p.audience),
    hasProject: Boolean(building),
  };
}

/** The sentence Linky would write for the bio, from facts only. */
export function draftBio(facts) {
  const sentences = [];
  if (facts.building) {
    const who = facts.audience ? ` for ${facts.audience}` : '';
    const what = facts.oneLiner ? `: ${facts.oneLiner}` : '';
    sentences.push(`I am building ${facts.building}${what}${who ? `, ${who}` : ''}.`);
  } else if (facts.bio) {
    // No structured build yet: keep the member's own words rather than inventing.
    sentences.push(firstSentence(facts.bio) + '.');
  }
  if (facts.stage) {
    const stage = STAGE_COPY[facts.stage.toLowerCase()] || facts.stage;
    sentences.push(`${facts.traction ? `It is at ${stage} with ${facts.traction}` : `It is at ${stage}`}.`);
  } else if (facts.traction) {
    sentences.push(`So far: ${firstSentence(facts.traction)}.`);
  }
  if (facts.skills.length) {
    const skills = facts.skills.slice(0, 5).join(', ');
    sentences.push(`I do ${skills}${facts.role ? `, and my day job is ${facts.role.toLowerCase()}` : ''}.`);
  } else if (facts.role) {
    sentences.push(`I do ${facts.role.toLowerCase()}.`);
  }
  if (facts.seat) {
    const time = facts.availability ? `, ${facts.availability}` : '';
    sentences.push(`The seat that is empty is a ${facts.seat.toLowerCase()}${time} — that is the person I am here to meet.`);
  }
  return sentences.join(' ');
}

/**
 * The whole rewrite. Deterministic, offline, no model needed — and the server
 * falls back to exactly this if the model is down.
 * @param {Record<string, any>} profile
 */
export function draftProfile(profile = {}) {
  const facts = writerFacts(profile);
  const fields = {};
  const evidence = [];

  const bio = draftBio(facts);
  if (bio) {
    fields.bio = bio;
    evidence.push({ field: 'bio', from: facts.building ? 'your build, stage and skills' : 'your existing bio' });
  }

  const headlineBits = [facts.role || 'Founder'];
  if (facts.building) headlineBits.push(`building ${facts.building}`);
  if (facts.company && facts.company !== facts.building) headlineBits.push(`at ${facts.company}`);
  fields.occupation = facts.role || 'Founder';
  evidence.push({ field: 'occupation', from: 'your role' });

  if (facts.building) {
    fields.company = facts.company || facts.building;
    fields.buildingName = facts.building;
    evidence.push({ field: 'company', from: 'your build' });
  }
  if (facts.oneLiner) {
    fields.buildingOneLiner = facts.oneLiner;
    evidence.push({ field: 'buildingOneLiner', from: 'your one-liner' });
  }

  // Normalised, never expanded: the member's own skills, in their own words.
  if (facts.skills.length) {
    fields.skills = facts.skills;
    evidence.push({ field: 'skills', from: 'skills you listed' });
  }
  if (facts.industries.length) {
    fields.industries = facts.industries;
    evidence.push({ field: 'industries', from: 'industries you picked' });
  }

  const lookingFor = facts.lookingFor.length
    ? facts.lookingFor
    : (facts.seat ? [facts.seat] : []);
  if (lookingFor.length) {
    fields.lookingFor = lookingFor;
    evidence.push({ field: 'lookingFor', from: facts.seat ? 'the seat you said is empty' : 'what you are looking for' });
  }
  if (facts.seat) {
    fields.missingSeat = facts.seat;
    evidence.push({ field: 'missingSeat', from: 'the seat you said is empty' });
  }

  if (facts.seat || facts.goals) {
    const time = facts.availability ? `, ${facts.availability}` : '';
    const commit = facts.commitment ? `, ${facts.commitment}` : '';
    fields.goals = facts.goals
      ? firstSentence(facts.goals) + '.'
      : `Find the ${facts.seat.toLowerCase()}${time}${commit} to build ${facts.building || 'this'} with.`;
    evidence.push({ field: 'goals', from: facts.goals ? 'your stated goal' : 'your seat and availability' });
  }

  if (facts.building) {
    const project = Array.isArray(profile?.projects) && profile.projects.length ? profile.projects[0] || {} : {};
    fields.projects = [{
      ...project,
      title: project.title || facts.building,
      description: project.description || facts.oneLiner || '',
      status: project.status || facts.stage || 'idea',
    }];
    evidence.push({ field: 'projects', from: 'your build' });
  }

  const missing = [];
  if (!facts.building) missing.push('What you are building — one line is enough');
  if (!facts.seat) missing.push('Which seat is empty on your team');
  if (!facts.skills.length) missing.push('Two or three things you are genuinely good at');

  return {
    fields,
    evidence,
    missing,
    source: 'local',
    headline: headlineBits.join(' · '),
    facts,
    written: Object.keys(fields).length,
  };
}

/**
 * A model may only reword. Any capitalised token or number it introduces that is
 * not somewhere in the source facts is an invented fact, and the draft is
 * rejected in favour of the deterministic one. Cheap, blunt, and it has teeth:
 * this is the difference between "Linky wrote my profile" and "Linky made me up".
 * @param {string} text
 * @param {Record<string, any>} facts
 */
export function inventsFacts(text, facts = {}) {
  // Every fact, whatever its shape — a whitelist here would silently let a new
  // field's contents count as "invented" (or worse, let an invented one through).
  const flatten = (value) => (Array.isArray(value)
    ? value.map(flatten).join(' ')
    : (value && typeof value === 'object' ? Object.values(value).map(flatten).join(' ') : String(value ?? '')));
  const source = Object.values(facts || {}).map(flatten).join(' ').toLowerCase();
  const body = sx(text);
  if (!body) return true;

  const numbers = body.match(/\b\d[\d,.]*\b/g) || [];
  for (const n of numbers) {
    if (!source.includes(n.toLowerCase())) return true;
  }

  // Capitalised words that are not the start of a sentence.
  const suspects = body.match(/(?<![.!?]\s)(?<!^)\b[A-Z][a-zA-Z]{2,}\b/g) || [];
  const allowed = new Set(['i', 'linkup', 'plus', 'i\'m', 'i\'ve']);
  for (const word of suspects) {
    const lower = word.toLowerCase();
    if (allowed.has(lower)) continue;
    if (source.includes(lower)) continue;
    return true;
  }

  const words_ = body.split(/\s+/).filter(Boolean).length;
  if (words_ < 8 || words_ > 240) return true;
  return false;
}

/** True only when the draft is worth saving: it must say something real. */
export function isUsableDraft(draft) {
  if (!draft || !draft.fields) return false;
  const bio = sx(draft.fields.bio);
  const skills = Array.isArray(draft.fields.skills) ? draft.fields.skills.length : 0;
  return bio.length >= 40 && (skills > 0 || Boolean(sx(draft.fields.lookingFor)));
}
