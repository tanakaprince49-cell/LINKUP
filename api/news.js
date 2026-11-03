// Community Blogs endpoint (replaced external NewsAPI feed — all external news removed).
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import { getDb, verifyRequestUser } from './_firebaseAdmin.js';
import { isPlusUser } from './_linky.js';
import { createBlogsService } from './_blogs.js';

function anonVisitorKey(req) {
  const fwd = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ua = String(req.headers?.['user-agent'] || '').slice(0, 120);
  const day = new Date().toISOString().slice(0, 10);
  if (!fwd && !ua) return '';
  return `${fwd}|${ua}|${day}`;
}

async function optionalUser(req) {
  if (!req.headers?.authorization) return null;
  try {
    return await verifyRequestUser(req);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);
  res.setHeader('X-Robots-Tag', 'noindex');
  const blogs = createBlogsService({ db: getDb(), plus: isPlusUser });

  if (req.method === 'GET') {
    try {
      const viewer = await optionalUser(req);
      const viewerUid = viewer?.uid || '';
      const category = typeof req.query?.category === 'string' ? req.query.category : '';
      const id = typeof req.query?.id === 'string' ? req.query.id : '';
      if (id) {
        const blog = await blogs.getById(id, { viewerUid });
        if (!blog) return sendError(res, 404, 'Blog not found.');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ blog });
      }
      const out = await blogs.list({ category, viewerUid });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(out);
    } catch {
      res.setHeader('Retry-After', '30');
      return sendError(res, 503, 'Blogs are temporarily unavailable. Please try again.');
    }
  }

  if (req.method === 'POST') {
    const body = readJsonBody(req) || {};
    const action = String(body.action || 'publish');

    if (action === 'track') {
      try {
        const viewer = await optionalUser(req);
        const out = await blogs.track(
          { uid: viewer?.uid || '', anonKey: anonVisitorKey(req) },
          body
        );
        return res.status(200).json(out);
      } catch (err) {
        return sendError(res, err?.status || 400, String(err?.message || 'Could not record event.'));
      }
    }

    const user = await verifyRequestUser(req);
    if (!user) return sendError(res, 401, 'Sign in to publish or manage blogs.');
    try {
      if (action === 'delete') {
        const out = await blogs.remove(user.uid, body);
        return res.status(200).json(out);
      }
      const out = await blogs.publish(user.uid, body);
      return res.status(200).json(out);
    } catch (err) {
      return sendError(res, err?.status || 400, String(err?.message || 'Could not save blog.'));
    }
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return sendError(res, 405, 'Use GET or POST.');
}
