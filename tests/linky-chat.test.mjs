import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';
import * as workbench from '../api/_linkyWorkbench.js';
import * as quality from '../api/_linkyQuality.js';
import * as companion from '../api/_linkyCompanion.js';
import * as usage from '../api/_linkyUsage.js';
import { publicEligible } from '../api/_publicSeo.js';
import { safeLinkedinProfile } from '../api/_serpapi.js';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

class Database {
  rows = new Map();
  queue = Promise.resolve();
  snapshot(path) { return { id: path.split('/').at(-1), exists: this.rows.has(path), data: () => structuredClone(this.rows.get(path)) }; }
  write(path, data, merge) { this.rows.set(path, structuredClone(merge ? { ...this.rows.get(path), ...data } : data)); }
  async getAll(...refs) { return refs.map((r) => this.snapshot(r.path)); }
  collection(name) {
    const db = this;
    const filters = [];
    const q = {
      where(k, op, v) { filters.push([k, op, v]); return q; },
      limit() { return q; },
      orderBy() { return q; },
      async get() {
        const docs = [...db.rows.keys()]
          .filter((k) => k.startsWith(name + '/') && k.split('/').length === 2)
          .map((k) => db.snapshot(k))
          .filter((d) => filters.every(([k, op, v]) => (op === '==' ? d.data()[k] === v : true)));
        return { docs, size: docs.length };
      },
      doc(id) {
        const path = `${name}/${id}`;
        return { path, get: async () => db.snapshot(path), set: async (d, o) => db.write(path, d, o?.merge), delete: async () => db.rows.delete(path) };
      },
    };
    return q;
  }
  runTransaction(fn) {
    const result = this.queue.then(async () => {
      const writes = [];
      const out = await fn({ get: async (ref) => this.snapshot(ref.path), set: (ref, d, o) => writes.push([ref.path, d, o?.merge]) });
      writes.forEach((args) => this.write(...args));
      return out;
    });
    this.queue = result.catch(() => {});
    return result;
  }
}

const person = (uid, extra = {}) => ({
  uid, displayName: uid, occupation: 'Developer', skills: ['Flutter'], city: 'Harare', country: 'Zimbabwe', onboarded: true, ...extra,
});
const seed = (db, profiles) => { for (const p of profiles) { db.rows.set('users/' + p.uid, p); db.rows.set('publicProfiles/' + p.uid, p); } };
const member = person('member', { displayName: 'Tanaka', skills: ['Sales'], occupation: 'Founder' });

function core(db, { ai = true, plan = null } = {}) {
  const module = { exports: {} };
  const mocks = {
    './_linkyWorkbench.js': workbench, 'node:crypto': crypto, './_linkyQuality.js': quality, './_linkyCompanion.js': companion,
    './_publicSeo.js': { publicEligible }, './_linkyUsage.js': usage,
    '../shared/team-roles.js': { fallbackTeamRoles: () => ['Flutter developer', 'Product designer'] },
    './_memberTier.js': { memberHasPlus: async () => false },
    './_firebaseAdmin.js': { getDb: () => db, getAdmin: () => ({ firestore: { FieldValue: { serverTimestamp: () => Date.now(), delete: () => null }, Timestamp: { fromMillis: (ms) => ms } } }) },
    './_gemini.js': {
      aiReady: () => ai,
      aiStatus: () => ({ gemini: {}, zen: {} }),
      aiText: async () => ({ text: JSON.stringify(plan || { reply: 'Say less — I am on it.', action: 'chat', idea: '', roles: [] }) }),
      geminiText: async () => JSON.stringify(plan || {}),
    },
    './_serpapi.js': { safeLinkedinProfile, findLeads: async () => ({ leads: [], searches: 0, note: 'not-configured' }) },
    './_expoPush.js': { sendExpoPush: async () => ({ sent: 0 }) },
    './_emailNotify.js': { sendHighSignalEmail: async () => ({ sent: false }) },
    './_proof.js': { proofPoints: () => [], badgeLine: () => '' },
    './_profileWriter.js': { writeMyProfile: async () => ({ ok: false, reason: 'not_used_here' }) },
  };
  const code = ts.transpileModule(read('api/_linky.js'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => { assert.ok(name in mocks, name); return mocks[name]; }, console, process: { env: {} }, Date, Set, Map, URL, Buffer, setTimeout, clearTimeout });
  return module.exports;
}

const squadDb = () => {
  const db = new Database();
  seed(db, [member, person('Alice', { skills: ['Flutter', 'Python'] }), person('Dee', { occupation: 'Product Designer', skills: ['Figma'] })]);
  return db;
};
const searchPlan = {
  reply: 'Two seats, two humans, zero guessing.',
  action: 'search',
  idea: 'A payments app for market traders that needs a Flutter developer and a product designer.',
  roles: ['Flutter developer', 'Product designer'],
};

test('Linky is a chat surface: one message, one reply, and the live member database searched inside the same turn', async () => {
  const db = squadDb();
  const api = core(db, { plan: searchPlan });
  const out = await api.linkyChat('member', { message: 'I am building a payments app for market traders — who can build it with me?' });
  assert.equal(out.action, 'search');
  // The plan's sentence named nobody, so the deterministic line replaces it:
  // Linky never says it found someone without saying who.
  assert.match(out.reply, /Alice/);
  assert.match(out.reply, /Dee/);
  assert.ok(out.checked >= 2, 'the search reports how many public profiles it checked');
  assert.equal(out.teams.length, 1);
  assert.equal([...out.teams[0].members.map((m) => m.name)].sort().join(','), 'Alice,Dee');
  assert.ok(out.teams[0].members.every((m) => m.recommendedRole && m.why));
  assert.equal([...out.roles].join('|'), 'Flutter developer|Product designer');
  assert.ok(out.suggestions.length > 0);
  // The search a chat turn triggers shares that turn's message: one charge, never two.
  assert.equal(db.rows.get('linkyUsage/member').daily.count, 1);
  // The thread is kept server-side so the conversation survives a reinstall.
  const thread = db.rows.get('linkyState/member').chatThread;
  assert.equal(thread.length, 2);
  assert.equal(thread[0].role, 'user');
  assert.equal(thread[1].role, 'linky');
});

test('small talk costs one message, never searches the database, and still answers in Linky’s voice', async () => {
  const db = squadDb();
  const api = core(db, { plan: { reply: 'Main character energy. I like it.', action: 'chat', idea: '', roles: [] } });
  const out = await api.linkyChat('member', { message: 'hey linky' });
  assert.equal(out.action, 'chat');
  assert.equal(out.teams.length, 0);
  assert.equal(out.checked, 0);
  assert.equal(out.reply, 'Main character energy. I like it.');
  assert.equal(db.rows.get('linkyUsage/member').daily.count, 1);
});

test('with the AI unavailable the chat still searches on a real brief and asks for a brief when there is none', async () => {
  const db = squadDb();
  const api = core(db, { ai: false });
  const found = await api.linkyChat('member', { message: 'I need a Flutter developer and a product designer for my payments app' });
  assert.equal(found.action, 'search');
  assert.match(found.reply, /Searched|nobody clears the evidence bar/);
  assert.ok(found.teams.length <= 1);
  const unclear = await api.linkyChat('member', { message: 'yo' });
  assert.equal(unclear.action, 'chat');
  assert.match(unclear.reply, /search the whole member database/i);
  assert.equal(unclear.teams.length, 0);
});

test('with a profile on file Linky never asks what the member is building', async () => {
  const db = squadDb();
  // This member's onboarding already said what they are building and which seat
  // is empty. "find me someone" must therefore search, not interrogate.
  db.rows.set('users/member', { ...member, buildingName: 'Kuda Pay', buildingOneLiner: 'a payments app for market traders', missingSeat: 'Flutter developer' });
  const api = core(db, { ai: false });
  const out = await api.linkyChat('member', { search: true });
  assert.equal(out.askedForBrief, false, 'a search with a known brief must not ask again');
  assert.equal(out.action, 'search');
  assert.doesNotMatch(out.reply, /what are you (making|building)/i);
});

test('a chat turn with no project brief asks a question instead of inventing a team', async () => {
  const db = squadDb();
  const api = core(db, { plan: { reply: '', action: 'search', idea: 'short', roles: [] } });
  const out = await api.linkyChat('member', { message: 'find me someone' });
  assert.equal(out.askedForBrief, true);
  assert.equal(out.action, 'chat');
  assert.equal(out.teams.length, 0);
  assert.match(out.reply, /what are you making/i);
});

test('clearing the conversation wipes the stored thread and spends no message', async () => {
  const db = squadDb();
  const api = core(db, { plan: searchPlan });
  await api.linkyChat('member', { message: 'I am building a payments app for market traders — who can build it with me?' });
  assert.equal(db.rows.get('linkyState/member').chatThread.length, 2);
  const cleared = await api.linkyChat('member', { clear: true });
  assert.equal(cleared.cleared, true);
  assert.equal(db.rows.get('linkyState/member').chatThread.length, 0);
  assert.equal(db.rows.get('linkyUsage/member').daily.count, 1);
});

test('an exhausted daily allowance stops the chat before any search and points at the upgrade', async () => {
  const db = squadDb();
  const api = core(db, { plan: searchPlan });
  db.rows.set('linkyUsage/member', { daily: { key: usage.dayKey(Date.now()), count: 5 } });
  await assert.rejects(() => api.linkyChat('member', { message: 'find me a Flutter developer' }), (err) => {
    assert.equal(err.code, 'ask_limit');
    assert.ok(err.messageQuota.upgradeRequired);
    return true;
  });
  assert.equal(db.rows.get('linkyUsage/member').daily.count, 5);
});

test('the client sends chat through the authenticated API and never renders a retired Linky surface', () => {
  const api = read('api/linky.js');
  assert.match(api, /case 'chat': out = await linkyChat/);
  assert.match(api, /linkyChat\(uid, \{/);
  const client = read('mobile/src/lib/linkyApi.ts');
  assert.match(client, /export const linkyTeamChat = /);
  assert.match(client, /linkyCall<LinkyChatResult>\('chat'/);
  const screen = read('mobile/src/screens/LinkyHomeScreen.tsx');
  assert.match(screen, /linkyTeamChat\(/);
  assert.match(screen, /database search|LINKUP database/i);
  assert.doesNotMatch(screen, /intro draft|warm intro|SponsoredSlot|intro_request/);
});

test('asking who is strongest after a search pulls the actual profiles back up', async () => {
  const db = squadDb();
  const api = core(db, { plan: searchPlan });
  const first = await api.linkyChat('member', { message: 'I am building a payments app for market traders — who can build it with me?' });
  assert.equal(first.teams.length, 1);
  // A fresh turn whose AI sentence names nobody must still show the people.
  const api2 = core(db, { plan: { reply: 'Great question.', action: 'chat', idea: '', roles: [] } });
  const out = await api2.linkyChat('member', { message: 'Who is the strongest?' });
  assert.equal(out.teams.length, 1, 'the follow-up re-attaches the found profiles');
  assert.deepEqual([...out.teams[0].members.map((m) => m.name)].sort(), ['Alice', 'Dee']);
  assert.match(out.reply, /Alice|Dee/, 'the reply names the strongest instead of gesturing at them');
});

test('members are grouped by what they are good at and what they want', () => {
  const db = squadDb();
  const api = core(db, { plan: searchPlan });
  const groups = api.buildMemberGroups([
    { uid: 'a1', skills: ['Flutter', 'Python'], role: 'Developer', lookingFor: ['Cofounder'], industries: ['Fintech'] },
    { uid: 'a2', skills: ['Figma'], role: 'Product Designer', lookingFor: ['Developer'], industries: ['Fintech'] },
  ]);
  assert.equal(groups.get('skill:flutter').map((f) => f.uid).join(','), 'a1');
  assert.equal(groups.get('role:designer').map((f) => f.uid).join(','), 'a2');
  assert.equal(groups.get('wants:cofounder').map((f) => f.uid).join(','), 'a1');
  assert.equal(groups.get('domain:fintech').map((f) => f.uid).sort().join(','), 'a1,a2');
});

test('asking for a person by name pulls their actual profile, not a role search', async () => {
  const db = new Database();
  seed(db, [member, person('karen', { displayName: 'Karen', occupation: 'Growth Lead', skills: ['Growth', 'Sales'] })]);
  const api = core(db, { plan: searchPlan });
  const out = await api.linkyChat('member', { message: "ok find karen s profile on linkup" });
  assert.equal(out.teams.length, 1);
  assert.equal(out.teams[0].members[0].uid, 'karen');
  assert.match(out.reply, /Karen/);
  assert.ok(out.checked >= 1);
  // Your own name pulls your own profile, labelled as you.
  const self = await api.linkyChat('member', { message: "find tanaka s profile" });
  assert.equal(self.teams[0].members[0].uid, 'member');
  assert.match(self.reply, /that is you/i);
  // A name that is not here gets an honest no, never an invented person.
  const ghost = await api.linkyChat('member', { message: "find Zebediah's profile" });
  assert.equal(ghost.teams.length, 0);
  assert.match(ghost.reply, /nobody is registered under that name/i);
});

test('when nobody clears the bar, Linky pulls the closest real people and says so', async () => {
  const db = squadDb();
  const api = core(db, {
    plan: {
      reply: '',
      action: 'search',
      idea: 'A partnerships and growth push for a payments app for market traders',
      roles: ['Head of Partnerships', 'Growth Lead', 'Business Development Manager'],
    },
  });
  const out = await api.linkyChat('member', { message: 'Who can build LINKUP with me?' });
  assert.equal(out.teams.length, 1, 'the member still gets real people');
  assert.equal(out.teams[0].partial, true, 'the team is honestly labelled as closest-available');
  const names = out.teams[0].members.map((m) => m.name).sort();
  assert.equal(names.join(','), 'Alice,Dee');
  assert.match(out.reply, /closest real profiles/);
  assert.match(out.reply, /Alice/);
});
