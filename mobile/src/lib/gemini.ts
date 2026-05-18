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

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

const extractJsonObject = (text: string) => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
};

export async function geminiToSearchFilters(input: string): Promise<GeminiFilterResult> {
  if (!GEMINI_API_KEY) {
    throw new Error('Missing EXPO_PUBLIC_GEMINI_API_KEY');
  }

  const body = {
    contents: [
      {
        parts: [
          {
            text:
              [
                'You convert natural-language people search into structured filters for the LINKUP app.',
                'Return ONLY a JSON object (no markdown, no prose).',
                '',
                'User can search founders/builders by: query text, location, skills, industry, experience, availability, timezone, lookingForCofounder.',
                '',
                'JSON schema:',
                '{ "query": string, "location": string, "skills": string[], "industry": string, "experience": string, "availability": string, "timezone": string, "lookingForCofounder": boolean }',
                '',
                'Rules:',
                '- Prefer short strings.',
                '- If a field is not specified, omit it or use empty string/empty array.',
                '- skills should be an array of 1-6 items.',
                '',
                `Input: ${input}`,
              ].join('\n'),
          },
        ],
      },
    ],
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${t.slice(0, 200)}`);
  }

  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('\n') ??
    '';

  const jsonText = extractJsonObject(text) ?? text;
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error('Gemini returned non-JSON');
  }
}

export async function geminiProfileInsights(profile: any): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('Missing EXPO_PUBLIC_GEMINI_API_KEY');
  }

  const body = {
    contents: [
      {
        parts: [
          {
            text:
              [
                'You generate short, punchy "Match Insights" for a founder profile in the LINKUP app.',
                'Return ONLY plain text (max 2 sentences). No quotes, no markdown.',
                'Focus on: work style, who they work best with, and what type of startup/team fits them.',
                '',
                `Profile JSON: ${JSON.stringify(profile)}`,
              ].join('\n'),
          },
        ],
      },
    ],
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${t.slice(0, 200)}`);
  }

  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('\n') ??
    '';

  return text.trim() || 'No insights available.';
}
