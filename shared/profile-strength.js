/**
 * Profile strength — the one number the Discover page is allowed to show,
 * because it is the only one the member can actually move.
 *
 * Each field is weighted by how much it changes the co-founder match, not by
 * how easy it is to fill in. The weights are closed-form on purpose: the page
 * must be able to say *why* it is asking, and what changes when you do.
 */

const FIELDS = [
  {
    key: 'project',
    weight: 20,
    label: 'One project with a link',
    why: 'A live link is the strongest signal the matcher has. Without it, your claims are just words on a screen.',
    cta: 'Add your project',
  },
  {
    key: 'photo',
    weight: 15,
    label: 'Your face, not a placeholder',
    why: 'People decide whether to open you in under a second. A placeholder loses that second.',
    cta: 'Add a photo',
  },
  {
    key: 'skills',
    weight: 15,
    label: 'Three things you are genuinely good at',
    why: 'The pair is built on what you can carry. Two skills read as a guess; three read as a person.',
    cta: 'Add your skills',
  },
  {
    key: 'lookingFor',
    weight: 15,
    label: 'What you need from a co-founder',
    why: 'This is the half of the match you control. Leave it blank and we can only guess what to bring you.',
    cta: 'Say what you need',
  },
  {
    key: 'goals',
    weight: 15,
    label: 'Your goal, in your own words',
    why: 'The AI writes your weekly introduction from this. Thin input, thin introduction.',
    cta: 'Write your goal',
  },
  {
    key: 'role',
    weight: 10,
    label: 'What you do',
    why: 'It is the first thing the algorithm compares. Empty here means paired on accident.',
    cta: 'Set your role',
  },
  {
    key: 'place',
    weight: 10,
    label: 'Where you are building from',
    why: 'Time zones decide whether a co-founder relationship survives week three.',
    cta: 'Add your city',
  },
];

const has = {
  project: (profile) =>
    (Array.isArray(profile?.projects) && profile.projects.some((p) => p && (p.link || p.url || p.website))) ||
    !!(profile?.projectLink || profile?.website),
  photo: (profile) => !!String(profile?.profilePic || profile?.photoURL || '').trim(),
  skills: (profile) => Array.isArray(profile?.skills) && profile.skills.filter(Boolean).length >= 3,
  lookingFor: (profile) => Array.isArray(profile?.lookingFor) && profile.lookingFor.filter(Boolean).length >= 2,
  goals: (profile) => String(profile?.goals || profile?.bio || '').trim().length >= 80,
  role: (profile) => !!String(profile?.occupation || profile?.role || '').trim(),
  place: (profile) => !!String(profile?.city || profile?.country || '').trim(),
};

const BAND_LABEL = (percent) =>
  percent >= 90 ? 'Sharp' : percent >= 70 ? 'Strong' : percent >= 50 ? 'Readable' : 'Too thin to match well';

/**
 * @returns {{percent:number,label:string,done:number[],missing:object[],next:object|null}}
 */
export function profileStrength(profile) {
  const done = [];
  const missing = [];
  let percent = 0;
  for (const field of FIELDS) {
    const satisfied = typeof has[field.key] === 'function' && has[field.key](profile || {});
    if (satisfied) {
      percent += field.weight;
      done.push(field.key);
    } else {
      missing.push(field);
    }
  }
  // Missing fields are ordered by weight, so `next` is the single highest-leverage edit.
  const next = missing.slice().sort((a, b) => b.weight - a.weight)[0] || null;
  return { percent: Math.max(0, Math.min(100, percent)), label: BAND_LABEL(percent), done, missing, next };
}

export const PROFILE_STRENGTH_FIELDS = FIELDS;
