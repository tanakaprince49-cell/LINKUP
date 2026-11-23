// THE Gemini model for the whole product: one name, centrally configured.
// Google closed the 2.5 flash tier to new API users and points callers at
// gemini-3.8-flash; a stale GEMINI_MODEL env naming a dead 2.5 model fails
// permanently - by design nothing here quietly substitutes another model.
const DEFAULT_MODEL = String(process.env.GEMINI_MODEL || '').trim() || 'gemini-3.8-flash';
// Second brain. If Gemini is down, over quota or returns junk, the same prompt
// goes to OpenCode Zen (OpenAI-compatible) instead of the user seeing a
// fallback sentence. Same contract, different provider, no code change at the
// call sites.
const ZEN_URL = process.env.ZEN_API_URL || 'https://opencode.ai/zen/v1/chat/completions';
// Zen ids no longer carry the "opencode/" prefix, so it is stripped. One
// configured model, same rule as Gemini: no silent model walk - a refused
// model surfaces as a clear error instead of quietly burning calls.
const cleanModel = (m) => String(m || '').trim().replace(/^opencode\//, '');
const ZEN_MODEL = cleanModel(process.env.ZEN_MODEL || process.env.EXPO_PUBLIC_ZEN_MODEL || '') || 'gemini-3.5-flash-lite';
const MAX_PROFILE_CHARS = 2600;

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function handleOptions(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

// Every name a Gemini key is plausibly stored under. Vercel's own AI SDK scaffold
// calls it GOOGLE_GENERATIVE_AI_API_KEY, and a deployment that set exactly that
// used to look "not configured" to us - which is how a member ends up reading a
// hard-coded sentence instead of Linky.
const GEMINI_KEY_NAMES = ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'EXPO_PUBLIC_GEMINI_API_KEY', 'GOOGLE_API_KEY'];
const ZEN_KEY_NAMES = ['ZEN_API_KEY', 'OPENCODE_ZEN_API_KEY', 'EXPO_PUBLIC_OPENCODE_ZEN_API_KEY'];
const firstEnv = (names) => names.map((k) => [k, String(process.env[k] || '').trim()]).find(([, v]) => !!v);

export function getGeminiKey() {
  return (firstEnv(GEMINI_KEY_NAMES) || ['', ''])[1];
}

export function getZenKey() {
  return (firstEnv(ZEN_KEY_NAMES) || ['', ''])[1];
}

/** Any usable model at all. Guards must test this, not getGeminiKey(): a Zen-only
 *  deployment is a fully working deployment.
 *  SOS kill switch: set LINKY_AI_OFF=true (Vercel env) to force Linky fully
 *  deterministic - zero calls to Gemini or Zen, every answer comes from the
 *  cited template paths. No redeploy, no key deletion, just one flag. */
export function aiReady() {
  if (String(process.env.LINKY_AI_OFF || '').toLowerCase() === 'true') return false;
  return !!(getGeminiKey() || getZenKey());
}

export function sendError(res, status, message, technical) {
  setCors(res);
  res.status(status).json({
    error: message,
    technical: (() => {
      let raw = String(technical || message);
      for (const key of [getGeminiKey(), getZenKey()]) if (key) raw = raw.split(key).join('[redacted-key]');
      return raw.slice(0, 500);
    })(),
  });
}

export function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export function compactProfile(profile) {
  return {
    uid: String(profile?.uid || '').slice(0, 128),
    displayName: String(profile?.displayName || '').slice(0, 80),
    role: String(profile?.role || profile?.occupation || '').slice(0, 80),
    goals: Array.isArray(profile?.goals || profile?.lookingFor)
      ? (profile?.goals || profile?.lookingFor).slice(0, 5).map((entry) => String(entry).slice(0, 80))
      : String(profile?.goals || '').slice(0, 160),
    skills: Array.isArray(profile?.skills) ? profile.skills.slice(0, 8).map((entry) => String(entry).slice(0, 80)) : [],
    industries: Array.isArray(profile?.industries) ? profile.industries.slice(0, 6).map((entry) => String(entry).slice(0, 80)) : [],
    workStyle: String(profile?.workStyle || '').slice(0, 80),
    commitment: String(profile?.commitment || profile?.commitmentLevel || '').slice(0, 80),
    stage: String(profile?.stage || profile?.startupStage || '').slice(0, 80),
    availability: String(profile?.availability || '').slice(0, 80),
    personality: String(profile?.personality || profile?.personalityType || '').slice(0, 140),
    roleSignals: typeof profile?.roleSignals === 'object' ? profile.roleSignals : profile?.roleAnswers || {},
  };
}

export function clippedJson(value, max = MAX_PROFILE_CHARS) {
  return JSON.stringify(value ?? {}).slice(0, max);
}

// Capacity is per-model: when one Gemini tier is shedding load (503, "high
// demand", overload), a sibling tier usually answers. Walk a short model
// chain — the same trick the Zen leg below has always used — instead of
// retrying the drowning model. Quota and auth failures fail for every model
// on the key, so those throw straight through to the Zen rescue, as before.
export async function callGemini(prompt, options = {}, apiKey) {
  // Retry discipline - the only retries in this file: 429 / 5xx capacity
  // blips get at most two retries with exponential backoff, honouring
  // Retry-After. Permanent errors (bad key, refused or retired model,
  // invalid request) are never retried, and neither are timeouts: one slow
  // attempt has already spent the caller's budget, and the Zen rescue plus
  // the callers' deterministic fallbacks are faster than a second hang.
  const maxRetries = options.disableCapacityRetry === true ? 0 : 2;
  let retries = 0;
  for (;;) {
    try {
      return await callGeminiOnce(prompt, options, apiKey, DEFAULT_MODEL);
    } catch (err) {
      const message = String(err?.message || err);
      const retryable = err?.retryable === true || /\b(429|500|503)\b|overloaded|high demand|capacity/i.test(message);
      if (!retryable || retries >= maxRetries) throw err;
      retries += 1;
      const base = Number(options.retryBaseMs) > 0 ? Number(options.retryBaseMs) : 800;
      const wait = Math.min(Math.max(Number(err?.retryAfterMs || 0), base * 2 ** (retries - 1)), 5000);
      console.warn(`[ai] gemini retry ${retries}/${maxRetries} in ${wait}ms: ${message.slice(0, 120)}`);
      await new Promise((resolve) => { setTimeout(resolve, wait); });
    }
  }
}
async function callGeminiOnce(prompt, options = {}, apiKey, model = DEFAULT_MODEL) {

  const generationConfig = {
    temperature: options.temperature ?? 0.25,
    maxOutputTokens: Math.max(128, Math.min(900, Number(options.maxOutputTokens || 260))),
  };
  if (options.responseMimeType) generationConfig.responseMimeType = options.responseMimeType;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    signal: AbortSignal.timeout(Number(options.timeoutMs || 12000)),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const err = new Error(data?.error?.message || `Gemini HTTP ${response.status}: ${raw.slice(0, 300)}`);
    if (response.status === 429 || response.status === 500 || response.status === 503) err.retryable = true;
    const retryAfterSec = Number(response.headers?.get?.('retry-after') || 0);
    if (retryAfterSec > 0) err.retryAfterMs = retryAfterSec * 1000;
    throw err;
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('').trim();
  if (!text) {
    throw new Error(`Gemini returned empty content. Finish reason: ${data?.candidates?.[0]?.finishReason || 'unknown'}`);
  }
  return text;
}

async function zenOnce(model, prompt, options, apiKey) {
  const response = await fetch(ZEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(Number(options.timeoutMs || 12000)),
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature ?? 0.25,
      max_tokens: Math.max(128, Math.min(1200, Number(options.maxOutputTokens || 260))),
      ...(options.responseMimeType ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) throw new Error(data?.error?.message || `Zen HTTP ${response.status}: ${raw.slice(0, 300)}`);
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('Zen returned an empty completion.');
  return text;
}

export async function callZen(prompt, options = {}, apiKey = getZenKey()) {
  return zenOnce(ZEN_MODEL, prompt, options, apiKey);
}

/**
 * One prompt, in through whichever model answers. Gemini first (cheaper, we
 * already pay for it), OpenCode Zen as the rescue. Both failing throws the
 * combined error - and every caller in Linky has a deterministic answer behind
 * it, so a throw here is never a message a member sees.
 */
const AI_MAX_CONCURRENT = 4;
const AI_MAX_PER_USER = 1;
let aiInFlight = 0;
const aiWaiters = [];
const aiUserInFlight = new Map();
const aiDeduped = new Map();
const estTokensText = (value) => Math.ceil(String(value || '').length / 4);

function acquireAiSlot() {
  if (aiInFlight < AI_MAX_CONCURRENT) { aiInFlight += 1; return Promise.resolve(); }
  return new Promise((resolve) => { aiWaiters.push(resolve); });
}
function releaseAiSlot() {
  const next = aiWaiters.shift();
  if (next) next();
  else aiInFlight = Math.max(0, aiInFlight - 1);
}

export async function aiText(prompt, options = {}) {
  // Identical prompts already in flight share one provider call and one
  // result - a double-tap or a duplicated dispatch can never bill twice.
  const userKey = String(options.userId || '');
  const dedupeKey = `${userKey}|${options.temperature ?? ''}|${options.maxOutputTokens ?? ''}|${String(prompt ?? '')}`;
  const existing = aiDeduped.get(dedupeKey);
  if (existing) return existing;
  const run = aiTextRun(prompt, options, userKey);
  aiDeduped.set(dedupeKey, run);
  try {
    return await run;
  } finally {
    if (aiDeduped.get(dedupeKey) === run) aiDeduped.delete(dedupeKey);
  }
}

async function aiTextRun(prompt, options, userKey) {
  if (userKey) {
    const held = aiUserInFlight.get(userKey) || 0;
    if (held >= AI_MAX_PER_USER) {
      throw new Error('ai_busy_for_user: this member already has an AI request in flight; answer deterministically instead.');
    }
    aiUserInFlight.set(userKey, held + 1);
  }
  await acquireAiSlot();
  const started = Date.now();
  const logUse = (fields) => {
    try {
      console.info('[ai]', JSON.stringify({ user: userKey || '-', agent: String(options.agent || '-'), estInTokens: estTokensText(prompt), ms: Date.now() - started, ...fields }));
    } catch { /* logging must never break a call */ }
  };
  try {
    const attempts = [
      ['gemini', getGeminiKey(), callGemini, DEFAULT_MODEL],
      ['zen', getZenKey(), callZen, ZEN_MODEL],
    ].filter(([, key]) => !!key);
    if (options.disableProviderFailover === true) attempts.splice(1);
    if (!attempts.length) {
      throw new Error('No AI provider configured (GEMINI_API_KEY or ZEN_API_KEY).');
    }
    const errors = [];
    for (const [provider, key, call, model] of attempts) {
      try {
        const text = await call(prompt, options, key);
        logUse({ provider, model, estOutTokens: estTokensText(text), ok: true });
        return { text, provider };
      } catch (err) {
        errors.push(`${provider}: ${String(err?.message || err).slice(0, 140)}`);
        if (provider === 'gemini') console.warn('[ai] gemini failed, trying Zen', String(err?.message || err).slice(0, 140));
      }
    }
    logUse({ provider: 'none', model: '-', estOutTokens: 0, ok: false });
    throw new Error(errors.join(' | '));
  } finally {
    releaseAiSlot();
    if (userKey) {
      const held = (aiUserInFlight.get(userKey) || 1) - 1;
      if (held <= 0) aiUserInFlight.delete(userKey);
      else aiUserInFlight.set(userKey, held);
    }
  }
}

/** Same answer, provider hidden - what every existing caller already expects. */
export async function geminiText(prompt, options = {}) {
  return (await aiText(prompt, options)).text;
}

const normalizeList = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean);
};

const sharedCount = (left, right) => {
  const rightSet = new Set(right);
  return Array.from(new Set(left)).filter((item) => rightSet.has(item)).length;
};

export function localRank(me, candidates, maxCandidates) {
  const mySkills = normalizeList(me.skills);
  const myIndustries = normalizeList(me.industries);
  const myGoals = normalizeList(Array.isArray(me.goals) ? me.goals : [me.goals]);
  const myRole = String(me.role || '').toLowerCase();

  return candidates
    .map((candidate) => {
      const sharedSkills = sharedCount(mySkills, normalizeList(candidate.skills));
      const sharedIndustries = sharedCount(myIndustries, normalizeList(candidate.industries));
      const sharedGoals = sharedCount(myGoals, normalizeList(Array.isArray(candidate.goals) ? candidate.goals : [candidate.goals]));
      const complementary =
        myRole && String(candidate.role || '').toLowerCase() && myRole !== String(candidate.role || '').toLowerCase()
          ? 8
          : 0;
      const score = Math.max(1, Math.min(100, 40 + sharedSkills * 12 + sharedIndustries * 8 + sharedGoals * 10 + complementary));
      const reasonParts = [];
      if (sharedSkills) reasonParts.push(`${sharedSkills} shared skill${sharedSkills === 1 ? '' : 's'}`);
      if (sharedIndustries) reasonParts.push(`${sharedIndustries} shared interest${sharedIndustries === 1 ? '' : 's'}`);
      if (sharedGoals) reasonParts.push(`${sharedGoals} shared goal${sharedGoals === 1 ? '' : 's'}`);
      if (complementary) reasonParts.push('complementary roles');
      return {
        uid: candidate.uid,
        score,
        reason: reasonParts.slice(0, 3).join(' / ') || 'Promising builder match',
        cached: true,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, maxCandidates);
}

/** Which model is actually wired up - names and models only, never a key value,
 *  so this is safe to serve from a diagnostic route. */
/** Which Zen models the account would answer, newest success first. */
export function zenModels() {
  return { wanted: ZEN_MODEL, healthy: ZEN_MODEL, chain: [ZEN_MODEL] };
}

export function aiStatus() {
  const g = firstEnv(GEMINI_KEY_NAMES);
  const z = firstEnv(ZEN_KEY_NAMES);
  const off = String(process.env.LINKY_AI_OFF || '').toLowerCase() === 'true';
  return {
    ready: !off && !!(g || z),
    off,
    gemini: { configured: !!g, from: g ? g[0] : '', model: process.env.GEMINI_MODEL || DEFAULT_MODEL },
    zen: { configured: !!z, from: z ? z[0] : '', model: ZEN_MODEL, healthyModel: ZEN_MODEL, url: ZEN_URL },
  };
}

/** One real round trip per provider, so "configured" can be told apart from
 *  "working" - and so a quota refusal on one key is not mistaken for a broken app. */
export async function aiProbe() {
  const status = aiStatus();
  if (status.off) {
    return { ok: true, off: true, attempts: [], note: 'LINKY_AI_OFF is set - deterministic mode, no model calls.' };
  }
  const started = Date.now();
  const attempts = [];
  const prompt = 'Reply with exactly this JSON and nothing else: {"pong":true}';
  const run = async (name, call, key) => {
    const t0 = Date.now();
    try {
      const text = await call(prompt, { temperature: 0, maxOutputTokens: 30 }, key);
      attempts.push({ provider: name, ok: true, ms: Date.now() - t0, said: String(text).slice(0, 40) });
      return true;
    } catch (err) {
      attempts.push({ provider: name, ok: false, ms: Date.now() - t0, error: String(err?.message || err).slice(0, 300) });
      return false;
    }
  };
  if (status.gemini.configured) await run('gemini', callGemini, getGeminiKey());
  if (status.zen.configured) await run('zen', callZen, getZenKey());
  const won = attempts.find((a) => a.ok);
  return {
    ok: !!won || attempts.length === 0,
    provider: won ? won.provider : '',
    ms: Date.now() - started,
    attempts,
    ...(attempts.length ? {} : { error: 'no provider key is set on this deployment' }),
  };
}
