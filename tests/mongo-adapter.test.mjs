// Unit tests for the MongoDB data layer (api/_mongoFirestore.js) and the
// client authorization policy (api/_dbPolicy.js). These cover the pure
// translation logic; live behaviour against Atlas is smoke-tested manually.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MongoFieldValue, asSentinel, buildUpdate, buildDocument, buildFilter,
  toMongoValue, fromMongoValue, FsTimestamp,
} from '../api/_mongoFirestore.js';
import { canWrite, canReadDoc } from '../api/_dbPolicy.js';

test('buildUpdate translates every FieldValue transform', () => {
  const u = buildUpdate({
    n: MongoFieldValue.increment(4),
    tags: MongoFieldValue.arrayUnion('b'),
    old: MongoFieldValue.arrayRemove('a'),
    gone: MongoFieldValue.delete(),
    plain: 7,
    nested: { deep: MongoFieldValue.increment(1) },
  });
  assert.equal(u.$inc.n, 4);
  assert.equal(u.$inc['nested.deep'], 1);
  assert.equal(u.$addToSet.tags, 'b');
  assert.equal(u.$pull.old, 'a');
  assert.ok('gone' in u.$unset);
  assert.equal(u.$set.plain, 7);
});

test('buildUpdate translates real firebase-admin sentinels (methodName shape)', () => {
  const u = buildUpdate({
    n: { methodName: 'FieldValue.increment', operand: 10 },
    at: { methodName: 'FieldValue.serverTimestamp' },
    gone: { methodName: 'FieldValue.delete' },
    tags: { methodName: 'FieldValue.arrayUnion', elements: ['x'] },
  });
  assert.equal(u.$inc.n, 10);
  assert.ok(u.$set.at instanceof Date);
  assert.ok('gone' in u.$unset);
  assert.equal(u.$addToSet.tags, 'x');
});

test('mongo sentinels are recognized by asSentinel', () => {
  assert.equal(asSentinel(MongoFieldValue.serverTimestamp()).kind, 'serverTimestamp');
  assert.equal(asSentinel(MongoFieldValue.increment(2)).operand, 2);
  assert.equal(asSentinel({ plain: true }), null);
  assert.equal(asSentinel(42), null);
});

test('buildDocument resolves sentinels for whole-doc sets', () => {
  const doc = buildDocument({
    n: MongoFieldValue.increment(3),
    tags: MongoFieldValue.arrayUnion('a'),
    at: MongoFieldValue.serverTimestamp(),
  });
  assert.equal(doc.n, 3);
  assert.deepEqual(doc.tags, ['a']);
  assert.ok(doc.at instanceof Date);
});

test('buildFilter maps Firestore operators to Mongo', () => {
  assert.deepEqual(buildFilter([{ field: 'userId', op: '==', value: 'u1' }]), { userId: 'u1' });
  assert.deepEqual(buildFilter([{ field: 'n', op: '>=', value: 5 }]), { n: { $gte: 5 } });
  assert.deepEqual(buildFilter([{ field: 'status', op: 'in', value: ['a', 'b'] }]), { status: { $in: ['a', 'b'] } });
  assert.deepEqual(buildFilter([{ field: '__name__', op: '==', value: 'x' }]), { _id: 'x' });
  const both = buildFilter([
    { field: 'userId', op: '==', value: 'u1' },
    { field: 'isRead', op: '==', value: false },
  ]);
  assert.ok(Array.isArray(both.$and) && both.$and.length === 2);
});

test('timestamp round-trip: Date -> FsTimestamp with toDate/toMillis', () => {
  const d = new Date('2026-11-08T08:00:00.000Z');
  const ts = fromMongoValue(d);
  assert.ok(ts instanceof FsTimestamp);
  assert.equal(ts.toMillis(), d.getTime());
  assert.equal(ts.toDate().getTime(), d.getTime());
  assert.equal(toMongoValue(ts).getTime(), d.getTime());
});

test('nested objects and arrays convert recursively', () => {
  const back = fromMongoValue({ a: { when: new Date(1000) }, list: [new Date(2000)] });
  assert.equal(back.a.when.toMillis(), 1000);
  assert.equal(back.list[0].toMillis(), 2000);
});

// ------------------------------------------------------------- policy

const UID = 'userA';

test('policy: profiles are owner-write and paid fields are locked', () => {
  assert.equal(canWrite({ collection: 'users', action: 'update', uid: UID, docId: UID, patch: { bio: 'hi' }, resulting: {}, existing: {} }), true);
  assert.equal(canWrite({ collection: 'users', action: 'update', uid: UID, docId: 'other', patch: { bio: 'hi' }, resulting: {}, existing: {} }), false);
  assert.equal(canWrite({ collection: 'users', action: 'update', uid: UID, docId: UID, patch: { isPro: true }, resulting: {}, existing: {} }), false);
  assert.equal(canWrite({ collection: 'users', action: 'update', uid: UID, docId: UID, patch: { role: 'admin' }, resulting: {}, existing: {} }), false);
  // self-service cancellation is the one allowed paid-field write
  assert.equal(canWrite({
    collection: 'users', action: 'update', uid: UID, docId: UID,
    patch: { isPro: false, plan: 'free', subscriptionPlan: 'free', subscriptionStatus: 'canceled' },
    resulting: {}, existing: {},
  }), true);
  assert.equal(canWrite({ collection: 'publicProfiles', action: 'update', uid: UID, docId: UID, patch: { isPro: true }, resulting: {}, existing: {} }), false);
});

test('policy: server-only collections reject every client write', () => {
  for (const c of ['linkyState', 'linkyUsage', 'swipes', 'builderStates', 'botUsers']) {
    assert.equal(canWrite({ collection: c, action: 'create', uid: UID, docId: 'x', patch: {}, resulting: {}, existing: null }), false, c);
    assert.equal(canReadDoc(c, { userId: UID }, UID), false, c);
  }
});

test('policy: notifications are owner-scoped', () => {
  assert.equal(canReadDoc('notifications', { userId: UID }, UID), true);
  assert.equal(canReadDoc('notifications', { userId: 'other' }, UID), false);
  assert.equal(canWrite({ collection: 'notifications', action: 'update', uid: UID, docId: 'n1', patch: { isRead: true }, resulting: {}, existing: { userId: UID } }), true);
  assert.equal(canWrite({ collection: 'notifications', action: 'update', uid: UID, docId: 'n1', patch: { content: 'x' }, resulting: {}, existing: { userId: UID } }), false);
  assert.equal(canWrite({ collection: 'notifications', action: 'delete', uid: UID, docId: 'n1', patch: {}, resulting: {}, existing: { userId: 'other' } }), false);
});

test('policy: match participants only; userIds immutable', () => {
  const match = { userIds: [UID, 'userB'], participants: { [UID]: true, userB: true } };
  assert.equal(canReadDoc('matches', match, UID), true);
  assert.equal(canReadDoc('matches', match, 'stranger'), false);
  assert.equal(canWrite({ collection: 'matches', action: 'update', uid: UID, docId: 'm', patch: { lastMessage: 'hi' }, resulting: {}, existing: match }), true);
  assert.equal(canWrite({ collection: 'matches', action: 'update', uid: UID, docId: 'm', patch: { userIds: [UID, 'evil'] }, resulting: {}, existing: match }), false);
  assert.equal(canWrite({ collection: 'matches', action: 'delete', uid: UID, docId: 'm', patch: {}, resulting: {}, existing: match }), false);
});

test('policy: messages must be sent as self', () => {
  assert.equal(canWrite({ collection: 'messages', action: 'create', uid: UID, docId: 'm1', patch: {}, resulting: { senderId: UID }, existing: null }), true);
  assert.equal(canWrite({ collection: 'messages', action: 'create', uid: UID, docId: 'm1', patch: {}, resulting: { senderId: 'other' }, existing: null }), false);
});

test('policy: publicProfiles are world-readable, everything else needs auth', () => {
  assert.equal(canReadDoc('publicProfiles', { uid: 'x' }, null), true);
  assert.equal(canReadDoc('users', { uid: 'x' }, null), false);
  assert.equal(canReadDoc('posts', { authorId: 'x' }, null), false);
  assert.equal(canReadDoc('posts', { authorId: 'x' }, UID), true);
});
