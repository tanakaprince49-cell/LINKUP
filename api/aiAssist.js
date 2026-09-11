import { clippedJson, geminiText, handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import { verifyRequestUser } from './_firebaseAdmin.js';

// A profile has a dozen optional fields; the model only needs the ones that
// can actually influence a match. Sending the rest is pure token spend.
const slimProfile = (profile) => {
  const p = profile || {};
  return {
    displayName: String(p.displayName || p.username || '').slice(0, 80),
    occupation: String(p.occupation || '').slice(0, 80),
    company: String(p.company || '').slice(0, 60),
    city: String(p.city || '').slice(0, 40),
    skills: Array.isArray(p.skills) ? p.skills.slice(0, 8).map((s) => String(s).slice(0, 60)) : [],
    industries: Array.isArray(p.industries) ? p.industries.slice(0, 6).map((s) => String(s).slice(0, 60)) : [],
    lookingFor: Array.isArray(p.lookingFor) ? p.lookingFor.slice(0, 5).map((s) => String(s).slice(0, 80)) : [],
    startupStage: String(p.startupStage || '').slice(0, 60),
    workStyle: String(p.workStyle || '').slice(0, 60),
    projects: Array.isArray(p.projects)
      ? p.projects.slice(0, 2).map((x) => ({ title: String(x?.title || '').slice(0, 60), status: String(x?.status || '').slice(0, 40) }))
      : [],
  };
};

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
      'Profile JSON: ' + clippedJson(slimProfile(payload.profile), 1200),
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
      'Me=' + clippedJson(slimProfile(payload.me), 1200),
      'Other=' + clippedJson(slimProfile(payload.other), 1200),
    ].join('\n'),
  }),
  matchingExplanation: (payload) => ({
    maxOutputTokens: 220,
    prompt: [
      'You are a professional co-founder matchmaker.',
      'Write a concise, encouraging explanation (2-4 sentences).',
      'Focus on skills compatibility, goals alignment, and personality fit.',
      'FounderA=' + clippedJson(slimProfile(payload.user1), 1200),
      'FounderB=' + clippedJson(slimProfile(payload.user2), 1200),
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
};

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') {
    sendError(res, 405, 'Use POST for LINKUP AI.');
    return;
  }

  // The model call below costs money, so the endpoint must not be usable by
  // anyone who is not signed in (quota theft). The web client sends the
  // Firebase ID token; the Cloud Function equivalent already enforces this.
  const user = await verifyRequestUser(req);
  if (!user?.uid) {
    sendError(res, 401, 'Sign in to use LINKUP AI.');
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
