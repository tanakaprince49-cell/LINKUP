/**
 * How many people are on LINKUP?
 *
 * Run it from the functions folder — that is where firebase-admin lives:
 *
 *   cd C:\Users\hp\LINKUP\functions
 *   set GOOGLE_APPLICATION_CREDENTIALS=C:\Users\hp\linkup-sa.json
 *   node count-users.mjs
 *
 * You need a service-account key once:
 *   Firebase console -> gear icon -> Project settings -> Service accounts
 *   -> "Generate new private key" -> save as C:\Users\hp\linkup-sa.json
 *   (never commit that file)
 *
 * These are aggregate count queries: Firestore bills one document read per
 * 1,000 documents counted, so this costs pennies at any size.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'linkup-e0906' });

const db = getFirestore();

const count = async (label, target) => {
  try {
    const snapshot = await target.count().get();
    return { label, value: snapshot.data().count };
  } catch (error) {
    return { label, value: null, reason: String(error?.message || error) };
  }
};

const rows = [
  await count('Accounts (users collection)', db.collection('users')),
  await count('Finished onboarding', db.collection('users').where('onboarded', '==', true)),
  await count('Visible in discovery', db.collection('users').where('isVisible', '==', true)),
];

console.log('');
for (const row of rows) {
  if (row.value === null) {
    console.log(`${row.label.padEnd(30)} unavailable (${row.reason})`);
  } else {
    console.log(`${row.label.padEnd(30)} ${row.value.toLocaleString('en-US')}`);
  }
}
console.log('');
