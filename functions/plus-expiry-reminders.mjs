/**
 * PLUS / Campaigns renewal reminders for web (Payonify) prepaid terms.
 *
 * A web purchase is a fixed prepaid term: webSubscriptions/{uid}.<tier>.endsAt.
 * Nothing renews it and, until this script, nothing warned the customer - the
 * paywall just came back one day. This sweep writes one in-app notification
 * per milestone into the same `notifications` collection the app already
 * listens to (Alerts tab, in-app sound, browser notification on web, local
 * push on Android), so it needs NO client rebuild.
 *
 * Milestones (days before endsAt): 3, 1, 0 (= "ends today"), and one
 * "your PLUS has ended" notice within a day after expiry. Each milestone is
 * recorded on the subscription document (`<tier>.remindersSent`) so an hourly
 * run never sends the same reminder twice.
 *
 * Runs from .github/workflows/campaign-expiry.yml right after the campaign
 * sweep, with the same service account. Dry run by default:
 *
 *   cd C:\Users\hp\LINKUP\functions
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\hp\linkup-sa.json"
 *   node plus-expiry-reminders.mjs           (dry run - shows the plan)
 *   node plus-expiry-reminders.mjs --write   (sends)
 */
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: 'linkup-e0906' });
}
const db = getFirestore();

const WRITE = process.argv.includes('--write');
const DAY_MS = 24 * 60 * 60 * 1000;

/** Which tiers to remind about and how they read in copy. */
const TIERS = {
  plus: { label: 'LINKUP PLUS', renewHint: 'Renew any time from the PLUS button - your new month stacks on top of the time you have left.' },
  campaigns: { label: 'Campaigns', renewHint: 'Renew from the Campaigns tab to keep your ads running without a gap.' },
};

/**
 * Milestones, evaluated against `daysLeft = (endsAt - now) / DAY_MS`.
 * `window` is [min, max) in days; a milestone fires once when daysLeft is
 * inside its window. Windows tile so a sweep that misses an hour still fires
 * the closest milestone, and only that one.
 */
const MILESTONES = [
  { key: 'd3', min: 2, max: 3.5, title: (t) => `${t.label} ends in 3 days`, body: (t, when) => `Your ${t.label} term ends on ${when}. ${t.renewHint}` },
  { key: 'd1', min: 0.5, max: 2, title: (t) => `${t.label} ends tomorrow`, body: (t, when) => `Your ${t.label} term ends ${when}. ${t.renewHint}` },
  { key: 'd0', min: 0, max: 0.5, title: (t) => `${t.label} ends today`, body: (t, when) => `Your ${t.label} term ends today at ${when}. ${t.renewHint}` },
  { key: 'ended', min: -1, max: 0, title: (t) => `${t.label} has ended`, body: (t) => `Your ${t.label} term has ended, so the free limits are back. ${t.renewHint}` },
];

const toMillis = (value) => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const fmtDate = (ms) =>
  new Date(ms).toLocaleString('en-GB', { timeZone: 'Africa/Harare', weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (ms) =>
  new Date(ms).toLocaleString('en-GB', { timeZone: 'Africa/Harare', hour: '2-digit', minute: '2-digit' });

const now = Date.now();
let scanned = 0;
let sent = 0;
let skipped = 0;

// webSubscriptions is small (one doc per paying web customer); a full scan is fine.
const snap = await db.collection('webSubscriptions').get();
console.log(`${WRITE ? 'WRITE' : 'DRY RUN'} - ${snap.size} web subscription document(s)\n`);

for (const docSnap of snap.docs) {
  const uid = docSnap.id;
  const data = docSnap.data() || {};

  for (const [tier, copy] of Object.entries(TIERS)) {
    const entry = data[tier];
    if (!entry || typeof entry !== 'object') continue;
    scanned += 1;

    const endsAt = toMillis(entry.endsAt);
    if (!endsAt || String(entry.status || '').toLowerCase() !== 'active') {
      skipped += 1;
      continue;
    }

    const daysLeft = (endsAt - now) / DAY_MS;
    const milestone = MILESTONES.find((m) => daysLeft >= m.min && daysLeft < m.max);
    if (!milestone) continue;

    // Reminder bookkeeping is keyed by the term it belongs to (endsAt), so a
    // renewal that moves endsAt forward gets a fresh set of reminders.
    const sentMap = entry.remindersSent && typeof entry.remindersSent === 'object' ? entry.remindersSent : {};
    const termKey = String(endsAt);
    if (sentMap[termKey] && sentMap[termKey][milestone.key]) continue;

    // The user must exist and not be deleted - never notify a ghost.
    const userDoc = await db.doc(`users/${uid}`).get().catch(() => null);
    if (userDoc?.exists && userDoc.data()?.deleted) {
      skipped += 1;
      continue;
    }

    const when = milestone.key === 'd0' ? fmtTime(endsAt) : fmtDate(endsAt);
    const title = milestone.title(copy);
    const body = milestone.body(copy, when);
    const content = `${title}. ${body}`.slice(0, 500);
    console.log(`  ${milestone.key.padEnd(5)} ${tier.padEnd(9)} ${uid}  (${daysLeft.toFixed(2)}d)  ${title}`);

    if (WRITE) {
      const batch = db.batch();
      batch.set(db.collection('notifications').doc(), {
        userId: uid,
        fromId: '',
        fromName: 'LINKUP',
        fromPic: '',
        type: 'plus_expiring',
        content,
        isRead: false,
        timestamp: FieldValue.serverTimestamp(),
      });
      batch.set(
        docSnap.ref,
        {
          [tier]: {
            remindersSent: { [termKey]: { [milestone.key]: Timestamp.now() } },
          },
        },
        { merge: true }
      );
      await batch.commit();
    }
    sent += 1;
  }
}

console.log(
  `\n${WRITE ? 'Sent' : 'Would send'} ${sent} reminder(s). Scanned ${scanned} tier entr${scanned === 1 ? 'y' : 'ies'}, skipped ${skipped} inactive.`
);
