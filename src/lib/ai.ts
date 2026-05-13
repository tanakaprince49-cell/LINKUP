const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY;

export const getMatchingExplanation = async (user1: any, user2: any) => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are a professional co-founder matchmaker. Provide a concise, encouraging explanation."
          },
          {
            role: "user",
            content: `Compare these two founders and explain why they are a good match or not.
            Founder 1: ${JSON.stringify(user1)}
            Founder 2: ${JSON.stringify(user2)}
            Focus on skills compatibility, goals alignment, and personality fit.`
          }
        ]
      })
    });
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("OpenRouter Error:", error);
    return "Compatibility analysis unavailable.";
  }
};

export const analyzeStartupIdea = async (idea: string) => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are an expert startup analyst and VC. Be critical but constructive. Respond ONLY with a valid JSON object."
          },
          {
            role: "user",
            content: `Evaluate this startup idea: "${idea}"
            Provide a breakdown of:
            1. Market Potential
            2. Competition
            3. Scalability
            4. Monetization Strategies
            
            Return format:
            {
              "marketPotential": "...",
              "competition": "...",
              "scalability": "...",
              "monetization": "...",
              "summary": "..."
            }`
          }
        ],
        response_format: { type: "json_object" }
      })
    });
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content || "{}");
  } catch (error) {
    console.error("OpenRouter Error:", error);
    return null;
  }
};

export const generateAIComment = async (postContent: string) => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are a supportive AI mentor for founders. Keep it short and punchy."
          },
          {
            role: "user",
            content: `Write a short, insightful, and supportive comment for this builder's post: "${postContent}"`
          }
        ]
      })
    });
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("OpenRouter Error:", error);
    return null;
  }
};
