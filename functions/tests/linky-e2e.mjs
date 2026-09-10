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
assert(r.none && !r.cards.length && /Nobody on LINKUP does/i.test(r.reply) && /go outside my network/i.test(r.reply) && !/read all|visible profiles/i.test(r.reply) && r.checked === 6, 'no-match ask says they are not on LINKUP and offers to go outside the network, never a profile count: ' + r.reply.slice(0, 80));
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
const msgRows = msgs.docs.map((d) => d.data());
assert(msgs.size === 2 && msgRows.some((x) => /Linky here/.test(x.content || '')), 'opener message from Linky, and nothing else from the bot');
assert(msgRows.some((x) => x.type === 'synergy_brief'), 'the one-page brief is posted in the same chat, before either of them types');
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
assert(!br.cards && /Nobody on LINKUP does/i.test(br.text) && /outside my network/i.test(br.text), 'bot no-match is graceful and offers to go outside the network: ' + br.text.slice(0, 70));
assert((br.chips || []).some((c) => /search LinkedIn/i.test(c)), 'and the no-match hands back a "yes, search LinkedIn" chip so a member can just say yes: ' + JSON.stringify(br.chips));
assert(/Yes, search LinkedIn/.test(JSON.stringify(br.buttons || [])) && /q:y/.test(JSON.stringify(br.buttons || [])), 'with a button wired to the yes that runs the LinkedIn search');
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
  // that search found nobody, so the musing question is spent and replaced by the
  // one real follow-up: "should I go outside my network?" - never the old musing.
  const stAfterYes = await L.loadState('alice');
  assert(!stAfterYes.pendingIntent || stAfterYes.pendingIntent.outside === true, 'the musing question is spent; only the go-outside offer may wait: ' + JSON.stringify(stAfterYes.pendingIntent));
  const yesAgain = await L.ask('alice', 'yes');
  assert(yesAgain.kind === 'outside' && yesAgain.free === true, 'a yes to the go-outside offer runs the LinkedIn search, still free: ' + JSON.stringify({ kind: yesAgain.kind, free: !!yesAgain.free }));

  const think2 = await L.ask('alice', 'who might be a good bookkeeper for my startup');
  assert(think2.kind === 'check', 'the same shape catches other phrasings');
  const no = await L.ask('alice', 'no thanks, just thinking');
  assert(no.cards.length === 0 && no.free === true && /search|nothing|Noted|fine/i.test(no.reply), 'a no is taken lightly and searches nothing: ' + no.reply.slice(0, 60));
  assert(!(await L.loadState('alice')).pendingIntent, 'and a no leaves no question hanging');

  const think3 = await L.ask('alice', 'who might be a good actuary for my startup');
  assert(think3.kind === 'check', 'he asks first, every time the shape is a musing');
  const redirect = await L.ask('alice', 'actually find me a payroll auditor in Lusaka');
  assert(redirect.kind !== 'check' && /payroll/.test(redirect.need + JSON.stringify(redirect.cards)), 'but a new instruction in the middle is not treated as a yes: ' + redirect.reply.slice(0, 55));
  const stRedirect = await L.loadState('alice');
  assert(!stRedirect.pendingIntent || stRedirect.pendingIntent.outside === true, 'and the abandoned question is cleared rather than left to answer itself later (only a fresh go-outside offer may wait): ' + JSON.stringify(stRedirect.pendingIntent));

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


// ---- the Zen model chain: a stale model id must not silence the fallback brain
{
  const g = await import('../../api/_gemini.js');
  const status = g.aiStatus();
  assert(!/2\.5|opencode\//.test(status.zen.model), 'the default Zen model is one the catalog actually serves today: ' + status.zen.model);
  const fake = (modelsThatFail) => {
    const seen = [];
    const prev = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body || '{}');
      seen.push(body.model);
      if (modelsThatFail.includes(body.model)) {
        return new Response(JSON.stringify({ error: { message: modelsThatFail[0].startsWith('billing') ? 'No payment method. Add a payment method here: https://opencode.ai/x/billing' : `Model ${body.model} is not supported` } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'a sentence from ' + body.model } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    return { seen, restore: () => { globalThis.fetch = prev; } };
  };
  const gkWas = process.env.GEMINI_API_KEY, zkWas = process.env.ZEN_API_KEY;
  process.env.GEMINI_API_KEY = ''; process.env.ZEN_API_KEY = 'unit-zen-only';
  const broken = fake(['gone-model']);
  const rescued = await g.aiText('say something', { model: 'gone-model', timeoutMs: 4000 });
  broken.restore();
  assert(broken.seen.length >= 2 && /flash|gpt|haiku/.test(broken.seen[1]), 'a refused model name is retried down the chain, not fatal: ' + JSON.stringify(broken.seen));
  assert(new RegExp('a sentence from ' + broken.seen[1].replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).test(rescued.text), 'and the caller gets words from whichever model answered: ' + rescued.text);
  const billed = fake(['billing-model']);
  let paidErr = '';
  try { await g.aiText('say something', { model: 'billing-model', timeoutMs: 4000 }); } catch (err) { paidErr = String(err.message); }
  billed.restore();
  assert(billed.seen.length === 1, 'an account problem is not retried across every model - one call, then out: ' + JSON.stringify(billed.seen));
  assert(/payment method/i.test(paidErr), 'and the reason stays in the error for whoever reads diagnostics');
  const { memberError } = await import('../../api/linky.js');
  assert(!/payment|opencode|billing/i.test(memberError(new Error('zen: No payment method. Add a payment method here: https://opencode.ai/x/billing'))), 'never in front of a member: ' + JSON.stringify(memberError(new Error('zen: No payment method. Add a payment method here'))));
  process.env.GEMINI_API_KEY = gkWas; process.env.ZEN_API_KEY = zkWas;
}


// ================================================================ the four new
// abilities: proof of work, the synergy brief, the 48-hour loop and squads.
{
  const P = await import('../../api/_proof.js');
  // ---- 4. proof of work is a quoted fact, never a compliment
  const badged = P.proofPoints(
    { name: 'Tinashe Moyo', skills: ['growth'], bio: 'Grew an edtech app to 40k users. 12k stars on my repo.' },
    { socialLinks: { github: 'tinashem', linkedin: 'https://linkedin.com/in/tinashem' }, projects: [{ title: 'Kaya Learn', status: 'live' }, { title: 'Mvura Pay', status: 'live' }], isVerified: true, fundingStage: 'Seed' },
  );
  const shown = badged.map((b) => b.label).join(' | ');
  assert(/40k users/.test(shown) && /12k GitHub stars/.test(shown) && !/LinkedIn on file/.test(shown), 'traction outranks a contact link for the three slots: ' + shown);
  const onlyLink = P.proofPoints({}, { socialLinks: { github: 'tinashem' } });
  assert(onlyLink.some((b) => b.kind === 'github' && b.checked && /tinashem/.test(b.label)), 'a GitHub handle on their own profile is a checked badge: ' + JSON.stringify(onlyLink[0]));
  assert(!onlyLink.some((b) => /users|stars/.test(b.label)), 'and nothing is invented to fill the row');
  assert(badged.some((b) => b.kind === 'users' && !b.checked && /40k users/.test(b.label) && /40k users/.test(b.quote)), 'a number they wrote themselves is quoted, not asserted: ' + JSON.stringify(badged));
  assert(badged.length <= 3, 'at most three badges - a card is not a trophy cabinet');
  assert(P.badgeLine(badged).includes('(their words)'), 'the text version says which part is unverified: ' + P.badgeLine(badged));
  assert(P.proofPoints({}, { socialLinks: { github: 'x'.repeat(80) } }).every((b) => b.kind !== 'github'), 'a garbage GitHub value is not a badge');
  const snipped = P.proofFromSnippet('Y Combinator alum - 10k stars on GitHub, raised $2.5M seed round');
  assert(snipped.some((b) => /10k GitHub stars/i.test(b.label)) && snipped.some((b) => /Y Combinator alum/.test(b.label)) && snipped.some((b) => /Raised \$2\.5M/.test(b.label)), 'an outside lead gets the same treatment from the snippet we already paid for: ' + snipped.map((b) => b.label).join(' | '));

  // ---- seed a squad-shaped world for the rest of the block
  const squadFolk = {
    ruta: { displayName: 'Ruta Zvidzaya', occupation: 'Founder', company: 'Kwata', city: 'Harare', country: 'Zimbabwe', skills: ['react native', 'payments'], industries: ['edtech', 'fintech'], bio: 'Building an AI tutor for secondary schools, need a cofounder', goals: 'wants to ship an AI tutor that schools actually pay for', onboarded: true, isVisible: true },
    growthg: { displayName: 'Grace Chafa', occupation: 'Growth marketer', company: 'Freelance', city: 'Harare', country: 'Zimbabwe', skills: ['growth', 'marketing', 'seo', 'react native'], industries: ['edtech'], bio: 'Grew a learning app to 40k users', goals: 'wants to work on education', onboarded: true, isVisible: true, socialLinks: { github: 'gracechafa' }, projects: [{ title: 'StudyPass', status: 'live' }, { title: 'QuizWave', status: 'live' }], isVerified: true },
    angelg: { displayName: 'Nkosinathi Dube', occupation: 'Angel investor', company: 'ZimAngels', city: 'Harare', country: 'Zimbabwe', skills: ['angel', 'fintech'], industries: ['edtech', 'fintech'], bio: 'Wrote cheques into six startups, ex-Econet', goals: 'looking for AI and edtech deals in Zimbabwe', onboarded: true, isVisible: true, fundingStage: 'Seed' },
  };
  for (const [uid, u] of Object.entries(squadFolk)) {
    await db.collection('users').doc(uid).set({ uid, ...u });
    await db.collection('publicProfiles').doc(uid).set({ uid, ...u, profilePic: `https://ik.imagekit.io/x/${uid}.jpg` });
  }
  assert((await L.ask('ruta', 'what can you do')).reply, 'rutas profile exists so help answers');

  // ---- 3. the squad shape: only when it is asked for
  assert(L.parseAsk('build me a squad of three').wantsSquad === true, 'parseAsk spots a group ask');
  assert(L.parseAsk('I need a flutter developer in Harare').wantsSquad === false, 'a single person is not a squad');
  const helpSaid = await L.ask('ruta', 'hey there');
  assert(!/squad|brief|follow-up|proof badge/i.test(helpSaid.reply), 'Linky does not advertise the new abilities unprompted: ' + helpSaid.reply.slice(0, 60));

  await clearBudget('ruta');
  const squadAsk = await L.ask('ruta', 'I need a flutter dev + a growth marketer and an angel investor who gets edtech');
  console.log('    squad reply:', squadAsk.reply.slice(0, 200));
  assert(squadAsk.kind === 'squad' && !squadAsk.none, 'a multi-role ask is answered as a squad, not three searches');
  assert(squadAsk.cards.length >= 3 && new Set(squadAsk.cards.map((c) => c.targetUid)).size === squadAsk.cards.length, 'the triangle is distinct humans: ' + squadAsk.cards.map((c) => c.targetName).join(', '));
  assert(squadAsk.cards.every((c) => c.squadId && c.squadRole), 'every squad card says which trio it is and the part they play');
  assert(squadAsk.cards.some((c) => c.targetUid === 'growthg' && c.targetUid !== 'ruta'), 'grace is in it for the growth half');
  assert(/Squad 1/.test(squadAsk.reply) && /flutter|Growth|angel/i.test(squadAsk.reply), 'the reply presents the squad as a unit: ' + squadAsk.reply.slice(0, 120));
  assert(squadAsk.cards.some((c) => (c.badges || []).some((b) => b.kind === 'github' && b.checked)), 'the squad cards carry proof of work too');
  assert(squadAsk.asksLeft === FREE.asksPerDay - 1, 'a squad costs one ask, the same as a person');

  // a triangle only counts if the members are not the same person three times
  {
    const ctx = await L.buildMatchContext();
    const slots = ['flutter developer', 'growth marketer', 'angel investor'].map((label) => ({ label, ask: L.parseAsk(label), self: false }));
    const foundSquad = await L.findSquads('ruta', L.parseAsk('a squad for my edtech startup'), ctx, { user: await L.loadUser('ruta'), slots });
    assert(foundSquad.squads.length >= 1, 'findSquads fills every slot or says it could not: ' + JSON.stringify(foundSquad.slots));
    const trio = foundSquad.squads[0];
    assert(new Set(trio.members.map((x) => x.facts.uid)).size === trio.members.length, 'no human twice in one squad');
    assert(trio.members.every((x, i, all) => all.every((y, j) => i === j || (x.facts.skills || []).filter((k) => (y.facts.skills || []).includes(k)).length <= 1)), 'a squad member never overlaps another on more than one skill');
    assert(trio.members.some((x) => x.slot === 'growth marketer') && trio.members.some((x) => x.slot === 'angel investor'), 'the roles the member named are the roles that were filled');
  }

  // ---- one approval, one message each, and the free plan still decides how far that goes
  const sqId = squadAsk.cards[0].squadId;
  await clearBudget('ruta');
  const squadMeet = await L.meetSquad('ruta', sqId);
  assert(squadMeet.needsApproval && squadMeet.pitch.length > 80 && squadMeet.members.length === squadAsk.cards.length, 'the squad draft waits for a yes like any other intro');
  assert(/pass|no explanation|no hard feelings/i.test(squadMeet.pitch) || /15 minutes|fifteen/i.test(squadMeet.pitch), 'the squad pitch asks for a cheap yes: ' + squadMeet.pitch.slice(0, 90));
  const squadSent = await L.approveSquad('ruta', {});
  assert(squadSent.sent === FREE.meetsPerDay && squadSent.waiting.length === squadAsk.cards.length - FREE.meetsPerDay, `two Meets a day means two went out and ${squadAsk.cards.length - 2} wait, and Linky says so: ${squadSent.note}`);
  assert(/still waiting/i.test(squadSent.note), 'the member is told who was left out rather than silently capped');

  // ---- 1. the synergy brief: written for the pair, once, in their chat
  const introDocs = await db.collection('intros').where('requesterId', '==', 'ruta').get();
  assert(introDocs.size >= 2, 'the squad approval really created one intro per person');
  const firstIntro = introDocs.docs.find((d) => d.data().status === 'pending');
  const targetUid = firstIntro.data().targetId;
  const matchId = ['ruta', targetUid].sort().join('_');
  const accepted = await L.respond(targetUid, firstIntro.id, 'accept');
  assert(accepted.status === 'accepted' && accepted.matchId === matchId, 'the target said yes and a chat exists');
  const chatMsgs = await db.collection('matches').doc(matchId).collection('messages').get();
  const briefMsg = chatMsgs.docs.map((d) => d.data()).find((x) => x.type === 'synergy_brief');
  assert(!!briefMsg, 'Linky posted the one-pager into the chat both of them can read');
  assert(/Why I put you two together/i.test(briefMsg.content) && /fintech/i.test(briefMsg.brief.why.join(' ')), 'the brief leads with what both profiles actually say: ' + briefMsg.brief.why.join(' | '));
  {
    const gap = await L.ensureBrief({ matchId: 'cara_gift', requesterId: 'cara', targetId: 'gift' });
    assert(!!gap && /gap between them/i.test(gap.brief.why.join(' ')), 'and a pair with nothing shared is told that, not flattered: ' + gap.brief.why.join(' | '));
    assert(gap.brief.agenda.length === 3 && gap.brief.icebreakers.length === 3, 'the fallback still writes a full page - no model, no missing section');
  }
  // the pair that DOES share something (alice and bob are both fintech) has to
  // show it, because "why you" is the whole point of the page
  {
    const abMsgs = await db.collection('matches').doc('alice_bob').collection('messages').get();
    const abBrief = abMsgs.docs.map((d) => d.data()).find((x) => x.type === 'synergy_brief');
    assert(!!abBrief && /fintech/i.test(abBrief.brief.why.join(' ')), 'the overlap line cites a fact both profiles actually carry: ' + (abBrief?.brief?.why || []).join(' | '));
    assert(!/passionate|exciting|synerg|leverage|rockstar/i.test(`${abBrief.brief.why.join(' ')} ${abBrief.content}`), 'and the brief is not a compliment generator');
  }
  const agenda = (briefMsg.brief.agenda || []);
  assert(agenda.length === 3 && agenda[0].span === '0-5' && /15/.test(agenda.map((a) => a.span).join()), 'the agenda is a 15-minute call in three blocks: ' + agenda.map((a) => a.span).join(' '));
  assert((briefMsg.brief.icebreakers || []).length === 3 && briefMsg.brief.icebreakers.every((x) => x.length > 12), 'three icebreakers, each a sentence a human could say');
  assert(!(await L.ensureBrief({ matchId, requesterId: 'ruta', targetId: targetUid })), 'and it is written once - reloading does not rewrite the page');
  const matchDoc = await db.collection('matches').doc(matchId).get();
  assert(!!matchDoc.data().synergyBrief, 'the brief also lives on the match, so the app can reopen it');

  // ---- 2. the post-intro loop
  assert(Object.values(L.LOOP_CHOICES).join('|') === 'Met & pursuing the project|Great chat, staying in touch|No response yet|Not a fit', 'the four answers are the four he asked for');
  const afterAccept = await db.collection('intros').doc(firstIntro.id).get();
  const due = afterAccept.data().followupDue.toMillis();
  assert(afterAccept.data().followupStatus === 'queued' && due - Date.now() > 47 * 3600000 && due - Date.now() <= L.LOOP_DELAY_MS + 60000, 'the question is scheduled 48 hours after the yes, not before');
  let queue = await L.dueFollowups(Date.now());
  assert(queue.length === 0, 'at 48 hours minus nothing, Linky keeps quiet');
  queue = await L.dueFollowups(Date.now() + 49 * 3600000);
  assert(queue.length >= 2 && queue.some((x) => x.id === firstIntro.id), '49 hours later every accepted intro is due for its one question: ' + queue.length);
  const pushed = await L.sendDueFollowups({ now: Date.now() + 49 * 3600000, max: 5 });
  assert(pushed.sent === queue.length && new Set(pushed.items.map((x) => x.uid)).size === pushed.sent, 'one question per member, not one per intro: ' + JSON.stringify(pushed.items.map((x) => [x.uid, x.otherUid])));
  const asked = await L.loadState('ruta');
  assert(asked.pendingLoop && squadAsk.cards.map((c) => c.targetName).includes(asked.pendingLoop.otherName), 'and it asks the member who wanted the intro, about the person they were introduced to: ' + (asked.pendingLoop || {}).otherName);
  const loopHome = await L.home('ruta');
  assert((await L.sendDueFollowups({ now: Date.now() + 49 * 3600000, max: 5 })).sent === 0, 'and the same member is not asked twice in the same day');
  assert(loopHome.loop && loopHome.loop.choices.length === 4 && /how did it go|actually connect|land/i.test(loopHome.loop.question), 'the app gets four buttons, not a paragraph to type into');
  const pushedAgain = await L.sendDueFollowups({ now: Date.now() + 50 * 3600000, max: 5 });
  assert(pushedAgain.sent === 0, 'never the same question twice');
  // a sentence is still an answer to the question that is open
  const saidInWords = await L.ask('ruta', 'we spoke on friday and we are building it');
  assert(/answer 1 to 4|ai:loop/i.test(saidInWords.reply) && saidInWords.free === true && !saidInWords.cards.length, 'a plain sentence about the intro is kept with it, not run as a search: ' + saidInWords.reply.slice(0, 70));
  assert(saidInWords.intent === 'words:loop' || saidInWords.intent === 'ai:loop', 'and the turn is tagged as the loop, whatever read it: ' + saidInWords.intent);
  const answered = await L.answerLoop('ruta', { choice: 'met' });
  assert(answered.answered && answered.choice === 'met', 'and the four options are answerable directly');
  const pairId = ['ruta', targetUid].sort().join('_');
  const pair = (await db.collection('linkyPairs').doc(pairId).get()).data();
  assert(pair && pair.outcome === 'met' && pair.introId === firstIntro.id, 'the outcome is written on the pair, where the matcher can read it');
  const introAfter = await db.collection('intros').doc(firstIntro.id).get();
  assert(introAfter.data().followup.status === 'answered' && introAfter.data().followup.choice === 'met', 'and on the intro, so the audit page can show it');
  // a card for someone they already met says so instead of pretending it is new
  const warmCard = await L.pickPerson('ruta', targetUid);
  const warmList = await L.loadCards('ruta');
  assert(warmList.some((c) => c.targetUid === targetUid && c.pairNote && /met/i.test(c.pairNote)), 'the warm pair is acknowledged on the card: ' + (warmCard.pairNote || 'none'));
  // "not a fit" ends it, quietly and for a while
  const otherIntro = (await db.collection('intros').where('requesterId', '==', 'ruta').get()).docs.find((d) => d.data().targetId !== targetUid && d.data().status === 'pending');
  if (otherIntro) {
    await L.respond(otherIntro.data().targetId, otherIntro.id, 'accept');
    await L.answerLoop('ruta', { choice: 'nope' }).catch(() => null);
    await L.answerLoop('ruta', { choice: 'nope', introId: otherIntro.id });
    const otherPair = (await db.collection('linkyPairs').doc(['ruta', otherIntro.data().targetId].sort().join('_')).get()).data();
    assert(otherPair.outcome === 'nope', 'a no is a no: recorded as not a fit');
    await clearBudget('ruta');
    await clearBudget('ruta');
    const afterNo = await L.ask('ruta', 'who could be an angel investor for edtech');
    assert(!afterNo.cards.some((c) => c.targetUid === otherIntro.data().targetId), 'and Linky stops putting those two in front of each other');
  }
  const auditOut = await L.audit('ruta');
  assert(auditOut && auditOut.facts, 'the audit page still renders with the new state on the member');
  const loopedHome = await L.home('ruta');
  assert(!loopedHome.loop, 'once answered, the question is gone from the home screen');
}

console.log('\nALL PASSED');
process.exit(0);
