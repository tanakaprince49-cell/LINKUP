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
const tgSends = [];
const calls = { gemini: 0, zen: 0, serp: 0, google: 0, serpQueries: [] };
// flip these to make a provider fail, so the rescue path is tested and not assumed
let geminiDown = false;
let zenDown = false;
// when on, both model providers stall - the only way to test that a slow model
// cannot leave a member staring at "typing..." forever
let hangProviders = false;
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
  if (hangProviders && /generativelanguage\.googleapis\.com|\/zen\/v1\//.test(u)) {
    await new Promise((r) => setTimeout(r, 9000));
    return json({ error: { message: 'still waiting' } }, 504);
  }
  if (u.includes('api.telegram.org')) {
    calls.tg = (calls.tg || 0) + 1;
    try { tgSends.push(JSON.parse(init.body || '{}')); } catch { tgSends.push({}); }
    return json({ ok: true, result: true });
  }
  if (u.includes('generativelanguage.googleapis.com')) {
    const askedPre = JSON.parse(init.body || '{}');
    const promptPre = askedPre?.contents?.[0]?.parts?.[0]?.text || '';
    // the intent gate is its own call, counted separately so every existing
    // "exactly one Gemini call" assertion still measures wording only
    if (/You are the intent gate/.test(promptPre)) {
      calls.intent = (calls.intent || 0) + 1;
      const cand = (t) => { const content = { parts: [{ text: t }] }; return { candidates: [{ content }] }; };
      if (!intentMode) return json(cand('the mock has no opinion'));
      return json(cand(JSON.stringify({ mode: intentMode, topic: intentTopic, reply: intentReply })));
    }
    calls.gemini += 1;
    if (geminiDown) return json({ error: { message: '429 Quota exceeded for the gemini key' } }, 429);
    const asked = askedPre;
    const prompt = promptPre;
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
    if (/STRICT JSON only: \{"pitch"/.test(prompt)) {
      calls.intro = (calls.intro || 0) + 1;
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        pitch: 'Carrie keeps hives in Ruwa and sells the honey on her own site. Alice is building the payments side of exactly that kind of sale and asked for you by name - not for a crowd. Fifteen minutes this week would be enough. If the timing is wrong, say no and I will not ask twice.',
        opener: 'Hi Carrie - Alice here. I do the money side of a honey business and I am stuck on payouts for smallholders. Your Ruwa setup is the closest thing to what I need. Fifteen minutes this week?',
      }) }] } }] });
    }
    const dossier = (() => {
      const i = prompt.lastIndexOf('Dossier: ');
      try { return JSON.parse(prompt.slice(i + 9)); } catch { return {}; }
    })();
    const found = Array.isArray(dossier.matches) ? dossier.matches : [];
    const names = found.map((m) => m.name).join(' and ');
    const bySituation = {
      chat: 'I was hoping somebody would ask me something interesting - who are you after today?',
      help: 'I am Linky - I read this network for you. Say who you need and I bring you the ones that fit, or tell you plainly that nobody does yet.',
      limit: `That is today's ${dossier.asks_limit_today} asks gone, friend. It resets at midnight, and looking somebody up by name is always free.`,
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
  if (u.includes('/zen/v1/chat/completions')) {
    calls.zen += 1;
    if (zenDown) return json({ error: { message: 'Zen is having a day' } }, 503);
    const asked = JSON.parse(init.body || '{}');
    const content = String(asked?.messages?.[0]?.content || '');
    if (/give 3 concrete places or ways/.test(content)) {
      return json({ choices: [{ message: { content: 'Zen says: try the UZ CS society, the Harare Angular meetup and LinkedIn with a Harare filter. Message the two people who posted last week.' } }] });
    }
    return json({ choices: [{ message: { content: JSON.stringify({ reply: 'Zen wrote this sentence because Gemini is down - I am still me, just on the other key.', suggest: ['a react developer in harare', 'help'] }) } }] });
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

const setHang = (v) => { hangProviders = v; };
// what the intent gate will say, per test. null = it declines, so the word lists
// decide - which is exactly what happens when no provider answers at all.
let intentMode = null, intentTopic = '', intentReply = '';
const setIntent = (mode, { topic = '', reply = '' } = {}) => { intentMode = mode; intentTopic = topic; intentReply = reply; };
const clearIntent = () => { intentMode = null; intentTopic = ''; intentReply = ''; };
const L = await import('../../api/_linky.js');
const S = await import('../../api/_serpapi.js');
const { botReplyForTest } = await import('../../api/linky.js');
const db = (await import('../../api/_firebaseAdmin.js')).getDb();

// the free plan is 2 searches a day now; every section tops its members up so it
// is testing the matcher, not the paywall (the budget section sets counts itself)
const MEMBERS = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'henry', 'irene', 'jack', 'kenji', 'lucy', 'luke', 'freda', 'zanele', 'tinashe', 'farai', 'chipo', 'nia', 'rafael', 'sofia', 'omar', 'priya', 'noah', 'amelie', 'dmitri'];
const clearBudget = async (uid) => {
  await db.collection('linkyState').doc(uid).set({ asks: { day: 'test-reset', count: 0 }, meets: { day: 'test-reset', count: 0 } }, { merge: true });
};
const resetBudgets = async () => { for (const u of MEMBERS) await clearBudget(u); };

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

const nowSuffix = () => Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
let failed = 0;
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); failed += 1; } else console.log('ok  -', msg); };
const has = (s, re) => re.test(String(s || ''));

// ================================================================ name lookup
await resetBudgets();
let r = await L.ask('alice', 'fred');
console.log('    LINKY>', r.reply);
assert(r.kind === 'person' && r.cards.length === 1 && r.cards[0].targetUid === 'fred', '"fred" finds the human instead of saying nobody fits');
assert(r.free === true && r.asksLeft === L.LIMITS.free.asksPerDay, `a name lookup costs no ask (free plan has ${L.LIMITS.free.asksPerDay} searches a day)`);
assert(r.reply.length > 30 && r.reply.length < 700 && /I checked, that is a real profile/.test(r.reply), 'the sentence is the model wording, not a stamped template');
assert(/^(?:hey |hi )?Alice[.!]/i.test(r.reply), 'the member name is prepended by the app, never asked of the model: ' + r.reply.slice(0, 12));
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
await resetBudgets();
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
await resetBudgets();
await L.setPrefs('bob', { inboundCap: 0 });
r = await L.ask('alice', 'bob chikwanha');
assert(r.kind === 'person' && !r.cards.length && r.nearest.some((n) => n.uid === 'bob'), 'a member who switched intros off is found, not reported missing');
assert(has(r.reply, /switched|off|not taking|intro/i), 'and Linky explains the closed door: ' + r.reply.slice(0, 90));


// ================================================================ chit-chat
await resetBudgets();
await resetBudgets();
calls.gemini = 0;
const hi = await L.ask('luke', 'hi');
assert(hi.kind === 'chat' && hi.free === true && hi.asksLeft === L.LIMITS.free.asksPerDay, `a greeting is chat, not a search, and costs nothing (free plan is ${L.LIMITS.free.asksPerDay} searches a day)`);
assert(calls.gemini === 1, 'chit-chat wording is exactly one small Gemini call: ' + calls.gemini);
assert(/hoping somebody would ask/i.test(hi.reply), 'the model wrote the sentence (mocked): ' + hi.reply.slice(0, 60));
assert(Array.isArray(hi.suggest) && hi.suggest.length >= 2, 'Linky offers tappable replies instead of a dead end');
const hiAgain = await L.ask('freda', 'hi');
assert(calls.gemini === 2, 'chit-chat is written fresh for each person, not replayed from a cache - a greeting everybody shares is what starts to sound like a form');
assert(hiAgain.kind === 'chat' && hiAgain.free === true, 'and she gets the same courtesy, not a search report: ' + hiAgain.kind);
assert(!/Alice/.test(hi.reply + hiAgain.reply), 'and no other member name leaks into a reply');
assert(!/(^|[.!?]\s)(hey |hi |hello )?Freda\b/i.test(hiAgain.reply), 'a greeting is not opened with the member name like a letter: ' + hiAgain.reply.slice(0, 50));
// the name still belongs where the answer is about people
const namedFor = await L.ask('freda', 'bob chikwanha');
assert(namedFor.kind === 'person' && /Freda/.test(namedFor.reply), 'but an answer about a person is still addressed to the member: ' + namedFor.reply.slice(0, 60));
// the real complaint, verbatim: a person who wants to talk was answered like a
// search engine that found nothing
const blunt = await L.ask('luke', 'no one else in mind jusy want to chat');
assert(blunt.kind === 'chat' && blunt.free === true, 'the "I just want to chat" message is chat, not a search that found nobody: ' + blunt.kind);
assert(!/Nobody on LINKUP|nobody here fits|checked all|visible profiles|56/i.test(blunt.reply), 'and never gets the audit-style "nobody fits" sentence: ' + blunt.reply.slice(0, 110));
const bluntButReal = await L.ask('luke', 'i just want to chat about a flutter developer');
assert(bluntButReal.kind !== 'chat', 'a chat sentence that names a role is still a search: ' + bluntButReal.kind);
const boredAsk = await L.ask('luke', 'are you a real person');
assert(boredAsk.kind === 'chat' && boredAsk.free, 'and "are you a real person" is answered like a person, not a query');

const thanks = await L.ask('luke', 'thanks linky');
assert(thanks.kind === 'chat' && thanks.free === true, 'thanks is chat too, still free');
const lukeState = await db.collection('linkyState').doc('luke').get();
assert(Number(lukeState.data().asks.count) === 1, 'only the one real search was metered for luke, not the small talk: ' + lukeState.data().asks.count);

// ================================================================ the thread
await resetBudgets();
const home = await L.home('luke');
assert(Array.isArray(home.thread) && home.thread.length >= 4, 'home returns a thread, not one answer');
assert(home.thread.filter((t) => t.role === 'linky').length === home.thread.filter((t) => t.role === 'user').length, 'every question has a Linky turn back');
assert(home.thread.every((t) => !/[*_`#]|^\s*[-•]>/.test(t.text)), 'no markdown ever reaches a chat bubble');
assert(home.thread.length <= L.LIMITS.threadTurns, 'the thread is capped so the doc cannot grow forever');

// ================================================================ keep going
await resetBudgets();
const first = await L.ask('freda', 'a developer in harare');
const seenNames = first.cards.map((c) => c.targetUid);
const elseAsk = await L.ask('freda', 'who else do you have');
assert(elseAsk.asksLeft === first.asksLeft - 1, '"who else" is a real search, so it costs one ask');
assert(elseAsk.cards.every((c) => !seenNames.includes(c.targetUid)), 'the second lap never repeats who was already shown: ' + elseAsk.cards.map((c) => c.targetName).join(', '));

// ================================================================ budget
await resetBudgets();
await db.collection('linkyState').doc('alice').set({ asks: { day: L.dayKey(), count: L.LIMITS.free.asksPerDay } }, { merge: true });
let lim = null;
try { await L.ask('alice', 'a quantum cryptographer in oslo'); } catch (e) { lim = e; }
assert(lim && lim.code === 'ask_limit' && has(lim.message, /midnight|reset/i), 'out of asks says when it resets, kindly: ' + lim?.message);
const freeName = await L.ask('alice', 'fred');
assert(freeName.kind === 'person' && !freeName.reply.includes('used up'), 'even with zero asks left, a name lookup still works');

// ================================================================ the bots
await resetBudgets();
await db.collection('linkyState').doc('alice').set({ asks: { day: L.dayKey(), count: 0 } }, { merge: true });
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
// ---- the surface the member actually reads. The complaint was that Telegram
// showed neither the people nor their LinkedIn profiles, so the taps are tested
// where they are rendered, not only in the brain underneath.
{
  const lines = String(br.text).split('\n');
  assert(/linkedin\.com\/in\//.test(br.text), 'the bot prints the public profile, so a phone tap opens it: ' + br.text.slice(0, 55).replace(/\n/g, ' | '));
  assert(lines.some((l) => /^https?:\/\/\S*linkedin\.com\/in\//.test(l.trim())), 'the url gets a line of its own instead of being buried mid-sentence');
  assert(Array.isArray(br.buttons) && br.buttons.some((row) => row.some((b) => /Draft/.test(b.text) && /^w:/.test(String(b.callback_data)))), 'and every person carries a Draft tap');
  const tapped = await botReplyForTest('telegram', '777', '', { callback: 'w:1' });
  assert(tapped.text.length > 90 && /paste|yourself|goes nowhere/i.test(tapped.text), 'a tap on Draft writes the message right there: ' + tapped.text.slice(0, 55).replace(/\n/g, ' | '));
  const ids = JSON.stringify(tapped.buttons || []);
  assert(/ld:y/.test(ids) && /ld:n/.test(ids), 'with approve and never-show-me-again as taps, not typing exercises');
  const afterSent = await botReplyForTest('telegram', '777', 'sent');
  assert(has(afterSent.text, /logged|reply/i), 'typing "sent" is understood: ' + afterSent.text.slice(0, 55));
  const declined = await botReplyForTest('telegram', '777', 'not interested 2');
  assert(has(declined.text, /gone|not put/i), 'and so is "not interested 2": ' + declined.text.slice(0, 55));
  const again = await botReplyForTest('telegram', '777', 'more');
  assert(!/Tinashe|Rutendo/.test(again.text) && /Nyasha/.test(again.text), 'the two they dealt with are not re-served, the one still new is: ' + again.text.slice(0, 50).replace(/\n/g, ' | '));
  assert(/2 already in your outreach history|2 people I have already sent/.test(again.text) && /1 is new to you/.test(again.text), 'and it says plainly how many the search found versus what is left: ' + again.text.slice(0, 70).replace(/\n/g, ' | '));
  assert(again.text.split('\n').filter((l) => /^https?:\/\//.test(l.trim())).length === 1, 'one line per remaining profile, and only that one: ' + again.text.split('\n').filter((l) => /^https?:/.test(l.trim())).length);
  assert(!/Say "draft 2"/.test(again.text) && /draft 1/.test(again.text), 'the hint points at a number that is on the list: ' + String(again.text).split('\n').pop());
  const fsTg = await import('node:fs');
  const srcTg = fsTg.readFileSync(new URL('../../api/linky.js', import.meta.url), 'utf8');
  assert(/r\.buttons\?\.length\s*\?\s*\{\s*inline_keyboard: r\.buttons\s*\}/.test(srcTg), 'the message path attaches those buttons to the Telegram send');
  assert(/sendTelegram\(chatId, r\.text, r\.buttons \? \{ inline_keyboard: r\.buttons \} : undefined\)/.test(srcTg), 'and so does the callback path, so a tap is answered with taps');
}
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
await resetBudgets();
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
/* ------------------------------- two things the first cut got wrong
   A skip that could never be undone, and one member being able to spend the
   whole month of searches on a Tuesday morning. */
{
  const card = await L.pickPerson('alice', 'fred');
  assert(card && card.id, 'picking the person from the ambiguous list puts a card in front of her');
  await L.setCardStatus('alice', card.id, 'skip');
  const ctx = await L.buildMatchContext();
  const st = await L.loadState('alice');
  const cards = await L.loadCards('alice');
  const whileSkipped = L.findByName(L.parseAsk('fred moyo'), ctx, { meUid: 'alice', myState: st, existingCards: cards });
  assert(/you skipped them recently/i.test(whileSkipped.match.blocked || ''), 'a skipped person is left alone, and says so: ' + whileSkipped.match.blocked);
  assert(/unskip fred/i.test(whileSkipped.match.blocked || ''), 'and the way back is named in the sentence, not hidden in a doc: ' + whileSkipped.match.blocked);
  const undone = await L.ask('alice', 'unskip fred');
  assert(/back in your results/i.test(undone.reply) && undone.free, 'say "unskip fred" and they are back, for free: ' + undone.reply.slice(0, 90));
  const afterCtx = await L.buildMatchContext();
  const after = L.findByName(L.parseAsk('fred moyo'), afterCtx, { meUid: 'alice', myState: await L.loadState('alice'), existingCards: await L.loadCards('alice') });
  assert(!after.match.blocked, 'the blocker is really gone, not just the wording');
  const nothing = await L.ask('alice', 'unskip nobody here');
  assert(/nothing to undo/i.test(nothing.reply), 'unskip of a name she never skipped says so plainly');

  // per-member fairness on the shared search budget - and the account has to look
  // solvent again first, or plan-exhausted would mask the cap
  serpAccount = { total_searches_left: 240, searches_per_month: 250, plan_name: 'Free Plan' };
  S.resetCreditsCache();
  const day = new Date().toISOString().slice(0, 10);
  await db.collection('linkyOutreach').doc(`day_alice_${day}`).set({ uid: 'alice', day, searches: S.OUTREACH.perMemberPerDay });
  const gated = await S.canSearch({ uid: 'alice', plus: true });
  assert(gated.ok === false && gated.reason === 'member-day-cap', `one member cannot outspend the plan: ${JSON.stringify(gated)}`);
  const someoneElse = await S.canSearch({ uid: 'bob', plus: false });
  assert(someoneElse.ok === true, 'and the cap is per member - bob is not punished for alice being keen');
  const idle = await S.findLeads('an iot engineer for a farm sensor startup in harare', { place: 'Harare', uid: 'alice' });
  assert(idle.leads.length === 0 && idle.searches === 0 && idle.note === 'member-day-cap', 'findLeads degrades to "advice only" instead of erroring when the member is capped');
  await db.collection('linkyOutreach').doc(`day_alice_${day}`).delete();
}


/* ------------------------------- the real captured SerpApi payload
   functions/tests/fixtures/serpapi-fintech-zw.json is one live search, saved by
   the earlier run of this feature. Link shapes and field names drift on
   Google's side, so the prefilter and the wrapper-unwrapping are tested
   against the real thing, not only against a mock. */
{
  const fs = await import('node:fs');
  const fixture = JSON.parse(fs.readFileSync(new URL('../../functions/tests/fixtures/serpapi-fintech-zw.json', import.meta.url), 'utf8').toString().replace(/https:\/\/www\.google\.com\/url\?sa=t&source=web&rct=j&url=\S+/g, 'https://www.google.com/url?sa=t&url=https%3A%2F%2Fzw.linkedin.com%2Fin%2Fcaptured-person'));
  const organic = fixture.organic_results;
  assert(Array.isArray(organic) && organic.length >= 5, `fixture: a real SERP page (${(organic || []).length} results)`);
  const kept = S.prefilter(organic, {
    words: ['fintech', 'developer', 'founder', 'ceo', 'harare'],
    roles: ['founder', 'ceo', 'developer'],
  });
  assert(kept.length >= 3, `the local prefilter keeps the people on a real page: ${kept.length}/${organic.length} rows made it to the model`);
  // ...and rejects what a SERP page also contains: a company page, a news item,
  // a jobs board. Same shape as the real rows, so only the rules can catch them.
  const polluted = S.prefilter([...organic,
    { position: 91, title: 'Flutter - Wikipedia', snippet: 'Flutter is an open-source mobile UI framework created by Google.', link: 'https://en.wikipedia.org/wiki/Flutter' },
    { position: 92, title: 'Zimbabwe fintech news', snippet: 'The Reserve Bank of Zimbabwe announced new rules for fintechs in Harare this week.', link: 'https://example.com/news' },
    { position: 93, title: '15 Fintech jobs in Harare', snippet: 'Apply now for fintech developer roles hiring urgently in Harare.', link: 'https://example.com/jobs' },
  ], { words: ['fintech', 'developer', 'founder', 'ceo', 'harare'], roles: ['founder', 'ceo', 'developer'] });
  assert(polluted.length === kept.length, `a real page's company / news / jobs rows are rejected locally, before any token: ${polluted.length} kept of ${organic.length + 3}`);
  assert(kept.every((k) => k.name && k.rawLink), 'every kept row carries a person name and the link to unwrap later - no second search');
  const wrapped = kept.filter((k) => String(k.rawLink).startsWith('/'));
  assert(wrapped.length >= 1, `a real page wraps hrefs hostlessly (/goto?url=) - ${wrapped.length} of ${kept.length} here, the unwrapper lives with that`);
  // the captured token is opaque and long expired, so the only honest answer is
  // "blank" - which is what lets cleanLinks() fall back to a search link instead
  // of inventing a profile url. A live resolution is asserted above with a mock.
  const unwrapped = await S.cleanLink(wrapped.length ? wrapped[0].rawLink : kept[0].rawLink);
  assert(unwrapped === '' || /linkedin\.com/i.test(unwrapped), `a dead wrapper returns blank rather than a guessed url: ${JSON.stringify(unwrapped)}`);
  const abs = 'https://www.google.com/url?sa=t&url=' + encodeURIComponent('https://zw.linkedin.com/in/captured-person');
  assert((await S.cleanLink(abs)) === 'https://zw.linkedin.com/in/captured-person', 'the google.com/url form is read without a request when it already carries the destination');
  const plain = 'https://zw.linkedin.com/in/already-clean';
  assert((await S.cleanLink(plain)) === plain, 'an already-clean profile url is passed straight through');
}


serpAccount = { total_searches_left: 240, searches_per_month: 250, plan_name: 'Free Plan' };
S.resetCreditsCache();
await L.setPrefs('freda', {});
const noMatch = await L.ask('freda', 'a veterinary surgeon for a cattle clinic in Gweru');
assert(noMatch.none, 'setup: a need LINKUP genuinely does not cover (' + noMatch.reply.slice(0, 60) + ')');
const beforePt = { ...calls };
const pointers = await L.pointers('freda', 'a veterinary surgeon for a cattle clinic in Gweru');
assert(pointers.leads.length >= 1 && pointers.leads[0].name && /Tendai/i.test(pointers.leads[0].name), 'outside LINKUP returns the person it found as data: ' + JSON.stringify(pointers.leads[0]).slice(0, 120));
assert(calls.serp - beforePt.serp === 1, 'one search for one question, whatever the member count');
assert(has(pointers.text, /no contact details|no emails|not collect/i), 'and the one line it does say tells them plainly what was not collected: ' + pointers.text.slice(0, 90));
// the presentation the member complained about: the prose used to paste the whole
// list into itself, so the app showed every name twice and the bot read it as a wall
assert(pointers.text.split('\n').length <= 2 && !/;/.test(pointers.text) && !/Tendai/.test(pointers.text), 'the prose is a short intro, not the list again: ' + JSON.stringify(pointers.text).slice(0, 90));
assert(pointers.found === pointers.leads.length && pointers.intro.length > 30, 'and the answer carries intro/found/leads, so any surface can render it as rows');
assert(pointers.leads[0].key && pointers.leads.every((l) => l.key), 'every lead has a key, which is what lets a decline stick');
// the bubble names them; the link travels as data so the app can open it and the
// bot can render it as a button - a bare url pasted into prose is the worst of both
assert(has(pointers.leads[0].title, /veterinary|surgeon/i) && !/&[a-z]+;|&#\d+;/.test(pointers.leads[0].title), 'each lead arrives with a clean title, no HTML entities left in it');
assert(pointers.title === undefined && typeof pointers.leads[0].name === 'string' && !/\.{3}$/.test(pointers.leads[0].title), 'and the title is not sliced mid-word by a hard character cap');
assert(/^https:\S*linkedin\.com\/in\//.test(pointers.leads[0].url || ''), 'and carries a public profile URL the client can open :: ' + JSON.stringify(pointers.leads[0]));
assert(pointers.leads.every((l) => l.resolved || /google\.com\/search/.test(l.url)), 'an unresolved link stays an honest search fallback, never a broken profile url');
assert(!/\{|"reply"/.test(pointers.text), 'the advice is prose, never the raw model JSON');

// ---- the reply a member actually reads: no stale shapes, no entities, no echoes
{
  const cacheDocs = await db.collection('linkyCache').get();
  assert(cacheDocs.docs.some((d) => d.id.startsWith('p2_')), 'the outside answer is cached under a new key, so prose written in the old run-on shape can never be replayed');
  await Promise.all(cacheDocs.docs.filter((d) => d.id.startsWith('p2_')).map((d) => d.ref.delete()));
  const serpsNow = calls.serp;
  const warm = await L.pointers('freda', 'a veterinary surgeon for a cattle clinic in Gweru');
  assert(calls.serp === serpsNow && warm.leads.length >= 1, 're-asking after the bump reuses the saved SERP at 0 credits, and still answers with people: ' + JSON.stringify({ s: calls.serp - serpsNow, n: warm.leads.length }));
  assert(/earlier/.test(warm.intro) && !/just now/.test(warm.intro), 'and it admits it reused a search instead of claiming a new one: ' + warm.intro.slice(0, 70));
  assert(!/&amp;|&#\d+;|\.{3}/.test(warm.text + warm.leads.map((l) => `${l.name} ${l.title} ${l.why}`).join(' ')), 'no raw HTML entities and no dangling ellipsis anywhere in the reply');
  assert(!/^outside linkup/i.test(warm.intro) && !/outreach line/i.test(warm.text), 'it does not restate the label printed above it, and the old "Outreach line:" stamp is gone');
  assert(warm.text.length < 700, 'one readable block on Telegram, not an essay: ' + warm.text.length + ' chars');
  // and the ask stops being parroted back at the member
  assert(L.polishNeed('find a 5 star tutor') === '5-star tutor', 'the ask is reduced to what they are after: ' + L.polishNeed('find a 5 star tutor'));
  assert(L.polishNeed('looking for a flutter developer in harare') === 'flutter developer in harare', 'verbs and filler come off the front');
  assert(L.polishNeed('a vet') === 'a vet' && L.polishNeed('') === '', 'and a short ask is never stripped into nonsense');
  const parrot = await L.pointers('freda', 'a veterinary surgeon for a cattle clinic in Gweru').catch(() => null);
  assert(parrot === null || !/find a |looking for /.test(parrot.intro), 'the intro never contains the instruction, only the thing');
}

// ---- a long answer must still arrive: Telegram refuses >4096 chars, and the old
// code "handled" it with slice(0,4000), which cut links mid-handle
{
  const leadLine = (i) => `${i}. Person Surname - Senior Electrical & Electronic Engineer\n   ships fintech rails\n   https://zw.linkedin.com/in/some-person-${i}-with-a-longish-handle-123456`;
  const big = ['Nobody on LINKUP does this yet. Public profiles only.', '', ...Array.from({ length: 60 }, (_, i) => leadLine(i + 1)).flatMap((x) => [x, ''])].join('\n');
  const chunks = L.splitTelegram(big);
  assert(chunks.length >= 2 && chunks.every((c) => c.length <= 4096), 'a 9k answer is split into Telegram-sized pieces, not truncated: ' + chunks.map((c) => c.length).join('/'));
  const urls = (t) => (String(t).match(/https:\/\/\S+/g) || []);
  assert(urls(chunks.join('\n')).length === urls(big).length && urls(chunks.join('\n')).every((u) => /-123456$/.test(u)), 'every profile URL survives the split whole: ' + urls(chunks.join('\n')).length + '/' + urls(big).length);
  const srcTg2 = (await import('node:fs')).readFileSync(new URL('../../api/linky.js', import.meta.url), 'utf8');
  assert(!/telegramApi\('sendMessage'/.test(srcTg2), 'the webhook sends through the splitter on the message path too, so a 400 cannot silently eat a reply');
  assert(/sendTelegram\(chatId, r\.text, markup\)/.test(srcTg2), 'and the typed path uses it with the markup attached');
}

// ================================================================ permissioned outreach
// The rule the whole feature hangs on: Linky writes, a human approves, exactly one
// message moves - and every intent, sent or declined, is kept so the graph learns.
const dk = await L.draftLead('freda', { index: 1 });
assert(dk.ok && dk.key === pointers.leads[0].key && dk.text.length > 60, 'a draft exists for the tapped person, keyed to them: ' + JSON.stringify({ key: dk.key, n: dk.text.length }));
assert(/Tendai|vet|clinic|surgeon/i.test(dk.text), 'and it names their actual work rather than a template: ' + dk.text.slice(0, 70).replace(/\n/g, ' '));
assert(dk.url === pointers.leads[0].url && /paste this/i.test(dk.howTo), 'the profile URL travels with it, and the instruction is that the member sends it');
assert(!/hope this finds you well|I would love to pick|game-?changer|thrilled|excited to connect/i.test(dk.text), 'the lead draft is not slop');
assert((await L.home('freda')).pending?.lead?.key === dk.key, 'the draft waits on the member, and survives a reload');
assert(!(await db.collection('outreachIntents').where('uid', '==', 'freda').get()).size, 'nothing is recorded as approved while nobody has read it');
const OWN = 'Dr Mhlanga - Freda here, I run a small animal practice in Gweru. Two cattle cases we cannot triage are sitting on my desk. Fifteen minutes of your opinion on them, this week or next? If it is not something you want, say no and I will not ask again.';
const ap = await L.approveLead('freda', { key: dk.key, text: OWN });
assert(ap.ok && ap.edited && ap.text === OWN && ap.intentId, 'the member may rewrite it, and their words are what is kept: ' + JSON.stringify({ edited: ap.edited, id: !!ap.intentId }));
assert(ap.url === pointers.leads[0].url, 'approve hands the profile back to open, it does not send anything itself');
const rec = await db.collection('outreachIntents').doc(ap.intentId).get();
assert(rec.exists && rec.data().status === 'approved_for_self_send' && rec.data().text === OWN, 'the intent is stored as a graph record: who, what, and that a human approved it');
const trail = (await L.home('freda')).outreach || [];
assert(trail.some((e) => e.key === dk.key && e.status === 'drafted') && trail.some((e) => e.key === dk.key && e.status === 'approved'), 'and the member state keeps the whole trail, drafted then approved');
assert(trail.every((e) => e.name), 'every trail row says who it was about');
// decline is a mute, and it survives the cache - without spending another credit
const dk2 = await L.draftLead('freda', { index: 1 });
const mute = await L.markLead('freda', { key: dk2.key, status: 'not_interested' });
assert(mute.muted === true && /not put them in front/i.test(mute.note), 'a decline mutes, in plain words: ' + mute.note);
const serpsBefore = calls.serp;
const after = await L.pointers('freda', 'a veterinary surgeon for a cattle clinic in Gweru');
assert(after.cached && !after.leads.some((l) => l.key === dk2.key) && after.skipped >= 1, 'the muted person is gone from the cached answer too, and the count says why: ' + JSON.stringify({ found: after.found, skipped: after.skipped }));
assert(calls.serp === serpsBefore, 'and that was done from state, not by re-searching - the free plan stays intact');
assert(after.routes.length >= 1, 'with nobody left to show, it falls back to routes instead of a dead end');
// "sent" is its own remembered state
const dk3 = await L.draftLead('freda', { index: 1 });
const sentMark = await L.markLead('freda', { key: dk3.key, status: 'sent' });
assert(sentMark.status === 'sent' && /bring them into LINKUP/i.test(sentMark.note), '"sent" is logged and points at the next step: ' + sentMark.note);
assert(((await L.home('freda')).outreach || []).some((e) => e.key === dk3.key && e.status === 'sent'), 'the trail shows the message the member actually sent');
// a draft can be dropped, and dropping one is not a failure
await L.draftLead('freda', { index: 1 });
await L.dropLeadDraft('freda');
assert(!(await L.home('freda')).pending?.lead, 'a dropped draft leaves nothing pending');
// approving something that was never drafted is refused, not faked
let badLead = null;
try { await L.approveLead('freda', { key: 'nope', text: 'a perfectly reasonable sentence about meeting up' }); } catch (err) { badLead = err; }
assert(badLead && /write it first/i.test(badLead.message), 'approve with nothing pending says so: ' + String(badLead?.message));

// ================================================================ never leave them on "typing"
// A message that dies in the function is indistinguishable, from a phone, from a
// bot that ignores people. Three ways that happened, all asserted here.
{
  // 1. a bad keyboard must be repaired, not sent (Telegram rejects the WHOLE
  //    message for one unusable button, and the words go with it)
  const long = 'p:' + encodeURIComponent('a veterinary surgeon for a cattle clinic in Gweru, Zimbabwe, paid well');
  const fixed = L.sanitizeTelegramMarkup({
    inline_keyboard: [
      [{ text: '1. Nobody Atall', url: '' }, { text: 'Draft', callback_data: 'w:1' }],
      [{ text: 'Search LinkedIn', callback_data: long }],
    ],
  });
  const flat = fixed.inline_keyboard.flat();
  assert(flat.every((b) => !('url' in b) || /^https?:\/\//.test(b.url)), 'an unusable url button is turned into something that opens, not shipped as a 400: ' + JSON.stringify(flat[0]).slice(0, 90));
  assert(flat.every((b) => !b.callback_data || Buffer.byteLength(b.callback_data, 'utf8') <= 64), 'callback_data is held to Telegram 64-byte ceiling: ' + flat.map((b) => Buffer.byteLength(b.callback_data || '', 'utf8')).join('/'));
  assert(flat.some((b) => /google\.com\/search/.test(b.url || '')), 'the unresolved profile still gets a real search link');
  assert(L.sanitizeTelegramMarkup({ inline_keyboard: [[{}]] }) === undefined, 'a keyboard with nothing usable is dropped entirely rather than sent');
  assert(L.sanitizeTelegramMarkup({ keyboard: [[{ text: 'x'.repeat(200) }]] }).keyboard[0][0].text.length === 100, 'a chip is capped to Telegram 100-character limit, not rejected');

  // 2. if Telegram still refuses the markup, the words must arrive without it
  const tokenWas = process.env.TELEGRAM_BOT_TOKEN;
  const fetchWas = globalThis.fetch;
  let tgCalls = [];
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  void tokenWas;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init?.body || '{}');
    tgCalls.push({ hasMarkup: !!body.reply_markup, len: String(body.text || '').length });
    if (body.reply_markup) return { ok: false, status: 400, json: async () => ({ description: 'Bad Request: can  parse InlineKeyboardButton' }) };
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  };
  const sent = await L.sendTelegram('777', 'Here are the people I found.', { inline_keyboard: [[{ text: 'bad', url: 'not-a-url' }]] });
  globalThis.fetch = fetchWas; process.env.TELEGRAM_BOT_TOKEN = tokenWas;
  assert(sent === true && tgCalls.length === 2 && tgCalls[0].hasMarkup && !tgCalls[1].hasMarkup, 'a refused keyboard is retried as plain text so the member still gets an answer: ' + JSON.stringify(tgCalls));

  // 3. the handler answers within its own budget instead of being killed at 60s
  const budgetWas = process.env.LINKY_BOT_BUDGET_MS;
  process.env.LINKY_BOT_BUDGET_MS = '1200';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  setHang(true);
  const handler = (await import('../../api/linky.js')).default;
  const fakeRes = { statusCode: 0, payload: null, status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; }, send(o) { this.payload = o; return this; }, setHeader() { return this; }, end() { return this; } };
  const startedAt = Date.now();
  await handler({
    method: 'POST', query: { channel: 'telegram' },
    headers: { 'x-telegram-bot-api-secret-token': L.telegramWebhookSecret() },
    body: { update_id: 424242, message: { message_id: 9, chat: { id: 777, type: 'private' }, from: { id: 777, first_name: 'Alice' }, text: 'a quantum cryptography professor from oslo' } },
  }, fakeRes);
  const took = Date.now() - startedAt;
  setHang(false);
  process.env.LINKY_BOT_BUDGET_MS = budgetWas;
  const delivered = tgSends.filter((b) => /ran past my|I am here|still here/i.test(b.text || ''));
  const faults = await db.collection('linkyOutreach').get();
  assert(fakeRes.statusCode === 200, 'the webhook still answers Telegram with a 200 (no retry storm): ' + fakeRes.statusCode);
  assert(took < 7000, 'and it did not sit and wait for the model: ' + took + 'ms with providers hanging 9s (floor budget is 4s)');
  assert(faults.docs.some((d) => d.id.startsWith('tg_err_') && d.data().kind === 'deadline'), 'the slow reply is recorded where it can be read, because there is no log to grep in production');
  assert(delivered.length >= 1, 'and the member was actually sent something instead of an endless typing dot: ' + JSON.stringify((delivered[0]?.text || '').slice(0, 50)));
  // and the handler never swallows a break in silence any more
  const hSrc = (await import('node:fs')).readFileSync(new URL('../../api/linky.js', import.meta.url), 'utf8');
  assert(/Promise\.race\(\[job, slow\]\)/.test(hSrc) && /recordBotFault\('throw'/.test(hSrc) && /That one broke on my side/.test(hSrc), 'a throw in the reply path is both reported to the member and recorded');

  // the "Search LinkedIn" button survives a long ask: it stops pretending and uses state
  const long2 = await botReplyForTest('telegram', '777', 'a veterinary surgeon for a cattle clinic in Gweru, Zimbabwe, paid well and free this week');
  const cb = (long2.buttons || [])[0]?.[0]?.callback_data || '';
  assert(cb === 'p:last' || Buffer.byteLength(cb, 'utf8') <= 64, 'the tap never carries a callback Telegram will reject: ' + JSON.stringify(cb));
  const viaLast = await botReplyForTest('telegram', '777', '', { callback: 'p:last' });
  assert(viaLast.text.length > 40 && !/Ask me who you need first/.test(viaLast.text), 'p:last resolves to the ask on record, so the button works: ' + viaLast.text.slice(0, 50).replace(/\n/g, ' '));
}

// ================================================================ what Linky is not told
await resetBudgets();
// Carrie is built so that "keeps bees" appears in exactly three of her fields -
// skill, headline and bio - which is what makes hiding worth testing at all.
const CARRIE = { uid: 'carrie', displayName: 'Carrie Moyo', occupation: 'Beekeeper', company: 'Ruwa Farms', city: 'Harare', country: 'Zimbabwe', skills: ['beekeeping', 'sales'], industries: ['agriculture'], bio: 'Runs beekeeping workshops for schools', onboarded: true, isVisible: true };
await db.collection('users').doc('carrie').set(CARRIE);
await db.collection('publicProfiles').doc('carrie').set({ ...CARRIE, profilePic: 'https://ik/carrie.jpg' });
const beeAsk = 'someone who keeps bees';
await clearBudget('alice');
const withCarrie = await L.ask('alice', beeAsk);
assert(withCarrie.cards.some((c) => c.targetUid === 'carrie'), `setup: Carrie answers to "${beeAsk}"`);
await L.hideFact('carrie', { kind: 'skills', value: 'beekeeping', hide: true });
const afterHideAudit = await L.audit('carrie');
assert((afterHideAudit.hidden?.skills || []).includes('beekeeping'), 'the audit shows what is being held back');
const pub = (await db.collection('publicProfiles').doc('carrie').get()).data();
assert((pub.skills || []).includes('beekeeping') && pub.occupation === 'Beekeeper', 'hiding never touches the public profile, only what Linky knows');
await clearBudget('alice');
await db.collection('linkyState').doc('alice').set({ lastAsk: null, recentAsks: [] }, { merge: true });
const afterHide = await L.ask('alice', 'a person who keeps bees near Harare');
assert(!afterHide.cards.some((c) => c.targetUid === 'carrie'), 'hiding the skill takes "Beekeeper" and "beekeeping workshops" with it - the match is gone: ' + JSON.stringify(afterHide.cards.map((c) => c.targetName)));
assert(!/beekeep/i.test(JSON.stringify(afterHide.cards.map((c) => c.why))), 'and it is never quoted in a reason');
// a fact nobody hid is still fair game: hiding one thing is not hiding everything
await clearBudget('alice');
await db.collection('linkyState').doc('alice').set({ lastAsk: null, recentAsks: [] }, { merge: true });
const stillThere = await L.ask('alice', 'someone who runs workshops for schools');
assert(stillThere.cards.some((c) => c.targetUid === 'carrie'), 'what was not withheld still works - hiding is per fact, not a blackout');
await L.hideFact('carrie', { kind: 'bio', value: 'bio', hide: true });
await clearBudget('alice');
await db.collection('linkyState').doc('alice').set({ lastAsk: null, recentAsks: [] }, { merge: true });
const bioHidden = await L.ask('alice', 'who runs workshops for schools around Harare');
assert(!bioHidden.cards.some((c) => c.targetUid === 'carrie'), 'and the bio can be withheld on its own too');
await L.hideFact('carrie', { kind: 'bio', value: 'bio', hide: false });
await L.hideFact('carrie', { kind: 'skills', value: 'beekeeping', hide: false });
const restored = await L.audit('carrie');
assert(!(restored.hidden?.skills || []).includes('beekeeping'), 'one tap gives it back');
await clearBudget('alice');
await db.collection('linkyState').doc('alice').set({ lastAsk: null, recentAsks: [] }, { merge: true });
const backAgain = await L.ask('alice', 'who keeps bees and sells honey');
assert(backAgain.cards.some((c) => c.targetUid === 'carrie'), 'and she is matchable again');

// "and forget that I ever asked"
const beforeForgets = (await L.audit('alice')).asks.length;
const removed = await L.removeAsk('alice', backAgain.id);
const afterForgets = await L.audit('alice');
assert(removed.forgotten === 1 && !afterForgets.asks.some((a) => a.id === backAgain.id), 'a single ask can be deleted without wiping everything');
assert(afterForgets.asks.length === beforeForgets - 1, 'the rest of the history is untouched');
const afterThread = await L.home('alice');
assert(!afterThread.thread.some((t) => t.id === backAgain.id), 'their turn and Linky\'s answer both leave the thread');

// ================================================================ the intro Linky writes
await resetBudgets();
await clearBudget('alice');
const forIntro = await L.ask('alice', beeAsk);
const target = forIntro.cards.find((c) => c.targetUid === 'carrie') || (await L.home('alice')).cards.find((c) => c.targetUid === 'carrie');
const said = await L.introPitch({ requester: { name: 'Alice Moyo', role: 'Founder', city: 'Harare' }, target: { name: 'Carrie Moyo', role: 'Beekeeper', city: 'Harare' }, need: beeAsk, why: 'sells honey at the farmers market', place: 'this week', seed: `t${nowSuffix()}` });
assert(said.usedAi === true && /Ruwa|hives/i.test(said.pitch), 'the pitch and the opener are written for this pair, not stamped out: ' + said.pitch.slice(0, 70));
assert(said.pitch.length < 520 && said.opener.length < 360, 'and they are short enough to actually be read');
assert(!/hope this finds you well|game-?changer|synergy|thrilled|honou?red|delve|exclamation/i.test(said.pitch + said.opener), 'none of the slop words survive into an intro');
assert(/\d+ minutes|fifteen minutes/i.test(said.pitch) && /no\b/i.test(said.pitch), 'a tiny ask and a no that costs nothing are both in there');
const noKey = await (async () => {
  const gk = process.env.GEMINI_API_KEY, zk = process.env.ZEN_API_KEY, g = geminiDown;
  process.env.GEMINI_API_KEY = ''; process.env.ZEN_API_KEY = '';
  const out = await L.introPitch({ requester: { name: 'Alice Moyo', role: 'Founder' }, target: { name: 'Carrie Moyo', role: 'Beekeeper', city: 'Harare' }, need: beeAsk, why: 'sells honey at the farmers market', seed: `t${nowSuffix()}b` });
  process.env.GEMINI_API_KEY = gk; process.env.ZEN_API_KEY = zk;
  return out;
})();
assert(noKey.usedAi === false && noKey.pitch.length > 60 && /Carrie/.test(noKey.pitch), 'with no key at all he still writes something a human would send');
if (target) {
  const drafted = await L.meet('alice', target.id);
  assert(drafted.needsApproval && /Carrie/.test(drafted.pitch) && drafted.pitch.length > 60, 'he drafts for Carrie and stops there: ' + drafted.pitch.slice(0, 60));
  assert(!(await db.collection('notifications').where('userId', '==', 'carrie').where('type', '==', 'intro_request').get()).size, 'and Carrie is told nothing until Alice approves');
  const meetRes = await L.approveMeet('alice', { cardId: target.id });
  const introDoc = meetRes.introId ? (await db.collection('intros').doc('alice_carrie').get()).data() : null;
  assert(introDoc && introDoc.pitch === drafted.pitch, 'what Alice approved is what the intro stores, unchanged');
  const note = (await db.collection('notifications').where('userId', '==', 'carrie').where('type', '==', 'intro_request').get()).docs[0]?.data();
  assert(!!note && /Ruwa|honey|bee/i.test(note.content || ''), 'the notification Carrie receives is the approved pitch, not a form letter: ' + String(note?.content).slice(0, 80));
}

// ================================================================ the second key
await resetBudgets();
const gkSave = process.env.GEMINI_API_KEY, zkSave = process.env.ZEN_API_KEY;
process.env.GEMINI_API_KEY = 'unit-gemini-key';
process.env.ZEN_API_KEY = 'unit-zen-key';
geminiDown = true;
calls.zen = 0;
await clearBudget('tapi1');
const rescued = await L.ask('tapi1', 'a react developer in harare');
assert(calls.gemini >= 1 && calls.zen >= 1, 'Gemini is tried first, Zen takes the hit when it fails');
assert(rescued.usedAi === true && /Zen wrote this sentence/.test(rescued.reply), 'and the member never sees an outage: ' + rescued.reply.slice(0, 70));
calls.zen = 0;
zenDown = true;
await clearBudget('tapi2');
const bothDown = await L.ask('tapi2', 'a node developer in harare');
assert(bothDown.usedAi === false && bothDown.reply.length > 20, 'with both keys down he answers in his own words instead of erroring');
assert(!/unit-gemini-key|unit-zen-key/.test(JSON.stringify(bothDown)), 'a provider failure never echoes a key back to the client');
process.env.GEMINI_API_KEY = gkSave; process.env.ZEN_API_KEY = zkSave;
geminiDown = false; zenDown = false;


// ================================================================ small talk is a conversation
// "yoo" used to come back as a search report, and every greeting got the same
// coaching sentence. Both were caching and routing problems, so both are asserted
// against the model path, where the copy actually comes from Gemini.
{
  await resetBudgets();
  await clearBudget('alice');
  const before = calls.gemini;
  const one = await L.ask('alice', 'yoo');
  const two = await L.ask('alice', 'yoo whats up');
  assert(one.kind === 'chat' && two.kind === 'chat' && !one.cards.length, 'on the AI path a greeting is still answered as chat: ' + JSON.stringify({ a: one.kind, b: two.kind }));
  assert(calls.gemini - before >= 2, 'and chit-chat is written fresh every time, never replayed from a fourteen-day cache');
  const wordingDocs = await db.collection('linkyCache').get();
  assert(!wordingDocs.docs.some((d) => (d.data().kind || '') === 'chat'), 'no chat wording is parked in the cache at all');
  assert(!/Nobody here fits|Situation chat/i.test(one.reply + two.reply), 'a greeting never comes back as a search report: ' + one.reply.slice(0, 50));
  const chill = await L.ask('alice', 'no just wanna chill');
  assert(chill.kind === 'chat' && chill.free === true, 'saying he is not looking for anybody is believed, not searched');
  const asked = await L.ask('alice', 'what can you do');
  assert(asked.kind === 'chat' && /read this network|who you need/i.test(asked.reply), 'asked what he does, he explains it his way: ' + asked.reply.slice(0, 55));
  const st = await L.loadState('alice');
  assert(Number(st.chitStreak || 0) >= 3, 'the banter is counted so the pitch can stay out of it');
}
// and when BOTH providers are down, the outage copy still reads like a person
{
  const gk = process.env.GEMINI_API_KEY, zk = process.env.ZEN_API_KEY;
  process.env.GEMINI_API_KEY = 'unit-gemini-key'; process.env.ZEN_API_KEY = 'unit-zen-key';
  geminiDown = true; zenDown = true;
  await clearBudget('tapi2');
  const outage = await L.ask('tapi2', 'yoo');
  const outage2 = await L.ask('tapi2', 'no just wanna chill');
  geminiDown = false; zenDown = false;
  process.env.GEMINI_API_KEY = gk; process.env.ZEN_API_KEY = zk;
  assert(outage.kind === 'chat' && outage.usedAi === false, 'with both down he answers instead of erroring: ' + JSON.stringify({ k: outage.kind, ai: outage.usedAi }));
  assert(!/Nobody here fits|people fit|visible profiles/i.test(outage.reply + outage2.reply), 'and the outage copy is never a search report: ' + JSON.stringify(outage.reply.slice(0, 60)));
  assert(!/a role, a skill, a city, or even just a name/i.test(outage2.reply), 'a member who said he is chilling does not get the form: ' + JSON.stringify(outage2.reply.slice(0, 60)));
  const fault = await L.lastAiFault();
  assert(fault.count >= 2, 'every wording call that failed today is counted, so "no personality" has a number behind it: ' + JSON.stringify(fault.count));
  assert(fault.providers && fault.providers.gemini === true && /down|error|quota|5|4/i.test(fault.lastError), 'and the record says which provider was configured and what it said: ' + JSON.stringify(fault.lastError).slice(0, 70));
}

// the deployment can be asked, in one call, whether the brain is plugged in
{
  const mod = await import('../../api/linky.js');
  const { cronToken } = mod;
  const handler = mod.default;
  const fakeRes = () => { const r = { statusCode: 0, payload: null, status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; }, send(o) { this.payload = o; return this; }, setHeader() { return this; }, end() { return this; } }; return r; };
  const noAuth = fakeRes();
  await handler({ method: 'GET', query: { action: 'diag' }, headers: {} }, noAuth);
  assert(noAuth.statusCode === 401, 'the diagnostic route is not public: ' + noAuth.statusCode);
  const okRes = fakeRes();
  await handler({ method: 'GET', query: { action: 'diag' }, headers: { 'x-linky-diag': cronToken() } }, okRes);
  const diag = okRes.payload || {};
  assert(okRes.statusCode === 200 && diag.ok && typeof diag.ai.ready === 'boolean', 'with the deployment token it answers: ' + JSON.stringify(diag.ai));
  assert(diag.ai.gemini.from === 'GEMINI_API_KEY' && !JSON.stringify(diag).includes('fake-gemini-key'), 'it names which env var the key came from, never the key itself');
  assert(diag.search.serpapi === !!process.env.SERPAPI_KEY, 'and it says whether the search side is wired: ' + JSON.stringify(diag.search));
  assert(typeof diag.aiFaults.count === 'number' && diag.aiFaults.count >= 2, 'the AI failure count rides along, so a canned-reply deployment is visible at a glance: ' + JSON.stringify(diag.aiFaults.count));
}

// ================================================================ wiring
await resetBudgets();
const vercel = fsNode.readFileSync('vercel.json', 'utf8');
assert(JSON.parse(vercel).rewrites.some((x) => x.source === '/api/telegram' && /channel=telegram/.test(x.destination)), 'the Telegram webhook route is still rewritten to /api/linky');
assert(JSON.parse(vercel).functions?.['api/linky.js']?.maxDuration >= 60, 'api/linky.js keeps a long enough timeout for a search + a model call');
const rules = fsNode.readFileSync('firestore.rules', 'utf8');
assert(/match \/linkyOutreach\/\{docId\} \{\s*allow read, write: if false;/.test(rules), 'the ledger and the runs are locked to the Admin SDK');
const env = fsNode.readFileSync('.env.example', 'utf8');
assert(/SERPAPI_KEY=/.test(env) && !/980e4ab7|fake-gemini/.test(env), '.env.example documents SERPAPI_KEY and no real key is committed');
// the whole point of the web search is that a lead can be OPENED, on every
// surface a member might be reading it on
const botSrc = fsNode.readFileSync('api/linky.js', 'utf8');
  const lkSrc = botSrc.slice(botSrc.indexOf('function leadsKeyboard'), botSrc.indexOf('\n}', botSrc.indexOf('function leadsKeyboard')) + 2);
  assert(/google\.com\/search/.test(lkSrc) && /callback_data: `w:`?|callback_data: `w:\$\{/.test(lkSrc), 'every lead row gets a link that opens and a Draft tap, built in one place: ' + lkSrc.length + ' chars');
  assert(br.buttons.flat().every((b) => !b.url || /^https?:\/\//.test(b.url)), 'and no lead button carries a url Telegram would reject the whole message for');
assert(/\$\{l\.url\}/.test(botSrc), 'and the plain-text channel still gets the link on its own line (WhatsApp auto-links it)');
const homeSrc = fsNode.readFileSync('mobile/src/screens/LinkyHomeScreen.tsx', 'utf8');
assert(/Linking\.openURL\(l\.url\)/.test(homeSrc), 'the app (and the same screen on web) opens the lead profile on tap');
assert(/l\.url\.replace\(/.test(homeSrc), 'and prints the link itself, so it can be copied on a desktop');
const auditSrc = fsNode.readFileSync('mobile/src/screens/LinkyAuditScreen.tsx', 'utf8');
assert(/linkyHideFact/.test(auditSrc) && /linkyRemoveAsk/.test(auditSrc), 'the audit screen wires hide-or-restore per fact and forget-one-ask');
assert(/Free \(2 searches a day, 2 Meets a day\)/.test(auditSrc), 'and states the real free plan instead of an old number');
const clientApi = fsNode.readFileSync('mobile/src/lib/linkyApi.ts', 'utf8');
assert(/'hideFact'/.test(clientApi) && /'removeAsk'/.test(clientApi), 'the client library exposes both calls');
for (const f of ['mobile/src/screens/LinkyHomeScreen.tsx', 'mobile/src/screens/LinkyProfileScreen.tsx', 'mobile/src/components/PaywallModal.tsx']) {
  assert(!/10 asks|ten asks/.test(fsNode.readFileSync(f, 'utf8')), `${f} does not promise the retired 10-a-day budget`);
}
const envEx = fsNode.readFileSync('.env.example', 'utf8');
assert(/ZEN_API_KEY=/.test(envEx) && /ZEN_MODEL/.test(envEx), 'the second AI key is documented where ops reads it');
const setupDoc = fsNode.readFileSync('LINKY_SETUP.md', 'utf8');
assert(/2 searches\/day and 2 Meets\/day/.test(setupDoc), 'the setup doc states the free plan once, correctly');
const src = fsNode.readFileSync('api/_linky.js', 'utf8');
assert(!/import .*_linkyVoice/.test(src), 'no hand written voice module: the words come from Gemini');
assert(/plainReply/.test(src) && /geminiWording/.test(src), 'both paths exist: model first, plain fallback second');

if (failed) { console.error(`\n${failed} FAILED`); process.exit(1); }

// ================================================================ the intent gate
// "connect to gemini api" means the model decides what a message IS. The word
// lists are only what runs when nothing answers.
{
  const { memberError } = await import('../../api/linky.js');
  assert(memberError(new Error('gemini: You exceeded your current quota, please check your plan and billing details')).length > 10 && !/quota|billing/i.test(memberError(new Error('gemini: You exceeded your current quota'))), 'a provider refusal is never put in front of a member');
  assert(/2 asks/.test(memberError(Object.assign(new Error("That is today's 2 asks used up."), { code: 'ask_limit' }))), 'and Linky own limit line still passes through');
  assert(memberError(new Error('Finish your LINKUP profile first.')) === 'Finish your LINKUP profile first.', 'a real instruction from the app is not swallowed');

  await resetBudgets();
  await clearBudget('alice');
  const gBefore = calls.gemini;
  const iBefore = calls.intent || 0;
  setIntent('chat', { reply: 'Morning. Books can wait, coffee cannot.' });
  const gateChat = await L.ask('alice', 'theres this thing with my books again');
  assert(calls.intent - iBefore === 1, 'every message goes to the model before anything is searched');
  assert(gateChat.kind === 'chat' && !gateChat.cards.length && gateChat.free === true, 'the gate can stop a search the word lists would have run: ' + JSON.stringify({ k: gateChat.kind, cards: gateChat.cards.length }));
  assert(/coffee cannot/.test(gateChat.reply), 'and the line it wrote is the line the member reads: ' + JSON.stringify(gateChat.reply.slice(0, 50)));
  assert(calls.gemini === gBefore, 'without a second call to say the same thing again');
  clearIntent();

  setIntent('ask_first', { topic: 'a bookkeeper for my payroll', reply: 'That is worth sorting before it gets worse. Should I search for them?' });
  const gateAsk = await L.ask('alice', 'ugh my payroll stuff is a mess again');
  assert(gateAsk.kind === 'check' && gateAsk.free === true && !gateAsk.cards.length, 'thinking out loud gets a question, never cards: ' + JSON.stringify({ k: gateAsk.kind }));
  assert(/\?/.test(gateAsk.reply), 'and it ends as a question: ' + JSON.stringify(gateAsk.reply.slice(0, 60)));
  const stG = await L.loadState('alice');
  assert(/bookkeeper/.test(stG.pendingIntent?.need || ''), 'what is remembered is the topic the model named: ' + (stG.pendingIntent?.need || ''));
  clearIntent();
  await clearBudget('alice');
  const gateYes = await L.ask('alice', 'yes');
  assert(gateYes.kind !== 'check' && /bookkeep|payroll/i.test(gateYes.need), 'a yes looks for exactly that, nothing else: ' + gateYes.need);

  // the proof from the chat log: a stray "yes send]" became a person search
  setIntent('chat', { reply: 'Nothing is queued to send yet. Say who and I will ask them.' });
  const junk = await L.ask('alice', 'yes send]');
  clearIntent();
  assert(junk.kind === 'chat' && !/people fit|person fits|1 person/i.test(junk.reply), 'a stray reply is never searched for: ' + JSON.stringify(junk.reply.slice(0, 55)));
  assert(!/Juan|Mexico/.test(junk.reply + JSON.stringify(junk.cards)), 'and no stranger from another continent turns up');

  // an order in words no list contains: trust the model's reading of it
  await clearBudget('alice');
  setIntent('search', { topic: 'a vet for a cattle clinic in gweru' });
  const foreign = await L.ask('alice', 'ndinoda munhu anogona kubatsira nemombe dzangu');
  clearIntent();
  assert(/vet|cattle|gweru/i.test(foreign.need) && foreign.kind !== 'chat', 'it searches what the model heard, not the noise: ' + foreign.need);

  // verdicts are remembered, wording is not
  setIntent('chat', { reply: 'First time wording for this one.' });
  await L.ask('alice', 'hlo my brother');
  const iOne = calls.intent;
  setIntent(null);
  const twice = await L.ask('alice', 'hlo my brother');
  clearIntent();
  assert(calls.intent === iOne, 'the same message is not asked twice within a day: ' + JSON.stringify({ a: iOne, b: calls.intent }));
  assert(twice.kind === 'chat', 'the repeat is still chat, with the words written fresh');
}

console.log('\nALL PASSED');
process.exit(0);
