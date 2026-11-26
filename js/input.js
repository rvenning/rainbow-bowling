// Bowling: press anywhere on the lane and pull DOWN, like a slingshot. How
// far down you pull is how hard you bowl; sliding sideways steers where the
// ball will meet the pins (pull left to aim right, like a catapult). A dotted
// rainbow line shows the path the whole time. Let go to bowl; slide back up
// to where you pressed to cancel.
//
// Moving the ball across the foul line is the two big arrow buttons (or the
// keyboard arrows). Nothing here touches the engine: it reports to Play.

const Input = {
  stage: null, view: null, enabled: false,
  press: null,       // { id, x, y } client px
  aim: null,         // { target, pow } while pulling
  lastTick: -1,
  onAim: null, onBowl: null, onCancel: null, canStart: () => false, ballX: () => 0,

  // inches of steering per screen px, and px of pull for full power — both
  // scale with the lane's on-screen size so a phone and an iPad feel alike
  unit() { const v = this.view; return Math.min(v.W, v.H * 0.58) || 390; },
  steer() { return 0.15 * 390 / this.unit(); },
  fullPull() { return this.unit() * 0.42; },
  DEAD: 16,

  bind(stage, view) {
    this.stage = stage; this.view = view;
    stage.addEventListener("pointerdown", (e) => this.down(e));
    stage.addEventListener("pointermove", (e) => this.move(e.pointerId, e.clientX, e.clientY, e), { passive: false });
    stage.addEventListener("pointerup", (e) => this.up(e.pointerId));
    stage.addEventListener("pointercancel", () => this.cancel());
    stage.addEventListener("touchmove", (e) => { if (this.press) { e.preventDefault(); const t = e.touches[0]; if (t) this.move(this.press.id, t.clientX, t.clientY); } }, { passive: false });
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("gesturechange", (e) => e.preventDefault());
  },

  down(e) {
    if (!this.enabled || this.press || e.target.closest("button, .hud, .tray, .card")) return;
    if (!this.canStart()) return;
    e.preventDefault();
    this.press = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.aim = null; this.lastTick = -1;
    try { this.stage.setPointerCapture(e.pointerId); } catch (_) { /* synthetic or stale pointer */ }
  },
  move(id, x, y, e) {
    if (!this.press || id !== this.press.id) return;
    if (e) e.preventDefault();
    const dy = y - this.press.y, dx = x - this.press.x;
    if (dy < this.DEAD) { if (this.aim) { this.aim = null; this.onCancel && this.onCancel(); } return; }
    const pow = Math.min(1, (dy - this.DEAD) / (this.fullPull() - this.DEAD));
    const target = Math.max(-LANE.HALF - 6, Math.min(LANE.HALF + 6, this.ballX() - dx * this.steer()));
    this.aim = { target, pow };
    const tick = Math.floor(pow * 10);
    if (tick !== this.lastTick) { this.lastTick = tick; Sfx.aimTick(pow); }
    this.onAim && this.onAim(this.aim);
  },
  up(id) {
    if (!this.press || id !== this.press.id) return;
    const aim = this.aim;
    this.press = null; this.aim = null;
    if (aim) this.onBowl && this.onBowl(aim.target, aim.pow);
    else this.onCancel && this.onCancel();
  },
  cancel() { const had = !!this.press; this.press = null; this.aim = null; if (had && this.onCancel) this.onCancel(); },
};
