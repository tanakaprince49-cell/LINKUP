const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
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

export function getGeminiKey() {
  return String(
    process.env.GEMINI_API_KEY || process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
  ).trim();
}

export function sendError(res, status, message, technical) {
  setCors(res);
  res.status(status).json({
    error: message,
    technical: (() => {
      const raw = String(technical || message);
      const key = getGeminiKey();
      return (key ? raw.replace(key, '[redacted-key]') : raw).slice(0, 500);
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

export async function geminiText(prompt, options = {}) {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    throw new Error('Vercel AI API missing GEMINI_API_KEY or EXPO_PUBLIC_GEMINI_API_KEY.');
  }

  const generationConfig = {
    temperature: options.temperature ?? 0.25,
    maxOutputTokens: Math.max(128, Math.min(900, Number(options.maxOutputTokens || 260))),
  };
  if (options.responseMimeType) generationConfig.responseMimeType = options.responseMimeType;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`, {
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
    throw new Error(data?.error?.message || `Gemini HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('').trim();
  if (!text) {
    throw new Error(`Gemini returned empty content. Finish reason: ${data?.candidates?.[0]?.finishReason || 'unknown'}`);
  }
  return text;
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


