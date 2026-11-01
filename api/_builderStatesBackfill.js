// Idempotent backfill for onboarded members missing their builderStates doc.
// Shared between the hourly CLI sweep (functions/backfill-builder-states.mjs)
// and the external hourly HTTP sweep (/api/linky?action=hourlySweep).
import { freshState } from './_builderCore.js';

export async function ensureMissingBuilderStates(db, { cap = 200, write = true, onCreate = null } = {}) {
  const users = await db.collection('users').where('onboarded', '==', true).limit(1000).get();
  let current = 0;
  let created = 0;
  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  };

  for (const userDoc of users.docs) {
    const data = userDoc.data() || {};
    if (data.deleted || data.banned) continue;
    if (created >= cap) break;
    const ref = db.collection('builderStates').doc(userDoc.id);
    if ((await ref.get()).exists) {
      current += 1;
      continue;
    }
    if (typeof onCreate === 'function') onCreate(userDoc.id, data);
    if (write) {
      batch.set(ref, freshState(Date.now()));
      pending += 1;
    }
    created += 1;
    if (pending >= 400) await flush();
  }
  await flush();
  return { created, current, scanned: users.size };
}
