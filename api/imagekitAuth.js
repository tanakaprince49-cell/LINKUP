// ImageKit upload signer — Vercel serverless function.
// Accepts either a signed-in Firebase user ID token (client uploads) OR a
// Google Service Account OAuth token belonging to this Firebase project
// (server-side publicProfiles photo hosting sweep).
import crypto from 'node:crypto';
import { verifyRequestUser } from './_firebaseAdmin.js';

const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

function serviceAccountProject() {
  try {
    const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
    if (raw) return String(JSON.parse(raw).project_id || '');
  } catch {}
  return String(process.env.FIREBASE_PROJECT_ID || 'linkup-e0906');
}

async function serviceAccountAuthorized(req) {
  const header = String(req.headers?.authorization || '');
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!bearer || bearer.length > 4096) return false;
  try {
    const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(bearer)}`, {
      signal: AbortSignal.timeout(6000),
    }).then((r) => r.json());
    const email = String(info?.email || '');
    return String(info?.email_verified) === 'true' && email.endsWith(`@${serviceAccountProject()}.iam.gserviceaccount.com`);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await verifyRequestUser(req);
  const saOk = !user?.uid ? await serviceAccountAuthorized(req) : false;
  if (!user?.uid && !saOk) {
    return res.status(401).json({ error: 'Sign in to upload media.' });
  }

  const privateKey = String(process.env.IMAGEKIT_PRIVATE_KEY || '').trim();
  if (!privateKey) {
    return res.status(500).json({ error: 'IMAGEKIT_PRIVATE_KEY is not configured on the server.' });
  }

  const token = crypto.randomUUID();
  const expire = Math.floor(Date.now() / 1000) + 40 * 60;
  const signature = crypto.createHmac('sha1', privateKey).update(token + expire).digest('hex');

  return res.status(200).json({ token, expire, signature });
}
