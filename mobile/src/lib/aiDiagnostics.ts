import { Platform } from 'react-native';

export const GEMINI_MODEL = 'gemini-2.5-flash-lite';
export const OPENROUTER_MODEL = process.env.EXPO_PUBLIC_OPENROUTER_MODEL || 'deepseek/deepseek-chat';

type GeminiRequestOptions = {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
};

export type AIDiagnostic = {
  ok: boolean;
  title: string;
  message: string;
  technical?: string;
  status?: number;
  timestamp: number;
};

class GeminiRequestError extends Error {
  status?: number;
  technical?: string;

  constructor(message: string, status?: number, technical?: string) {
    super(message);
    this.name = 'GeminiRequestError';
    this.status = status;
    this.technical = technical;
  }
}

let lastAIDiagnostic: AIDiagnostic | null = null;

export function getGeminiApiKey() {
  const envKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
  const runtimeKey =
    Platform.OS === 'web'
      ? String((globalThis as any).__LINKUP_GEMINI_API_KEY || (globalThis as any).LINKUP_GEMINI_API_KEY || '')
      : '';

  return String(envKey || runtimeKey).trim();
}

export function getOpenRouterApiKey() {
  const envKey = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY || '';
  const runtimeKey =
    Platform.OS === 'web'
      ? String((globalThis as any).__LINKUP_OPENROUTER_API_KEY || (globalThis as any).LINKUP_OPENROUTER_API_KEY || '')
      : '';

  return String(envKey || runtimeKey).trim();
}

export function hasDirectAIKey() {
  return !!(getGeminiApiKey() || getOpenRouterApiKey());
}

export function getLastAIDiagnostic() {
  return lastAIDiagnostic;
}

function setLastAIDiagnostic(diagnostic: AIDiagnostic) {
  lastAIDiagnostic = diagnostic;
  return diagnostic;
}

function compactTechnical(value: unknown) {
  return String(value || '')
    .replace(getGeminiApiKey(), '[redacted-key]')
    .replace(getOpenRouterApiKey(), '[redacted-key]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);
}

export function describeAIError(error: unknown) {
  const status = Number((error as any)?.status || 0) || undefined;
  const rawMessage = compactTechnical((error as any)?.technical || (error as any)?.message || error);
  const lower = rawMessage.toLowerCase();

  if (lower.includes('cors') || lower.includes('failed to fetch') || lower.includes('network') || lower.includes('preflight')) {
    return 'The smart server is unreachable right now. Showing the best local result instead.';
  }
  if (lower.includes('cloudfunctions.net') || lower.includes('not-found') || lower.includes('404')) {
    return 'The smart server is not available right now. Showing the best local result instead.';
  }
  if (
    lower.includes('vercel ai api missing') ||
    lower.includes('missing gemini_api_key') ||
    lower.includes('missing google_api_key') ||
    lower.includes('missing expo_public_openrouter_api_key') ||
    lower.includes('missing openrouter')
  ) {
    return 'Smart features are not fully configured yet. Showing the best local result instead.';
  }

  if (!getGeminiApiKey() && !getOpenRouterApiKey()) {
    return 'Smart features are not fully configured yet. Showing the best local result instead.';
  }

  if (status === 400) return 'The smart server could not process that request. Showing the best local result instead.';
  if (status === 401 || status === 403) {
    return 'Smart features are temporarily unavailable. Showing the best local result instead.';
  }
  if (status === 404) return 'The smart server is not available right now. Showing the best local result instead.';
  if (status === 429 || lower.includes('quota') || lower.includes('rate limit')) {
    return 'The smart server is busy right now. Showing the best local result instead.';
  }
  if (status === 503 || lower.includes('high demand') || lower.includes('unavailable')) {
    return 'The smart server is busy right now. Showing the best local result instead.';
  }
  if (lower.includes('max_tokens') || lower.includes('finishreason') || lower.includes('empty content')) {
    return 'The smart server returned an incomplete response. Showing the best local result instead.';
  }
  return 'The smart server is busy right now. Showing the best local result instead.';
}

export function recordAIError(error: unknown, title = 'Smart feature problem found') {
  const diagnostic = setLastAIDiagnostic({
    ok: false,
    title,
    message: describeAIError(error),
    technical: compactTechnical((error as any)?.technical || (error as any)?.message || error),
    status: Number((error as any)?.status || 0) || undefined,
    timestamp: Date.now(),
  });
  console.warn(`${title}:`, diagnostic.message);
  return diagnostic;
}

export async function requestGeminiText(prompt: string, options: GeminiRequestOptions = {}) {
  const geminiKey = getGeminiApiKey();
  if (geminiKey) {
    try {
      return await requestGoogleGeminiText(prompt, options, geminiKey);
    } catch (error) {
      if (!getOpenRouterApiKey()) {
        throw error;
      }
      return requestOpenRouterText(prompt, options);
    }
  }

  return requestOpenRouterText(prompt, options);
}

async function requestGoogleGeminiText(prompt: string, options: GeminiRequestOptions = {}, key = getGeminiApiKey()) {
  if (!key) {
    throw new GeminiRequestError('Missing EXPO_PUBLIC_GEMINI_API_KEY');
  }

  const generationConfig: Record<string, unknown> = {};
  if (typeof options.temperature === 'number') generationConfig.temperature = options.temperature;
  generationConfig.maxOutputTokens = Math.max(128, Number(options.maxOutputTokens || 256));
  if (options.responseMimeType) generationConfig.responseMimeType = options.responseMimeType;

  let response: any;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': key,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
      }),
    });
  } catch (error) {
    throw new GeminiRequestError('Failed to fetch Gemini response', undefined, (error as any)?.message || String(error));
  }

  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new GeminiRequestError(
      data?.error?.message || `Gemini request failed: ${response.status}`,
      response.status,
      raw
    );
  }

  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new GeminiRequestError(`Gemini blocked the prompt: ${blockReason}`, undefined, raw);
  }

  const firstCandidate = data?.candidates?.[0];
  const text = firstCandidate?.content?.parts?.map((part: any) => part?.text || '').join('').trim();
  if (!text) {
    const finishReason = firstCandidate?.finishReason ? ` Finish reason: ${firstCandidate.finishReason}.` : '';
    throw new GeminiRequestError(`Smart server returned empty content.${finishReason}`, undefined, raw);
  }

  setLastAIDiagnostic({
    ok: true,
    title: 'Smart features online',
    message: 'Smart features are online.',
    timestamp: Date.now(),
  });

  return text;
}

async function requestOpenRouterText(prompt: string, options: GeminiRequestOptions = {}) {
  const key = getOpenRouterApiKey();
  if (!key) {
    throw new GeminiRequestError('Missing EXPO_PUBLIC_GEMINI_API_KEY or EXPO_PUBLIC_OPENROUTER_API_KEY');
  }

  let response: any;
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'LINKUP',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: typeof options.temperature === 'number' ? options.temperature : 0.25,
        max_tokens: Math.max(128, Number(options.maxOutputTokens || 256)),
      }),
    });
  } catch (error) {
    throw new GeminiRequestError('Failed to fetch OpenRouter response', undefined, (error as any)?.message || String(error));
  }

  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new GeminiRequestError(
      data?.error?.message || `OpenRouter request failed: ${response.status}`,
      response.status,
      raw
    );
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    const finishReason = data?.choices?.[0]?.finish_reason ? ` Finish reason: ${data.choices[0].finish_reason}.` : '';
    throw new GeminiRequestError(`OpenRouter returned empty content.${finishReason}`, undefined, raw);
  }

  setLastAIDiagnostic({
    ok: true,
    title: 'Smart features online',
    message: 'Smart features are online.',
    timestamp: Date.now(),
  });

  return text;
}

export async function testGeminiConnection() {
  try {
    await requestGeminiText('Reply with LINKUP_AI_OK only.', {
      temperature: 0,
      maxOutputTokens: 128,
    });
    return setLastAIDiagnostic({
      ok: true,
      title: 'Smart features online',
      message: 'Smart features are online.',
      timestamp: Date.now(),
    });
  } catch (error) {
    return recordAIError(error, 'Smart feature setup check failed');
  }
}
