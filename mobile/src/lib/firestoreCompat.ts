// Drop-in replacement for the 'firebase/firestore' import.
//
// When EXPO_PUBLIC_DATA_BACKEND=mongo, every Firestore-shaped call the app
// makes (collection/doc/getDoc/getDocs/setDoc/updateDoc/addDoc/deleteDoc/
// onSnapshot/writeBatch, where/orderBy/limit queries, cursors, and the
// serverTimestamp/increment/arrayUnion/arrayRemove/deleteField sentinels)
// is sent to POST /api/db, which executes it against MongoDB. Firebase Auth
// is untouched — requests carry the member's Firebase ID token.
//
// When the flag is unset, this module re-exports the real Firestore SDK, so
// the same build can be rolled back to Firestore by rebuilding without the
// flag. Realtime is preserved as fast polling (5s) with change detection:
// a listener only fires when the encoded result actually changed.
import * as real from 'firebase/firestore';
import { Platform } from 'react-native';
import { auth } from './firebase';
import { webAppPath } from './webPaths';
import { linkupWebBaseUrl } from './profileLinks';

const USE_MONGO = String(process.env.EXPO_PUBLIC_DATA_BACKEND || '').trim().toLowerCase() === 'mongo';

const endpoint = () => (Platform.OS === 'web' ? webAppPath('/api/db') : `${linkupWebBaseUrl()}/api/db`);

// ------------------------------------------------------------------ types

export class CompatTimestamp {
  seconds: number;
  nanoseconds: number;
  constructor(seconds: number, nanoseconds = 0) {
    this.seconds = Math.floor(seconds);
    this.nanoseconds = Math.floor(nanoseconds);
  }
  toMillis() { return this.seconds * 1000 + Math.round(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
  toJSON() { return this.toDate().toISOString(); }
  valueOf() { return this.toMillis(); }
  static now() { const ms = Date.now(); return new CompatTimestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
  static fromMillis(ms: number) { return new CompatTimestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
  static fromDate(d: Date) { return CompatTimestamp.fromMillis(d.getTime()); }
}

export class CompatFieldPath {
  segments: string[];
  constructor(...segments: string[]) { this.segments = segments.map(String); }
  static documentId() { return DOC_ID_PATH; }
}
const DOC_ID_PATH = { __docIdPath: true } as any;

const isDocIdPath = (f: any) => !!f && typeof f === 'object' && f.__docIdPath === true;
const fieldString = (f: any): string => {
  if (typeof f === 'string') return f;
  if (isDocIdPath(f)) return '__name__';
  if (f instanceof CompatFieldPath) return f.segments.join('.');
  if (f && Array.isArray(f.segments)) return f.segments.join('.');
  return String(f);
};

// -------------------------------------------------------------- wire codec

const FV = (kind: string, extra: Record<string, unknown> = {}) => ({ __fvKind: kind, ...extra });

function encodeValue(v: any): any {
  if (v === null || v === undefined) return v ?? null;
  if (v && typeof v === 'object' && typeof v.__fvKind === 'string') {
    switch (v.__fvKind) {
      case 'serverTimestamp': return { $fv: 'serverTimestamp' };
      case 'deleteField': return { $fv: 'deleteField' };
      case 'increment': return { $fv: 'increment', n: v.n };
      case 'arrayUnion': return { $fv: 'arrayUnion', items: (v.items || []).map(encodeValue) };
      case 'arrayRemove': return { $fv: 'arrayRemove', items: (v.items || []).map(encodeValue) };
      default: return v;
    }
  }
  if (v instanceof CompatTimestamp) return { $t: v.toMillis() };
  if (v instanceof Date) return { $t: v.getTime() };
  // Real Firestore Timestamp / GeoPoint instances
  if (typeof v?.toMillis === 'function' && typeof v?.seconds === 'number') return { $t: v.toMillis() };
  if (typeof v?.latitude === 'number' && typeof v?.longitude === 'number' &&
      Object.keys(v).every((k) => ['latitude', 'longitude', '_latitude', '_longitude'].includes(k))) {
    return { $geo: [v.latitude, v.longitude] };
  }
  if (v?.__fsRef === 'doc') return { $ref: v.segments.join('/') };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined) continue;
      out[k] = encodeValue(x);
    }
    return out;
  }
  return v;
}

function decodeValue(v: any): any {
  if (Array.isArray(v)) return v.map(decodeValue);
  if (v && typeof v === 'object') {
    if (typeof v.$t === 'number') return CompatTimestamp.fromMillis(v.$t);
    if (Array.isArray(v.$geo)) return { latitude: v.$geo[0], longitude: v.$geo[1] };
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = decodeValue(x);
    return out;
  }
  return v;
}

// ------------------------------------------------------------------- refs

type Ref = { __fsRef: 'doc' | 'collection'; segments: string[] };
const isRef = (x: any): x is Ref => !!x && typeof x === 'object' && (x.__fsRef === 'doc' || x.__fsRef === 'collection');

function baseSegments(parent: any): string[] {
  if (isRef(parent)) return [...parent.segments];
  return []; // the Firestore `db` handle (or anything else) starts a root path
}

function shimCollection(parent: any, ...segs: any[]): Ref {
  const segments = [...baseSegments(parent), ...segs.map(String)];
  return { __fsRef: 'collection', segments };
}
function shimDoc(parent: any, ...segs: any[]): Ref {
  if (segs.length === 1 && isRef(parent) && parent.__fsRef === 'collection') {
    return { __fsRef: 'doc', segments: [...parent.segments, String(segs[0])] };
  }
  const segments = [...baseSegments(parent), ...segs.map(String)];
  return { __fsRef: 'doc', segments };
}

// -------------------------------------------------------------- transport

async function callDb(op: Record<string, unknown>): Promise<any> {
  const user = auth.currentUser;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) {
    try { headers.Authorization = `Bearer ${await user.getIdToken()}`; } catch { /* anonymous op */ }
  }
  const response = await fetch(endpoint(), { method: 'POST', headers, body: JSON.stringify(op) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const err: any = new Error(String(data?.error || `Database request failed (${response.status}).`));
    err.code = data?.code || (response.status === 403 ? 'permission-denied' : 'unavailable');
    err.status = response.status;
    throw err;
  }
  return data.result;
}

// --------------------------------------------------------------- snapshots

class CompatDocSnapshot {
  id: string;
  ref: Ref;
  private _exists: boolean;
  private _data: any;
  _encoded: any;
  constructor(ref: Ref, payload: { exists: boolean; id?: string; data?: any }) {
    this.ref = ref;
    this.id = payload.id || ref.segments[ref.segments.length - 1];
    this._exists = payload.exists;
    this._encoded = payload.exists ? payload.data : undefined;
    this._data = payload.exists ? decodeValue(payload.data) : undefined;
  }
  exists() { return this._exists; }
  data() { return this._data; }
  get(fieldPath: any) {
    if (this._data === undefined) return undefined;
    return fieldString(fieldPath).split('.').reduce((acc: any, k: string) => (acc == null ? undefined : acc[k]), this._data);
  }
}

class CompatQuerySnapshot {
  docs: CompatDocSnapshot[];
  constructor(docs: CompatDocSnapshot[]) { this.docs = docs; }
  get empty() { return this.docs.length === 0; }
  get size() { return this.docs.length; }
  forEach(cb: (d: CompatDocSnapshot) => void) { this.docs.forEach(cb); }
  docChanges() { return []; }
}

// ---------------------------------------------------------------- queries

type Constraint = Record<string, any>;

const shimWhere = (field: any, op: string, value: any): Constraint => ({ t: 'where', f: fieldString(field), op, v: encodeValue(value) });
const shimOrderBy = (field: any, dir: string = 'asc'): Constraint => ({ t: 'orderBy', f: fieldString(field), dir });
const shimLimit = (n: number): Constraint => ({ t: 'limit', n });
const shimLimitToLast = (n: number): Constraint => ({ t: 'limitToLast', n });

function cursorConstraint(kind: string, snapOrValue: any, rest: any[]): Constraint {
  const first = snapOrValue;
  if (first instanceof CompatDocSnapshot) {
    return { t: kind, id: first.id, docData: first._encoded };
  }
  return { t: kind, values: [first, ...rest].map(encodeValue) };
}
const shimStartAfter = (...args: any[]): Constraint => cursorConstraint('startAfter', args[0], args.slice(1));
const shimStartAt = (...args: any[]): Constraint => cursorConstraint('startAt', args[0], args.slice(1));
const shimEndBefore = (...args: any[]): Constraint => cursorConstraint('endBefore', args[0], args.slice(1));
const shimEndAt = (...args: any[]): Constraint => cursorConstraint('endAt', args[0], args.slice(1));

function shimQuery(ref: Ref, ...constraints: Constraint[]) {
  return { __fsRef: 'query', ref, constraints };
}

function targetOf(target: any): { segments: string[]; constraints: Constraint[]; isDoc: boolean } {
  if (isRef(target)) return { segments: target.segments, constraints: [], isDoc: target.__fsRef === 'doc' };
  if (target?.__fsRef === 'query') return { segments: target.ref.segments, constraints: target.constraints, isDoc: false };
  throw new Error('Unsupported Firestore target.');
}

// ------------------------------------------------------------------- CRUD

async function shimGetDoc(ref: Ref): Promise<CompatDocSnapshot> {
  const result = await callDb({ kind: 'getDoc', path: ref.segments });
  return new CompatDocSnapshot(ref, result);
}

async function shimGetDocs(target: any): Promise<CompatQuerySnapshot> {
  const { segments, constraints } = targetOf(target);
  const result = await callDb({ kind: 'getDocs', path: segments, constraints });
  const docs = (result.docs || []).map((d: any) => new CompatDocSnapshot(
    { __fsRef: 'doc', segments: [...segments, d.id] }, { exists: true, id: d.id, data: d.data },
  ));
  return new CompatQuerySnapshot(docs);
}

async function shimGetCount(target: any): Promise<any> {
  const { segments, constraints } = targetOf(target);
  const result = await callDb({ kind: 'count', path: segments, constraints });
  return { data: () => ({ count: Number(result?.count || 0) }) };
}

async function shimSetDoc(ref: Ref, data: any, options?: any): Promise<void> {
  await callDb({ kind: 'set', path: ref.segments, data: encodeValue(data), merge: !!options?.merge });
}
async function shimUpdateDoc(ref: Ref, ...args: any[]): Promise<void> {
  let data: Record<string, any>;
  if (args.length === 1 && args[0] && typeof args[0] === 'object') {
    data = args[0];
  } else {
    data = {};
    for (let i = 0; i + 1 < args.length; i += 2) data[fieldString(args[i])] = args[i + 1];
  }
  await callDb({ kind: 'update', path: ref.segments, data: encodeValue(data) });
}
async function shimAddDoc(collRef: Ref, data: any): Promise<Ref> {
  const result = await callDb({ kind: 'add', path: collRef.segments, data: encodeValue(data) });
  return { __fsRef: 'doc', segments: [...collRef.segments, String(result.id)] };
}
async function shimDeleteDoc(ref: Ref): Promise<void> {
  await callDb({ kind: 'delete', path: ref.segments });
}

function shimWriteBatch(): any {
  const ops: Record<string, unknown>[] = [];
  const batch = {
    set(ref: Ref, data: any, options?: any) { ops.push({ kind: 'set', path: ref.segments, data: encodeValue(data), merge: !!options?.merge }); return batch; },
    update(ref: Ref, data: any) { ops.push({ kind: 'update', path: ref.segments, data: encodeValue(data) }); return batch; },
    delete(ref: Ref) { ops.push({ kind: 'delete', path: ref.segments }); return batch; },
    async commit() { await callDb({ kind: 'batch', ops }); },
  };
  return batch;
}

// -------------------------------------------------------------- listeners

function shimOnSnapshot(target: any, ...args: any[]): () => void {
  const onNext = args.find((a) => typeof a === 'function');
  const onError = args.filter((a) => typeof a === 'function')[1];
  const { isDoc } = targetOf(target);
  let stopped = false;
  let lastJson = '';
  const poll = async () => {
    if (stopped) return;
    try {
      if (isDoc) {
        const snap = await shimGetDoc(target as Ref);
        const json = JSON.stringify(snap._encoded ?? null);
        if (!stopped && json !== lastJson) { lastJson = json; onNext?.(snap); }
      } else {
        const snap = await shimGetDocs(target);
        const json = JSON.stringify(snap.docs.map((d) => [d.id, d._encoded]));
        if (!stopped && json !== lastJson) { lastJson = json; onNext?.(snap); }
      }
    } catch (e) {
      if (!stopped && onError) onError(e);
    }
  };
  void poll();
  const timer = setInterval(() => void poll(), 5000);
  return () => { stopped = true; clearInterval(timer); };
}

// --------------------------------------------------------------- sentinels

const shimServerTimestamp = () => FV('serverTimestamp');
const shimDeleteField = () => FV('deleteField');
const shimIncrement = (n: number) => FV('increment', { n: Number(n) || 0 });
const shimArrayUnion = (...items: any[]) => FV('arrayUnion', { items: items.map(encodeValue) });
const shimArrayRemove = (...items: any[]) => FV('arrayRemove', { items: items.map(encodeValue) });

const FieldValueCompat = {
  serverTimestamp: shimServerTimestamp, delete: shimDeleteField,
  increment: shimIncrement, arrayUnion: shimArrayUnion, arrayRemove: shimArrayRemove,
};

// ----------------------------------------------------------------- exports

export const collection: typeof real.collection = (USE_MONGO ? shimCollection : (real as any).collection) as any;
export const doc: typeof real.doc = (USE_MONGO ? shimDoc : (real as any).doc) as any;
export const query: typeof real.query = (USE_MONGO ? shimQuery : (real as any).query) as any;
export const where: typeof real.where = (USE_MONGO ? shimWhere : (real as any).where) as any;
export const orderBy: typeof real.orderBy = (USE_MONGO ? shimOrderBy : (real as any).orderBy) as any;
export const limit: typeof real.limit = (USE_MONGO ? shimLimit : (real as any).limit) as any;
export const limitToLast: typeof real.limitToLast = (USE_MONGO ? shimLimitToLast : (real as any).limitToLast) as any;
export const startAfter: typeof real.startAfter = (USE_MONGO ? shimStartAfter : (real as any).startAfter) as any;
export const startAt: typeof real.startAt = (USE_MONGO ? shimStartAt : (real as any).startAt) as any;
export const endBefore: typeof real.endBefore = (USE_MONGO ? shimEndBefore : (real as any).endBefore) as any;
export const endAt: typeof real.endAt = (USE_MONGO ? shimEndAt : (real as any).endAt) as any;
export const getDoc: typeof real.getDoc = (USE_MONGO ? shimGetDoc : (real as any).getDoc) as any;
export const getDocs: typeof real.getDocs = (USE_MONGO ? shimGetDocs : (real as any).getDocs) as any;
export const getDocsFromCache: typeof real.getDocsFromCache = (USE_MONGO ? shimGetDocs : (real as any).getDocsFromCache) as any;
export const getDocFromCache: typeof real.getDocFromCache = (USE_MONGO ? shimGetDoc : (real as any).getDocFromCache) as any;
export const getCountFromServer: typeof real.getCountFromServer = (USE_MONGO ? shimGetCount : (real as any).getCountFromServer) as any;
export const setDoc: typeof real.setDoc = (USE_MONGO ? shimSetDoc : (real as any).setDoc) as any;
export const updateDoc: typeof real.updateDoc = (USE_MONGO ? shimUpdateDoc : (real as any).updateDoc) as any;
export const addDoc: typeof real.addDoc = (USE_MONGO ? shimAddDoc : (real as any).addDoc) as any;
export const deleteDoc: typeof real.deleteDoc = (USE_MONGO ? shimDeleteDoc : (real as any).deleteDoc) as any;
export const writeBatch: typeof real.writeBatch = (USE_MONGO ? shimWriteBatch : (real as any).writeBatch) as any;
export const onSnapshot: typeof real.onSnapshot = (USE_MONGO ? shimOnSnapshot : (real as any).onSnapshot) as any;

export const Timestamp: typeof real.Timestamp = (USE_MONGO ? CompatTimestamp : (real as any).Timestamp) as any;
export const FieldPath: typeof real.FieldPath = (USE_MONGO ? CompatFieldPath : (real as any).FieldPath) as any;
export const FieldValue: typeof real.FieldValue = (USE_MONGO ? FieldValueCompat : (real as any).FieldValue) as any;

// Standalone sentinel factories (the modern web SDK surface).
export const serverTimestamp: typeof real.serverTimestamp = (USE_MONGO ? shimServerTimestamp : (real as any).serverTimestamp) as any;
export const deleteField: typeof real.deleteField = (USE_MONGO ? shimDeleteField : (real as any).deleteField) as any;
export const increment: typeof real.increment = (USE_MONGO ? shimIncrement : (real as any).increment) as any;
export const arrayUnion: typeof real.arrayUnion = (USE_MONGO ? shimArrayUnion : (real as any).arrayUnion) as any;
export const arrayRemove: typeof real.arrayRemove = (USE_MONGO ? shimArrayRemove : (real as any).arrayRemove) as any;

// Convenience flag for callers that want to know which backend is live.
export const DATA_BACKEND_MONGO = USE_MONGO;
