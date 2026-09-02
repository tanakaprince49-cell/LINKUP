import { auth, db } from './firebase';
import { fetchActiveCampaignsForPlacement } from './campaigns';
import { collection, query, getDocs, limit as firestoreLimit, doc, getDoc } from 'firebase/firestore';
import { requestGeminiText } from './aiDiagnostics';
import { Platform } from 'react-native';

const ZEN_MODEL = 'ling-3.0-flash-free';

export interface LinkyMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  profileResults?: MiniProfile[];
  toolCallId?: string;
}

export interface MiniProfile {
  uid: string;
  displayName: string;
  profilePic?: string;
  bio: string;
  skills: string[];
  city?: string;
  country?: string;
  occupation?: string;
  company?: string;
  repScore?: number;
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
}

const SYSTEM_PROMPT = `You are Linky, a professional AI networking assistant for LINKUP. Your role is to analyze LINKUP members' skills, experience, and goals to recommend high-quality connections. You ONLY know about LINKUP users listed in the search results. NEVER invent or mention any person not in the search results list. If the list is empty, say you could not find anyone on LINKUP.

Analyze each user's skills and explain concisely why they match or don't match the request. Be specific about skill overlap, complementary roles, and relevant experience.

When the user asks to find someone, search results are provided automatically. If the user says "message [name] tell them about X", present a professional intro (1-2 sentences, strategic and polished) and ask if they want you to send it. NEVER say you already sent anything. The send only happens after the user confirms.

Keep responses professional, direct, and under 4 sentences. Use ONLY plain text — no markdown, no asterisks, no bullet symbols, no formatting characters. Never say "I can't send messages" — you can draft professional intros, just ask first.`;

const searchUsers = async (params: any): Promise<MiniProfile[]> => {
  const maxLimit = Math.min(params.limit || 5, 10);
  const q = params.query?.trim();
  if (!q) return [];

  const keywords = q.toLowerCase().split(/\s+/).filter((w: string) => w.length > 1 && !['me','for','up','in','a','an','the','with','and','or','to','of','is','i','my','by','on','at'].includes(w));

  // Ranked retrieval: every profile is SCORED, not first-come-first-served.
  // Strong signals (skills, name, role) outweigh weak ones (bio words), and
  // quality signals (photo, reputation, recent activity) break the tie.
  try {
    const snap = await getDocs(query(collection(db, 'publicProfiles'), firestoreLimit(150)));
    const scored: Array<{ score: number; profile: MiniProfile }> = [];
    for (const d of snap.docs) {
      const data = d.data() as Record<string, any>;
      if (data.isVisible === false || data.isStealthMode === true || data.onboarded === false) continue;

      const skills = (Array.isArray(data.skills) ? data.skills : []).map((s: string) => String(s || '').toLowerCase());
      const industries = (Array.isArray(data.industries) ? data.industries : []).map((s: string) => String(s || '').toLowerCase());
      const name = String(data.displayName || '').toLowerCase();
      const occupation = String(data.occupation || '').toLowerCase();
      const location = [data.city, data.country].filter(Boolean).join(' ').toLowerCase();
      const bio = String(data.bio || '').toLowerCase();

      let score = 0;
      for (const kw of keywords) {
        if (!kw) continue;
        if (skills.some((s) => s.includes(kw))) score += 4;
        if (name.includes(kw)) score += 3;
        if (occupation.includes(kw)) score += 3;
        if (industries.some((s) => s.includes(kw))) score += 2;
        if (location.includes(kw)) score += 2;
        if (bio.includes(kw)) score += 1;
      }
      if (score === 0) continue;

      if (data.profilePic || data.photos?.[0]) score += 1;
      const rep = Number(data.reputationScore ?? data.founderScore ?? 0) || 0;
      if (rep >= 50) score += 1;

      scored.push({
        score,
        profile: {
          uid: d.id,
          displayName: data.displayName || 'User',
          profilePic: data.profilePic || data.photos?.[0] || '',
          bio: data.bio || '',
          skills: Array.isArray(data.skills) ? data.skills : [],
          city: data.city || '',
          country: data.country || '',
          occupation: data.occupation || '',
          company: data.company || '',
          repScore: rep,
        },
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxLimit).map((entry) => entry.profile);
  } catch (e) {
    console.warn('Linky search failed', e);
  }

  return [];
};

const getUserProfile = async (uid: string): Promise<MiniProfile | null> => {
  try {
    const snap = await getDoc(doc(db, 'publicProfiles', uid));
    if (!snap.exists()) return null;
    const data = snap.data() as Record<string, any>;
    return {
      uid: snap.id,
      displayName: data.displayName || 'User',
      profilePic: data.profilePic || data.photos?.[0] || '',
      bio: data.bio || '',
      skills: Array.isArray(data.skills) ? data.skills : [],
      city: data.city || '',
      country: data.country || '',
      occupation: data.occupation || '',
      company: data.company || '',
    };
  } catch {
    return null;
  }
};

const callZen = async (messages: OpenRouterMessage[]): Promise<string> => {
  const conversation = messages
    .filter((m) => m.content !== null && m.content !== undefined)
    .map((m) => {
      const label = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Linky' : 'System';
      return `${label}: ${String(m.content)}`;
    })
    .join('\n\n');
  const prompt = `${SYSTEM_PROMPT}\n\n${conversation}\n\nLinky:`;

  if (Platform.OS === 'web') {
    try {
      const resp = await fetch('/api/aiAssist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'linkyChat', payload: { prompt } }),
      });
      if (resp.ok) {
        const json = await resp.json();
        if (json?.text) return json.text;
      }
    } catch {}
    throw new Error('All AI providers failed');
  }

  const zenKey = process.env.EXPO_PUBLIC_OPENCODE_ZEN_API_KEY;
  if (zenKey) {
    try {
      const resp = await fetch('https://opencode.ai/zen/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${zenKey}` },
        body: JSON.stringify({
          model: ZEN_MODEL,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages.filter((m) => m.content != null)],
          max_tokens: 600,
        }),
      });
      if (resp.ok) {
        const json = await resp.json();
        if (json?.choices?.[0]?.message?.content) return json.choices[0].message.content;
      }
    } catch {}
  }

  try {
    const text = await requestGeminiText(prompt, { temperature: 0.55, maxOutputTokens: 600 });
    if (text) return text;
  } catch {}

  throw new Error('All AI providers failed');
};

export const cleanText = (text: string): string => {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/^[-*+]\s+/gm, '- ')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .split('\n').map(l => l.trim()).join('\n')
    .trim();
};

const trimHistory = (history: OpenRouterMessage[]): OpenRouterMessage[] => {
  if (history.length <= 6) return history;
  return history.slice(-6);
};

export const getLinkyProfileData = () => ({
  uid: 'linky-ai',
  displayName: 'Linky',
  username: 'linky',
  bio: 'Linky is the official assistant for LINKUP. I help founders, engineers, and entrepreneurs find each other by searching the network for skills, location, industry, and more. Built by the LINKUP team.',
  profilePic: 'https://ui-avatars.com/api/?name=Linky&background=DFFB3F&color=000&size=200&bold=true&font-size=0.4',
  photos: [],
  occupation: 'Linky Assistant',
  company: 'LINKUP',
  country: 'USA',
  city: 'San Francisco',
  age: 0,
  skills: ['AI', 'Networking', 'Founder Matching', 'Search', 'Startup Advice'],
  interests: ['Artificial Intelligence', 'Startups', 'Founder Networking', 'Innovation'],
  industries: ['AI', 'SaaS', 'Technology'],
  lookingFor: ['Helping founders connect'],
  goals: 'Help every founder on LINKUP find their perfect co-founder, collaborator, or network.',
  experience: 'expert',
  personalityType: 'analytical',
  commitmentLevel: 'fulltime',
  startupStage: 'Scaleup',
  fundingStage: 'Raised',
  availability: '24/7',
  languages: ['English'],
  workStyle: 'Fast-paced',
  education: 'LINKUP',
  networkingIntent: 'Helping founders connect',
  ambition: 'impact',
  remoteOnly: false,
  willingToRelocate: false,
  teamSizePreference: 'Solo',
  socialLinks: {},
  resume: { shippedProducts: ['LINKUP AI'], sideProjects: [], startupAttempts: [], hackathonWins: [], buildStreaks: 0 },
  projects: [],
  startupIdeas: [],
  viewedBy: [],
  reputationScore: 100,
  founderScore: 100,
  reputationMetrics: { reliability: 100, responseRate: 100, collaboration: 100, consistency: 100, completion: 100 },
  profileAnalytics: {},
  profileViews: 0,
  profileClicks: 0,
  profileSaves: 0,
  responseRate: 100,
  isBot: false,
  isOnline: true,
  onboarded: true,
  isVisible: true,
  isVerified: true,
  verificationProgram: 'LINKUP Official',
  badges: ['Linky', 'LINKUP Verified', 'Founding Member'],
  settings: { publicDiscovery: true, stealthMode: false, hideOnlineStatus: false },
  hasExit: false,
  isStealthMode: false,
});

const hasSearchIntent = (msg: string): boolean => {
  const lower = msg.toLowerCase().trim();
  if (/^(search|find|look|show|get|who|message|tell|send|intro|dm|contact|connect)\b/.test(lower)) return true;
  if (/\b(find me|show me|look for|search for|i need|i want|who is|are there|any|send a message|reach out|get introduced|connect me to|message them|tell them about)\b/.test(lower)) return true;
  return false;
};

const extractSearchQuery = (msg: string): string => {
  const messageMatch = msg.match(/^(?:message|tell|send|intro|dm|contact|connect)\s+(?:to\s+|(?:them|him|her)\s+)?(\w+(?:\s+\w+)?)\b/i);
  if (messageMatch) return messageMatch[1];
  return msg.replace(/^(search|find|look|show|get|who)\s*(me|for|up)?\s*/i, '').replace(/^(a|an|the|some)\s+/i, '').trim();
};

export const sendMessage = async (
  userMessage: string,
  history: OpenRouterMessage[]
): Promise<{
  text: string;
  profiles: MiniProfile[];
  updatedHistory: OpenRouterMessage[];
}> => {
  const trimmed = trimHistory(history);
  let allProfiles: MiniProfile[] = [];

  if (hasSearchIntent(userMessage)) {
    const query = extractSearchQuery(userMessage);
    if (query) {
      allProfiles = await searchUsers({ query, limit: 5 });
    }
  }

  const messages: OpenRouterMessage[] = [
    ...trimmed,
    { role: 'user', content: userMessage },
  ];

  if (allProfiles.length > 0) {
    messages.push({
      role: 'user',
      content: `[LINKUP search results for "${userMessage}":\n${JSON.stringify(allProfiles.map((p) => ({
        name: p.displayName,
        role: p.occupation,
        company: p.company,
        skills: p.skills,
        location: [p.city, p.country].filter(Boolean).join(', '),
        reputation: p.repScore || 0,
        bio: String(p.bio || '').slice(0, 160),
        uid: p.uid,
      })), null, 2)}\n\nThese results are already ranked best-first by relevance and reputation. ONLY reference these LINKUP users. NEVER invent anyone else.]`,
    });
  }

  // Sponsored picks (Linky placement): paid products Linky may recommend —
  // strict disclosure rules travel with the context every time.
  try {
    if (hasSearchIntent(userMessage)) {
      // Rotated per viewer, so Linky's "sponsored pick" is not the same
      // product in every single conversation.
      const sponsoredCampaigns = await fetchActiveCampaignsForPlacement('linky', 3, auth.currentUser?.uid || '');
      if (sponsoredCampaigns.length > 0) {
        messages.push({
          role: 'user',
          content: `[SPONSORED products (paid placements):\n${JSON.stringify(
            sponsoredCampaigns.map((c) => ({
              product: c.creative?.productName || c.creative?.title || 'Product',
              tagline: c.creative?.tagline || '',
              website: c.creative?.website || '',
              category: c.creative?.category || [],
            })),
            null,
            2
          )}\n\nRules: you may recommend at most ONE of these per reply, and ONLY when it genuinely fits the user's request. You MUST clearly label it as "Sponsored" — never present a paid placement as an organic pick. If none fit, ignore them silently.]`,
        });
      }
    }
  } catch {
    // Sponsored context is best-effort; organic answers never break.
  }

  let response = await callZen(messages);
  let finalText = cleanText(response || 'Sorry, I had trouble processing that. Try again.');
  messages.push({ role: 'assistant', content: finalText });

  return {
    text: finalText,
    profiles: allProfiles,
    updatedHistory: messages,
  };
};
