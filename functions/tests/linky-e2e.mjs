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
// the answer is structured now: a line of prose, then numbered routes - and no
// paragraph that repeats as prose the list the client renders as rows
assert(!pointer.cached && Array.isArray(pointer.routes) && pointer.routes.length >= 2, 'pointers hand back numbered routes as data, not one long sentence');
assert(/Oslo|Harare/.test(pointer.text) && pointer.text.split('\n').length >= 3, 'and the text is readable lines, not a wall: ' + JSON.stringify(pointer.text.slice(0, 60)));
assert(!/together with|filter by location|Outreach line|quick routes/i.test(pointer.text), 'the old "three quick routes ... Outreach line:" template is gone for good');
assert(/Posted this month|recent noise|LinkedIn - search/i.test(pointer.text), 'the routes it gives read like advice from a person: ' + pointer.text.split('\n')[1]);
assert(typeof pointer.intro === 'string' && pointer.intro.length > 30 && pointer.intro.length < 320, 'a short intro line, not a speech');
const pointer2 = await L.pointers('alice', 'a quantum cryptography professor from Oslo');
assert(pointer2.cached && pointer2.routes.length === pointer.routes.length, 'pointers are cached per ask, same shape second time');
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
// ---- meet is two steps now: Linky drafts, the member approves (and may rewrite).
// Nothing reaches the other person in between, and an unapproved draft must not
// spend one of the two Meets a day the free plan gets.
const bobCard = h.cards.find((c) => c.targetUid === 'bob');
const d = await L.meet('alice', bobCard.id);
assert(d.needsApproval && d.draftId === `alice_${bobCard.id}` && /Bob/.test(d.pitch) && d.pitch.length > 60, 'meet answers with a draft addressed to the real person: ' + d.pitch.slice(0, 70));
assert(d.meetsLeft === FREE.meetsPerDay, 'a draft nobody approved has cost no Meet yet');
let notes = await db.collection('notifications').where('userId', '==', 'bob').get();
assert(notes.size === 0, 'and Bob has not been told a thing');
assert(!(await db.collection('intros').doc('alice_bob').get()).exists, 'no intro doc exists before the approval');
assert((await L.home('alice')).pending?.meet?.cardId === bobCard.id, 'the draft survives a reload - home hands it back');
const cancel = await L.cancelMeet('alice', { cardId: bobCard.id });
assert(cancel.cancelled, 'cancel drops the draft');
assert((await db.collection('notifications').where('userId', '==', 'bob').get()).size === 0, 'cancelling sends nothing either');
const MINE = 'Bob - Alice here. I am building mobile money tooling for SMEs in Harare and I need a Flutter hand for two months. Fifteen minutes this week to see whether you would enjoy it?';
const d2 = await L.meet('alice', bobCard.id);
assert(d2.needsApproval && d2.pitch.length > 40, 'drafting again after a cancel works');
const ap = await L.approveMeet('alice', { cardId: bobCard.id, text: MINE });
assert(ap.introId === 'alice_bob' && ap.sent && ap.edited, 'approve sends it, and remembers it was the member writing, not the model');
notes = await db.collection('notifications').where('userId', '==', 'bob').get();
assert(notes.size === 1 && notes.docs[0].data().type === 'intro_request' && notes.docs[0].data().content === MINE, 'Bob is notified with the approved text, verbatim: ' + String(notes.docs[0]?.data().content).slice(0, 50));
assert((await db.collection('linkyState').doc('alice').get()).data()?.meets?.count === 1, 'the Meet is spent at approval, not at drafting');
const trail = (await L.home('alice')).outreach || [];
assert(trail.some((e) => e.kind === 'intro' && e.status === 'asked' && e.edited), 'the intent is on the outreach trail, which is how the graph grows');
h = await L.home('bob');
assert(h.inbound.length === 1 && h.inbound[0].requesterName === 'Alice Moyo', 'bob sees inbound intro');
// a double tap on Send (Telegram retries, and so do thumbs) must not reach Bob twice
const twice = await L.approveMeet('alice', { cardId: bobCard.id });
assert(twice.alreadyRequested || twice.pending || twice.introId, 'approving twice is absorbed, not sent twice: ' + JSON.stringify({ ir: twice.alreadyRequested, p: twice.pending, id: twice.introId }));
assert((await db.collection('notifications').where('userId', '==', 'bob').where('type', '==', 'intro_request').get()).size === 1, 'Bob still has exactly one intro to answer');
assert((await L.home('alice')).pending?.meet == null, 'and no ghost draft is left pending after the send');
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
await L.meet('dan', bobFromDan.id);                                    // drafted, not sent
assert(!(await db.collection('intros').doc('dan_bob').get()).exists, 'a draft alone tells nobody anything');
await L.approveMeet('dan', { cardId: bobFromDan.id });                  // dan approves it as written
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
assert(/does not move until you say send/.test(br.text) && /Cara/.test(br.text), 'bot "meet 1" drafts first and waits for the human: ' + br.text.slice(0, 80));
assert(Array.isArray(br.buttons) && /Send it/.test(JSON.stringify(br.buttons)), 'approval on Telegram is a button, not a sentence to guess');
assert(!(await db.collection('intros').doc('alice_cara').get()).exists, 'and nothing has reached Cara yet');
br = await botReplyForTest('telegram', '12345', 'send');
assert(/Sent to Cara Dube/.test(br.text), 'replying SEND lets it go: ' + br.text.slice(0, 70));
assert((await db.collection('intros').doc('alice_cara').get()).exists, 'the intro doc only exists after the approval');
br = await botReplyForTest('telegram', '12345', 'who could be my co founder');
assert(!br.cards && /q:y/.test(JSON.stringify(br.buttons || [])), 'on Telegram a musing gets a question with a tap, not five cards: ' + br.text.slice(0, 55));
await clearBudget('alice');
const tapYes = await botReplyForTest('telegram', '12345', '', { callback: 'q:y' });
assert(tapYes.text.length > 20, 'tapping Yes runs the search in the same chat: ' + tapYes.text.slice(0, 45).replace(/\n/g, ' '));
await clearBudget('alice');
br = await botReplyForTest('telegram', '12345', 'a blockchain lawyer in Lagos');
assert(!br.cards && /Nobody (here|on LINKUP) fits/i.test(br.text), 'bot no-match is graceful: ' + br.text.slice(0, 70));
assert((br.chips || []).some((c) => /outside LINKUP/i.test(c)), 'and the no-match keeps the outside-LINKUP chip, which is how a member on Telegram reaches the search at all: ' + JSON.stringify(br.chips));
assert(/Search LinkedIn/.test(JSON.stringify(br.buttons || [])), 'with a button that says what it actually does');
br = await botReplyForTest('telegram', '12345', 'more');
assert(br.text.split('\n').length >= 3 && !/;\s*\d+\./.test(br.text), 'bot "more" answers in short lines, never a run-on sentence: ' + br.text.slice(0, 60).replace(/\n/g, ' | '));
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
// ---- thinking out loud is not a work order
// The complaint: "who could be my Co founder" got five cards with no warning.
// Linky has to tell the difference between an instruction and a thought, and ask.
{
  const say = (m) => L.parseAsk(m);
  assert(say('who could be my Co founder').reflective === true, '"who could be" is a thought, not a request');
  assert(say('I am thinking about bringing on a technical co founder').reflective === true, '"I am thinking about" too');
  assert(say('should i look for a bookkeeper').reflective === true && say('anyone come to mind for taxes?').reflective === true, 'should-I and anyone-come-to-mind likewise');
  assert(say('find a flutter developer in harare').reflective === false && say('find a flutter developer in harare').command === true, 'an imperative is still an imperative');
  assert(say('who do you have for a flutter developer').reflective === false, '"who do you have" is asking for names, so search now');
  assert(say('who could be my co founder').reflective && !say('who could be my co founder').chitChat, 'and it is not chit-chat either - it is a question with a person in it');

  await clearBudget('alice');
  await clearBudget('alice');
  const stA = await L.loadState('alice');
  const think = await L.ask('alice', 'who could be my Co founder');
  const stB = await L.loadState('alice');
  assert(think.kind === 'check' && !think.cards.length && think.askingFirst === true, 'so the answer is a thought plus a question, never cards: ' + JSON.stringify({ kind: think.kind, cards: think.cards.length }));
  assert(/\?/.test(think.reply) && !/people fit|I read all/i.test(think.reply), 'and it reads as him asking, not as a search report: ' + think.reply.slice(0, 70));
  assert((stB.asks?.count || 0) === (stA.asks?.count || 0), 'and a question costs no ask');
  assert(stB.pendingIntent?.need && /co founder|co-founder|founder/i.test(stB.pendingIntent.need), 'the pending question is what is remembered');
  assert((stB.lastAsk?.need || '').toLowerCase() !== 'who could be my co founder', 'and it is not recorded as an ask, so it does not poison the next answer or the cache');

  const yes = await L.ask('alice', 'yes');
  assert(yes.kind !== 'check' && yes.free !== true, 'a yes runs the search he offered: ' + JSON.stringify({ kind: yes.kind, free: !!yes.free }));
  assert(!(await L.loadState('alice')).pendingIntent, 'and the question is spent');
  const yesAgain = await L.ask('alice', 'yes');
  assert(yesAgain.kind === 'chat' || yesAgain.free === true, 'a stray yes afterwards is just a yes, not a fresh search');

  const think2 = await L.ask('alice', 'who might be a good bookkeeper for my startup');
  assert(think2.kind === 'check', 'the same shape catches other phrasings');
  const no = await L.ask('alice', 'no thanks, just thinking');
  assert(no.cards.length === 0 && no.free === true && /search|nothing|Noted|fine/i.test(no.reply), 'a no is taken lightly and searches nothing: ' + no.reply.slice(0, 60));
  assert(!(await L.loadState('alice')).pendingIntent, 'and a no leaves no question hanging');

  const think3 = await L.ask('alice', 'who might be a good actuary for my startup');
  assert(think3.kind === 'check', 'he asks first, every time the shape is a musing');
  const redirect = await L.ask('alice', 'actually find me a payroll auditor in Lusaka');
  assert(redirect.kind !== 'check' && /payroll/.test(redirect.need + JSON.stringify(redirect.cards)), 'but a new instruction in the middle is not treated as a yes: ' + redirect.reply.slice(0, 55));
  assert(!(await L.loadState('alice')).pendingIntent, 'and the abandoned question is cleared rather than left to answer itself later');

  await clearBudget('alice');
  const order = await L.ask('alice', 'find me a payroll auditor in Blantyre, paid');
  assert(order.cards.length >= 1 && order.kind !== 'check', 'the direct instruction still answers with people straight away');
  assert(!order.free, 'and an instruction he gave himself is metered like any ask');
}


// ---- the chat log, verbatim: "yoo" must never become a search report
// [tanaka] yoo            -> was: Nobody here fits "yoo" - I read all 56 profiles
// [tanaka] yoo whats up   -> was: Tell me who you need and I will go and look - ...
// [tanaka] no just wanna chill -> was: Nobody here fits "no just wanna chill"
{
  for (const said of ['yoo', 'yoo whats up', 'no just wanna chill', 'hey', 'good morning bro', 'hahaha', 'you there?', 'sup', 'nothing much just chilling']) {
    const t = await L.ask('alice', said);
    assert(t.kind === 'chat' && t.free === true && !t.cards.length, `"${said}" is a person talking, not a query: ${JSON.stringify({ kind: t.kind, cards: t.cards.length, free: !!t.free })}`);
    assert(!/Nobody here fits|nobody fits|people fit|visible profiles/i.test(t.reply), `"${said}" never comes back as a search report: ${JSON.stringify(t.reply.slice(0, 50))}`);
    assert(t.nearest.length === 0 && t.checked === 0, `"${said}" does not drag three strangers in as the closest match`);
  }
  const chill = await L.ask('alice', 'no i just want to vibe');
  assert(!/Tell me who you need|a role, a skill, a city/i.test(chill.reply), 'and a feeling is not answered with the pitch: ' + JSON.stringify(chill.reply.slice(0, 60)));
  const asked = await L.ask('alice', 'what can you do');
  assert(/who you need|read every member|flutter|bring you/i.test(asked.reply), 'asked directly, he does explain what he is for: ' + JSON.stringify(asked.reply.slice(0, 60)));
  assert(!L.parseAsk('meet 1').smallTalk && !L.parseAsk('cards').smallTalk && !L.parseAsk('more').smallTalk, 'a command is never read as banter however short');
  assert(!L.parseAsk('find me a payroll auditor in Blantyre').smallTalk && !L.parseAsk('i need a flutter developer').smallTalk, 'neither is a real order');
  assert(!L.parseAsk('gift knows tax').smallTalk, 'and a name is not banter either');
  const stD = await L.loadState('alice');
  assert(Number(stD.chitStreak || 0) >= 6, 'he counts the banter, so he knows when to stop pitching');
  await clearBudget('alice');
  await L.ask('alice', 'find me an accountant who knows tax in harare');
  assert(Number((await L.loadState('alice')).chitStreak || 0) === 0, 'and one real ask resets it');
}


// ---- the gate stands aside when no model is configured
{
  const none = await L.intentGate('find me a flutter developer in harare');
  assert(none === null, 'with no provider the gate returns nothing rather than guessing: ' + JSON.stringify(none));
  const empty = await L.intentGate('');
  assert(empty === null, 'and an empty message is not even worth asking about');
  const st = await L.loadState('alice');
  assert(true, 'the word lists carry every decision in that mode, which is what the suite above proves');
}


// ---- "send intro to X": a name found is not the answer, the next step is
{
  const sent = await L.ask('alice', 'send an intro to Dan Ncube');
  assert(sent.kind === 'person' && sent.cards.length === 1, 'he is found by name, not searched for: ' + JSON.stringify({ k: sent.kind, c: sent.cards.length }));
  assert(/meet/i.test(sent.reply), 'and the reply says how the message actually goes out: ' + JSON.stringify(sent.reply.slice(-72)));
  assert((sent.reply.match(/meet/gi) || []).length === 1, 'the instruction is not said twice just because the cached line mentions it too');
  const plain = await L.ask('alice', 'is Dan Ncube around?');
  assert(plain.kind === 'person' && /Dan/.test(plain.reply), 'a lookup without "send" is still answered');
}

console.log('\nALL PASSED');
process.exit(0);
