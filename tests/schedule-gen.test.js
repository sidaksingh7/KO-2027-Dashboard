// Run with: node tests/schedule-gen.test.js
const assert = require('node:assert/strict');
const S = require('../src/shared/schedule-gen.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

const teams = (n, prefix = 't') => Array.from({ length: n }, (_, i) => prefix + (i + 1));
const list = (games) => Object.values(games);

function gamesPerTeam(games) {
  const count = {};
  list(games).forEach((g) => {
    count[g.team1Id] = (count[g.team1Id] || 0) + 1;
    count[g.team2Id] = (count[g.team2Id] || 0) + 1;
  });
  return count;
}

function pairKeys(games) {
  return list(games).map((g) => [g.team1Id, g.team2Id].sort().join('|'));
}

console.log('schedule-gen.js');

// ---------------------------------------------------------------------------
// Round robin
// ---------------------------------------------------------------------------

for (const n of [4, 5, 8, 9, 10]) {
  test(`full round robin, ${n} teams: everyone plays everyone exactly once`, () => {
    const g = S.roundRobin('basketball', 'd1', teams(n));
    assert.equal(list(g).length, (n * (n - 1)) / 2);
    const keys = pairKeys(g);
    assert.equal(new Set(keys).size, keys.length); // no repeats
    Object.values(gamesPerTeam(g)).forEach((c) => assert.equal(c, n - 1));
  });
}

test('games get ids like basketball-d1-rr-1 and start as scheduled', () => {
  const g = S.roundRobin('basketball', 'd1', teams(4));
  const first = g['basketball-d1-rr-1'];
  assert.ok(first);
  assert.equal(first.status, 'scheduled');
  assert.equal(first.score1, 0);
  assert.equal(first.source1, undefined);
});

test('volleyball games start with empty sets', () => {
  const g = S.roundRobin('volleyball', 'd2', teams(4));
  const first = g['volleyball-d2-rr-1'];
  assert.deepEqual(first.sets, []);
  assert.equal(first.currentSet, 1);
  assert.equal(first.setsWon1, 0);
});

test('gamesPerTeam limits games (10 teams × 3 games = 15 games)', () => {
  const g = S.roundRobin('basketball', 'd1', teams(10), { gamesPerTeam: 3 });
  assert.equal(list(g).length, 15);
  Object.values(gamesPerTeam(g)).forEach((c) => assert.equal(c, 3));
});

test('gamesPerTeam with an odd team count: nobody exceeds the limit or plays twice', () => {
  const g = S.roundRobin('volleyball', 'd1', teams(9), { gamesPerTeam: 2 });
  const counts = gamesPerTeam(g);
  assert.equal(Object.keys(counts).length, 9);
  Object.values(counts).forEach((c) => assert.ok(c >= 1 && c <= 2));
  assert.equal(new Set(pairKeys(g)).size, list(g).length);
});

test('group round robin uses ga/gb ids and tags the group', () => {
  const a = S.roundRobin('soccer', 'd1', teams(5, 'a'), { group: 'A' });
  const b = S.roundRobin('soccer', 'd1', teams(4, 'b'), { group: 'B' });
  assert.ok(a['soccer-d1-ga-1']);
  assert.ok(b['soccer-d1-gb-1']);
  assert.equal(a['soccer-d1-ga-1'].group, 'A');
  assert.equal(list(a).length, 10);
  assert.equal(list(b).length, 6);
});

test('round robin rejects bad input', () => {
  assert.throws(() => S.roundRobin('soccer', 'd1', ['a']), /at least 2/);
  assert.throws(() => S.roundRobin('soccer', 'd1', ['a', 'a']), /twice/);
  assert.throws(() => S.roundRobin('soccer', 'd1', teams(4), { gamesPerTeam: 4 }), /between 1 and 3/);
});

// ---------------------------------------------------------------------------
// Brackets
// ---------------------------------------------------------------------------

test('top8 bracket: QF 1v8, 4v5, 2v7, 3v6 → SF → Final + 3rd', () => {
  const g = S.bracket('basketball', 'd1', 'top8');
  assert.equal(list(g).length, 8);
  assert.deepEqual(g['basketball-d1-qf-1'].source1, { seed: '1' });
  assert.deepEqual(g['basketball-d1-qf-1'].source2, { seed: '8' });
  assert.deepEqual(g['basketball-d1-qf-2'].source1, { seed: '4' });
  assert.deepEqual(g['basketball-d1-sf-1'].source2, { winnerOf: 'basketball-d1-qf-2' });
  assert.deepEqual(g['basketball-d1-final-1'].source1, { winnerOf: 'basketball-d1-sf-1' });
  assert.deepEqual(g['basketball-d1-third-1'].source2, { loserOf: 'basketball-d1-sf-2' });
});

test('top4 bracket: SF 1v4, 2v3', () => {
  const g = S.bracket('volleyball', 'd3', 'top4');
  assert.equal(list(g).length, 4);
  assert.deepEqual(g['volleyball-d3-sf-2'].source1, { seed: '2' });
  assert.deepEqual(g['volleyball-d3-sf-2'].source2, { seed: '3' });
});

test('groups2 bracket: cross semis A1 v B2, B1 v A2', () => {
  const g = S.bracket('soccer', 'd1', 'groups2');
  assert.deepEqual(g['soccer-d1-sf-1'].source1, { seed: 'A1' });
  assert.deepEqual(g['soccer-d1-sf-1'].source2, { seed: 'B2' });
  assert.deepEqual(g['soccer-d1-sf-2'].source1, { seed: 'B1' });
});

test('unknown bracket format throws', () => {
  assert.throws(() => S.bracket('soccer', 'd1', 'top16'), /Unknown bracket format/);
});

// ---------------------------------------------------------------------------
// Slot assignment
// ---------------------------------------------------------------------------

const MIN = 60000;

test('assignSlots: every game gets a court and time, no team double-booked', () => {
  const rr = S.roundRobin('basketball', 'd1', teams(10), { gamesPerTeam: 3 });
  const out = S.assignSlots(rr, { courts: ['Gym 2', 'Gym 3'], startsAt: 1000, slotMs: 30 * MIN });
  const seen = {};
  list(out).forEach((g) => {
    assert.ok(['Gym 2', 'Gym 3'].includes(g.court));
    assert.equal(g.startsAt, 1000 + (g.slot - 1) * 30 * MIN);
    for (const t of [g.team1Id, g.team2Id]) {
      const key = t + '@' + g.slot;
      assert.ok(!seen[key], t + ' double-booked in slot ' + g.slot);
      seen[key] = true;
    }
    const courtKey = g.court + '@' + g.slot;
    assert.ok(!seen[courtKey], 'court used twice in slot ' + g.slot);
    seen[courtKey] = true;
  });
});

test('assignSlots: minRestSlots keeps a gap between a team\'s games', () => {
  const rr = S.roundRobin('soccer', 'd1', teams(6));
  const out = S.assignSlots(rr, { courts: ['A', 'B', 'C'], slotMs: 28 * MIN, minRestSlots: 1 });
  const byTeam = {};
  list(out).forEach((g) => {
    for (const t of [g.team1Id, g.team2Id]) (byTeam[t] = byTeam[t] || []).push(g.slot);
  });
  Object.values(byTeam).forEach((slots) => {
    slots.sort((a, b) => a - b);
    for (let i = 1; i < slots.length; i++) assert.ok(slots[i] - slots[i - 1] >= 2);
  });
});

test('assignSlots: bracket rounds come after round robin and after their feeders', () => {
  const games = Object.assign(
    S.roundRobin('basketball', 'd1', teams(8), { gamesPerTeam: 3 }),
    S.bracket('basketball', 'd1', 'top8')
  );
  const out = S.assignSlots(games, { courts: ['G2', 'G3'], slotMs: 30 * MIN });
  const lastRR = Math.max(...list(out).filter((g) => g.round === 'rr').map((g) => g.slot));
  const s = (id) => out['basketball-d1-' + id].slot;
  assert.ok(s('qf-1') > lastRR);
  assert.equal(s('qf-1'), s('qf-2')); // two courts → QFs run in pairs
  assert.ok(s('sf-1') > Math.max(s('qf-1'), s('qf-2')));
  assert.ok(s('sf-2') > Math.max(s('qf-3'), s('qf-4')));
  assert.ok(s('final-1') > Math.max(s('sf-1'), s('sf-2')));
  assert.ok(s('third-1') > Math.max(s('sf-1'), s('sf-2')));
});

test('assignSlots: divisions sharing courts never collide', () => {
  const games = Object.assign(
    S.roundRobin('volleyball', 'd1', teams(8, 'x'), { gamesPerTeam: 2 }),
    S.roundRobin('volleyball', 'd2', teams(8, 'y'), { gamesPerTeam: 2 }),
    S.roundRobin('volleyball', 'd3', teams(8, 'z'), { gamesPerTeam: 2 })
  );
  const out = S.assignSlots(games, { courts: ['Gym 1', 'Gym 2'], slotMs: 20 * MIN });
  assert.equal(list(out).length, 24);
  const used = new Set(list(out).map((g) => g.court + '@' + g.slot));
  assert.equal(used.size, 24);
});

test('assignSlots needs courts and slot length', () => {
  assert.throws(() => S.assignSlots({}, { slotMs: 1 }), /court/);
  assert.throws(() => S.assignSlots({}, { courts: ['A'] }), /slotMs/);
});

test('assignSlots does not change the games passed in', () => {
  const rr = S.roundRobin('soccer', 'd1', teams(4));
  const before = JSON.stringify(rr);
  S.assignSlots(rr, { courts: ['A'], slotMs: MIN });
  assert.equal(JSON.stringify(rr), before);
});

console.log(`\n${passed} passed`);
