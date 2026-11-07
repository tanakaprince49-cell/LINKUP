import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';

const FILE = 'mobile/src/screens/OnboardingScreen.tsx';
const source = fs.readFileSync(new URL('../' + FILE, import.meta.url), 'utf8');
const ast = ts.createSourceFile(FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** The screen keys of the onboarding `steps` array, in order. */
function stepKeys() {
  const keys = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useMemo') {
      const factory = node.arguments[0];
      if (factory && ts.isArrowFunction(factory) && ts.isArrayLiteralExpression(factory.body)) {
        for (const element of factory.body.elements) {
          if (!ts.isObjectLiteralExpression(element)) continue;
          const keyProp = element.properties.find(
            (p) => ts.isPropertyAssignment(p) && p.name?.getText(ast) === 'key' && ts.isStringLiteral(p.initializer),
          );
          if (keyProp) keys.push(keyProp.initializer.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return keys;
}

test('onboarding is nine screens at most, in the order the member needs them', () => {
  const keys = stepKeys();
  assert.deepEqual(keys, [
    'name',
    'homebase',
    'identity',
    'build',
    'seat',
    'stakes',
    'profile-bank',
    'fit',
    'mirror',
  ]);
  assert.ok(keys.length <= 9, `onboarding is ${keys.length} screens`);
});

test('the profile photo is mandatory on the first screen', () => {
  const first = source.slice(source.indexOf("key: 'name'"), source.indexOf("key: 'homebase'"));
  assert.match(first, /<PhotoSlot/, 'the name screen must render the photo picker');
  assert.match(first, /canNext: displayName\.trim\(\)\.length >= 2 && !!profilePicUri/);
  assert.doesNotMatch(first, /canNext: displayName\.trim\(\)\.length >= 2,/, 'the photo cannot be skipped');
});

test('the brief still travels to Firestore and to the matcher', () => {
  // Read the real payload object, shorthand properties included: `missingSeat,`
  // is the same key as `missingSeat: missingSeat`.
  let payload = null;
  (function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'onboardingProfile' &&
      node.initializer
    ) {
      // `const onboardingProfile: Record<string, unknown> = {...} as any`
      let init = node.initializer;
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) payload = init;
    }
    ts.forEachChild(node, visit);
  })(ast);
  assert.ok(payload, 'onboardingProfile payload not found');
  const written = new Set(payload.properties.map((p) => p.name?.getText(ast)));
  for (const field of [
    'buildingName',
    'buildingOneLiner',
    'buildingTraction',
    'missingSeat',
    'seatWhy',
    'stakes',
    'urgency',
    'workPace',
    'conflictStyle',
    'decisionStyle',
    'riskAppetite',
    'equityView',
    'weeklyHours',
    'relocateView',
    'matchingSignals',
  ]) {
    assert.ok(written.has(field), `${field} must stay in the onboarding payload`);
  }
  assert.match(source, /setDoc\(doc\(db, 'users', user\.uid\), onboardingProfile, \{ merge: true \}\)/);
});
