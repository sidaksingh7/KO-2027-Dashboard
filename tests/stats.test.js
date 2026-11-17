// Run with: node tests/stats.test.js
const assert = require('node:assert/strict');
const St = require('../src/shared/stats.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const side = (id, name) => ({ id, name, known: !!id });

// A small basketball division: A beats B, C beats A (final), B beats D (3rd place)
function bbView() {
  const teams = {
    a: { name: 'Alpha', roster: { '23-raj': { name: 'Raj', number: '23' }, '7-jas': { name: 'Jas', number: '7' } } },
    b: { name: 'Bravo', roster: { '5-sim': { name: 'Sim', number: '5' } } },
    c: { name: 'Charlie', roster: {} },
    d: { name: 'Delta', roster: {} }
  };
  const g = (id, round, t1, t2, s1, s2, events, extra) => Object.assign({
    id, round, sport: 'basketball', status: 'final', score1: s1, score2: s2, startsAt: 1,
    t1: side(t1), t2: side(t2), isBracket: round !== 'rr', events: events || [],
    result: { decided: true, winnerId: s1 > s2 ? t1 : t2, loserId: s1 > s2 ? t2 : t1 }
  }, extra);
  return {
    sport: 'basketball', teams, standings: [{ teamId: 'a' }, { teamId: 'b' }, { teamId: 'c' }, { teamId: 'd' }],
    games: [
      g('rr-1', 'rr', 'a', 'b', 5, 3, [
        { side: 1, pts: 3, kind: 'pts', playerId: '23-raj' },
        { side: 1, pts: 2, kind: 'pts', playerId: '7-jas' },
        { side: 2, pts: 2, kind: 'pts', playerId: '5-sim' },
        { side: 2, pts: 1, kind: 'pts', playerId: '5-sim' }
      ]),
      g('final-1', 'final', 'c', 'a', 10, 4, [
        { side: 2, pts: 2, kind: 'pts', playerId: '23-raj' },
        { side: 2, pts: 2, kind: 'pts', playerId: '23-raj' }
      ]),
      g('third-1', 'third', 'b', 'd', 8, 6),
      g('rr-9', 'rr', 'a', 'b', 0, 0, [], { status: 'scheduled' })
    ]
  };
}

console.log('stats.js');

test('teamStats: record, points, form and final placings', () => {
  const rows = St.teamStats(bbView());
  assert.deepEqual(rows.map((r) => [r.name, r.rank, r.place]),
    [['Charlie', 1, 1], ['Alpha', 2, 2], ['Bravo', 3, 3], ['Delta', 4, 4]]);
  const a = rows.find((r) => r.teamId === 'a');
  assert.deepEqual([a.gp, a.w, a.l, a.pf, a.pa, a.diff], [2, 1, 1, 9, 13, -4]);
  assert.equal(a.ppg, 4.5);
  assert.deepEqual(a.form, ['W', 'L']);
  assert.equal(a.reached, 'Final');
  assert.equal(a.bigWin, 2);
});

test('teamStats: scheduled games do not count', () => {
  const b = St.teamStats(bbView()).find((r) => r.teamId === 'b');
  assert.equal(b.gp, 2);
});

test('playerStats: basketball points, 1/2/3 split, per game, best game', () => {
  const rows = St.playerStats(bbView());
  const raj = rows.find((r) => r.name === 'Raj');
  assert.deepEqual([raj.pts, raj.fg3, raj.fg2, raj.ft, raj.gp, raj.high], [7, 1, 2, 0, 2, 4]);
  assert.equal(raj.ppg, 3.5);
  assert.equal(rows[0].name, 'Raj');
  assert.equal(raj.rank, 1);
  const sim = rows.find((r) => r.name === 'Sim');
  assert.deepEqual([sim.pts, sim.ft, sim.fg2], [3, 1, 1]);
});

test('playerStats: ties share a rank; players with no points still listed', () => {
  const v = bbView();
  v.games[1].events = []; // Raj now 3, Sim 3
  const rows = St.playerStats(v);
  const raj = rows.find((r) => r.name === 'Raj');
  const sim = rows.find((r) => r.name === 'Sim');
  assert.equal(raj.pts, 3);
  assert.equal(sim.rank, raj.rank); // both 3 pts in 2 games
  assert.ok(rows.some((r) => r.name === 'Jas'));
});

test('playerStats: soccer goals and cards, ranked by goals', () => {
  const view = {
    sport: 'soccer',
    teams: { a: { name: 'A', roster: { p1: { name: 'One', number: '9' }, p2: { name: 'Two', number: '4' } } }, b: { name: 'B', roster: {} } },
    games: [{
      sport: 'soccer', status: 'final', t1: side('a'), t2: side('b'), score1: 2, score2: 0,
      events: [
        { side: 1, pts: 1, kind: 'goal', playerId: 'p2' },
        { side: 1, pts: 1, kind: 'goal', playerId: 'p2' },
        { side: 1, pts: 0, kind: 'yellow', playerId: 'p1' }
      ]
    }]
  };
  const rows = St.playerStats(view);
  assert.equal(rows[0].name, 'Two');
  assert.equal(rows[0].goals, 2);
  assert.equal(rows[1].yellow, 1);
});

test('playerStats + teamStats: volleyball kills/aces/blocks; opponent errors credit nobody; points from sets', () => {
  const view = {
    sport: 'volleyball',
    teams: { a: { name: 'A', roster: { v: { name: 'Vic', number: '1' } } }, b: { name: 'B', roster: {} } },
    games: [{
      sport: 'volleyball', status: 'final', t1: side('a'), t2: side('b'), score1: 15, score2: 9,
      setsWon1: 2, setsWon2: 0, sets: [{ s1: 25, s2: 20, done: true }, { s1: 25, s2: 18, done: true }],
      result: { decided: true, winnerId: 'a', loserId: 'b' },
      events: [
        { side: 1, pts: 1, kind: 'kill', playerId: 'v', set: 1 },
        { side: 1, pts: 1, kind: 'ace', playerId: 'v', set: 1 },
        { side: 1, pts: 1, kind: 'opp-error', playerId: null, set: 2 }
      ]
    }]
  };
  const vic = St.playerStats(view)[0];
  assert.deepEqual([vic.pts, vic.kill, vic.ace, vic.block], [2, 1, 1, 0]);
  const a = St.teamStats(view).find((r) => r.teamId === 'a');
  assert.deepEqual([a.pf, a.pa, a.setsW, a.setsL], [50, 38, 2, 0]);
});

test('boxScore: per-player lines for each side, no-player points counted', () => {
  const v = bbView();
  const box = St.boxScore(v.games[0], v);
  assert.deepEqual(box.side1.map((p) => [p.name, p.pts]), [['Raj', 3], ['Jas', 2]]);
  assert.deepEqual(box.side2.map((p) => [p.name, p.pts]), [['Sim', 3]]);
  const vbGame = { t1: side('a'), t2: side('b'), events: [{ side: 2, pts: 1, kind: 'opp-error', playerId: null }] };
  assert.deepEqual(St.boxScore(vbGame, v).noPlayer, [0, 1]);
});

test('parseRoster reads "24 Sandhu", "#7 Name", names without numbers; flags duplicates', () => {
  const r = St.parseRoster('24 Sandhu\n#7 Gurpreet Singh\n\nHarjot Kaur\n24 Sandhu', slug);
  assert.deepEqual(Object.values(r.roster), [
    { name: 'Sandhu', number: '24' }, { name: 'Gurpreet Singh', number: '7' }, { name: 'Harjot Kaur', number: '' }
  ]);
  assert.deepEqual(r.errors, ['Sandhu is listed twice']);
  assert.ok(r.roster['24-sandhu']);
});

test('rosterText round-trips, sorted by number', () => {
  const r = St.parseRoster('24 Sandhu\n7 Gill\nHarjot Kaur', slug).roster;
  assert.equal(St.rosterText(r), 'Harjot Kaur\n7 Gill\n24 Sandhu');
});

console.log(`\n${passed} passed`);
