import { httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';
import { functions } from './firebase';
import { describeAIError, getGeminiApiKey, recordAIError, requestGeminiText } from './aiDiagnostics';

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

const extractJsonObject = (text: string) => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
};

const parseSearchFilterText = (text: string, input: string): GeminiFilterResult => {
  const result: GeminiFilterResult = { query: input };
  const keyMap: Record<string, keyof GeminiFilterResult> = {
    query: 'query',
    search: 'query',
    location: 'location',
    skills: 'skills',
    skill: 'skills',
    industry: 'industry',
    experience: 'experience',
    availability: 'availability',
    timezone: 'timezone',
    lookingforcofounder: 'lookingForCofounder',
    cofounder: 'lookingForCofounder',
  };

  text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```(?:json)?/g, '').replace(/```/g, ''))
    .split(/\r?\n/)
    .forEach((line) => {
      const match = line.match(/^\s*[-*]?\s*([a-zA-Z _-]+)\s*:\s*(.*?)\s*$/);
      if (!match) return;
      const key = keyMap[match[1].toLowerCase().replace(/[^a-z]/g, '')];
      const value = match[2].trim();
      if (!key || !value || value === '-' || value.toLowerCase() === 'null') return;

      if (key === 'skills') {
        result.skills = value
          .split(/[,|]/)
          .map((skill) => skill.trim())
          .filter(Boolean)
          .slice(0, 8);
        return;
      }

      if (key === 'lookingForCofounder') {
        result.lookingForCofounder = /^(true|yes|y|1)$/i.test(value);
        return;
      }

      (result as any)[key] = value;
    });

  return result;
};

async function directGeminiText(prompt: string) {
  if (!getGeminiApiKey()) return null;
  return requestGeminiText(prompt, { temperature: 0.2, maxOutputTokens: 220 });
}

async function vercelAiText(task: string, payload: Record<string, unknown>) {
  if (Platform.OS !== 'web' || typeof fetch !== 'function') return null;
  const response = await fetch('/api/aiAssist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.technical || data?.error || `Vercel AI failed: ${response.status}`);
  }
  return typeof data?.text === 'string' && data.text.trim() ? data.text.trim() : null;
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
  let directError: unknown = null;
  let serverError: unknown = null;
  try {
    if (task === 'searchFilters') {
      const direct = await directGeminiText(
        [
          'Convert this LINKUP people search into simple filters.',
          'Return plain text only, no JSON and no markdown.',
          'Use exactly these lines:',
          'query:',
          'location:',
          'skills:',
          'industry:',
          'experience:',
          'availability:',
          'timezone:',
          'lookingForCofounder:',
          'Use comma-separated skills and true/false for lookingForCofounder.',
          `Search: ${String(payload.input || '')}`,
        ].join('\n')
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
    directError = error;
    recordAIError(error, 'Direct Gemini unavailable');
  }

  try {
    const server = await vercelAiText(task, payload);
    if (server) return server;
  } catch (error) {
    serverError = error;
    recordAIError(error, 'Vercel AI fallback unavailable');
    if (Platform.OS === 'web') {
      throw new Error(describeAIError(directError || serverError));
    }
  }

  try {
    const callable = httpsCallable(functions, 'aiAssist');
    const res = await callable({ task, payload });
    const text = (res.data as any)?.text;
    if (typeof text === 'string' && text.trim()) return text.trim();
  } catch (error) {
    recordAIError(error, 'Cloud Functions AI fallback unavailable');
  }

  if (directError) {
    throw new Error(describeAIError(directError));
  }
  if (serverError) {
    throw new Error(describeAIError(serverError));
  }

  throw new Error('AI returned empty content.');
}

export async function geminiToSearchFilters(input: string): Promise<GeminiFilterResult> {
  try {
    const text = await aiText('searchFilters', { input });
    const jsonText = extractJsonObject(text) ?? text;
    if (jsonText.trim().startsWith('{')) {
      try {
        return JSON.parse(jsonText);
      } catch {
        // Gemini sometimes returns almost-JSON. Fall through to the safer line parser.
      }
    }

    const parsed = parseSearchFilterText(text, input);
    const local = localSearchFilters(input);
    return {
      ...local,
      ...parsed,
      skills: parsed.skills?.length ? parsed.skills : local.skills,
    };
  } catch (error) {
    recordAIError(error, 'AI search fallback active');
    return localSearchFilters(input);
  }
}

export async function geminiProfileInsights(profile: any): Promise<string> {
  try {
    return await aiText('profileInsights', { profile });
  } catch (error) {
    recordAIError(error, 'AI profile insight fallback active');
    const role = profile?.occupation || 'builder';
    const skills = Array.isArray(profile?.skills) ? profile.skills.slice(0, 2).join(' + ') : 'execution';
    const lookingFor = Array.isArray(profile?.lookingFor) ? profile.lookingFor[0] : 'high-signal collaborators';
    return `Best matched with ${lookingFor || 'collaborators'} who need ${skills || role} strength.`;
  }
}
