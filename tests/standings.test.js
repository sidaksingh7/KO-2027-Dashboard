// Run with: node tests/standings.test.js
const assert = require('node:assert/strict');
const { computeStandings } = require('../src/shared/standings.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

// Builds a games map from short rows: ['a', 'b', 2, 1] = a beat b 2–1.
let n = 0;
function games(list) {
  const out = {};
  list.forEach(([t1, t2, s1, s2, extra]) => {
    out['g' + (++n)] = Object.assign({ team1Id: t1, team2Id: t2, score1: s1, score2: s2, status: 'final' }, extra);
  });
  return out;
}
// Volleyball match from set scores: vb('a', 'b', [[25, 20], [25, 18]])
function vb(t1, t2, sets) {
  let w1 = 0, w2 = 0;
  sets.forEach(([a, b]) => (a > b ? w1++ : w2++));
  return [t1, t2, 0, 0, { setsWon1: w1, setsWon2: w2, sets: sets.map(([s1, s2]) => ({ s1, s2, done: true })) }];
}

const order = (res) => res.rows.map((r) => r.teamId);
const row = (res, id) => res.rows.find((r) => r.teamId === id);

console.log('standings.js');

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

test('unknown sport throws', () => {
  assert.throws(() => computeStandings({}, ['a'], { sport: 'hockey' }), /Unknown sport/);
});

test('teams with no games still appear with zeros', () => {
  const res = computeStandings({}, ['a', 'b'], { sport: 'basketball' });
  assert.deepEqual(order(res), ['a', 'b']);
  assert.equal(row(res, 'a').played, 0);
});

test('only final round-robin games count (live and bracket games ignored)', () => {
  const g = games([
    ['a', 'b', 50, 40],
    ['b', 'a', 60, 10, { status: 'live' }],
    ['b', 'a', 60, 10, { source1: { seed: '1' } }]
  ]);
  const res = computeStandings(g, ['a', 'b'], { sport: 'basketball' });
  assert.equal(row(res, 'a').played, 1);
  assert.equal(row(res, 'a').wins, 1);
});

// ---------------------------------------------------------------------------
// Basketball: wins → H2H → diff → scored
// ---------------------------------------------------------------------------

test('basketball ranks by wins', () => {
  const g = games([['a', 'b', 50, 40], ['a', 'c', 50, 40], ['c', 'b', 50, 40]]);
  const res = computeStandings(g, ['a', 'b', 'c'], { sport: 'basketball' });
  assert.deepEqual(order(res), ['a', 'c', 'b']);
  assert.deepEqual(res.seeds, { 1: 'a', 2: 'c', 3: 'b' });
});

test('2-way tie on wins: head-to-head beats a better point difference', () => {
  const g = games([
    ['a', 'b', 41, 40],   // a beats b by 1
    ['b', 'c', 90, 40],   // b big win (capped +20)
    ['c', 'a', 50, 40],
    ['top', 'a', 50, 40], ['top', 'b', 50, 40], ['top', 'c', 50, 40],
    ['c', 'low', 50, 40]
  ]);
  // top 3–0, c 2–2, a 1–2, b 1–2 (only a and b tied), low 0–1
  const res = computeStandings(g, ['a', 'b', 'c', 'top', 'low'], { sport: 'basketball' });
  assert.ok(row(res, 'b').diff > row(res, 'a').diff);
  assert.deepEqual(order(res), ['top', 'c', 'a', 'b', 'low']);
});

test('3-way tie skips head-to-head and uses point difference', () => {
  // Circle: a beats b, b beats c, c beats a — all 1–1
  const g = games([['a', 'b', 41, 40], ['b', 'c', 55, 40], ['c', 'a', 47, 40]]);
  const res = computeStandings(g, ['a', 'b', 'c'], { sport: 'basketball' });
  // diffs: a +1−7 = −6, b −1+15 = +14, c −15+7 = −8
  assert.deepEqual(order(res), ['b', 'a', 'c']);
});

test('one game adds at most ±20 to basketball difference', () => {
  const g = games([['a', 'b', 90, 30]]);
  const res = computeStandings(g, ['a', 'b'], { sport: 'basketball' });
  assert.equal(row(res, 'a').diff, 20);
  assert.equal(row(res, 'b').diff, -20);
  assert.equal(row(res, 'a').scored, 90); // points scored is not capped
});

test('points scored breaks a tie on wins and difference', () => {
  const g = games([['a', 'x', 60, 50], ['b', 'y', 30, 20]]);
  const res = computeStandings(g, ['a', 'b', 'x', 'y'], { sport: 'basketball' });
  assert.deepEqual(order(res).slice(0, 2), ['a', 'b']);
});

test('basketball forfeit: winner +10, no-show −10, scores ignored', () => {
  const g = games([['a', 'b', 99, 0, { forfeitBy: 2 }]]);
  const res = computeStandings(g, ['a', 'b'], { sport: 'basketball' });
  assert.equal(row(res, 'a').wins, 1);
  assert.equal(row(res, 'a').diff, 10);
  assert.equal(row(res, 'b').losses, 1);
  assert.equal(row(res, 'b').diff, -10);
});

// ---------------------------------------------------------------------------
// Soccer: points (3/1/0) → H2H → GD → GF, with groups
// ---------------------------------------------------------------------------

test('soccer awards 3 for a win and 1 for a draw', () => {
  const g = games([['a', 'b', 2, 0], ['a', 'c', 1, 1], ['b', 'c', 0, 0]]);
  const res = computeStandings(g, ['a', 'b', 'c'], { sport: 'soccer' });
  assert.equal(row(res, 'a').points, 4);
  assert.equal(row(res, 'b').points, 1);
  assert.equal(row(res, 'c').points, 2);
  assert.deepEqual(order(res), ['a', 'c', 'b']);
});

test('soccer goal difference is capped at ±5 per game', () => {
  const g = games([['a', 'b', 9, 0]]);
  const res = computeStandings(g, ['a', 'b'], { sport: 'soccer' });
  assert.equal(row(res, 'a').diff, 5);
});

test('soccer forfeit: winner +3 pts, no-show −3 pts', () => {
  const g = games([['a', 'b', 0, 0, { forfeitBy: 1 }]]);
  const res = computeStandings(g, ['a', 'b'], { sport: 'soccer' });
  assert.equal(row(res, 'b').points, 3);
  assert.equal(row(res, 'b').wins, 1);
  assert.equal(row(res, 'a').points, -3);
  assert.equal(row(res, 'a').losses, 1);
});

test('soccer groups: ranked separately and seeded A1, A2, B1, B2', () => {
  const g = games([
    ['a1', 'a2', 2, 0], ['b2', 'b1', 0, 3],
    ['a1', 'b1', 0, 5] // cross-group game is ignored
  ]);
  const res = computeStandings(g, null, { sport: 'soccer', groups: { A: ['a1', 'a2'], B: ['b1', 'b2'] } });
  assert.deepEqual(res.seeds, { A1: 'a1', A2: 'a2', B1: 'b1', B2: 'b2' });
  assert.equal(row(res, 'a1').played, 1);
  assert.equal(row(res, 'a1').rank, 1);
  assert.equal(row(res, 'b1').rank, 1);
});

// ---------------------------------------------------------------------------
// Volleyball: wins → H2H → set diff → point diff
// ---------------------------------------------------------------------------

test('volleyball wins come from sets, point diff from all set scores', () => {
  const g = games([vb('a', 'b', [[25, 20], [20, 25], [15, 10]])]);
  const res = computeStandings(g, ['a', 'b'], { sport: 'volleyball' });
  const a = row(res, 'a');
  assert.equal(a.wins, 1);
  assert.equal(a.setsWon, 2);
  assert.equal(a.setsLost, 1);
  assert.equal(a.setDiff, 1);
  assert.equal(a.diff, 5 - 5 + 5); // 25–20, 20–25, 15–10
});

test('volleyball: set difference ranks before point difference', () => {
  // a and b each 1–1 vs others; a wins 2–0 sets, b wins 2–1 but by more points
  const g = games([
    vb('a', 'x', [[25, 23], [25, 23]]), vb('y', 'a', [[25, 0], [25, 0]]),
    vb('b', 'y', [[25, 10], [10, 25], [15, 1]]), vb('x', 'b', [[25, 23], [25, 23]])
  ]);
  const res = computeStandings(g, ['a', 'b', 'x', 'y'], { sport: 'volleyball' });
  // everyone 1–1 (4-way tie, no H2H). Set diffs: a 0, b −1, x 0, y +1
  assert.equal(order(res)[0], 'y');
  assert.ok(order(res).indexOf('a') < order(res).indexOf('b'));
});

test('volleyball forfeit counts as 2–0 in sets and +10', () => {
  const g = games([['a', 'b', 0, 0, { forfeitBy: 2 }]]);
  const res = computeStandings(g, ['a', 'b'], { sport: 'volleyball' });
  assert.equal(row(res, 'a').setsWon, 2);
  assert.equal(row(res, 'a').diff, 10);
  assert.equal(row(res, 'b').setDiff, -2);
});

// ---------------------------------------------------------------------------
// DQ, manual order, unresolved ties
// ---------------------------------------------------------------------------

test('DQ\'d team goes last, gets no seed, its games still count for opponents', () => {
  const g = games([['a', 'b', 50, 40], ['a', 'c', 50, 40], ['b', 'c', 50, 40]]);
  const res = computeStandings(g, ['a', 'b', 'c'], { sport: 'basketball', dqTeamIds: ['a'] });
  assert.deepEqual(order(res), ['b', 'c', 'a']);
  assert.equal(row(res, 'a').dq, true);
  assert.deepEqual(res.seeds, { 1: 'b', 2: 'c' });
  assert.equal(row(res, 'b').losses, 1); // the loss to a still counts
});

test('DQ list can be a Firebase-style map', () => {
  const res = computeStandings({}, ['a', 'b'], { sport: 'basketball', dqTeamIds: { a: true, b: false } });
  assert.deepEqual(res.seeds, { 1: 'b' });
});

test('a tie nothing can break is flagged needsTiebreak', () => {
  const res = computeStandings({}, ['b', 'a', 'c'], { sport: 'basketball' });
  assert.deepEqual(order(res), ['a', 'b', 'c']); // alphabetical fallback
  assert.ok(res.rows.every((r) => r.needsTiebreak));
});

test('manualOrder (coin flip) settles an unbreakable tie', () => {
  const res = computeStandings({}, ['a', 'b'], { sport: 'basketball', manualOrder: ['b', 'a'] });
  assert.deepEqual(order(res), ['b', 'a']);
  assert.equal(row(res, 'a').needsTiebreak, false);
  assert.deepEqual(res.seeds, { 1: 'b', 2: 'a' });
});

test('does not change the games passed in', () => {
  const g = games([['a', 'b', 50, 40]]);
  const before = JSON.stringify(g);
  computeStandings(g, ['a', 'b'], { sport: 'basketball' });
  assert.equal(JSON.stringify(g), before);
});

console.log(`\n${passed} passed`);
