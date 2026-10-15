// Run with: node tests/timer.test.js
const assert = require('node:assert/strict');
const T = require('../src/shared/timer.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

const MIN = 60000;
const down20 = (now = 0) => T.createTimer({ direction: 'down', duration: 20 * MIN }, now);

console.log('timer.js');

// ---------------------------------------------------------------------------
// Basic clock
// ---------------------------------------------------------------------------

test('countdown needs a duration', () => {
  assert.throws(() => T.createTimer({ direction: 'down' }, 0), /needs a duration/);
});

test('new countdown shows full duration, not running', () => {
  const t = down20();
  assert.equal(t.running, false);
  assert.equal(T.display(t, 0), '20:00');
});

test('start → time passes → pause keeps elapsed time', () => {
  let t = T.start(down20(), 1000);
  assert.equal(T.elapsed(t, 61000), 60000);
  assert.equal(T.display(t, 61000), '19:00');
  t = T.pause(t, 61000);
  assert.equal(T.elapsed(t, 999999), 60000); // paused: time stops
  t = T.start(t, 100000);
  assert.equal(T.elapsed(t, 130000), 90000);
});

test('start on a running timer and pause on a paused one do nothing', () => {
  const running = T.start(down20(), 5);
  assert.equal(T.start(running, 999), running);
  const paused = down20();
  assert.equal(T.pause(paused, 999), paused);
});

test('countdown stops at 00:00 and reports time up', () => {
  const t = T.start(down20(), 0);
  assert.equal(T.isTimeUp(t, 20 * MIN - 1), false);
  assert.equal(T.display(t, 20 * MIN - 1), '00:01'); // rounds up until truly 0
  assert.equal(T.isTimeUp(t, 20 * MIN), true);
  assert.equal(T.shown(t, 25 * MIN), 0);
  assert.equal(T.display(t, 25 * MIN), '00:00');
});

test('volleyball stopwatch counts up with no limit', () => {
  let t = T.createTimer({ direction: 'up' }, 0);
  assert.equal(t.duration, null);
  t = T.start(t, 0);
  assert.equal(T.display(t, 75 * MIN + 5000), '75:05');
  assert.equal(T.isTimeUp(t, 999 * MIN), false);
});

test('start time in the future (clock skew) never shows negative elapsed', () => {
  const t = T.start(down20(), 10000);
  assert.equal(T.elapsed(t, 5000), 0);
});

// ---------------------------------------------------------------------------
// Reset + adjust (scorekeeper actions)
// ---------------------------------------------------------------------------

test('reset stops, zeroes, and can change duration', () => {
  let t = T.start(down20(), 0);
  t = T.reset(t, 15 * MIN, 5 * MIN);
  assert.equal(t.running, false);
  assert.equal(T.elapsed(t, 99 * MIN), 0);
  assert.equal(t.duration, 15 * MIN);
  assert.equal(t.updatedAt.duration, 5 * MIN);
});

test('reset without a new duration keeps the old one', () => {
  const t = T.reset(T.start(down20(), 0), null, 1000);
  assert.equal(t.duration, 20 * MIN);
});

test('adjust corrects the clock while running without touching duration', () => {
  let t = T.start(down20(), 0);
  t = T.adjust(t, 4 * MIN + 12000, 10 * MIN); // ref says 4:12 left
  assert.equal(t.duration, 20 * MIN);
  assert.equal(t.running, true);
  assert.equal(T.display(t, 10 * MIN), '04:12');
  assert.equal(T.display(t, 11 * MIN), '03:12'); // keeps ticking from there
});

test('adjust on a stopwatch sets time played', () => {
  const t = T.adjust(T.createTimer({ direction: 'up' }, 0), 90000, 5);
  assert.equal(T.display(t, 5), '01:30');
});

test('actions return new timers and never change the one passed in', () => {
  const t = down20();
  const before = JSON.stringify(t);
  T.start(t, 1); T.reset(t, 5 * MIN, 2); T.adjust(t, 1000, 3);
  assert.equal(JSON.stringify(t), before);
});

// ---------------------------------------------------------------------------
// Sync merge — the 2026 reset bugs
// ---------------------------------------------------------------------------

test('merge with nothing on one side returns the other', () => {
  const t = down20();
  assert.equal(T.mergeTimer(null, t), t);
  assert.equal(T.mergeTimer(t, null), t);
});

test('2026 BUG: a stale paused copy cannot stop or reset a running clock', () => {
  const stale = down20(0);                       // phone that loaded early and never updated
  const live = T.start(down20(0), 60000);        // scorekeeper started the game later
  const merged = T.mergeTimer(live, stale);
  assert.equal(merged.running, true);
  assert.equal(merged.startedAt, 60000);
  assert.equal(merged.duration, 20 * MIN);
});

test('2026 BUG: a newer duration stamp cannot change a running clock\'s duration', () => {
  const live = T.start(down20(0), 1000);
  // Corrupt/stale copy: duration 15 min stamped "later" (e.g. a fast device clock),
  // but its clock action is older than the live start.
  const bad = Object.assign({}, down20(0), {
    duration: 15 * MIN,
    updatedAt: Object.assign({}, down20(0).updatedAt, { duration: 9e12 })
  });
  for (const merged of [T.mergeTimer(live, bad), T.mergeTimer(bad, live)]) {
    assert.equal(merged.running, true);
    assert.equal(merged.duration, 20 * MIN);
  }
});

test('a TV joining mid-game takes the running clock from Firebase', () => {
  const tv = null;
  const remote = T.start(down20(0), 5000);
  assert.deepEqual(T.mergeTimer(tv, remote), remote);
});

test('a newer pause from another device wins', () => {
  const running = T.start(down20(0), 1000);
  const paused = T.pause(running, 61000);
  const merged = T.mergeTimer(running, paused);
  assert.equal(merged.running, false);
  assert.equal(merged.accumulated, 60000);
});

test('rule 3: a real reset + start on another device carries its new duration', () => {
  const a = T.start(down20(0), 1000);                           // device A running 20 min
  const b = T.start(T.reset(a, 10 * MIN, 50000), 51000);        // device B: reset to 10, start
  const merged = T.mergeTimer(a, b);
  assert.equal(merged.duration, 10 * MIN);
  assert.equal(merged.startedAt, 51000);
});

test('while paused, duration follows the newest reset', () => {
  const a = down20(0);
  const b = T.reset(a, 12 * MIN, 500);
  assert.equal(T.mergeTimer(a, b).duration, 12 * MIN);
  assert.equal(T.mergeTimer(b, a).duration, 12 * MIN);
});

test('every device ends with the same timer no matter the merge order', () => {
  const base = down20(0);
  const cases = [
    [T.start(base, 10), T.pause(T.start(base, 10), 500)],
    [T.start(base, 10), T.reset(base, 5 * MIN, 20)],
    [T.start(base, 10), T.start(base, 10)],            // identical stamps
    [T.adjust(base, 1000, 7), T.adjust(base, 2000, 7)] // same stamp, different values
  ];
  for (const [x, y] of cases) {
    assert.deepEqual(T.mergeTimer(x, y), T.mergeTimer(y, x));
  }
});

test('merge does not change either input', () => {
  const a = T.start(down20(0), 10);
  const b = T.reset(down20(0), 5 * MIN, 20);
  const before = JSON.stringify([a, b]);
  T.mergeTimer(a, b);
  assert.equal(JSON.stringify([a, b]), before);
});

console.log(`\n${passed} passed`);
