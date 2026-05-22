import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

type GeminiFilterResult = {
  query?: string;
  location?: string;
  skills?: string[];
  industry?: string;
  experience?: string;
  availability?: string;
  timezone?: string;
  lookingForCofounder?: boolean;
};

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';

const extractJsonObject = (text: string) => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
};

async function directGeminiText(prompt: string) {
  if (!GEMINI_API_KEY.trim()) return null;

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': GEMINI_API_KEY.trim(),
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('').trim();
  return typeof text === 'string' && text ? text : null;
}

const localSearchFilters = (input: string): GeminiFilterResult => {
  const normalized = input.toLowerCase();
  const skills = ['react', 'next.js', 'python', 'ai', 'ml', 'figma', 'sales', 'marketing', 'flutter', 'node.js', 'backend', 'frontend']
    .filter((skill) => normalized.includes(skill.replace('.', '')) || normalized.includes(skill));
  const industries = ['ai', 'saas', 'fintech', 'healthtech', 'edtech', 'gaming', 'crypto', 'e-commerce', 'robotics', 'cybersecurity'];
  const industry = industries.find((item) => normalized.includes(item.replace('-', '')) || normalized.includes(item));
  const locationMatch = input.match(/\bin\s+([a-zA-Z\s]+)$/i);
  return {
    query: input,
    skills: skills.map((skill) => (skill === 'ai' ? 'AI' : skill === 'ml' ? 'AI/ML' : skill)),
    industry: industry ? industry.toUpperCase().replace('SAAS', 'SaaS') : undefined,
    location: locationMatch?.[1]?.trim(),
    lookingForCofounder: normalized.includes('cofounder') || normalized.includes('co-founder'),
  };
};

async function aiText(task: string, payload: Record<string, unknown>) {
  try {
    if (task === 'searchFilters') {
      const direct = await directGeminiText(
        `Convert this LINKUP people search into compact JSON filters with keys query, location, skills, industry, experience, availability, timezone, lookingForCofounder. Return JSON only.\nSearch: ${String(payload.input || '')}`
      );
      if (direct) return direct;
    }

    if (task === 'profileInsights') {
      const direct = await directGeminiText(
        `Write one short premium startup-networking match insight for this profile. Keep under 22 words:\n${JSON.stringify(payload.profile || {})}`
      );
      if (direct) return direct;
    }
  } catch (error) {
    console.warn('Direct Gemini unavailable:', error);
  }

  try {
    const callable = httpsCallable(functions, 'aiAssist');
    const res = await callable({ task, payload });
    const text = (res.data as any)?.text;
    if (typeof text === 'string' && text.trim()) return text.trim();
  } catch {
    // Fall through to direct Gemini/local fallbacks for Expo Web demos.
  }

  throw new Error('AI returned empty content.');
}

export async function geminiToSearchFilters(input: string): Promise<GeminiFilterResult> {
  try {
    const text = await aiText('searchFilters', { input });
    const jsonText = extractJsonObject(text) ?? text;
    return JSON.parse(jsonText);
  } catch {
    return localSearchFilters(input);
  }
}

export async function geminiProfileInsights(profile: any): Promise<string> {
  try {
    return await aiText('profileInsights', { profile });
  } catch {
    const role = profile?.occupation || 'builder';
    const skills = Array.isArray(profile?.skills) ? profile.skills.slice(0, 2).join(' + ') : 'execution';
    const lookingFor = Array.isArray(profile?.lookingFor) ? profile.lookingFor[0] : 'high-signal collaborators';
    return `Best matched with ${lookingFor || 'collaborators'} who need ${skills || role} strength.`;
  }
}
