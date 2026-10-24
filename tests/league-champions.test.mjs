import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { leagueScore, LEAGUE_PERIODS } from '../shared/league.js';
import { seasonWindow, seasonDocId, seasonLabel } from '../shared/league-season.js';
import { awardSeasonChampion, awardSeasonChampions, readSeasonChampions, championFor, CHAMPION_COLLECTION } from '../api/_leagueChampions.js';
import { momentumCardSvg, renderMomentumCard, renderCardSvg } from '../api/_momentumCard.js';
import { awardWeek } from '../shared/campaign-reward.js';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const at = Date.parse('2026-10-24T09:00:00Z');

/** Minimal in-memory Firestore for the pure league jobs. */
function memoryDb({ users = {}, contributions = {}, docs = {} } = {}) {
  const store = new Map(Object.entries(docs));
  const docRef = (col, id) => ({
    __col: col,
    id,
    async get() {
      if (col === 'users') return { id, exists: !!users[id], data: () => users[id] };
      return { id, exists: store.has(col + '/' + id), data: () => store.get(col + '/' + id) };
    },
  });
  const activityQuery = () => {
    let after = '', cap = Infinity;
    const q = {
      where: () => q,
      orderBy: () => q,
      limit(n) { cap = n; return q; },
      startAfter(id) { after = id; return q; },
      doc: id => docRef('builderContributions', id),
      async get() {
        const ids = Object.keys(contributions).sort()
          .filter(id => id > after && contributions[id].publicMomentum === true)
          .slice(0, cap);
        return { docs: ids.map(id => ({ id, data: () => contributions[id] })), size: ids.length };
      },
    };
    return q;
  };
  return {
    store,
    collection(name) {
      if (name === 'builderContributions') return activityQuery();
      return { doc: id => docRef(name, id) };
    },
    async getAll(...args) {
      const refs = args.filter(a => a && a.__col);
      return Promise.all(refs.map(r => r.get()));
    },
    async runTransaction(fn) {
      const tx = {
        get: ref => ref.get(),
        set: (ref, value) => { store.set(ref.__col + '/' + ref.id, value); },
      };
      return fn(tx);
    },
  };
}

const profile = (name, extra = {}) => ({ displayName: name, onboarded: true, isVisible: true, city: 'Harare', country: 'Zimbabwe', ...extra });
const activity = (extra = {}) => ({ publicMomentum: true, points: 20, totalUpdates: 2, days: ['2026-09-20', '2026-09-24'], habit: { earnedCredits: 0, credits: 0, awards: [] }, ...extra });

test('season windows always point at the last COMPLETE month or year in UTC', () => {
  assert.deepEqual(seasonWindow('month', at).key, '2026-09');
  assert.equal(seasonWindow('month', at).start, Date.UTC(2026, 8, 1));
  assert.equal(seasonWindow('month', at).end, Date.UTC(2026, 9, 1));
  // 1 January still awards December, not an empty new year.
  assert.equal(seasonWindow('month', Date.parse('2026-01-01T00:00:00Z')).key, '2025-12');
  assert.equal(seasonWindow('year', at).key, '2025');
  assert.equal(seasonWindow('year', Date.parse('2027-01-01T00:00:00Z')).key, '2026');
  assert.equal(seasonLabel('month', '2026-09'), 'September 2026');
  assert.equal(seasonDocId('year', '2025'), 'year-2025');
  assert.deepEqual([...LEAGUE_PERIODS], ['week', 'month', 'year', 'all']);
});

test('yearly scoring starts on 1 January UTC and ignores the previous year', () => {
  const c = activity({ days: ['2025-12-31', '2026-01-01', '2026-10-24'], points: 300, totalUpdates: 30 });
  assert.equal(leagueScore(c, 'year', at).points, 20);
  assert.equal(leagueScore(c, 'all', at).points, 300);
});

test('a season champion is granted once, records only public totals, and an empty season stays empty', async () => {
  const users = { alice: profile('Alice'), bob: profile('Bob') };
  const contributions = {
    alice: activity({ points: 90, totalUpdates: 9, days: ['2026-09-01', '2026-09-08', '2026-09-15'] }),
    bob: activity({ points: 40, totalUpdates: 4, days: ['2026-09-02', '2026-09-09'] }),
  };
  const db = memoryDb({ users, contributions });
  const first = await awardSeasonChampion(db, 'month', at);
  assert.equal(first.granted, true);
  assert.equal(first.key, '2026-09');
  const doc = db.store.get(CHAMPION_COLLECTION + '/month-2026-09');
  assert.equal(doc.uid, 'alice');
  assert.equal(doc.points, 30); // three September build days x 10
  assert.equal(doc.status, 'champion');
  assert.equal(doc.buildDays, 3);
  assert.doesNotMatch(JSON.stringify(doc), /PRIVATE|earnedCredits|updates/);
  const replay = await awardSeasonChampion(db, 'month', at);
  assert.equal(replay.skipped, true);
  const empty = memoryDb({ users: { alice: profile('Alice') }, contributions: { alice: activity({ points: 0, days: [], totalUpdates: 0 }) } });
  await awardSeasonChampion(empty, 'year', at);
  assert.equal(empty.store.get(CHAMPION_COLLECTION + '/year-2025').status, 'no-winner');
  assert.equal((await readSeasonChampions(empty, at)).year, null);
});

test('month and year titles are public and never overwrite an earlier season', async () => {
  const db = memoryDb({ users: { alice: profile('Alice') }, contributions: { alice: activity({ points: 90 }) } });
  await awardSeasonChampions(db, at);
  const champions = await readSeasonChampions(db, at);
  assert.equal(champions.month.name, 'Alice');
  assert.equal(champions.month.kind, 'month');
  assert.equal(champions.year, null);
  // A later run for the same month must not mint a second trophy.
  const before = JSON.stringify(db.store.get(CHAMPION_COLLECTION + '/month-2026-09'));
  await awardSeasonChampion(db, 'month', Date.parse('2026-10-30T12:00:00Z'));
  assert.equal(JSON.stringify(db.store.get(CHAMPION_COLLECTION + '/month-2026-09')), before);
});

test('the card ribbon prefers year over month over week and only for the actual winner', async () => {
  const week = awardWeek(at);
  const docs = {};
  docs['campaignRewards/' + week.weekKey] = { uid: 'alice', status: 'available' };
  docs['leagueChampions/month-2026-09'] = { uid: 'bob', status: 'champion', points: 90 };
  docs['leagueChampions/year-2025'] = { uid: 'carol', status: 'champion', points: 800 };
  const db = memoryDb({ docs });
  assert.deepEqual(await championFor(db, 'carol', at), { kind: 'year', start: Date.UTC(2025, 0, 1), end: Date.UTC(2026, 0, 1) });
  assert.equal((await championFor(db, 'bob', at)).kind, 'month');
  assert.deepEqual(await championFor(db, 'alice', at), { kind: 'week', start: week.start, end: week.end });
  assert.equal(await championFor(db, 'dave', at), null);
});

test('the momentum card writes real text, keeps the champion ribbon and stays a 1080 square PNG', () => {
  const user = { displayName: 'Tanaka Gaadzikwa', occupation: 'Founder' };
  const c = { days: ['2026-10-22', '2026-10-23', '2026-10-24'], points: 310, totalUpdates: 31, habit: { awards: [{ day: '2026-10-20' }] } };
  const svg = momentumCardSvg({ uid: 'ordinary', user, c, at, verified: true });
  for (const text of ['Tanaka Gaadzikwa', 'DAY STREAK', 'CONSECUTIVE', 'BUILD POINTS', '310', 'RECORDED DAYS', 'linkupbuild.com', 'LAST 12 WEEKS']) {
    assert.ok(svg.includes('>' + text) || svg.includes(text), text);
  }
  assert.match(svg, /<text[^>]*>3<\/text>/);
  assert.doesNotMatch(svg, /CHAMPION/);
  const champ = momentumCardSvg({ uid: 'ordinary', user, c, at, champion: { kind: 'month', start: Date.UTC(2026, 8, 1), end: Date.UTC(2026, 9, 1) } });
  assert.match(champ, /MONTH CHAMPION/);
  assert.match(champ, /SEP 2026/);
  const png = renderMomentumCard({ uid: 'ordinary', user, c, at });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1080);
});

test('the bundled font really paints glyphs (empty text was the original card bug)', () => {
  const frame = body => `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="110"><rect width="220" height="110" fill="white"/>${body}</svg>`;
  const blank = renderCardSvg(frame(''), 220);
  const words = renderCardSvg(frame('<text x="8" y="70" font-size="52" font-family="DejaVu Sans" font-weight="700" fill="black">LINKUP</text>'), 220);
  assert.ok(words.length > blank.length * 2 + 400, `text render is too small to contain glyphs (${words.length} vs ${blank.length})`);
});

test('the hourly cron imports every league job it calls', () => {
  const source = read('api/_builderRuntime.js');
  for (const name of ['awardWeeklyChampion', 'reconcileCampaignRewards', 'awardSeasonChampions']) {
    assert.match(source, new RegExp(`import\\s*\\{[^}]*${name}[^}]*\\}\\s*from`), name);
    assert.match(source, new RegExp(`await ${name}\\(`), name);
  }
  assert.match(read('api/_leagueSeo.js'), /championFor/);
});
