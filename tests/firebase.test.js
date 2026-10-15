// Run with: node tests/firebase.test.js
const assert = require('node:assert/strict');
const KO = require('../src/shared/firebase.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

console.log('firebase.js');

test('publishedPath builds sport/division/published path', () => {
  assert.equal(KO.publishedPath('soccer', 'd1', 'standings'), 'ko2027/soccer/d1/published/standings');
});

test('publishedPath with no subpath returns the published root', () => {
  assert.equal(KO.publishedPath('volleyball', 'd3'), 'ko2027/volleyball/d3/published');
});

test('livePath joins multiple parts and parts containing slashes', () => {
  assert.equal(
    KO.livePath('basketball', 'd2', 'games', 'basketball-d2-qf-1/score1'),
    'ko2027/basketball/d2/live/games/basketball-d2-qf-1/score1'
  );
});

test('adminPath builds admin path', () => {
  assert.equal(KO.adminPath('banner'), 'ko2027/admin/banner');
  assert.equal(KO.adminPath(), 'ko2027/admin');
});

test('eventPath builds event-wide path', () => {
  assert.equal(KO.eventPath('banner'), 'ko2027/event/banner');
});

test('unknown sport is rejected', () => {
  assert.throws(() => KO.publishedPath('socer', 'd1'), /Unknown sport "socer"/);
});

test('unknown division is rejected', () => {
  assert.throws(() => KO.livePath('soccer', 'D1'), /Unknown division "D1"/);
});

test('empty segments are rejected', () => {
  assert.throws(() => KO.livePath('soccer', 'd1', 'games//x'), /Empty path segment/);
  assert.throws(() => KO.adminPath(''), /Empty path segment/);
});

test('characters Firebase forbids are rejected', () => {
  for (const bad of ['a.b', 'a#b', 'a$b', 'a[b', 'a]b']) {
    assert.throws(() => KO.adminPath(bad), /contains one of/);
  }
});

test('stampedFields adds an updatedAt beside each field', () => {
  assert.deepEqual(KO.stampedFields({ score1: 3, 'timer/running': true }, 1000), {
    score1: 3,
    'updatedAt/score1': 1000,
    'timer/running': true,
    'timer/updatedAt/running': 1000
  });
});

test('stampedFields refuses a field named updatedAt', () => {
  assert.throws(() => KO.stampedFields({ updatedAt: 5 }, 1000), /Cannot stamp/);
});

test('SPORTS and DIVISIONS are copies (editing them cannot loosen validation)', () => {
  KO.SPORTS.push('hockey');
  assert.throws(() => KO.publishedPath('hockey', 'd1'), /Unknown sport/);
});

console.log(`\n${passed} passed`);
