/**
 * THUMBNAIL SURGERY (Route A — free, no accounts).
 *
 * Problem: index profilePics are base64 data URIs up to ~240KB each, so a
 * list of ~14 lean rows is a multi-MB payload — brutal on ~1Mbps networks.
 *
 * This script re-encodes every user's main photo as a compact 384px JPEG
 * (~40-80KB binary) and writes THAT as `profilePic` into the lean
 * `publicProfiles` index (merge:true). Lists get ~3-4x lighter instantly.
 * Cards/lists/search/league all read the index, so everything speeds up.
 *
 * It ALSO writes/refresh the searchName/searchUsername fields so the same
 * single run covers the server-side search backfill too.
 *
 * Usage (inside mobile/):
 *   npm install --no-save sharp
 *   node scripts/backfill-thumbnails.mjs <email> <password>
 *
 * Idempotent: safe to re-run; skips photos that are already compact.
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

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error('usage: node scripts/backfill-thumbnails.mjs <email> <password>');
  process.exit(1);
}

const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const app = initializeApp(config);
const db = initializeFirestore(app, { experimentalForceLongPolling: true, ignoreUndefinedProperties: true });
const auth = getAuth(app);

const THUMB_SIZE = 384; // px, longest edge
const JPEG_QUALITY = 70;
const TARGET_MAX_CHARS = 120_000; // ~90KB binary as base64 — fits every list cap

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

const shrink = async (uri) => {
  if (!uri || typeof uri !== 'string') return '';
  if (/^https?:\/\//.test(uri)) return uri; // already hosted URL: keep as-is
  if (!uri.startsWith('data:image')) return '';
  if (uri.length <= TARGET_MAX_CHARS) return uri; // already compact enough

  const comma = uri.indexOf(',');
  const raw = Buffer.from(uri.slice(comma + 1), 'base64');
  const out = await sharp(raw, { failOn: 'none' })
    .rotate() // respect EXIF orientation
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  const dataUri = `data:image/jpeg;base64,${out.toString('base64')}`;
  // If it somehow came out bigger, keep the original.
  return dataUri.length < uri.length ? dataUri : uri;
};

const run = async () => {
  console.log(`Signing in as ${email} ...`);
  await signInWithEmailAndPassword(auth, email, password);
  console.log('Signed in ✓ Reading users ...');

  const snap = await getDocs(collection(db, 'users'));
  console.log(`Got ${snap.size} user docs. Shrinking photos to ${THUMB_SIZE}px ...`);

  let batch = writeBatch(db);
  let pending = 0;
  let written = 0;
  let shrunkCount = 0;
  let keptHttps = 0;
  let alreadySmall = 0;
  let noPhoto = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  const flush = async () => {
    if (!pending) return;
    await batch.commit();
    written += pending;
    batch = writeBatch(db);
    pending = 0;
  };

  for (const docSnap of snap.docs) {
    const p = docSnap.data() || {};
    const displayName = text(p.displayName || p.fullName || p.name || p.username, 100);
    if (p.deleted || p.isStealthMode === true || p.isVisible === false || !displayName) continue;

    const rawPhoto = photoCandidates(p).find((v) => typeof v === 'string' && String(v).trim());
    let finalPic = '';
    if (!rawPhoto) {
      noPhoto++;
    } else if (/^https?:\/\//.test(String(rawPhoto))) {
      finalPic = String(rawPhoto);
      keptHttps++;
    } else {
      const before = String(rawPhoto).length;
      totalBefore += before;
      try {
        finalPic = await shrink(String(rawPhoto));
        if (finalPic === rawPhoto) alreadySmall++;
        else shrunkCount++;
        totalAfter += finalPic.length;
      } catch (e) {
        console.log(`  ⚠️  ${displayName}: could not process photo (${e?.code || e?.message}) — keeping original`);
        finalPic = String(rawPhoto);
      }
    }

    if (finalPic.length > 240_000) finalPic = finalPic.slice(0, 240_000); // never exceed index caps

    batch.set(
      doc(db, 'publicProfiles', docSnap.id),
      {
        uid: docSnap.id,
        displayName,
        username: text(p.username, 40),
        searchName: displayName.toLowerCase(),
        searchUsername: text(p.username, 40).toLowerCase(),
        profilePic: finalPic,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    pending++;
    if (pending >= 400) await flush();
  }

  await flush();

  const mb = (n) => (n / 1_000_000).toFixed(2);
  console.log(`DONE ✅ ${written} lean docs updated`);
  console.log(`  photos shrunk: ${shrunkCount} | already compact: ${alreadySmall} | hosted URLs kept: ${keptHttps} | no photo: ${noPhoto}`);
  if (totalBefore) console.log(`  base64 payload: ${mb(totalBefore)}MB -> ${mb(totalAfter)}MB (${Math.round((1 - totalAfter / totalBefore) * 100)}% lighter)`);
  process.exit(0);
};

run().catch((e) => {
  console.error('FAILED:', e?.code || e?.message || e);
  process.exit(1);
});
