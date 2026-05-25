import { httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';
import { functions } from './firebase';
import { describeAIError, getGeminiApiKey, recordAIError, requestGeminiText } from './aiDiagnostics';

type AiPromptConfig = {
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
};

const clippedJson = (value: unknown, max = 1800) => JSON.stringify(value ?? {}).slice(0, max);

const promptsByTask: Record<string, (payload: Record<string, unknown>) => AiPromptConfig> = {
  matchingExplanation: (payload) => ({
    maxOutputTokens: 220,
    temperature: 0.2,
    prompt: [
      'You are a professional co-founder matchmaker.',
      'Write a concise, encouraging explanation (2-4 sentences).',
      'Focus on skills compatibility, goals alignment, and personality fit.',
      'FounderA=' + clippedJson(payload.user1),
      'FounderB=' + clippedJson(payload.user2),
    ].join('\n'),
  }),
  startupAnalyzer: (payload) => ({
    maxOutputTokens: 520,
    temperature: 0.25,
    prompt: [
      'You are LINKUP Startup Analyzer: a sharp startup operator, VC, and product strategist.',
      'Be critical, practical, and concise. Do not hype weak ideas.',
      'Respond ONLY with a valid JSON object and nothing else.',
      `Evaluate this startup idea: "${String(payload.idea || '').trim().slice(0, 1500)}"`,
      'Return format:',
      '{"score":72,"verdict":"Promising but needs sharper wedge","targetCustomer":"...","marketPotential":"...","competition":"...","differentiation":"...","monetization":"...","keyRisks":["...","..."],"nextValidationStep":"...","summary":"..."}',
    ].join('\n'),
  }),
  aiComment: (payload) => ({
    maxOutputTokens: 120,
    temperature: 0.35,
    prompt: [
      'You are a supportive AI mentor for founders. Keep it short and punchy (1-2 sentences).',
      `Post: "${String(payload.postContent || '').slice(0, 1200)}"`,
    ].join('\n'),
  }),
  buildFeedback: (payload) => ({
    maxOutputTokens: 220,
    temperature: 0.4,
    prompt: [
      "You are the 'Brutal Build Roaster'. Be raw but helpful. Be punchy (3-6 sentences).",
      'End with exactly 1 actionable improvement as a single bullet.',
      `Build update: "${String(payload.postContent || '').slice(0, 1200)}"`,
    ].join('\n'),
  }),
  warmIntro: (payload) => ({
    maxOutputTokens: 220,
    temperature: 0.45,
    prompt: [
      'You are a professional co-founder matchmaker.',
      'Write a warm, enthusiastic opening message that feels human and specific.',
      'Write 4-6 sentences. End with 1 clear question.',
      'Me=' + clippedJson(payload.me),
      'Other=' + clippedJson(payload.other),
    ].join('\n'),
  }),
};

async function directGeminiText(task: string, payload: Record<string, unknown>) {
  if (!getGeminiApiKey()) return null;
  const promptConfig = promptsByTask[task]?.(payload);
  if (!promptConfig) return null;
  return requestGeminiText(promptConfig.prompt, {
    temperature: promptConfig.temperature,
    maxOutputTokens: promptConfig.maxOutputTokens,
  });
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

async function aiText(task: string, payload: Record<string, unknown>) {
  let directError: unknown = null;
  let serverError: unknown = null;
  try {
    const direct = await directGeminiText(task, payload);
    if (direct) return direct;
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

function extractFirstJsonBlock(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

export const getMatchingExplanation = async (user1: any, user2: any) => {
  try {
    return await aiText('matchingExplanation', { user1, user2 });
  } catch (error) {
    console.error('AI matching explanation unavailable:', describeAIError(error));
    const role1 = user1?.occupation || 'builder';
    const role2 = user2?.occupation || 'builder';
    return `Strong potential fit: ${role1} and ${role2} bring complementary startup signals.`;
  }
};

export const analyzeStartupIdea = async (idea: string) => {
  try {
    const text = await aiText('startupAnalyzer', { idea });
    return JSON.parse(extractFirstJsonBlock(text) || '{}');
  } catch (error) {
    const diagnostic = describeAIError(error);
    console.error('AI startup analyzer unavailable:', diagnostic);
    const trimmed = idea.trim();
    const hasCustomer = /\b(for|helps|students|founders|businesses|teams|creators|developers|investors)\b/i.test(trimmed);
    const hasAi = /\b(ai|automation|agent|machine learning|gemini)\b/i.test(trimmed);
    const hasMonetization = /\b(subscription|saas|marketplace|commission|fee|premium|pay)\b/i.test(trimmed);
    const score = 45 + (hasCustomer ? 15 : 0) + (hasAi ? 8 : 0) + (hasMonetization ? 12 : 0);
    return {
      score: Math.min(82, score),
      verdict: hasCustomer ? 'Needs validation with real users' : 'Too broad — define the customer first',
      targetCustomer: hasCustomer ? 'Implied by the idea, but should be narrowed to one painful niche.' : 'Unclear. Pick one exact user group.',
      marketPotential: 'Potential depends on how urgent and frequent the problem is.',
      competition: 'Assume competitors exist; win with a narrower wedge, speed, or distribution advantage.',
      differentiation: hasAi ? 'AI can help, but the workflow/result must be clearly better than existing tools.' : 'Needs a sharper unfair advantage.',
      monetization: hasMonetization ? 'Monetization is mentioned; validate willingness to pay early.' : 'Define who pays, when they pay, and why now.',
      keyRisks: ['Weak customer definition', 'Unproven willingness to pay', 'Distribution may be harder than product'],
      nextValidationStep: 'Interview 10 target users and ask what they currently use, what hurts, and what they would pay for.',
      summary: 'Good startup analysis requires customer clarity, pain intensity, and a small testable wedge.',
      aiDiagnostic: diagnostic,
    };
  }
};

export const generateAIComment = async (postContent: string) => {
  try {
    return await aiText('aiComment', { postContent });
  } catch (error) {
    console.error('AI comment unavailable:', describeAIError(error));
    return null;
  }
};

export const generateFeedback = async (postContent: string) => {
  try {
    return await aiText('buildFeedback', { postContent });
  } catch (error) {
    console.error('AI feedback unavailable:', describeAIError(error));
    return 'Strong build signal. Next step: validate the sharpest user pain with 5 real conversations this week.';
  }
};

export const generateWarmIntro = async (me: any, other: any) => {
  try {
    return await aiText('warmIntro', { me, other });
  } catch (error) {
    console.error('AI intro unavailable:', describeAIError(error));
    return 'Hey! Saw we matched, excited to see what we can build together.';
  }
};
