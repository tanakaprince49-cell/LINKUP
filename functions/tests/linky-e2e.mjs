// Run: start the Firestore emulator on 127.0.0.1:8089, create a throwaway SA json
// (any RSA key; project_id linkup-e0906) at FAKE_SA_JSON, then from repo root:
//   node functions/tests/linky-e2e.mjs
// End-to-end exercise of api/_linky.js + api/linky.js against the emulator.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089';
process.env.FIREBASE_SERVICE_ACCOUNT = (await import('node:fs')).readFileSync(process.env.FAKE_SA_JSON || '/tmp/fake-sa.json','utf8');
process.env.TELEGRAM_BOT_TOKEN = '';
const L = await import('../../api/_linky.js');
const handler = (await import('../../api/linky.js')).default;
await fetch('http://127.0.0.1:8089/emulator/v1/projects/linkup-e0906/databases/(default)/documents', { method: 'DELETE' });
const db = (await import('../../api/_firebaseAdmin.js')).getDb();

const users = {
  alice: { displayName: 'Alice Moyo', occupation: 'Founder', company: 'PayZim', city: 'Harare', country: 'Zimbabwe', skills: ['sales', 'fintech'], industries: ['fintech'], bio: 'Building mobile money tools for SMEs', onboarded: true, isVisible: true },
  bob: { displayName: 'Bob Chikwanha', occupation: 'Flutter developer', company: 'Freelance', city: 'Harare', country: 'Zimbabwe', skills: ['flutter', 'dart', 'firebase'], industries: ['fintech', 'mobile'], bio: 'Ship Flutter apps for African fintechs', onboarded: true, isVisible: true },
  cara: { displayName: 'Cara Dube', occupation: 'Designer', city: 'Bulawayo', country: 'Zimbabwe', skills: ['figma', 'branding'], industries: ['retail'], bio: 'Brand design for shops', onboarded: true, isVisible: true },
  dan: { displayName: 'Dan Ncube', occupation: 'Backend engineer', city: 'Harare', country: 'Zimbabwe', skills: ['node', 'flutter'], industries: ['fintech'], bio: 'APIs and payments', onboarded: true, isVisible: true },
};
for (const [uid, u] of Object.entries(users)) {
  await db.collection('users').doc(uid).set({ uid, ...u });
  await db.collection('publicProfiles').doc(uid).set({ uid, ...u, profilePic: `https://ik.imagekit.io/x/${uid}.jpg` });
}
await db.collection('userPrivate').doc('bob').set({ pushTokens: [] });
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok  -', m); };

// intake (no Gemini key -> heuristic)
let r = await L.intake('alice', 'I need a developer', { source: 'app' });
assert(!r.ready && /vague/i.test(r.reply), 'pushback on vague intent: ' + r.reply);
r = await L.intake('alice', 'A Flutter developer to build a fintech MVP in Harare, paid, this month');
console.log('    reply:', r.reply);
assert(r.ready && r.intent && r.intent.offer === 'paid', 'intake ready with paid offer');
// save -> immediate match pass (heuristic, no Gemini)
const saved = await L.saveIntent('alice', r.intent, { source: 'app' });
console.log('    cards:', saved.cards.map((c) => `${c.targetName} :: ${c.why}`));
assert(saved.cards.length >= 1 && saved.cards.some((c) => c.targetUid === 'bob'), 'bob (flutter, Harare, fintech) is a cited card');
assert(!saved.cards.some((c) => c.targetUid === 'cara'), 'cara (designer, no overlap) not a card');
assert(!saved.cards.some((c) => c.targetUid === 'alice'), 'never matches yourself');
// free limit = 1 active intent
let limited = null; try { await L.saveIntent('alice', r.intent); } catch (e) { limited = e; }
assert(limited && limited.code === 'intent_limit', 'free tier blocked at 2nd intent: ' + limited?.message);
// home
let h = await L.home('alice');
assert(h.intents.length === 1 && h.cards.length === saved.cards.length && h.limits.meetsPerDay === 3, 'home shows intent, cards, 3 meets/day');
// meet -> intro pending + notification to bob
const bobCard = h.cards.find((c) => c.targetUid === 'bob');
const m = await L.meet('alice', bobCard.id);
assert(m.pending && m.introId === 'alice_bob' && m.meetsLeft === 2, 'meet creates pending intro, 2 meets left');
let notes = await db.collection('notifications').where('userId', '==', 'bob').get();
assert(notes.size === 1 && notes.docs[0].data().type === 'intro_request' && notes.docs[0].data().requestId === 'alice_bob', 'bob got intro_request notification');
h = await L.home('bob');
assert(h.inbound.length === 1 && h.inbound[0].requesterName === 'Alice Moyo', 'bob sees inbound intro');
// meet budget: 3/day
const other = h.cards; // none
await db.collection('linkyState').doc('alice').set({ meets: { day: L.dayKey(), count: 3 } }, { merge: true });
let mb = null; try { await L.meet('alice', bobCard.id); } catch (e) { mb = e; }
assert(mb === null, 'already-requested card returns early instead of consuming budget');
const danCard = h2cards(); function h2cards() { return null; }
// accept -> match + approved connectionRequest + opener message + notification to alice
const acc = await L.respond('bob', 'alice_bob', 'accept');
assert(acc.status === 'accepted' && acc.matchId === 'alice_bob', 'accept -> matchId alice_bob');
const match = await db.collection('matches').doc('alice_bob').get();
assert(match.exists && match.data().userIds.join() === 'alice,bob' && match.data().participantProfiles.bob.displayName === 'Bob Chikwanha', 'match doc with participantProfiles');
const cr = await db.collection('connectionRequests').doc('alice_bob').get();
assert(cr.exists && cr.data().status === 'approved', 'approved connectionRequest unlocks chat gate');
const msgs = await db.collection('matches').doc('alice_bob').collection('messages').get();
assert(msgs.size === 1 && /Linky here/.test(msgs.docs[0].data().content), 'opener message from Linky: ' + msgs.docs[0].data().content);
notes = await db.collection('notifications').where('userId', '==', 'alice').get();
assert(notes.docs.some((d) => d.data().type === 'intro_accepted' && d.data().matchId === 'alice_bob'), 'alice got intro_accepted with matchId');
// decline path (dan asks bob; bob declines -> mute both ways)
await db.collection('linkyState').doc('alice').delete();
const danIntent = await L.saveIntent('dan', { need: 'Flutter developer for payments app in Harare', offer: 'paid', location: 'Harare', urgency: 'this_week' });
const bobFromDan = danIntent.cards.find((c) => c.targetUid === 'bob');
assert(bobFromDan, 'dan gets bob card');
await L.meet('dan', bobFromDan.id);
const dec = await L.respond('bob', 'dan_bob', 'decline');
assert(dec.status === 'declined', 'decline');
const bobState = await L.loadState('bob');
assert(bobState.muted && bobState.muted.dan, 'bob muted dan');
const danHome = await L.home('dan');
assert(danHome.cards.find((c) => c.id === bobFromDan.id).status === 'declined', 'dan card shows declined');
// inbound cap: bob cap -> 0 excludes him from new matching
await L.setPrefs('bob', { inboundCap: 0 });
await db.collection('introSuggestions').doc('alice').delete();
await db.collection('intents').doc(saved.intent.id).set({ lastMatchedAt: null }, { merge: true });
const ctx = await L.buildMatchContext();
const again = await L.matchIntent({ id: saved.intent.id, ...saved.intent, ownerId: 'alice' }, ctx);
assert(!again.some((c) => c.targetUid === 'bob'), 'bob excluded when inbound cap is 0 (cards: ' + again.map((c) => c.targetName) + ')');
// openTo filter: dan only open to equity -> paid intents skip him
await L.setPrefs('dan', { openTo: ['equity'] });
await db.collection('introSuggestions').doc('alice').delete();
const ctx2 = await L.buildMatchContext();
const again2 = await L.matchIntent({ id: saved.intent.id, ...saved.intent, ownerId: 'alice' }, ctx2);
assert(!again2.some((c) => c.targetUid === 'dan'), 'dan excluded by openTo=[equity] for a paid intent');
// audit + forget
const a = await L.audit('alice');
assert(a.facts.name === 'Alice Moyo' && a.intents.length === 1 && a.introsSent.length === 1, 'audit lists facts, intents, intros');
// bot linking
const { code } = await L.createLinkCode('bob');
const linkedUid = await L.consumeLinkCode(code.toLowerCase(), 'telegram', '12345');
assert(linkedUid === 'bob', 'link code (case-insensitive) links telegram chat to bob');
assert((await L.botUserFor('telegram', '12345')).uid === 'bob', 'botUsers row exists');
assert((await L.loadState('bob')).channels.telegram === '12345', 'linkyState.channels.telegram set');
assert((await L.consumeLinkCode(code, 'telegram', '999')) === null, 'code is single-use');
// cron: expiry + brief
await db.collection('intents').doc(saved.intent.id).set({ expiresAt: new Date(Date.now() - 1000), lastMatchedAt: null }, { merge: true });
const cron = await L.runCron({ batch: 3 });
console.log('    cron:', JSON.stringify(cron));
assert(cron.expiredIntents === 1, 'expired alice intent');
// handler-level: cron auth + app auth
const mkRes = () => { const r = { code: 0, body: null, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r; r.send = (b) => { r.body = b; return r; }; return r; };
let res = mkRes();
await handler({ method: 'POST', query: { action: 'cron' }, headers: {}, body: {} }, res);
assert(res.code === 401, 'cron without token -> 401');
const { cronToken } = await import('../../api/linky.js');
res = mkRes();
await handler({ method: 'POST', query: { action: 'cron', batch: '2' }, headers: { 'x-linky-cron': cronToken() }, body: {} }, res);
assert(res.code === 200 && 'activeIntents' in res.body, 'cron with derived token -> 200');
res = mkRes();
await handler({ method: 'POST', query: {}, headers: {}, body: { action: 'home' } }, res);
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
console.log('\nALL PASSED');
process.exit(0);
