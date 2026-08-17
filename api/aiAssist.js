import { clippedJson, geminiText, handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';

const promptsByTask = {
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
  searchFilters: (payload) => ({
    maxOutputTokens: 220,
    temperature: 0.1,
    prompt: [
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
      `Search: ${String(payload.input || '').slice(0, 500)}`,
    ].join('\n'),
  }),
  profileInsights: (payload) => ({
    maxOutputTokens: 140,
    temperature: 0.25,
    prompt: [
      'You generate short, punchy "Match Insights" for a founder profile in the LINKUP app.',
      'Return ONLY plain text (max 2 sentences). No quotes, no markdown.',
      'Focus on: work style, who they work best with, and what type of startup/team fits them.',
      'Profile JSON: ' + clippedJson(payload.profile, 2500),
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
      'Me=' + clippedJson(payload.me, 1800),
      'Other=' + clippedJson(payload.other, 1800),
    ].join('\n'),
  }),
  matchingExplanation: (payload) => ({
    maxOutputTokens: 220,
    prompt: [
      'You are a professional co-founder matchmaker.',
      'Write a concise, encouraging explanation (2-4 sentences).',
      'Focus on skills compatibility, goals alignment, and personality fit.',
      'FounderA=' + clippedJson(payload.user1, 1800),
      'FounderB=' + clippedJson(payload.user2, 1800),
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
  linkyChat: (payload) => ({
    maxOutputTokens: 600,
    temperature: 0.55,
    prompt: String(payload.prompt || '').slice(0, 4000),
  }),
};

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') {
    sendError(res, 405, 'Use POST for LINKUP AI.');
    return;
  }

  try {
    const body = readJsonBody(req);
    const task = String(body.task || '').trim();
    const payload = body.payload || {};
    const promptConfig = promptsByTask[task] ? promptsByTask[task](payload) : null;
    if (!promptConfig) {
      sendError(res, 400, 'Unsupported AI task.');
      return;
    }

    const text = await geminiText(promptConfig.prompt, {
      temperature: promptConfig.temperature,
      maxOutputTokens: promptConfig.maxOutputTokens,
    });

    setCors(res);
    res.status(200).json({ text });
  } catch (error) {
    sendError(res, 500, 'LINKUP AI failed on Vercel.', error);
  }
};
