// Purge base64 images embedded in matches/{id}/messages mediaUrl: upload to
// ImageKit, rewrite the message doc with the hosted URL. Chat history drops
// from multi-MB to a few KB per image message.
// Usage: node scripts/purge-chat-media.mjs <email> <password> <ikPrivateKey>
import { initializeApp } from 'firebase/app';
import { initializeFirestore, getDocs, collection, doc, updateDoc } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { readFileSync } from 'node:fs';

const [email, password, ikKey] = process.argv.slice(2);
const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const app = initializeApp(config);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });
const auth = getAuth(app);
await signInWithEmailAndPassword(auth, email, password);

const b64 = Buffer.from(`${ikKey}:`).toString('base64');
const upload = async (dataUri, fileName) => {
  const form = new FormData();
  form.append('file', dataUri);
  form.append('fileName', fileName);
  form.append('folder', '/linkup-chat-media');
  form.append('useUniqueFileName', 'false');
  const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: { Authorization: `Basic ${b64}` },
    body: form,
  });
  const data = await res.json().catch(() => null);
  return res.ok && data?.url ? String(data.url) : null;
};

const matches = await getDocs(collection(db, 'matches'));
let scanned = 0, migrated = 0, failed = 0;
for (const m of matches.docs) {
  const msgs = await getDocs(collection(db, 'matches', m.id, 'messages'));
  for (const msg of msgs.docs) {
    const url = String(msg.data().mediaUrl || '');
    if (!url.startsWith('data:image')) continue;
    scanned += 1;
    const hosted = await upload(url, `${m.id}-${msg.id}.jpg`);
    if (hosted) {
      await updateDoc(doc(db, 'matches', m.id, 'messages', msg.id), { mediaUrl: hosted, mediaSize: Number(msg.data().mediaSize) || 0 });
      migrated += 1;
    } else {
      failed += 1;
    }
  }
}
console.log(`DONE. base64 chat images found=${scanned} migrated=${migrated} failed=${failed}`);
process.exit(0);
