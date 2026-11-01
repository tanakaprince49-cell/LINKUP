// Persistent UTC daily gate stored in Admin-only `systemJobs/{jobId}`.
// GitHub Actions throttles scheduled workflows (~5h intervals), so checking
// `date -u +%H == 03` misses most days. Recording `lastRunDay` in Firestore
// guarantees each daily job runs once per UTC calendar day regardless of which
// hour GitHub dispatches the sweep.
export async function shouldRunDailyJob(db, jobId, { daily = false, now = new Date() } = {}) {
  if (!daily) return true;
  const day = now.toISOString().slice(0, 10);
  const snap = await db.collection('systemJobs').doc(jobId).get().catch(() => null);
  if (snap?.exists && snap.data()?.lastRunDay === day) {
    console.log(`${jobId}: already ran today (${day} UTC); skipping.`);
    return false;
  }
  return true;
}

export async function markDailyJobRan(db, jobId, { daily = false, write = false, now = new Date() } = {}) {
  if (!daily || !write) return;
  const day = now.toISOString().slice(0, 10);
  await db.collection('systemJobs').doc(jobId).set({
    lastRunDay: day,
    lastRunAt: now.toISOString(),
  }, { merge: true }).catch(() => null);
}
