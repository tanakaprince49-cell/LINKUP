/**
 * READ-ONLY discovery diagnostic: replicates the app's exact mobile read path.
 *   1. publicProfiles -> limit(14) -> compact + isDiscoverable filter (what Discover reads)
 *   2. users -> limit(6) fallback path
 * Prints counts + the first failing reason so we know where profiles die.
 */
import { initializeApp } from 'firebase/app';
import { initializeFirestore, getDocs, collection, query, limit } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url)));
const [, , email, password] = process.argv;
if (!email || !password) {
  console.error('usage: node scripts/diag-discovery.mjs <email> <password>');
  process.exit(1);
}

const app = initializeApp(config);
const db = initializeFirestore(app, { experimentalForceLongPolling: true });
const auth = getAuth(app);

const text = (v, max = 240) => String(v ?? '').trim().slice(0, max);
const isSyntheticProfile = (p) =>
  !!p && (!!p.isBot || String(p.uid || '').startsWith('demo-') || String(p.uid || '').startsWith('bot-'));
const isDiscoverableProfile = (p) =>
  !!p && !p.deleted && !p.isStealthMode && p.isVisible !== false && !isSyntheticProfile(p);

const run = async () => {
  await signInWithEmailAndPassword(auth, email, password);
  console.log('Signed in ✓ uid:', auth.currentUser.uid);

  // Path 1: what Discover/Search subscribe to
  const ppSnap = await getDocs(query(collection(db, 'publicProfiles'), limit(60)));
  console.log(`\npublicProfiles docs readable: ${ppSnap.size}`);
  let pass = 0;
  const failReasons = {};
  ppSnap.forEach((d) => {
    const data = d.data();
    const row = { uid: data.uid || d.id, ...data };
    if (isDiscoverableProfile(row)) {
      pass++;
    } else {
      const why = data.deleted ? 'deleted' : data.isStealthMode ? 'stealth' : data.isVisible === false ? 'invisible' : 'synthetic';
      failReasons[why] = (failReasons[why] || 0) + 1;
    }
  });
  console.log(`discoverable after app filter: ${pass}`);
  if (Object.keys(failReasons).length) console.log('fail reasons:', JSON.stringify(failReasons));

  const first = ppSnap.docs[0]?.data();
  if (first) {
    console.log('\nsample doc keys:', Object.keys(first).sort().join(' '));
    console.log('sample displayName:', first.displayName, '| has profilePic:', !!first.profilePic, '| isVisible:', first.isVisible);
  }

  // Path 2: the fat fallback
  const usersSnap = await getDocs(query(collection(db, 'users'), limit(6)));
  console.log(`\nusers fallback docs readable: ${usersSnap.size}`);
  let usersPass = 0;
  usersSnap.forEach((d) => {
    const data = d.data();
    if (isDiscoverableProfile({ uid: d.id, ...data })) usersPass++;
  });
  console.log(`users fallback discoverable: ${usersPass}`);

  process.exit(0);
};

run().catch((e) => {
  console.error('DIAG FAILED:', e?.code || e?.message || e);
  process.exit(1);
});
