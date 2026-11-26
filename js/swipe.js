// Reading a swipe as a throw. Pure functions over finger samples, no DOM, so
// the tests can feed it made-up swipes.
//
// A throw is a flick UP the lane:
//   * DIRECTION is where it goes. The lane is narrow at the far end, so a
//     true perspective mapping would put a 3° wobble of a thumb in the
//     gutter; instead the swipe's slant (sideways ÷ upward) is scaled by
//     AIM_K inches. A swipe slanted about 20° reaches the edge of the lane.
//   * Then the AIM ASSIST: anything near the right spot (the pocket for a
//     full rack, the front pin for a spare) is pulled most of the way onto
//     it, so "roughly at the pins" plays like "at the pins". Wilder throws
//     are only shifted by the same amount, never rescued.
//   * SPEED is how hard, in four broad steps: a lazy push still rolls all
//     the way to the pins, it just carries less.
//   * A swipe that BENDS curves the ball the same way.
//   * Swipe speed and length are measured in lane-widths (`unit`), so a
//     phone and an iPad feel alike.

const Swipe = {
  AIM_K: 55,           // inches across the head pin per unit of slant
  ASSIST: { near: 9, keep: 0.45 },
  BANDS: [             // release speed (units per second) -> power
    { v: 0, pow: 0.35, word: "Gentle" },
    { v: 1.3, pow: 0.55, word: "Good" },
    { v: 2.6, pow: 0.75, word: "Strong" },
    { v: 4.2, pow: 0.92, word: "Super" },
  ],
  BEND: { dead: 0.2, full: 0.45, minLen: 0.25 }, // radians; a swipe shorter than minLen·unit never curves
  WINDOW: 0.09,        // seconds of swipe the release speed is measured over

  minUp(unit) { return Math.max(30, unit * 0.09); },

  // Pull a raw target toward the ideal one.
  assist(raw, ideal) {
    const e = raw - ideal, a = Math.abs(e), A = this.ASSIST;
    const kept = a < A.near ? a * A.keep : a - A.near * (1 - A.keep);
    return ideal + Math.sign(e) * kept;
  },

  // For a full rack there are two pockets, one each side of the head pin.
  // Aim right of SWITCH and you are helped into the right one, left of it
  // into the left one, blended across a few inches so the aim line never
  // jumps. SWITCH sits left of centre: a straight swipe from the middle
  // goes for the right-hand pocket, like most bowlers. For a spare both
  // hands give the same spot and the blend does nothing.
  SWITCH: { at: -3, span: 3 },
  assisted(raw, ideal) {
    if (!ideal) return raw;
    const w = Math.max(0, Math.min(1, (raw - this.SWITCH.at) / this.SWITCH.span + 0.5));
    return w * this.assist(raw, ideal(1)) + (1 - w) * this.assist(raw, ideal(-1));
  },

  band(v) {
    let b = this.BANDS[0];
    for (const x of this.BANDS) if (v >= x.v) b = x;
    return b;
  },

  // Release speed in units/s: the last WINDOW of the swipe, or all of it if
  // it was quicker than that.
  speed(pts, unit) {
    const last = pts[pts.length - 1];
    let first = pts[0];
    for (let i = pts.length - 1; i >= 0; i--) { first = pts[i]; if (last.t - pts[i].t >= this.WINDOW) break; }
    const dt = Math.max(0.016, last.t - first.t);
    return Math.hypot(last.x - first.x, last.y - first.y) / dt / unit;
  },

  // How much the swipe bends: the turn from its first half to its second,
  // -1..1 (positive = bending right).
  bend(pts, unit) {
    let len = 0;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); cum.push(len); }
    if (len < this.BEND.minLen * unit) return 0;
    let mid = 1;
    while (mid < pts.length - 1 && cum[mid] < len / 2) mid++;
    const a = pts[0], m = pts[mid], z = pts[pts.length - 1];
    const ang = (p, q) => Math.atan2(q.x - p.x, p.y - q.y); // 0 = straight up, + = leaning right
    let d = ang(m, z) - ang(a, m);
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
    const k = Math.max(0, Math.min(1, (Math.abs(d) - this.BEND.dead) / this.BEND.full));
    return k ? Math.sign(d) * k : 0;
  },

  // pts: [{x, y, t}] in screen px and seconds, from the start of the swipe.
  // ctx: { unit, ballX, ideal(hand) }. Returns null for a swipe that is not
  // a throw (too short, or not upward).
  read(pts, ctx) {
    if (!pts || pts.length < 2) return null;
    const a = pts[0], z = pts[pts.length - 1];
    const up = a.y - z.y, side = z.x - a.x;
    if (up < this.minUp(ctx.unit)) return null;
    const raw = ctx.ballX + this.AIM_K * side / up;
    const lim = LANE.HALF + 6;
    const target = Math.max(-lim, Math.min(lim, this.assisted(raw, ctx.ideal)));
    const b = this.band(this.speed(pts, ctx.unit));
    return { target, pow: b.pow, word: b.word, curve: this.bend(pts, ctx.unit), raw };
  },
};
