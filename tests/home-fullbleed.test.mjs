// The home page is the phone's width, not a card sitting inside it.
//
// It used to be gutter 16 → hero card padding 20 → weekly card padding 18 →
// inner panel padding 16 = 76pt of inset on a 390pt screen, which left the long
// read in a 246px column and made the page feel packed. These tests hold the
// page at 18pt on each side with no card shells, no inner panels and no rules
// between sections — and hold the inset too, so the text never touches the glass.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const screen = read('mobile/src/screens/DiscoveryDashboardScreen.tsx');
const dossier = read('mobile/src/components/WeeklyDossier.tsx');
const strength = read('mobile/src/components/ProfileStrengthCard.tsx');
const demand = read('mobile/src/components/DemandStrip.tsx');

/** The style block for one key, so an assertion cannot be satisfied elsewhere. */
const styleBlock = (source, key) => {
  const start = source.indexOf(`\n  ${key}: {`);
  assert.ok(start > -1, `style ${key} exists`);
  const lineEnd = source.indexOf('\n', start + 1);
  const firstLine = source.slice(start, lineEnd);
  // One-liner styles close on their own line.
  if (firstLine.trim().endsWith('},')) return firstLine;
  const end = source.indexOf('\n  },', start);
  assert.ok(end > -1, `style ${key} is closed`);
  return source.slice(start, end + 4);
};

const INSET = 18;

test('the page itself has no side gutter — the sheet runs to the glass', () => {
  assert.match(screen, /<View style=\{\{ paddingTop: 0 \}\}>/, 'the scroll content is flush to both edges');
  assert.ok(!/paddingHorizontal: 16, paddingTop: 12/.test(screen), 'the old 16pt page gutter is gone');
});

test('the hero is a full-bleed sheet, not a rounded card with a shadow', () => {
  const hero = styleBlock(screen, 'heroCard');
  assert.match(hero, new RegExp(`paddingHorizontal: ${INSET}`), 'text keeps a readable inset');
  assert.ok(!/borderRadius/.test(hero), 'no radius on the sheet');
  assert.ok(!/borderWidth/.test(hero), 'no border on the sheet');
  assert.ok(!/shadowOpacity|elevation/.test(hero), 'no shadow lifting it off the page');
});

test('the weekly card carries no shell of its own', () => {
  const card = styleBlock(screen, 'cofounderCard');
  assert.match(card, /marginTop/, 'it still separates from the hero');
  for (const gone of ['borderRadius', 'borderWidth', 'padding:', 'shadowOpacity', 'elevation']) {
    assert.ok(!card.includes(gone), `the weekly card no longer sets ${gone}`);
  }
  assert.match(screen, /<View style=\{styles\.cofounderCard\}>/, 'and no inline background or border is painted on it');
});

test('nothing is boxed inside anything else', () => {
  const portrait = styleBlock(screen, 'profileHeroBox');
  assert.ok(!/borderRadius|backgroundColor|padding:/.test(portrait), 'the portrait stage is not a panel');
  const bio = styleBlock(screen, 'bioSection');
  assert.ok(!/paddingHorizontal/.test(bio), 'the bio is not inset a second time');

  const box = styleBlock(dossier, 'box');
  assert.ok(!/borderWidth|borderRadius|padding:/.test(box), 'the dossier is the page, not a panel');
  assert.match(dossier, /<View testID=\{testID\} style=\{styles\.box\}>/, 'the dossier paints no background of its own');

  for (const [name, source] of [['ProfileStrengthCard', strength], ['DemandStrip', demand]]) {
    const card = styleBlock(source, 'card');
    assert.ok(!/borderWidth|borderRadius/.test(card), `${name} is not a card with a frame`);
    assert.match(card, new RegExp(`paddingHorizontal: ${INSET}`), `${name} carries the page inset itself`);
  }
});

test('no horizontal rules between sections', () => {
  const footer = styleBlock(screen, 'emailFooterRow');
  assert.ok(!/borderTopWidth/.test(footer), 'no rule above the email footer');
});

test('the inset that is left is the same everywhere on the page', () => {
  const hero = styleBlock(screen, 'heroCard');
  assert.match(hero, new RegExp(`paddingHorizontal: ${INSET}`));
  assert.match(styleBlock(strength, 'card'), new RegExp(`paddingHorizontal: ${INSET}`));
  assert.match(styleBlock(demand, 'card'), new RegExp(`paddingHorizontal: ${INSET}`));
});

test('the schedule of insets adds up: 390pt phone leaves a readable column', () => {
  // 390 − 2 × 18 = 354pt of text, against the 246pt it had before the change.
  const column = 390 - INSET * 2;
  assert.ok(column >= 350, `text column is ${column}pt`);
});
