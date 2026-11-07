/**
 * "Who is already looking for you" — an aggregate-only read of the pool.
 *
 * The Discover page promises one introduction a week. This number must never
 * quietly turn into a second one: it counts people who need what the viewer
 * does, and never shows a face, a name or an id. Everything here is arithmetic
 * over profiles the viewer is already allowed to browse.
 */

const norm = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenSet = (values) => {
  const out = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const token = norm(value);
    if (token.length >= 3) out.add(token);
  }
  return out;
};

/** Loose capability match: "react native dev" should answer a "react" need. */
const needsMe = (neededToken, myTokens) => {
  for (const mine of myTokens) {
    if (neededToken === mine) return mine;
    const [short, long] = neededToken.length <= mine.length ? [neededToken, mine] : [mine, neededToken];
    if (short.length >= 4 && long.includes(short)) return mine;
  }
  return '';
};

const wantsOf = (person) => {
  const needs = [
    ...(Array.isArray(person?.lookingFor) ? person.lookingFor : []),
    ...(Array.isArray(person?.projects) ? person.projects.flatMap((p) => (Array.isArray(p?.lookingFor) ? p.lookingFor : [])) : []),
    ...(Array.isArray(person?.roles) ? person.roles : []),
  ];
  return tokenSet(needs);
};

/**
 * @returns {null | {searching:number, matchedOnPaper:number, topNeed:string, poolSize:number}}
 * Null when the pool is too small for a number to mean anything — a lonely "1"
 * reads as failure, not demand.
 */
export function demandSignal(me, people, { minimumPool = 3 } = {}) {
  const list = (Array.isArray(people) ? people : []).filter((p) => p && String(p.uid || '') !== String(me?.uid || ''));
  if (!me?.uid || list.length < minimumPool) return null;

  const myTokens = tokenSet([
    ...(Array.isArray(me.skills) ? me.skills : []),
    ...(Array.isArray(me.industries) ? me.industries : []),
    me.occupation,
    me.role,
  ]);
  if (!myTokens.size) return null;

  const myCountries = tokenSet([me.country]);
  const myIndustries = tokenSet([...(Array.isArray(me.industries) ? me.industries : []), me.occupation]);

  const needCount = new Map();
  let searching = 0;
  let matchedOnPaper = 0;

  for (const person of list) {
    const wants = wantsOf(person);
    let hit = '';
    for (const token of wants) {
      const mine = needsMe(token, myTokens);
      if (mine) {
        hit = mine;
        break;
      }
    }
    if (!hit) continue;
    searching += 1;
    needCount.set(hit, (needCount.get(hit) || 0) + 1);

    const country = norm(person.country);
    const countryMatch = !!country && myCountries.has(country);
    const industryMatch = [...tokenSet([...(Array.isArray(person.industries) ? person.industries : []), person.occupation])].some(
      (token) => myIndustries.has(token)
    );
    if (countryMatch || industryMatch) matchedOnPaper += 1;
  }

  const topNeed = [...needCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
  return {
    searching,
    matchedOnPaper,
    topNeed: topNeed ? topNeed.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : '',
    poolSize: list.length,
  };
}
