import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';
import { createPublicSeoHandler } from '../api/publicSeo.js';
const require = createRequire(import.meta.url);
const { copy, withHead } = require('../shared/app-seo.cjs');
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const json = (file) => JSON.parse(read(file));
const parse = (file) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function runtimeContract(ast) {
  const result = [];
  function walk(n) {
    if (ts.isCallExpression(n)) {
      const name = ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : ts.isIdentifier(n.expression) ? n.expression.text : '';
      if (['navigate', 'replace', 'collection', 'doc', 'trackAction', 'setItem', 'getItem', 'removeItem', 'get', 'post'].includes(name)) {
        result.push([name, ...n.arguments.filter((a) => ts.isStringLiteral(a)).map((a) => a.text)]);
      }
    }
    if (ts.isPropertyAssignment(n)) {
      const key = n.name?.text;
      if (['id', 'kind', 'type', 'action', 'productId', 'planKey'].includes(key) && ts.isStringLiteral(n.initializer)) result.push(['property', key, n.initializer.text]);
    }
    ts.forEachChild(n, walk);
  }
  walk(ast); return result;
}

test('copy revision preserves navigation, persistence, mission and product string contracts', () => {
  const expected = json('tests/fixtures/copy-runtime-contracts.json');
  for (const [file, contract] of Object.entries(expected)) assert.deepEqual(runtimeContract(parse(file)), contract, file);
  const app = json('mobile/app.json').expo;
  assert.equal(app.name, 'LINKUP'); assert.equal(app.scheme, 'linkup');
  assert.equal(app.android.package, 'com.tana.linkup');
});

test('audited professional wording remains in the shared Android/web source', () => {
  const audit = json('tests/fixtures/professional-copy-review.json');
  assert.ok(audit.length >= 240);
  const sources = new Map();
  const normalized = (value) => value.replace(/\s+/g, ' ').trim();
  for (const entry of audit) {
    if (!sources.has(entry.file)) {
      const strings = []; const ast = parse(entry.file);
      assert.equal(ast.parseDiagnostics.length, 0, entry.file);
      function visit(n) { if (ts.isStringLiteral(n) || ts.isJsxText(n) || ts.isNoSubstitutionTemplateLiteral(n)) strings.push(n.text); ts.forEachChild(n, visit); }
      visit(ast); sources.set(entry.file, { strings: normalized(strings.join('\n')), raw: normalized(read(entry.file)) });
    }
    const source = sources.get(entry.file);
    const expected = normalized(entry.after);
    assert.ok(source.strings.includes(expected) || source.raw.includes(expected), `${entry.file}: ${entry.after}`);
  }
  for (const phrase of ['exit the realm', 'wiped from existence', 'not posting hustle', 'The cat pulled the cable again', 'VIBE-CHECK']) {
    assert.ok(![...sources.values()].some((s) => s.raw.includes(phrase)), phrase);
  }
});

test('Play listing fields satisfy limits and avoid unsupported promotional claims', () => {
  for (const [field, max] of [['title', 30], ['short-description', 80], ['full-description', 4000], ['release-notes', 500]]) {
    const text = read(`store/google-play/en-US/${field}.txt`).trim();
    assert.ok(text.length > 0 && [...text].length <= max, `${field}: ${[...text].length}/${max}`);
    assert.doesNotMatch(text, /#1|best app|guaranteed (?:funding|matches|success)|millions of (?:users|founders)|100%/i);
  }
  assert.match(read('store/google-play/en-US/full-description.txt'), /cofounder matching/);
  assert.match(read('store/google-play/en-US/full-description.txt'), /after approval/);
  assert.match(read('store/google-play/en-US/full-description.txt'), /optional LINKUP PLUS/);
});

test('public landing head has canonical, social metadata and truthful business schema', () => {
  const html = '<html><head><title>LINKUP</title></head><body></body></html>';
  const publicHtml = withHead(html, true);
  assert.match(publicHtml, /name="robots" content="index,follow"/);
  assert.ok(publicHtml.includes(`rel="canonical" href="${copy.landingUrl}"`));
  assert.match(publicHtml, /property="og:description"/); assert.match(publicHtml, /name="twitter:title"/);
  const schema = JSON.parse(publicHtml.match(/<script id="linkup-app-schema" type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema['@type'], 'WebApplication'); assert.equal(schema.applicationCategory, 'BusinessApplication');
  assert.ok(!schema.aggregateRating && !schema.offers);
  assert.equal(withHead(publicHtml, true), publicHtml, 'idempotent export metadata');
  const privateHtml = withHead(publicHtml, false);
  assert.match(privateHtml, /name="robots" content="noindex,follow"/);
  assert.doesNotMatch(privateHtml, /rel="canonical"|application\/ld\+json/);
});

test('authenticated web routes are noindex and metadata helper is safe on native', () => {
  const exports = {}; const module = { exports };
  const compiled = ts.transpileModule(read('mobile/src/lib/webMetadata.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { exports, module, require: () => copy });
  for (const route of ['EmailAuth', 'Onboarding', 'Profile', 'Chat', 'Inbox', 'Campaigns', 'LinkySettings', undefined]) {
    const meta = module.exports.routeMetadata(route);
    assert.equal(meta.robots, 'noindex,follow'); assert.equal(meta.canonical, null);
  }
  assert.equal(module.exports.routeMetadata('Landing').canonical, copy.landingUrl);
  assert.equal(module.exports.routeMetadata('Landing').robots, 'index,follow');
  assert.doesNotThrow(() => module.exports.syncWebMetadata('Chat'));
});

test('public landing aliases precede SPA fallback at both hosting mounts', () => {
  const rules = json('vercel.json').rewrites;
  for (const source of ['/landing', '/app/landing']) {
    const index = rules.findIndex((rule) => rule.source === source);
    assert.ok(index >= 0);
    assert.equal(rules[index].destination, '/landing.html');
    assert.ok(index < rules.findIndex((rule) => rule.source === '/(.*)'));
  }
});

test('static sitemap includes the public app landing but not private app routes', async () => {
  const response = { setHeader() {}, status(code) { this.code = code; }, send(body) { this.body = body; } };
  await createPublicSeoHandler(() => { throw new Error('static sitemap should not read member data'); })({ query: { mode: 'static' }, method: 'GET' }, response);
  assert.equal(response.code, 200); assert.ok(response.body.includes(copy.landingUrl));
  for (const section of ['campaigns','startups','news']) assert.ok(response.body.includes('https://www.linkupbuild.com/app/'+section));
  assert.doesNotMatch(response.body, /\/login|\/chat|\/campaign-manager|\/campaign-dashboard|\/news-feed|\/startup-feed|\/profile/);
});

test('Linky has a friendly configurable voice and evidence-based introductions', () => {
  const source = read('api/_linky.js');
  assert.match(source, /Be a grounded, friendly connector/);
  assert.match(source, /Only use facts from the dossier/);
  assert.match(source, /Never invent a fact/);
  assert.match(source, /v5-companion/);
  assert.doesNotMatch(source, /tease gently|Light teasing is fine|warm, easy, a little funny|haha\. Say the word/);
});
