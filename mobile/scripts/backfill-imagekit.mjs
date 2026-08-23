/**
 * IMAGEKIT MIGRATION (Route B — free CDN, no card).
 *
 * Moves every user's base64 profile photo onto ImageKit's free CDN:
 *   1. shrink to 384px JPEG (keeps storage + bandwidth tiny)
 *   2. upload to ImageKit (private key via Basic auth, args only — never committed)
 *   3. write the hosted URL into BOTH:
 *        publicProfiles/<uid>.profilePic  (lists become ~20KB payloads)
 *        users/<uid>.profilePicUrl        (self-index prefers hosted URLs now)
 *
 * Usage (inside mobile/):
 *   npm install --no-save sharp
 *   node scripts/backfill-imagekit.mjs <email> <password> <imagekitPrivateKey> <imagekitUrlEndpoint>
 *
 * Idempotent: skips users whose index photo is already an ik.imagekit.io URL.
 */
import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  collection,
  getDocs,
  doc,
  writeBatch,
} from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const [, , email, password, ikPrivateKey, ikEndpointRaw] = process.argv;
if (!email || !password || !ikPrivateKey || !ikEndpointRaw) {
  console.error('usage: node scripts/backfill-imagekit.mjs <email> <password> <ikPrivateKey> <ikEndpoint>');
  process.exit(1);
}
const ikEndpoint = ikEndpointRaw.replace(/\/+$/, '');

const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const app = initializeApp(config);
const db = initializeFirestore(app, { experimentalForceLongPolling: true, ignoreUndefinedProperties: true });
const auth = getAuth(app);

const THUMB_SIZE = 384;
const JPEG_QUALITY = 72;
const text = (v, max = 100) => String(v ?? '').trim().slice(0, max);

const photoCandidates = (p) => [
  p.profilePic,
  p.photoURL,
  p.photoUrl,
  p.avatarUrl,
  p.avatar,
  p.picture,
  p.imageUrl,
  p.profileImage,
  ...(Array.isArray(p.photos) ? p.photos : []),
];

const toJpegBase64 = async (uri) => {
  const comma = uri.indexOf(',');
  const raw = Buffer.from(uri.slice(comma + 1), 'base64');
  const out = await sharp(raw, { failOn: 'none' })
    .rotate()
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return out.toString('base64');
};

const uploadToImageKit = async (base64, fileName) => {
  const form = new FormData();
  form.append('file', base64);
  form.append('fileName', fileName);
  form.append('folder', '/linkup-avatars');
  form.append('useUniqueFileName', 'false');

  const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${ikPrivateKey}:`).toString('base64')}`,
    },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`ImageKit ${res.status}: ${data?.message || res.statusText}`);
  }
  return data.url || '';
};

const run = async () => {
  console.log(`Signing in as ${email} ...`);
  await signInWithEmailAndPassword(auth, email, password);
  console.log('Signed in ✓ Reading users ...');

  const usersSnap = await getDocs(collection(db, 'users'));
  const indexSnap = await getDocs(collection(db, 'publicProfiles'));
  const indexPics = new Map();
  indexSnap.forEach((d) => indexPics.set(d.id, String(d.data()?.profilePic || '')));

  console.log(`Got ${usersSnap.size} users. Uploading photos to ImageKit ...`);

  let batch = writeBatch(db);
  let pending = 0;
  let written = 0;
  let uploaded = 0;
  let skipped = 0;
  let noPhoto = 0;
  const failures = [];

  const flush = async () => {
    if (!pending) return;
    await batch.commit();
    written += pending;
    batch = writeBatch(db);
    pending = 0;
  };

  for (const docSnap of usersSnap.docs) {
    const p = docSnap.data() || {};
    const displayName = text(p.displayName || p.fullName || p.name || p.username, 100);
    if (p.deleted || p.isStealthMode === true || p.isVisible === false || !displayName) continue;

    const existing = indexPics.get(docSnap.id) || '';
    if (existing.includes('ik.imagekit.io')) {
      skipped++;
      continue;
    }

    const rawPhoto = photoCandidates(p).find((v) => typeof v === 'string' && String(v).trim());
    if (!rawPhoto) {
      noPhoto++;
      continue;
    }

    let url = '';
    if (/^https?:\/\//.test(String(rawPhoto))) {
      url = String(rawPhoto); // already hosted somewhere — keep it
    } else if (String(rawPhoto).startsWith('data:image')) {
      try {
        const base64 = await toJpegBase64(String(rawPhoto));
        url = await uploadToImageKit(base64, `${docSnap.id}.jpg`);
        uploaded++;
        console.log(`  ↑ ${displayName}: ${String(rawPhoto).length} chars -> ${url}`);
      } catch (e) {
        failures.push(`${displayName}: ${e?.message || e}`);
        continue; // keep base64 in index on failure — nothing gets worse
      }
    } else {
      continue;
    }

    if (!url) continue;

    batch.set(doc(db, 'publicProfiles', docSnap.id), { uid: docSnap.id, profilePic: url, updatedAt: new Date().toISOString() }, { merge: true });
    batch.set(doc(db, 'users', docSnap.id), { profilePicUrl: url }, { merge: true });
    pending += 2;
    if (pending >= 400) await flush();
  }

  await flush();
  console.log(`DONE ✅ ${written} fields written | uploaded to ImageKit: ${uploaded} | already migrated: ${skipped} | no photo: ${noPhoto}`);
  if (failures.length) console.log(`⚠️  failures (${failures.length}):`, failures.slice(0, 5).join(' | '));
  console.log(`Endpoint in use: ${ikEndpoint}`);
  process.exit(0);
};

run().catch((e) => {
  console.error('FAILED:', e?.code || e?.message || e);
  process.exit(1);
});
