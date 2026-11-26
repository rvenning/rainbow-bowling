const test = require("node:test");
const assert = require("node:assert/strict");
const { Scoring } = require("./load.js");

const rep = (n, v) => Array.from({ length: n }, () => v);

test("perfect game is 300", () => {
  const r = rep(12, 10);
  assert.equal(Scoring.total(r), 300);
  assert.ok(Scoring.done(r));
  assert.deepEqual([...Scoring.marks(Scoring.frames(r)[9], true)], ["X", "X", "X"]);
});

test("all nines and a miss is 90; all gutters is 0", () => {
  const r = []; for (let i = 0; i < 10; i++) r.push(9, 0);
  assert.equal(Scoring.total(r), 90);
  assert.ok(Scoring.done(r));
  assert.equal(Scoring.total(rep(20, 0)), 0);
  assert.ok(Scoring.done(rep(20, 0)));
});

test("all 5/5 spares with a 5 fill ball is 150", () => {
  const r = rep(21, 5);
  assert.equal(Scoring.total(r), 150);
  assert.ok(Scoring.done(r));
});

test("worked example: strike, spare, open", () => {
  // X | 7 / | 9 - | X | - 8 | 8 / | - 6 | X | X | X 8 1  = 167
  const r = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
  const fr = Scoring.frames(r);
  assert.deepEqual([...fr].map((f) => f.score), [20, 39, 48, 66, 74, 84, 90, 120, 148, 167]);
  assert.equal(Scoring.total(r), 167);
  assert.deepEqual([...Scoring.marks(fr[1], false)], ["7", "/"]);
  assert.deepEqual([...Scoring.marks(fr[2], false)], ["9", "-"]);
  assert.deepEqual([...Scoring.marks(fr[0], false)], ["", "X"]);
  assert.deepEqual([...Scoring.marks(fr[9], true)], ["X", "8", "1"]);
});

test("tenth frame: spare earns exactly one more ball, open frame ends it", () => {
  const base = rep(18, 0);
  assert.equal(Scoring.next(base.concat([7])).ball, 1);
  assert.equal(Scoring.next(base.concat([7])).standing, 3);
  const sp = Scoring.next(base.concat([7, 3]));
  assert.equal(sp.done, false); assert.equal(sp.fresh, true); assert.equal(sp.ball, 2);
  assert.ok(Scoring.done(base.concat([7, 3, 4])));
  assert.ok(Scoring.done(base.concat([7, 2])));
  assert.equal(Scoring.total(base.concat([7, 3, 4])), 14);
});

test("tenth frame: strike then rack handling", () => {
  const base = rep(18, 0);
  const a = Scoring.next(base.concat([10]));
  assert.equal(a.fresh, true); assert.equal(a.ball, 1);
  const b = Scoring.next(base.concat([10, 6]));
  assert.equal(b.fresh, false); assert.equal(b.standing, 4); assert.equal(b.done, false);
  const c = Scoring.next(base.concat([10, 10]));
  assert.equal(c.fresh, true);
  assert.deepEqual([...Scoring.marks(Scoring.frames(base.concat([10, 6, 4]))[9], true)], ["X", "6", "/"]);
  assert.deepEqual([...Scoring.marks(Scoring.frames(base.concat([10, 0, 10]))[9], true)], ["X", "-", "/"]);
  assert.deepEqual([...Scoring.marks(Scoring.frames(base.concat([0, 10, 10]))[9], true)], ["-", "/", "X"]);
});

test("running totals wait for bonus balls and never go down", () => {
  const r = [10, 10];
  assert.equal(Scoring.frames(r)[0].score, null);
  assert.equal(Scoring.total(r), 0);
  let prev = 0;
  const game = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
  for (let i = 1; i <= game.length; i++) {
    const t = Scoring.total(game.slice(0, i));
    assert.ok(t >= prev, `total fell at ball ${i}`);
    prev = t;
  }
});

test("next() walks a frame-by-frame game", () => {
  assert.deepEqual({ ...Scoring.next([]) }, { frame: 0, ball: 0, standing: 10, fresh: true, done: false });
  assert.deepEqual({ ...Scoring.next([3]) }, { frame: 0, ball: 1, standing: 7, fresh: false, done: false });
  assert.equal(Scoring.next([3, 4]).frame, 1);
  assert.equal(Scoring.next([10]).frame, 1);
});

test("tally counts marks and the longest strike run", () => {
  const t = Scoring.tally([10, 10, 10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1]);
  assert.equal(t.strikes, 7);
  assert.equal(t.spares, 2);
  assert.equal(t.bestRun, 3);
});
