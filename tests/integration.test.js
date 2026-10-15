// Run with: node tests/integration.test.js
// End to end: schedule → results → standings → seeds → bracket cascade.
const assert = require('node:assert/strict');
const { roundRobin, bracket } = require('../src/shared/schedule-gen.js');
const { computeStandings } = require('../src/shared/standings.js');
const { resolveBracket } = require('../src/shared/cascade.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

// Team "strength" decides every game: lower number = stronger, always wins.
const strength = (id) => Number(id.replace(/\D/g, ''));

function playAll(games, pick) {
  Object.values(games).forEach((g) => {
    const [w1] = pick(g);
    Object.assign(g, { status: 'final', score1: w1 ? 50 : 40, score2: w1 ? 40 : 50 });
  });
}
const stronger = (g) => [strength(g.team1Id) < strength(g.team2Id)];

console.log('integration');

test('basketball: full round robin → top 8 → strongest team wins it all', () => {
  const teams = Array.from({ length: 10 }, (_, i) => 'b' + (i + 1));
  const rr = roundRobin('basketball', 'd1', teams);
  playAll(rr, stronger);

  const { seeds, rows } = computeStandings(rr, teams, { sport: 'basketball' });
  assert.deepEqual(rows.slice(0, 8).map((r) => r.teamId), teams.slice(0, 8));

  const br = bracket('basketball', 'd1', 'top8');
  // Play each round in order, re-resolving like the live site would.
  for (const round of ['qf', 'sf', 'final', 'third']) {
    const resolved = resolveBracket(br, seeds);
    Object.keys(br).filter((id) => br[id].round === round).forEach((id) => {
      const g = resolved[id];
      const win1 = strength(g.slot1.teamId) < strength(g.slot2.teamId);
      Object.assign(br[id], { status: 'final', score1: win1 ? 60 : 50, score2: win1 ? 50 : 60 });
    });
  }
  const final = resolveBracket(br, seeds);
  assert.equal(final['basketball-d1-final-1'].result.winnerId, 'b1');
  assert.equal(final['basketball-d1-final-1'].result.loserId, 'b2');
  assert.equal(final['basketball-d1-third-1'].result.winnerId, 'b3');
});

test('soccer: two groups → cross semis → final', () => {
  const A = ['a1', 'a2', 'a3', 'a4', 'a5'];
  const B = ['b1', 'b2', 'b3', 'b4'];
  const games = Object.assign(
    roundRobin('soccer', 'd2', A, { group: 'A' }),
    roundRobin('soccer', 'd2', B, { group: 'B' })
  );
  playAll(games, stronger);
  const { seeds } = computeStandings(games, null, { sport: 'soccer', groups: { A, B } });
  assert.deepEqual(seeds, { A1: 'a1', A2: 'a2', A3: 'a3', A4: 'a4', A5: 'a5', B1: 'b1', B2: 'b2', B3: 'b3', B4: 'b4' });

  const br = bracket('soccer', 'd2', 'groups2');
  const r = resolveBracket(br, seeds);
  assert.deepEqual([r['soccer-d2-sf-1'].slot1.teamId, r['soccer-d2-sf-1'].slot2.teamId], ['a1', 'b2']);
  assert.deepEqual([r['soccer-d2-sf-2'].slot1.teamId, r['soccer-d2-sf-2'].slot2.teamId], ['b1', 'a2']);
});

test('volleyball: partial round robin with sets → top 4 → DQ mid-bracket', () => {
  const teams = Array.from({ length: 8 }, (_, i) => 'v' + (i + 1));
  const rr = roundRobin('volleyball', 'd3', teams, { gamesPerTeam: 3 });
  Object.values(rr).forEach((g) => {
    const win1 = strength(g.team1Id) < strength(g.team2Id);
    const sets = win1 ? [{ s1: 25, s2: 20 }, { s1: 25, s2: 20 }] : [{ s1: 20, s2: 25 }, { s1: 20, s2: 25 }];
    Object.assign(g, { status: 'final', sets, setsWon1: win1 ? 2 : 0, setsWon2: win1 ? 0 : 2 });
  });
  const { seeds } = computeStandings(rr, teams, { sport: 'volleyball' });
  const br = bracket('volleyball', 'd3', 'top4');
  let r = resolveBracket(br, seeds);
  const sf1 = r['volleyball-d3-sf-1'];
  assert.ok(sf1.slot1.teamId && sf1.slot2.teamId);

  // SF1's top seed wins, then gets DQ'd → SF2 winner takes the final by walkover
  Object.assign(br['volleyball-d3-sf-1'], { status: 'final', setsWon1: 2, setsWon2: 0 });
  Object.assign(br['volleyball-d3-sf-2'], { status: 'final', setsWon1: 2, setsWon2: 1 });
  r = resolveBracket(br, seeds, [seeds['1']]);
  assert.equal(r['volleyball-d3-final-1'].result.walkover, true);
  assert.equal(r['volleyball-d3-final-1'].result.winnerId, seeds['2']);
});

console.log(`\n${passed} passed`);
