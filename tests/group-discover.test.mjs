import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGroupService } from '../api/_groups.js';

// Newly created groups are discoverable: anyone with a live onboarded profile
// can browse safe metadata (name, bio, photo, member count) and join straight
// from the listing. Messages, member lists, rules and invites never leak.
const NOW = Date.parse('2026-10-24T12:00:00Z');

class Database {
  rows = new Map(); queue = Promise.resolve();
  snapshot(path) {
    return { id: path.split('/').at(-1), exists: this.rows.has(path), data: () => structuredClone(this.rows.get(path)) };
  }
  runSubQuery(prefix, filters, order, size) {
    const depth = prefix.split('/').length + 1;
    let docs = [...this.rows.keys()]
      .filter((k) => k.startsWith(prefix + '/') && k.split('/').length === depth)
      .map((k) => ({ ...this.snapshot(k), ref: { path: k } }))
      .filter((d) => filters.every(([k, op, v]) => {
        const value = d.data()?.[k];
        if (op === '==') return value === v;
        if (op === 'array-contains') return Array.isArray(value) && value.includes(v);
        return true;
      }));
    if (order) {
      const [field, dir] = order;
      docs = docs.sort((a, b) => ((a.data()?.[field] ?? 0) < (b.data()?.[field] ?? 0) ? -1 : 1) * (dir === 'desc' ? -1 : 1));
    }
    if (size != null) docs = docs.slice(0, size);
    return { docs, size: docs.length };
  }
  runQuery(name, filters, order, size) {
    let docs = [...this.rows.keys()]
      .filter((k) => k.startsWith(name + '/') && k.split('/').length === 2)
      .map((k) => ({ ...this.snapshot(k), ref: { path: k } }))
      .filter((d) => filters.every(([k, op, v]) => {
        const value = d.data()?.[k];
        if (op === '==') return value === v;
        if (op === 'array-contains') return Array.isArray(value) && value.includes(v);
        return true;
      }));
    if (order) {
      const [field, dir] = order;
      docs = docs.sort((a, b) => ((a.data()?.[field] ?? 0) < (b.data()?.[field] ?? 0) ? -1 : 1) * (dir === 'desc' ? -1 : 1));
    }
    if (size != null) docs = docs.slice(0, size);
    return { docs, size: docs.length };
  }
  collection(name) {
    const db = this; const filters = []; let order = null; let size = null;
    const q = {
      isQuery: true, where(k, op, v) { filters.push([k, op, v]); return q; },
      orderBy(field, dir = 'asc') { order = [field, dir]; return q; },
      limit(n) { size = n; return q; },
      startAfter() { return q; },
      get: async () => db.runQuery(name, filters, order, size),
      doc(id) {
        const path = `${name}/${id}`;
        return {
          path, isDoc: true, id,
          get: async () => db.snapshot(path),
          set: async (data, options) => db.write(path, data, options?.merge),
          update: async (patch) => db.patch(path, patch),
          delete: async () => db.rows.delete(path),
          collection(sub) {
            const prefix = `${path}/${sub}`;
            const filters = []; let order = null; let size = null;
            const q = {
              isQuery: true,
              where(k, op, v) { filters.push([k, op, v]); return q; },
              orderBy(field, dir = 'asc') { order = [field, dir]; return q; },
              limit(n) { size = n; return q; },
              startAfter() { return q; },
              get: async () => db.runSubQuery(prefix, filters, order, size),
              doc(mid) {
                const mpath = `${prefix}/${mid}`;
                return {
                  path: mpath, isDoc: true, id: mid,
                  get: async () => db.snapshot(mpath),
                  set: async (data, options) => db.write(mpath, data, options?.merge),
                  update: async (patch) => db.patch(mpath, patch),
                  delete: async () => db.rows.delete(mpath),
                };
              },
            };
            return q;
          },
        };
      },
    };
    return q;
  }
  write(path, data, merge) {
    this.rows.set(path, structuredClone(merge ? { ...this.rows.get(path), ...data } : data));
  }
  patch(path, data) {
    const next = structuredClone(this.rows.get(path) || {});
    for (const [key, value] of Object.entries(data)) {
      const parts = key.split('.');
      let node = next;
      for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] ??= {};
      node[parts.at(-1)] = value;
    }
    this.rows.set(path, next);
  }
  async getAll(...refs) {
    const options = refs.at(-1)?.fieldMask ? refs.pop() : null; void options;
    return refs.map((r) => this.snapshot(r.path));
  }
  runTransaction(work) {
    const db = this;
    const result = this.queue.then(async () => {
      const writes = [];
      const tx = {
        get: async (ref) => {
          // Query refs carry their collection context for transactional reads.
          if (ref?.isQuery) return db.runQuery(ref._name || '', ref._filters || [], ref._order || null, ref._size ?? null);
          return db.snapshot(ref.path);
        },
        set: (ref, data, options) => writes.push(() => db.write(ref.path, data, options?.merge)),
        update: (ref, data) => writes.push(() => db.patch(ref.path, data)),
        delete: (ref) => writes.push(() => db.rows.delete(ref.path)),
      };
      const value = await work(tx);
      writes.forEach((fn) => fn()); return value;
    });
    this.queue = result.catch(() => undefined); return result;
  }
}

function service(db, { blockedPairs = [] } = {}) {
  // Tag query refs so transactional reads can re-execute them.
  const raw = db.collection.bind(db);
  db.collection = (name) => {
    const q = raw(name);
    q._name = name;
    const rawWhere = q.where.bind(q); const rawOrder = q.orderBy.bind(q); const rawLimit = q.limit.bind(q);
    q._filters = []; q._order = null; q._size = null;
    q.where = (k, op, v) => { q._filters.push([k, op, v]); return rawWhere(k, op, v); };
    q.orderBy = (field, dir) => { q._order = [field, dir || 'asc']; return rawOrder(field, dir); };
    q.limit = (n) => { q._size = n; return rawLimit(n); };
    return q;
  };
  const blockedSet = new Set(blockedPairs.map(([a, b]) => `${a}>${b}`));
  return createGroupService({
    db, now: () => NOW,
    blocked: async (a, b) => blockedSet.has(`${a}>${b}`) || blockedSet.has(`${b}>${a}`),
    connectable: async () => true,
    notify: async () => {},
    plus: async () => false,
  });
}

function seedUser(db, uid, extra = {}) {
  db.rows.set(`users/${uid}`, { uid, displayName: uid, onboarded: true, ...extra });
}

function seedRoom(db, id, extra = {}) {
  db.rows.set(`builderRooms/${id}`, {
    title: `Group ${id}`, description: '', kind: 'group', creatorId: 'alice', creatorPlus: false,
    ownerId: 'alice', adminIds: ['alice'], bannedIds: [], rules: 'PRIVATE RULES', photo: '',
    announcementsOnly: false, discoverable: true, preferences: {}, memberIds: ['alice'],
    readAt: {}, createdAt: NOW, updatedAt: NOW, archived: false,
    lastMessage: { id: 'm1', authorId: 'alice', at: NOW, text: 'PRIVATE MESSAGE' },
    ...extra,
  });
}

test('created groups are discoverable and listed with safe metadata only', async () => {
  const db = new Database(); seedUser(db, 'alice'); seedUser(db, 'bob');
  const api = service(db);
  const { groupId } = await api.handle('alice', 'groupCreate', { title: 'Harare builders', description: 'Build in public.' });
  assert.equal(db.rows.get(`builderRooms/${groupId}`).discoverable, true);
  // A stranger with no membership can browse it.
  const page = await api.handle('bob', 'groupDiscover', {});
  assert.equal(page.groups.length, 1);
  const card = page.groups[0];
  assert.equal(card.id, groupId); assert.equal(card.title, 'Harare builders');
  assert.equal(card.description, 'Build in public.'); assert.equal(card.memberCount, 1);
  assert.equal(card.discoverable, true); assert.equal(card.joined, false);
  assert.deepEqual(Object.keys(card).sort(), ['badges', 'createdAt', 'description', 'discoverable', 'id', 'joined', 'memberCount', 'photo', 'title', 'updatedAt']);
  assert.doesNotMatch(JSON.stringify(page), /PRIVATE/);
});

test('discovery skips private, archived, banned and legacy project rooms', async () => {
  const db = new Database(); seedUser(db, 'alice'); seedUser(db, 'bob');
  const api = service(db);
  seedRoom(db, 'open', { title: 'Open group' });
  seedRoom(db, 'legacy', { title: 'Legacy group', discoverable: undefined });
  delete db.rows.get('builderRooms/legacy').discoverable;
  seedRoom(db, 'hidden', { title: 'Hidden group', discoverable: false });
  seedRoom(db, 'old', { title: 'Archived group', archived: true });
  seedRoom(db, 'project', { title: 'Project room', kind: 'project' });
  seedRoom(db, 'banned', { title: 'Banned group', bannedIds: ['bob'] });
  const page = await api.handle('bob', 'groupDiscover', {});
  assert.deepEqual(page.groups.map((g) => g.id).sort(), ['legacy', 'open']);
  assert.equal(page.total, 2);
});

test('discovery pages and searches without leaking private content', async () => {
  const db = new Database(); seedUser(db, 'alice'); seedUser(db, 'bob');
  const api = service(db);
  seedRoom(db, 'g1', { title: 'Flutter crew', updatedAt: NOW + 3 });
  seedRoom(db, 'g2', { title: 'Design circle', description: 'Flutter designers welcome', updatedAt: NOW + 2 });
  seedRoom(db, 'g3', { title: 'Founders', updatedAt: NOW + 1 });
  const first = await api.handle('bob', 'groupDiscover', { limit: 2 });
  assert.equal(first.groups.length, 2); assert.ok(first.nextAfter);
  const second = await api.handle('bob', 'groupDiscover', { limit: 2, after: first.nextAfter });
  assert.equal(second.groups.length, 1); assert.equal(second.nextAfter, null);
  assert.equal(new Set([...first.groups, ...second.groups].map((g) => g.id)).size, 3);
  const found = await api.handle('bob', 'groupDiscover', { q: 'flutter' });
  assert.deepEqual(found.groups.map((g) => g.id).sort(), ['g1', 'g2']);
  assert.doesNotMatch(JSON.stringify(found), /PRIVATE/);
});

test('joining from discovery adds the browser, and repeats are idempotent', async () => {
  const db = new Database(); seedUser(db, 'alice'); seedUser(db, 'bob');
  const api = service(db);
  seedRoom(db, 'open', { title: 'Open group' });
  const out = await api.handle('bob', 'groupJoin', { groupId: 'open' });
  assert.deepEqual(out, { ok: true, joined: true });
  assert.deepEqual(db.rows.get('builderRooms/open').memberIds.sort(), ['alice', 'bob']);
  assert.equal(db.rows.get('builderRooms/open').readAt.bob, NOW);
  const again = await api.handle('bob', 'groupJoin', { groupId: 'open' });
  assert.deepEqual(again, { ok: true, joined: false });
  const page = await api.handle('bob', 'groupDiscover', {});
  assert.equal(page.groups[0].joined, true);
});

test('joining keeps invitation-grade safety: private, banned, full and blocked groups refuse', async () => {
  const db = new Database(); seedUser(db, 'alice'); seedUser(db, 'bob');
  const api = service(db, { blockedPairs: [['alice', 'bob']] });
  seedRoom(db, 'hidden', { title: 'Hidden', discoverable: false });
  seedRoom(db, 'banned', { title: 'Banned', bannedIds: ['bob'] });
  seedRoom(db, 'full', { title: 'Full', memberIds: Array.from({ length: 32 }, (_, i) => `member_${i}`) });
  seedRoom(db, 'blocked', { title: 'Blocked' });
  db.rows.set('blocks/alice_bob', { blockedById: 'alice', blockedUserId: 'bob' });
  seedRoom(db, 'old', { title: 'Old', archived: true });
  await assert.rejects(api.handle('bob', 'groupJoin', { groupId: 'hidden' }), /private/);
  await assert.rejects(api.handle('bob', 'groupJoin', { groupId: 'banned' }), /banned/);
  await assert.rejects(api.handle('bob', 'groupJoin', { groupId: 'full' }), /full/);
  await assert.rejects(api.handle('bob', 'groupJoin', { groupId: 'blocked' }), /blocked/);
  await assert.rejects(api.handle('bob', 'groupJoin', { groupId: 'old' }), /not available/);
  await assert.rejects(api.handle('bob', 'groupJoin', { groupId: 'missing' }), /not found/);
});

test('admins can unlist and relist a group; members cannot change visibility', async () => {
  const db = new Database(); seedUser(db, 'alice'); seedUser(db, 'bob');
  const api = service(db);
  const { groupId } = await api.handle('alice', 'groupCreate', { title: 'Toggle group' });
  await api.handle('bob', 'groupJoin', { groupId });
  await assert.rejects(api.handle('bob', 'groupUpdate', { groupId, discoverable: false }), /admin/);
  await api.handle('alice', 'groupUpdate', { groupId, discoverable: false });
  assert.equal((await api.handle('bob', 'groupDiscover', {})).groups.length, 0);
  assert.equal((await api.handle('alice', 'groupGet', { groupId })).group.discoverable, false);
  await api.handle('alice', 'groupUpdate', { groupId, discoverable: true });
  assert.equal((await api.handle('bob', 'groupDiscover', {})).groups.length, 1);
});
