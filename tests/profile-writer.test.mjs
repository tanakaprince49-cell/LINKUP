// Linky writing a member's profile is the headline PLUS feature, which means it
// is also the one that can do the most damage. Two promises are tested here:
// it never invents a fact, and it never writes for a member who has not paid.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  draftBio,
  draftProfile,
  inventsFacts,
  isUsableDraft,
  writerFacts,
} from '../shared/profile-writer.js';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const TARIRO = {
  displayName: 'Tariro Moyo',
  occupation: 'Product Engineer',
  buildingName: 'LINKUP',
  buildingOneLiner: 'a place where founders find the person who fills the empty seat.',
  missingSeat: 'Technical cofounder',
  skills: ['React Native', 'Postgres', 'Product'],
  industries: ['Fintech'],
  startupStage: 'mvp',
  buildingTraction: '73 builders and 12 weekly introductions',
  availability: '20+ hrs a week',
  city: 'Harare',
  country: 'Zimbabwe',
  projects: [{ title: 'LINKUP', description: '', status: 'mvp' }],
};

test('the rewrite is written from the member’s own answers', () => {
  const draft = draftProfile(TARIRO);
  assert.equal(draft.source, 'local');
  assert.match(draft.fields.bio, /I am building LINKUP/);
  assert.match(draft.fields.bio, /technical cofounder/);
  assert.match(draft.fields.bio, /73 builders/);
  assert.equal(draft.fields.missingSeat, 'Technical cofounder');
  assert.deepEqual(draft.fields.skills, TARIRO.skills);
  assert.deepEqual(draft.fields.industries, ['Fintech']);
  assert.deepEqual(draft.fields.lookingFor, ['Technical cofounder']);
  assert.equal(draft.fields.projects[0].title, 'LINKUP');
  assert.equal(draft.fields.projects[0].status, 'mvp');
  assert.equal(draft.missing.length, 0);
  assert.ok(draft.evidence.length >= 5, 'every line says where it came from');
  assert.equal(draft.headline, 'Product Engineer · building LINKUP');
});

test('an empty profile gets questions, never a guess', () => {
  const draft = draftProfile({ displayName: 'Sam' });
  assert.equal(draft.fields.bio, undefined, 'no build, no invented build');
  assert.equal(draft.missing.length, 3);
  assert.match(draft.missing[0], /What you are building/i);
  assert.match(draft.missing[1], /Which seat is empty/i);
  assert.match(draft.missing[2], /good at/i);
  assert.equal(isUsableDraft(draft), false, 'a draft with no substance is not offered as ready');
});

test('a member’s own words survive when there is no structure to rebuild from', () => {
  const facts = writerFacts({ bio: 'I sell solar to shops in Mutare.' });
  assert.equal(draftBio(facts), 'I sell solar to shops in Mutare.');
});

test('the guard throws away any draft that adds a fact', () => {
  const facts = writerFacts(TARIRO);
  // The member's own draft passes.
  assert.equal(inventsFacts(draftProfile(TARIRO).fields.bio, facts), false);
  // A plain reword passes.
  assert.equal(inventsFacts('I am building LINKUP and I need a technical cofounder to ship it.', facts), false);
  // A new company, a new city, a new person, a new number: all rejected.
  assert.equal(inventsFacts('I am building KudaPay in Nairobi with Ruth.', facts), true);
  assert.equal(inventsFacts('We have 400 merchants and $12k a month.', facts), true);
  assert.equal(inventsFacts('', facts), true);
  assert.equal(inventsFacts('Too short.', facts), true);
});

test('the guard is strict about numbers even when they look innocent', () => {
  const facts = writerFacts(TARIRO);
  assert.equal(inventsFacts('I am building LINKUP with 73 builders on the waitlist today.', facts), false, '73 is in the facts');
  assert.equal(inventsFacts('I am building LINKUP with 74 builders on the waitlist today.', facts), true, '74 is not');
});

test('the writer is PLUS only, server-side, and refuses rather than half-writing', () => {
  const api = read('api/_linky.js');
  const start = api.indexOf('export async function writeMyProfile');
  assert.ok(start > -1, 'the writer exists');
  const body = api.slice(start, api.indexOf('// ---------------------------------------------------------------- team chat', start));
  assert.match(body, /const plus = await isPlusMember\(uid, user\);/, 'it asks the member tier');
  assert.match(body, /if \(!plus\)[\s\S]{0,200}plus_required/, 'and refuses a free member');
  assert.match(body, /inventsFacts\(bio, draft\.facts\)/, 'a model draft is checked before it is offered');
  assert.match(body, /draftProfile\(user\)/, 'the deterministic draft is always the floor');
  assert.match(body, /isUsableDraft\(out\)/, 'and nothing thin is handed back as ready');
});

test('the router opens the wall, not a draft, for a free member', () => {
  const router = read('api/linky.js');
  assert.match(router, /case 'writeProfile'/);
  assert.match(router, /err\?\.code === 'plus_required'[\s\S]{0,90}res\.status\(402\)/);
});

test('saving is explicit: nothing is written until the member taps save', () => {
  const ui = read('mobile/src/components/LinkyProfileWriter.tsx');
  assert.match(ui, /Save this to my profile/);
  // The Firestore write lives inside save(), not inside run().
  const run = ui.slice(ui.indexOf('const run = useCallback'), ui.indexOf('const save = useCallback'));
  assert.ok(!/updateDoc/.test(run), 'fetching a draft must not touch the profile');
  const save = ui.slice(ui.indexOf('const save = useCallback'), ui.indexOf('const close ='));
  assert.match(save, /updateDoc\(doc\(db, 'users', uid\)/);
  assert.match(save, /updateLocalProfile\(fields\)/, 'and the app reads it immediately');
});
