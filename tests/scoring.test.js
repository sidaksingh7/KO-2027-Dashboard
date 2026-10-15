// Run with: node tests/scoring.test.js
const assert = require('node:assert/strict');
const S = require('../src/admin/scoring.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

const game = (extra = {}) => Object.assign(
  { sport: 'basketball', status: 'scheduled', score1: 0, score2: 0, team1Id: 'a', team2Id: 'b' }, extra);
const run = (g, res) => S.applyPatch(g, res.patch, 1000);

console.log('admin/scoring.js');

test('must start the game before scoring', () => {
  assert.match(S.addPoints(game(), 1, 2).error, /Start the game/);
  const g = run(game(), S.startGame(game()));
  assert.equal(g.status, 'live');
  assert.equal(g.updatedAt.status, 1000);
});

test('addPoints adds and undoes, never below 0', () => {
  let g = game({ status: 'live' });
  g = run(g, S.addPoints(g, 1, 3));
  g = run(g, S.addPoints(g, 2, 2));
  assert.deepEqual([g.score1, g.score2], [3, 2]);
  g = run(g, S.addPoints(g, 1, -1));
  assert.equal(g.score1, 2);
  g = run(g, S.addPoints(g, 2, -5));
  assert.equal(g.score2, 0);
  assert.match(S.addPoints(g, 2, -1).error, /already 0/);
});

test('applyPatch stamps only changed fields and keeps old stamps', () => {
  const g = S.applyPatch({ score1: 1, updatedAt: { score1: 5, status: 7 } }, { score1: 2 }, 9);
  assert.deepEqual(g.updatedAt, { score1: 9, status: 7 });
});

test('applyPatch with null removes a field', () => {
  const g = S.applyPatch({ forfeitBy: 2 }, { forfeitBy: null }, 9);
  assert.equal('forfeitBy' in g, false);
});

test('setScore validates input', () => {
  assert.deepEqual(S.setScore(game(), 4, 2).patch, { score1: 4, score2: 2 });
  assert.match(S.setScore(game(), -1, 2).error, /whole numbers/);
  assert.match(S.setScore(game(), 1.5, 2).error, /whole numbers/);
});

test('finalize: needs live; playoff tie needs a winner pick', () => {
  assert.match(S.finalize(game(), false).error, /Start the game/);
  const tied = game({ status: 'live', sport: 'soccer', score1: 1, score2: 1 });
  assert.ok(S.finalize(tied, false).patch); // round robin draw is fine
  assert.match(S.finalize(tied, true).error, /pick the winner/);
  const picked = run(tied, S.setWinner(tied, 'b', 'a', 'b'));
  assert.deepEqual(S.finalize(picked, true).patch, { status: 'final' });
});

test('setWinner only accepts a team in the game', () => {
  assert.match(S.setWinner(game(), 'zz', 'a', 'b').error, /isn’t in this game/);
  assert.deepEqual(S.setWinner(game(), null, 'a', 'b').patch, { winnerId: null });
});

test('forfeit: other team wins, scores cleared; volleyball 2–0', () => {
  const g = run(game({ status: 'live', score1: 10 }), S.forfeit(game({ status: 'live', score1: 10 }), 1));
  assert.equal(g.forfeitBy, 1);
  assert.equal(g.status, 'final');
  assert.equal(g.score1, 0);
  const v = S.forfeit(game({ sport: 'volleyball' }), 2).patch;
  assert.equal(v.setsWon1, 2);
  assert.equal(v.setsWon2, 0);
});

test('clearForfeit and reopen put the game back to live', () => {
  const f = run(game(), S.forfeit(game(), 1));
  assert.equal(run(f, S.clearForfeit(f)).status, 'live');
  assert.equal(S.reopen(f).patch.status, 'live');
  assert.match(S.reopen(game()).error, /isn’t final/);
});

// --- volleyball sets ---------------------------------------------------------

const vb = (extra = {}) => game(Object.assign({ sport: 'volleyball', status: 'live', sets: [], setsWon1: 0, setsWon2: 0, currentSet: 1 }, extra));

test('endSet records the set, resets the current score, moves to next set', () => {
  let g = vb({ score1: 25, score2: 20 });
  g = run(g, S.endSet(g));
  assert.deepEqual(g.sets, [{ s1: 25, s2: 20, done: true }]);
  assert.deepEqual([g.setsWon1, g.setsWon2, g.currentSet, g.score1, g.score2], [1, 0, 2, 0, 0]);
  assert.equal(g.status, 'live');
});

test('endSet refuses a tied set and non-volleyball games', () => {
  assert.match(S.endSet(vb({ score1: 10, score2: 10 })).error, /tied/);
  assert.match(S.endSet(game({ status: 'live' })).error, /Only volleyball/);
});

test('match finishes automatically at 2 sets won, last set score stays on the card', () => {
  let g = vb({ score1: 25, score2: 20 });
  g = run(g, S.endSet(g));
  g = Object.assign(g, { score1: 18, score2: 25 });
  g = run(g, S.endSet(g));
  assert.equal(g.status, 'live'); // 1–1
  g = Object.assign(g, { score1: 15, score2: 9 });
  g = run(g, S.endSet(g));
  assert.equal(g.status, 'final');
  assert.deepEqual([g.setsWon1, g.setsWon2], [2, 1]);
  assert.deepEqual([g.score1, g.score2], [15, 9]);
});

test('undoSet puts the last set back', () => {
  let g = vb({ score1: 25, score2: 20 });
  g = run(g, S.endSet(g));
  g = run(g, S.undoSet(g));
  assert.deepEqual([g.score1, g.score2, g.setsWon1, g.currentSet], [25, 20, 0, 1]);
  assert.deepEqual(g.sets, []);
});

test('sets stored by Firebase as an object still work', () => {
  const g = vb({ sets: { 0: { s1: 25, s2: 10, done: true } }, setsWon1: 1, score1: 25, score2: 23, currentSet: 2 });
  const p = S.endSet(g).patch;
  assert.equal(p.status, 'final');
  assert.equal(p.sets.length, 2);
});

test('volleyball finalize needs a set lead', () => {
  assert.match(S.finalize(vb({ setsWon1: 1, setsWon2: 1 })).error, /deciding set/);
  assert.ok(S.finalize(vb({ setsWon1: 1, setsWon2: 0 })).patch);
});

console.log(`\n${passed} passed`);
