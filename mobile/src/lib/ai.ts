import { httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';
import { functions } from './firebase';
import { describeAIError, hasDirectAIKey, recordAIError, requestGeminiText } from './aiDiagnostics';

type AiPromptConfig = {
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
};

const clippedJson = (value: unknown, max = 1800) => JSON.stringify(value ?? {}).slice(0, max);

const compactWarmIntroProfile = (profile: any) => ({
  displayName: profile?.displayName || '',
  username: profile?.username || '',
  occupation: profile?.occupation || '',
  company: profile?.company || '',
  city: profile?.city || '',
  country: profile?.country || '',
  bio: profile?.bio || '',
  skills: Array.isArray(profile?.skills) ? profile.skills.slice(0, 8) : [],
  industries: Array.isArray(profile?.industries) ? profile.industries.slice(0, 6) : [],
  lookingFor: Array.isArray(profile?.lookingFor) ? profile.lookingFor.slice(0, 6) : [],
  startupStage: profile?.startupStage || '',
  availability: profile?.availability || '',
  workStyle: profile?.workStyle || '',
  commitmentLevel: profile?.commitmentLevel || '',
  networkingIntent: profile?.networkingIntent || '',
  projects: Array.isArray(profile?.projects)
    ? profile.projects.slice(0, 3).map((project: any) => ({
        title: project?.title || '',
        description: project?.description || '',
        status: project?.status || '',
      }))
    : [],
});

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
      'You are a supportive mentor for founders. Keep it short and punchy (1-2 sentences).',
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
    maxOutputTokens: 260,
    temperature: 0.55,
    prompt: [
      'You write excellent first messages for serious founders and builders.',
      'Draft a message from Me to Other.',
      'Make it specific to both profiles: mention 1-2 concrete overlaps, complementary skills, projects, industries, goals, or work style.',
      'Sound confident, warm, and natural. No generic networking fluff. No markdown. No subject line.',
      'Write 3-5 short sentences. End with one clear collaboration question.',
      'Me=' + clippedJson(compactWarmIntroProfile(payload.me), 1800),
      'Other=' + clippedJson(compactWarmIntroProfile(payload.other), 1800),
    ].join('\n'),
  }),
};

const directAIEnabled = () =>
  String(process.env.EXPO_PUBLIC_ENABLE_DIRECT_AI || 'true').toLowerCase() !== 'false';

const serverAIEnabled = () =>
  String(process.env.EXPO_PUBLIC_ENABLE_SERVER_AI || '').toLowerCase() === 'true';

async function directGeminiText(task: string, payload: Record<string, unknown>) {
  if (!directAIEnabled() || !hasDirectAIKey()) return null;
  const promptConfig = promptsByTask[task]?.(payload);
  if (!promptConfig) return null;
  return requestGeminiText(promptConfig.prompt, {
    temperature: promptConfig.temperature,
    maxOutputTokens: promptConfig.maxOutputTokens,
  });
}

async function vercelAiText(task: string, payload: Record<string, unknown>) {
  if (!serverAIEnabled() || Platform.OS !== 'web' || typeof fetch !== 'function') return null;
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const response = await fetch(`${baseUrl}/api/aiAssist`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ task, payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.technical || data?.error || `Smart server failed: ${response.status}`);
  }
  return typeof data?.text === 'string' && data.text.trim() ? data.text.trim() : null;
}

async function aiText(task: string, payload: Record<string, unknown>) {
  let directError: unknown = null;
  let serverError: unknown = null;
  let attemptedAI = false;

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

  try {
    attemptedAI = attemptedAI || serverAIEnabled();
    const server = await vercelAiText(task, payload);
    if (server) return server;
  } catch (error) {
    serverError = error;
    recordAIError(error, 'Smart server fallback unavailable');
  }

  try {
    attemptedAI = attemptedAI || (directAIEnabled() && hasDirectAIKey());
    const direct = await directGeminiText(task, payload);
    if (direct) return direct;
  } catch (error) {
    directError = error;
    recordAIError(error, 'Smart feature unavailable');
  }

  if (directError) {
    throw new Error(describeAIError(directError));
  }
  if (serverError) {
    throw new Error(describeAIError(serverError));
  }

  return attemptedAI ? Promise.reject(new Error('Smart server returned empty content.')) : null;
}

function extractFirstJsonBlock(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

export const getMatchingExplanation = async (user1: any, user2: any) => {
  try {
    const text = await aiText('matchingExplanation', { user1, user2 });
    if (text) return text;
  } catch (error) {
    // Local fallback keeps matching usable without surfacing infrastructure state.
  }
    const role1 = user1?.occupation || 'builder';
    const role2 = user2?.occupation || 'builder';
    return `Strong potential fit: ${role1} and ${role2} bring complementary startup signals.`;
};

export const analyzeStartupIdea = async (idea: string) => {
  try {
    const text = await aiText('startupAnalyzer', { idea });
    if (text) return JSON.parse(extractFirstJsonBlock(text) || '{}');
  } catch (error) {
    // Fall through to local analyzer.
  }
    const trimmed = idea.trim();
    const hasCustomer = /\b(for|helps|students|founders|businesses|teams|creators|developers|investors)\b/i.test(trimmed);
    const hasAi = /\b(ai|automation|agent|machine learning|gemini)\b/i.test(trimmed);
    const hasMonetization = /\b(subscription|saas|marketplace|commission|fee|premium|pay)\b/i.test(trimmed);
    const score = 45 + (hasCustomer ? 15 : 0) + (hasAi ? 8 : 0) + (hasMonetization ? 12 : 0);
    return {
      score: Math.min(82, score),
      verdict: hasCustomer ? 'Needs validation with real users' : 'Too broad - define the customer first',
      targetCustomer: hasCustomer ? 'Implied by the idea, but should be narrowed to one painful niche.' : 'Unclear. Pick one exact user group.',
      marketPotential: 'Potential depends on how urgent and frequent the problem is.',
      competition: 'Assume competitors exist; win with a narrower wedge, speed, or distribution advantage.',
      differentiation: hasAi ? 'Automation can help, but the workflow/result must be clearly better than existing tools.' : 'Needs a sharper unfair advantage.',
      monetization: hasMonetization ? 'Monetization is mentioned; validate willingness to pay early.' : 'Define who pays, when they pay, and why now.',
      keyRisks: ['Weak customer definition', 'Unproven willingness to pay', 'Distribution may be harder than product'],
      nextValidationStep: 'Interview 10 target users and ask what they currently use, what hurts, and what they would pay for.',
      summary: 'Good startup analysis requires customer clarity, pain intensity, and a small testable wedge.',
    };
};

export const generateAIComment = async (postContent: string) => {
  try {
    return await aiText('aiComment', { postContent });
  } catch (error) {
    return null;
  }
};

export const generateFeedback = async (postContent: string) => {
  try {
    const text = await aiText('buildFeedback', { postContent });
    if (text) return text;
  } catch (error) {
    // Local fallback keeps the feature usable without noisy alerts.
  }
    return 'Strong build signal. Next step: validate the sharpest user pain with 5 real conversations this week.';
};

export const generateWarmIntro = async (me: any, other: any) => {
  try {
    const text = await aiText('warmIntro', {
      me: compactWarmIntroProfile(me),
      other: compactWarmIntroProfile(other),
    });
    if (text) return text;
  } catch (error) {
    // Local fallback keeps warm intros available when smart features are off.
  }
    const otherName = other?.displayName?.split?.(' ')?.[0] || 'there';
    const myRole = me?.occupation || 'builder';
    const otherRole = other?.occupation || 'builder';
    return `Hey ${otherName}, I saw your profile and liked the way your ${otherRole} background lines up with what I am building as a ${myRole}. Looks like there could be a useful overlap between our skills and goals. Would you be open to exploring whether there is a collaboration fit?`;
};
