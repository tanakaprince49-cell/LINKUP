// Proof of work: what a profile can actually show, not what it claims to feel.
//
// A badge here is never a compliment Linky invented. It is one of two things:
//   checked: true   - LINKUP holds the record itself (a project the member
//                     published on their profile, a GitHub handle they added,
//                     a verification stamp), so the claim is auditable in our
//                     own database;
//   checked: false  - it is the member's own words, and the sentence they said
//                     it in is kept in `quote` so a human can check it.
// Anything else - "rising star", "passionate founder" - is personality, not
// proof, and stays off the card.
//
// No network call, no tokens, no new SerpApi credit: this only reads text we
// already fetched for the match.

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const hosted = (v) => { const s = clean(v, 2048); return /^https?:\/\//i.test(s) && !s.startsWith('data:') ? s : ''; };

const num = '([\\d][\\d,.]*)\\s?([km]?)';
// "12k" is not "12": the unit is the whole point of a proof badge
const qty = (n, unit) => `${String(n || '')}${String(unit || '').toLowerCase()}`;

// Deliberately narrow. Each pattern names a thing a stranger could check.
const PROOF_RX = [
  { kind: 'stars', rx: new RegExp(`${num}\\s?\\+?\\s?stars?`, 'i'), label: (m) => `${qty(m[1], m[2])} GitHub stars` },
  { kind: 'users', rx: new RegExp(`${num}\\s?\\+?\\s?(users|downloads?|installs?|customers?|clients?|players?|riders?|passengers?|patients?|learners?|subscribers?)`, 'i'), label: (m) => `${qty(m[1], m[2])} ${m[3].toLowerCase()}` },
  { kind: 'raised', rx: /(?:raised|closed|secured|funding of|round of)[^\w$]{0,10}(\$?\s?[\d][\d,.]*)\s?([mk]?)/i, label: (m) => `Raised ${m[1].replace(/\s+/g, '')}${(m[2] || '').toUpperCase()}` },
  { kind: 'accel', rx: /\b(y[\s-]?combinator|yc\s?[ws]\d{2}|techstars|500\s?global|founders\s?fund|register\s?a\s?fire|cchub|ihub|kaxa\s?grand\s?challenges|google\s?for\s?startups)\b/i, label: (m) => `${m[1].replace(/\s+/g, ' ').trim()} alum` },
  { kind: 'press', rx: /(?:featured|covered|written about|as seen)\s+in\s+([A-Za-z][A-Za-z&.' ]{2,26})/i, label: (m) => `Press: ${m[1].trim()}` },
  { kind: 'award', rx: /(?:winner of|award|first place|runner[- ]up|finalist|best)\s+(?:in\s+|at\s+|for\s+)?([A-Za-z][A-Za-z0-9&' .-]{3,30})/i, label: (m) => `Award: ${m[1].trim()}` },
  { kind: 'shipped', rx: /\bship(?:ped|ping)\b\s+(?:\w+\s+){0,3}(\d+|one|two|three|four|five|six|apps?|products?|launches?|features?)/i, label: (m) => `Shipped ${/^\d$/.test(m[1]) ? ['', 'one', 'two', 'three', 'four', 'five', 'six'][Number(m[1])] || m[1] : m[1].replace(/\bapps?\b/i, 'apps').replace(/\bproducts?\b/i, 'products')}` },
  { kind: 'team', rx: new RegExp(`team of ${num}`, 'i'), label: (m) => `Leads a team of ${qty(m[1], m[2])}` },
  { kind: 'years', rx: new RegExp(`\\b(\\d{1,2})\\+?\\s?years?\\s+(in|of|building|experience|doing)`, 'i'), label: (m) => `${m[1]} years building` },
];

const githubHandle = (raw) => {
  const s = clean(raw, 200);
  if (!s) return '';
  const m = s.match(/github\.com\/([A-Za-z0-9_-]{1,39})/i);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{1,39}$/.test(s.replace(/^@/, ''))) return s.replace(/^@/, '');
  return '';
};

/**
 * Badges for one person.
 *   facts  - what the matcher is allowed to see (already privacy-filtered)
 *   record - the raw LINKUP profile doc, used only for fields that are proof
 *            by their nature: published projects, links, verification, stage
 * Stays at 3: a card is not a trophy cabinet.
 */
export function proofPoints(facts = {}, record = {}, { skipBio = false } = {}) {
  const out = [];
  const push = (b) => {
    if (!b || !b.label) return;
    if (out.some((x) => x.kind === b.kind)) return;
    out.push({ kind: b.kind, label: clean(b.label, 60), ...(b.url ? { url: hosted(b.url) } : {}), ...(b.quote ? { quote: clean(b.quote, 140) } : {}), checked: !!b.checked, source: b.source || '', weight: Number(b.weight || 50) });
  };

  const links = record.socialLinks && typeof record.socialLinks === 'object' ? record.socialLinks : {};
  const gh = githubHandle(links.github);
  if (gh) push({ kind: 'github', label: `GitHub: ${gh}`, url: `https://github.com/${gh}`, checked: true, source: 'their LINKUP profile', weight: 85 });
  const li = clean(links.linkedin, 200);
  if (li) push({ kind: 'linkedin', weight: 25, label: 'LinkedIn on file', url: hosted(li) || (li.includes('linkedin.com') ? li : `https://www.linkedin.com/in/${li.replace(/^https?:\/\/[^/]+\//i, '').replace(/^in\//, '')}`), checked: true, source: 'their LINKUP profile' });
  const site = clean(links.portfolio || links.website, 200);
  if (site) push({ kind: 'site', weight: 30, label: 'Their own site', url: hosted(site) || `https://${site.replace(/^https?:\/\//i, '').replace(/^www\./i, '')}`, checked: true, source: 'their LINKUP profile' });

  // Published on LINKUP means we can point at it.
  const projects = (Array.isArray(record.projects) ? record.projects : []).map((x) => clean(x?.title, 60)).filter(Boolean);
  if (projects.length === 1) push({ kind: 'project', weight: 80, label: `Building "${projects[0]}"`, checked: true, source: 'their LINKUP projects' });
  else if (projects.length > 1) push({ kind: 'project', weight: 80, label: `${projects.length} projects published on LINKUP`, checked: true, source: 'their LINKUP projects' });

  if (record.isVerified) push({ kind: 'verified', weight: 50, label: record.verificationProgram ? `Verified - ${clean(record.verificationProgram, 28)}` : 'Verified LINKUP profile', checked: true, source: 'their LINKUP record' });
  const stage = clean(record.fundingStage, 40);
  if (/(seed|series|pre-?seed|angel|bootstrapped|raised)/i.test(stage)) push({ kind: 'funding', weight: 65, label: `Funding: ${stage}`, checked: true, source: 'their LINKUP record' });

  // Their words, quoted. Bio/notes are only read when the member has not hidden
  // them from Linky (the matcher already blanks them; skipBio is the belt).
  if (!skipBio) {
    const hay = [clean(facts.bio, 700), clean(facts.goals, 300), clean(record.ambition, 120)].filter(Boolean).join(' . ');
    for (const { kind, rx, label } of PROOF_RX) {
      const m = hay.match(rx);
      if (m) push({ kind, label: label(m), quote: m[0], checked: false, source: 'their profile text', weight: ['stars', 'users', 'raised'].includes(kind) ? 95 : 88 });
    }
  }
  // A shipped count we can count ourselves, when they never wrote a number.
  if (!out.some((x) => x.kind === 'shipped')) {
    const live = (Array.isArray(record.projects) ? record.projects : []).filter((x) => /live|launched|shipped|production/i.test(clean(x?.status, 40)));
    if (live.length >= 2) push({ kind: 'shipped', weight: 86, label: `${live.length} projects marked live`, checked: true, source: 'their LINKUP projects' });
  }
  // three slots on a card, so they go to the most telling proof: traction and
  // shipped work first, then a code link, then the record we hold ourselves.
  // A LinkedIn URL is a contact detail and never outranks a launch.
  return out.sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 3).map(({ weight, ...rest }) => rest);
}

/** The same extraction for a public search result (title + snippet we already have). */
export function proofFromSnippet(textIn = '', source = 'public search result') {
  const hay = clean(textIn, 600);
  const out = [];
  for (const { kind, rx, label } of PROOF_RX) {
    const m = hay.match(rx);
    if (m && !out.some((x) => x.kind === kind)) out.push({ kind, label: clean(label(m), 60), quote: m[0], checked: false, source, weight: ['stars', 'users', 'raised'].includes(kind) ? 95 : 88 });
    if (out.length === 3) break;
  }
  const gh = hay.match(/github\.com\/([A-Za-z0-9_-]{1,39})/i);
  if (gh && !out.some((x) => x.kind === 'github')) out.push({ kind: 'github', label: `GitHub: ${gh[1]}`, url: `https://github.com/${gh[1]}`, checked: false, source, weight: 85 });
  return out.sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 3).map(({ weight, ...rest }) => rest);
}

/** One line for a text channel. Empty string when there is nothing to show. */
export function badgeLine(badges = [], max = 2) {
  const bits = (Array.isArray(badges) ? badges : []).slice(0, max).map((b) => (b && b.label ? `${b.label}${b.checked ? '' : ' (their words)'}` : '')).filter(Boolean);
  return bits.length ? `Proof: ${bits.join(' · ')}` : '';
}

/** A clickable, Telegram-safe rendering of the same thing (no markdown tags). */
export function badgeLines(badges = []) {
  return (Array.isArray(badges) ? badges : []).slice(0, 3)
    .map((b) => (b && b.label ? `   • ${b.label}${b.checked ? '' : ' (their words)'}${b.url ? ` - ${b.url}` : ''}` : ''))
    .filter(Boolean);
}

export const PROOF_KINDS = PROOF_RX.map((p) => p.kind).concat(['github', 'linkedin', 'site', 'project', 'verified', 'funding']);
