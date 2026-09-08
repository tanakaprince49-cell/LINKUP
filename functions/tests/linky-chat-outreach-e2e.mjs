// Linky as a conversationalist + the outreach pipeline. Companion to
// linky-e2e.mjs, and run the same way:
//
//   firebase emulators:start --only firestore --project linkup-e0906   (port 8089)
//   FAKE_SA_JSON=/tmp/fake-sa.json node functions/tests/linky-chat-outreach-e2e.mjs
//
// What is real here: the matcher, the name pass, the budget, the thread, the
// bot brain, the Firestore writes, the ledger, the prefilter, the link
// resolver. What is mocked: Gemini (no key in CI) and SerpApi (paid, and the
// free plan's 250 searches are not for tests). Both are mocked at fetch(), so
// the production request shape is asserted too - a query that stops carrying
// num=100 or starts paging per person should fail here, not in production.
import fsNode from 'node:fs';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089';
process.env.FIREBASE_SERVICE_ACCOUNT = fsNode.readFileSync(process.env.FAKE_SA_JSON || '/tmp/fake-sa.json', 'utf8');
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.GEMINI_API_KEY = 'fake-gemini-key-for-tests';
process.env.SERPAPI_KEY = 'fake-serp-key-for-tests';
process.env.OUTREACH_RESERVE_CREDITS = '40';

const realFetch = globalThis.fetch;
const calls = { gemini: 0, serp: 0, google: 0, serpQueries: [] };
let serpAccount = { total_searches_left: 240, searches_per_month: 250, plan_name: 'Free Plan' };
let organicOverride = null;

const fakeOrganic = [
  { position: 1, title: 'Tinashe Moyo - Senior Flutter Developer', snippet: 'Built Flutter apps for Ecocash merchants in Harare, Dart and Firebase', link: 'https://www.google.com/goto?url=TOK1' },
  { position: 2, title: 'Prices for hiring Flutter developers - PayScale', snippet: 'salary data and pricing news', link: 'https://www.google.com/goto?url=TOK2' },
  { position: 3, title: 'Rutendo Chikafu - Flutter | React Native', snippet: 'Mobile engineer, cross platform apps, Zimbabwe', link: 'https://www.google.com/goto?url=TOK3' },
  { position: 4, title: 'Sign in to LinkedIn', snippet: 'Log in to continue', link: 'https://www.google.com/goto?url=TOK4' },
  { position: 5, title: 'News: local startup raises funding', snippet: 'The company announced news this week', link: 'https://www.google.com/goto?url=TOK5' },
  { position: 6, title: 'Alex Banda - Backend engineer', snippet: 'Node, Postgres, APIs at a bank in Nairobi', link: 'https://www.google.com/goto?url=TOK6' },
  { position: 7, title: 'Nyasha Chibanda - Fellow Actuary (CISA)', snippet: 'Insurance and pensions actuarial work, pricing and reserves, Harare', link: 'https://www.google.com/goto?url=TOK7' },
  { position: 8, title: 'Dr Tendai Mhlanga - Veterinary Surgeon', snippet: 'Cattle and livestock health, clinic owner in Gweru, Zimbabwe', link: 'https://www.google.com/goto?url=TOK8' },
];
const gotoTargets = { TOK1: 'https://zw.linkedin.com/in/tinashe-moyo', TOK3: 'https://www.linkedin.com/in/rutendo-chikafu', TOK6: 'https://ke.linkedin.com/in/alex-banda', TOK7: 'https://zw.linkedin.com/in/nyasha-chibanda', TOK8: 'https://zw.linkedin.com/in/tendai-mhlanga' };

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('generativelanguage.googleapis.com')) {
    calls.gemini += 1;
    const asked = JSON.parse(init.body || '{}');
    const prompt = asked?.contents?.[0]?.parts?.[0]?.text || '';
    // The outreach scorer and the wording engine share this one mock, so each
    // gets its own payload shape.
    if (/Return STRICT JSON only: \{"keep"/.test(prompt)) {
      const profiles = JSON.parse(prompt.slice(prompt.indexOf('Profiles: ') + 10, prompt.lastIndexOf(']') + 1));
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ keep: profiles.map((p, i) => ({ i: p.i, fit: 90 - i * 6, why: 'ships flutter' })) }) }] } }] });
    }
    // Be a bit kind-aware, otherwise every assertion about what Linky says
    // just asserts the mock's one canned sentence.
    if (/give 3 concrete places or ways/.test(prompt)) {
      return json({ candidates: [{ content: { parts: [{ text: 'Outside LINKUP, three routes for that need: the UZ computer science department, the ZimFintech WhatsApp group, and LinkedIn with a location filter. Then message the two most active people you find.' }] } }] });
    }
    const dossier = (() => {
      const i = prompt.lastIndexOf('Dossier: ');
      try { return JSON.parse(prompt.slice(i + 9)); } catch { return {}; }
    })();
    const found = Array.isArray(dossier.matches) ? dossier.matches : [];
    const names = found.map((m) => m.name).join(' and ');
    const bySituation = {
      chat: 'I was hoping somebody would ask me something interesting - who are you after today?',
      limit: "That is today's ten asks gone, friend. It resets at midnight, and a name lookup is always free.",
      person: dossier.cannot_introduce_because
        ? `${(dossier.found || {}).name} is on LINKUP, but ${dossier.cannot_introduce_because}. I did not push a request.`
        : `${(dossier.found || {}).name} is right here - I checked, that is a real profile.`,
      ambiguous: 'I have more than one member who could be that. Which one do you mean?',
      draft: 'Here is a line you can send as it is: worth fifteen minutes this week?',
      none: `Nobody here fits ${dossier.need} yet, and I read every profile rather than guess. Reply MORE and I will look outside LINKUP.`,
      found: `Good news, I found ${found.length} ${found.length === 1 ? 'person' : 'people'} for that: ${names}. Each card says why. Reply "meet 1".`,
      close: `Nobody writes those words, but ${found.length} are close: ${names}.`,
    };
    const replyText = bySituation[dossier.situation] || `Situation ${dossier.situation}: I looked and here is what I found.`;
    const chips = found.length ? ['meet 1', 'who else do you have', 'write me a first message']
      : dossier.situation === 'none' ? ['Where to look outside LINKUP', 'Try a role instead'] : ['a flutter developer in harare', 'help'];
    return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: replyText, suggest: chips }) }] } }] });
  }
  if (u.includes('serpapi.com/account.json')) return json(serpAccount);
  if (u.includes('serpapi.com/search.json')) {
    calls.serp += 1;
    calls.serpQueries.push(new URL(u).searchParams);
    return json({ search_information: { total_results: 412 }, organic_results: organicOverride || fakeOrganic });
  }
  if (u.includes('google.com/goto')) {
    calls.google += 1;
    const tok = new URL(u).searchParams.get('url');
    const loc = gotoTargets[tok];
    if (!loc) return new Response('nope', { status: 404 });
    return new Response(null, { status: 302, headers: { location: loc } });
  }
  return realFetch(url, init);
};

const L = await import('../../api/_linky.js');
const S = await import('../../api/_serpapi.js');
const { botReplyForTest } = await import('../../api/linky.js');
const db = (await import('../../api/_firebaseAdmin.js')).getDb();
await fetch('http://127.0.0.1:8089/emulator/v1/projects/linkup-e0906/databases/(default)/documents', { method: 'DELETE' });

const users = {
  alice: { displayName: 'Alice Moyo', occupation: 'Founder', company: 'PayZim', city: 'Harare', country: 'Zimbabwe', skills: ['sales', 'fintech'], industries: ['fintech'], bio: 'Mobile money for SMEs', onboarded: true, isVisible: true },
  fred: { displayName: 'Fred Moyo', occupation: 'Flutter developer', company: 'Freelance', city: 'Harare', country: 'Zimbabwe', skills: ['flutter', 'dart'], industries: ['mobile'], bio: 'Ships Flutter apps', onboarded: true, isVisible: true },
  freda: { displayName: 'Freda Ncube', occupation: 'Product designer', city: 'Bulawayo', country: 'Zimbabwe', skills: ['figma', 'ux'], onboarded: true, isVisible: true },
  bob: { displayName: 'Bob Chikwanha', occupation: 'Backend engineer', city: 'Harare', country: 'Zimbabwe', skills: ['node', 'firebase'], onboarded: true, isVisible: true },
  luke: { displayName: 'Luke Tembani', occupation: 'Developer', city: 'Harare', country: 'Zimbabwe', skills: ['react', 'node'], onboarded: true, isVisible: true },
  tapi1: { displayName: 'Tapiwa Moyo', occupation: 'Analyst', city: 'Harare', country: 'Zimbabwe', skills: ['excel'], onboarded: true, isVisible: true },
  tapi2: { displayName: 'Tapiwa Dube', occupation: 'Accountant', city: 'Bulawayo', country: 'Zimbabwe', skills: ['tax'], onboarded: true, isVisible: true },
};
for (const [uid, u] of Object.entries(users)) {
  await db.collection('users').doc(uid).set({ uid, ...u });
  await db.collection('publicProfiles').doc(uid).set({ uid, ...u, profilePic: `https://ik/${uid}.jpg` });
}

let failed = 0;
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); failed += 1; } else console.log('ok  -', msg); };
const has = (s, re) => re.test(String(s || ''));

// ================================================================ name lookup
let r = await L.ask('alice', 'fred');
console.log('    LINKY>', r.reply);
assert(r.kind === 'person' && r.cards.length === 1 && r.cards[0].targetUid === 'fred', '"fred" finds the human instead of saying nobody fits');
assert(r.free === true && r.asksLeft === 10, 'a name lookup costs no ask');
assert(r.reply.length > 30 && r.reply.length < 700 && /I checked, that is a real profile/.test(r.reply), 'the sentence is the model wording, not a stamped template');
assert(/^Alice\./.test(r.reply), 'the member name is prepended by the app, never asked of the model');
assert(!/"reply":/.test(r.reply) && !/```/.test(r.reply), 'and the raw model JSON never leaks into the bubble');
r = await L.ask('alice', 'send a message to fred');
assert(r.kind === 'person' && r.cards.length === 1 && !/Nobody on LINKUP fits/.test(r.reply), '"send a message to fred" is understood as a person request');
assert(r.cards[0].need !== 'send a message to fred', 'what the target sees is not the raw command: ' + r.cards[0].need);
r = await L.ask('alice', 'message luke tembani please');
assert(r.cards[0]?.targetUid === 'luke' && /Luke Tembani/.test(r.reply), 'full names work too: ' + r.reply.slice(0, 60));

// a name that no longer exists must still be answered like a person
r = await L.ask('alice', 'is captain reach on here');
assert(r.kind === 'none' && r.nearest.length >= 1 && has(r.suggest[0], /./), 'an unknown name falls through to the network search and offers next steps');

// ================================================================ ambiguous
r = await L.ask('alice', 'tapiwa');
assert(r.kind === 'ambiguous' && r.nearest.length === 2 && !r.cards.length, 'a name with two owners asks which one instead of guessing: ' + r.nearest.map((n) => n.name).join(' / '));
assert(/Which one do you mean/.test(r.reply), 'and it asks in a sentence, not a list');
const pick = r.nearest[0];
if (pick) {
  const card = await L.pickPerson('alice', pick.uid);
  assert(card.targetUid === pick.uid && card.status === 'new' && has(card.why, /you picked|by name/i), 'tapping one of the two makes a real card: ' + card.targetName);
  const home = await L.home('alice');
  assert(home.cards.some((c) => c.id === card.id), 'the picked card is in the member card list');
}

// ================================================================ blocked door
await L.setPrefs('bob', { inboundCap: 0 });
r = await L.ask('alice', 'bob chikwanha');
assert(r.kind === 'person' && !r.cards.length && r.nearest.some((n) => n.uid === 'bob'), 'a member who switched intros off is found, not reported missing');
assert(has(r.reply, /switched|off|not taking|intro/i), 'and Linky explains the closed door: ' + r.reply.slice(0, 90));

// ================================================================ chit-chat
calls.gemini = 0;
const hi = await L.ask('luke', 'hi');
assert(hi.kind === 'chat' && hi.free === true && hi.asksLeft === 10, 'a greeting is chat, not a search, and costs nothing');
assert(calls.gemini === 1, 'chit-chat wording is exactly one small Gemini call: ' + calls.gemini);
assert(/hoping somebody would ask/i.test(hi.reply), 'the model wrote the sentence (mocked): ' + hi.reply.slice(0, 60));
assert(Array.isArray(hi.suggest) && hi.suggest.length >= 2, 'Linky offers tappable replies instead of a dead end');
const hiAgain = await L.ask('freda', 'hi');
assert(calls.gemini === 1 && hiAgain.reply.includes('Freda'), 'the shared wording is cached for everyone, then personalised per member');
assert(!/Alice/.test(hi.reply), 'and no other member name leaks into this reply');
assert(/Freda/.test(hiAgain.reply), 'the shared wording is personalised on the way out');
const thanks = await L.ask('luke', 'thanks linky');
assert(thanks.kind === 'chat' && thanks.asksLeft === 10, 'thanks is chat too, still free');

// ================================================================ the thread
const home = await L.home('luke');
assert(Array.isArray(home.thread) && home.thread.length >= 4, 'home returns a thread, not one answer');
assert(home.thread.filter((t) => t.role === 'linky').length === home.thread.filter((t) => t.role === 'user').length, 'every question has a Linky turn back');
assert(home.thread.every((t) => !/[*_`#]|^\s*[-•]>/.test(t.text)), 'no markdown ever reaches a chat bubble');
assert(home.thread.length <= L.LIMITS.threadTurns, 'the thread is capped so the doc cannot grow forever');

// ================================================================ keep going
const first = await L.ask('freda', 'a developer in harare');
const seenNames = first.cards.map((c) => c.targetUid);
const elseAsk = await L.ask('freda', 'who else do you have');
assert(elseAsk.asksLeft === first.asksLeft - 1, '"who else" is a real search, so it costs one ask');
assert(elseAsk.cards.every((c) => !seenNames.includes(c.targetUid)), 'the second lap never repeats who was already shown: ' + elseAsk.cards.map((c) => c.targetName).join(', '));

// ================================================================ budget
await db.collection('linkyState').doc('alice').set({ asks: { day: L.dayKey(), count: 10 } }, { merge: true });
let lim = null;
try { await L.ask('alice', 'a quantum cryptographer in oslo'); } catch (e) { lim = e; }
assert(lim && lim.code === 'ask_limit' && has(lim.message, /midnight|reset/i), 'out of asks says when it resets, kindly: ' + lim?.message);
const freeName = await L.ask('alice', 'fred');
assert(freeName.kind === 'person' && !freeName.reply.includes('used up'), 'even with zero asks left, a name lookup still works');

// ================================================================ the bots
await db.collection('linkyState').doc('alice').set({ asks: { day: L.dayKey(), count: 2 } }, { merge: true });
const { code } = await L.createLinkCode('alice');
let br = await botReplyForTest('telegram', '777', 'hey people');
assert(!/did not work/.test(br.text) && /code/i.test(br.text), 'a six letter word in a sentence is not treated as a link code: ' + br.text.slice(0, 70));
br = await botReplyForTest('telegram', '777', 'here');
assert(!/did not work/.test(br.text), 'and neither is any other short word');
const linked = await L.consumeLinkCode(code, 'telegram', '777');
assert(linked === 'alice', 'the real code still links');
br = await botReplyForTest('telegram', '777', 'a flutter developer in harare');
assert(br.cards?.length >= 1 && has(br.text, /meet 1/), 'the bot answers inline and tells them how to act');
assert(Array.isArray(br.chips) && br.chips.length >= 1, 'the bot gets chips to turn into buttons');
br = await botReplyForTest('telegram', '777', 'who are you');
assert(br.text.length > 20 && !/Nobody here fits/.test(br.text), 'small talk on Telegram is not answered with a search result');
br = await botReplyForTest('telegram', '777', 'Where to look outside LINKUP');
assert(has(br.text, /Outside LINKUP|found|profile/i), 'tapping the chip on Telegram maps to MORE: ' + br.text.slice(0, 70));
br = await botReplyForTest('telegram', '777', 'a blockchain lawyer in lagos right now');

// the slash menu BotFather shows and what botReply() actually answers must not drift:
// an advertised command that falls through becomes a word search and answers nonsense
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../api/linky.js', import.meta.url), 'utf8');
  const { BOT_COMMANDS } = await import('../../api/linky.js');
  const body = src.slice(src.indexOf('export async function botReply('), src.indexOf('function pointerText('));
  const orphan = BOT_COMMANDS.filter((c) => !new RegExp(`\\b${c.command}\\b`).test(body)).map((c) => c.command);
  assert(!orphan.length, `every advertised command is handled by the bot${orphan.length ? ' - orphaned: ' + orphan.join(', ') : ''}`);
  assert(BOT_COMMANDS.every((c) => /^[a-z]{1,32}$/.test(c.command) && c.description.length <= 48), 'commands fit Telegram limits (lowercase, description under 48 chars for the menu to be accepted)');
  const noMenu = await botReplyForTest('telegram', '777', 'audit');
  assert(has(noMenu.text, /everything i have on you/i), '"/audit" reads the audit page out loud instead of searching for the word audit: ' + String(noMenu.text).slice(0, 90));
  const drafted = await botReplyForTest('telegram', '777', 'draft');
  assert(!has(drafted.text, /nobody|searched|checked/i) && drafted.text.length > 40, '"/draft" writes a message, it is not eaten by the matcher: ' + String(drafted.text).slice(0, 120));
}
assert(!br.cards && has(br.text, /nobody/i), 'a bot no match stays graceful, never an error message');
assert(has(br.text, /MORE/i), 'and offers the way out');

// ================================================================ outreach agent
const before = { ...calls };
const LEDGER = `budget_${new Date().toISOString().slice(0, 7)}`;
const ledUsed = async () => Number(((await db.collection('linkyOutreach').doc(LEDGER).get()).data() || {}).used || 0);
const ledBefore = await ledUsed();
const out = await S.findLeads('a flutter developer for a paid fintech MVP', { place: 'Harare, Zimbabwe', plus: false, uid: 'alice', askedBy: 'Alice' });
const q = (calls.serpQueries[before.serp] || new URLSearchParams());
assert(calls.serp - before.serp === 1, 'one SerpApi search for a free-plan run (the plan is 250 a month, shared)');
assert(q.get('num') === '100', 'every query still asks for num=100, per the extraction rule');
assert(/^site:linkedin\.com\/in /.test(q.get('q') || ''), 'strict operator query so the SERP is profiles, not news: ' + q.get('q'));
assert(!/Harare, Zimbabwe/.test(q.get('q') || ''), 'the place is split into one term, not an exact phrase');
assert(out.leads.length === 2, 'junk (news, pricing, login pages) dropped locally before any token was spent: ' + out.leads.map((l) => l.name).join(', '));
assert(out.leads.every((l) => /linkedin\.com\/in\//.test(l.url) && l.resolved), 'leads carry real resolved profile URLs, not redirect wrappers');
assert(calls.google - before.google <= out.leads.length, 'link resolution is at most one plain redirect follow per lead, costing zero search credits');
assert(calls.serp - before.serp === 1, 'not one extra search was made to look a person up (search and enrichment stay decoupled)');
assert(out.leads.every((l) => l.fit >= 55 && l.why && l.name), 'the model returned only scores and 3 word whys');
assert((await ledUsed()) - ledBefore === out.searches, `the credit ledger counted exactly the searches made (${ledBefore} -> ${await ledUsed()} for ${out.searches} search${out.searches === 1 ? '' : 'es'})`);
const run = await db.collection('linkyOutreach').get();
assert(run.docs.some((d) => d.id.startsWith('run_') && Array.isArray(d.data().results) && d.data().results.length >= 2), 'the raw organic payload was saved before judgement');
const again = await S.findLeads('a flutter developer for a paid fintech MVP', { place: 'Harare, Zimbabwe', uid: 'alice' });
assert(calls.serp - before.serp === 1 && again.cached && again.leads.length === 2, 'the same need again costs no search and no token');

// PLUS is allowed to go deeper, but never past the ledger
organicOverride = [...fakeOrganic, ...fakeOrganic.map((x) => ({ ...x, title: x.title.replace(' - ', ' (2) - ') }))];
const plusRun = await S.findLeads('a flutter developer for a paid fintech MVP in Bulawayo', { place: 'Bulawayo', plus: true, uid: 'fred' });
assert(plusRun.searches >= 1 && plusRun.searches <= S.OUTREACH.plusMaxPages, 'a PLUS run may go deeper, but never past plusMaxPages searches: ' + plusRun.searches);
assert(plusRun.leads.length <= S.OUTREACH.maxLeads, 'and still shows a member at most maxLeads people');

// the guard: an exhausted plan must not be spent on by a queue
serpAccount = { total_searches_left: 12, searches_per_month: 250, plan_name: 'Free Plan' };
S.resetCreditsCache();
const broke = await S.canSearch({ plus: true, uid: 'alice' });
assert(!broke.ok && broke.reason === 'plan-exhausted', 'refuses to search when the account is under the reserve: ' + JSON.stringify(broke));
organicOverride = null;
const idle = await S.findLeads('an actuary for an insurance startup', { place: 'Harare', plus: true, uid: 'luke' });
assert(idle.searches === 0 && idle.note === 'plan-exhausted' && !idle.leads.length, 'and findLeads degrades to advice only, never an error');
const pt = await L.pointers('luke', 'a quantum cryptographer in oslo').catch(() => null);
assert(!pt || typeof pt.text === 'string', 'pointers never throws when search is unavailable');

// the member-visible answer weaves the leads into Linky voice, for both surfaces
serpAccount = { total_searches_left: 240, searches_per_month: 250, plan_name: 'Free Plan' };
S.resetCreditsCache();
await L.setPrefs('freda', {});
const noMatch = await L.ask('freda', 'a veterinary surgeon for a cattle clinic in Gweru');
assert(noMatch.none, 'setup: a need LINKUP genuinely does not cover (' + noMatch.reply.slice(0, 60) + ')');
const beforePt = { ...calls };
const pointers = await L.pointers('freda', 'a veterinary surgeon for a cattle clinic in Gweru');
assert(pointers.leads.length >= 1 && /Tendai Mhlanga/.test(pointers.text), 'outside LINKUP now names a real person it found: ' + String(pointers.text).slice(-180).replace(/\n/g, ' '));
assert(calls.serp - beforePt.serp === 1, 'one search for one question, whatever the member count');
assert(has(pointers.text, /no contact details/i), 'and says plainly what it did not collect');
// the bubble names them; the link travels as data so the app can open it and the
// bot can render it as a button - a bare url pasted into prose is the worst of both
assert(/Tendai Mhlanga - Veterinary Surgeon/.test(pointers.text), 'each lead is named with their title');
assert(/^https:\S*linkedin\.com\/in\//.test(pointers.leads[0].url || ''), 'and carries a public profile URL the client can open :: ' + JSON.stringify(pointers.leads[0]));
assert(pointers.leads.every((l) => l.resolved || /google\.com\/search/.test(l.url)), 'an unresolved link stays an honest search fallback, never a broken profile url');
assert(!/\{|"reply"/.test(pointers.text), 'the advice is prose, never the raw model JSON');

// ================================================================ wiring
const vercel = fsNode.readFileSync('vercel.json', 'utf8');
assert(JSON.parse(vercel).rewrites.some((x) => x.source === '/api/telegram' && /channel=telegram/.test(x.destination)), 'the Telegram webhook route is still rewritten to /api/linky');
assert(JSON.parse(vercel).functions?.['api/linky.js']?.maxDuration >= 60, 'api/linky.js keeps a long enough timeout for a search + a model call');
const rules = fsNode.readFileSync('firestore.rules', 'utf8');
assert(/match \/linkyOutreach\/\{docId\} \{\s*allow read, write: if false;/.test(rules), 'the ledger and the runs are locked to the Admin SDK');
const env = fsNode.readFileSync('.env.example', 'utf8');
assert(/SERPAPI_KEY=/.test(env) && !/980e4ab7|fake-gemini/.test(env), '.env.example documents SERPAPI_KEY and no real key is committed');
const src = fsNode.readFileSync('api/_linky.js', 'utf8');
assert(!/import .*_linkyVoice/.test(src), 'no hand written voice module: the words come from Gemini');
assert(/plainReply/.test(src) && /geminiWording/.test(src), 'both paths exist: model first, plain fallback second');

if (failed) { console.error(`\n${failed} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
process.exit(0);
