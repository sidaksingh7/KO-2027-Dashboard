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

// --- player-credited scoring events ---------------------------------------------

test('scoreEvent needs a player, adds points and records who scored', () => {
  const g = game({ status: 'live' });
  assert.match(S.scoreEvent(g, 1, 2, {}).error, /Pick the player/);
  const g2 = run(g, S.scoreEvent(g, 1, 3, { playerId: 'p24', at: 5 }));
  assert.equal(g2.score1, 3);
  assert.deepEqual(g2.events, [{ side: 1, pts: 3, kind: 'pts', playerId: 'p24', at: 5 }]);
  assert.match(S.scoreEvent(game(), 1, 2, { playerId: 'x' }).error, /Start the game/);
  assert.match(S.scoreEvent(g, 1, 4, { playerId: 'x' }).error, /1, 2 or 3/);
});

test('soccer goals and cards', () => {
  const g = game({ sport: 'soccer', status: 'live' });
  const g2 = run(g, S.scoreEvent(g, 2, 1, { playerId: 'p9' }));
  assert.equal(g2.score2, 1);
  assert.equal(g2.events[0].kind, 'goal');
  const g3 = run(g2, S.cardEvent(g2, 1, 'yellow', 'p4', 7));
  assert.equal(g3.score1, 0);
  assert.equal(g3.events[1].kind, 'yellow');
  assert.match(S.cardEvent(g2, 1, 'blue', 'p4').error, /yellow or red/);
  assert.match(S.cardEvent(game({ status: 'live' }), 1, 'red', 'p4').error, /for soccer/);
});

test('volleyball: kill/ace/block need a player, opponent error does not; set is recorded', () => {
  const g = vb({ currentSet: 2 });
  assert.match(S.scoreEvent(g, 1, 1, { kind: 'ace' }).error, /Pick the player/);
  const g2 = run(g, S.scoreEvent(g, 1, 1, { kind: 'opp-error' }));
  assert.equal(g2.events[0].playerId, null);
  assert.equal(g2.events[0].set, 2);
  const g3 = run(g2, S.scoreEvent(g2, 2, 1, { kind: 'block', playerId: 'v7' }));
  assert.equal(g3.score2, 1);
  assert.match(S.scoreEvent(g, 1, 1, { kind: 'spike', playerId: 'v7' }).error, /Unknown/);
});

test('undoLastScore removes that side\'s last point and its player credit', () => {
  let g = game({ status: 'live' });
  g = run(g, S.scoreEvent(g, 1, 2, { playerId: 'a' }));
  g = run(g, S.scoreEvent(g, 2, 3, { playerId: 'b' }));
  g = run(g, S.scoreEvent(g, 1, 3, { playerId: 'c' }));
  g = run(g, S.undoLastScore(g, 1));
  assert.equal(g.score1, 2);
  assert.deepEqual(g.events.map((e) => e.playerId), ['a', 'b']);
});

test('undoLastScore in volleyball only touches the current set', () => {
  const g = vb({ score1: 0, currentSet: 2, events: [{ side: 1, pts: 1, kind: 'ace', playerId: 'x', set: 1 }] });
  // nothing scored by side 1 in set 2 → set 1's ace is left alone, plain −1 refuses at 0
  assert.match(S.undoLastScore(g, 1).error, /already 0/);
});

test('undoLastScore falls back to −1 when the score was typed in', () => {
  const g = game({ status: 'live', score1: 5 });
  assert.deepEqual(S.undoLastScore(g, 1).patch, { score1: 4 });
});

test('removeEvent deletes one entry and its points', () => {
  let g = game({ sport: 'soccer', status: 'live' });
  g = run(g, S.scoreEvent(g, 1, 1, { playerId: 'a' }));
  g = run(g, S.cardEvent(g, 2, 'red', 'b'));
  g = run(g, S.removeEvent(g, 0));
  assert.equal(g.score1, 0);
  assert.deepEqual(g.events.map((e) => e.kind), ['red']);
  assert.match(S.removeEvent(g, 9).error, /no longer exists/);
});

test('events stored by Firebase as an object still work', () => {
  const g = game({ status: 'live', score1: 2, events: { 0: { side: 1, pts: 2, kind: 'pts', playerId: 'a' } } });
  const r = S.undoLastScore(g, 1).patch;
  assert.equal(r.score1, 0);
  assert.deepEqual(r.events, []);
});

console.log(`\n${passed} passed`);
