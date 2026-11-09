import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupService } from '../api/_groups.js';

// Group invite links: /app/g/<code>. Possession of the link is the
// invitation — it must join unlisted groups too — but every other safety
// rail (live profile, bans, blocks, capacity) still applies.

const NOW = Date.parse('2026-11-09T12:00:00Z');

class Database {
  rows = new Map(); queue = Promise.resolve();
  snapshot(path) {
    return { id: path.split('/').at(-1), exists: this.rows.has(path), data: () => structuredClone(this.rows.get(path)) };
  }
  runQuery(name, filters, size) {
    let docs = [...this.rows.keys()]
      .filter((k) => k.startsWith(name + '/') && k.split('/').length === 2)
      .map((k) => ({ ...this.snapshot(k), ref: { path: k } }))
      .filter((d) => filters.every(([k, op, v]) => {
        const value = d.data()?.[k];
        if (op === '==') return value === v;
        if (op === 'array-contains') return Array.isArray(value) && value.includes(v);
        return true;
      }));
    if (size != null) docs = docs.slice(0, size);
    return { docs, size: docs.length };
  }
  collection(name) {
    const db = this; const filters = []; let size = null;
    const q = {
      isQuery: true, _name: name, _filters: filters,
      where(k, op, v) { filters.push([k, op, v]); return q; },
      orderBy() { return q; },
      limit(n) { size = n; return q; },
      get: async () => db.runQuery(name, filters, size),
      doc(id) {
        const path = `${name}/${id}`;
        return {
          path, id, isDoc: true,
          get: async () => db.snapshot(path),
          set: async (data, options) => db.write(path, data, options?.merge),
          update: async (patch) => db.patch(path, patch),
          delete: async () => db.rows.delete(path),
          collection(sub) {
            const prefix = `${path}/${sub}`; const sf = []; let ss = null;
            const sq = {
              isQuery: true, _name: prefix, _filters: sf,
              where(k, op, v) { sf.push([k, op, v]); return sq; },
              orderBy() { return sq; },
              limit(n) { ss = n; return sq; },
              get: async () => db.runQuery(prefix, sf, ss),
              doc(mid) {
                const mpath = `${prefix}/${mid}`;
                return {
                  path: mpath, id: mid, isDoc: true,
                  get: async () => db.snapshot(mpath),
                  set: async (data, options) => db.write(mpath, data, options?.merge),
                  update: async (patch) => db.patch(mpath, patch),
                  delete: async () => db.rows.delete(mpath),
                };
              },
            };
            return sq;
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
    if (refs.at(-1)?.fieldMask) refs.pop();
    return refs.map((r) => this.snapshot(r.path));
  }
  runTransaction(work) {
    const db = this;
    const result = this.queue.then(async () => {
      const writes = [];
      const tx = {
        get: async (ref) => {
          if (ref?.isQuery) return db.runQuery(ref._name, ref._filters || [], ref._size ?? null);
          return db.snapshot(ref.path);
        },
        set: (ref, data, options) => writes.push(() => db.write(ref.path, data, options?.merge)),
        update: (ref, data) => writes.push(() => db.patch(ref.path, data)),
        delete: (ref) => writes.push(() => db.rows.delete(ref.path)),
      };
      const value = await work(tx);
      writes.forEach((fn) => fn());
      return value;
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
}

function service(db) {
  return createGroupService({
    db, now: () => NOW,
    blocked: async () => false,
    connectable: async () => true,
    notify: async () => {},
    plus: async () => false,
  });
}

const seedUser = (db, uid) => db.rows.set(`users/${uid}`, { uid, displayName: uid, onboarded: true });

test('a new group is born with a shareable invite code, visible to members only', async () => {
  const db = new Database(); seedUser(db, 'alice'); seedUser(db, 'bob');
  const api = service(db);
  const { groupId } = await api.handle('alice', 'groupCreate', { title: 'Harare builders' });
  const code = db.rows.get(`builderRooms/${groupId}`).inviteCode;
  assert.match(code, /^[a-f0-9]{12}$/);
  const view = await api.handle('alice', 'groupGet', { groupId });
  assert.equal(view.group.inviteCode, code);
  // asking again returns the same link until an admin resets it
  assert.equal((await api.handle('alice', 'groupInviteLink', { groupId })).inviteCode, code);
});

test('the invite link joins even an unlisted group, and opening it twice is harmless', async () => {
  const db = new Database(); seedUser(db, 'alice'); seedUser(db, 'bob');
  const api = service(db);
  const { groupId } = await api.handle('alice', 'groupCreate', { title: 'Quiet builders' });
  await api.handle('alice', 'groupUpdate', { groupId, discoverable: false });
  const code = db.rows.get(`builderRooms/${groupId}`).inviteCode;
  const joined = await api.handle('bob', 'groupJoinLink', { code });
  assert.equal(joined.joined, true);
  assert.equal(joined.groupId, groupId);
  assert.ok(db.rows.get(`builderRooms/${groupId}`).memberIds.includes('bob'));
  const again = await api.handle('bob', 'groupJoinLink', { code });
  assert.equal(again.joined, false);
  const view = await api.handle('bob', 'groupGet', { groupId });
  assert.equal(view.group.title, 'Quiet builders');
});

test('bad, unknown and reset links are dead', async () => {
  const db = new Database(); seedUser(db, 'alice'); seedUser(db, 'bob'); seedUser(db, 'carol');
  const api = service(db);
  const { groupId } = await api.handle('alice', 'groupCreate', { title: 'Resettable' });
  const oldCode = db.rows.get(`builderRooms/${groupId}`).inviteCode;
  await assert.rejects(api.handle('bob', 'groupJoinLink', { code: 'not-a-code' }), /not valid/);
  await assert.rejects(api.handle('bob', 'groupJoinLink', { code: 'ffffffffffff' }), /not valid anymore/);
  await api.handle('bob', 'groupJoinLink', { code: oldCode });
  await assert.rejects(api.handle('bob', 'groupInviteLink', { groupId, reset: true }), /Only a group admin can reset/);
  const { inviteCode: newCode } = await api.handle('alice', 'groupInviteLink', { groupId, reset: true });
  assert.notEqual(newCode, oldCode);
  await assert.rejects(api.handle('carol', 'groupJoinLink', { code: oldCode }), /not valid anymore/);
  assert.equal((await api.handle('carol', 'groupJoinLink', { code: newCode })).joined, true);
});

test('invite-link joins still honour bans, blocks and capacity', async () => {
  const db = new Database(); seedUser(db, 'alice'); seedUser(db, 'dave'); seedUser(db, 'erin'); seedUser(db, 'frank');
  const api = service(db);
  const { groupId } = await api.handle('alice', 'groupCreate', { title: 'Guarded' });
  const code = db.rows.get(`builderRooms/${groupId}`).inviteCode;
  db.rows.get(`builderRooms/${groupId}`).bannedIds = ['dave'];
  await assert.rejects(api.handle('dave', 'groupJoinLink', { code }), /banned/);
  db.rows.set('blocks/erin_alice', { blockedById: 'erin', blockedUserId: 'alice' });
  await assert.rejects(api.handle('erin', 'groupJoinLink', { code }), /blocked member is present/);
  const full = db.rows.get(`builderRooms/${groupId}`);
  full.memberIds = Array.from({ length: 32 }, (_, i) => `member${i}`);
  await assert.rejects(api.handle('frank', 'groupJoinLink', { code }), /full/);
});
