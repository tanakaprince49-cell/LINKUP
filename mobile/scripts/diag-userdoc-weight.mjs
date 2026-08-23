import { initializeApp } from 'firebase/app';
import { initializeFirestore, getDocs, collection } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const app = initializeApp(config);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });
const auth = getAuth(app);
await signInWithEmailAndPassword(auth, process.argv[2], process.argv[3]);
const users = await getDocs(collection(db, 'users'));
let total = 0;
const rows = [];
users.forEach((d) => {
  const raw = JSON.stringify(d.data());
  const pic = String(d.data().profilePic || '');
  const hosted = String(d.data().profilePicUrl || '');
  const isBase64 = pic.startsWith('data:');
  total += raw.length;
  if (raw.length > 20000 || isBase64) {
    rows.push({
      uid: d.id.slice(0, 8),
      kb: Math.round(raw.length / 1024),
      base64Pic: isBase64 ? Math.round(pic.length / 1024) + 'KB' : 0,
      hosted: hosted ? 'yes' : 'NO',
    });
  }
});
rows.sort((a, b) => b.kb - a.kb);
console.log('users docs:', users.size, 'TOTAL payload KB:', Math.round(total / 1024));
console.log('fat/base64 docs:', rows.length);
console.table(rows.slice(0, 60));
process.exit(0);
