// ImageKit upload signer — Vercel serverless function.
// The app calls this before uploading a profile photo; it returns the
// short-lived (40 min) signature params ImageKit requires for client-side
// uploads. Keeps the PRIVATE key server-side; the client only ever sees the
// public key + one-shot signatures.
//
// Env required (Vercel project settings):
//   IMAGEKIT_PRIVATE_KEY=private_xxx
//
// Auth: a Firebase ID token is verified before signing (see handler below).

import crypto from 'node:crypto';
import { verifyRequestUser } from './_firebaseAdmin.js';

const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Signing an upload mints storage/quota on the ImageKit account, so this
  // must not be callable by anyone who is not signed in.
  const user = await verifyRequestUser(req);
  if (!user?.uid) {
    return res.status(401).json({ error: 'Sign in to upload media.' });
  }

  const privateKey = String(process.env.IMAGEKIT_PRIVATE_KEY || '').trim();
  if (!privateKey) {
    return res.status(500).json({ error: 'IMAGEKIT_PRIVATE_KEY is not configured on the server.' });
  }

  const token = crypto.randomUUID();
  const expire = Math.floor(Date.now() / 1000) + 40 * 60; // ImageKit max: 1 hour
  const signature = crypto.createHmac('sha1', privateKey).update(token + expire).digest('hex');

  return res.status(200).json({ token, expire, signature });
}
