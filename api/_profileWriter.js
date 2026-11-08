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
  };
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
export async function writeMyProfile({ uid, profile, save = false, approved = null, db = null, text = aiText, now = Date.now() } = {}) {
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

  return { ok: true, reason: 'ok', draft: checked.draft, saved, source: 'linky' };
}
