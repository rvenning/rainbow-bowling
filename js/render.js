// Rendering: the Cosmic Rainbow Lanes, in perspective. The engine is a flat
// top-down plane in inches; this file stands a camera behind the foul line
// and projects it. While you aim, the camera sits back and shows the whole
// lane; once the ball is on its way it follows it down, lowering as it goes,
// so the pins are big and close when it arrives.
//
// Everything is drawn in code each frame — no images — and the only cached
// bitmaps are the pin and its glitter (one sprite, reused for every pin).

const Fx = GK.Fx.configure({ grav: 420, poolCap: 500, shakeMax: 9, shakeDecay: 24, shape: "circle", burstSpeed: 160, burstSize: 2.4, textSize: 16, textDy: -30, textCap: 10, font: "'Baloo 2', system-ui, sans-serif" });

const Motion = { on: 1 };   // 0 when the device asks for reduced motion
const RAINBOW = ["#ff3b5c", "#ff8a1f", "#ffd21f", "#3bd16f", "#2fa8ff", "#7b5cff", "#d94dff"];
const SEATS = ["#ff5fa2", "#2fa8ff", "#ffb31f", "#3bd16f"];
const TAU = Math.PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);

// The pin's outline: half-width (inches) at height y above its base.
const PIN_PROFILE = [[0, 1.0], [0.6, 1.45], [2, 2.05], [3.6, 2.38], [5.2, 2.3], [7, 1.75], [8.6, 1.12], [9.8, 0.86], [10.9, 0.92], [12, 1.2], [13, 1.27], [14, 1.05], [14.6, 0.66], [15, 0]];
const PIN_H = 15, PIN_W = 4.77;

const Sprites = {
  pin: null, pinGhost: null,
  build() {
    if (this.pin) return;
    this.pin = this.paintPin(true);
    this.pinGhost = this.paintPin(false);
  },
  // Pearly white with rainbow neck stripes and glitter, drawn once at 24 px/inch.
  paintPin(glitter) {
    const S = 24, w = Math.ceil(PIN_W * S) + 4, h = Math.ceil(PIN_H * S) + 4;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const c = cv.getContext("2d"), cx = w / 2, base = h - 2;
    const path = () => {
      c.beginPath();
      c.moveTo(cx - PIN_PROFILE[0][1] * S, base);
      for (const [y, r] of PIN_PROFILE) c.lineTo(cx - r * S, base - y * S);
      for (let i = PIN_PROFILE.length - 1; i >= 0; i--) c.lineTo(cx + PIN_PROFILE[i][1] * S, base - PIN_PROFILE[i][0] * S);
      c.closePath();
    };
    path();
    const g = c.createLinearGradient(cx - 2.4 * S, 0, cx + 2.4 * S, 0);
    g.addColorStop(0, "#c9c3e6"); g.addColorStop(0.28, "#ffffff"); g.addColorStop(0.55, "#fbf7ff"); g.addColorStop(1, "#a9a0d6");
    c.fillStyle = g; c.fill();
    c.save(); path(); c.clip();
    // iridescent sheen
    const sh = c.createLinearGradient(0, base - 15 * S, 0, base);
    sh.addColorStop(0, "rgba(255,170,230,.22)"); sh.addColorStop(0.5, "rgba(150,220,255,.12)"); sh.addColorStop(1, "rgba(200,255,200,.16)");
    c.fillStyle = sh; c.fillRect(0, 0, w, h);
    // the two neck stripes, in rainbow
    const stripe = (y0, y1, colA, colB) => { const sg = c.createLinearGradient(0, 0, w, 0); sg.addColorStop(0, colA); sg.addColorStop(1, colB); c.fillStyle = sg; c.fillRect(0, base - y1 * S, w, (y1 - y0) * S); };
    stripe(9.15, 9.55, "#ff3b8a", "#ff9a3b");
    stripe(9.85, 10.25, "#7b5cff", "#2fa8ff");
    if (glitter) {
      // glitter: deterministic speckles in every rainbow colour
      for (let i = 0; i < 160; i++) {
        const fy = ((i * 0.6180339) % 1), fx = ((i * 0.7548776) % 1);
        const y = fy * 14.6, rr = this.half(y) * (fx * 2 - 1);
        c.fillStyle = RAINBOW[i % RAINBOW.length];
        c.globalAlpha = 0.35 + ((i * 7) % 5) * 0.1;
        c.beginPath(); c.arc(cx + rr * S, base - y * S, 1.1 + (i % 3) * 0.6, 0, TAU); c.fill();
      }
      c.globalAlpha = 1;
    }
    // a soft highlight down the left shoulder
    c.fillStyle = "rgba(255,255,255,.75)";
    c.beginPath(); c.ellipse(cx - 0.9 * S, base - 4.2 * S, 0.35 * S, 2.1 * S, -0.08, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(cx - 0.45 * S, base - 12.6 * S, 0.22 * S, 0.6 * S, 0, 0, TAU); c.fill();
    c.restore();
    c.strokeStyle = "rgba(60,40,110,.45)"; c.lineWidth = 2; path(); c.stroke();
    return { cv, S, w, h };
  },
  half(y) {
    for (let i = 1; i < PIN_PROFILE.length; i++) {
      const [y1, r1] = PIN_PROFILE[i], [y0, r0] = PIN_PROFILE[i - 1];
      if (y <= y1) return lerp(r0, r1, (y - y0) / (y1 - y0 || 1));
    }
    return 0;
  },
};

class View {
  constructor(cv, opts) {
    this.cv = cv; this.ctx = cv.getContext("2d");
    this.o = Object.assign({ hero: false }, opts);
    this.W = 0; this.H = 0; this.dpr = 1;
    this.cam = { z: -230, h: 95, hy: 100, f: 1000, u: 0 };
    this.trail = []; this.trailT = 0;
    this.camU = 0;
  }
  resize() {
    const r = this.cv.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return false;
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(r.width * this.dpr); this.cv.height = Math.round(r.height * this.dpr);
    return true;
  }
  checkSize() {
    const r = this.cv.getBoundingClientRect();
    if (r.width > 50 && r.height > 50 && (Math.abs(r.width - this.W) > 1 || Math.abs(r.height - this.H) > 1)) this.resize();
  }

  // ---------------------------------------------------------- camera --
  // u = 0: the aiming view (whole lane). u = 1: down at the pins.
  setCam(u) {
    const U = Math.min(this.W, this.H * 0.58), k = smooth(Math.max(0, Math.min(1, u)));
    const f = 3.44 * U;
    const aimHy = this.H - 1.42 * U - Math.max(118, this.H * 0.16);
    this.cam = {
      u: k, f,
      z: lerp(-230, 470, k),
      h: lerp(95, 40, k),
      hy: lerp(Math.max(this.H * 0.1, aimHy), this.H * 0.2, k),
    };
  }
  // world (inches) -> screen px; returns null behind the near plane
  P(x, y, z) {
    const c = this.cam, d = z - c.z;
    if (d < 12) return null;
    return [this.W / 2 + c.f * x / d, c.hy + c.f * (c.h - y) / d, c.f / d];
  }
  // Clamp a polygon edge to the near plane by clipping z.
  zNear() { return this.cam.z + 14; }
  quad(c, x0, x1, z0, z1, y) {
    z0 = Math.max(z0, this.zNear());
    if (z1 <= z0) return false;
    const a = this.P(x0, y || 0, z0), b = this.P(x1, y || 0, z0), d = this.P(x1, y || 0, z1), e = this.P(x0, y || 0, z1);
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.lineTo(e[0], e[1]); c.closePath();
    return true;
  }
  // screen -> lane: the x on the plane y=0 at screen point (sx, sy)
  laneAt(sx, sy) {
    const c = this.cam, dy = sy - c.hy;
    if (dy <= 1) return null;
    const d = c.f * c.h / dy;
    return { x: (sx - this.W / 2) * d / c.f, z: c.z + d };
  }

  // ------------------------------------------------------------ frame --
  // S: { lane, t, ready, aim: {x0, target, pow}, sweep: 0..1|null, fresh, rackT, power, armed, seat }
  draw(S) {
    if (!this.W) return;
    const c = this.ctx, L = S.lane, b = L.ball, t = S.t;
    Sprites.build();
    // camera: follow the ball once it is properly on its way
    let want = 0;
    if (b.state !== "ready" && !S.home) want = Math.max(0, Math.min(1, (b.z - 120) / 470));
    if (S.hold) want = 1;
    this.camU += (want - this.camU) * Math.min(1, (S.dt || 0.016) * (want > this.camU ? 5 : 3.2));
    if (S.snap != null) this.camU = S.snap;
    this.setCam(this.camU);

    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const [shx, shy] = S.fx ? Fx.shakeOffset() : [0, 0];
    c.translate(shx, shy);
    this.drawHall(c, t);
    for (const off of [-132, -66, 66, 132]) this.drawLane(c, off, t, true, S);
    this.drawLane(c, 0, t, false, S);
    this.drawMasking(c, t);
    // trail decal
    if (b.state === "rolling" || b.state === "gutter") {
      this.trailT += S.dt || 0;
      if (this.trailT > 0.012) { this.trailT = 0; this.trail.push({ x: b.x, z: b.z, r: b.r, t }); }
    }
    if (b.state === "ready") this.trail.length = 0;
    this.drawTrail(c, t, S);
    if (S.aim && b.state === "ready") this.drawAim(c, S, t);
    S.sweepZ = S.sweep != null ? this.sweepPos(S.sweep).push : null;
    this.drawBodies(c, S, t);
    this.drawSweep(c, S);
    if (S.fx) Fx.render(c);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ------------------------------------------------------------- hall --
  drawHall(c, t) {
    const W = this.W, H = this.H, hy = this.cam.hy;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#160a3a"); g.addColorStop(0.45, "#2a0f5c"); g.addColorStop(1, "#12072d");
    c.fillStyle = g; c.fillRect(-20, -20, W + 40, H + 40);
    // back wall
    const wall = (y0, y1, col) => { const a = this.P(-260, y1, 840), d = this.P(260, y0, 840); if (!a || !d) return; c.fillStyle = col; c.fillRect(a[0], a[1], d[0] - a[0], d[1] - a[1]); };
    wall(0, 200, "#241158");
    // neon rainbow stripes along the wall
    for (let i = 0; i < 7; i++) {
      const y = 74 + i * 2.2, a = this.P(-260, y, 838), d = this.P(260, y - 1.4, 838);
      if (!a || !d) continue;
      c.fillStyle = RAINBOW[i]; c.globalAlpha = 0.85;
      c.fillRect(a[0], a[1], d[0] - a[0], Math.max(1, d[1] - a[1]));
    }
    c.globalAlpha = 1;
    // the sign
    const s = this.P(0, 100, 838);
    if (s) {
      const fs = Math.max(8, s[2] * 13);
      c.font = `${fs}px 'Baloo 2', 'Trebuchet MS', sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      const txt = "RAINBOW LANES";
      c.lineWidth = Math.max(1.5, fs * 0.14); c.strokeStyle = "rgba(255,90,200,.55)"; c.strokeText(txt, s[0], s[1]);
      const tg = c.createLinearGradient(s[0] - fs * 4, 0, s[0] + fs * 4, 0);
      RAINBOW.forEach((col, i) => tg.addColorStop(i / 6, col));
      c.fillStyle = tg; c.fillText(txt, s[0], s[1]);
    }
    // a disco ball and its light specks drifting over the wall
    const db = this.P(0, 150, 520);
    if (db && db[1] > -60) {
      const r = Math.max(6, db[2] * 11);
      c.strokeStyle = "rgba(255,255,255,.35)"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(db[0], db[1] - r); c.lineTo(db[0], -10); c.stroke();
      const dg = c.createRadialGradient(db[0] - r * 0.3, db[1] - r * 0.3, r * 0.1, db[0], db[1], r);
      dg.addColorStop(0, "#ffffff"); dg.addColorStop(0.5, "#b9b6d9"); dg.addColorStop(1, "#5d5788");
      c.fillStyle = dg; c.beginPath(); c.arc(db[0], db[1], r, 0, TAU); c.fill();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU + t * 0.6, k = Math.cos(a);
        if (k < 0) continue;
        c.fillStyle = RAINBOW[i % 7]; c.globalAlpha = 0.5 * k;
        c.fillRect(db[0] + Math.sin(a) * r * 0.8 - 1.5, db[1] - r * 0.6 + (i % 3) * r * 0.5, 3, 3);
      }
      c.globalAlpha = 1;
    }
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39996 + t * 0.25 * Motion.on, x = W / 2 + Math.sin(a) * W * 0.55, y = hy * (0.25 + 0.7 * ((i * 0.618) % 1)) + Math.cos(a * 1.3) * 10;
      c.fillStyle = RAINBOW[i % 7]; c.globalAlpha = 0.28;
      c.beginPath(); c.arc(x, y, 2 + (i % 3), 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
  }

  // ------------------------------------------------------------- lane --
  drawLane(c, off, t, neighbour, S) {
    const HALF = LANE.HALF, GW = LANE.GUTTER, far = 800;
    const X = (x) => x + off;
    // the capping between lanes (and the ball return)
    if (this.quad(c, X(-HALF - GW - 6), X(-HALF - GW), -80, far)) { c.fillStyle = "#1d0d45"; c.fill(); }
    if (this.quad(c, X(HALF + GW), X(HALF + GW + 6), -80, far)) { c.fillStyle = "#1d0d45"; c.fill(); }
    // gutters, with a neon line on the outside edge
    for (const sgn of [-1, 1]) {
      const x0 = sgn < 0 ? X(-HALF - GW) : X(HALF), x1 = sgn < 0 ? X(-HALF) : X(HALF + GW);
      if (this.quad(c, x0, x1, 0, far)) { c.fillStyle = neighbour ? "#1a1240" : "#221a52"; c.fill(); }
      const ex = sgn < 0 ? X(-HALF - GW) : X(HALF + GW - 0.8);
      if (this.quad(c, ex, ex + 0.8, 0, far)) { c.fillStyle = neighbour ? "rgba(255,95,200,.35)" : "#ff5fc8"; c.fill(); }
    }
    // approach
    if (this.quad(c, X(-HALF - GW), X(HALF + GW), -90, 0)) {
      c.fillStyle = neighbour ? "#6e4a8e" : "#c99a63"; c.fill();
    }
    // the lane itself: maple boards
    if (this.quad(c, X(-HALF), X(HALF), 0, LANE.DECK)) {
      const a = this.P(0, 0, Math.max(0, this.zNear())), d = this.P(0, 0, LANE.DECK);
      const g = c.createLinearGradient(0, a[1], 0, d[1]);
      if (neighbour) { g.addColorStop(0, "#6a4a87"); g.addColorStop(1, "#4b3470"); }
      else { g.addColorStop(0, "#f0c98d"); g.addColorStop(0.6, "#e3b373"); g.addColorStop(1, "#d6a062"); }
      c.fillStyle = g; c.fill();
    }
    if (!neighbour) {
      // board lines
      c.strokeStyle = "rgba(120,70,30,.18)"; c.lineWidth = 1;
      for (let i = 1; i < 39; i++) {
        const x = -HALF + i * (41.5 / 39), a = this.P(x, 0, Math.max(0, this.zNear())), d = this.P(x, 0, LANE.DECK);
        if (!a || !d) continue;
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(d[0], d[1]); c.stroke();
      }
      // oil sheen: a soft lighter streak down the middle
      if (this.quad(c, -10, 10, 0, 520)) { c.fillStyle = "rgba(255,255,255,.07)"; c.fill(); }
      // foul line
      if (this.quad(c, -HALF, HALF, -0.6, 0.6)) { c.fillStyle = "#ff3b8a"; c.fill(); }
      // dots at 7 ft and arrows at 15 ft, in rainbow
      for (let i = 0; i < 7; i++) {
        const x = (i - 3) * 5.4;
        const p = this.P(x, 0, 84);
        if (p) { c.fillStyle = RAINBOW[i]; c.beginPath(); c.ellipse(p[0], p[1], Math.max(1, p[2] * 0.7), Math.max(0.6, p[2] * 0.35), 0, 0, TAU); c.fill(); }
        const z = 180 + Math.abs(i - 3) * 6, tip = this.P(x, 0, z + 9), l = this.P(x - 1.2, 0, z), r = this.P(x + 1.2, 0, z);
        if (tip && l && r) {
          const glow = 0.75 + 0.25 * Math.sin(t * 3 + i * 0.7);
          c.fillStyle = RAINBOW[i]; c.globalAlpha = glow;
          c.beginPath(); c.moveTo(tip[0], tip[1]); c.lineTo(r[0], r[1]); c.lineTo(l[0], l[1]); c.closePath(); c.fill();
          c.globalAlpha = 1;
        }
      }
    }
    // pin deck
    if (this.quad(c, X(-HALF), X(HALF), LANE.DECK, 778)) { c.fillStyle = neighbour ? "#57407a" : "#f6dca9"; c.fill(); }
    // pit
    if (this.quad(c, X(-HALF - GW), X(HALF + GW), 778, 840)) { c.fillStyle = "#0b0520"; c.fill(); }
    // kickbacks
    for (const sgn of [-1, 1]) {
      const x = X(sgn * LANE.WALL);
      const a = this.P(x, 0, 690), d = this.P(x, 0, 800), a2 = this.P(x, 30, 690), d2 = this.P(x, 30, 800);
      if (a && d && a2 && d2) {
        c.fillStyle = neighbour ? "#24124f" : "#33196e";
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(d[0], d[1]); c.lineTo(d2[0], d2[1]); c.lineTo(a2[0], a2[1]); c.closePath(); c.fill();
      }
    }
    if (!neighbour) {
      // pin spots
      for (const [x, z] of PIN_SPOTS) { const p = this.P(x, 0, z); if (p) { c.fillStyle = "rgba(150,90,40,.35)"; c.beginPath(); c.ellipse(p[0], p[1], p[2] * 1.2, p[2] * 0.45, 0, 0, TAU); c.fill(); } }
      if (S.lane.bumpers || S.bumpersShown) this.drawBumpers(c, t);
    } else {
      // the neighbours' racks, standing quietly
      for (const [x, z] of PIN_SPOTS) this.drawPin(c, X(x), z, 0, 0, 1, 0, t, true, 0);
    }
  }

  drawBumpers(c, t) {
    for (const sgn of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const x0 = sgn * (LANE.HALF + 0.2), x1 = sgn * (LANE.HALF + 1.6);
        const z0 = i * 102, z1 = z0 + 102;
        if (!this.quad(c, Math.min(x0, x1), Math.max(x0, x1), z0, Math.min(z1, LANE.DECK), 2.5)) continue;
        c.fillStyle = RAINBOW[(i + Math.floor(t * 4)) % 7]; c.globalAlpha = 0.85; c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  drawMasking(c, t) {
    // the masking unit hides the pinsetter: a rainbow arch over the deck
    const a = this.P(-LANE.WALL - 6, 60, 800), d = this.P(LANE.WALL + 6, 27, 800);
    if (!a || !d) return;
    const w = d[0] - a[0], h = d[1] - a[1];
    c.fillStyle = "#1b0c47"; c.fillRect(a[0], a[1], w, h);
    c.save(); c.beginPath(); c.rect(a[0], a[1], w, h); c.clip();
    const cx = (a[0] + d[0]) / 2, cy = d[1] + h * 0.15;
    for (let i = 0; i < 7; i++) {
      c.strokeStyle = RAINBOW[i]; c.lineWidth = Math.max(1, h * 0.08);
      c.beginPath(); c.arc(cx, cy, w * 0.36 - i * h * 0.085, Math.PI, TAU); c.stroke();
    }
    for (let i = 0; i < 10; i++) {
      const tw = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
      this.star(c, a[0] + w * ((i * 0.618 + 0.05) % 1), a[1] + h * (0.15 + ((i * 0.37) % 0.6)), Math.max(1.5, h * 0.06) * (0.6 + tw * 0.6), "#fff6c2", 0.4 + tw * 0.6);
    }
    c.restore();
    c.fillStyle = "rgba(255,95,200,.8)"; c.fillRect(a[0], d[1] - 2, w, 2);
  }

  star(c, x, y, r, col, alpha) {
    c.globalAlpha = alpha; c.fillStyle = col;
    c.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.32 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    c.closePath(); c.fill(); c.globalAlpha = 1;
  }

  // -------------------------------------------------------- trail --
  drawTrail(c, t, S) {
    const tr = this.trail;
    if (tr.length < 2) return;
    const life = 1.6;
    while (tr.length && t - tr[0].t > life) tr.shift();
    if (tr.length < 2) return;
    const bands = 7;
    for (let k = 0; k < bands; k++) {
      c.fillStyle = RAINBOW[k];
      for (let i = 1; i < tr.length; i++) {
        const p0 = tr[i - 1], p1 = tr[i];
        const age = t - p1.t, a = Math.max(0, 1 - age / life) * (S.power === "lucky" ? 0.9 : 0.75);
        if (a <= 0.02) continue;
        const w0 = p0.r * 1.5, w1 = p1.r * 1.5;
        const o0 = -w0 / 2 + (k / bands) * w0, o1 = -w1 / 2 + (k / bands) * w1;
        const z0 = Math.max(p0.z, this.zNear()), z1 = Math.max(p1.z, this.zNear());
        if (z1 <= z0) continue;
        const A = this.P(p0.x + o0, 0.05, z0), B = this.P(p0.x + o0 + w0 / bands, 0.05, z0), C = this.P(p1.x + o1 + w1 / bands, 0.05, z1), D = this.P(p1.x + o1, 0.05, z1);
        if (!A || !B || !C || !D) continue;
        c.globalAlpha = a;
        c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.lineTo(C[0], C[1]); c.lineTo(D[0], D[1]); c.closePath(); c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  // -------------------------------------------------------- aiming --
  drawAim(c, S, t) {
    const b = S.lane.ball, a = S.aim;
    const x0 = b.x, x1 = a.target;
    const n = 26;
    for (let i = 1; i <= n; i++) {
      const k = i / n, z = k * LANE.HEAD, x = x0 + (x1 - x0) * k;
      const p = this.P(x, 0.2, z);
      if (!p) continue;
      const pulse = 0.65 + 0.35 * Math.sin(t * 8 - i * 0.6);
      c.fillStyle = RAINBOW[i % 7]; c.globalAlpha = pulse;
      c.beginPath(); c.ellipse(p[0], p[1], Math.max(1.6, p[2] * 1.3), Math.max(0.9, p[2] * 0.55), 0, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
    // the target ring where it will meet the pins
    const p = this.P(x1, 0.2, LANE.HEAD - 6);
    if (p) {
      c.lineWidth = 2; c.strokeStyle = "#fff"; c.globalAlpha = 0.9;
      c.beginPath(); c.ellipse(p[0], p[1], p[2] * 4.5, p[2] * 1.7, 0, 0, TAU); c.stroke();
      c.globalAlpha = 1;
    }
  }

  // ----------------------------------------------------- pins & ball --
  drawBodies(c, S, t) {
    const L = S.lane, b = L.ball, list = [];
    const sweepZ = S.sweepZ;
    for (const p of L.pins) {
      if (p.gone) continue;
      let z = p.z, x = p.x;
      if (sweepZ != null && p.down) z = Math.max(z, sweepZ + 4);
      list.push({ z, draw: () => {
        let lift = 0, alpha = 1;
        if (!p.down && S.rackT != null && S.rackT < 0.45) { const k = S.rackT / 0.45; lift = (1 - smooth(k)) * 24; alpha = Math.min(1, k * 2); }
        this.drawPin(c, x, z, p.down ? p.tilt : 0, p.wob, alpha, lift, t, false, p.n, p.fx, p.fz);
      } });
    }
    if (b.state !== "pit") list.push({ z: b.z, draw: () => this.drawBall(c, b, S, t) });
    list.sort((u, v) => v.z - u.z);
    for (const it of list) it.draw();
  }

  drawPin(c, x, z, tilt, wob, alpha, lift, t, plain, n, fx, fz) {
    const p = this.P(x, 0, z);
    if (!p) return;
    const sp = plain ? Sprites.pinGhost : Sprites.pin;
    const s = p[2], h = PIN_H * s, w = PIN_W * s;
    if (h < 2) return;
    const base = this.P(x, lift || 0, z);
    c.save();
    c.globalAlpha = alpha * (plain ? 0.55 : 1);
    // shadow
    if (!plain && !lift) { c.fillStyle = "rgba(40,20,10,.25)"; c.beginPath(); c.ellipse(p[0] + s * 0.8, p[1], s * 2.6, s * 0.8, 0, 0, TAU); c.fill(); }
    c.translate(base[0], base[1]);
    const ang = tilt * Math.PI / 2;
    const rot = (fx || 0) * ang + (wob ? Math.sin(t * 28 + (n || 0)) * wob * 0.12 : 0);
    const squash = 1 - Math.abs(fz || 0) * Math.sin(ang) * 0.82;
    c.rotate(rot);
    c.scale(1, squash);
    c.drawImage(sp.cv, -w / 2 - 2 * s / sp.S, -h - 2 * s / sp.S, w + 4 * s / sp.S, h + 4 * s / sp.S);
    c.restore();
    // twinkles on standing pins
    if (!plain && !tilt && h > 8 && Motion.on) {
      for (let k = 0; k < 2; k++) {
        const ph = t * 2.2 + (n || 0) * 1.37 + k * 3.1, tw = Math.sin(ph);
        if (tw < 0.35) continue;
        const yy = ((n * 0.37 + k * 0.41 + Math.floor(ph / TAU) * 0.29) % 1) * 12 + 1.5;
        const xx = Sprites.half(yy) * (((n * 0.71 + k * 0.53 + Math.floor(ph / TAU) * 0.17) % 1) * 1.6 - 0.8);
        this.star(c, base[0] + xx * s, base[1] - yy * s, Math.max(2, s * 1.3) * tw, k ? "#ffffff" : "#fff2a8", tw);
      }
    }
  }

  drawBall(c, b, S, t) {
    // an armed Giant Ball is already big while you aim
    const br = b.state === "ready" && S.armed === "giant" ? 6.8 : b.r;
    const yC = b.state === "gutter" ? br - 1.5 : br;
    const p = this.P(b.x, yC, b.z), g = this.P(b.x, 0, b.z);
    if (!p || !g) return;
    const r = br * p[2];
    // shadow
    c.fillStyle = "rgba(30,10,40,.35)"; c.beginPath(); c.ellipse(g[0] + r * 0.15, g[1], r * 1.05, r * 0.32, 0, 0, TAU); c.fill();
    const power = S.power || (b.state === "ready" ? S.armed : null);
    // halos: waiting ball pulses in the player's colour; power-ups glow
    if (b.state === "ready" && !S.aim && S.seatCol) {
      const k = 0.5 + 0.5 * Math.sin(t * 4);
      c.strokeStyle = S.seatCol; c.lineWidth = 3; c.globalAlpha = 0.6 + k * 0.4;
      c.beginPath(); c.arc(p[0], p[1], r * (1.25 + k * 0.12), 0, TAU); c.stroke(); c.globalAlpha = 1;
    }
    if (power) {
      const k = 0.5 + 0.5 * Math.sin(t * 9);
      const col = { boost: "#ff8a1f", giant: "#d94dff", lucky: "#3bd16f", burst: "#fff6a8" }[power];
      const rg = c.createRadialGradient(p[0], p[1], r * 0.8, p[0], p[1], r * (1.9 + k * 0.3));
      rg.addColorStop(0, col); rg.addColorStop(1, "rgba(0,0,0,0)");
      c.globalAlpha = 0.55; c.fillStyle = rg; c.beginPath(); c.arc(p[0], p[1], r * 2.2, 0, TAU); c.fill(); c.globalAlpha = 1;
    }
    c.save();
    c.beginPath(); c.arc(p[0], p[1], r, 0, TAU); c.clip();
    // rolling rainbow bands
    const circ = TAU * b.r, off = ((b.roll % circ) / circ) * 7;
    const band = (2 * r) / 3.5;
    for (let i = -8; i < 9; i++) {
      const y = p[1] + r - ((i + off) * band);
      c.fillStyle = RAINBOW[((i % 7) + 7) % 7];
      c.fillRect(p[0] - r, y - band, 2 * r, band + 1);
    }
    // finger holes, riding round with the bands
    const ph = (off / 7) * TAU, hv = Math.cos(ph);
    if (hv > 0) {
      const hy = p[1] - Math.sin(ph) * r * 0.55;
      c.fillStyle = "rgba(25,10,50,.75)";
      for (const [dx, dy, rr] of [[-0.22, -0.18, 0.12], [0.22, -0.18, 0.12], [0, 0.2, 0.15]]) {
        c.beginPath(); c.ellipse(p[0] + dx * r, hy + dy * r * hv, rr * r, rr * r * hv, 0, 0, TAU); c.fill();
      }
    }
    // glossy sphere shading over the stripes
    const sg = c.createRadialGradient(p[0] - r * 0.35, p[1] - r * 0.4, r * 0.05, p[0], p[1], r * 1.05);
    sg.addColorStop(0, "rgba(255,255,255,.75)"); sg.addColorStop(0.25, "rgba(255,255,255,.12)"); sg.addColorStop(0.75, "rgba(0,0,0,.05)"); sg.addColorStop(1, "rgba(20,0,50,.45)");
    c.fillStyle = sg; c.fillRect(p[0] - r, p[1] - r, 2 * r, 2 * r);
    c.restore();
    c.strokeStyle = "rgba(255,255,255,.5)"; c.lineWidth = Math.max(1, r * 0.05);
    c.beginPath(); c.arc(p[0], p[1], r, 0, TAU); c.stroke();
    if (power === "burst" || power === "lucky") {
      for (let k = 0; k < 3; k++) {
        const a = t * 5 + k * 2.1;
        this.star(c, p[0] + Math.cos(a) * r * 1.3, p[1] + Math.sin(a) * r * 1.1, r * 0.3, power === "lucky" ? "#b8ffcf" : "#fff6a8", 0.9);
      }
    }
  }

  // The sweep bar comes down, pushes the fallen pins back, and lifts.
  sweepPos(k) {
    let drop, z;
    if (k < 0.25) { drop = k / 0.25; z = 708; }
    else if (k < 0.5) { drop = 1; z = 708 + (k - 0.25) / 0.25 * 78; }
    else if (k < 0.75) { drop = 1; z = 786 - (k - 0.5) / 0.25 * 78; }
    else { drop = 1 - (k - 0.75) / 0.25; z = 708; }
    return { drop, z, push: k >= 0.25 && k < 0.5 ? z : null };
  }
  drawSweep(c, S) {
    if (S.sweep == null) return;
    const { drop, z } = this.sweepPos(S.sweep);
    const y = 27 - smooth(drop) * 24;
    const a = this.P(-LANE.HALF - 3, y + 4, z), d = this.P(LANE.HALF + 3, y, z);
    if (!a || !d) return;
    c.fillStyle = "#3b1b86"; c.fillRect(a[0], a[1], d[0] - a[0], d[1] - a[1]);
    c.fillStyle = "#ff5fc8"; c.fillRect(a[0], d[1] - 2, d[0] - a[0], 2);
  }
}
