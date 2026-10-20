// Shared real-source feed for the interactive app and crawlable news page.
import {handleOptions,sendError,setCors} from './_gemini.js';
import {getNewsFeed} from './_newsFeed.js';
export default async function handler(req,res) {
  if(handleOptions(req,res))return;
  setCors(res);
  res.setHeader('X-Robots-Tag','noindex');
  if(req.method!=='GET'){res.setHeader('Allow','GET, OPTIONS');return sendError(res,405,'Use GET to fetch news.');}
  try {
    const articles=await getNewsFeed();
    res.setHeader('Cache-Control','s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({articles});
  }catch {
    res.setHeader('Retry-After','60');
    return sendError(res,503,'News is temporarily unavailable. Please try again later.');
  }
}
