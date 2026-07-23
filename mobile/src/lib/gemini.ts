import { httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';
import { functions } from './firebase';
import { describeAIError, hasDirectAIKey, recordAIError, requestGeminiText } from './aiDiagnostics';

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

const directAIEnabled = () =>
  String(process.env.EXPO_PUBLIC_ENABLE_DIRECT_AI || 'true').toLowerCase() !== 'false';

const serverAIEnabled = () =>
  String(process.env.EXPO_PUBLIC_ENABLE_SERVER_AI || '').toLowerCase() === 'true';

async function directGeminiText(prompt: string, maxOutputTokens = 220) {
  if (!directAIEnabled() || !hasDirectAIKey()) return null;
  return requestGeminiText(prompt, { temperature: 0.2, maxOutputTokens });
}

async function vercelAiText(task: string, payload: Record<string, unknown>) {
  if (!serverAIEnabled() || Platform.OS !== 'web' || typeof fetch !== 'function') return null;
  const response = await fetch('/api/aiAssist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.technical || data?.error || `Smart server failed: ${response.status}`);
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
    skills: skills.map((skill) => (skill === 'ai' ? 'Automation' : skill === 'ml' ? 'ML' : skill)),
    industry: industry ? industry.toUpperCase().replace('SAAS', 'SaaS') : undefined,
    location: locationMatch?.[1]?.trim(),
    lookingForCofounder: normalized.includes('cofounder') || normalized.includes('co-founder'),
  };
};

async function aiText(task: string, payload: Record<string, unknown>) {
  let directError: unknown = null;
  let serverError: unknown = null;
  let attemptedAI = false;
  try {
    if (task === 'searchFilters') {
      attemptedAI = directAIEnabled() && hasDirectAIKey();
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
      attemptedAI = directAIEnabled() && hasDirectAIKey();
      const direct = await directGeminiText(
        [
          'You generate short, punchy "Match Insights" for a founder profile in the LINKUP app.',
          'Return ONLY plain text (max 2 sentences). No quotes, no markdown.',
          'Focus on: work style, who they work best with, and what type of startup/team fits them.',
          'Profile JSON: ' + JSON.stringify(payload.profile || {}).slice(0, 2500),
        ].join('\n'),
        140
      );
      if (direct) return direct;
    }
  } catch (error) {
    directError = error;
    recordAIError(error, 'Smart feature unavailable');
  }

  try {
    attemptedAI = attemptedAI || serverAIEnabled();
    const server = await vercelAiText(task, payload);
    if (server) return server;
  } catch (error) {
    serverError = error;
    recordAIError(error, 'Smart server fallback unavailable');
  }

  if (serverAIEnabled()) {
    try {
      attemptedAI = true;
      const callable = httpsCallable(functions, 'aiAssist');
      const res = await callable({ task, payload });
      const text = (res.data as any)?.text;
      if (typeof text === 'string' && text.trim()) return text.trim();
    } catch (error) {
      recordAIError(error, 'Smart server fallback unavailable');
    }
  }

  if (directError) {
    throw new Error(describeAIError(directError));
  }
  if (serverError) {
    throw new Error(describeAIError(serverError));
  }

  return attemptedAI ? Promise.reject(new Error('Smart server returned empty content.')) : null;
}

export async function geminiToSearchFilters(input: string): Promise<GeminiFilterResult> {
  try {
    const text = await aiText('searchFilters', { input });
    if (!text) return localSearchFilters(input);
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
    return localSearchFilters(input);
  }
}

export async function geminiProfileInsights(profile: any): Promise<string> {
  try {
    const text = await aiText('profileInsights', { profile });
    if (text) return text;
  } catch (error) {
    // Local profile insights keep the UI useful when smart features are off or unavailable.
  }
    const role = profile?.occupation || 'builder';
    const skills = Array.isArray(profile?.skills) ? profile.skills.slice(0, 2).join(' + ') : 'execution';
    const lookingFor = Array.isArray(profile?.lookingFor) ? profile.lookingFor[0] : 'high-signal collaborators';
    return `Best matched with ${lookingFor || 'collaborators'} who need ${skills || role} strength.`;
}
