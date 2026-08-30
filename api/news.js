// GET /api/news
//
// Server-side proxy for NewsAPI.
//
// Two reasons this exists:
//
// 1. NewsAPI's developer/free plan rejects requests made from a browser — the
//    origin is blocked, the fetch fails, and the app silently fell back to the
//    same twenty hardcoded sample articles on every refresh. That is why the
//    web news feed looked permanently stuck. A server has no origin, so this
//    works.
// 2. It gets the API key out of the JS bundle.
//
// Set NEWS_API_KEY in Vercel -> Settings -> Environment Variables.
import { handleOptions, sendError, setCors } from './_gemini.js';

const API_URL = 'https://newsapi.org/v2/everything';
const QUERY = 'AI OR "artificial intelligence" startup OR "AI company" OR "machine learning"';

const inferCategory = (title, desc) => {
  const text = `${title || ''} ${desc || ''}`.toLowerCase();
  if (text.includes('startup') || text.includes('raised') || text.includes('funding') || text.includes('series')) return 'startup';
  if (
    text.includes('google') ||
    text.includes('meta') ||
    text.includes('apple') ||
    text.includes('microsoft') ||
    text.includes('amazon')
  ) {
    return 'company';
  }
  if (text.includes('research') || text.includes('study') || text.includes('university') || text.includes('breakthrough')) {
    return 'research';
  }
  return 'tech';
};

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);
  if (req.method !== 'GET') {
    sendError(res, 405, 'Use GET to fetch news.');
    return;
  }

  const key = String(process.env.NEWS_API_KEY || '').trim();
  if (!key) {
    sendError(res, 500, 'NEWS_API_KEY is not configured on the server.');
    return;
  }

  try {
    const url = `${API_URL}?q=${encodeURIComponent(QUERY)}&language=en&sortBy=publishedAt&pageSize=30&apiKey=${key}`;
    const upstream = await fetch(url, { headers: { 'User-Agent': 'LINKUP/1.0' } });
    const json = await upstream.json();

    if (json?.status !== 'ok' || !Array.isArray(json.articles) || json.articles.length === 0) {
      sendError(res, 502, json?.message || 'NewsAPI returned no articles.');
      return;
    }

    const articles = json.articles
      .filter((article) => article?.title && article.title !== '[Removed]' && article?.url)
      .map((article, index) => ({
        id: `news-${index}-${Date.now()}`,
        title: article.title,
        description: article.description || '',
        url: article.url,
        imageUrl: article.urlToImage || undefined,
        sourceName: article.source?.name || 'Unknown',
        publishedAt: article.publishedAt || new Date().toISOString(),
        category: inferCategory(article.title, article.description),
      }));

    // Ten minutes of shared cache: the feed is not ticker-sensitive and this
    // keeps us well inside NewsAPI's rate limits.
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    res.status(200).json({ articles });
  } catch (error) {
    console.error('[news] upstream failed', error?.message || error);
    sendError(res, 502, 'Could not reach NewsAPI.');
  }
}
