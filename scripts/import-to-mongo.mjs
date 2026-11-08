// One-shot importer: Firestore backup (NDJSON) -> MongoDB Atlas.
//
// Usage:
//   MONGO_URI="mongodb://..." BACKUP_DIR=/path/to/backups/firestore-YYYY-MM-DD \
//     node scripts/import-to-mongo.mjs [--verify-only]
//
// Reads the backup produced by the export step (one .ndjson per collection,
// each line {"_id": ..., "_data": {...}} with Firestore values tagged as
// {"__type":"timestamp","value":<iso>} / {"__type":"geo",...} /
// {"__type":"ref","path":...}), converts them to native BSON, and upserts
// by _id, so re-running is idempotent. Afterwards it verifies the document
// count of every collection against the backup manifest and creates the
// indexes the app's query patterns need.
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const BACKUP_DIR = process.env.BACKUP_DIR || process.argv.find((a) => a.startsWith('--dir='))?.slice(6);
const VERIFY_ONLY = process.argv.includes('--verify-only');
const DB_NAME = process.env.MONGO_DB || 'linkup';
const URI = process.env.MONGO_URI;

if (!URI) { console.error('MONGO_URI is not set'); process.exit(1); }
if (!BACKUP_DIR || !fs.existsSync(BACKUP_DIR)) { console.error(`BACKUP_DIR missing: ${BACKUP_DIR}`); process.exit(1); }

// Backup file -> Mongo collection (subcollections were flattened at export).
const RENAME = {
  matchMessages: 'messages',
  roomMessages: 'roomMessages',
  postComments: 'postComments',
  postReplies: 'postReplies',
};

function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    if (v.__type === 'timestamp') return new Date(v.value);
    if (v.__type === 'geo') return { type: 'Point', coordinates: [v.lng, v.lat] };
    if (v.__type === 'ref') return v.path;
    if (v.__type === 'bytes') return Buffer.from(v.base64, 'base64');
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = decode(x);
    return out;
  }
  return v;
}

const manifestPath = path.join(BACKUP_DIR, '_manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;

const expected = new Map(); // mongo collection -> expected docs
if (manifest) {
  for (const f of manifest.files || []) expected.set(RENAME[f.collection] || f.collection, (expected.get(RENAME[f.collection] || f.collection) || 0) + f.documents);
  for (const s of manifest.subcollections || []) {
    const base = s.file.replace(/\.ndjson$/, '');
    expected.set(RENAME[base] || base, (expected.get(RENAME[base] || base) || 0) + s.documents);
  }
}

const client = new MongoClient(URI, { retryWrites: true });

async function main() {
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`connected -> db "${DB_NAME}"`);

  if (!VERIFY_ONLY) {
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.ndjson')).sort();
    let total = 0;
    for (const file of files) {
      const base = file.replace(/\.ndjson$/, '');
      const collName = RENAME[base] || base;
      const lines = fs.readFileSync(path.join(BACKUP_DIR, file), 'utf8').split('\n').filter(Boolean);
      const coll = db.collection(collName);
      const ops = lines.map((line) => {
        const { _id, _data } = JSON.parse(line);
        return {
          replaceOne: {
            filter: { _id: String(_id) },
            replacement: { _id: String(_id), ...decode(_data || {}) },
            upsert: true,
          },
        };
      });
      for (let i = 0; i < ops.length; i += 500) {
        await coll.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      }
      total += ops.length;
      console.log(`${String(ops.length).padStart(6)}  ${collName}`);
    }
    console.log(`imported ${total} documents`);
  }

  // ---- verification: counts per collection must match the backup exactly
  let failures = 0;
  for (const [name, want] of [...expected.entries()].sort((a, b) => b[1] - a[1])) {
    const got = await db.collection(name).countDocuments();
    const ok = got === want;
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name.padEnd(28)} backup=${want} mongo=${got}`);
  }

  // ---- indexes for the app's real query patterns
  const INDEXES = {
    notifications: [[{ userId: 1, timestamp: -1 }], [{ userId: 1, isRead: 1 }]],
    messages: [[{ matchId: 1, timestamp: 1 }]],
    roomMessages: [[{ roomId: 1, timestamp: 1 }]],
    postComments: [[{ postId: 1 }]],
    postReplies: [[{ postId: 1 }, { commentId: 1 }]],
    matches: [[{ userIds: 1 }], [{ lastMessageTime: -1 }]],
    connectionRequests: [[{ recipientId: 1, status: 1 }], [{ senderId: 1 }]],
    savedProfiles: [[{ ownerId: 1 }]],
    profileViews: [[{ profileId: 1 }]],
    profileClicks: [[{ profileId: 1 }]],
    ideaSwipes: [[{ swiperId: 1 }], [{ ideaOwnerId: 1 }]],
    gameChallenges: [[{ senderId: 1 }], [{ recipientId: 1 }]],
    publicProfiles: [[{ username: 1 }], [{ searchName: 1 }]],
    users: [[{ username: 1 }]],
    campaigns: [[{ ownerId: 1 }], [{ status: 1 }]],
    webTransactions: [[{ uid: 1, createdAt: -1 }]],
    emailRecipientLocks: [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
  };
  for (const [name, specs] of Object.entries(INDEXES)) {
    for (const spec of specs) {
      try { await db.collection(name).createIndex(...spec); }
      catch (e) { console.log(`index skipped ${name} ${JSON.stringify(spec[0])}: ${String(e.message).slice(0, 80)}`); }
    }
  }
  console.log('indexes ensured');

  await client.close();
  console.log(failures ? `\nVERIFY FAILED (${failures} collections)` : '\nVERIFY PASSED — every collection matches the backup');
  process.exit(failures ? 2 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
