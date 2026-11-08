// Firestore-compatible data layer backed by MongoDB.
//
// The LINKUP server (api/*.js, shared builders) was written against the
// Firebase Admin Firestore API: collection().doc().get()/set()/update(),
// where/orderBy/limit queries, runTransaction and writeBatch. Rather than
// rewriting 51 endpoints, this module implements that exact surface on top
// of the MongoDB driver. api/_firebaseAdmin.js returns this implementation
// from getDb() when DATA_BACKEND=mongo, and the real Firestore otherwise,
// so cutover (and rollback) is a single environment variable.
//
// Deliberate semantic choices:
//  - Document ids stay Firestore ids (stored as the Mongo `_id`, a string),
//    so every deep link / notification / match id in the wild keeps working.
//  - Firestore Timestamps read back as FsTimestamp (toDate/toMillis/seconds),
//    the shape server code already calls.
//  - Subcollections are flattened: matches/{id}/messages lives in the
//    top-level `messages` collection with a `matchId` field (etc. below).
//  - FieldValue transforms (serverTimestamp, increment, arrayUnion,
//    arrayRemove, delete) are honoured, including the real firebase-admin
//    sentinels that api/_linky.js produces via getAdmin().firestore.FieldValue.
import { getMongoDb, getMongoClient } from './_mongo.js';

// ---------------------------------------------------------------- sentinels

export class FvSentinel {
  constructor(kind, payload = {}) {
    this.__fvKind = kind;
    this.kind = kind;
    Object.assign(this, payload);
  }
}

export const MongoFieldValue = {
  serverTimestamp: () => new FvSentinel('serverTimestamp'),
  delete: () => new FvSentinel('delete'),
  increment: (n) => new FvSentinel('increment', { operand: Number(n) || 0 }),
  arrayUnion: (...elements) => new FvSentinel('arrayUnion', { elements }),
  arrayRemove: (...elements) => new FvSentinel('arrayRemove', { elements }),
};

export function mongoServerTimestamp() {
  return MongoFieldValue.serverTimestamp();
}

// Translate a real firebase-admin FieldValue sentinel (or one of ours, or a
// wire-decoded client sentinel) into an FvSentinel. Returns null otherwise.
export function asSentinel(value) {
  if (value instanceof FvSentinel) return value;
  if (value && typeof value === 'object' && typeof value.methodName === 'string') {
    switch (value.methodName) {
      case 'FieldValue.serverTimestamp': return MongoFieldValue.serverTimestamp();
      case 'FieldValue.delete': return MongoFieldValue.delete();
      case 'FieldValue.increment': return MongoFieldValue.increment(value.operand);
      case 'FieldValue.arrayUnion': return MongoFieldValue.arrayUnion(...(value.elements || []));
      case 'FieldValue.arrayRemove': return MongoFieldValue.arrayRemove(...(value.elements || []));
      default: return null;
    }
  }
  return null;
}

// ------------------------------------------------------------------- types

export class FsTimestamp {
  constructor(millis) {
    const ms = Math.trunc(Number(millis) || 0);
    this._seconds = Math.floor(ms / 1000);
    this._nanoseconds = (ms - this._seconds * 1000) * 1e6;
  }
  get seconds() { return this._seconds; }
  get nanoseconds() { return this._nanoseconds; }
  toMillis() { return this._seconds * 1000 + Math.round(this._nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
  toJSON() { return this.toDate().toISOString(); }
  valueOf() { return this.toMillis(); }
  static fromDate(d) { return new FsTimestamp(d instanceof Date ? d.getTime() : Number(d)); }
  static now() { return new FsTimestamp(Date.now()); }
}

export class FsGeoPoint {
  constructor(latitude, longitude) {
    this._latitude = Number(latitude);
    this._longitude = Number(longitude);
  }
  get latitude() { return this._latitude; }
  get longitude() { return this._longitude; }
  toJSON() { return { latitude: this._latitude, longitude: this._longitude }; }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    !(v instanceof Date) && !(v instanceof FvSentinel);
}

// ------------------------------------------------------------- conversions

// Client/app value -> value stored in Mongo. Sentinels are NOT resolved
// here (they become update operators); a bare serverTimestamp/delete in a
// plain value position resolves to a Date / the DELETE marker.
const DELETE_MARKER = Symbol('firestore-delete');

export function toMongoValue(value) {
  const sentinel = asSentinel(value);
  if (sentinel) {
    if (sentinel.kind === 'serverTimestamp') return new Date();
    if (sentinel.kind === 'delete') return DELETE_MARKER;
    return value; // increment/array ops leak through only inside update ops
  }
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof FsTimestamp) return value.toDate();
  // firebase-admin / web Timestamp instances
  if (typeof value === 'object' && typeof value.toDate === 'function' &&
      typeof value._seconds === 'number') {
    return new Date(value.toDate().getTime());
  }
  // GeoPoint (admin: _latitude/_longitude; web: latitude/longitude only)
  if (typeof value === 'object' &&
      typeof value._latitude === 'number' && typeof value._longitude === 'number') {
    return { type: 'Point', coordinates: [value._longitude, value._latitude] };
  }
  if (isPlainObject(value) && Object.keys(value).length > 0 &&
      Object.keys(value).every((k) => k === 'latitude' || k === 'longitude') &&
      typeof value.latitude === 'number' && typeof value.longitude === 'number') {
    return { type: 'Point', coordinates: [value.longitude, value.latitude] };
  }
  // DocumentReference-like -> its path string
  if (typeof value === 'object' && typeof value.path === 'string' &&
      typeof value.id === 'string' && ('firestore' in value || value.constructor?.name === 'DocumentReference')) {
    return value.path;
  }
  if (Array.isArray(value)) return value.map((v) => toMongoValue(v));
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const mv = toMongoValue(v);
      if (mv !== undefined && mv !== DELETE_MARKER) out[k] = mv;
    }
    return out;
  }
  return value;
}

// Mongo value -> value handed back to app code.
export function fromMongoValue(value) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return new FsTimestamp(value.getTime());
  if (Array.isArray(value)) return value.map((v) => fromMongoValue(v));
  if (typeof value === 'object') {
    if (value.type === 'Point' && Array.isArray(value.coordinates) &&
        Object.keys(value).length === 2) {
      return new FsGeoPoint(value.coordinates[1], value.coordinates[0]);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = fromMongoValue(v);
    return out;
  }
  return value;
}

// Flatten a write payload into [dotPath, rawValue] pairs, descending into
// plain objects (Firestore update/set-merge are field-path operations) but
// never into arrays, Dates or sentinels.
function flatten(data, prefix = '', out = []) {
  for (const [k, v] of Object.entries(data || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && !asSentinel(v) && Object.keys(v).length > 0) {
      flatten(v, path, out);
    } else {
      out.push([path, v]);
    }
  }
  return out;
}

// Build a Mongo update document from a Firestore-style write payload.
export function buildUpdate(data, { inject = {} } = {}) {
  const $set = {};
  const $unset = {};
  const $inc = {};
  const $addToSet = {};
  const $pull = {};
  for (const [k, v] of Object.entries(inject)) $set[k] = v;
  for (const [path, raw] of flatten(data)) {
    const sentinel = asSentinel(raw);
    if (sentinel) {
      if (sentinel.kind === 'serverTimestamp') $set[path] = new Date();
      else if (sentinel.kind === 'delete') $unset[path] = '';
      else if (sentinel.kind === 'increment') $inc[path] = sentinel.operand;
      else if (sentinel.kind === 'arrayUnion') {
        const items = sentinel.elements.map((e) => toMongoValue(e));
        $addToSet[path] = items.length === 1 ? items[0] : { $each: items };
      } else if (sentinel.kind === 'arrayRemove') {
        const items = sentinel.elements.map((e) => toMongoValue(e));
        $pull[path] = items.length === 1 ? items[0] : { $in: items };
      }
      continue;
    }
    const mv = toMongoValue(raw);
    if (mv === DELETE_MARKER) { $unset[path] = ''; continue; }
    if (mv !== undefined) $set[path] = mv;
  }
  const update = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  if (Object.keys($inc).length) update.$inc = $inc;
  if (Object.keys($addToSet).length) update.$addToSet = $addToSet;
  if (Object.keys($pull).length) update.$pull = $pull;
  return update;
}

// Whole-document value for a non-merge set (sentinels resolved naively:
// serverTimestamp -> now, increment -> the operand, unions -> the array).
export function buildDocument(data, { inject = {} } = {}) {
  const doc = {};
  for (const [k, v] of Object.entries(inject)) doc[k] = v;
  for (const [path, raw] of flatten(data)) {
    const sentinel = asSentinel(raw);
    let mv;
    if (sentinel) {
      if (sentinel.kind === 'serverTimestamp') mv = new Date();
      else if (sentinel.kind === 'delete') continue;
      else if (sentinel.kind === 'increment') mv = sentinel.operand;
      else if (sentinel.kind === 'arrayUnion') mv = sentinel.elements.map((e) => toMongoValue(e));
      else if (sentinel.kind === 'arrayRemove') mv = [];
      else continue;
    } else {
      mv = toMongoValue(raw);
      if (mv === DELETE_MARKER || mv === undefined) continue;
    }
    const parts = path.split('.');
    let cursor = doc;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!isPlainObject(cursor[parts[i]])) cursor[parts[i]] = {};
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = mv;
  }
  return doc;
}

// ------------------------------------------------------------ subcollection
// Firestore subcollections become top-level Mongo collections keyed by a
// parent field. Key is "<parentCollection>/<subcollection>".
const SUBCOLLECTIONS = {
  'matches/messages': { collection: 'messages', field: 'matchId' },
  'builderRooms/messages': { collection: 'roomMessages', field: 'roomId' },
  'posts/comments': { collection: 'postComments', field: 'postId' },
  'comments/replies': { collection: 'postReplies', field: 'commentId' },
};

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function autoId() {
  let id = '';
  for (let i = 0; i < 20; i++) id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return id;
}

// --------------------------------------------------------------- snapshots

export class DocumentSnapshot {
  constructor(ref, raw) {
    this.ref = ref;
    this.id = ref.id;
    this._raw = raw || null;
  }
  get exists() { return this._raw !== null; }
  data() {
    if (!this._raw) return undefined;
    const { _id, ...rest } = this._raw;
    return fromMongoValue(rest);
  }
  get(fieldPath) {
    const data = this.data();
    if (data === undefined) return undefined;
    return String(fieldPath).split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), data);
  }
}

export class QuerySnapshot {
  constructor(docs, query) {
    this.docs = docs;
    this.query = query || null;
  }
  get empty() { return this.docs.length === 0; }
  get size() { return this.docs.length; }
  forEach(cb) { this.docs.forEach(cb); }
}

// ------------------------------------------------------------------- query

const OPERATORS = {
  '==': (f, v) => ({ [f]: v === null ? { $eq: null } : v }),
  '!=': (f, v) => ({ [f]: { $ne: v } }),
  '<': (f, v) => ({ [f]: { $lt: v } }),
  '<=': (f, v) => ({ [f]: { $lte: v } }),
  '>': (f, v) => ({ [f]: { $gt: v } }),
  '>=': (f, v) => ({ [f]: { $gte: v } }),
  'in': (f, v) => ({ [f]: { $in: v } }),
  'not-in': (f, v) => ({ [f]: { $nin: v } }),
  'array-contains': (f, v) => ({ [f]: v }),
  'array-contains-any': (f, v) => ({ [f]: { $in: v } }),
};

export function fieldName(field) {
  if (typeof field === 'string') return field === '__name__' ? '_id' : field;
  if (field && typeof field.path === 'string') return field.path === '__name__' ? '_id' : field.path;
  if (field && Array.isArray(field._segments)) return field._segments.join('.') === '__name__' ? '_id' : field._segments.join('.');
  return String(field);
}

export function buildFilter(filters, parentConstraints = []) {
  const parts = [];
  for (const c of parentConstraints) parts.push({ [c.field]: c.value });
  for (const f of filters) {
    const fn = OPERATORS[f.op];
    if (!fn) throw new Error(`Unsupported where operator: ${f.op}`);
    parts.push(fn(fieldName(f.field), toMongoValue(f.value)));
  }
  if (!parts.length) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts };
}

export class Query {
  constructor(db, collectionName, state = {}) {
    this._db = db;
    this._collection = collectionName;
    this._filters = state.filters || [];
    this._orders = state.orders || [];
    this._limit = state.limit ?? null;
    this._limitToLast = state.limitToLast || false;
    this._cursor = state.cursor || null; // {values: [...], id}
    this._parentConstraints = state.parentConstraints || [];
    this._projection = state.projection ?? undefined; // undefined = all fields
    this._offset = state.offset ?? null;
  }

  _clone(patch) {
    return new Query(this._db, this._collection, {
      filters: this._filters, orders: this._orders, limit: this._limit,
      limitToLast: this._limitToLast, cursor: this._cursor,
      parentConstraints: this._parentConstraints,
      projection: this._projection, offset: this._offset, ...patch,
    });
  }

  // Firestore select(): no fields = keys-only snapshots; otherwise a field
  // projection. Either way the snapshot data() carries only those fields.
  select(...fields) {
    const flat = fields.flat().map((f) => String(f));
    return this._clone({ projection: flat });
  }
  offset(n) { return this._clone({ offset: Math.max(0, Number(n) || 0) }); }

  where(field, op, value) {
    return this._clone({ filters: [...this._filters, { field, op, value }] });
  }
  orderBy(field, dir = 'asc') {
    return this._clone({ orders: [...this._orders, { field: fieldName(field), dir: dir === 'desc' ? -1 : 1 }] });
  }
  limit(n) { return this._clone({ limit: Number(n), limitToLast: false }); }
  limitToLast(n) { return this._clone({ limit: Number(n), limitToLast: true }); }

  _cursorOf(args) {
    const first = args[0];
    if (first instanceof DocumentSnapshot) {
      const data = first.data() || {};
      const values = this._orders.map((o) => {
        if (o.field === '_id') return first.id;
        return o.field.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), data);
      });
      return { values, id: first.id };
    }
    return { values: args, id: undefined };
  }
  startAfter(...args) { return this._clone({ cursor: { kind: 'after', ...this._cursorOf(args) } }); }
  startAt(...args) { return this._clone({ cursor: { kind: 'at', ...this._cursorOf(args) } }); }
  endBefore(...args) { return this._clone({ cursor: { kind: 'before', ...this._cursorOf(args) } }); }
  endAt(...args) { return this._clone({ cursor: { kind: 'endAt', ...this._cursorOf(args) } }); }

  _sortSpec() {
    const spec = {};
    for (const o of this._orders) spec[o.field] = o.dir;
    if (!('_id' in spec)) spec._id = this._orders.length ? this._orders[this._orders.length - 1].dir : 1;
    return spec;
  }

  _cursorFilter() {
    if (!this._cursor) return null;
    const { kind, values, id } = this._cursor;
    const orders = [...this._orders];
    if (!orders.length) {
      if (id === undefined) return null;
      if (kind === 'after') return { _id: { $gt: id } };
      if (kind === 'at') return { _id: { $gte: id } };
      if (kind === 'before') return { _id: { $lt: id } };
      return { _id: { $lte: id } };
    }
    // Lexicographic comparison over (orderFields..., _id), Firestore-style.
    const fields = [...orders.map((o) => o.field), '_id'];
    const vals = [...values];
    if (vals.length < fields.length) vals.push(id);
    const dirs = [...orders.map((o) => o.dir), orders[orders.length - 1].dir];
    const strict = kind === 'after' || kind === 'before';
    const forward = kind === 'after' || kind === 'at';
    const ors = [];
    for (let i = 0; i < fields.length; i++) {
      const cmp = {};
      for (let j = 0; j < i; j++) cmp[fields[j]] = toMongoValue(vals[j]);
      const dir = dirs[i];
      const after = (dir === 1) === forward;
      let op;
      if (strict || i < fields.length - 1) op = after ? '$gt' : '$lt';
      else op = after ? '$gte' : '$lte';
      cmp[fields[i]] = { [op]: toMongoValue(vals[i]) };
      ors.push(cmp);
    }
    return { $or: ors };
  }

  async _run({ session } = {}) {
    const mongo = await this._db._mongo();
    const filter = buildFilter(this._filters, this._parentConstraints);
    const cursorFilter = this._cursorFilter();
    const finalFilter = cursorFilter
      ? (Object.keys(filter).length ? { $and: [filter, cursorFilter] } : cursorFilter)
      : filter;
    let sort = this._sortSpec();
    if (this._limitToLast && this._limit != null) {
      sort = Object.fromEntries(Object.entries(sort).map(([k, v]) => [k, -v]));
    }
    let cursor = mongo.collection(this._collection).find(finalFilter, { session });
    if (this._projection !== undefined) {
      if (!this._projection.length) cursor = cursor.project({ _id: 1 });
      else {
        const projection = { _id: 1 };
        for (const f of this._projection) projection[f] = 1;
        cursor = cursor.project(projection);
      }
    }
    cursor = cursor.sort(sort);
    if (this._offset) cursor = cursor.skip(this._offset);
    if (this._limit != null) cursor = cursor.limit(this._limit);
    const raws = await cursor.toArray();
    if (this._limitToLast) raws.reverse();
    const collRef = new CollectionRef(this._db, this._collection, this._parentConstraints);
    return raws.map((raw) => new DocumentSnapshot(new DocumentRef(this._db, [...this._pathPrefix(), raw._id], this._parentConstraints), raw));
  }

  // Path segments above the collection itself (for rebuilding doc refs).
  _pathPrefix() { return this._prefixSegments || [this._collection]; }

  async get(options = {}) {
    const docs = await this._run(options);
    return new QuerySnapshot(docs, this);
  }

  count() {
    const self = this;
    return {
      async get({ session } = {}) {
        const mongo = await self._db._mongo();
        const filter = buildFilter(self._filters, self._parentConstraints);
        const n = await mongo.collection(self._collection).countDocuments(filter, { session });
        return { data: () => ({ count: n }) };
      },
    };
  }

  onSnapshot() {
    throw new Error('onSnapshot is not supported by the Mongo server adapter (server code must poll).');
  }
}

// -------------------------------------------------------------- references

export class DocumentRef {
  // segments: full Firestore-style path, e.g. ['matches', id, 'messages', mid]
  // mongoCollection/constraints: where the doc physically lives.
  constructor(db, segments, parentConstraints = [], physical = null) {
    this._db = db;
    this._segments = segments;
    this.id = segments[segments.length - 1];
    this._parentConstraints = parentConstraints;
    this._physical = physical || null; // {collection, constraints}
  }

  get path() { return this._segments.join('/'); }

  get parent() {
    const parentSegments = this._segments.slice(0, -1);
    const phys = this._physicalCollection();
    return new CollectionRef(this._db, null, this._parentConstraints, {
      collection: phys.collection,
      constraints: phys.constraints,
      segments: parentSegments,
    });
  }

  _physicalCollection() {
    if (this._physical) return this._physical;
    if (this._segments.length === 2) {
      return { collection: this._segments[0], constraints: this._parentConstraints };
    }
    // Doc inside a subcollection: physical collection comes from its parent.
    const parentCollName = this._segments[this._segments.length - 4];
    const ownCollName = this._segments[this._segments.length - 2];
    const mapped = SUBCOLLECTIONS[`${parentCollName}/${ownCollName}`];
    if (mapped) return { collection: mapped.collection, constraints: this._parentConstraints };
    return { collection: ownCollName, constraints: this._parentConstraints };
  }

  collection(subName) {
    const parentCollName = this._segments[this._segments.length - 2];
    const mapped = SUBCOLLECTIONS[`${parentCollName}/${subName}`];
    const constraints = [...this._parentConstraints];
    let physicalName = subName;
    if (mapped) {
      constraints.push({ field: mapped.field, value: this.id });
      physicalName = mapped.collection;
    }
    const ref = new CollectionRef(this._db, null, constraints, {
      collection: physicalName,
      constraints,
      segments: [...this._segments, subName],
    });
    return ref;
  }

  _filter() {
    const { constraints } = this._physicalCollection();
    const filter = { _id: this.id };
    for (const c of constraints) filter[c.field] = c.value;
    return filter;
  }

  _inject() {
    const { constraints } = this._physicalCollection();
    const inject = {};
    for (const c of constraints) inject[c.field] = c.value;
    return inject;
  }

  async _collectionHandle(session) {
    const mongo = await this._db._mongo();
    return mongo.collection(this._physicalCollection().collection);
  }

  async get({ session } = {}) {
    const coll = await this._collectionHandle(session);
    const raw = await coll.findOne(this._filter(), { session });
    return new DocumentSnapshot(this, raw);
  }

  async set(data, options = {}, { session } = {}) {
    const coll = await this._collectionHandle(session);
    const inject = this._inject();
    if (options && options.merge) {
      const update = buildUpdate(data, { inject });
      if (!Object.keys(update).length) return;
      await coll.updateOne(this._filter(), update, { upsert: true, session });
    } else {
      const doc = { _id: this.id, ...buildDocument(data, { inject }) };
      await coll.replaceOne(this._filter(), doc, { upsert: true, session });
    }
  }

  async update(data, { session } = {}) {
    const coll = await this._collectionHandle(session);
    const update = buildUpdate(data, {});
    if (!Object.keys(update).length) return;
    const res = await coll.updateOne(this._filter(), update, { session });
    if (res.matchedCount === 0) {
      const err = new Error(`No document to update: ${this.path}`);
      err.code = 5;
      throw err;
    }
  }

  async delete({ session } = {}) {
    const coll = await this._collectionHandle(session);
    await coll.deleteOne(this._filter(), { session });
  }
}

export class CollectionRef extends Query {
  // `physical`, when given, is { collection, constraints, segments }:
  // the Mongo collection the ref lands in, the parent constraints to
  // scope by, and the Firestore-style path segments for display/refs.
  constructor(db, collectionName, parentConstraints = [], physical = null) {
    const physicalInfo = physical || {
      collection: collectionName,
      constraints: parentConstraints,
      segments: [collectionName],
    };
    super(db, physicalInfo.collection, { parentConstraints: physicalInfo.constraints });
    this._logicalName = collectionName || physicalInfo.segments[physicalInfo.segments.length - 1];
    this._segments = physicalInfo.segments;
    this._prefixSegments = this._segments;
    this.id = this._logicalName;
    this.path = this._segments.join('/');
  }

  doc(id) {
    const docId = id === undefined || id === null || id === '' ? autoId() : String(id);
    return new DocumentRef(this._db, [...this._segments, docId], this._parentConstraints);
  }

  async add(data) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

// ------------------------------------------------------- batch / transaction

export class WriteBatch {
  constructor(db) {
    this._db = db;
    this._ops = [];
  }
  set(ref, data, options) { this._ops.push(() => ref.set(data, options)); return this; }
  update(ref, data) { this._ops.push(() => ref.update(data)); return this; }
  delete(ref) { this._ops.push(() => ref.delete()); return this; }
  create(ref, data) { this._ops.push(() => ref.set(data)); return this; }
  async commit() {
    for (const op of this._ops) await op();
    this._ops = [];
  }
}

class Transaction {
  constructor(db, session) {
    this._db = db;
    this._session = session;
    this._writes = [];
  }
  async get(refOrQuery) {
    if (refOrQuery instanceof DocumentRef) return refOrQuery.get({ session: this._session });
    if (refOrQuery instanceof Query) return refOrQuery.get({ session: this._session });
    throw new Error('Transaction.get expects a DocumentRef or Query.');
  }
  set(ref, data, options) { this._writes.push(() => ref.set(data, options, { session: this._session })); return this; }
  update(ref, data) { this._writes.push(() => ref.update(data, { session: this._session })); return this; }
  delete(ref) { this._writes.push(() => ref.delete({ session: this._session })); return this; }
  create(ref, data) { this._writes.push(() => ref.set(data, undefined, { session: this._session })); return this; }
  async _flush() {
    const writes = this._writes;
    this._writes = [];
    for (const w of writes) await w();
  }
}

// --------------------------------------------------------------------- db

export class MongoFirestore {
  constructor() {
    this._dbPromise = null;
  }

  async _mongo() {
    if (!this._dbPromise) this._dbPromise = getMongoDb();
    return this._dbPromise;
  }

  collection(name) {
    return new CollectionRef(this, String(name));
  }

  doc(path) {
    const segments = String(path).split('/').filter(Boolean);
    if (segments.length % 2 !== 0) throw new Error(`Invalid document path: ${path}`);
    // Rebuild constraints by walking the path.
    let constraints = [];
    let ref = new DocumentRef(this, segments.slice(0, 2), []);
    if (segments.length === 2) return ref;
    // Walk subcollection segments to accumulate parent constraints.
    let current = ref;
    for (let i = 2; i < segments.length; i += 2) {
      const collRef = current.collection(segments[i]);
      constraints = collRef._parentConstraints;
      current = collRef.doc(segments[i + 1]);
    }
    return current;
  }

  batch() { return new WriteBatch(this); }

  // Firestore getAll(...refs[, {fieldMask}]): order-preserving batch read.
  // fieldMask is accepted and ignored (full documents are cheap at our scale).
  async getAll(...args) {
    const refs = args.filter((a) => a instanceof DocumentRef);
    const out = [];
    for (const ref of refs) out.push(await ref.get());
    return out;
  }

  async runTransaction(fn, options = {}) {
    const client = await getMongoClient();
    const session = client.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const tx = new Transaction(this, session);
        result = await fn(tx);
        await tx._flush();
      }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        maxCommitTimeMS: 10_000,
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  collectionGroup() {
    throw new Error('collectionGroup is not supported by the Mongo adapter.');
  }
}
