// Run with: node tests/cascade.test.js
const assert = require('node:assert/strict');
const { resolveBracket, gameName } = require('../src/shared/cascade.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

// ---------------------------------------------------------------------------
// Bracket fixtures (same shapes schedule-gen.js will produce)
// ---------------------------------------------------------------------------

const seed = (s) => ({ seed: s });
const W = (id) => ({ winnerOf: id });
const L = (id) => ({ loserOf: id });

// Basketball-style: top 8 → QF → SF → Final + 3rd
function top8(p = 'basketball-d1') {
  return {
    [`${p}-qf-1`]: { source1: seed('1'), source2: seed('8'), status: 'scheduled' },
    [`${p}-qf-2`]: { source1: seed('4'), source2: seed('5'), status: 'scheduled' },
    [`${p}-qf-3`]: { source1: seed('2'), source2: seed('7'), status: 'scheduled' },
    [`${p}-qf-4`]: { source1: seed('3'), source2: seed('6'), status: 'scheduled' },
    [`${p}-sf-1`]: { source1: W(`${p}-qf-1`), source2: W(`${p}-qf-2`), status: 'scheduled' },
    [`${p}-sf-2`]: { source1: W(`${p}-qf-3`), source2: W(`${p}-qf-4`), status: 'scheduled' },
    [`${p}-final-1`]: { source1: W(`${p}-sf-1`), source2: W(`${p}-sf-2`), status: 'scheduled' },
    [`${p}-third-1`]: { source1: L(`${p}-sf-1`), source2: L(`${p}-sf-2`), status: 'scheduled' }
  };
}
const seeds8 = { 1: 't1', 2: 't2', 3: 't3', 4: 't4', 5: 't5', 6: 't6', 7: 't7', 8: 't8' };

// Volleyball-style: top 4 → SF → Final + 3rd
function top4(p = 'volleyball-d1') {
  return {
    [`${p}-sf-1`]: { source1: seed('1'), source2: seed('4'), status: 'scheduled' },
    [`${p}-sf-2`]: { source1: seed('2'), source2: seed('3'), status: 'scheduled' },
    [`${p}-final-1`]: { source1: W(`${p}-sf-1`), source2: W(`${p}-sf-2`), status: 'scheduled' },
    [`${p}-third-1`]: { source1: L(`${p}-sf-1`), source2: L(`${p}-sf-2`), status: 'scheduled' }
  };
}

// Soccer-style: 2 groups → cross SFs (A1 v B2, B1 v A2) → Final + 3rd
function groups(p = 'soccer-d1') {
  return {
    [`${p}-sf-1`]: { source1: seed('A1'), source2: seed('B2'), status: 'scheduled' },
    [`${p}-sf-2`]: { source1: seed('B1'), source2: seed('A2'), status: 'scheduled' },
    [`${p}-final-1`]: { source1: W(`${p}-sf-1`), source2: W(`${p}-sf-2`), status: 'scheduled' },
    [`${p}-third-1`]: { source1: L(`${p}-sf-1`), source2: L(`${p}-sf-2`), status: 'scheduled' }
  };
}

function finish(game, score1, score2, extra = {}) {
  Object.assign(game, { status: 'final', score1, score2 }, extra);
}

const teams = (g) => [g.slot1.teamId, g.slot2.teamId];

console.log('cascade.js');

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test('gameName builds short names from ids', () => {
  assert.equal(gameName('basketball-d1-qf-3'), 'QF3');
  assert.equal(gameName('basketball-d1-sf-1'), 'SF1');
  assert.equal(gameName('basketball-d1-final-1'), 'Final');
  assert.equal(gameName('basketball-d1-third-1'), '3rd Place');
  assert.equal(gameName('x', { name: 'Custom' }), 'Custom');
});

// ---------------------------------------------------------------------------
// Basketball-style (top 8) — includes the 2026 bug
// ---------------------------------------------------------------------------

test('top 8: before any games, later rounds show placeholder labels', () => {
  const r = resolveBracket(top8(), seeds8);
  assert.deepEqual(teams(r['basketball-d1-qf-1']), ['t1', 't8']);
  const sf1 = r['basketball-d1-sf-1'];
  assert.deepEqual(teams(sf1), [null, null]);
  assert.equal(sf1.slot1.label, 'Winner of QF1');
  assert.equal(sf1.slot2.label, 'Winner of QF2');
  assert.equal(r['basketball-d1-final-1'].slot1.label, 'Winner of SF1');
  assert.equal(r['basketball-d1-third-1'].slot2.label, 'Loser of SF2');
});

test('2026 BUG: QF winners appear on SF cards, SF winners appear on Final card', () => {
  const g = top8();
  finish(g['basketball-d1-qf-1'], 50, 40); // t1
  finish(g['basketball-d1-qf-2'], 30, 45); // t5
  finish(g['basketball-d1-qf-3'], 60, 20); // t2
  finish(g['basketball-d1-qf-4'], 41, 42); // t6
  let r = resolveBracket(g, seeds8);
  assert.deepEqual(teams(r['basketball-d1-sf-1']), ['t1', 't5']);
  assert.deepEqual(teams(r['basketball-d1-sf-2']), ['t2', 't6']);

  finish(g['basketball-d1-sf-1'], 33, 35); // t5 wins, t1 loses
  finish(g['basketball-d1-sf-2'], 70, 52); // t2 wins, t6 loses
  r = resolveBracket(g, seeds8);
  assert.deepEqual(teams(r['basketball-d1-final-1']), ['t5', 't2']);
  assert.deepEqual(teams(r['basketball-d1-third-1']), ['t1', 't6']);

  finish(g['basketball-d1-final-1'], 48, 47);
  r = resolveBracket(g, seeds8);
  assert.equal(r['basketball-d1-final-1'].result.winnerId, 't5');
  assert.equal(r['basketball-d1-final-1'].result.loserId, 't2');
});

test('one QF done: its SF slot fills, the other stays a placeholder', () => {
  const g = top8();
  finish(g['basketball-d1-qf-2'], 10, 20); // t5
  const sf1 = resolveBracket(g, seeds8)['basketball-d1-sf-1'];
  assert.equal(sf1.slot1.teamId, null);
  assert.equal(sf1.slot1.label, 'Winner of QF1');
  assert.equal(sf1.slot2.teamId, 't5');
});

test('a live (not final) game does not advance anyone', () => {
  const g = top8();
  Object.assign(g['basketball-d1-qf-1'], { status: 'live', score1: 30, score2: 2 });
  const r = resolveBracket(g, seeds8);
  assert.equal(r['basketball-d1-qf-1'].result.decided, false);
  assert.equal(r['basketball-d1-sf-1'].slot1.teamId, null);
});

test('correcting a QF score after it flowed forward updates the SF and Final', () => {
  const g = top8();
  finish(g['basketball-d1-qf-1'], 50, 40); // t1
  finish(g['basketball-d1-qf-2'], 50, 40); // t4
  finish(g['basketball-d1-qf-3'], 50, 40); // t2
  finish(g['basketball-d1-qf-4'], 50, 40); // t3
  finish(g['basketball-d1-sf-1'], 50, 40); // slot1 wins
  let r = resolveBracket(g, seeds8);
  assert.equal(r['basketball-d1-final-1'].slot1.teamId, 't1');

  finish(g['basketball-d1-qf-1'], 40, 50); // typo fixed: t8 actually won
  r = resolveBracket(g, seeds8);
  assert.equal(r['basketball-d1-sf-1'].slot1.teamId, 't8');
  assert.equal(r['basketball-d1-final-1'].slot1.teamId, 't8');
});

test('missing seeds show "Seed N" until standings are in', () => {
  const qf = resolveBracket(top8(), { 1: 't1' })['basketball-d1-qf-1'];
  assert.equal(qf.slot1.teamId, 't1');
  assert.equal(qf.slot2.teamId, null);
  assert.equal(qf.slot2.label, 'Seed 8');
});

// ---------------------------------------------------------------------------
// Volleyball-style (top 4, sets)
// ---------------------------------------------------------------------------

test('top 4 volleyball: sets won decide the match, not the current-set score', () => {
  const g = top4();
  // t1 wins 2 sets to 1; current-set score happens to favour t4
  finish(g['volleyball-d1-sf-1'], 18, 25, { setsWon1: 2, setsWon2: 1 });
  finish(g['volleyball-d1-sf-2'], 25, 10, { setsWon1: 0, setsWon2: 2 }); // t3
  const r = resolveBracket(g, { 1: 't1', 2: 't2', 3: 't3', 4: 't4' });
  assert.deepEqual(teams(r['volleyball-d1-final-1']), ['t1', 't3']);
  assert.deepEqual(teams(r['volleyball-d1-third-1']), ['t4', 't2']);
});

// ---------------------------------------------------------------------------
// Soccer-style (2 groups, cross semis)
// ---------------------------------------------------------------------------

const groupSeeds = { A1: 'a1', A2: 'a2', B1: 'b1', B2: 'b2' };

test('groups: cross semis pair A1 v B2 and B1 v A2', () => {
  const r = resolveBracket(groups(), groupSeeds);
  assert.deepEqual(teams(r['soccer-d1-sf-1']), ['a1', 'b2']);
  assert.deepEqual(teams(r['soccer-d1-sf-2']), ['b1', 'a2']);
  assert.equal(r['soccer-d1-sf-1'].slot1.label, 'Seed A1');
});

test('groups: a tie decided on penalties uses the scorekeeper winnerId', () => {
  const g = groups();
  finish(g['soccer-d1-sf-1'], 1, 1, { winnerId: 'b2' });
  finish(g['soccer-d1-sf-2'], 2, 0);
  const r = resolveBracket(g, groupSeeds);
  assert.deepEqual(teams(r['soccer-d1-final-1']), ['b2', 'b1']);
  assert.deepEqual(teams(r['soccer-d1-third-1']), ['a1', 'a2']);
});

test('a tie with no winnerId is flagged and does not advance', () => {
  const g = groups();
  finish(g['soccer-d1-sf-1'], 1, 1);
  const r = resolveBracket(g, groupSeeds);
  assert.equal(r['soccer-d1-sf-1'].result.decided, false);
  assert.match(r['soccer-d1-sf-1'].result.problem, /pick a winner/);
  assert.equal(r['soccer-d1-final-1'].slot1.teamId, null);
});

test('a saved winnerId that is no longer in the game is flagged', () => {
  const g = groups();
  finish(g['soccer-d1-sf-1'], 1, 1, { winnerId: 'zz' });
  const res = resolveBracket(g, groupSeeds)['soccer-d1-sf-1'].result;
  assert.equal(res.decided, false);
  assert.match(res.problem, /not in this game/);
});

test('marked final with no score is flagged', () => {
  const g = groups();
  g['soccer-d1-sf-1'].status = 'final';
  const res = resolveBracket(g, groupSeeds)['soccer-d1-sf-1'].result;
  assert.equal(res.decided, false);
  assert.match(res.problem, /score is missing/);
});

// ---------------------------------------------------------------------------
// DQ propagation
// ---------------------------------------------------------------------------

test('DQ before the bracket: opponent advances by walkover', () => {
  const r = resolveBracket(top8(), seeds8, ['t8']);
  const qf1 = r['basketball-d1-qf-1'];
  assert.equal(qf1.slot2.dq, true);
  assert.equal(qf1.result.decided, true);
  assert.equal(qf1.result.walkover, true);
  assert.equal(qf1.result.winnerId, 't1');
  assert.equal(r['basketball-d1-sf-1'].slot1.teamId, 't1');
});

test('DQ mid-bracket: played result stands, next opponent gets a walkover', () => {
  const g = top8();
  finish(g['basketball-d1-qf-1'], 50, 40); // t1 beats t8 ...
  finish(g['basketball-d1-qf-2'], 50, 40); // t4
  finish(g['basketball-d1-qf-3'], 50, 40); // t2
  finish(g['basketball-d1-qf-4'], 50, 40); // t3
  const r = resolveBracket(g, seeds8, ['t1']); // ... then t1 is DQ'd
  const qf1 = r['basketball-d1-qf-1'];
  assert.equal(qf1.result.winnerId, 't1'); // rule 2: played game keeps its result
  assert.equal(qf1.result.walkover, false);

  const sf1 = r['basketball-d1-sf-1'];
  assert.deepEqual(teams(sf1), ['t1', 't4']);
  assert.equal(sf1.slot1.dq, true);
  assert.equal(sf1.result.winnerId, 't4');
  assert.equal(sf1.result.walkover, true);

  assert.equal(r['basketball-d1-final-1'].slot1.teamId, 't4');
  // t1 is SF1's "loser", so the 3rd place game is also a walkover
  const third = r['basketball-d1-third-1'];
  assert.equal(third.slot1.teamId, 't1');
  assert.equal(third.slot1.dq, true);
  assert.equal(third.result.decided, false); // waiting for SF2's loser
  finish(g['basketball-d1-sf-2'], 50, 40);   // t2 beats t3
  const third2 = resolveBracket(g, seeds8, ['t1'])['basketball-d1-third-1'];
  assert.equal(third2.result.winnerId, 't3');
  assert.equal(third2.result.walkover, true);
});

test('DQ\'d team waiting on an undecided opponent stays undecided', () => {
  const g = top8();
  finish(g['basketball-d1-qf-1'], 50, 40); // t1
  const sf1 = resolveBracket(g, seeds8, ['t1'])['basketball-d1-sf-1'];
  assert.equal(sf1.result.decided, false);
});

test('both teams DQ\'d: next round shows "No team" and the other side advances', () => {
  const g = top8();
  let r = resolveBracket(g, seeds8, ['t1', 't8']);
  const qf1 = r['basketball-d1-qf-1'];
  assert.equal(qf1.result.decided, true);
  assert.equal(qf1.result.winnerId, null);

  const sf1 = r['basketball-d1-sf-1'];
  assert.equal(sf1.slot1.empty, true);
  assert.equal(sf1.slot1.label, 'No team');
  assert.equal(sf1.result.decided, false); // QF2 not played yet

  finish(g['basketball-d1-qf-2'], 40, 50); // t5
  r = resolveBracket(g, seeds8, ['t1', 't8']);
  assert.equal(r['basketball-d1-sf-1'].result.winnerId, 't5');
  assert.equal(r['basketball-d1-sf-1'].result.walkover, true);
  assert.equal(r['basketball-d1-final-1'].slot1.teamId, 't5');
  // SF1 had no loser, so 3rd place slot is "No team"
  assert.equal(r['basketball-d1-third-1'].slot1.empty, true);
});

test('DQ list can be a Firebase-style map', () => {
  const r = resolveBracket(top8(), seeds8, { t8: true, t5: false });
  assert.equal(r['basketball-d1-qf-1'].result.winnerId, 't1');
  assert.equal(r['basketball-d1-qf-2'].result.decided, false);
});

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

test('does not change the games passed in', () => {
  const g = top8();
  finish(g['basketball-d1-qf-1'], 50, 40);
  const before = JSON.stringify(g);
  resolveBracket(g, seeds8, ['t4']);
  assert.equal(JSON.stringify(g), before);
});

test('games without sources (round robin) pass through with their teams', () => {
  const r = resolveBracket({ 'soccer-d1-rr-1': { team1Id: 'x', team2Id: 'y', status: 'final', score1: 2, score2: 0 } });
  assert.deepEqual(teams(r['soccer-d1-rr-1']), ['x', 'y']);
  assert.equal(r['soccer-d1-rr-1'].result.winnerId, 'x');
});

test('pointing at a missing game throws a clear error', () => {
  assert.throws(
    () => resolveBracket({ 'b-d1-sf-1': { source1: W('b-d1-qf-9'), source2: seed('1') } }, {}),
    /points to missing game "b-d1-qf-9"/
  );
});

test('a loop between games throws a clear error', () => {
  assert.throws(
    () => resolveBracket({
      'b-d1-sf-1': { source1: W('b-d1-sf-2'), source2: seed('1') },
      'b-d1-sf-2': { source1: W('b-d1-sf-1'), source2: seed('2') }
    }, {}),
    /Bracket loop/
  );
});

test('a malformed source throws a clear error', () => {
  assert.throws(() => resolveBracket({ 'b-d1-sf-1': { source1: { foo: 1 }, source2: seed('1') } }, {}),
    /must have one of/);
});

console.log(`\n${passed} passed`);
