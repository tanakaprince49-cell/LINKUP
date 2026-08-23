import { initializeApp } from 'firebase/app';
import { initializeFirestore, getDocs, collection } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const app = initializeApp(config);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });
const auth = getAuth(app);
await signInWithEmailAndPassword(auth, process.argv[2], process.argv[3]);

const cap = 240000;
const ok = (v) => {
  const s = String(v || '');
  return /^https?:\/\//.test(s) ? s : (s.startsWith('data:image') && s.length <= cap ? s : '');
};

const idx = await getDocs(collection(db, 'publicProfiles'));
let withPic = 0, noPic = 0;
const noPicIds = [];
idx.forEach((d) => {
  const p = d.data().profilePic;
  if (p) withPic++;
  else { noPic++; noPicIds.push(d.id); }
});
console.log('index docs:', idx.size, '| withPic:', withPic, '| noPic:', noPic);

const users = await getDocs(collection(db, 'users'));
let hasAny = 0, underCap = 0, overCap = 0, none = 0;
const overCapIds = [];
users.forEach((d) => {
  if (!noPicIds.includes(d.id)) return;
  const u = d.data();
  const cand = [u.profilePic, u.photoURL, u.photoUrl, u.avatarUrl, u.avatar, u.picture, u.imageUrl, u.profileImage, ...(Array.isArray(u.photos) ? u.photos : [])];
  const raw = cand.find((v) => v && (String(v).startsWith('data:image') || /^https?:/.test(String(v))));
  if (!raw) { none++; return; }
  hasAny++;
  if (ok(raw)) underCap++;
  else { overCap++; overCapIds.push(d.id); }
});
console.log('noPic users -> with SOME photo field:', hasAny, '| usable under 240KB cap:', underCap, '| only over-cap base64:', overCap, '| truly no photo:', none);
console.log('overCap sample ids:', overCapIds.slice(0, 3).join(', '));
process.exit(0);
