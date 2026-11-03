/**
 * Autonomous GitHub Commit Watcher for Linky Codebase Manager & Passive GitHub League.
 *
 * Runs automatically on schedule without the founder needing to open LINKUP or
 * install a manual webhook. Uses ETag conditional requests (304 Not Modified =
 * zero GitHub rate limit & zero per-user Firestore writes when idle) and
 * records every new commit directly into Builder League, Ship Log, Streak,
 * and `inspectedCommits` ("Commits Linky Looked At").
 */
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { sweepConnectedGithubCommits } from '../api/_ventureEngine.js';

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: 'linkup-e0906' });
}

const db = getFirestore();
const WRITE = process.argv.includes('--write');
const DISCOVER = process.argv.includes('--discover');

const res = await sweepConnectedGithubCommits({
  db,
  githubToken: process.env.GITHUB_TOKEN || '',
  maxProfiles: 50,
  discoverFromProfiles: DISCOVER,
  write: WRITE,
});

console.log(
  `[Linky GitHub Watcher] mode=${WRITE ? 'write' : 'dry-run'} checked=${res.checked} ` +
    `notModified=${res.notModified} discovered=${res.discoveredProfiles} ` +
    `usersWithNewCommits=${res.usersWithNewCommits} commitsRecorded=${res.commitsRecorded} ` +
    `leagueDaysCredited=${res.leagueDaysCredited} notificationsSent=${res.notificationsSent ?? 0}`
);
for (const item of res.recordedDetails || []) {
  console.log(`  + ${item.uid} · ${item.repo} · ${item.shortSha} (${item.count}) — ${item.message}`);
}
