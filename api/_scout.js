// Scout: real public profiles from outside LINKUP when nobody inside fits.
//
// Budget rules (SerpApi free tier = 250 searches / month, shared by everyone):
//   * one SerpApi call per distinct ask, ever 30 days: raw organic results are
//     stored in Firestore `linkyScout/{hash}` and re-used by every member;
//   * every call sends num=100 plus strict Google operators
//     (site:linkedin.com/in ("Founder" OR "CEO") AND "fintech" <place>);
//   * NEVER a secondary per-person lookup - evaluation is done in memory on
//     the title / snippet Google already returned;
//   * monthly cap `linkyMeta/serpapi` (SCOUT_MONTHLY_CAP) and a per-member
//     daily cap, both graceful ("budget used") instead of failing;
//   * AI is optional: a hardcoded regex pre-filter runs first, then at most ONE
//     Gemini call over <= 20 pre-filtered rows returning strict JSON
//     {"picks":[{"i":0,"fit":true}]} - no explanations. No key = keyword rank.
//
// Env: SERPAPI_KEY (Vercel). Missing key -> {configured:false} and Linky says so.
import crypto from 'node:crypto';
import { getDb } from './_firebaseAdmin.js';
import { geminiText, getGeminiKey } from './_gemini.js';

export const SCOUT = { monthlyCap: 200, perMemberPerDay: 4, cacheDays: 30, maxPeople: 20, aiBatch: 20 };
const DAY_MS = 86400000;
const db = () => getDb();
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const uniq = (arr) => Array.from(new Set(arr));
const monthKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 7);
const dayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
const toMillis = (v) => (v?.toMillis ? v.toMillis() : typeof v === 'number' ? v : v ? Date.parse(v) || 0 : 0);

export const serpApiKey = () => String(process.env.SERPAPI_KEY || process.env.SERP_API_KEY || '').trim();

const STOP = new Set('me for up in a an the with and or to of is i my by on at who someone can that this need want looking find help build some any people person good great experienced strong senior junior based from about into been are was be it its as please hi hey hello linky you your get give show connect introduce intro know anyone anybody there here have has do does would could should like wants needs understands understand knows expert experts specialist specialists professional professionals really very also just'.split(' '));

// Role words Google should OR together; everything else is the topic.
const ROLE_WORDS = { founder: '"Founder"', cofounder: '"Co-Founder"', 'co-founder': '"Co-Founder"', ceo: '"CEO"', cto: '"CTO"', cfo: '"CFO"', coo: '"COO"', developer: '"Developer"', engineer: '"Engineer"', designer: '"Designer"', lawyer: '"Lawyer"', accountant: '"Accountant"', investor: '"Investor"', angel: '"Angel Investor"', marketer: '"Marketing"', consultant: '"Consultant"', advisor: '"Advisor"', mentor: '"Mentor"', analyst: '"Analyst"', scientist: '"Scientist"', researcher: '"Researcher"', professor: '"Professor"', lecturer: '"Lecturer"', doctor: '"Doctor"', teacher: '"Teacher"', manager: '"Manager"', director: '"Director"', head: '"Head of"', mathematician: '"Mathematician"', statistician: '"Statistician"', actuary: '"Actuary"' };
const TOPIC_ALIASES = { math: 'Mathematics', maths: 'Mathematics', ml: 'Machine Learning', ai: 'Artificial Intelligence', crypto: 'Blockchain', dev: 'Software', devs: 'Software', fintech: 'Fintech', payments: 'Payments', agritech: 'Agritech', edtech: 'Edtech', healthtech: 'Healthtech', solar: 'Solar', mining: 'Mining' };

// Deterministic query builder: strict operators, no free text.
export function buildQuery(need, place = '') {
  const words = String(need || '').toLowerCase().replace(/[^a-z0-9+#\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  const roles = uniq(words.filter((w) => ROLE_WORDS[w]).map((w) => ROLE_WORDS[w]));
  const topics = uniq(words.filter((w) => !ROLE_WORDS[w]).map((w) => TOPIC_ALIASES[w] || w)).slice(0, 3);
  const roleExpr = roles.length ? `(${roles.slice(0, 3).join(' OR ')})` : '("Founder" OR "CEO" OR "Head of" OR "Lead")';
  const topicExpr = topics.map((t) => `"${t}"`).join(' AND ');
  const where = text(place, 60);
  const q = ['site:linkedin.com/in', roleExpr, topicExpr ? `AND ${topicExpr}` : '', where ? `"${where}"` : ''].filter(Boolean).join(' ');
  return { q, roles: roles.map((r) => r.replace(/"/g, '')), topics, place: where, core: uniq([...topics.map((t) => t.toLowerCase()), ...words.filter((w) => w.length > 3)]) };
}

const hashKey = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 32);
const linkedinUrl = (r) => {
  for (const c of [r.link, r.redirect_link, r.about_page_link, r.displayed_link]) {
    const m = String(c || '').match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9%._-]+/);
    if (m) return m[0].replace(/^http:/, 'https:');
  }
  return '';
};

// Raw organic rows -> compact people rows, evaluated in memory (no lookups).
export function parseOrganic(organic) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(organic) ? organic : []) {
    const url = linkedinUrl(r);
    if (!url) continue;
    const slug = url.toLowerCase().replace(/^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\//, '').replace(/\/$/, '');
    if (seen.has(slug)) continue;
    seen.add(slug);
    const title = text(r.title, 160);
    const dash = title.indexOf(' - ');
    const name = text(dash > 0 ? title.slice(0, dash) : title.split(' | ')[0], 80);
    const headline = text(dash > 0 ? title.slice(dash + 3) : '', 120).replace(/\s*\|\s*LinkedIn$/i, '');
    out.push({ name, headline, url, snippet: text(r.snippet, 240), position: Number(r.position || out.length + 1) });
  }
  return out;
}

// Hardcoded pre-filter: title/snippet must hit at least one core term (or a
// role word when the ask had no topic). Zero tokens.
export function preFilter(rows, built) {
  const cores = built.core.length ? built.core : built.roles.map((r) => r.toLowerCase());
  const place = built.place.toLowerCase();
  return rows
    .map((r) => {
      const hay = `${r.name} ${r.headline} ${r.snippet}`.toLowerCase();
      let hits = 0;
      const matched = [];
      for (const c of cores) if (c && hay.includes(c)) { hits += 2; matched.push(c); }
      for (const role of built.roles) if (hay.includes(role.toLowerCase())) { hits += 1; matched.push(role.toLowerCase()); }
      if (place && hay.includes(place)) { hits += 1; matched.push(place); }
      return { ...r, hits, matched: uniq(matched) };
    })
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.position - b.position);
}

// ONE batched Gemini call, strict minimal JSON. Optional.
async function aiPick(need, rows) {
  if (!getGeminiKey() || rows.length < 3) return null;
  const batch = rows.slice(0, SCOUT.aiBatch);
  const prompt = [
    `Ask: "${need}".`,
    'Below are public search snippets of people. Mark fit=true only for people who plausibly match the ask based on the snippet alone. No explanations.',
    'Return STRICT JSON only: {"picks":[{"i":<index>,"fit":true}]} listing ONLY the fits.',
    JSON.stringify(batch.map((r, i) => ({ i, t: `${r.name} - ${r.headline}`.slice(0, 120), s: r.snippet.slice(0, 160) }))),
  ].join('\n');
  const raw = await geminiText(prompt, { temperature: 0.1, maxOutputTokens: 200, responseMimeType: 'application/json' });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  const picks = Array.isArray(parsed?.picks) ? parsed.picks : [];
  const idx = new Set(picks.filter((p) => p && p.fit !== false).map((p) => Number(p.i)).filter((i) => Number.isInteger(i) && i >= 0 && i < batch.length));
  return idx.size ? batch.filter((_, i) => idx.has(i)) : [];
}

// Monthly + per-member budget, one transaction. Returns false when spent.
async function takeBudget(uid) {
  const month = monthKey();
  const day = dayKey();
  const metaRef = db().collection('linkyMeta').doc('serpapi');
  const stateRef = db().collection('linkyState').doc(uid);
  return db().runTransaction(async (tx) => {
    const [meta, st] = await Promise.all([tx.get(metaRef), tx.get(stateRef)]);
    const used = meta.exists && meta.data().month === month ? Number(meta.data().count || 0) : 0;
    if (used >= SCOUT.monthlyCap) return { ok: false, reason: 'month' };
    const mine = st.exists && st.data().scout?.day === day ? Number(st.data().scout.count || 0) : 0;
    if (mine >= SCOUT.perMemberPerDay) return { ok: false, reason: 'member' };
    tx.set(metaRef, { month, count: used + 1, updatedAt: Date.now() }, { merge: true });
    tx.set(stateRef, { scout: { day, count: mine + 1 } }, { merge: true });
    return { ok: true, used: used + 1, mine: mine + 1 };
  });
}

async function serpSearch(q) {
  const params = new URLSearchParams({ engine: 'google', q, num: '100', hl: 'en', gl: 'us', api_key: serpApiKey() });
  const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(25000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(String(data?.error || `SerpApi HTTP ${res.status}`));
  return Array.isArray(data.organic_results) ? data.organic_results : [];
}

// Main entry. `need` is the ask; `place` the city/country context.
export async function scout(uid, need, { place = '' } = {}) {
  const ask = text(need, 200);
  if (!ask) throw new Error('Tell me who you need first.');
  if (!serpApiKey()) return { configured: false, people: [], query: '', cached: false, reply: 'Outside search is not switched on yet (SERPAPI_KEY is missing on the server).' };
  const built = buildQuery(ask, place);
  const ref = db().collection('linkyScout').doc(hashKey(built.q));
  const snap = await ref.get().catch(() => null);
  let organic = null;
  let cached = false;
  let budget = null;
  if (snap?.exists && Date.now() - toMillis(snap.data().createdAt) < SCOUT.cacheDays * DAY_MS) {
    organic = snap.data().organic || [];
    cached = true;
  } else {
    budget = await takeBudget(uid);
    if (!budget.ok) {
      return { configured: true, people: [], query: built.q, cached: false, budget: budget.reason, reply: budget.reason === 'month' ? 'My outside-search budget for this month is used up (it resets on the 1st). Inside LINKUP I am unlimited.' : 'You have used today\'s outside searches. Tomorrow resets them.' };
    }
    organic = await serpSearch(built.q);
    // Raw payload stored once, shared by every member for 30 days.
    await ref.set({ q: built.q, need: ask, place: built.place, organic: organic.map((r) => ({ position: r.position, title: r.title, link: r.link, redirect_link: r.redirect_link, about_page_link: r.about_page_link, displayed_link: r.displayed_link, snippet: r.snippet })), count: organic.length, createdAt: Date.now(), by: uid }).catch(() => {});
  }
  const rows = parseOrganic(organic);
  const filtered = preFilter(rows, built);
  let people = filtered;
  let usedAi = false;
  if (filtered.length > 5) {
    try {
      const picked = await aiPick(ask, filtered);
      if (Array.isArray(picked)) { usedAi = true; if (picked.length) people = picked; }
    } catch (err) {
      console.warn('[scout] ai pick failed, keyword rank only', err?.message || err);
    }
  }
  people = people.slice(0, SCOUT.maxPeople).map((r) => ({
    name: r.name, headline: r.headline, url: r.url, snippet: r.snippet, matched: r.matched,
    opener: `Hi ${r.name.split(' ')[0]}, I found your profile while looking for ${ask}. I am building in ${built.place || 'Zimbabwe'} - open to a 15-minute chat this week?`,
  }));
  const n = people.length;
  const reply = n
    ? `Outside LINKUP: ${n} real public ${n === 1 ? 'profile' : 'profiles'} that match "${ask}"${built.place ? ` around ${built.place}` : ''} - names, headlines and links below, plus a first line you can send. These are not members, so no Meet button: open the profile and reach out.`
    : `I searched the open web for "${ask}"${built.place ? ` around ${built.place}` : ''} and the results did not clear my filter (${rows.length} raw hits, none mentioning the core skill). Try a broader word - "data scientist" instead of "tensor calculus".`;
  return { configured: true, people, query: built.q, cached, usedAi, raw: rows.length, filtered: filtered.length, reply, budget: budget ? { monthUsed: budget.used, cap: SCOUT.monthlyCap } : undefined };
}
