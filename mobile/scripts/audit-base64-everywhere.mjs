import { initializeApp } from 'firebase/app';
import { initializeFirestore, getDocs, collection } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const app = initializeApp(config);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });
const auth = getAuth(app);
await signInWithEmailAndPassword(auth, process.argv[2], process.argv[3]);

const countDataUris = (value, depth = 0) => {
  if (depth > 6 || value == null) return 0;
  if (typeof value === 'string') return value.startsWith('data:') && value.length > 900 ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((n, v) => n + countDataUris(v, depth + 1), 0);
  if (typeof value === 'object') return Object.values(value).reduce((n, v) => n + countDataUris(v, depth + 1), 0);
  return 0;
};

for (const col of ['users', 'matches', 'publicProfiles', 'notifications', 'swipes']) {
  try {
    const snap = await getDocs(collection(db, col));
    let total = 0, docsWithData = 0, dataUris = 0, fattest = 0;
    snap.forEach((d) => {
      const raw = JSON.stringify(d.data());
      total += raw.length;
      if (raw.length > fattest) fattest = raw.length;
      const n = countDataUris(d.data());
      if (n > 0) { docsWithData += 1; dataUris += n; }
    });
    console.log(`${col}: docs=${snap.size} totalKB=${Math.round(total / 1024)} fattestKB=${Math.round(fattest / 1024)} docsWithBase64=${docsWithData} base64Blobs=${dataUris}`);
  } catch (e) {
    console.log(`${col}: ERROR ${e.message}`);
  }
}
process.exit(0);
