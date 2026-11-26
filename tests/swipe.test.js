// The swipe: made-up finger tracks in, throws out. And the hook it can add.
const test = require("node:test");
const assert = require("node:assert");
const { Swipe, LaneSim, LANE, aimPath } = require("./load.js");

const UNIT = 390;
const ctx = (ballX, ideal) => ({ unit: UNIT, ballX: ballX || 0, ideal: ideal || ((h) => 2.9 * h) });

// A swipe from (x0, y0) by (dx, -up) over `secs`, optionally bowed sideways
// by `bow` px at its middle (positive = bulging right). Evenly timed samples.
function track(dx, up, secs, bow, x0, y0) {
  const pts = [], n = 12;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    pts.push({ x: (x0 || 200) + dx * k + (bow || 0) * Math.sin(Math.PI * k), y: (y0 || 650) - up * k, t: secs * k });
  }
  return pts;
}

test("a straight swipe up the middle rolls into the pocket", () => {
  const r = Swipe.read(track(0, 220, 0.18), ctx(0));
  assert.ok(r);
  assert.ok(r.target > 0.5 && r.target < 2.9, `target ${r.target}`);
  assert.strictEqual(r.curve, 0);
});

test("the swipe's slant decides the side, and further slant goes further", () => {
  const xs = [-130, -40, -10, 0, 10, 40, 130].map((dx) => Swipe.read(track(dx, 220, 0.18), ctx(0)).target);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], `not increasing: ${xs.map((x) => x.toFixed(1))}`);
  assert.ok(xs[0] < -LANE.HALF, "a wild swipe left still goes in the gutter");
  assert.ok(xs[xs.length - 1] > LANE.HALF, "and so does a wild one right");
});

test("aim assist pulls near misses in, but never moves a throw past the ideal", () => {
  for (let raw = -30; raw <= 30; raw += 0.5) {
    const a = Swipe.assist(raw, 3);
    assert.ok(Math.abs(a - 3) <= Math.abs(raw - 3) + 1e-9);
    assert.ok(Math.sign(a - 3) === Math.sign(raw - 3) || a === 3);
  }
  assert.ok(Math.abs(Swipe.assist(8, 3) - 3) < 2.5, "five inches off becomes nearer two");
});

test("release speed falls into four broad steps, and a lazy push still bowls", () => {
  const lazy = Swipe.read(track(0, 150, 1.5), ctx(0));
  const quick = Swipe.read(track(0, 260, 0.12), ctx(0));
  assert.strictEqual(lazy.pow, Swipe.BANDS[0].pow);
  assert.strictEqual(quick.pow, Swipe.BANDS[3].pow);
  const pows = new Set();
  for (const secs of [2, 0.6, 0.35, 0.25, 0.18, 0.12, 0.08]) pows.add(Swipe.read(track(0, 220, secs), ctx(0)).pow);
  assert.deepStrictEqual([...pows].sort(), Array.from(Swipe.BANDS, (b) => b.pow).sort());
});

test("a held finger at the end of a swipe counts as gentle, not as nothing", () => {
  const pts = track(0, 200, 0.2);
  const end = pts[pts.length - 1];
  pts.push({ x: end.x, y: end.y, t: end.t + 0.5 });
  assert.strictEqual(Swipe.read(pts, ctx(0)).pow, Swipe.BANDS[0].pow);
});

test("taps, tiny swipes and downward drags are not throws", () => {
  assert.strictEqual(Swipe.read(track(0, 8, 0.1), ctx(0)), null);
  assert.strictEqual(Swipe.read(track(0, -120, 0.2), ctx(0)), null);
  assert.strictEqual(Swipe.read([{ x: 1, y: 1, t: 0 }], ctx(0)), null);
});

test("a bending swipe curves the ball the same way; a slight wobble does not", () => {
  // bowing left in the middle means the swipe turns RIGHT toward its end
  assert.ok(Swipe.read(track(0, 240, 0.2, -45), ctx(0)).curve > 0.5);
  assert.ok(Swipe.read(track(0, 240, 0.2, 45), ctx(0)).curve < -0.5);
  assert.strictEqual(Swipe.read(track(0, 240, 0.2, 6), ctx(0)).curve, 0);
  assert.strictEqual(Swipe.read(track(0, 60, 0.1, -20), ctx(0)).curve, 0, "too short to curve");
});

function roll(x0, target, power, curve) {
  const l = new LaneSim(); l.rack();
  l.launch(x0, target, power, { curve });
  let cross = null, widest = 0;
  for (let n = 0; n < 20000 && !l.done; n++) {
    l.step();
    const b = l.ball;
    if (b.z < LANE.DECK) widest = Math.max(widest, Math.abs(b.x));
    if (cross == null && b.z >= LANE.HEAD - 4) cross = b.x;
  }
  return { cross, widest, l };
}

test("a hooked ball still meets the pins where it was aimed", () => {
  for (const x0 of [-12, 0, 10]) for (const target of [-3, 0, 3]) for (const curve of [-1, -0.5, 0.5, 1]) {
    for (const power of Swipe.BANDS.map((b) => b.pow)) {
      const r = roll(x0, target, power, curve);
      assert.ok(Math.abs(r.cross - target) < 1.2, `x0 ${x0} target ${target} curve ${curve} pow ${power}: crossed at ${r.cross}`);
    }
  }
});

test("a curve alone never puts a ball in the gutter", () => {
  for (const x0 of [-15, -8, 0, 8, 15]) for (const target of [-12, -3, 3, 12]) for (const curve of [-1, 1]) {
    const r = roll(x0, target, 0.35, curve);
    assert.ok(r.widest <= LANE.HALF, `x0 ${x0} target ${target} curve ${curve} went to ${r.widest}`);
    assert.notStrictEqual(r.l.ball.gutterSide, -1); assert.notStrictEqual(r.l.ball.gutterSide, 1);
  }
});

test("the aim line ends where the ball will cross the head pin", () => {
  for (const curve of [0, 0.7, -1]) {
    const pts = aimPath(4, 2.9, 0.55, curve);
    const r = roll(4, 2.9, 0.55, curve);
    const near = pts.filter((p) => p[1] < LANE.HEAD - 4).pop();
    assert.ok(Math.abs(near[0] - r.cross) < 1.5, `curve ${curve}: line ${near[0]} vs ball ${r.cross}`);
  }
});

test("every swipe speed reaches the pins from anywhere on the line", () => {
  for (const b of Swipe.BANDS) for (const x0 of [-15, 0, 15]) {
    const l = new LaneSim(); l.rack();
    l.launch(x0, 2.9, b.pow, {});
    while (!l.done) l.step();
    assert.ok(l.knocked() > 0, `${b.word} from ${x0} knocked nothing`);
  }
});
