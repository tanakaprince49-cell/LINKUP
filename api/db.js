// Client data endpoint for the MongoDB backend (POST /api/db).
//
// Replaces direct client->Firestore access. The app sends Firestore-shaped
// operations (getDoc / getDocs / set / update / add / delete / batch) with a
// Firebase ID token; this function verifies the token (Firebase Auth is
// unchanged), enforces the authorization ported from firestore.rules
// (api/_dbPolicy.js), executes against MongoDB through the same adapter the
// server endpoints use, and returns Firestore-shaped results.
//
// Wire encoding (JSON-safe):
//   timestamp  -> { $t: <millis> }
//   geopoint   -> { $geo: [lat, lng] }
//   serverTimestamp() -> { $fv: 'serverTimestamp' }
//   increment(n)      -> { $fv: 'increment', n }
//   arrayUnion(xs)    -> { $fv: 'arrayUnion', items: [...] }
//   arrayRemove(xs)   -> { $fv: 'arrayRemove', items: [...] }
//   deleteField()     -> { $fv: 'deleteField' }
//   document ref      -> { $ref: 'collection/docId' }
import { getDb, verifyRequestUser } from './_firebaseAdmin.js';
import { MongoFieldValue, FsTimestamp, FsGeoPoint } from './_mongoFirestore.js';
import { canReadDoc, canWrite, isAdminUser, isParticipant, SERVER_ONLY } from './_dbPolicy.js';

export const config = { maxDuration: 30 };

const MAX_LIST = 500;

// ------------------------------------------------------------ wire codec

function decodeValue(v) {
  if (Array.isArray(v)) return v.map(decodeValue);
  if (v && typeof v === 'object') {
    if (typeof v.$t === 'number') return new Date(v.$t);
    if (typeof v.$fv === 'string') {
      switch (v.$fv) {
        case 'serverTimestamp': return MongoFieldValue.serverTimestamp();
        case 'deleteField': return MongoFieldValue.delete();
        case 'increment': return MongoFieldValue.increment(v.n);
        case 'arrayUnion': return MongoFieldValue.arrayUnion(...(v.items || []).map(decodeValue));
        case 'arrayRemove': return MongoFieldValue.arrayRemove(...(v.items || []).map(decodeValue));
        default: return v;
      }
    }
    if (typeof v.$ref === 'string') return v.$ref;
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = decodeValue(x);
    return out;
  }
  return v;
}

function encodeValue(v) {
  if (v === null || v === undefined) return v ?? null;
  if (v instanceof FsTimestamp) return { $t: v.toMillis() };
  if (v instanceof Date) return { $t: v.getTime() };
  if (v instanceof FsGeoPoint) return { $geo: [v.latitude, v.longitude] };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = encodeValue(x);
    return out;
  }
  return v;
}

const encodeDoc = (snap) => ({ id: snap.id, data: encodeValue(snap.data()) });

// ------------------------------------------------------------- ref paths

// Resolve Firestore-style segments to engine refs.
// ['users', uid] -> doc; ['matches', id, 'messages'] -> subcollection.
function resolveCollection(db, segments) {
  if (!Array.isArray(segments) || !segments.length || segments.length % 2 === 0) {
    throw Object.assign(new Error('invalid collection path'), { status: 400 });
  }
  let ref = db.collection(String(segments[0]));
  for (let i = 1; i < segments.length; i += 2) {
    ref = ref.doc(String(segments[i])).collection(String(segments[i + 1]));
  }
  return ref;
}

function resolveDoc(db, segments) {
  if (!Array.isArray(segments) || segments.length < 2 || segments.length % 2 !== 0) {
    throw Object.assign(new Error('invalid document path'), { status: 400 });
  }
  return db.doc(segments.map(String).join('/'));
}

// Physical collection a path lands in (for policy checks).
function physicalCollection(segments) {
  const collSegs = segments.filter((_, i) => i % 2 === 0);
  const last = collSegs[collSegs.length - 1];
  const parent = collSegs[collSegs.length - 2];
  const map = {
    'matches/messages': 'messages',
    'builderRooms/messages': 'roomMessages',
    'posts/comments': 'postComments',
    'comments/replies': 'postReplies',
  };
  return map[`${parent}/${last}`] || last;
}

function deny(res, message = 'permission-denied') {
  return res.status(403).json({ ok: false, error: message, code: 'permission-denied' });
}

// Fetch parent-match participation for messages ops.
async function matchParticipant(db, matchId, uid) {
  if (!matchId || !uid) return false;
  const snap = await db.collection('matches').doc(String(matchId)).get();
  if (!snap.exists) return false;
  return isParticipant(snap.data(), uid);
}


// Build + run a client query and post-filter every returned document
// through the read policy. Returns engine DocumentSnapshots.
async function queryDocs(db, user, op, collection) {
  const uid = user?.uid || null;
  const segments = op.path || [];
  let q = resolveCollection(db, segments);
  let wantsLimit = null;
  const orderFields = (op.constraints || []).filter((c) => c.t === 'orderBy').map((c) => String(c.f));
  const pathValue = (obj, field) => field === '__name__'
    ? undefined
    : field.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
  for (const c of op.constraints || []) {
    if (c.t === 'where') q = q.where(String(c.f), c.op, decodeValue(c.v));
    else if (c.t === 'orderBy') q = q.orderBy(String(c.f), c.dir || 'asc');
    else if (c.t === 'limit') wantsLimit = Math.min(Number(c.n) || MAX_LIST, MAX_LIST);
    else if (c.t === 'limitToLast') { q = q.limitToLast(Math.min(Number(c.n) || MAX_LIST, MAX_LIST)); wantsLimit = null; }
    else if (c.t === 'startAfter' || c.t === 'startAt' || c.t === 'endBefore' || c.t === 'endAt') {
      const kind = { startAfter: 'after', startAt: 'at', endBefore: 'before', endAt: 'endAt' }[c.t];
      let values = (c.values || []).map(decodeValue);
      if (!values.length && c.docData) {
        // Cursor came from a snapshot: pull the orderBy values out of it.
        const decoded = decodeValue(c.docData);
        values = orderFields.map((f) => (f === '__name__' ? c.id : pathValue(decoded, f)));
      }
      q = q._clone({ cursor: { kind, values, id: c.id } });
    }
  }
  q = q.limit(wantsLimit ?? 200);
  const snap = await q.get();
  let docs = snap.docs;
  // Post-filter: never hand back a document the caller may not read.
  if (collection === 'messages') {
    const allowed = new Map();
    const kept = [];
    for (const d of docs) {
      const mid = d.data().matchId;
      if (!allowed.has(mid)) allowed.set(mid, await matchParticipant(db, mid, uid));
      if (allowed.get(mid)) kept.push(d);
    }
    docs = kept;
  } else {
    docs = docs.filter((d) => canReadDoc(collection, d.data(), uid) ||
      (['userPrivate', 'campaignAccounts', 'webSubscriptions'].includes(collection) && d.id === uid));
  }
  return docs;
}

async function runOp(db, user, op) {
  const uid = user?.uid || null;
  switch (op.kind) {
    case 'getDoc': {
      const segments = op.path || [];
      const collection = physicalCollection(segments);
      if (SERVER_ONLY.has(collection)) throw Object.assign(new Error('permission-denied'), { status: 403 });
      const ref = resolveDoc(db, segments);
      const snap = await ref.get();
      if (!snap.exists) {
        // Don't leak existence across owners for owner-scoped collections.
        const ownDoc = segments[1] === uid;
        const openGet = ['publicProfiles', 'users', 'campaigns', 'posts', 'config', 'leagueChampions'].includes(collection);
        if (!ownDoc && !openGet && !uid) throw Object.assign(new Error('permission-denied'), { status: 403 });
        return { exists: false, id: ref.id };
      }
      if (collection === 'messages') {
        const matchId = snap.data().matchId;
        if (!(await matchParticipant(db, matchId, uid))) {
          throw Object.assign(new Error('permission-denied'), { status: 403 });
        }
      } else if (!canReadDoc(collection, snap.data(), uid) &&
                 !(segments[1] === uid && ['userPrivate', 'campaignAccounts', 'webSubscriptions'].includes(collection))) {
        throw Object.assign(new Error('permission-denied'), { status: 403 });
      }
      return { exists: true, ...encodeDoc(snap) };
    }

    case 'count': {
      const segments = op.path || [];
      const collection = physicalCollection(segments);
      if (SERVER_ONLY.has(collection)) throw Object.assign(new Error('permission-denied'), { status: 403 });
      if (!uid) throw Object.assign(new Error('permission-denied'), { status: 403 });
      const docs = await queryDocs(db, user, { ...op, kind: 'getDocs' }, collection);
      return { count: docs.length };
    }

    case 'getDocs': {
      const segments = op.path || [];
      const collection = physicalCollection(segments);
      if (SERVER_ONLY.has(collection)) throw Object.assign(new Error('permission-denied'), { status: 403 });
      if (!uid && collection !== 'publicProfiles') {
        throw Object.assign(new Error('permission-denied'), { status: 403 });
      }
      const docs = await queryDocs(db, user, op, collection);
      return { docs: docs.map(encodeDoc) };
    }

    case 'set':
    case 'update':
    case 'add':
    case 'delete': {
      if (!uid) throw Object.assign(new Error('permission-denied'), { status: 403 });
      const isAdd = op.kind === 'add';
      const segments = isAdd ? [...(op.path || []), '__pending__'] : (op.path || []);
      const collection = physicalCollection(op.path || []);
      if (SERVER_ONLY.has(collection)) throw Object.assign(new Error('permission-denied'), { status: 403 });
      const data = decodeValue(op.data || {});
      let ref;
      let docId;
      if (isAdd) {
        const collRef = resolveCollection(db, op.path || []);
        ref = collRef.doc();
        docId = ref.id;
      } else {
        ref = resolveDoc(db, op.path || []);
        docId = ref.id;
      }
      const existingSnap = op.kind === 'delete' || !isAdd ? await ref.get().catch(() => null) : null;
      const existing = existingSnap?.exists ? existingSnap.data() : null;
      const action = op.kind === 'delete' ? 'delete' : existing ? 'update' : 'create';
      const patch = op.kind === 'update' ? data : data;
      const resulting = op.kind === 'delete'
        ? existing
        : op.kind === 'update' || op.merge
          ? { ...(existing || {}), ...data }
          : data;

      // Subcollection parent ids are implicit in the path; make them visible
      // to the policy (and the stored doc keeps them too, via the adapter).
      if (collection === 'messages' && op.path?.length >= 3) resulting.matchId = resulting.matchId || op.path[1];
      if (collection === 'postComments' && op.path?.length >= 3) resulting.postId = resulting.postId || op.path[1];
      if (collection === 'postReplies' && op.path?.length >= 5) {
        resulting.postId = resulting.postId || op.path[1];
        resulting.commentId = resulting.commentId || op.path[3];
      }

      let allowed = canWrite({ collection, action, uid, docId, patch, resulting, existing });
      if (!allowed && collection === 'messages') {
        allowed = await matchParticipant(db, resulting.matchId || existing?.matchId, uid) &&
          (action === 'create' ? resulting.senderId === uid : true);
      }
      if (!allowed && collection === 'campaigns' && action === 'update') {
        allowed = await isAdminUser(db, uid, user?.email);
      }
      if (!allowed && collection === 'postComments' && action === 'delete') {
        const post = resulting?.postId ? await db.collection('posts').doc(String(resulting.postId)).get() : null;
        allowed = !!(post?.exists && post.data()?.authorId === uid);
      }
      if (!allowed) throw Object.assign(new Error('permission-denied'), { status: 403 });

      if (op.kind === 'delete') {
        await ref.delete();
        return { id: docId, deleted: true };
      }
      if (op.kind === 'update') {
        if (!existing) {
          const err = new Error(`No document to update: ${segments.join('/')}`);
          err.status = 404;
          throw err;
        }
        await ref.update(data);
        return { id: docId };
      }
      await ref.set(data, op.merge ? { merge: true } : {});
      return { id: docId };
    }

    default:
      throw Object.assign(new Error(`unsupported op: ${op.kind}`), { status: 400 });
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  try {
    const db = getDb();
    const user = await verifyRequestUser(req).catch(() => null);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.kind === 'batch') {
      const results = [];
      for (const op of body.ops || []) results.push(await runOp(db, user, op));
      return res.status(200).json({ ok: true, results });
    }
    const result = await runOp(db, user, body);
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[api/db]', err);
    return res.status(status).json({ ok: false, error: String(err?.message || err).slice(0, 300), code: status === 403 ? 'permission-denied' : 'internal' });
  }
}
