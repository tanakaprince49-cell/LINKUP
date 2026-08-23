// THE 53MB PURGE: base64 photos camped inside users / matches / notifications
// (and any other hot collection) made every screen pay megabytes of downloads
// on a ~1Mbps link. This script:
//   1. builds uid -> hosted ImageKit URL map (publicProfiles + users.profilePicUrl)
//   2. uploads any remaining base64 photo WITHOUT a hosted twin to ImageKit
//   3. deep-walks every doc: any data: URI longer than 900 chars is replaced
//      with that user's hosted URL (or '' when none exists) — timestamps and
//      Firestore sentinels pass through untouched.
// Usage: node scripts/purge-base64-everywhere.mjs <email> <password> <ikPrivateKey>
import { initializeApp } from 'firebase/app';
import { initializeFirestore, getDocs, collection, doc, setDoc, writeBatch } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { readFileSync } from 'node:fs';

const [email, password, ikKey] = process.argv.slice(2);
const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const app = initializeApp(config);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });
const auth = getAuth(app);
await signInWithEmailAndPassword(auth, email, password);

const b64 = Buffer.from(`${ikKey}:`).toString('base64');
const uploadToImageKit = async (dataUri, fileName) => {
  const form = new FormData();
  form.append('file', dataUri);
  form.append('fileName', fileName);
  form.append('folder', '/linkup-avatars');
  form.append('useUniqueFileName', 'false');
  const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: { Authorization: `Basic ${b64}` },
    body: form,
  });
  const data = await res.json().catch(() => null);
  return res.ok && data?.url ? String(data.url) : null;
};

// ---- 1. hosted map ------------------------------------------------------------
const hosted = new Map();
const idxSnap = await getDocs(collection(db, 'publicProfiles'));
idxSnap.forEach((d) => {
  const p = String(d.data().profilePic || '');
  if (p.startsWith('https://')) hosted.set(d.id, p);
});
const usersSnap = await getDocs(collection(db, 'users'));
usersSnap.forEach((d) => {
  const u = String(d.data().profilePicUrl || '');
  if (u.startsWith('https://')) hosted.set(d.id, u);
});
console.log(`hosted map: ${hosted.size} users`);

// ---- 2. upload leftovers (base64 pic but NO hosted twin) ----------------------
const uploads = [];
usersSnap.forEach((d) => {
  const p = String(d.data().profilePic || '');
  if (p.startsWith('data:image') && !hosted.has(d.id)) uploads.push([d.id, p]);
});
console.log(`leftover base64-only avatars to upload: ${uploads.length}`);
for (const [uid, dataUri] of uploads) {
  const url = await uploadToImageKit(dataUri, `${uid}.jpg`);
  if (url) {
    hosted.set(uid, url);
    console.log(`  uploaded ${uid} -> ${url}`);
  } else {
    console.log(`  !! upload failed for ${uid} (avatar cleared — they can re-pick)`);
  }
}

// ---- 3. deep purge -------------------------------------------------------------
const UID_KEYS = ['uid', 'userId', 'fromId', 'viewerId', 'senderId', 'responderId', 'actorId', 'profileId', 'toId', 'authorId', 'targetId', 'otherUserId'];
const isSentinel = (v) =>
  v && typeof v === 'object' &&
  (typeof v.toMillis === 'function' || typeof v.toDate === 'function' || typeof v.isEqual === 'function' || v.constructor?.name === 'Timestamp' || v.constructor?.name === 'GeoPoint' || v.constructor?.name === 'DocumentReference');

const clean = (value, ctx, changes) => {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length > 900 && value.startsWith('data:')) {
      changes.n += 1;
      return hosted.get(ctx) || '';
    }
    return value;
  }
  if (isSentinel(value)) return value;
  if (Array.isArray(value)) return value.map((v) => clean(v, ctx, changes));
  if (typeof value === 'object') {
    let childCtx = ctx;
    for (const k of UID_KEYS) {
      if (typeof value[k] === 'string' && hosted.has(value[k])) { childCtx = value[k]; break; }
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = clean(v, hosted.has(k) ? k : childCtx, changes);
    }
    return out;
  }
  return value;
};

const COLLECTIONS = ['users', 'matches', 'notifications', 'posts', 'connectionRequests'];
let totalDocs = 0, totalBlobs = 0;
for (const col of COLLECTIONS) {
  const snap = await getDocs(collection(db, col));
  const pending = [];
  snap.forEach((d) => {
    const changes = { n: 0 };
    const ctx = col === 'users' ? d.id : '';
    const cleaned = clean(d.data(), ctx, changes);
    if (col === 'users') {
      if (hosted.get(d.id)) {
        cleaned.profilePic = hosted.get(d.id);
        cleaned.profilePicUrl = hosted.get(d.id);
        if (changes.n === 0 && d.data().profilePic !== cleaned.profilePic) changes.n = 1;
      }
    }
    if (changes.n > 0) pending.push([d.id, cleaned, changes.n]);
  });
  totalDocs += pending.length;
  totalBlobs += pending.reduce((n, [, , c]) => n + c, 0);
  console.log(`${col}: ${pending.length} docs to rewrite (${pending.reduce((n, [, , c]) => n + c, 0)} blobs)`);
  for (let i = 0; i < pending.length; i += 400) {
    const batch = writeBatch(db);
    for (const [id, data] of pending.slice(i, i + 400)) batch.set(doc(db, col, id), data);
    try {
      await batch.commit();
    } catch (e) {
      console.log(`  !! batch failed for ${col} at ${i}: ${e.message}`);
    }
  }
}

// ---- 4. heal the lean index for the 2 freshly-hosted users -------------------
let indexFixed = 0;
for (const [uid, url] of hosted) {
  const idxDoc = idxSnap.docs.find((d) => d.id === uid);
  if (idxDoc && String(idxDoc.data().profilePic || '') !== url && !String(idxDoc.data().profilePic || '').startsWith('https://')) {
    try {
      await setDoc(doc(db, 'publicProfiles', uid), { ...idxDoc.data(), profilePic: url });
      indexFixed += 1;
    } catch {}
  }
}
console.log(`DONE. Rewritten docs=${totalDocs} base64 blobs removed=${totalBlobs} index healed=${indexFixed}`);
process.exit(0);
