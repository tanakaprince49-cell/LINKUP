import { Platform } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { describeAIError, getGeminiApiKey, recordAIError, requestGeminiText } from './aiDiagnostics';

const promptsByTask: Record<string, (payload: Record<string, unknown>) => string> = {
  matchingExplanation: (payload) =>
    `Explain in one concise sentence why these two LINKUP builders may be compatible:\nUser A: ${JSON.stringify(payload.user1 || {})}\nUser B: ${JSON.stringify(payload.user2 || {})}`,
  startupAnalyzer: (payload) =>
    `Analyze this startup idea as JSON with score, verdict, targetCustomer, marketPotential, competition, monetization, keyRisks array, nextValidationStep, summary. JSON only.\nIdea: ${String(payload.idea || '')}`,
  aiComment: (payload) =>
    `Write one smart, supportive LINKUP comment for this builder post. Keep it short:\n${String(payload.postContent || '')}`,
  buildFeedback: (payload) =>
    `Give concise founder/product feedback for this LINKUP build update. Mention one strength and one next step:\n${String(payload.postContent || '')}`,
  warmIntro: (payload) =>
    `Write a warm first message between matched startup builders. Keep under 28 words.\nMe: ${JSON.stringify(payload.me || {})}\nOther: ${JSON.stringify(payload.other || {})}`,
};

async function directGeminiText(task: string, payload: Record<string, unknown>) {
  if (!getGeminiApiKey()) return null;
  const prompt = promptsByTask[task]?.(payload);
  if (!prompt) return null;
  const maxOutputTokens = task === 'startupAnalyzer' ? 420 : 180;
  return requestGeminiText(prompt, { temperature: 0.2, maxOutputTokens });
}

async function aiText(task: string, payload: Record<string, unknown>) {
  let directError: unknown = null;
  try {
    const direct = await directGeminiText(task, payload);
    if (direct) return direct;
  } catch (error) {
    directError = error;
    recordAIError(error, 'Direct Gemini unavailable');
  }

  if (Platform.OS === 'web') {
    throw new Error(
      directError
        ? describeAIError(directError)
        : 'Missing EXPO_PUBLIC_GEMINI_API_KEY on web. Add it to Vercel Environment Variables and redeploy.'
    );
  }

  try {
    const callable = httpsCallable(functions, 'aiAssist');
    const res = await callable({ task, payload });
    const text = (res.data as any)?.text;
    if (typeof text === 'string' && text.trim()) return text.trim();
  } catch (error) {
    recordAIError(error, 'Cloud Functions AI fallback unavailable');
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
