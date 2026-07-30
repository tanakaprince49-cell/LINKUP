import { db } from './firebase';
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
  const seen = new Set<string>();
  const results: MiniProfile[] = [];

  const q = params.query?.trim();
  if (!q) return [];

  const keywords = q.toLowerCase().split(/\s+/).filter((w: string) => w.length > 1 && !['me','for','up','in','a','an','the','with','and','or','to','of','is','i','my','by','on','at'].includes(w));

  try {
    const snap = await getDocs(query(collection(db, 'publicProfiles'), firestoreLimit(60)));
    const docs = snap.docs;
    for (let i = 0; i < docs.length && results.length < maxLimit; i++) {
      const d = docs[i];
      if (seen.has(d.id)) continue;
      const data = d.data() as Record<string, any>;
      const fields = [
        (data.displayName || '').toLowerCase(),
        (data.occupation || '').toLowerCase(),
        (data.city || '').toLowerCase(),
        (data.country || '').toLowerCase(),
        (data.bio || '').toLowerCase(),
        ...(Array.isArray(data.skills) ? data.skills.map((s: string) => s.toLowerCase()) : []),
        ...(Array.isArray(data.industries) ? data.industries.map((s: string) => s.toLowerCase()) : []),
      ];
      const matched = keywords.some((kw: string) => fields.some((f: string) => f.includes(kw)));
      if (!matched) continue;
      seen.add(d.id);
      results.push({
        uid: d.id,
        displayName: data.displayName || 'User',
        profilePic: data.profilePic || data.photos?.[0] || '',
        bio: data.bio || '',
        skills: Array.isArray(data.skills) ? data.skills : [],
        city: data.city || '',
        country: data.country || '',
        occupation: data.occupation || '',
        company: data.company || '',
      });
    }
  } catch (e) {
    console.warn('Linky search failed', e);
  }

  return results;
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
  bio: 'The official AI assistant for LINKUP. I help founders, engineers, and entrepreneurs find each other by searching the network for skills, location, industry, and more. Built by the LINKUP team.',
  profilePic: 'https://ui-avatars.com/api/?name=AI&background=DFFB3F&color=000&size=200&bold=true&font-size=0.5',
  photos: [],
  occupation: 'AI Assistant',
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
  education: 'LINKUP AI',
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
  badges: ['AI', 'LINKUP Verified', 'Founding Member'],
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
        uid: p.uid,
      })), null, 2)}\n\nONLY reference these LINKUP users. NEVER invent anyone else.]`,
    });
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
