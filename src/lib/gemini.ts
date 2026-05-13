import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is missing. AI features will not work.");
}

const ai = new GoogleGenAI({ apiKey: apiKey || "" });

export const getMatchingExplanation = async (user1: any, user2: any) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Compare these two founders and explain why they are a good match or not.
      Founder 1: ${JSON.stringify(user1)}
      Founder 2: ${JSON.stringify(user2)}
      Focus on skills compatibility, goals alignment, and personality fit.`,
      config: {
        systemInstruction: "You are a professional co-founder matchmaker. Provide a concise, encouraging explanation.",
      }
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Compatibility analysis unavailable.";
  }
};

export const analyzeStartupIdea = async (idea: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Evaluate this startup idea: "${idea}"
      Provide a breakdown of:
      1. Market Potential
      2. Competition
      3. Scalability
      4. Monetization Strategies`,
      config: {
        systemInstruction: "You are an expert startup analyst and VC. Be critical but constructive.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            marketPotential: { type: Type.STRING },
            competition: { type: Type.STRING },
            scalability: { type: Type.STRING },
            monetization: { type: Type.STRING },
            summary: { type: Type.STRING }
          }
        }
      }
    });
    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Gemini Error:", error);
    return null;
  }
};

export const generateAIComment = async (postContent: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Write a short, insightful, and supportive comment for this builder's post: "${postContent}"`,
      config: {
        systemInstruction: "You are a supportive AI mentor for founders. Keep it short and punchy.",
      }
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return null;
  }
};
