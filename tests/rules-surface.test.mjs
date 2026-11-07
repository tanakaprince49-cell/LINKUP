// The rules file is the authorization surface for the whole product, and it had
// drifted: it still described collections and validators for features the app no
// longer has. Those blocks cost nothing at read time, but they are lies about the
// system — and the validator cluster they carried was ~250 lines of "safety" that
// nothing called, which is how the real profile validator quietly went over
// budget while looking well guarded.
//
// The client list below is the test: every collection a screen or API route
// actually touches. A rules block outside it has to be a server-only ledger
// (deny-all, Admin SDK) or it does not belong in the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

const walk = (dir, exts, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
};

const root = new URL('../', import.meta.url).pathname;
const sources = [
  ...walk(path.join(root, 'mobile/src'), ['.ts', '.tsx']),
  ...walk(path.join(root, 'api'), ['.js']),
  ...fs.readdirSync(path.join(root, 'mobile')).filter((f) => f === 'App.tsx').map((f) => path.join(root, 'mobile', f)),
].map((file) => [file, fs.readFileSync(file, 'utf8')]);
const haystack = sources.map(([, text]) => text).join('\n');

// Collections a member or the current server code touches today.
const USED = [
  'users', 'publicProfiles', 'userPrivate', 'presence', 'reports', 'blocks',
  'ideaSwipes', 'connectionRequests', 'matches', 'notifications', 'savedProfiles',
  'gameChallenges', 'profileViews', 'profileClicks', 'config', 'campaignAccounts',
  'webTransactions', 'webSubscriptions', 'campaigns', 'leagueChampions', 'posts',
  'introSuggestions', 'intros', 'linkyUsage', 'linkyState', 'botUsers', 'botLinks',
  'linkyOutreach', 'introDrafts', 'outreachIntents', 'builderContributions',
  'builderStates', 'builderRooms', 'builderInvites', 'builderAsks', 'builderEvents',
  'builderRates', 'builderScheduler',
];

test('every collection the app uses is still authorized', () => {
  for (const collection of USED) {
    assert.ok(
      rules.includes(`match /${collection}/`),
      `firestore.rules lost its match block for ${collection}, which the app still uses`
    );
  }
});

test('features the app no longer has are gone from the rules', () => {
  // swipes: only the never-deployed Cloud Functions wrote it (functions/ needs
  // Blaze); aiMatches: same cache; intents: nothing has written it since the
  // Linky API moved to its own collections; profiles: a legacy aux store that
  // let any signed-in member list every row.
  for (const dead of ['swipes', 'aiMatches', 'intents', 'profiles']) {
    // "Referenced" means a real Firestore call (collection(db, 'x') / doc(db, 'x')),
    // not a string that happens to contain the word — api/publicSeo.js has a
    // `mode === 'profiles'` sitemap mode that has nothing to do with the old store.
    const call = new RegExp(`(?:collection|doc)\\([^)]*['\"]${dead}['\"]`);
    assert.ok(!call.test(haystack), `'${dead}' is still read or written by client/API code, so its rules block was removed too early`);
    assert.ok(!new RegExp(`match /${dead}/`).test(rules), `rules still carry a dead ${dead} block`);
  }
});

test('no rules function is unreachable', () => {
  // A dead validator is worse than dead code: it documents protection that does
  // not run. Every function must be reachable from an allow statement.
  const lines = rules.split('\n');
  const findEnd = (start) => {
    let depth = 0;
    let started = false;
    for (let i = start; i < lines.length; i += 1) {
      depth += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
      if (lines[i].includes('{')) started = true;
      if (started && depth <= 0) return i;
    }
    return lines.length - 1;
  };
  const bodies = {};
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s*function ([A-Za-z0-9_]+)\(/);
    if (match) bodies[match[1]] = [i, findEnd(i)];
  }
  const allowLines = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*allow /.test(lines[i])) {
      let j = i;
      while (!lines[j].trimEnd().endsWith(';') && j < lines.length - 1) j += 1;
      allowLines.push(lines.slice(i, j + 1).join('\n'));
    }
  }
  const namesIn = (text) => Object.keys(bodies).filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(text));
  const live = new Set(namesIn(allowLines.join('\n')));
  const queue = [...live];
  while (queue.length) {
    const name = queue.pop();
    const [start, end] = bodies[name];
    for (const called of namesIn(lines.slice(start, end + 1).join('\n'))) {
      if (!live.has(called)) {
        live.add(called);
        queue.push(called);
      }
    }
  }
  const dead = Object.keys(bodies).filter((name) => !live.has(name));
  assert.deepEqual(dead, [], `unreachable rules functions: ${dead.join(', ')}`);
});

test('the Connection Doctor does not spend the read quota for members', () => {
  const doctor = fs.readFileSync(new URL('../mobile/src/lib/bootDiagnostics.ts', import.meta.url), 'utf8');
  // ~24 reads a cold start (publicProfiles x20, users x3, one stream) for console
  // output only a developer can see: it must be opt-in.
  assert.match(doctor, /bootDiagnosticsEnabled = \(\) =>/);
  assert.match(doctor, /EXPO_PUBLIC_DIAGNOSTICS/);
  const body = doctor.slice(doctor.indexOf('export const runBootDiagnostics'));
  assert.match(body.slice(0, 400), /if \(!bootDiagnosticsEnabled\(\)\) return;/);
});
