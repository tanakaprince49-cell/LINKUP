/**
 * Backfill builderStates for onboarded accounts that never opened the builder
 * workspace. Delegates to api/_builderStatesBackfill.js so CLI + HTTP sweeps
 * run identical idempotent logic.
 */
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ensureMissingBuilderStates } from '../api/_builderStatesBackfill.js';

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: 'linkup-e0906' });
}
const db = getFirestore();
const WRITE = process.argv.includes('--write');

const { created, current, scanned } = await ensureMissingBuilderStates(db, {
  cap: 200,
  write: WRITE,
  onCreate: (uid, data) => console.log(`  CREATE ${uid}  ${data.displayName || '-'}`),
});
console.log(`\n${WRITE ? 'Done' : 'Would do'}: create ${created}, already had state ${current} (scanned ${scanned} onboarded users)`);
