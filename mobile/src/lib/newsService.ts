import { Platform } from 'react-native';

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  content?: string;
  url: string;
  imageUrl?: string;
  sourceName: string;
  sourceIcon?: string;
  publishedAt: string;
  category: 'startup' | 'company' | 'tech' | 'research';
}

const API_KEY = '03b1a7a9ba324cacaaf0cd786dba170b';
const API_URL = 'https://newsapi.org/v2/everything';

const sampleArticles: NewsArticle[] = [
  {
    id: 's1',
    title: 'Anthropic Raises $3.5B at $61.5B Valuation to Scale AI Research',
    description: 'Anthropic closes one of the largest funding rounds in AI history, signaling investor confidence in safe AGI development and competitive positioning against OpenAI.',
    url: 'https://techcrunch.com',
    imageUrl: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600',
    sourceName: 'TechCrunch',
    publishedAt: new Date(Date.now() - 1_800_000).toISOString(),
    category: 'company',
  },
  {
    id: 's2',
    title: 'OpenAI Launches GPT-5 with Real-Time Multimodal Reasoning',
    description: 'The latest model processes text, images, audio, and video simultaneously with significantly improved reasoning capabilities across all modalities.',
    url: 'https://theverge.com',
    imageUrl: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=600',
    sourceName: 'The Verge',
    publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
    category: 'tech',
  },
  {
    id: 's3',
    title: 'Perplexity AI Reaches 100M Monthly Active Users, Launches Enterprise Tier',
    description: 'The AI-powered search engine continues its meteoric rise, adding business-focused features including team workspaces and custom data source integration.',
    url: 'https://techcrunch.com',
    imageUrl: 'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=600',
    sourceName: 'TechCrunch',
    publishedAt: new Date(Date.now() - 7_200_000).toISOString(),
    category: 'startup',
  },
  {
    id: 's4',
    title: 'DeepMind AlphaFold 3 Predicts All Molecular Interactions in Cells',
    description: 'Google DeepMind releases AlphaFold 3, capable of predicting the structure and interactions of all molecular types within living cells — a breakthrough for drug discovery.',
    url: 'https://nature.com',
    imageUrl: 'https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?w=600',
    sourceName: 'Nature',
    publishedAt: new Date(Date.now() - 14_400_000).toISOString(),
    category: 'research',
  },
  {
    id: 's5',
    title: 'AI Coding Assistant Startup Magic Raises $320M Series C',
    description: 'Magic, an AI-powered pair programming platform, achieves a $2B valuation as enterprises race to adopt AI-assisted software development workflows.',
    url: 'https://techcrunch.com',
    imageUrl: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=600',
    sourceName: 'TechCrunch',
    publishedAt: new Date(Date.now() - 21_600_000).toISOString(),
    category: 'startup',
  },
  {
    id: 's6',
    title: 'Apple Intelligence Now Powers 85% of iOS 19 On-Device Features',
    description: 'Apple on-device AI strategy pays off as Intelligence models handle everything from photo editing to real-time email drafting without cloud round-trips.',
    url: 'https://theverge.com',
    imageUrl: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600',
    sourceName: 'The Verge',
    publishedAt: new Date(Date.now() - 28_800_000).toISOString(),
    category: 'tech',
  },
  {
    id: 's7',
    title: 'Mistral AI Open-Sources 120B Parameter Model Rivaling GPT-4',
    description: 'French AI lab Mistral releases a massive open-weight model under Apache 2.0 license, challenging the proprietary dominance of US-based AI companies.',
    url: 'https://techcrunch.com',
    imageUrl: 'https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=600',
    sourceName: 'TechCrunch',
    publishedAt: new Date(Date.now() - 36_000_000).toISOString(),
    category: 'company',
  },
  {
    id: 's8',
    title: 'AI Video Generation Startup Pika Raises $200M, Partners with Hollywood Studios',
    description: 'Pika latest video model can generate 4K, 60fps content with consistent characters, landing major deals with Paramount and Warner Bros.',
    url: 'https://techcrunch.com',
    imageUrl: 'https://images.unsplash.com/photo-1536240478700-b869070f9279?w=600',
    sourceName: 'TechCrunch',
    publishedAt: new Date(Date.now() - 43_200_000).toISOString(),
    category: 'startup',
  },
  {
    id: 's9',
    title: 'Meta AI Releases Llama 5 with Million-Token Context Window',
    description: 'Meta next-generation open-source LLM can process entire codebases or book-length documents in a single pass, setting a new standard for context length.',
    url: 'https://theverge.com',
    imageUrl: 'https://images.unsplash.com/photo-1526379879527-8559ecfcb0c8?w=600',
    sourceName: 'The Verge',
    publishedAt: new Date(Date.now() - 50_400_000).toISOString(),
    category: 'tech',
  },
  {
    id: 's10',
    title: 'Robotics Startup Physical Intelligence Raises $400M for General-Purpose Robots',
    description: 'Physical Intelligence aims to build the operating system for general-purpose robots, with backing from Bezos, Gates, and major VC firms.',
    url: 'https://techcrunch.com',
    imageUrl: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=600',
    sourceName: 'TechCrunch',
    publishedAt: new Date(Date.now() - 57_600_000).toISOString(),
    category: 'startup',
  },
  {
    id: 's11',
    title: 'Adobe Firefly 4 Transforms Enterprise Creative Workflows with AI',
    description: 'Adobe latest generative AI suite integrates directly into Photoshop, Premiere, and Illustrator, automating complex design tasks while maintaining brand consistency.',
    url: 'https://theverge.com',
    imageUrl: 'https://images.unsplash.com/photo-1562577309-4932fdd64cd1?w=600',
    sourceName: 'The Verge',
    publishedAt: new Date(Date.now() - 64_800_000).toISOString(),
    category: 'company',
  },
  {
    id: 's12',
    title: 'Berkeley Researchers Achieve Breakthrough in Energy-Efficient AI Chips',
    description: 'A new analog computing architecture promises 100x improvement in energy efficiency for AI inference, potentially revolutionizing edge AI and mobile computing.',
    url: 'https://technologyreview.com',
    imageUrl: 'https://images.unsplash.com/photo-1517077304055-6e89abbf09b0?w=600',
    sourceName: 'MIT Tech Review',
    publishedAt: new Date(Date.now() - 72_000_000).toISOString(),
    category: 'research',
  },
  {
    id: 's13',
    title: 'AI-Powered Drug Discovery Company Recursion Hits Major Milestone',
    description: 'Recursion Pharmaceuticals announces successful Phase 2 trial results for an AI-discovered cancer drug, validating the AI-driven approach to drug development.',
    url: 'https://techcrunch.com',
    imageUrl: 'https://images.unsplash.com/photo-1579154204601-01588f351e67?w=600',
    sourceName: 'TechCrunch',
    publishedAt: new Date(Date.now() - 79_200_000).toISOString(),
    category: 'startup',
  },
  {
    id: 's14',
    title: 'NVIDIA Unveils Rubin Next-Gen Architecture: 5x AI Performance Leap',
    description: 'NVIDIA next-generation GPU architecture delivers massive performance gains for both training and inference, solidifying its dominance in the AI hardware market.',
    url: 'https://theverge.com',
    imageUrl: 'https://images.unsplash.com/photo-1555617778-3911851ec1bd?w=600',
    sourceName: 'The Verge',
    publishedAt: new Date(Date.now() - 86_400_000).toISOString(),
    category: 'tech',
  },
  {
    id: 's15',
    title: 'ElevenLabs Launches Real-Time Voice-to-Voice Translation in 30 Languages',
    description: 'ElevenLabs new feature preserves the speaker voice tone, emotion, and cadence while translating speech into 30 languages in real time with under 200ms latency.',
    url: 'https://techcrunch.com',
    imageUrl: 'https://images.unsplash.com/photo-1589254065878-42c9da997008?w=600',
    sourceName: 'TechCrunch',
    publishedAt: new Date(Date.now() - 93_600_000).toISOString(),
    category: 'tech',
  },
  {
    id: 's16',
    title: 'AI Legal Assistant EvenUp Raises $150M to Automate Litigation',
    description: 'EvenUp AI platform analyzes millions of legal documents to predict case outcomes and draft filings, raising $150M in Series D funding.',
    url: 'https://techcrunch.com',
    imageUrl: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=600',
    sourceName: 'TechCrunch',
    publishedAt: new Date(Date.now() - 100_800_000).toISOString(),
    category: 'startup',
  },
  {
    id: 's17',
    title: 'Stability AI Releases Stable Diffusion 4 with 3D Generation',
    description: 'The latest version of Stable Diffusion can generate 3D assets, textures, and scenes from text prompts, opening new possibilities for game development and VR.',
    url: 'https://theverge.com',
    imageUrl: 'https://images.unsplash.com/photo-1633356122102-3fe601e05bd2?w=600',
    sourceName: 'The Verge',
    publishedAt: new Date(Date.now() - 108_000_000).toISOString(),
    category: 'tech',
  },
  {
    id: 's18',
    title: 'Google DeepMind Co-Founder Starts New AI Research Lab with $1B Funding',
    description: 'The new lab focuses on AI scientists — systems that can autonomously conduct research, form hypotheses, and run experiments without human intervention.',
    url: 'https://techcrunch.com',
    imageUrl: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=600',
    sourceName: 'TechCrunch',
    publishedAt: new Date(Date.now() - 115_200_000).toISOString(),
    category: 'company',
  },
  {
    id: 's19',
    title: 'YC-Backed AI Startup Deploys Autonomous Code Review Across 500+ Companies',
    description: 'The AI code review tool catches bugs, security vulnerabilities, and style issues automatically, now used by over 500 companies including several Fortune 500 firms.',
    url: 'https://techcrunch.com',
    imageUrl: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=600',
    sourceName: 'TechCrunch',
    publishedAt: new Date(Date.now() - 122_400_000).toISOString(),
    category: 'startup',
  },
  {
    id: 's20',
    title: 'EU Passes Comprehensive AI Liability Framework for Autonomous Systems',
    description: 'The new regulatory framework establishes clear liability rules for AI-related harms, requiring companies to maintain detailed audit trails of model decisions.',
    url: 'https://technologyreview.com',
    imageUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600',
    sourceName: 'MIT Tech Review',
    publishedAt: new Date(Date.now() - 129_600_000).toISOString(),
    category: 'research',
  },
];

const freshSampleArticles = (): NewsArticle[] =>
  sampleArticles.map((a, i) => ({
    ...a,
    id: `${a.id}-${Date.now()}`,
    publishedAt: new Date(Date.now() - i * 3_600_000 * Math.random()).toISOString(),
  }));

export const fetchAINews = async (): Promise<NewsArticle[]> => {
  if (!API_KEY) return freshSampleArticles();

  try {
    const query = 'AI OR "artificial intelligence" startup OR "AI company" OR "machine learning"';
    const url = `${API_URL}?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=30&apiKey=${API_KEY}`;
    const response = await fetch(url);
    const json = await response.json();

    if (json.status !== 'ok' || !json.articles?.length) {
      console.warn('NewsAPI returned no results, using sample data');
      return freshSampleArticles();
    }

    return json.articles
      .filter((a: any) => a.title && a.title !== '[Removed]')
      .map((a: any, i: number) => ({
        id: `news-${i}-${Date.now()}`,
        title: a.title,
        description: a.description || '',
        url: a.url,
        imageUrl: a.urlToImage || undefined,
        sourceName: a.source?.name || 'Unknown',
        publishedAt: a.publishedAt || new Date().toISOString(),
        category: inferCategory(a.title, a.description),
      }));
  } catch (err) {
    console.warn('NewsAPI fetch failed, using sample data:', err);
    return freshSampleArticles();
  }
};

const inferCategory = (title: string, desc: string): NewsArticle['category'] => {
  const text = `${title} ${desc}`.toLowerCase();
  if (text.includes('startup') || text.includes('raised') || text.includes('funding') || text.includes('series')) return 'startup';
  if (text.includes('google') || text.includes('meta') || text.includes('apple') || text.includes('microsoft') || text.includes('amazon')) return 'company';
  if (text.includes('research') || text.includes('study') || text.includes('university') || text.includes('breakthrough')) return 'research';
  return 'tech';
};
