// The lane: one ball and ten pins on a flat, top-down plane, in INCHES.
// x runs across the lane (0 is the middle), z runs down it from the foul line
// (0) to the head pin (720 = sixty feet). Real dimensions throughout: a 41.5"
// lane, 9.25" gutters, 12" pin spacing, an 8.5" ball, pins 4.77" across.
//
// Fixed 1/480 s step, circles only, and no Math.random anywhere: the same
// throw always knocks the same pins, so the bots, the tests and the title
// screen replay exactly. A pin TIPS when a hit leaves it moving faster than
// PIN_TIP; a softer knock only makes it wobble. Tipped pins tumble on, wider
// than when they stood (a pin lying down sweeps more deck), bounce off the
// kickback walls and knock their neighbours, which is where pin action comes
// from.

const LANE = {
  HALF: 20.75,          // half the lane's width
  GUTTER: 9.25,
  WALL: 30,             // kickback walls, beyond the gutters
  HEAD: 720,            // z of the head pin
  DECK: 715,            // the pin deck starts here
  PIT: 790,             // anything past this has gone into the pit
  BALL_R: 4.25, PIN_R: 2.38,
  BALL_M: 10, PIN_M: 1,
  MIN_SPEED: 230, MAX_SPEED: 470,
  PIN_TIP: 34,          // in/s a hit must leave a standing pin with to topple it
  DT: 1 / 480,
};

// How quickly a toppled pin loses speed (in/s² plus a per-speed share) and
// how much it keeps off a kickback. These set how much "pin action" there is.
const PIN_DRAG = { a: 500, b: 1.5, kick: 0.6, e: 0.5 };
const PIN_SWING = { len: 15, r: 1.9, speed: 220 };

// A curved swipe makes the ball HOOK: a sideways push over the back of the
// lane (like real spin biting late), in in/s² at curve = ±1. The ball is
// launched so that, hook and all, it still crosses the head pin where it
// was aimed: the curve changes the angle it comes in at, never the target.
const HOOK = { accel: 26, from: 300 };

// The rack, numbered the standard way: 1 at the front, 7-8-9-10 at the back.
const ROW = 12 * Math.sqrt(3) / 2;
const PIN_SPOTS = [
  [0, 0],
  [-6, ROW], [6, ROW],
  [-12, 2 * ROW], [0, 2 * ROW], [12, 2 * ROW],
  [-18, 3 * ROW], [-6, 3 * ROW], [6, 3 * ROW], [18, 3 * ROW],
].map(([x, dz]) => [x, LANE.HEAD + dz]);

// Which pins touch which, for spotting splits.
const PIN_NEXT = (() => {
  const adj = PIN_SPOTS.map(() => []);
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
    if (i === j) continue;
    const d = Math.hypot(PIN_SPOTS[i][0] - PIN_SPOTS[j][0], PIN_SPOTS[i][1] - PIN_SPOTS[j][1]);
    if (d < 12.5) adj[i].push(j);
  }
  return adj;
})();

const POWERS = {
  boost: { id: "boost", short: "Boost", name: "Rainbow Boost", icon: "🚀", tip: "A super-heavy, extra-fast ball. Pins go flying!" },
  giant: { id: "giant", short: "Giant", name: "Giant Ball", icon: "🎈", tip: "Your ball grows huge for one throw." },
  lucky: { id: "lucky", short: "Lucky", name: "Lucky Bounce", icon: "🍀", tip: "Bumpers pop up and the ball curls toward the pins." },
  burst: { id: "burst", short: "Burst", name: "Sparkle Burst", icon: "✨", tip: "The ball bursts with sparkles when it reaches the pins." },
};
const POWER_IDS = Object.keys(POWERS);

class LaneSim {
  constructor() {
    this.pins = PIN_SPOTS.map(([x, z], i) => ({ n: i + 1, x, z, vx: 0, vz: 0, down: false, gone: false, tilt: 0, fx: 0, fz: 1, wob: 0, hitT: -1 }));
    this.ball = this.newBall(0);
    this.t = 0; this.events = []; this.done = false; this.bumpers = false; this.power = null;
    this.standingAtLaunch = 10; this.passT = -1; this.burstDone = false; this.lucky = null;
  }
  newBall(x) { return { x, z: -10, vx: 0, vz: 0, r: LANE.BALL_R, m: LANE.BALL_M, state: "ready", roll: 0, gutterSide: 0, hook: 0 }; }

  // A full fresh rack.
  rack() {
    this.pins.forEach((p, i) => Object.assign(p, { x: PIN_SPOTS[i][0], z: PIN_SPOTS[i][1], vx: 0, vz: 0, down: false, gone: false, tilt: 0, wob: 0, hitT: -1 }));
    this.reset();
  }
  // Clear the fallen pins; the standing ones stay exactly where they are.
  sweep() {
    for (const p of this.pins) { if (p.down) p.gone = true; p.vx = p.vz = 0; p.wob = 0; }
    this.reset();
  }
  reset() {
    this.ball = this.newBall(this.ball ? clampStart(this.ball.x) : 0);
    this.t = 0; this.events = []; this.done = false; this.passT = -1; this.burstDone = false; this.power = null; this.lucky = null;
  }
  standing() { return this.pins.filter((p) => !p.down && !p.gone); }
  standingNums() { return this.standing().map((p) => p.n); }

  // Where a good ball should be aimed, as an x at the head pin's z: the pocket
  // for a full rack, otherwise the front of what is left.
  aimPoint(hand) {
    const up = this.standing();
    if (!up.length) return 0;
    if (up.length === 10) return 2.9 * (hand || 1);
    let front = up[0];
    for (const p of up) if (p.z < front.z - 1 || (Math.abs(p.z - front.z) <= 1 && Math.abs(p.x) < Math.abs(front.x))) front = p;
    // lean toward the middle of what is left, so a ball clips the front pin into the rest
    const mx = up.reduce((s, p) => s + p.x, 0) / up.length;
    const lean = up.length > 1 ? Math.max(-3.2, Math.min(3.2, (mx - front.x) * 0.45)) : 0;
    return front.x + lean;
  }

  // Throw. x0 = where the ball starts across the foul line, target = the x it
  // is aimed to cross the head pin's z at, power 0..1.
  launch(x0, target, power, opts) {
    if (this.ball.state !== "ready") return false;
    const o = opts || {};
    const b = this.ball;
    this.power = o.power || null;
    this.bumpers = !!o.bumpers || this.power === "lucky";
    b.x = clampStart(x0); b.z = 0;
    let speed = LANE.MIN_SPEED + (LANE.MAX_SPEED - LANE.MIN_SPEED) * Math.max(0, Math.min(1, power));
    if (this.power === "giant") { b.r = 6.8; b.m = 7; }
    if (this.power === "boost") { b.m = 16; speed = Math.min(LANE.MAX_SPEED * 1.12, speed * 1.18); }
    const dx = target - b.x, dz = LANE.HEAD;
    const len = Math.hypot(dx, dz);
    b.vx = speed * dx / len; b.vz = speed * dz / len;
    b.hook = 0;
    const curve = Math.max(-1, Math.min(1, +o.curve || 0));
    if (curve) { const sol = hookLine(b.x, target, b.vz, curve); b.vx = sol.vx; b.hook = sol.hook; }
    b.state = "rolling";
    this.standingAtLaunch = this.standing().length;
    if (this.power === "lucky") this.lucky = this.aimPoint(b.x >= 0 ? 1 : -1);
    this.t = 0; this.done = false; this.passT = -1; this.burstDone = false;
    this.events.push({ type: "launch", x: b.x, speed, power: this.power });
    return true;
  }

  // Advance by dt seconds in fixed steps.
  tick(dt) {
    if (!(dt > 0)) return;
    this.acc = (this.acc || 0) + Math.min(dt, 0.1);
    while (this.acc >= LANE.DT) { this.acc -= LANE.DT; this.step(); }
  }

  step() {
    const D = LANE.DT, b = this.ball;
    if (b.state === "ready" || this.done) return;
    this.t += D;

    // ---- the ball
    if (b.state === "rolling" || b.state === "gutter") {
      if (this.lucky != null && b.state === "rolling" && b.z > 200 && b.z < LANE.DECK - 30) {
        // curl gently toward the pins: aim the velocity at the lucky point
        const want = (this.lucky - b.x) / Math.max(40, LANE.HEAD - b.z) * b.vz;
        b.vx += (want - b.vx) * Math.min(1, D * 2.6);
      }
      if (b.hook && b.state === "rolling" && b.z > HOOK.from && b.z < LANE.DECK) b.vx += b.hook * D;
      const decel = b.z > LANE.DECK ? 60 : 9;
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0) { const k = Math.max(0, sp - decel * D) / sp; b.vx *= k; b.vz *= k; }
      if (b.state === "gutter") {
        // ride the gutter channel past the pins
        const gx = b.gutterSide * (LANE.HALF + LANE.GUTTER / 2);
        b.x += (gx - b.x) * Math.min(1, D * 10); b.vx = 0;
      }
      b.x += b.vx * D; b.z += b.vz * D; b.roll += sp * D;

      if (b.state === "rolling") {
        if (this.bumpers && b.z < LANE.DECK) {
          const lim = LANE.HALF + 0.8 - b.r;
          if (b.x > lim && b.vx > 0) { b.x = lim; b.vx = -b.vx * 0.55; this.events.push({ type: "bumper", x: b.x, z: b.z, v: Math.abs(b.vx) }); }
          if (b.x < -lim && b.vx < 0) { b.x = -lim; b.vx = -b.vx * 0.55; this.events.push({ type: "bumper", x: b.x, z: b.z, v: Math.abs(b.vx) }); }
        } else if (Math.abs(b.x) > LANE.HALF + 0.5 && b.z < LANE.PIT - 20) {
          b.state = "gutter"; b.gutterSide = Math.sign(b.x);
          this.events.push({ type: "gutter", x: b.x, z: b.z, onDeck: b.z > LANE.DECK });
        }
        // kickbacks along the pin deck
        if (b.z > LANE.DECK - 10 && Math.abs(b.x) + b.r > LANE.WALL) {
          b.x = Math.sign(b.x) * (LANE.WALL - b.r); b.vx = -b.vx * 0.4;
          this.events.push({ type: "kick", x: b.x, z: b.z, v: Math.abs(b.vx) });
        }
      }
      if (b.z > LANE.PIT) { b.state = "pit"; this.events.push({ type: "pit", x: b.x }); }
      else if (Math.hypot(b.vx, b.vz) < 8) b.state = "stopped";
      if (this.passT < 0 && b.z > LANE.HEAD - 8) this.passT = this.t;

      if (this.power === "burst" && !this.burstDone && b.state === "rolling" && b.z > LANE.HEAD - 14) this.burst();
    }

    // ---- the pins
    for (const p of this.pins) {
      if (p.gone) continue;
      if (p.wob > 0) p.wob = Math.max(0, p.wob - D * 1.6);
      if (p.down && p.tilt < 1) p.tilt = Math.min(1, p.tilt + D * 6.5);
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 0) {
        const decel = p.down ? PIN_DRAG.a + sp * PIN_DRAG.b : 1400;
        const k = Math.max(0, sp - decel * D) / sp;
        p.vx *= k; p.vz *= k;
        p.x += p.vx * D; p.z += p.vz * D;
      }
      const r = this.pinR(p);
      if (p.down) {
        if (p.z > LANE.DECK - 20 && Math.abs(p.x) + r > LANE.WALL) {
          p.x = Math.sign(p.x) * (LANE.WALL - r); p.vx = -p.vx * PIN_DRAG.kick;
          if (Math.abs(p.vx) > 40) this.events.push({ type: "kick", x: p.x, z: p.z, v: Math.abs(p.vx) });
        }
        if (p.z < LANE.DECK - 40) { p.z = LANE.DECK - 40; p.vz = Math.abs(p.vz) * 0.3; }
        if (p.z > LANE.PIT) { p.gone = true; p.vx = p.vz = 0; }
        else if (Math.abs(p.x) > LANE.HALF + 1 && Math.hypot(p.vx, p.vz) < 30) { p.gone = true; p.vx = p.vz = 0; }
      } else if (Math.abs(p.x) > LANE.HALF - 0.5) {
        // nudged off the edge of the deck: it falls into the gutter
        this.topple(p, Math.sign(p.x), 0);
      }
    }

    // ---- collisions: ball with pins, then pins with pins
    if (b.state === "rolling" || b.state === "stopped" || (b.state === "gutter" && b.z > LANE.DECK)) {
      for (const p of this.pins) if (!p.gone) this.collide(b, b.r, b.m, p, this.pinR(p), LANE.PIN_M, 0.62, true);
    }
    for (let i = 0; i < 10; i++) {
      const a = this.pins[i];
      if (a.gone) continue;
      for (let j = i + 1; j < 10; j++) {
        const c = this.pins[j];
        if (c.gone) continue;
        if (!a.down && !c.down && Math.hypot(a.vx, a.vz) + Math.hypot(c.vx, c.vz) < 1) continue;
        this.collide(a, this.pinR(a), LANE.PIN_M, c, this.pinR(c), LANE.PIN_M, PIN_DRAG.e, false);
      }
    }
    // a toppling pin is fifteen inches long: its body sweeps the pins it falls toward
    for (const a of this.pins) {
      if (!a.down || a.gone || a.tilt <= 0) continue;
      for (const c of this.pins) if (c !== a && !c.gone && !c.down) this.swing(a, c);
    }

    // ---- finished?
    const ballGone = b.state === "pit" || b.state === "stopped";
    const settled = this.pins.every((p) => p.gone || Math.hypot(p.vx, p.vz) < 4);
    const since = this.passT < 0 ? 0 : this.t - this.passT;
    if ((ballGone && settled && since > 0.5) || (ballGone && since > 3.2) || this.t > 12) {
      for (const p of this.pins) { if (!p.gone) { p.vx = p.vz = 0; } if (p.down) p.tilt = 1; }
      this.done = true;
      this.events.push({ type: "done", knocked: this.knocked() });
    }
  }

  pinR(p) { return LANE.PIN_R + p.tilt * 0.8; }

  // A falling pin `a` (a capsule from its base toward its fall direction)
  // against a standing pin `c`. While it is still going over, its head is
  // moving at the swing speed on top of the pin's own slide.
  swing(a, c) {
    const L = PIN_SWING.len * Math.sin(a.tilt * Math.PI / 2);
    const hx = a.x + a.fx * L, hz = a.z + a.fz * L;
    const sx = hx - a.x, sz = hz - a.z, ll = sx * sx + sz * sz;
    let u = ll > 0 ? ((c.x - a.x) * sx + (c.z - a.z) * sz) / ll : 0;
    u = Math.max(0.3, Math.min(1, u));        // the base itself is handled as a circle
    const qx = a.x + sx * u, qz = a.z + sz * u;
    const dx = c.x - qx, dz = c.z - qz, rr = LANE.PIN_R + PIN_SWING.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr || d2 === 0) return;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
    c.x += nx * (rr - d); c.z += nz * (rr - d);
    const sw = a.tilt < 1 ? PIN_SWING.speed * u : 0;
    const avx = a.vx + a.fx * sw, avz = a.vz + a.fz * sw;
    const rv = (c.vx - avx) * nx + (c.vz - avz) * nz;
    if (rv >= 0) return;
    const j = -(1 + PIN_DRAG.e) * rv / 2;
    c.vx += j * nx; c.vz += j * nz;
    a.vx -= j * nx * 0.5; a.vz -= j * nz * 0.5;
    const s = Math.hypot(c.vx, c.vz);
    if (s > LANE.PIN_TIP) this.topple(c, c.vx, c.vz); else c.wob = Math.min(1, c.wob + s / LANE.PIN_TIP);
    this.events.push({ type: "clack", x: c.x, z: c.z, v: -rv, n: c.n });
  }
  knocked() { return this.standingAtLaunch - this.standing().length; }

  topple(p, fx, fz) {
    if (p.down) return;
    p.down = true; p.hitT = this.t;
    const l = Math.hypot(fx, fz) || 1;
    p.fx = fx / l; p.fz = fz / l;
    this.events.push({ type: "fall", n: p.n, x: p.x, z: p.z });
  }

  // Equal-and-opposite impulse between two circles along the line of centres.
  collide(a, ra, ma, p, rp, mp, e, isBall) {
    const dx = p.x - a.x, dz = p.z - a.z, rr = ra + rp;
    if (Math.abs(dx) > rr || Math.abs(dz) > rr) return;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr || d2 === 0) return;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
    // separate them, in proportion to mass
    const over = rr - d, w = ma + mp;
    a.x -= nx * over * mp / w; a.z -= nz * over * mp / w;
    p.x += nx * over * ma / w; p.z += nz * over * ma / w;
    const rv = (p.vx - a.vx) * nx + (p.vz - a.vz) * nz;
    if (rv >= 0) return;
    const j = -(1 + e) * rv / (1 / ma + 1 / mp);
    a.vx -= j * nx / ma; a.vz -= j * nz / ma;
    p.vx += j * nx / mp; p.vz += j * nz / mp;
    const hit = -rv;
    const check = (q) => {
      if (q.down || q.gone || !("tilt" in q)) return;
      const s = Math.hypot(q.vx, q.vz);
      if (s > LANE.PIN_TIP) this.topple(q, q.vx, q.vz);
      else { q.wob = Math.min(1, q.wob + s / LANE.PIN_TIP); }
    };
    check(p); if (!isBall) check(a);
    this.events.push({ type: isBall ? "hit" : "clack", x: p.x, z: p.z, v: hit, n: p.n });
  }

  burst() {
    this.burstDone = true;
    const b = this.ball;
    for (const p of this.pins) {
      if (p.gone) continue;
      const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz);
      if (d > 22) continue;
      const k = 300 * (1 - d / 26);
      p.vx += dx / (d || 1) * k; p.vz += dz / (d || 1) * k + 40;
      if (Math.hypot(p.vx, p.vz) > LANE.PIN_TIP) this.topple(p, p.vx, p.vz);
    }
    this.events.push({ type: "burst", x: b.x, z: b.z });
  }

  // Is what's left a split? Head pin down, two or more standing, and the
  // standing pins fall into separate groups with a gap between.
  isSplit() {
    const up = this.standing().map((p) => p.n - 1);
    if (up.length < 2 || up.includes(0)) return false;
    const set = new Set(up), seen = new Set([up[0]]), q = [up[0]];
    while (q.length) { const i = q.pop(); for (const j of PIN_NEXT[i]) if (set.has(j) && !seen.has(j)) { seen.add(j); q.push(j); } }
    return seen.size < up.length;
  }

  // Plain-data snapshot, for the renderer's sweep animation and the tests.
  snapshot() { return this.pins.map((p) => ({ n: p.n, x: p.x, z: p.z, down: p.down, gone: p.gone })); }
}

// The ball on its own, no pins: the same motion step() gives it before the
// deck. Returns the x it crosses the head pin at, the widest |x| on the way,
// and (with `pts`) sampled [x, z] points for drawing the aim line.
function rollPath(x0, vx, vz, hook, pts) {
  const D = LANE.DT;
  let x = x0, z = 0, widest = Math.abs(x0);
  for (let n = 0; z < LANE.HEAD && n < 5000; n++) {
    if (hook && z > HOOK.from && z < LANE.DECK) vx += hook * D;
    const sp = Math.hypot(vx, vz), k = Math.max(0, sp - 9 * D) / sp;
    vx *= k; vz *= k;
    x += vx * D; z += vz * D;
    widest = Math.max(widest, Math.abs(x));
    if (pts && n % 24 === 0) pts.push([x, z]);
  }
  return { x, widest };
}

// Solve the launch for a hooked ball: the sideways speed that makes it cross
// the head pin at `target`. If that line would leave the lane before the hook
// brings it back, soften the hook until it stays on: a curve should never be
// what puts a ball in the gutter.
function hookLine(x0, target, vz, curve) {
  let hook = curve * HOOK.accel, vx = 0;
  const lim = Math.max(LANE.HALF - LANE.BALL_R, Math.abs(target) + 0.5, Math.abs(x0) + 0.5);
  for (let tries = 0; tries < 10; tries++) {
    vx = (target - x0) * vz / LANE.HEAD;
    for (let i = 0; i < 4; i++) {
      const a = rollPath(x0, vx, vz, hook).x, b = rollPath(x0, vx + 1, vz, hook).x;
      vx += (target - a) / (b - a || 1);
    }
    if (rollPath(x0, vx, vz, hook).widest <= lim) break;
    hook *= 0.7;
  }
  return { vx, hook };
}

// The aim line for a throw that has not happened yet: [x, z] points.
function aimPath(x0, target, power, curve) {
  const speed = LANE.MIN_SPEED + (LANE.MAX_SPEED - LANE.MIN_SPEED) * Math.max(0, Math.min(1, power));
  const len = Math.hypot(target - x0, LANE.HEAD), vz = speed * LANE.HEAD / len;
  let vx = speed * (target - x0) / len, hook = 0;
  if (curve) ({ vx, hook } = hookLine(x0, target, vz, Math.max(-1, Math.min(1, curve))));
  const pts = [[x0, 0]];
  rollPath(x0, vx, vz, hook, pts);
  pts.push([target, LANE.HEAD]);
  return pts;
}

function clampStart(x) { const lim = LANE.HALF - LANE.BALL_R - 0.5; return Math.max(-lim, Math.min(lim, x)); }

// Seeded generator for the match's power-up bag and the computer player's
// wobble. Never used by the lane itself.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
