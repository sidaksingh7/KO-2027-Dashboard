// Run with: node tests/public-helpers.test.js
const assert = require('node:assert/strict');
const H = require('../src/public/helpers.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

const TZ = 'America/Toronto';
// 2027-06-02 14:30 in Toronto (EDT, UTC−4)
const AT = (d, h, m = 0) => Date.UTC(2027, 5, d, h + 4, m);

console.log('public/helpers.js');

test('slugify and teamId follow the {team-name}-{sport}-{division} pattern', () => {
  assert.equal(H.slugify('Babbar Khalsa Ballers!'), 'babbar-khalsa-ballers');
  assert.equal(H.slugify('  Sher-e-Punjab  FC '), 'sher-e-punjab-fc');
  assert.equal(H.teamId('Babbar Khalsa Ballers', 'soccer', 'd1'), 'babbar-khalsa-ballers-soccer-d1');
});

test('escapeHtml blocks HTML in team names', () => {
  assert.equal(H.escapeHtml('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
  assert.equal(H.escapeHtml(null), '');
});

test('times are shown in Toronto time', () => {
  assert.equal(H.formatTime(AT(2, 14, 30), TZ), '2:30 PM');
  assert.equal(H.formatDate(AT(2, 14), TZ), 'Wednesday, June 2');
  assert.equal(H.dayKey(AT(2, 23, 30), TZ), '2027-06-02'); // 11:30 PM still June 2 locally
});

const DAYS = [
  { sport: 'soccer', date: '2027-06-01' },
  { sport: 'basketball', date: '2027-06-02' },
  { sport: 'volleyball', date: '2027-06-03' }
];

test('eventPhase: before, during each day, after', () => {
  const before = H.eventPhase(AT(-9, 12), DAYS, TZ); // May 22
  assert.equal(before.phase, 'before');
  assert.equal(before.daysUntil, 10);
  assert.equal(H.eventPhase(AT(2, 12), DAYS, TZ).day.sport, 'basketball');
  assert.equal(H.eventPhase(AT(5, 12), DAYS, TZ).phase, 'after');
});

// --- divisionView -----------------------------------------------------------

function sampleDivision() {
  return {
    teams: { a: { name: 'Alpha' }, b: { name: 'Bravo' }, c: { name: 'Charlie' }, d: { name: 'Delta' } },
    games: {
      'basketball-d1-rr-1': { team1Id: 'a', team2Id: 'b', status: 'final', score1: 50, score2: 40, startsAt: 3 },
      'basketball-d1-rr-2': { team1Id: 'c', team2Id: 'd', status: 'final', score1: 50, score2: 40, startsAt: 3 },
      'basketball-d1-rr-3': { team1Id: 'a', team2Id: 'c', status: 'live', score1: 10, score2: 12, startsAt: 5 },
      'basketball-d1-rr-4': { team1Id: 'b', team2Id: 'd', status: 'scheduled', score1: 0, score2: 0, startsAt: 7 },
      'basketball-d1-sf-1': { source1: { seed: '1' }, source2: { seed: '4' }, status: 'scheduled', startsAt: 9 },
      'basketball-d1-sf-2': { source1: { seed: '2' }, source2: { seed: '3' }, status: 'scheduled', startsAt: 9 },
      'basketball-d1-final-1': { source1: { winnerOf: 'basketball-d1-sf-1' }, source2: { winnerOf: 'basketball-d1-sf-2' }, status: 'scheduled', startsAt: 11 }
    }
  };
}

test('divisionView: standings use team names, bracket slots resolve to names', () => {
  const v = H.divisionView('basketball', 'd1', sampleDivision());
  assert.deepEqual(v.standings.map((r) => r.name).slice(0, 2), ['Alpha', 'Charlie']);
  const sf1 = v.games.find((g) => g.id === 'basketball-d1-sf-1');
  assert.equal(sf1.t1.name, 'Alpha');
  assert.equal(sf1.t1.known, true);
  const fin = v.games.find((g) => g.id === 'basketball-d1-final-1');
  assert.equal(fin.t1.name, 'Winner of SF1');
  assert.equal(fin.t1.known, false);
  assert.equal(fin.isBracket, true);
});

test('divisionView: games are sorted by start time', () => {
  const v = H.divisionView('basketball', 'd1', sampleDivision());
  const times = v.games.map((g) => g.startsAt);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('divisionView: empty division is fine', () => {
  const v = H.divisionView('soccer', 'd2', undefined);
  assert.deepEqual(v.games, []);
  assert.deepEqual(v.standings, []);
});

test('teamGames gives each game from the team\'s side with W/L', () => {
  const v = H.divisionView('basketball', 'd1', sampleDivision());
  const list = H.teamGames(v, 'b');
  assert.equal(list[0].opponent.name, 'Alpha');
  assert.equal(list[0].outcome, 'L');
  assert.equal(list[1].outcome, null); // not played yet
});

test('teamGames marks a soccer draw', () => {
  const v = H.divisionView('soccer', 'd1', {
    teams: { a: { name: 'A' }, b: { name: 'B' } },
    games: { 'soccer-d1-rr-1': { team1Id: 'a', team2Id: 'b', status: 'final', score1: 1, score2: 1 } }
  });
  assert.equal(H.teamGames(v, 'a')[0].outcome, 'D');
});

// --- search, grouping, live --------------------------------------------------

const TEAMS = [
  { id: '1', name: 'Singh Strikers', sport: 'soccer', division: 'd1' },
  { id: '2', name: 'Khalsa Warriors', sport: 'basketball', division: 'd2' },
  { id: '3', name: 'Warriors of Fateh', sport: 'soccer', division: 'd3' },
  { id: '4', name: 'Khalsa Warriors', sport: 'soccer', division: 'd2' }
];

test('searchTeams: starts-with beats word match beats contains; case-insensitive', () => {
  assert.deepEqual(H.searchTeams(TEAMS, 'warr').map((t) => t.id), ['3', '4', '2']);
  assert.deepEqual(H.searchTeams(TEAMS, 'KHALSA').map((t) => t.id), ['4', '2']);
  assert.deepEqual(H.searchTeams(TEAMS, 'ikers').map((t) => t.id), ['1']);
  assert.deepEqual(H.searchTeams(TEAMS, '   '), []);
});

test('groupBySlot groups games that start together', () => {
  const g = H.groupBySlot([{ startsAt: 1 }, { startsAt: 1 }, { startsAt: 2 }]);
  assert.equal(g.length, 2);
  assert.equal(g[0].games.length, 2);
});

test('liveAndNext: live games plus the next start time', () => {
  const games = [
    { status: 'final', startsAt: 0 },
    { status: 'live', startsAt: 100 },
    { status: 'scheduled', startsAt: 200 },
    { status: 'scheduled', startsAt: 200 },
    { status: 'scheduled', startsAt: 300 }
  ];
  const r = H.liveAndNext(games, 150);
  assert.equal(r.live.length, 1);
  assert.equal(r.next.length, 2);
});

test('scoreText: volleyball shows sets, others the score, scheduled shows nothing', () => {
  assert.deepEqual(H.scoreText({ sport: 'volleyball', status: 'live', setsWon1: 1, setsWon2: 0 }), [1, 0]);
  assert.deepEqual(H.scoreText({ sport: 'soccer', status: 'final', score1: 2, score2: 3 }), [2, 3]);
  assert.equal(H.scoreText({ sport: 'soccer', status: 'scheduled' }), null);
});

// --- routing -----------------------------------------------------------------

test('parseHash reads page and params', () => {
  assert.deepEqual(H.parseHash(''), { page: 'home', params: {} });
  assert.deepEqual(H.parseHash('#schedule&sport=soccer&division=d1'),
    { page: 'schedule', params: { sport: 'soccer', division: 'd1' } });
  assert.deepEqual(H.parseHash('#team=babbar-khalsa-ballers-soccer-d1'),
    { page: 'team', params: { team: 'babbar-khalsa-ballers-soccer-d1' } });
});

test('buildHash round-trips with parseHash', () => {
  const h = H.buildHash('playoffs', { sport: 'volleyball', division: 'd2' });
  assert.equal(h, '#playoffs&sport=volleyball&division=d2');
  assert.deepEqual(H.parseHash(h).params, { sport: 'volleyball', division: 'd2' });
  assert.equal(H.buildHash('team', { team: 'x-soccer-d1' }), '#team=x-soccer-d1');
  assert.equal(H.buildHash('home', {}), '#');
});

console.log(`\n${passed} passed`);
