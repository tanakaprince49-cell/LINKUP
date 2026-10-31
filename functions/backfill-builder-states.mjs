/**
 * Backfill builderStates for onboarded accounts that never opened the builder
 * workspace.
 *
 * The hourly reminder cron iterates builderStates, so anyone without a state
 * document is invisible to it: no retention messages, no pushes, nothing
 * pulling them back. States used to be created lazily by the first builder
 * action, which most members never take. The client cannot create them
 * (builder collections are server-only), so this job does it instead.
 *
 * Idempotent: it only creates documents that do not exist yet, so the hourly
 * sweep can run it safely. Capped per run to stay inside free-tier quotas.
 *
 *   cd functions
 *   node backfill-builder-states.mjs            (dry run)
 *   node backfill-builder-states.mjs --write    (applies)
 */
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { freshState } from '../api/_builderCore.js';

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: 'linkup-e0906' });
}
const db = getFirestore();
const WRITE = process.argv.includes('--write');
const CAP = 200;

const users = await db.collection('users').where('onboarded', '==', true).limit(1000).get();
let current = 0, created = 0;
const batch = db.batch();
let pending = 0;
const flush = async () => { if (pending) { await batch.commit(); pending = 0; } };

for (const userDoc of users.docs) {
  if (userDoc.data().deleted || userDoc.data().banned) continue;
  if (created >= CAP) break;
  const ref = db.collection('builderStates').doc(userDoc.id);
  if ((await ref.get()).exists) { current += 1; continue; }
  console.log(`  CREATE ${userDoc.id}  ${userDoc.data().displayName || '-'}`);
  if (WRITE) { batch.set(ref, freshState(Date.now())); pending += 1; }
  created += 1;
  if (pending >= 400) await flush();
}
await flush();
console.log(`\n${WRITE ? 'Done' : 'Would do'}: create ${created}, already had state ${current} (scanned ${users.size} onboarded users)`);
