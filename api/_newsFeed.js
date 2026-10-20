import {createHash} from 'node:crypto';
import {safeUrl, text} from './_publicSeo.js';
const QUERY = 'AI OR "artificial intelligence" startup OR "AI company" OR "machine learning"';
export function projectNewsArticles(articles) {
  if (!Array.isArray(articles)) return [];
  const seen = new Set();
  return articles.slice(0,100).flatMap(a => {
    const url = safeUrl(a?.url), title = text(a?.title,200);
    if (!url || !title || title === '[Removed]' || seen.has(url)) return [];
    seen.add(url);
    const value = `${title} ${a.description || ''}`.toLowerCase();
    const category = /startup|raised|funding|series/.test(value) ? 'startup' : /google|meta|apple|microsoft|amazon/.test(value) ? 'company' : /research|study|university|breakthrough/.test(value) ? 'research' : 'tech';
    const date = typeof a.publishedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(a.publishedAt) ? new Date(a.publishedAt) : null;
    return [{id:'news-'+createHash('sha256').update(url).digest('hex').slice(0,24),title,
      description:text(a.description,400),url,imageUrl:safeUrl(a.urlToImage) || undefined,
      sourceName:text(a.source?.name,100) || new URL(url).hostname,
      publishedAt:date && Number.isFinite(date.getTime()) ? date.toISOString() : null,category}];
  }).slice(0,30);
}
// Warm-instance cache avoids a provider request on every crawler hit. No demo
// headlines, fabricated publication dates or user-controlled upstream URLs.
export function createNewsFeed({fetcher=(...args)=>fetch(...args),key=()=>process.env.NEWS_API_KEY,now=Date.now}={}) {
  let cache=null,pending=null;
  return async () => {
    const current=now();
    if(cache && current-cache.at<600000)return cache.articles;
    if(pending)return pending;
    pending=Promise.resolve().then(async()=>{
      const apiKey=String(key() || '').trim();
      if(!apiKey)throw new Error('News feed not configured');
      const response=await fetcher('https://newsapi.org/v2/everything?'+new URLSearchParams({q:QUERY,language:'en',sortBy:'publishedAt',pageSize:'30',apiKey}),{headers:{'User-Agent':'LINKUP/1.0'},signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error('News provider unavailable');
      const body=await response.json();
      if(body.status!=='ok')throw new Error('News provider unavailable');
      const articles=projectNewsArticles(body.articles);
      if(!articles.length)throw new Error('News provider returned no usable articles');
      cache={at:now(),articles};return articles;
    }).catch(error=>{
      if(cache && current-cache.at<3600000)return cache.articles;
      throw error;
    }).finally(()=>{pending=null;});
    return pending;
  };
}
export const getNewsFeed=createNewsFeed();
