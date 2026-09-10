// ---------------------------------------------------------------------------
// Agent outreach pipeline - LINKUP's "nobody fits in here, so go find them"
// arm. Called by api/_linky.js pointers() (the app's "Where to look outside
// LINKUP" button and the bots' MORE), never from the client.
//
// The point: spend as little as possible of a 250-search/month SerpApi free
// plan and as little Gemini as possible, while still putting real, live people
// in front of a member. Four rules, and they are structural, not aspirational:
//
//  1. MAXIMISE EXTRACTION PER SEARCH. Every query asks for num=100 and uses
//     strict Google operators (site:linkedin.com/in, quoted role pairs, a
//     quoted place) so the SERP is all signal, no news articles.
//     MEASURED ON THIS KEY (2026-09-08): Google via SerpApi returns 9-10
//     organic results per request regardless of num - num is not echoed back in
//     search_parameters at all. So a single search is ~10 profiles, and more
//     profiles cost more searches (start=10, 20...). That is what maxPages
//     budgets, per plan, and why the guard reads the real remaining credits.
//  2. PROTECT TOKENS. Results are pre-filtered here with plain string/regex
//     matching, so junk never reaches the model, and what survives goes to
//     Gemini in BATCHES of 15 profiles per call - one call, one strict JSON
//     answer, no prose about the ones that were skipped.
//  3. DECOUPLE SEARCH FROM ENRICHMENT. Organic results are written to
//     outreachRuns/{id} as found, and every judgement about them is made from
//     that saved payload in memory. There is exactly one SerpApi call site in
//     this file and it is only ever reached with a *need-level* query: a person's
//     name, their company, or their profile never triggers another search.
//  4. SPEND ON A LEDGER, NOT ON VIBES. linkyOutreach/budget/{month} counts
//     searches, and serpapi.com/account.json (which costs 0 searches) is read
//     for the truth before anything is spent, so a runaway cron cannot eat the
//     month's allowance for the rest of the app.
//
// Boundaries kept on purpose: public professional profiles only, no email or
// phone harvesting, nothing is auto-sent (Linky drafts, the member sends), and
// nobody found out here is written into LINKUP as a member or into anyone's
// feed. These leads are a pointer, not an import.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { getAdmin, getDb } from './_firebaseAdmin.js';
import { aiReady, aiText, geminiText, getGeminiKey } from './_gemini.js';
import { proofFromSnippet } from './_proof.js';

export const OUTREACH = {
  num: 100,                 // asked for every time (rule 1); may not be honoured
  linkedinOnly: true,       // every query carries site:linkedin.com/in, enforced below
  freeMaxPages: 1,          // one search per ask on the shared free plan
  plusMaxPages: 2,          // PLUS gets a second page of the same query, not a new engine
  batch: 15,                // profiles per Gemini call
  freeMaxBatches: 1,
  plusMaxBatches: 2,
  keepMin: 55,              // model's fit score floor
  maxLeads: 8,              // what a member is actually shown
  // Read from the environment so the floor can be raised on a bad month without
  // a deploy of code, only a Vercel var change.
  reserveCredits: Math.max(0, Number(process.env.OUTREACH_RESERVE_CREDITS ?? 40)),
  cacheDays: 7,             // same need again -> 0 searches, 0 tokens
  runTtlDays: 30,
  perMemberPerDay: 4,   // one member must not spend the shared month on their own brainstorm
  hourCap: 12,              // searches per hour, all members together
  searchTimeoutMs: 15000,   // measured 0.2s-8s+ per search on this account
  runBudgetMs: 24000,       // a pointers() call shares Vercel's 60s with Gemini
  profileFilter: 'linkedin',
};

const DAY = 86400000;
const HOST = 'https://serpapi.com';
const db = () => getDb();
const monthKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 7);
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 32);
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Google hands back LinkedIn titles with the entities still encoded
// ("Electrical &amp; Electronic") and a trailing ellipsis where LinkedIn cut the
// headline. Neither belongs in a message to a person.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', eacute: 'e', uuml: 'u' };
export function decodeEntities(v) {
  return String(v ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, inner) => {
    if (inner[0] === '#') {
      const code = inner[1] === 'x' || inner[1] === 'X' ? parseInt(inner.slice(2), 16) : parseInt(inner.slice(1), 10);
      return Number.isFinite(code) && code > 31 && code < 1114111 ? String.fromCodePoint(code) : whole;
    }
    const key = inner.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : whole;
  });
}

// A title the member can read at a glance: entities decoded, no dangling "...",
// never cut in the middle of a word, and the "| Company" tail of a landing page
// dropped because it is not a person's title.
export function tidyTitle(v, max = 96) {
  let t = decodeEntities(v).replace(/\s+/g, ' ').trim();
  t = t.replace(/\s*[|]\s*[^|]{0,40}$/, '');
  t = t.replace(/[.\u2026\s-]+$/g, '');
  if (t.length > max) {
    const cut = t.slice(0, max);
    const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(','));
    t = (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:\s-]+$/g, '');
  }
  return t.trim();
}
const toMillis = (v) => (v?.toMillis ? v.toMillis() : typeof v === 'number' ? v : v ? Date.parse(v) || 0 : 0);

// The credit read is cached so a busy hour does not hit /account.json per ask.
// Exposed for tests and for the cron, which knows better than anyone when the
// plan has just renewed.
export function resetCreditsCache() { accountCache = { at: 0, left: null, perMonth: null, plan: '' }; }

export function serpApiEnabled() {
  return !!String(process.env.SERPAPI_KEY || process.env.SERP_API_KEY || '').trim();
}
const key = () => String(process.env.SERPAPI_KEY || process.env.SERP_API_KEY || '').trim();

// Words worth putting in a Google query, and the stems that mean the same job.
// Deliberately local and dumb: this runs before any model does.
const NOISE = new Set('me you your for a an the with and or to of is are was be in on at who someone somebody person people find find me look looking need want want to please hi hey hello linky linkup here there get give show connect introduce intro message dm text contact reach out talk ask any some about from based around near just really maybe can could would should like'.split(' ').concat(['send', 'sending', 'a', 'me']));
const ROLE_SYNONYMS = {
  developer: ['developer', 'software engineer', 'programmer'],
  engineer: ['engineer', 'developer'],
  designer: ['designer', 'ux designer', 'product designer'],
  marketer: ['marketing manager', 'growth marketer', 'head of marketing'],
  'fintech': ['fintech', 'payments', 'mobile money'],
  lawyer: ['lawyer', 'legal counsel', 'advocate'],
  accountant: ['accountant', 'finance manager', 'cpa'],
  analyst: ['data analyst', 'analyst', 'business intelligence'],
  founder: ['founder', 'co-founder', 'ceo'],
  'cto': ['cto', 'head of engineering', 'engineering manager'],
  sales: ['sales director', 'head of sales', 'business development'],
  'ai': ['machine learning', 'ai engineer', 'data scientist'],
};
const PLACES = {
  zimbabwe: ['Zimbabwe', 'Harare', 'Bulawayo'],
  kenya: ['Kenya', 'Nairobi'],
  nigeria: ['Nigeria', 'Lagos'],
  southafrica: ['South Africa', 'Cape Town', 'Johannesburg'],
  ghana: ['Ghana', 'Accra'],
  uk: ['United Kingdom', 'London'],
  usa: ['United States', 'Remote'],
  remote: ['Remote'],
};

function keywordsFor(need) {
  const words = text(need, 240).toLowerCase().replace(/[^a-z0-9+#.\s-]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !NOISE.has(w));
  const roles = [];
  for (const w of words) {
    const stem = w.replace(/s$/, '');
    const syn = ROLE_SYNONYMS[stem] || ROLE_SYNONYMS[w];
    if (syn) syn.forEach((r) => !roles.includes(r) && roles.push(r));
  }
  return { words, roles: roles.slice(0, 4), raw: words.slice(0, 5) };
}

// Strict operators, so the SERP is profiles and not news coverage of a company.
export function buildQueries(need, { place = '', limit = 2 } = {}) {
  // limit is a ceiling, not a target: the free plan asks for one search and a
  // search is a credit out of the same 250 the whole product shares.
  const { words, roles, raw } = keywordsFor(need);
  const placeBits = (() => {
    const p = text(place, 40);
    if (!p) return [];
    const flat = p.toLowerCase().replace(/[^a-z]/g, '');
    if (PLACES[flat]) return PLACES[flat];
    // A place like "Harare, Zimbabwe" must not be quoted as one exact phrase -
    // Google then demands that literal string. Split and keep the city.
    return p.split(/\s*,\s*/).map((x) => text(x, 40)).filter(Boolean);
  })();
  const quoted = (s) => `"${s}"`;
  const out = [];
  const roleGroup = roles.length ? `(${roles.slice(0, 2).map(quoted).join(' OR ')})` : '';
  const topic = raw.length ? quoted(raw.slice(0, 2).join(' ')) : '';
  const push = (q) => { if (q && !out.includes(q) && out.length < limit) out.push(q); };
  // No recognised role in the ask: widen with the next two real words instead of
  // repeating one word twice, which Google would AND together anyway.
  const broad = `(${(words.slice(0, 2).join(' OR ')) || 'founder OR startup'})`;
  const dupTopic = topic && (roleGroup.includes(topic) || broad.includes(topic.replace(/"/g, '')));
  push([`site:linkedin.com/in`, roleGroup || broad, dupTopic ? '' : topic, placeBits[0] ? quoted(placeBits[0]) : ''].filter(Boolean).join(' '));
  if (placeBits[1] || placeBits[0]) {
    push([`site:linkedin.com/in`, roleGroup, topic, quoted(placeBits[1] || placeBits[0])].filter(Boolean).join(' '));
  }
  if (!out.length) push(`site:linkedin.com/in ${quoted(words.slice(0, 3).join(' ')) || 'founder startup'}`);
  // Nothing here may scrape the open web at large. Every query is a LinkedIn
  // profile query or the function refuses to return it.
  return out.filter((q) => /site:linkedin\.com\/in/.test(q)).slice(0, Math.max(1, Math.min(limit, 2)));
}

// ---------------------------------------------------------------- credit ledger
let accountCache = { at: 0, left: null, perMonth: null, plan: '' };

// /account.json costs nothing, so use it as the source of truth instead of
// trusting a counter that could drift (two deploys, a manual dashboard test).
async function accountCredits() {
  if (!serpApiEnabled()) return { left: 0, perMonth: 0, plan: 'none' };
  if (Date.now() - accountCache.at < 5 * 60000) return accountCache;
  try {
    const r = await fetch(`${HOST}/account.json?api_key=${encodeURIComponent(key())}`, { signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    accountCache = {
      at: Date.now(),
      left: Number(d.total_searches_left ?? d.plan_searches_left ?? 0),
      perMonth: Number(d.searches_per_month || 0),
      plan: String(d.plan_name || ''),
    };
  } catch (err) {
    console.warn('[outreach] account lookup failed', err?.message || err);
  }
  return accountCache;
}

const dayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

// One member's own searches today. The monthly budget is shared by the whole
// product, so without this one enthusiastic member can empty it on a Tuesday.
async function memberDay(uid) {
  const ref = db().collection('linkyOutreach').doc(`day_${uid || 'anon'}_${dayKey()}`);
  if (!uid) return { ref: null, used: 0 };
  const snap = await ref.get().catch(() => null);
  return { ref, used: Number(snap?.data()?.searches || 0) };
}

async function ledger() {
  const month = monthKey();
  const ref = db().collection('linkyOutreach').doc(`budget_${month}`);
  const snap = await ref.get().catch(() => null);
  const d = snap && snap.exists ? snap.data() : {};
  const hour = new Date().toISOString().slice(0, 13);
  return {
    month, ref,
    used: Number(d.used || 0),
    hour: d.hour === hour ? Number(d.hourUsed || 0) : 0,
    members: Array.isArray(d.members) ? d.members : [],
    savedRuns: Number(d.savedRuns || 0),
  };
}

// What this run is allowed to spend, before any request goes out.
export async function canSearch({ plus = false, uid = '' } = {}) {
  if (!serpApiEnabled()) return { ok: false, reason: 'not-configured' };
  const [acct, led, mine] = await Promise.all([accountCredits(), ledger(), memberDay(uid)]);
  const monthlyFloor = Math.max(0, (acct.left || OUTREACH.reserveCredits) - OUTREACH.reserveCredits);
  const perRun = Math.min(plus ? OUTREACH.plusMaxPages : OUTREACH.freeMaxPages, monthlyFloor);
  const hourLeft = Math.max(0, OUTREACH.hourCap - led.hour);
  const memberLeft = Math.max(0, OUTREACH.perMemberPerDay - mine.used);
  const pages = Math.max(0, Math.min(perRun, hourLeft, memberLeft));
  if (!pages && memberLeft <= 0 && hourLeft > 0 && monthlyFloor > 0) {
    return { ok: false, reason: 'member-day-cap', left: acct.left, perMonth: acct.perMonth };
  }
  if (!pages) {
    return { ok: false, reason: acct.left <= OUTREACH.reserveCredits ? 'plan-exhausted' : 'hour-cap', left: acct.left, perMonth: acct.perMonth };
  }
  return { ok: true, pages, left: acct.left, perMonth: acct.perMonth, plan: acct.plan };
}

// ---------------------------------------------------------------- search
// The ONLY place a SerpApi request is made. `page` walks the result set
// (start=10, 20...) - that is pagination of one query, never a lookup of a
// person found in an earlier page (rule 3).
async function serpSearch(q, { start = 0 } = {}) {
  // Hard stop, not a style preference: one search is one credit out of the 250
  // the whole product shares, and what was promised is public LinkedIn profiles
  // and nothing else. A query without the operator would scrape the open web.
  if (OUTREACH.linkedinOnly && !/site:linkedin\.com\/in/.test(String(q || ''))) {
    return { results: [], error: 'not-linkedin' };
  }
  const params = new URLSearchParams({
    engine: 'google', q, num: String(OUTREACH.num), hl: 'en', gl: 'zw', device: 'desktop',
  });
  if (start > 0) params.set('start', String(start));
  params.set('api_key', key());
  const res = await fetch(`${HOST}/search.json?${params.toString()}`, { signal: AbortSignal.timeout(OUTREACH.searchTimeoutMs) }).catch((e) => {
    console.warn('[outreach] serp timeout', e?.message || e);
    return null;
  });
  if (!res) return { results: [], error: 'timeout' };
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) return { results: [], error: `http-${res.status}`, detail: text(body?.error || res.statusText, 160) };
  if (body?.errors?.length) return { results: [], error: text(body.errors.join(' '), 160) };
  const organic = Array.isArray(body?.organic_results) ? body.organic_results : [];
  return { results: organic, error: '', total: Number(body?.search_information?.total_results || 0), echoed: body?.search_parameters?.num || null };
}

// Cheap local pass (rule 2): a profile only earns a token if its own text
// mentions the need, a synonym of it, or a role in the query. No regex
// backtracking monsters, no network, no model.
export function prefilter(organic, { need = '', roles = [], words = [] } = {}) {
  const needles = [...new Set([
    ...roles.map((r) => r.toLowerCase()),
    ...words.map((w) => w.toLowerCase()),
    ...words.map((w) => (w.length > 5 ? w.replace(/(ing|ers|ies|ed|es|s)$/, '') : w)),
  ])].filter((s) => s.length > 3);
  const out = [];
  for (const r of organic || []) {
    const title = tidyTitle(r.title, 200);
    const snippet = text(decodeEntities(r.snippet), 400);
    const source = text(r.source, 80);
    const hay = `${title} ${snippet}`.toLowerCase();
    if (!hay.trim()) continue;
    // A LinkedIn profile result has a person's name in the title: "Name - Role".
    const nameBit = title.split(/\s+-\s+/)[0].trim();
    if (!nameBit || nameBit.length > 60) continue;
    // Word boundaries matter: "livestock" is not a stock-market page, and a
    // person's snippet may legitimately say they write a newsletter. Commercial
    // page terms are therefore judged on the title, where a profile reads
    // "Name - Role" and a landing page reads "Pricing | Flutter".
    if (/\b(news|newsletter?\s*paper|salary|download|sign ?up|log ?in|privacy|cookie)\b/i.test(hay)) continue;
    // job boards, not people. "hiring" alone stays allowed - a real profile says
    // it, and the scorer even rewards it.
    if (/\bjobs?\s+(in|near|at|available)\b|\bapply now\b|\bvacanci(es|y)\b|\bjob opening/i.test(hay)) continue;
    if (/\b(pricing|price|coupon|discount|review\s*of|stock\s*market)\b/i.test(title)) continue;
    const hits = needles.filter((n) => hay.includes(n));
    if (needles.length && !hits.length) continue;
    out.push({
      name: tidyTitle(nameBit, 60),
      title: tidyTitle(title.split(/\s+-\s+/).slice(1).join(' - '), 110),
      snippet,
      source: source || text(r.displayed_link, 60),
      rawLink: text(r.link || r.redirect_link, 400),
      // proof of work, read off the same snippet - no second search per person
      proof: proofFromSnippet(`${title}. ${snippet}`),
      hits,
      position: Number(r.position || out.length + 1),
    });
  }
  // Best-connected first, and never the same human twice.
  const seen = new Set();
  return out
    .sort((a, b) => (b.hits.length - a.hits.length) || (a.position - b.position))
    .filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, OUTREACH.batch * (OUTREACH.plusMaxBatches + 1));
}

// Google now wraps result hrefs (google.com/goto?url=...). Resolving the
// wrapper is a plain redirect follow - it is not a search, so it costs zero
// SerpApi credits, which is exactly why it is allowed here at all.
export async function cleanLink(rawLink) {
  const l = String(rawLink || '');
  if (/^https?:\/\/(www\.)?linkedin\.com\//i.test(l)) return l;
  const m = l.match(/\/goto\?url=([^&\s]+)/) || l.match(/[?&]url=([^&\s]+)/);
  if (!m) return /^https?:\/\//i.test(l) ? l : '';
  if (!/\/goto\?/.test(l)) {
    try { const u = new URL(decodeURIComponent(m[1])); if (/linkedin\.com/i.test(u.hostname)) return u.toString(); } catch { /* fall through */ }
  }
  try {
    // a relative /goto?url=... needs Google's host prepended; an absolute
    // https://www.google.com/url?... must be fetched as it is (real payloads use both)
    const res = await fetch(/^https?:\/\//i.test(l) ? l : `https://www.google.com${l}`, {
      redirect: 'manual', signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36' },
    });
    const loc = res.headers.get('location') || '';
    if (/^https?:\/\/[^/]*linkedin\.com\//i.test(loc)) return loc;
  } catch { /* fail open below */ }
  return '';
}

async function cleanLinks(profiles) {
  const settle = await Promise.allSettled(profiles.map((p) => cleanLink(p.rawLink)));
  return settle.map((r, i) => {
    const url = r.status === 'fulfilled' ? r.value : '';
    const q = encodeURIComponent(`"${profiles[i].name}" linkedin`);
    return { ...profiles[i], url: url || `https://www.google.com/search?q=${q}`, resolved: !!url };
  });
}

// One call per batch of 15 (rule 2). The model returns indices plus a score,
// and is explicitly forbidden from explaining the ones it dropped.
export async function scoreBatch(profiles, { need = '', place = '' } = {}) {
  if (!profiles.length) return profiles.map((p, i) => ({ i, fit: 70 - i, why: '' }));
  // No model at all: keep the local prefilter order and let it through its own
  // (lower) floor, because "no key" is not evidence that these people are wrong.
  if (!aiReady()) return profiles.map((p, i) => ({ i, fit: 70 - i, why: p.hits?.[0] ? `matches ${p.hits[0]}` : '', fallback: true }));
  const prompt = [
    'You shortlist people for LINKUP, a network of founders, builders and operators. A member needs somebody LINKUP does not have yet.',
    'Score each public profile on whether THIS person could realistically help. Be strict about the role and generous about adjacent roles.',
    'Return STRICT JSON only: {"keep":[{"i":0,"fit":82,"why":"Flutter dev who ships fintech apps"}]} - only profiles worth messaging, fit 0-100, and "why" is one short clause (under 8 words) naming what on this profile makes them the right person. No prose, no reasons for the ones you drop, no reformatting the list.',
    `Need: "${text(need, 200)}"`, place ? `Place: ${text(place, 60)}` : '',
    `Profiles: ${JSON.stringify(profiles.map((p, i) => ({ i, name: p.name, title: p.title, snippet: p.snippet.slice(0, 200) })))}`,
  ].filter(Boolean).join('\n');
  try {
    const raw = await aiText(prompt, { temperature: 0.1, maxOutputTokens: 500, responseMimeType: 'application/json' }).then((r) => r.text);
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const keep = Array.isArray(parsed?.keep) ? parsed.keep : [];
    return keep
      .map((k) => ({ i: Number(k.i), fit: Math.round(Number(k.fit) || 0), why: text(k.why, 60) }))
      .filter((k) => Number.isInteger(k.i) && k.i >= 0 && k.i < profiles.length && k.fit >= OUTREACH.keepMin)
      .sort((a, b) => b.fit - a.fit);
  } catch (err) {
    console.warn('[outreach] scoring failed, keeping the local prefilter order', err?.message || err);
    return profiles.map((p, i) => ({ i, fit: Math.max(56, 80 - i * 3), why: p.hits?.[0] ? `matches ${p.hits[0]}` : '' }));
  }
}

// ---------------------------------------------------------------- entry point
/**
 * Find public profiles outside LINKUP for one ask.
 * Never throws at the caller for ordinary failures - it returns what it has.
 */
export async function findLeads(need, { place = '', plus = false, uid = '', askedBy = '' } = {}) {
  const started = Date.now();
  const queries = buildQueries(need, { place, limit: Math.max(1, OUTREACH.plusMaxPages) });
  const primary = queries[0];
  const cacheRef = db().collection('linkyOutreach').doc(`q_${hash(`${primary}|${place}`)}`);
  const cached = await cacheRef.get().catch(() => null);
  if (cached && cached.exists && Date.now() - toMillis(cached.data().at) < OUTREACH.cacheDays * DAY) {
    // Rule 1 of the cheap kind: the same need again costs no search and no token.
    // Re-tidied on the way out, because a run saved before the entity fix would
    // otherwise hand a member "Electrical &amp; Electronic" and a cut-off title.
    const saved = Array.isArray(cached.data().leads) ? cached.data().leads : [];
    const leads = saved.map((l) => ({
      ...l,
      name: tidyTitle(l?.name, 60),
      title: tidyTitle(l?.title, 110),
      why: tidyTitle(l?.why, 52),
    })).filter((l) => l.name && l.url);
    return { leads, searches: 0, cached: true, query: primary, note: 'cached' };
  }
  const budget = await canSearch({ plus, uid });
  if (!budget.ok) {
    return { leads: [], searches: 0, cached: false, query: primary, note: budget.reason, left: budget.left };
  }
  const { roles, words } = keywordsFor(need);
  const pages = Math.min(budget.pages, queries.length || 1);
  const organic = [];
  let searches = 0;
  let error = '';
  // Google pays out ~10 results per page on this key, whatever num says, so the
  // offset walks by what the last page actually returned - not by the num we
  // asked for, which would have skipped straight past the first 100.
  let offset = 0;
  for (let page = 0; page < Math.max(1, pages); page += 1) {
    if (Date.now() - started + OUTREACH.searchTimeoutMs > OUTREACH.runBudgetMs && organic.length) break;
    const q = queries[page] || primary;
    const r = await serpSearch(q, { start: offset });
    searches += 1;
    if (r.error) { error = r.error; if (organic.length) break; continue; }
    organic.push(...r.results.map((x) => ({ ...x, _query: q })));
    offset += r.results.length || 10;
    if (!r.results.length) break; // nothing left to page through
  }
  const led = await ledger();
  await led.ref.set({
    month: led.month, used: led.used + searches, hour: new Date().toISOString().slice(0, 13),
    hourUsed: led.hour + searches,
    updatedAt: started, lastUid: uid, lastQuery: primary,
    leftAfter: budget.left - searches, plan: budget.plan || '',
  }, { merge: true }).catch((e) => console.warn('[outreach] ledger write failed:', e?.code, e?.message || e));
  const mine = await memberDay(uid);
  if (mine.ref) await mine.ref.set({ uid, day: dayKey(), searches: mine.used + searches, at: started }, { merge: true }).catch(() => {});

  // Save what the search returned BEFORE judging it (rule 3), so a re-run of
  // the judgement never has to touch SerpApi again.
  const runRef = db().collection('linkyOutreach').doc(`run_${uid || 'anon'}_${started.toString(36)}`);
  const filtered = prefilter(organic, { need, roles, words });
  await runRef.set({
    uid, need: text(need, 200), place: text(place, 60), queries: queries.slice(0, pages), searches,
    rawCount: organic.length, kept: filtered.length, at: started,
    results: filtered.slice(0, 40).map((p) => ({ name: p.name, title: p.title, snippet: p.snippet.slice(0, 240), rawLink: p.rawLink.slice(0, 200) })),
    error,
    expiresAt: firestoreTimestamp(started + OUTREACH.runTtlDays * DAY),
  }, { merge: true }).catch(() => {});

  if (!filtered.length) {
    return { leads: [], searches, cached: false, query: primary, note: error ? `search-error:${error}` : 'no-results' };
  }
  // Pool what the model is allowed to see, in batches of 15. The model answers
  // with indices into its own batch, so each result is re-based before use.
  const allowedBatches = plus ? OUTREACH.plusMaxBatches : OUTREACH.freeMaxBatches;
  const pool = filtered.slice(0, allowedBatches * OUTREACH.batch);
  const batches = [];
  for (let i = 0; i < pool.length; i += OUTREACH.batch) batches.push(pool.slice(i, i + OUTREACH.batch));
  const scored = await Promise.all(batches.map((b, bi) => scoreBatch(b, { need, place })
    .then((list) => list.map((k) => ({ ...k, gi: bi * OUTREACH.batch + k.i })))));
  const flat = scored.flat().filter((k) => pool[k.gi]).sort((a, b) => b.fit - a.fit);
  const picked = flat.slice(0, OUTREACH.maxLeads).map((k) => pool[k.gi]);
  const withUrls = await cleanLinks(picked);
  const byIndex = new Map(flat.map((k, n) => [k.gi, k]));
  const leads = withUrls.map((p, idx) => {
    const gi = pool.indexOf(p) >= 0 ? pool.indexOf(p) : flat[idx]?.gi;
    const judged = byIndex.get(gi) || flat[idx] || {};
    return {
      name: tidyTitle(p.name, 60),
      title: tidyTitle(p.title, 110),
      url: p.url,
      // the reason is a phrase, not a paragraph - it sits on one line next to a name
      why: tidyTitle(judged.why || p.hits?.[0] || '', 52),
      fit: Number(judged.fit) || Math.max(56, 84 - idx * 4),
      resolved: !!p.resolved,
    };
  });
  await cacheRef.set({ need: text(need, 200), place: text(place, 60), query: primary, leads, searches, at: started, askedBy: text(askedBy, 60) }, { merge: true }).catch(() => {});
  if (uid) {
    await db().collection('linkyOutreach').doc(`member_${uid}`).set({
      uid, need: text(need, 200), leads: leads.slice(0, OUTREACH.maxLeads), searches, at: started,
    }, { merge: true }).catch(() => {});
  }
  return {
    leads, searches, cached: false, query: primary, tokens: batches.length,
    tookMs: Date.now() - started, note: leads.length ? '' : 'all-filtered',
    left: (budget.left || 0) - searches, perMonth: budget.perMonth,
  };
}

// Timestamps come from Admin, not the db instance. Wrapped so a doc is still
// written if the shape is ever unavailable - losing an expiry stamp is not
// worth losing the run record.
function firestoreTimestamp(ms) {
  try { return getAdmin().firestore.Timestamp.fromMillis(ms); } catch { return null; }
}

/** A message the member can paste. Linky writes it, the human sends it. */
export function outreachDraft(lead, { need = '', name = '', place = '' } = {}) {
  const who = text(name, 40) || 'a founder here';
  const title = text(lead?.title, 80);
  // The raw ask is never pasted in ("find elon musk" must not read as a
  // sentence) - the person's own title carries the reason instead.
  const hook = title
    ? `Your profile - ${title} - is exactly the kind of work I am trying to do right now.`
    : 'Your profile stood out to me.';
  return `Hi ${text(lead?.name || '', 40)}, I am ${who}, building in ${text(place, 40) || 'Zimbabwe'}. ${hook} Could I get 15 minutes this week for one honest opinion? No pitch, no pressure.`;
}
