// Who may write what on a campaign document, proved against the real
// firestore.rules in the emulator - not against a copy of the logic.
//
//   firebase emulators:start --only firestore --project linkup-e0906   (port 8089, rules loaded)
//   FAKE_SA_JSON=/path/fake-sa.json node functions/tests/campaign-rules-e2e.mjs
//
// The Admin SDK the app's own tests use bypasses rules entirely, so a rules
// change is invisible to them. This drives the emulator over REST with a fake
// signed-in token - exactly the write the phone sends - and fails if an owner
// cannot fix a live campaign, or if an owner (or a stranger) can touch anything
// that is not theirs: status, stats, billing, the reviewer's note, or somebody
// else's campaign.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089';
process.env.FIREBASE_SERVICE_ACCOUNT = (await import('node:fs')).readFileSync(process.env.FAKE_SA_JSON || '/tmp/fake-sa.json', 'utf8');
import fs from 'node:fs';

const PID = 'linkup-e0906';
const BASE = `http://127.0.0.1:${process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]}/v1/projects/${PID}/databases/(default)/documents`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// The emulator decodes claims and never checks the signature, so a self-made
// token is enough to be "signed in" as a given uid.
const token = (uid) => [
  b64({ alg: 'none', typ: 'JWT' }),
  b64({ user_id: uid, sub: uid, iss: `https://securetoken.google.com/${PID}`, aud: PID, iat: 1, exp: Math.floor(Date.now() / 1000) + 3600 }),
  '',
].join('.');

const db = (await import('../../api/_firebaseAdmin.js')).getDb();

let failed = 0;
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); failed += 1; } else console.log('ok  -', msg); };

/** Write like the client does: one PATCH, an update mask, a signed-in user. */
async function patch(collection, id, uid, fields) {
  const keys = Object.keys(fields);
  const mask = keys.map((k) => `updateMask.fieldPaths=${k}`).join('&');
  const res = await fetch(`${BASE}/${collection}/${id}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${token(uid)}` } : {}) },
    body: JSON.stringify({ fields: encode(fields) }),
  });
  return res.status;
}
function encode(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null) out[k] = { nullValue: null };
    else if (typeof v === 'number') out[k] = { integerValue: String(v) };
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else if (Array.isArray(v)) out[k] = { arrayValue: { values: v.map((x) => encode({ v: x }).v) } };
    else if (typeof v === 'object') out[k] = { mapValue: { fields: encode(v) } };
    else out[k] = { stringValue: String(v) };
  }
  return out;
}
async function get(code, id, uid = OWNER) {
  const r = await fetch(`${BASE}/${code}/${id}`, { headers: uid ? { Authorization: `Bearer ${token(uid)}` } : {} });
  return r.ok ? r.json() : null;
}

// ================================================================ fixtures
await fetch(`http://127.0.0.1:8089/emulator/v1/projects/${PID}/databases/(default)/documents`, { method: 'DELETE' });

const OWNER = 'owner-ada';
const OTHER = 'stranger-bo';
const creative = { headline: 'Fintech founders dinner', body: 'Harare, Thursday 6pm', imageUrl: 'https://ik.imagekit.io/x/one.jpg', cta: 'RSVP' };
const placements = [{ id: 'p1', feedIndex: 1, from: Date.now(), to: Date.now() + 6e8 }];

const seed = async (id, over = {}) => {
  await db.collection('campaigns').doc(id).set({
    id,
    ownerId: OWNER,
    ownerName: 'Ada Moyo',
    productName: 'PayZim',
    name: 'Founders dinner',
    creative,
    industries: ['fintech'],
    placements,
    status: 'active',
    statsImpressions: 10,
    statsClicks: 2,
    reviewNote: 'Approved on the merits.',
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
    ...over,
  });
};
await seed('camp-active');
await seed('camp-pending', { status: 'pending_review' });
await seed('camp-rejected', { status: 'rejected' });
await seed('camp-over', { status: 'finished' });
await db.collection('campaigns').doc('camp-other').set({
  id: 'camp-other', ownerId: OTHER, name: 'Somebody else', creative, industries: [], placements: [],
  status: 'active', statsImpressions: 0, statsClicks: 0, createdAt: Date.now(), updatedAt: Date.now(),
});

// ================================================================ the new door
let st = await patch('campaigns', 'camp-active', OWNER, {
  name: 'Founders dinner - new date',
  creative: { ...creative, body: 'Same dinner, now Thursday 7pm, upstairs.' },
  liveEditedAt: Date.now(),
  updatedAt: Date.now(),
});
assert(st === 200, `an owner can fix the creative of a LIVE campaign (REST ${st})`);
const after = await get('campaigns', 'camp-active', OWNER);
assert(after?.fields?.name?.stringValue === 'Founders dinner - new date' && /7pm/.test(after?.fields?.creative?.mapValue?.fields?.body?.stringValue || ''), 'and the change is actually in the document');
assert(after?.fields?.status?.stringValue === 'active', 'editing a live campaign leaves it live');
assert(after?.fields?.statsImpressions?.integerValue === '10', 'the counters did not move');

// the fields that were never theirs, tested one at a time on the same doc
await patch('campaigns', 'camp-active', OWNER, { status: 'active', updatedAt: Date.now() });
const forbidden = [
  ['statsImpressions', 999],
  ['statsClicks', 99],
  ['reviewNote', 'Approved by me, the owner'],
  ['ownerId', OTHER],
  ['productName', 'Something else'],
];
for (const [field, value] of forbidden) {
  const code = await patch('campaigns', 'camp-active', OWNER, { [field]: value });
  assert(code === 403, `an owner still cannot write ${field} on their campaign (${code})`);
}
// approving yourself is the reviewer's job, not the owner's
const selfApprove = await patch('campaigns', 'camp-pending', OWNER, { status: 'active', updatedAt: Date.now() });
assert(selfApprove === 403, `an owner cannot approve their own pending campaign (${selfApprove})`);
const selfStatusLive = await patch('campaigns', 'camp-over', OWNER, { status: 'active', updatedAt: Date.now() });
assert(selfStatusLive === 403, `or reopen a campaign that has finished (${selfStatusLive})`);
// a creative edit must not smuggle a status change in the same write
const smuggled = await patch('campaigns', 'camp-pending', OWNER, {
  name: 'Renamed and approved by me', status: 'active', creative: { ...creative, body: 'sneaky' }, updatedAt: Date.now(),
});
assert(smuggled === 403, `one write cannot both edit the creative and flip the status (${smuggled})`);
const smuggleLive = await patch('campaigns', 'camp-over', OWNER, {
  name: 'Renamed and reopened', status: 'active', creative: { ...creative, body: 'sneaky' }, updatedAt: Date.now(),
});
assert(smuggleLive === 403, `not even on a finished campaign (${smuggleLive})`);

// adding an unrelated key alongside a legal one is refused, not ignored
const extra = await patch('campaigns', 'camp-active', OWNER, { name: 'Renamed', isGlobalPromo: true, updatedAt: Date.now() });
assert(extra === 403, `a live edit may only touch the content fields (${extra})`);

// ================================================================ the doors that were already there
const pend = await patch('campaigns', 'camp-pending', OWNER, { name: 'Renamed while pending', creative: { ...creative, headline: 'New headline' }, updatedAt: Date.now() });
assert(pend === 200, `an owner can still edit a campaign sitting in review (${pend})`);
const rej = await patch('campaigns', 'camp-rejected', OWNER, { name: 'Renamed after rejection', updatedAt: Date.now() });
assert(rej === 403, `a rejected campaign is not editable by its owner - the app does not offer it, so the rules must not either (${rej})`);
const rejAdmin = await patch('campaigns', 'camp-rejected', OWNER, { reviewNote: 'still no', updatedAt: Date.now() });
assert(rejAdmin === 403, `and the reviewer's note is not theirs to rewrite (${rejAdmin})`);
const fin = await patch('campaigns', 'camp-over', OWNER, { name: 'Renamed after finishing', updatedAt: Date.now() });
assert(fin === 403, `a campaign that has finished serving is closed for edits (${fin})`);
const stranger = await patch('campaigns', 'camp-active', OTHER, { name: 'Hijacked', updatedAt: Date.now() });
assert(stranger === 403, `nobody else can edit it (${stranger})`);
const anon = await patch('campaigns', 'camp-active', null, { name: 'No token', updatedAt: Date.now() });
assert(anon === 401 || anon === 403, `and neither can an unauthenticated write (${anon})`);
const ownPause = await patch('campaigns', 'camp-active', OWNER, { status: 'paused', updatedAt: Date.now() });
assert(ownPause === 200, `the owner can still pause on its own (${ownPause})`);
const otherDoc = await patch('campaigns', 'camp-other', OWNER, { name: 'Not yours', updatedAt: Date.now() });
assert(otherDoc === 403, `and only their own (${otherDoc})`);

// the counters stay writable by whoever the app writes them as, but capped
const bump = await patch('campaigns', 'camp-active', OTHER, { statsImpressions: 12, statsClicks: 3 });
assert(bump === 200, `an impression bump within the cap is allowed (${bump})`);
const blow = await patch('campaigns', 'camp-active', OTHER, { statsImpressions: 4e6 });
assert(blow === 403, `and an inflated one is not (${blow})`);

// ================================================================ the app side agrees
{
  const src = fs.readFileSync('mobile/src/lib/campaigns.ts', 'utf8');
  assert(/updateCampaignCreative/.test(src) && /liveEditedAt/.test(src), 'the client writes liveEditedAt when it edits a live campaign');
  assert(/notifyCampaignAdmins\([\s\S]{0,200}'edited a LIVE campaign/.test(src) || /edited a LIVE campaign/.test(src), 'an admin is told a live campaign changed');
  const screen = fs.readFileSync('mobile/src/screens/CreateCampaignScreen.tsx', 'utf8');
  assert(/isLiveEdit/.test(screen) && /PUBLISH CHANGES/.test(screen), 'the screen offers the live edit as its own mode');
  const list = fs.readFileSync('mobile/src/screens/CampaignsScreen.tsx', 'utf8');
  assert(/'active'\s*\|\|\s*status === 'paused'|active[\s\S]{0,40}paused/.test(list), 'the list shows an edit pencil for active and paused campaigns');
}

if (failed) { console.error(`\n${failed} FAILED`); process.exit(1); }
console.log('\nALL PASSED');
process.exit(0);
