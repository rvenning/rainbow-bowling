// Bowling is one gesture: SWIPE UP the lane. Where the swipe points is where
// the ball goes, how fast it is going when you let go is how hard, and a
// swipe that bends makes the ball curve (swipe.js reads all three).
//
// Drag SIDEWAYS instead and the ball follows your finger across the foul
// line. A sideways drag can turn into a swipe without lifting: slide over,
// then flick up. Pulling down first is fine too (a backswing): the swipe is
// measured from the lowest point. A dotted rainbow line shows the path while
// the finger is still on the glass. Nothing here touches the engine: it
// reports to Play.

const Input = {
  stage: null, view: null, enabled: false,
  press: null,       // { id }
  mode: null,        // null (not decided yet) | "slide" | "swing"
  anchor: null,      // the sample the current mode is measured from
  low: null,         // lowest point seen while sliding
  pts: [],           // samples of the swing so far
  slideFrom: 0,
  aim: null,         // { target, pow, curve, word } while swinging
  lastTick: -1,
  onAim: null, onBowl: null, onCancel: null, onSlide: null, onTap: null,
  canStart: () => false, ballX: () => 0, ideal: null,
  DEAD: 10,

  // the lane's on-screen size, so a phone and an iPad feel alike
  unit() { const v = this.view; return Math.min(v.W, v.H * 0.58) || 390; },
  // screen px per inch across the foul line, for the ball to follow a finger
  pxPerInch() {
    const a = this.view.P(0, 0, -10), b = this.view.P(1, 0, -10);
    return a && b && b[0] - a[0] > 0.5 ? b[0] - a[0] : 6;
  },

  bind(stage, view) {
    this.stage = stage; this.view = view;
    stage.addEventListener("pointerdown", (e) => this.down(e));
    stage.addEventListener("pointermove", (e) => this.move(e.pointerId, e.clientX, e.clientY, e), { passive: false });
    stage.addEventListener("pointerup", (e) => this.up(e.pointerId, e.clientX, e.clientY));
    stage.addEventListener("pointercancel", () => this.cancel());
    stage.addEventListener("touchmove", (e) => { if (this.press) e.preventDefault(); }, { passive: false });
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("gesturechange", (e) => e.preventDefault());
  },

  now() { return performance.now() / 1000; },

  down(e) {
    if (!this.enabled || this.press || e.target.closest("button, .hud, .tray, .card")) return;
    if (!this.canStart()) return;
    e.preventDefault();
    const s = { x: e.clientX, y: e.clientY, t: this.now() };
    this.press = { id: e.pointerId };
    this.mode = null; this.anchor = s; this.pts = [s]; this.aim = null; this.lastTick = -1;
    try { this.stage.setPointerCapture(e.pointerId); } catch (_) { /* synthetic or stale pointer */ }
  },

  move(id, x, y, e) {
    if (!this.press || id !== this.press.id) return;
    if (e) e.preventDefault();
    const s = { x, y, t: this.now() };
    const a = this.anchor, dx = x - a.x, dy = y - a.y;

    if (this.mode === null) {
      if (Math.hypot(dx, dy) < this.DEAD) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.2) { this.mode = "slide"; this.slideFrom = this.ballX(); this.low = s; this.lastTick = Math.round(this.slideFrom); }
      else if (dy < 0) { this.mode = "swing"; this.pts = [a, s]; }
      else { this.anchor = s; return; }   // pulling back: the swipe starts from the lowest point
    } else if (this.mode === "slide") {
      if (y >= this.low.y) this.low = s;
      const rise = this.low.y - y;
      if (rise > 24 && rise > Math.abs(x - this.low.x)) { this.mode = "swing"; this.anchor = this.low; this.pts = [this.low, s]; }
    } else {
      if (y > this.anchor.y + 4) {        // back below where it started: start over from here
        this.mode = null; this.anchor = s; this.pts = [s];
        if (this.aim) { this.aim = null; this.onCancel && this.onCancel(); }
        return;
      }
      this.pts.push(s);
      if (this.pts.length > 80) this.pts.splice(1, this.pts.length - 80);
    }

    if (this.mode === "slide") {
      const want = this.slideFrom + (x - this.anchor.x) / this.pxPerInch();
      const got = this.onSlide ? this.onSlide(want) : want;
      const inch = Math.round(got);
      if (inch !== this.lastTick) { this.lastTick = inch; Sfx.nudge(); }
    } else if (this.mode === "swing") {
      this.aim = this.read();
      if (this.aim) this.onAim && this.onAim(this.aim);
    }
  },

  read() {
    return Swipe.read(this.pts, { unit: this.unit(), ballX: this.ballX(), ideal: this.ideal });
  },

  up(id, x, y) {
    if (!this.press || id !== this.press.id) return;
    if (this.mode === "swing" && x != null) {
      const last = this.pts[this.pts.length - 1];
      if (!last || last.x !== x || last.y !== y) this.pts.push({ x, y, t: this.now() });
    }
    const mode = this.mode, aim = mode === "swing" ? this.read() : null;
    this.press = null; this.aim = null; this.mode = null;
    if (aim) { this.onBowl && this.onBowl(aim); return; }
    this.onCancel && this.onCancel();
    if (mode !== "slide" && this.onTap) this.onTap();   // a tap or a too-short swipe: show how
  },

  cancel() {
    const had = !!this.press;
    this.press = null; this.aim = null; this.mode = null;
    if (had && this.onCancel) this.onCancel();
  },
};
