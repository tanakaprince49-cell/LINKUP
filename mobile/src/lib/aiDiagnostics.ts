import { Platform } from 'react-native';

export const GEMINI_MODEL = 'gemini-2.5-flash-lite';

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
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);
}

export function describeAIError(error: unknown) {
  const key = getGeminiApiKey();
  const status = Number((error as any)?.status || 0) || undefined;
  const rawMessage = compactTechnical((error as any)?.technical || (error as any)?.message || error);
  const lower = rawMessage.toLowerCase();

  if (lower.includes('cors') || lower.includes('failed to fetch') || lower.includes('network') || lower.includes('preflight')) {
    return `Network/CORS problem reaching the AI backend. The web app will use the same-origin Vercel AI route when deployed. Details: ${rawMessage}`;
  }
  if (lower.includes('cloudfunctions.net') || lower.includes('not-found') || lower.includes('404')) {
    return `Firebase Cloud Function is unavailable or not deployed. The web app should use /api/aiAssist and /api/rankCandidates on Vercel instead. Details: ${rawMessage}`;
  }
  if (
    lower.includes('vercel ai api missing') ||
    lower.includes('missing gemini_api_key') ||
    lower.includes('missing google_api_key')
  ) {
    return 'Vercel AI key is missing. Add GEMINI_API_KEY in Vercel Environment Variables, then create a new production deployment.';
  }

  if (!key) {
    return 'Gemini API key is missing in this build. Add EXPO_PUBLIC_GEMINI_API_KEY in Vercel Environment Variables and mobile/.env, then redeploy/restart Expo.';
  }

  if (status === 400) return `Gemini rejected the request. Check the model/prompt format. Details: ${rawMessage}`;
  if (status === 401 || status === 403) {
    return `Gemini API key/auth problem. Check that the key is valid, Generative Language API is enabled, and API restrictions allow this app domain. Details: ${rawMessage}`;
  }
  if (status === 404) return `Gemini model is not available for this key/API version. Current model: ${GEMINI_MODEL}. Details: ${rawMessage}`;
  if (status === 429 || lower.includes('quota') || lower.includes('rate limit')) {
    return `Gemini quota/rate limit hit. Wait a minute or raise quota in Google AI Studio. Details: ${rawMessage}`;
  }
  if (status === 503 || lower.includes('high demand') || lower.includes('unavailable')) {
    return `Gemini is temporarily overloaded. Try again shortly. Details: ${rawMessage}`;
  }
  if (lower.includes('max_tokens') || lower.includes('finishreason') || lower.includes('empty content')) {
    return `Gemini responded but stopped before returning text because the output token limit was too low. The app has increased the token budget; redeploy and try again. Details: ${rawMessage}`;
  }
  return rawMessage || 'Unknown Gemini error. Open the browser console for the technical details.';
}

export function recordAIError(error: unknown, title = 'AI problem found') {
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
  const key = getGeminiApiKey();
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
    throw new GeminiRequestError(`Gemini returned empty content.${finishReason}`, undefined, raw);
  }

  setLastAIDiagnostic({
    ok: true,
    title: 'AI online',
    message: `Gemini is responding with ${GEMINI_MODEL}.`,
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
      title: 'AI online',
      message: `Gemini API key is working. Model: ${GEMINI_MODEL}.`,
      timestamp: Date.now(),
    });
  } catch (error) {
    return recordAIError(error, 'AI setup check failed');
  }
}
