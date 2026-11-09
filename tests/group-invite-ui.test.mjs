import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('every group has a shareable invite link in its info sheet', () => {
  const chat = read('mobile/src/screens/GroupChatScreen.tsx');
  assert.match(chat, /Invite people/);
  assert.match(chat, /groupInviteUrl\(group\.inviteCode\)/);
  assert.match(chat, /'Copy invite link'/);
  assert.match(chat, /'Share invite link'/);
  assert.match(chat, /'Create invite link'/);
  assert.match(chat, /'Reset link'/);
  assert.match(chat, /builderCall\('groupInviteLink'/);
});

test('the group sheet is organised into labelled sections, with danger last', () => {
  const chat = read('mobile/src/screens/GroupChatScreen.tsx');
  const sheet = chat.slice(chat.indexOf('The group'));
  for (const section of ['Invite people', 'Conversation', 'About & rules', 'Members ·', 'Conversation data', 'Danger zone']) {
    assert.ok(sheet.includes(section), `missing sheet section: ${section}`);
  }
  assert.ok(sheet.indexOf('Danger zone') > sheet.indexOf('Members ·'), 'leaving lives at the bottom');
  // Blocking is a compact text action, never a giant full-width pill.
  assert.match(sheet, /Unblock my side/);
});

test('invite links are recognised on every platform and joined after sign-in', () => {
  const lib = read('mobile/src/lib/groupInvite.ts');
  assert.match(lib, /linkupbuild\.com\/app\/g\//);
  assert.match(lib, /GROUP_INVITE_CODE_PATTERN = \/\^\[a-f0-9\]\{12\}\$\//);
  const app = read('mobile/App.tsx');
  assert.match(app, /groupInviteCodeFromUrl/);
  assert.match(app, /builderCall\('groupJoinLink', \{ code \}\)/);
  assert.match(app, /navigate\('GroupChat', \{ groupId: r\.groupId \}\)/);
});

test('Linky thinks out loud in complete, brief-specific thoughts', () => {
  const voice = read('mobile/src/lib/brandVoice.ts');
  assert.match(voice, /thinkingLines: \(facts: BuildFacts\)/);
  assert.match(voice, /facts\.projectName/);
  assert.match(voice, /facts\.seat/);
  const screen = read('mobile/src/screens/LinkyHomeScreen.tsx');
  assert.match(screen, /LINKY_VOICE\.thinkingLines\(facts\)/);
  assert.match(screen, /setInterval/);
  assert.match(screen, /busy\s*\?\s*thinkingLine/);
  assert.match(screen, /\{thinkingLine\}/);
});

test('Linky shows the member the brief it is working from, and renders its replies properly', () => {
  const screen = read('mobile/src/screens/LinkyHomeScreen.tsx');
  assert.match(screen, /What Linky knows about you/);
  for (const label of ["'Building'", "'Looking for'", "'You bring'"]) {
    assert.ok(screen.includes(`label: ${label}`), `brief row missing: ${label}`);
  }
  // Replies go through the rich-text renderer — never raw markdown asterisks.
  assert.match(screen, /<LinkyRichText text=\{message\.text\}/);
});
