const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

async function geminiText(prompt: string, opts?: { temperature?: number; maxOutputTokens?: number }) {
  if (!GEMINI_API_KEY) {
    throw new Error('Missing EXPO_PUBLIC_GEMINI_API_KEY');
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(
      GEMINI_API_KEY
    )}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts?.temperature ?? 0.2,
          maxOutputTokens: opts?.maxOutputTokens ?? 200,
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json: any = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty content.');
  return text.trim();
}

function extractFirstJsonBlock(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

export const getMatchingExplanation = async (user1: any, user2: any) => {
  try {
    const prompt = [
      'You are a professional co-founder matchmaker.',
      'Write a concise, encouraging explanation (2-4 sentences).',
      'Focus on skills compatibility, goals alignment, and personality fit.',
      '',
      'FounderA=' + JSON.stringify(user1),
      'FounderB=' + JSON.stringify(user2),
    ].join('\n');
    return await geminiText(prompt, { maxOutputTokens: 220, temperature: 0.3 });
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Compatibility analysis unavailable.";
  }
};

export const analyzeStartupIdea = async (idea: string) => {
  try {
    const prompt = [
      'You are an expert startup analyst and VC. Be critical but constructive.',
      'Respond ONLY with a valid JSON object and nothing else.',
      '',
      `Evaluate this startup idea: "${idea}"`,
      'Provide a breakdown of marketPotential, competition, scalability, monetization, summary.',
      '',
      'Return format:',
      '{"marketPotential":"...","competition":"...","scalability":"...","monetization":"...","summary":"..."}',
    ].join('\n');
    const text = await geminiText(prompt, { maxOutputTokens: 260, temperature: 0.25 });
    const json = extractFirstJsonBlock(text);
    return JSON.parse(json || "{}");
  } catch (error) {
    console.error("Gemini Error:", error);
    return null;
  }
};

export const generateAIComment = async (postContent: string) => {
  try {
    const prompt = [
      "You are a supportive AI mentor for founders. Keep it short and punchy (1-2 sentences).",
      `Post: "${postContent}"`,
    ].join('\n');
    return await geminiText(prompt, { maxOutputTokens: 120, temperature: 0.35 });
  } catch (error) {
    console.error("Gemini Error:", error);
    return null;
  }
};
export const generateFeedback = async (postContent: string) => {
  try {
    const prompt = [
      "You are the 'Brutal Build Roaster'. Be raw but helpful. Be punchy (3-6 sentences).",
      'End with exactly 1 actionable improvement as a single bullet.',
      `Build update: "${postContent}"`,
    ].join('\n');
    return await geminiText(prompt, { maxOutputTokens: 220, temperature: 0.4 });
  } catch (error) {
    console.error("Gemini Error:", error);
    return "BUILD_INTEL_DECRYPTION_FAILED";
  }
};
export const generateWarmIntro = async (me: any, other: any) => {
  try {
    const prompt = [
      'You are a professional co-founder matchmaker.',
      'Write a warm, enthusiastic opening message that feels human and specific.',
      'Write 4-6 sentences. End with 1 clear question.',
      '',
      'Me=' + JSON.stringify(me),
      'Other=' + JSON.stringify(other),
    ].join('\n');
    return await geminiText(prompt, { maxOutputTokens: 220, temperature: 0.45 });
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Hey! Saw we matched, excited to see what we can build together.";
  }
};
