// Run with: node tests/local-db.test.js
const assert = require('node:assert/strict');
const { createLocalDb, prune } = require('../src/shared/local-db.js');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log('  ok  ' + name);
}

// In-memory stand-in for localStorage
function memStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, raw: m };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  console.log('local-db.js');

  await test('set then read back, nested paths', async () => {
    const db = createLocalDb({ storage: memStorage() });
    await db.ref('ko2027/soccer/d1/live/games/g1').set({ score1: 2 });
    const snap = await db.ref('ko2027/soccer/d1/live').once('value');
    assert.deepEqual(snap.val(), { games: { g1: { score1: 2 } } });
    assert.equal((await db.ref('nope').once('value')).exists(), false);
  });

  await test('update writes several paths at once', async () => {
    const db = createLocalDb({ storage: memStorage() });
    await db.ref('g').update({ score1: 3, 'updatedAt/score1': 100 });
    assert.deepEqual((await db.ref('g').once('value')).val(), { score1: 3, updatedAt: { score1: 100 } });
  });

  await test('null removes, and empty parents disappear (like Firebase)', async () => {
    const db = createLocalDb({ storage: memStorage() });
    await db.ref('a/b/c').set(1);
    await db.ref('a/b/c').set(null);
    assert.equal((await db.ref('a').once('value')).val(), null);
  });

  await test('listeners fire on start and on each change, not on no-op writes', async () => {
    const db = createLocalDb({ storage: memStorage() });
    const seen = [];
    db.ref('x').on('value', (s) => seen.push(s.val()));
    await tick();
    await db.ref('x/y').set(1);
    await db.ref('x/y').set(1); // same value — no event
    await db.ref('other').set(5); // different path — no event
    await db.ref('x/y').set(2);
    assert.deepEqual(seen, [null, { y: 1 }, { y: 2 }]);
  });

  await test('off stops a listener', async () => {
    const db = createLocalDb({ storage: memStorage() });
    let n = 0;
    const cb = () => n++;
    db.ref('x').on('value', cb);
    await tick();
    db.ref('x').off('value', cb);
    await db.ref('x').set(1);
    assert.equal(n, 1);
  });

  await test('transaction applies a function; undefined aborts', async () => {
    const db = createLocalDb({ storage: memStorage() });
    await db.ref('score').set(4);
    const r = await db.ref('score').transaction((v) => (v || 0) + 1);
    assert.equal(r.committed, true);
    assert.equal(r.snapshot.val(), 5);
    const r2 = await db.ref('score').transaction(() => undefined);
    assert.equal(r2.committed, false);
    assert.equal((await db.ref('score').once('value')).val(), 5);
  });

  await test('data survives a "page reload" (new db, same storage)', async () => {
    const storage = memStorage();
    await createLocalDb({ storage }).ref('a').set({ b: 1 });
    const again = createLocalDb({ storage });
    assert.deepEqual((await again.ref('a').once('value')).val(), { b: 1 });
  });

  await test('.info/connected is true', async () => {
    const db = createLocalDb({ storage: memStorage() });
    assert.equal((await db.ref('.info/connected').once('value')).val(), true);
  });

  await test('values come back as copies (callers cannot change stored data)', async () => {
    const db = createLocalDb({ storage: memStorage() });
    const obj = { a: 1 };
    await db.ref('o').set(obj);
    obj.a = 99;
    const v = (await db.ref('o').once('value')).val();
    v.a = 50;
    assert.equal((await db.ref('o').once('value')).val().a, 1);
  });

  await test('prune drops nulls and empty objects', async () => {
    assert.deepEqual(prune({ a: null, b: {}, c: { d: 1 } }), { c: { d: 1 } });
    assert.equal(prune({}), null);
  });

  console.log(`\n${passed} passed`);
})().catch((e) => { console.log('FAILED: ' + e.message); throw e; });
