// Run: start the Firestore emulator on 127.0.0.1:8089, create a throwaway SA json
// (any RSA key; project_id linkup-e0906) at FAKE_SA_JSON, then from repo root:
//   node functions/tests/linky-e2e.mjs
// End-to-end exercise of api/_linky.js + api/linky.js against the emulator.
// No Gemini key is set, so every path below is the zero-token path.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089';
process.env.FIREBASE_SERVICE_ACCOUNT = (await import('node:fs')).readFileSync(process.env.FAKE_SA_JSON || '/tmp/fake-sa.json','utf8');
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.GEMINI_API_KEY = '';
process.env.EXPO_PUBLIC_GEMINI_API_KEY = '';
process.env.GOOGLE_API_KEY = '';
const L = await import('../../api/_linky.js');
const handler = (await import('../../api/linky.js')).default;
await fetch('http://127.0.0.1:8089/emulator/v1/projects/linkup-e0906/databases/(default)/documents', { method: 'DELETE' });
const db = (await import('../../api/_firebaseAdmin.js')).getDb();

const users = {
  alice: { displayName: 'Alice Moyo', occupation: 'Founder', company: 'PayZim', city: 'Harare', country: 'Zimbabwe', skills: ['sales', 'fintech'], industries: ['fintech'], bio: 'Building mobile money tools for SMEs', onboarded: true, isVisible: true },
  bob: { displayName: 'Bob Chikwanha', occupation: 'Flutter developer', company: 'Freelance', city: 'Harare', country: 'Zimbabwe', skills: ['flutter', 'dart', 'firebase'], industries: ['fintech', 'mobile'], bio: 'Ship Flutter apps for African fintechs', onboarded: true, isVisible: true },
  cara: { displayName: 'Cara Dube', occupation: 'Designer', city: 'Bulawayo', country: 'Zimbabwe', skills: ['figma', 'branding'], industries: ['retail'], bio: 'Brand design for shops', onboarded: true, isVisible: true },
  dan: { displayName: 'Dan Ncube', occupation: 'Backend engineer', city: 'Harare', country: 'Zimbabwe', skills: ['node', 'flutter'], industries: ['fintech'], bio: 'APIs and payments', onboarded: true, isVisible: true },
  eve: { displayName: 'Eve Mutasa', occupation: '', city: 'Harare', country: 'Zimbabwe', skills: [], industries: [], bio: '', onboarded: true, isVisible: true },
  fadzi: { displayName: 'Fadzi Moyo', occupation: 'Data analyst', company: 'Econet', city: 'Harare', country: 'Zimbabwe', skills: ['excel', 'power bi', 'statistics'], industries: ['telecoms'], bio: 'Numbers person. Dashboards and forecasting.', onboarded: true, isVisible: true },
  gift: { displayName: 'Gift Sibanda', occupation: 'Accountant', company: 'KPMG', city: 'Harare', country: 'Zimbabwe', skills: ['tax', 'audit'], industries: ['finance'], bio: '', onboarded: true, isVisible: true },
};
for (const [uid, u] of Object.entries(users)) {
  await db.collection('users').doc(uid).set({ uid, ...u });
  await db.collection('publicProfiles').doc(uid).set({ uid, ...u, profilePic: `https://ik.imagekit.io/x/${uid}.jpg` });
}
await db.collection('userPrivate').doc('bob').set({ pushTokens: [] });
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok  -', m); };
// the free plan is 2 searches and 2 Meets a day now. Every assertion below is
// written against L.LIMITS so the suite still says something when the number moves,
// and anything that is not testing the paywall tops the member up first.
const FREE = L.LIMITS.free;
const clearBudget = async (uid) => {
  await db.collection('linkyState').doc(uid).set({ asks: { day: 'test-reset', count: 0 }, meets: { day: 'test-reset', count: 0 } }, { merge: true });
};

// ---- ask: greeting -> coach, no budget, no cards
let r = await L.ask('alice', 'hi linky');
assert(r.none && !r.cards.length && /what do you need|who you need|a role, a skill/i.test(r.reply) && r.asksLeft === L.LIMITS.free.asksPerDay && r.free === true, 'greeting -> coaching reply, no budget used');
assert(r.kind === 'chat' && r.free === true && Array.isArray(r.suggest) && r.suggest.length === 3, 'chit-chat is tagged as chat, is free, and comes with tappable chips');
// ---- ask: immediate cited answer
await clearBudget('alice');
r = await L.ask('alice', 'I need a Flutter developer in Harare for a paid fintech MVP');
console.log('    reply:', r.reply);
console.log('    cards:', r.cards.map((c) => `${c.targetName} :: ${c.why}`));
assert(!r.cached && r.cards.length >= 1 && r.cards[0].targetUid === 'bob', 'bob (flutter, Harare, fintech) is the first cited card, immediately');
assert(r.cards.every((c) => c.why.length > 12 && c.opener.length > 10), 'every card has a cited why and an opener');
assert(!r.cards.some((c) => c.targetUid === 'cara'), 'cara (designer, no overlap) not a card');
assert(!r.cards.some((c) => c.targetUid === 'alice'), 'never matches yourself');
assert(!r.cards.some((c) => c.targetUid === 'eve'), 'eve (empty profile) is never cited');
assert(r.asksLeft === FREE.asksPerDay - 1, 'one ask consumed');
const firstAskCards = r.cards.map((c) => c.id);
// ---- same ask again -> cached, no budget (deliberately NOT topped up: the
// point is that the repeat inherits whatever the first ask already used)
const again = await L.ask('alice', 'I need a Flutter developer in Harare for a paid fintech MVP');
assert(again.cached && again.cards.map((c) => c.id).join() === firstAskCards.join() && again.asksLeft === FREE.asksPerDay - 1, 'repeat ask is served from cache with the same cards and costs nothing');
// ---- nobody fits -> graceful, no error, nearest people, budget consumed
await clearBudget('alice');
await clearBudget('alice');
r = await L.ask('alice', 'a quantum cryptography professor from Oslo');
console.log('    reply:', r.reply);
assert(r.none && !r.cards.length && /Nobody (here|on LINKUP) fits/i.test(r.reply) && /read all 6 visible profiles/i.test(r.reply) && r.checked === 6, 'no-match ask answers gracefully with member count: ' + r.reply.slice(0, 70));
assert(Array.isArray(r.nearest) && r.nearest.length >= 1 && !r.nearest.some((n) => n.uid === 'alice') && /Harare/.test(r.nearest[0].city), 'nearest people offered instead of an error, own city first: ' + r.nearest.map((n) => n.name).join(', '));
assert(r.asksLeft === FREE.asksPerDay - 1, 'no-match ask still counts');
// ---- related-concept expansion (zero tokens): "math" is on nobody's profile
await clearBudget('alice');
await clearBudget('alice');
r = await L.ask('alice', 'find me a person who understands math');
console.log('    reply:', r.reply);
console.log('    cards:', r.cards.map((c) => `${c.targetName} :: ${c.why}`));
assert(!r.none && r.cards.length >= 1 && r.cards[0].targetUid === 'fadzi', 'math -> Fadzi (statistics / data analyst) via related concepts, immediately');
assert(/statistic|analy|Data analyst/i.test(r.cards[0].why) && /close to/.test(r.cards[0].why), 'related card says which real fact matched: ' + r.cards[0].why);
assert(/word for word/.test(r.reply) && r.expansion === 'local', 'reply is honest that it is a related match');
assert(!r.cards.some((c) => c.targetUid === 'eve'), 'empty profiles are never cited even in expansion');
assert(r.usedAi === false, 'no Gemini call for a local expansion');
// ---- plural / verb forms match without expansion
await clearBudget('alice');
await clearBudget('alice');
r = await L.ask('alice', 'developers');
assert(!r.none && r.cards.some((c) => c.targetUid === 'bob') && r.expansion === 'none', 'plural "developers" matches "developer" word for word');
// ---- pointers: only for an ask that was made; static text without a key
let pt = null; try { await L.pointers('alice', 'a blockchain lawyer in Lagos'); } catch (e) { pt = e; }
assert(pt && /Ask me that first/.test(pt.message), 'pointers refuse asks that were never made (budget guard)');
const pointer = await L.pointers('alice', 'a quantum cryptography professor from Oslo');
assert(/Outside LINKUP/.test(pointer.text) && /Oslo|Harare/.test(pointer.text) && !pointer.cached, 'pointers give outside-LINKUP routes without Gemini: ' + pointer.text.slice(0, 80));
const pointer2 = await L.pointers('alice', 'a quantum cryptography professor from Oslo');
assert(pointer2.cached, 'pointers are cached per ask');
// ---- interleaved repeat (an unrelated ask in between) is still cached
await clearBudget('alice');
await clearBudget('alice');
r = await L.ask('alice', 'I need a Flutter developer in Harare for a paid fintech MVP');
assert(r.cached && r.cards.map((c) => c.id).join() === firstAskCards.join() && r.asksLeft === FREE.asksPerDay, 'repeat after another ask is still served from cache, and a cached answer is not metered');
// ---- name lookup
await clearBudget('alice');
r = await L.ask('alice', 'connect me with Cara Dube');
assert(r.cards.length === 1 && r.cards[0].targetUid === 'cara' && /Cara Dube/.test(r.cards[0].why), 'asking for a person by name finds them: ' + r.cards[0].why);
// ---- home
let h = await L.home('alice');
assert(h.limits.meetsPerDay === FREE.meetsPerDay && h.limits.asksPerDay === FREE.asksPerDay && h.limits.asksUsedToday === 0 && h.lastAsk && h.lastAsk.need === 'connect me with Cara Dube', `home shows the free plan's limits (${FREE.asksPerDay} searches, ${FREE.meetsPerDay} Meets a day) + last ask, and a name lookup cost nothing`);
assert(Array.isArray(h.thread) && h.thread.length >= 10 && h.thread.every((t) => t.text && ['user', 'linky'].includes(t.role)), 'home returns the whole thread, oldest first, both sides');
assert(h.thread.filter((t) => t.role === 'linky').every((t) => !/[*_#]|^>/.test(t.text)), 'Linky never sends markdown into a chat bubble');
assert(!('intents' in h), 'home has no intents');
assert(h.cards.some((c) => c.targetUid === 'bob') && h.cards.some((c) => c.targetUid === 'cara'), 'cards persist across asks');
// ---- meet -> intro pending + notification to bob
const bobCard = h.cards.find((c) => c.targetUid === 'bob');
const m = await L.meet('alice', bobCard.id);
assert(m.pending && m.introId === 'alice_bob' && m.meetsLeft === FREE.meetsPerDay - 1, `meet creates pending intro, one of the free plan's ${FREE.meetsPerDay} Meets used`);
let notes = await db.collection('notifications').where('userId', '==', 'bob').get();
assert(notes.size === 1 && notes.docs[0].data().type === 'intro_request' && notes.docs[0].data().requestId === 'alice_bob', 'bob got intro_request notification');
h = await L.home('bob');
assert(h.inbound.length === 1 && h.inbound[0].requesterName === 'Alice Moyo', 'bob sees inbound intro');
// ---- re-asking keeps the requested card (status meet) instead of duplicating bob
await clearBudget('alice');
await db.collection('linkyState').doc('alice').set({ lastAsk: null }, { merge: true });
await clearBudget('alice');
r = await L.ask('alice', 'Flutter developer Harare fintech');
const bobAgain = r.cards.filter((c) => c.targetUid === 'bob');
assert(bobAgain.length === 1 && bobAgain[0].id === bobCard.id && bobAgain[0].status === 'meet', 'same person reuses the live card (no duplicates)');
// ---- accept -> match + approved connectionRequest + opener message + notification to alice
const acc = await L.respond('bob', 'alice_bob', 'accept');
assert(acc.status === 'accepted' && acc.matchId === 'alice_bob', 'accept -> matchId alice_bob');
const match = await db.collection('matches').doc('alice_bob').get();
assert(match.exists && match.data().userIds.join() === 'alice,bob' && match.data().participantProfiles.bob.displayName === 'Bob Chikwanha', 'match doc with participantProfiles');
const cr = await db.collection('connectionRequests').doc('alice_bob').get();
assert(cr.exists && cr.data().status === 'approved', 'approved connectionRequest unlocks chat gate');
const msgs = await db.collection('matches').doc('alice_bob').collection('messages').get();
assert(msgs.size === 1 && /Linky here/.test(msgs.docs[0].data().content), 'opener message from Linky');
notes = await db.collection('notifications').where('userId', '==', 'alice').get();
assert(notes.docs.some((d) => d.data().type === 'intro_accepted' && d.data().matchId === 'alice_bob'), 'alice got intro_accepted with matchId');
// ---- decline path (dan asks bob; bob declines -> mute both ways)
const danAsk = await L.ask('dan', 'Flutter developer for a payments app in Harare, paid');
const bobFromDan = danAsk.cards.find((c) => c.targetUid === 'bob');
assert(bobFromDan, 'dan gets bob card');
await L.meet('dan', bobFromDan.id);
const dec = await L.respond('bob', 'dan_bob', 'decline');
assert(dec.status === 'declined', 'decline');
const bobState = await L.loadState('bob');
assert(bobState.muted && bobState.muted.dan, 'bob muted dan');
const danHome = await L.home('dan');
assert(danHome.cards.find((c) => c.id === bobFromDan.id).status === 'declined', 'dan card shows declined');
await clearBudget('dan');
r = await L.ask('dan', 'Flutter developer in Harare');
assert(!r.cards.some((c) => c.targetUid === 'bob'), 'declined person never comes back for dan');
// ---- inbound cap 0 excludes from matching; openTo filter
await L.setPrefs('bob', { inboundCap: 0 });
await db.collection('introSuggestions').doc('alice').delete();
await db.collection('linkyState').doc('alice').set({ lastAsk: null }, { merge: true });
await clearBudget('alice');
r = await L.ask('alice', 'Flutter developer Harare');
assert(!r.cards.some((c) => c.targetUid === 'bob') && r.cards.some((c) => c.targetUid === 'dan'), 'bob excluded when inbound cap is 0, dan still cited');
await L.setPrefs('dan', { openTo: ['equity'] });
await db.collection('linkyState').doc('alice').set({ lastAsk: null }, { merge: true });
await clearBudget('alice');
r = await L.ask('alice', 'Flutter developer Harare, paid work');
assert(!r.cards.some((c) => c.targetUid === 'dan'), 'dan excluded by openTo=[equity] for a paid ask');
// ---- editable facts: what you tell Linky is matched and cited
await L.setFacts('eve', { notes: 'I run growth for a solar startup', skills: ['solar', 'growth marketing'], lookingFor: ['angel investors'] });
const evTold = L.toldFacts(await L.loadState('eve'));
assert(evTold.skills.length === 2 && evTold.notes.startsWith('I run growth'), 'facts saved');
await clearBudget('alice');
r = await L.ask('alice', 'someone who knows solar and growth marketing');
assert(r.cards.length === 1 && r.cards[0].targetUid === 'eve' && /solar|growth/i.test(r.cards[0].why), 'told facts make eve matchable + cited: ' + r.cards[0].why);
const a = await L.audit('eve');
assert(a.told.skills.includes('solar') && a.facts.name === 'Eve Mutasa' && Array.isArray(a.asks), 'audit returns told facts + profile facts + asks');
const aliceAudit = await L.audit('alice');
assert(aliceAudit.asks.length >= 5 && aliceAudit.asks[0].need === 'someone who knows solar and growth marketing', 'audit lists asks newest first');
// ---- ask budget: the free plan's cap -> 402 code
await db.collection('linkyState').doc('alice').set({ asks: { day: L.dayKey(), count: FREE.asksPerDay }, lastAsk: null }, { merge: true });
let lim = null; try { await L.ask('alice', 'designer in Bulawayo'); } catch (e) { lim = e; }
assert(lim && lim.code === 'ask_limit', `free tier blocked at ask number ${FREE.asksPerDay + 1}: ` + lim?.message);
await db.collection('linkyState').doc('alice').set({ asks: { day: L.dayKey(), count: 0 } }, { merge: true });
// ---- bot linking + bot brain (ask answered inline)
const { code } = await L.createLinkCode('alice');
const linkedUid = await L.consumeLinkCode(code.toLowerCase(), 'telegram', '12345');
assert(linkedUid === 'alice', 'link code (case-insensitive) links telegram chat to alice');
assert((await L.botUserFor('telegram', '12345')).uid === 'alice', 'botUsers row exists');
assert((await L.consumeLinkCode(code, 'telegram', '999')) === null, 'code is single-use');
const { botReplyForTest } = await import('../../api/linky.js');
await clearBudget('alice');
let br = await botReplyForTest('telegram', '12345', 'designer in Bulawayo');
console.log('    bot:', br.text.split('\n')[0]);
assert(br.cards?.length === 1 && br.cards[0].targetUid === 'cara' && /meet 1/.test(br.text), 'bot answers an ask inline with numbered cards');
br = await botReplyForTest('telegram', '12345', 'meet 1');
assert(/Asked Cara Dube/.test(br.text), 'bot "meet 1" targets the first card of the last answer: ' + br.text);
br = await botReplyForTest('telegram', '12345', 'a blockchain lawyer in Lagos');
assert(!br.cards && /Nobody (here|on LINKUP) fits/i.test(br.text), 'bot no-match is graceful: ' + br.text.slice(0, 70));
br = await botReplyForTest('telegram', '12345', 'more');
assert(/Outside LINKUP/.test(br.text), 'bot "more" gives outside-LINKUP pointers for the last ask');
br = await botReplyForTest('telegram', '12345', 'cards');
assert(/Your cards/.test(br.text), 'bot "cards" lists live cards');
// ---- cron: housekeeping only
await db.collection('intros').doc('alice_cara').set({ expiresAt: new Date(Date.now() - 1000) }, { merge: true });
const cron = await L.runCron();
console.log('    cron:', JSON.stringify(cron));
assert(cron.expiredIntros === 1 && !('activeIntents' in cron), 'cron expires stale intros and matches nothing');
// ---- handler-level: cron auth + app auth
const mkRes = () => { const r = { code: 0, body: null, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r; r.send = (b) => { r.body = b; return r; }; return r; };
let res = mkRes();
await handler({ method: 'POST', query: { action: 'cron' }, headers: {}, body: {} }, res);
assert(res.code === 401, 'cron without token -> 401');
const { cronToken } = await import('../../api/linky.js');
res = mkRes();
await handler({ method: 'POST', query: { action: 'cron' }, headers: { 'x-linky-cron': cronToken() }, body: {} }, res);
assert(res.code === 200 && 'expiredIntros' in res.body, 'cron with derived token -> 200');
res = mkRes();
await handler({ method: 'POST', query: {}, headers: {}, body: { action: 'ask', message: 'x' } }, res);
assert(res.code === 401, 'app action without idToken -> 401');
res = mkRes();
await handler({ method: 'POST', query: { channel: 'telegram' }, headers: {}, body: { message: { chat: { id: 1 }, text: 'hi' } } }, res);
assert(res.code === 503, 'telegram webhook without bot token -> 503');
res = mkRes();
await handler({ method: 'GET', query: { channel: 'whatsapp', 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42' }, headers: {} }, res);
assert(res.code === 403, 'whatsapp verify with wrong token -> 403');
process.env.WHATSAPP_VERIFY_TOKEN = 'secret1';
res = mkRes();
await handler({ method: 'GET', query: { channel: 'whatsapp', 'hub.mode': 'subscribe', 'hub.verify_token': 'secret1', 'hub.challenge': '42' }, headers: {} }, res);
assert(res.code === 200 && res.body === '42', 'whatsapp verify handshake echoes challenge');
// ---- forget
const f = await L.forget('alice');
assert(f.ok && !(await db.collection('linkyState').doc('alice').get()).exists && !(await db.collection('botUsers').doc('telegram_12345').get()).exists, 'forget wipes state, cards, bot link');
console.log('\nALL PASSED');
process.exit(0);
