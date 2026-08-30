// Shared Firebase Admin singleton for Vercel serverless functions.
// Used by billing endpoints to verify Firebase ID tokens and write
// subscription entitlements to Firestore server-side.
//
// Env options (set ONE of these in Vercel → Project → Environment Variables):
//   A) FIREBASE_SERVICE_ACCOUNT   — full service account JSON as a single line
//   B) FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
//      (paste FIREBASE_PRIVATE_KEY with \n escapes; they are converted here)
import admin from 'firebase-admin';

function buildCredential() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (raw) {
    return admin.credential.cert(JSON.parse(raw));
  }
  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT (JSON) or ' +
      'FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY in Vercel env.'
    );
  }
  return admin.credential.cert({ projectId, clientEmail, privateKey });
}

export function getAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: buildCredential() });
  }
  return admin;
}

export function getDb() {
  return getAdmin().firestore();
}

export function serverTimestamp() {
  return getAdmin().firestore.FieldValue.serverTimestamp();
}

// Verify the Firebase ID token sent by the signed-in web client.
// Returns { uid, email, name } or null when missing/invalid.
export async function verifyRequestUser(req) {
  const header = String(req.headers.authorization || req.headers.Authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  try {
    const decoded = await getAdmin().auth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: String(decoded.email || ''),
      name: String(decoded.name || ''),
    };
  } catch {
    return null;
  }
}
