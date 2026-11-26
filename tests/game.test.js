const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./load.js");
const { Match, LaneSim, Bot, Scoring, mulberry32, LANE, POWER_IDS, MAX_POWERS } = S;
const fs = require("node:fs");
const path = require("node:path");

const roll = (x0, t, p, opts) => {
  const l = new LaneSim(); l.rack(); l.launch(x0, t, p, opts || {});
  let n = 0; while (!l.done && n++ < 20000) l.step();
  return l;
};

test("the lane is deterministic: the same throw knocks the same pins", () => {
  for (const [x, t, p] of [[9, 2.9, 0.7], [0, 0, 0.3], [-8, -4, 1], [12, 10, 0.5]]) {
    const a = roll(x, t, p), b = roll(x, t, p);
    assert.deepEqual([...a.standingNums()], [...b.standingNums()]);
    assert.equal(a.t, b.t);
  }
});

test("engine sources never call Math.random", () => {
  for (const f of ["scoring.js", "lane.js", "game.js", "bot.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/Math\.random\s*\(/.test(src), `${f} calls Math.random`);
  }
});

test("a gutter ball knocks nothing and bumpers save it", () => {
  const g = roll(0, 40, 0.6);
  assert.equal(g.knocked(), 0);
  assert.notEqual(g.ball.gutterSide, 0);
  const b = roll(0, 40, 0.6, { bumpers: true });
  assert.ok(b.knocked() > 0, "bumpers bounced it back onto the pins");
  assert.equal(b.ball.gutterSide, 0);
});

test("every throw finishes, at every power, from anywhere", () => {
  const fails = [];
  for (const p of [0, 0.5, 1]) for (const x0 of [-15, 0, 15]) for (const t of [-30, -10, 0, 3, 10, 30]) {
    const l = roll(x0, t, p);
    if (!l.done) fails.push([x0, t, p]);
    if (l.t > 9) fails.push(["slow", x0, t, p, l.t]);
  }
  assert.deepEqual(fails, []);
});

test("a pocket hit strikes, and a head-on hit can leave a split", () => {
  let strikes = 0;
  for (let t = 1.8; t <= 3.2; t += 0.1) if (roll(9, t, 0.75).knocked() === 10) strikes++;
  assert.ok(strikes >= 3, `only ${strikes} strikes across the pocket`);
  const head = roll(0, 0, 0.6);
  assert.ok(head.knocked() < 10);
});

test("power-ups change the throw", () => {
  assert.ok(roll(0, 9, 0.6, { power: "giant" }).knocked() >= roll(0, 9, 0.6).knocked());
  const lucky = roll(0, 40, 0.6, { power: "lucky" });
  assert.ok(lucky.knocked() >= 5, `lucky bounce from a gutter line knocked ${lucky.knocked()}`);
  const burst = roll(14, 14, 0.6, { power: "burst" });
  assert.ok(burst.knocked() > roll(14, 14, 0.6).knocked());
});

test("a match plays to the end for 1 to 4 players, in turn order", () => {
  for (let n = 1; n <= 4; n++) {
    const players = Array.from({ length: n }, (_, i) => ({ name: "P" + i }));
    const m = new Match({ players, seed: 11 + n });
    const order = [];
    const rng = mulberry32(n);
    const dt = 1 / 60;
    let guard = 0;
    while (!m.over && guard++ < 300000) {
      if (m.phase === "aim" && m.canThrow()) {
        const w = m.where();
        if (w.ball === 0) order.push(m.seat);
        const p = Bot.plan(m.lane, "rosalie", rng, {});
        m.throw(p.x0, p.target, p.power);
      }
      m.tick(dt);
      m.events.length = 0;
    }
    assert.ok(m.over, `${n} players finished`);
    for (const p of m.players) assert.ok(Scoring.done(p.rolls));
    // each frame is everyone in seat order
    const want = [];
    for (let f = 0; f < 10; f++) for (let s = 0; s < n; s++) want.push(s);
    assert.deepEqual(order, want);
  }
});

test("pins standing after ball 1 are what ball 2 faces", () => {
  const m = new Match({ players: [{ name: "A" }], seed: 3 });
  m.tick(0.5);
  assert.ok(m.throw(0, 9, 0.5));
  let g = 0;
  while (m.phase !== "result" && g++ < 20000) m.tick(1 / 60);
  const left = [...m.lane.standingNums()];
  assert.ok(left.length > 0 && left.length < 10, "a partial knock");
  while (m.phase !== "aim" && g++ < 40000) m.tick(1 / 60);
  assert.deepEqual([...m.lane.standingNums()], left);
  assert.equal(m.where().ball, 1);
});

test("knocking every pin awards a power-up; trays cap and arming spends one", () => {
  const m = new Match({ players: [{ name: "A" }], seed: 9 });
  const p = m.cur;
  let g = 0;
  const wait = () => { while (m.phase !== "aim" && !m.over && g++ < 100000) m.tick(1 / 60); };
  // throw nothing but pocket strikes at full skill until the tray is full
  m.tick(0.5);
  for (let i = 0; i < 6 && !m.over; i++) { assert.ok(m.throw(9, 2.6, 0.75)); wait(); m.tick(0.5); }
  assert.ok(p.powers.length > 0, "earned power-ups");
  assert.ok(p.powers.length <= MAX_POWERS);
  for (const id of p.powers) assert.ok(POWER_IDS.includes(id));
  const id = p.powers[0], before = p.powers.length;
  assert.ok(m.arm(id));
  assert.equal(p.armed, id);
  assert.ok(m.arm(id)); assert.equal(p.armed, null, "tapping again puts it back");
  m.arm(id);
  assert.ok(m.throw(0, 0, 0.6));
  assert.equal(p.powers.length, before - 1);
  assert.equal(m.lane.power, id);
});

test("the tie-aware standings share first place", () => {
  const m = new Match({ players: [{ name: "A" }, { name: "B" }, { name: "C" }], seed: 1 });
  m.players[0].rolls = Array(20).fill(4);
  m.players[1].rolls = Array(20).fill(4);
  m.players[2].rolls = Array(20).fill(3);
  const st = m.standings();
  assert.deepEqual(st.map((r) => r.place), [1, 1, 3]);
});

test("ticking with a bad dt changes nothing", () => {
  const m = new Match({ players: [{ name: "A" }], seed: 2 });
  m.tick(0.5);
  assert.ok(m.throw(0, 3, 0.6));
  m.tick(1 / 60);
  const z = m.lane.ball.z, t = m.phaseT;
  for (const bad of [-1, 0, NaN, undefined]) m.tick(bad);
  assert.equal(m.lane.ball.z, z);
  assert.equal(m.phaseT, t);
});

// The rule that outranks difficulty: nobody is ever stuck, and better players
// score more. A six-year-old-level bot always finishes with a real score; the
// skill ladder is in order across 12 games each.
test("bots: everyone finishes, and skill shows in the score", () => {
  const mean = {};
  for (const k of ["kid", "rosalie", "pro"]) {
    const rng = mulberry32(77);
    let sum = 0;
    for (let g = 0; g < 12; g++) {
      const m = new Match({ players: [{ name: k }], seed: 100 + g });
      m.autoplay(Bot.brain(k, rng, true));
      assert.ok(m.over, `${k} game ${g} finished`);
      const s = Scoring.total(m.players[0].rolls);
      assert.ok(s >= 30, `${k} scored only ${s}`);
      sum += s;
    }
    mean[k] = sum / 12;
  }
  assert.ok(mean.kid < mean.rosalie && mean.rosalie < mean.pro, JSON.stringify(mean));
});
